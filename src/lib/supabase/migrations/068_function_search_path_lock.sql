-- =============================================================
-- Audit cleanup — lock search_path on 10 legacy functions
-- Migration 068 — 2026-05-23
-- =============================================================
-- Supabase advisor flagged 10 functions tanpa `SET search_path TO 'public'`.
-- Tanpa lock, function bisa di-hijack via SET search_path attack (e.g. user
-- create schema dengan function override yang shadow built-in). Pattern fix:
-- CREATE OR REPLACE dengan SET search_path TO 'public' added. Body preserved
-- verbatim dari production state (via pg_get_functiondef).
--
-- Functions affected (10):
--   1.  audit_log_trigger()                — generic audit trigger (active on expenses)
--   2.  backfill_spx_batch(jsonb)          — one-off Phase 8H backfill SPX Mei
--   3.  check_campaign_allocation_total()  — trigger campaign_products (<=100% guard)
--   4.  current_org_id()                   — CORE RLS helper (most critical lock)
--   5.  exec_sql(text)                     — migration tooling (SECURITY DEFINER)
--   6.  fill_variant_org_id()              — trigger product_variants
--   7.  generate_order_number()            — LEGACY no-arg (active = org_id variant)
--   8.  get_user_role()                    — CORE RLS helper
--   9.  set_updated_at()                   — trigger pada 14 tables
--   10. update_updated_at()                — legacy unused (kept for backward compat)
--
-- Result: advisor function_search_path_mutable count 10 -> 0 (verified post-apply).
-- Idempotent: CREATE OR REPLACE preserves body. Tidak ada behavior change runtime.
-- =============================================================

CREATE OR REPLACE FUNCTION public.audit_log_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  action_name TEXT;
  old_data JSONB;
  new_data JSONB;
BEGIN
  action_name := TG_OP;

  IF (TG_OP = 'DELETE') THEN
    old_data := to_jsonb(OLD);
    new_data := NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
  ELSIF (TG_OP = 'INSERT') THEN
    old_data := NULL;
    new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO public.audit_log (user_id, table_name, record_id, action, old_value, new_value)
  VALUES (auth.uid(), TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::TEXT, action_name, old_data, new_data);

  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.backfill_spx_batch(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_orders_count INT;
  v_items_count INT;
  v_history_count INT;
BEGIN
  WITH inserted_orders AS (
    INSERT INTO public.orders (
      organization_id, order_number, resi, channel_id, origin_supplier_id,
      customer_name, customer_phone,
      customer_province, customer_city, customer_subdistrict, customer_zip,
      customer_address_detail,
      subtotal, estimated_shipping_net, shipping_cost_actual,
      total, cod_amount,
      payment_method, status, order_date,
      resi_printed_at, picked_up_at,
      created_by, meta
    )
    SELECT
      1, e->>'o', e->>'r', 1, (e->>'sp')::bigint,
      e->>'cn', e->>'cp',
      e->>'pr', e->>'ci', e->>'sd', e->>'zp',
      e->>'ad',
      (e->>'sb')::numeric, (e->>'es')::numeric, (e->>'sa')::numeric,
      (e->>'tt')::numeric, (e->>'co')::numeric,
      e->>'pm', e->>'st', (e->>'od')::date,
      (e->>'rp')::timestamptz, (e->>'pu')::timestamptz,
      'f8726f49-5d7b-4029-9ad0-2f414dd96717',
      jsonb_build_object(
        'backfill_source', 'spx_pelacakan_mei2026',
        'adv_source_inferred', e->>'adv',
        'spx_tracking_status', e->>'sts'
      )
    FROM jsonb_array_elements(payload->'orders') AS e
    RETURNING id, order_number
  ),
  inserted_items AS (
    INSERT INTO public.order_items (
      order_id, organization_id, product_id, variant_id,
      product_name_raw, qty, price, hpp_snapshot, weight_per_unit
    )
    SELECT
      io.id, 1, (e->>'pid')::bigint,
      CASE WHEN e->>'vid' IS NULL THEN NULL ELSE (e->>'vid')::bigint END,
      e->>'pn', (e->>'q')::int,
      (e->>'pr')::numeric, (e->>'hp')::numeric, (e->>'w')::numeric
    FROM jsonb_array_elements(payload->'items') AS e
    JOIN inserted_orders io ON io.order_number = e->>'o'
    RETURNING id
  ),
  inserted_history AS (
    INSERT INTO public.order_status_history (
      order_id, organization_id, from_status, to_status, changed_at, source
    )
    SELECT
      io.id, 1, NULL, e->>'st',
      (e->>'ch')::timestamptz, 'system'
    FROM jsonb_array_elements(payload->'history') AS e
    JOIN inserted_orders io ON io.order_number = e->>'o'
    RETURNING id
  )
  SELECT
    (SELECT COUNT(*) FROM inserted_orders),
    (SELECT COUNT(*) FROM inserted_items),
    (SELECT COUNT(*) FROM inserted_history)
  INTO v_orders_count, v_items_count, v_history_count;

  RETURN jsonb_build_object(
    'orders', v_orders_count,
    'items', v_items_count,
    'history', v_history_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.check_campaign_allocation_total()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_total NUMERIC;
  v_campaign BIGINT;
BEGIN
  v_campaign := COALESCE(NEW.campaign_id, OLD.campaign_id);
  SELECT COALESCE(SUM(allocation_pct), 0) INTO v_total
  FROM public.campaign_products
  WHERE campaign_id = v_campaign
    AND id <> COALESCE(NEW.id, -1);
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_total := v_total + NEW.allocation_pct;
  END IF;
  IF v_total > 100.00 THEN
    RAISE EXCEPTION 'Total allocation_pct campaign % melebihi 100%% (current sum would be %)',
      v_campaign, v_total
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS bigint
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.exec_sql(sql text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE sql;
  RETURN 'ok';
END $function$;

CREATE OR REPLACE FUNCTION public.fill_variant_org_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.products WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE today_count INT; order_num TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO today_count FROM public.orders WHERE order_date = CURRENT_DATE;
  order_num := 'ORD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(today_count::TEXT, 4, '0');
  RETURN order_num;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END $function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$function$;
