-- Candidate: apply only after full recovery/runtime verification. No historical cost backfill.
CREATE TABLE IF NOT EXISTS public.hpp_price_history (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id bigint NOT NULL REFERENCES public.organizations(id),
 product_id bigint NOT NULL REFERENCES public.products(id),
 variant_id bigint REFERENCES public.product_variants(id),
 effective_from date NOT NULL,
 hpp numeric(15,2) NOT NULL CHECK (hpp >= 0 AND hpp <= 9999999999999.99),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 recorded_by uuid DEFAULT auth.uid()
);
ALTER TABLE public.hpp_price_history DROP CONSTRAINT IF EXISTS hpp_price_history_hpp_check;
ALTER TABLE public.hpp_price_history ADD CONSTRAINT hpp_price_history_hpp_check CHECK(hpp >= 0 AND hpp <= 9999999999999.99);
CREATE INDEX IF NOT EXISTS hpp_price_history_lookup ON public.hpp_price_history(product_id,variant_id,effective_from DESC,id DESC);
ALTER TABLE public.hpp_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hpp_price_history_read ON public.hpp_price_history;
CREATE POLICY hpp_price_history_read ON public.hpp_price_history FOR SELECT TO authenticated
 USING (organization_id = public.current_org_id());
REVOKE ALL ON public.hpp_price_history FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.hpp_price_history TO authenticated;
REVOKE ALL ON SEQUENCE public.hpp_price_history_id_seq FROM PUBLIC,anon,authenticated,service_role;
-- Existing snapshots retain their provenance and value. New NULL snapshots opt into dated pricing.
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS hpp_price_id bigint REFERENCES public.hpp_price_history(id);
ALTER TABLE public.order_items_draft ADD COLUMN IF NOT EXISTS hpp_price_id bigint REFERENCES public.hpp_price_history(id);
ALTER TABLE public.order_items ADD COLUMN IF NOT EXISTS hpp_pricing_mode text NOT NULL DEFAULT 'fixed' CHECK(hpp_pricing_mode IN ('fixed','dated'));
ALTER TABLE public.order_items_draft ADD COLUMN IF NOT EXISTS hpp_pricing_mode text NOT NULL DEFAULT 'fixed' CHECK(hpp_pricing_mode IN ('fixed','dated'));
CREATE INDEX IF NOT EXISTS order_items_hpp_price_idx ON public.order_items(hpp_price_id);
CREATE INDEX IF NOT EXISTS order_items_draft_hpp_price_idx ON public.order_items_draft(hpp_price_id);
-- Baseline is known today only; never pretend today's master is historical evidence.
INSERT INTO public.hpp_price_history(organization_id,product_id,variant_id,effective_from,hpp)
 SELECT organization_id,id,NULL,(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,hpp FROM public.products p WHERE hpp IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.hpp_price_history h WHERE h.product_id=p.id AND h.variant_id IS NULL);
INSERT INTO public.hpp_price_history(organization_id,product_id,variant_id,effective_from,hpp)
 SELECT organization_id,product_id,id,(clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date,hpp FROM public.product_variants v WHERE NOT EXISTS(SELECT 1 FROM public.hpp_price_history h WHERE h.variant_id=v.id);

CREATE OR REPLACE FUNCTION public.snapshot_hpp_on_order_items()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
DECLARE d date; org bigint; v bigint; rate public.hpp_price_history; reprice boolean;
BEGIN
 IF NEW.product_id IS NULL AND NEW.variant_id IS NOT NULL THEN
  SELECT product_id INTO NEW.product_id FROM public.product_variants WHERE id=NEW.variant_id;
 END IF;
 IF TG_TABLE_NAME='order_items_draft' THEN
  SELECT order_date,organization_id INTO d,org FROM public.orders_draft WHERE id=NEW.order_id;
 ELSE
  SELECT order_date,organization_id INTO d,org FROM public.orders WHERE id=NEW.order_id;
 END IF;
 IF NEW.organization_id IS DISTINCT FROM org THEN RAISE EXCEPTION 'Item organization mismatch' USING ERRCODE='42501'; END IF;
 IF NEW.product_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.products WHERE id=NEW.product_id AND organization_id=org) THEN
  RAISE EXCEPTION 'HPP product organization mismatch' USING ERRCODE='42501';
 END IF;
 IF NEW.variant_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.product_variants WHERE id=NEW.variant_id AND product_id=NEW.product_id AND organization_id=org) THEN
  RAISE EXCEPTION 'HPP variant mismatch' USING ERRCODE='42501';
 END IF;
 reprice:=NEW.hpp_snapshot IS NULL OR NEW.hpp_pricing_mode='dated';
 IF TG_OP='UPDATE' THEN
  -- Explicit HPP edits opt out; a NULL assignment is the internal/public request to resolve by date.
  IF NEW.hpp_snapshot IS NOT NULL AND NEW.hpp_snapshot IS DISTINCT FROM OLD.hpp_snapshot THEN
   NEW.hpp_pricing_mode:='fixed'; NEW.hpp_price_id:=NULL; reprice:=false;
  ELSIF NEW.hpp_pricing_mode='fixed' THEN NEW.hpp_price_id:=NULL; END IF;
 END IF;
 IF reprice THEN
  IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
   RAISE EXCEPTION 'Dated HPP requires read committed or serializable isolation' USING ERRCODE='40001';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('grandbook.hpp.'||NEW.product_id,0));
  -- Simple products use the parent price; real variants retain their own price history.
  SELECT CASE WHEN has_variants THEN NEW.variant_id ELSE NULL END INTO v FROM public.products WHERE id=NEW.product_id;
  SELECT * INTO rate FROM public.hpp_price_history h WHERE h.product_id=NEW.product_id
    AND h.organization_id=org AND h.variant_id IS NOT DISTINCT FROM v AND h.effective_from<=d
    ORDER BY h.effective_from DESC,h.id DESC LIMIT 1;
  NEW.hpp_snapshot:=rate.hpp; NEW.hpp_price_id:=rate.id; NEW.hpp_pricing_mode:='dated';
 ELSE NEW.hpp_price_id:=NULL;
 END IF;
 IF NEW.packing_fee_snapshot IS NULL AND NEW.product_id IS NOT NULL THEN
  SELECT coalesce(packing_fee,0) INTO NEW.packing_fee_snapshot FROM public.products WHERE id=NEW.product_id;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.capture_effective_hpp()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
DECLARE pid bigint; vid bigint; day date := (statement_timestamp() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
 IF TG_OP='UPDATE' AND NEW.hpp IS NOT DISTINCT FROM OLD.hpp THEN RETURN NEW; END IF;
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
  RAISE EXCEPTION 'HPP updates require read committed or serializable isolation' USING ERRCODE='40001';
 END IF;
 IF TG_TABLE_NAME='products' THEN pid:=NEW.id; vid:=NULL; ELSE pid:=NEW.product_id;vid:=NEW.id;END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook.hpp.'||pid,0));
 INSERT INTO public.hpp_price_history(organization_id,product_id,variant_id,effective_from,hpp)
 VALUES(NEW.organization_id,pid,vid,day,NEW.hpp);
 -- Re-resolve the exact dated cohort, including already-created same-day/future orders.
 -- Fixed/manual/legacy costs and every earlier business day remain unchanged.
 UPDATE public.order_items i SET hpp_snapshot=NULL FROM public.orders o,public.products p
 WHERE o.id=i.order_id AND p.id=i.product_id AND i.product_id=pid AND i.hpp_pricing_mode='dated'
   AND o.organization_id=NEW.organization_id AND o.order_date>=day
   AND ((vid IS NULL AND (NOT p.has_variants OR i.variant_id IS NULL)) OR (p.has_variants AND i.variant_id=vid));
 UPDATE public.order_items_draft i SET hpp_snapshot=NULL FROM public.orders_draft o,public.products p
 WHERE o.id=i.order_id AND p.id=i.product_id AND i.product_id=pid AND i.hpp_pricing_mode='dated'
   AND o.organization_id=NEW.organization_id AND o.order_date>=day
   AND ((vid IS NULL AND (NOT p.has_variants OR i.variant_id IS NULL)) OR (p.has_variants AND i.variant_id=vid));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_capture_effective_hpp ON public.products;
CREATE TRIGGER trg_capture_effective_hpp AFTER INSERT OR UPDATE OF hpp ON public.products FOR EACH ROW EXECUTE FUNCTION public.capture_effective_hpp();
DROP TRIGGER IF EXISTS trg_capture_effective_hpp ON public.product_variants;
CREATE TRIGGER trg_capture_effective_hpp AFTER INSERT OR UPDATE OF hpp ON public.product_variants FOR EACH ROW EXECUTE FUNCTION public.capture_effective_hpp();

CREATE OR REPLACE FUNCTION public.refresh_order_dated_hpp()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog' AS $$
BEGIN
 IF NEW.order_date IS NOT DISTINCT FROM OLD.order_date THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='orders_draft' THEN
  UPDATE public.order_items_draft SET hpp_snapshot=NULL WHERE order_id=NEW.id AND hpp_pricing_mode='dated';
 ELSE
  UPDATE public.order_items SET hpp_snapshot=NULL WHERE order_id=NEW.id AND hpp_pricing_mode='dated';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_refresh_order_dated_hpp ON public.orders;
CREATE TRIGGER trg_refresh_order_dated_hpp AFTER UPDATE OF order_date ON public.orders FOR EACH ROW EXECUTE FUNCTION public.refresh_order_dated_hpp();
DROP TRIGGER IF EXISTS trg_refresh_order_dated_hpp ON public.orders_draft;
CREATE TRIGGER trg_refresh_order_dated_hpp AFTER UPDATE OF order_date ON public.orders_draft FOR EACH ROW EXECUTE FUNCTION public.refresh_order_dated_hpp();
REVOKE ALL ON FUNCTION public.capture_effective_hpp(),public.refresh_order_dated_hpp() FROM PUBLIC,anon,authenticated,service_role;
-- Metadata identifying a cost must not recreate commissions either.
-- Cost-only HPP edits preserve commission records. Signature/security/grants unchanged.
CREATE OR REPLACE FUNCTION public.trg_recompute_order_on_items_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Kalau item dihapus DAN parent order sudah gak ada (cascade delete dari
  -- DELETE FROM orders), gak ada yg perlu di-recompute → skip biar gak RAISE.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_id) THEN
    RETURN OLD;
  END IF;

  -- HPP is not an input to commission rules. Preserve commission identities
  -- when only the historical HPP snapshot changes; retain normal cost refresh.
  IF TG_OP <> 'UPDATE' THEN
    PERFORM public.compute_commissions(v_order_id);
  ELSIF (to_jsonb(NEW) - ARRAY['hpp_snapshot','hpp_price_id','hpp_pricing_mode']) IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['hpp_snapshot','hpp_price_id','hpp_pricing_mode']) THEN
    PERFORM public.compute_commissions(v_order_id);
  END IF;
  PERFORM public.compute_order_costs(v_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.promote_draft_on_terminal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_new_order_id BIGINT;
BEGIN
  IF NEW.status IN ('DITERIMA','RETUR','CANCEL')
     AND COALESCE(OLD.status,'') NOT IN ('DITERIMA','RETUR','CANCEL') THEN

    INSERT INTO public.orders(
      organization_id, order_number, external_order_id, resi,
      source_profile_id, channel_id,
      customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip,
      customer_address_detail, customer_address, wilayah_id,
      subtotal, shipping_cost, discount, total, cod_amount,
      estimated_shipping_net, estimated_cod_fee, estimated_ppn,
      estimated_total_cost, estimated_cash_in, estimated_profit,
      shipping_cost_actual, return_shipping_fee, retur_reason,
      tracking_no, tracking_status, delivered_at, returned_at,
      spx_created_at,
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
      attribution_code_raw, attribution_platform, attribution_account_code, attribution_campaign_marker,
      fulfillment_category,
      origin_supplier_id, is_multi_origin, created_by,
      notes, meta, raw_data,
      internal_note, customer_note, reject_reason, cs_attempts,
      last_contact_at, tags,
      order_date, resi_printed_at,
      created_at, updated_at
    )
    VALUES (
      NEW.organization_id, NEW.order_number, NEW.external_order_id,
      COALESCE(NULLIF(TRIM(COALESCE(NEW.resi,'')),''), NEW.tracking_no),
      NEW.source_profile_id, NEW.channel_id,
      NEW.customer_name, NEW.customer_phone, NEW.customer_province, NEW.customer_city,
      NEW.customer_subdistrict, NEW.customer_village, NEW.customer_zip,
      NEW.customer_address_detail, NEW.customer_address, NEW.wilayah_id,
      NEW.subtotal, NEW.shipping_cost, NEW.discount, NEW.total, NEW.cod_amount,
      NEW.estimated_shipping_net, NEW.estimated_cod_fee, NEW.estimated_ppn,
      NEW.estimated_total_cost, NEW.estimated_cash_in, NEW.estimated_profit,
      NEW.actual_shipping_fee, NEW.return_shipping_fee, NEW.retur_reason,
      NEW.tracking_no, NEW.tracking_status, NEW.delivered_at, NEW.returned_at,
      NEW.spx_created_at,
      NEW.payment_method, NEW.status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
      NEW.attribution_code_raw, NEW.attribution_platform, NEW.attribution_account_code, NEW.attribution_campaign_marker,
      NEW.fulfillment_category,
      NEW.origin_supplier_id, NEW.is_multi_origin, NEW.created_by,
      NEW.notes, NEW.meta, NEW.raw_data,
      NEW.internal_note, NEW.customer_note, NEW.reject_reason, NEW.cs_attempts,
      NEW.last_contact_at, NEW.tags,
      NEW.order_date, NEW.resi_printed_at,
      NEW.created_at, NOW()
    )
    RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items(
      organization_id, order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, hpp_price_id, hpp_pricing_mode, packing_fee_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, hpp_price_id, hpp_pricing_mode, packing_fee_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    INSERT INTO public.order_status_history(
      organization_id, order_id, order_number, from_status, to_status,
      changed_at, changed_by, source, raw_status, note
    ) VALUES (
      NEW.organization_id, v_new_order_id, NEW.order_number,
      OLD.status, NEW.status, NOW(), auth.uid(), 'spx_sync',
      NEW.tracking_status, 'Promote terminal via sync SPX'
    );

    PERFORM public.compute_commissions(v_new_order_id);

    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(), 'orders_draft', NEW.id::text, 'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'terminal_status', NEW.status)
    );

    DELETE FROM public.orders_draft WHERE id = NEW.id;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;
