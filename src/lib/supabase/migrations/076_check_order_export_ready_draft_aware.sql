-- 076 — Phase 8H follow-up: check_order_export_ready aware of orders_draft.
-- Applied via Supabase MCP (apply_migration: check_order_export_ready_draft_aware
-- and check_order_export_ready_relaxed_address).
--
-- Post Phase 8H, fresh orders (WA paste / input baru / bulk upload) live in
-- orders_draft until resi keisi. RPC ini dulu cuma query `orders` → return
-- 'order_not_found' untuk semua draft → /orders/export-resi gak bisa lanjut
-- past preview step. Sekarang cek orders_draft dulu (most common post-8H),
-- fallback ke orders untuk legacy/re-export.
--
-- Plus: address requirement di-relax. WA paste isi customer_address_detail
-- (free-form) tapi kolom struktural kota/kecamatan/zip null. Kurir cuma
-- butuh teks alamat di label, jadi gate accept order kalau EITHER:
--   - customer_address_detail >=10 chars (substantial freeform), OR
--   - province + city + subdistrict semua keisi (Orderonline-style).

CREATE OR REPLACE FUNCTION public.check_order_export_ready(p_order_id bigint)
RETURNS TABLE(is_ready boolean, missing_fields text[])
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_order   RECORD;
  v_has_detail BOOLEAN;
  v_has_structured BOOLEAN;
BEGIN
  SELECT * INTO v_order FROM public.orders_draft WHERE id = p_order_id;
  IF NOT FOUND THEN
    SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
    IF NOT FOUND THEN
      RETURN QUERY SELECT FALSE, ARRAY['order_not_found']::TEXT[];
      RETURN;
    END IF;
  END IF;

  v_has_detail := v_order.customer_address_detail IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_address_detail)) >= 10;
  v_has_structured := v_order.customer_province IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_province)) > 0
    AND v_order.customer_city IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_city)) > 0
    AND v_order.customer_subdistrict IS NOT NULL
    AND LENGTH(TRIM(v_order.customer_subdistrict)) > 0;

  IF NOT (v_has_detail OR v_has_structured) THEN
    v_missing := array_append(v_missing, 'customer_address');
  END IF;

  IF v_order.channel_id IS NULL THEN
    v_missing := array_append(v_missing, 'channel_id');
  END IF;

  RETURN QUERY SELECT (array_length(v_missing, 1) IS NULL), v_missing;
END;
$function$;
