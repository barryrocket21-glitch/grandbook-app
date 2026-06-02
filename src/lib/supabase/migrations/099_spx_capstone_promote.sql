-- 099 — Brief #13 Capstone: re-time promote (status-terminal) + EST→aktual +
-- komisi aktual (tutup FLAG #12) + history transisi + CPA final.
-- ============================================================================
-- KEPUTUSAN Barry (PART 1): order TETAP di orders_draft (post-export / satu
-- tampilan) sepanjang siklus kirim. Promote ke `orders` HANYA pas TERMINAL:
--   DITERIMA → Arsip ; RETUR → zona retur.
-- Pemicu promote dicabut dari "resi-set" → diganti "status jadi terminal".
-- Idempotent. apply_spx_status_sync (mig 092) di-reuse — ini nambah wiring.

-- ── PART 4/7: kolom aktual + tracking + retur di `orders` (terminal) ─────────
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS return_shipping_fee NUMERIC;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS retur_reason TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_no TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS tracking_status TEXT;
-- (shipping_cost_actual sudah ada sejak Phase 4D/8I → dipakai sebagai ongkir aktual)

-- ── PART 3: order_status_history bisa log transisi draft (belum punya orders.id)
ALTER TABLE public.order_status_history ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE public.order_status_history ADD COLUMN IF NOT EXISTS order_number TEXT;
-- izinin source 'spx_sync'
ALTER TABLE public.order_status_history DROP CONSTRAINT IF EXISTS order_status_history_source_check;
ALTER TABLE public.order_status_history ADD CONSTRAINT order_status_history_source_check
  CHECK (source = ANY (ARRAY['manual','converter_inbound','converter_rekonsil',
    'outbound_export','wa_paste','admin_review','system','spx_sync']));

-- ── PART 1: cabut promote dari "resi-set" ───────────────────────────────────
DROP TRIGGER IF EXISTS trg_promote_draft_to_orders ON public.orders_draft;

-- ── PART 1+4+5+7: promote pas status jadi TERMINAL (DITERIMA/RETUR) ──────────
CREATE OR REPLACE FUNCTION public.promote_draft_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_order_id BIGINT;
BEGIN
  -- gate: jadi terminal, dari state non-terminal (anti dobel)
  -- TERMINAL = DITERIMA (arsip) / RETUR (retur) / CANCEL (batal).
  -- Ketiganya tetap nongol di master view Pembukuan (union) sbg status masing2.
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
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
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
      NEW.payment_method, NEW.status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
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
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    -- PART 3: log transisi terminal (referensi orders.id baru)
    INSERT INTO public.order_status_history(
      organization_id, order_id, order_number, from_status, to_status,
      changed_at, changed_by, source, raw_status, note
    ) VALUES (
      NEW.organization_id, v_new_order_id, NEW.order_number,
      OLD.status, NEW.status, NOW(), auth.uid(), 'spx_sync',
      NEW.tracking_status, 'Promote terminal via sync SPX'
    );

    -- PART 5: komisi aktual (FK orders valid sekarang → tutup FLAG #12).
    -- compute_commissions: DITERIMA+cs → EARNED ; RETUR → VOIDED.
    PERFORM public.compute_commissions(v_new_order_id);

    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(), 'orders_draft', NEW.id::text, 'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'terminal_status', NEW.status)
    );

    DELETE FROM public.orders_draft WHERE id = NEW.id;
    RETURN NULL;  -- batalin update di draft (row udah pindah)
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_draft_on_terminal ON public.orders_draft;
CREATE TRIGGER trg_promote_draft_on_terminal
  BEFORE UPDATE OF status ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.promote_draft_on_terminal();
-- trigger func gak perlu dipanggil langsung → REVOKE (advisor: no SECURITY DEFINER exec)
REVOKE EXECUTE ON FUNCTION public.promote_draft_on_terminal() FROM PUBLIC, anon, authenticated;
-- buang fungsi promote lama (resi-set) yang udah yatim (trigger-nya udah di-drop)
DROP FUNCTION IF EXISTS public.promote_draft_to_orders();

-- ── PART 3: apply_spx_status_sync log transisi NON-terminal ke history ───────
-- (transisi terminal di-log oleh promote trigger di atas). Re-create dgn logging.
CREATE OR REPLACE FUNCTION public.apply_spx_status_sync(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_org BIGINT; r JSONB; v_ref TEXT; v_oid BIGINT;
  v_cur_status TEXT; v_mapped TEXT;
  c_matched INT := 0; c_updated INT := 0; c_no_ref INT := 0; c_no_match INT := 0;
BEGIN
  v_org := public.current_org_id();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('matched',0,'updated',0,'skipped_no_ref',0,'skipped_no_match',0);
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value)
  LOOP
    v_ref := btrim(COALESCE(r->>'ref',''));
    IF v_ref = '' OR v_ref NOT LIKE 'GB-%' THEN
      c_no_ref := c_no_ref + 1; CONTINUE;
    END IF;

    SELECT id, status INTO v_oid, v_cur_status
    FROM public.orders_draft WHERE order_number = v_ref AND organization_id = v_org;

    IF v_oid IS NULL THEN
      c_no_match := c_no_match + 1; CONTINUE;
    END IF;
    c_matched := c_matched + 1;

    v_mapped := NULL;
    IF COALESCE(r->>'tracking_status','') <> '' THEN
      SELECT internal_status INTO v_mapped
      FROM public.courier_channel_statuses
      WHERE channel_id = 1 AND lower(raw_status) = lower(btrim(r->>'tracking_status'))
      LIMIT 1;
    END IF;

    -- PART 3: log transisi NON-terminal (terminal di-handle promote trigger).
    -- best-effort — gagal log gak boleh batalin sync.
    IF v_mapped IS NOT NULL AND v_mapped IS DISTINCT FROM v_cur_status
       AND v_mapped NOT IN ('DITERIMA','RETUR') THEN
      BEGIN
        INSERT INTO public.order_status_history(
          organization_id, order_id, order_number, from_status, to_status,
          changed_at, changed_by, source, raw_status, note
        ) VALUES (
          v_org, NULL, v_ref, v_cur_status, v_mapped, now(), auth.uid(),
          'spx_sync', btrim(r->>'tracking_status'), 'Transisi via sync SPX'
        );
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;

    UPDATE public.orders_draft SET
      tracking_no         = COALESCE(NULLIF(btrim(COALESCE(r->>'tracking_no','')),''), tracking_no),
      tracking_status     = COALESCE(NULLIF(btrim(COALESCE(r->>'tracking_status','')),''), tracking_status),
      status              = COALESCE(v_mapped, status),
      actual_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'actual_fee','')),''))::numeric, actual_shipping_fee),
      return_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(r->>'return_fee','')),''))::numeric, return_shipping_fee),
      delivered_at        = CASE WHEN v_mapped = 'DITERIMA'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, delivered_at, now())
                                 ELSE delivered_at END,
      returned_at         = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE((NULLIF(btrim(COALESCE(r->>'delivered_at','')),''))::timestamptz, returned_at, now())
                                 ELSE returned_at END,
      retur_reason        = CASE WHEN v_mapped = 'RETUR'
                                 THEN COALESCE(NULLIF(btrim(COALESCE(r->>'retur_reason','')),''), retur_reason)
                                 ELSE retur_reason END,
      tracking_synced_at  = now()
    WHERE id = v_oid;
    c_updated := c_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('matched',c_matched,'updated',c_updated,
    'skipped_no_ref',c_no_ref,'skipped_no_match',c_no_match);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_spx_status_sync(jsonb) TO authenticated;

-- ── PART 6: CPA final = spend ÷ order DELIVERED (orders.status='DITERIMA') ───
DROP FUNCTION IF EXISTS public.campaign_performance(date, date);
CREATE OR REPLACE FUNCTION public.campaign_performance(
  p_from DATE DEFAULT NULL, p_to DATE DEFAULT NULL
)
RETURNS TABLE(
  campaign_id BIGINT, campaign_name TEXT, platform TEXT,
  spend_total NUMERIC, leads BIGINT, attributed_orders BIGINT,
  delivered_orders BIGINT, cpr NUMERIC, cpa NUMERIC, cpa_final NUMERIC
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH sp AS (
    SELECT a.campaign_id AS cid,
           COALESCE(SUM(COALESCE(a.spend_total, a.spend)),0)::NUMERIC AS spend_total,
           COALESCE(SUM(COALESCE(a.meta_lead_count,0)),0)::BIGINT AS leads
    FROM public.ad_spend a
    JOIN public.campaigns c ON c.id = a.campaign_id
    WHERE c.organization_id = v_org
      AND (p_from IS NULL OR a.spend_date >= p_from)
      AND (p_to IS NULL OR a.spend_date <= p_to)
    GROUP BY a.campaign_id
  ),
  -- gross ter-atribusi = in-flight (draft) + terminal (orders)
  ord AS (
    SELECT cid, SUM(cnt)::BIGINT AS cnt FROM (
      SELECT campaign_id AS cid, COUNT(*) AS cnt FROM public.orders_draft
        WHERE organization_id = v_org AND campaign_id IS NOT NULL
          AND (p_from IS NULL OR order_date >= p_from) AND (p_to IS NULL OR order_date <= p_to)
        GROUP BY campaign_id
      UNION ALL
      SELECT campaign_id AS cid, COUNT(*) AS cnt FROM public.orders
        WHERE organization_id = v_org AND campaign_id IS NOT NULL
          AND (p_from IS NULL OR order_date >= p_from) AND (p_to IS NULL OR order_date <= p_to)
        GROUP BY campaign_id
    ) u GROUP BY cid
  ),
  -- delivered (final) = orders terminal DITERIMA
  deliv AS (
    SELECT campaign_id AS cid, COUNT(*)::BIGINT AS cnt FROM public.orders
      WHERE organization_id = v_org AND campaign_id IS NOT NULL AND status = 'DITERIMA'
        AND (p_from IS NULL OR order_date >= p_from) AND (p_to IS NULL OR order_date <= p_to)
      GROUP BY campaign_id
  )
  SELECT c.id, c.campaign_name, c.platform,
    COALESCE(sp.spend_total,0)::NUMERIC,
    COALESCE(sp.leads,0)::BIGINT,
    COALESCE(ord.cnt,0)::BIGINT,
    COALESCE(deliv.cnt,0)::BIGINT,
    CASE WHEN COALESCE(sp.leads,0)>0 THEN ROUND(sp.spend_total/sp.leads,0) ELSE NULL END,
    CASE WHEN COALESCE(ord.cnt,0)>0 THEN ROUND(sp.spend_total/ord.cnt,0) ELSE NULL END,
    CASE WHEN COALESCE(deliv.cnt,0)>0 THEN ROUND(sp.spend_total/deliv.cnt,0) ELSE NULL END
  FROM public.campaigns c
  LEFT JOIN sp ON sp.cid = c.id
  LEFT JOIN ord ON ord.cid = c.id
  LEFT JOIN deliv ON deliv.cid = c.id
  WHERE c.organization_id = v_org AND (sp.cid IS NOT NULL OR ord.cid IS NOT NULL)
  ORDER BY COALESCE(sp.spend_total,0) DESC;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.campaign_performance(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.campaign_performance(date, date) TO authenticated;
