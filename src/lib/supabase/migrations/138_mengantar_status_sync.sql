-- 138 — Sync Status Mengantar/JNE (mirror apply_spx_status_sync mig 092).
-- Order Mengantar UDAH ADA di orders_draft (resi NULL). Nomor GB gak balik di
-- export Mengantar → match by HP (9 digit terakhir) + PRODUK (buat pilah
-- customer repeat). Set tracking_no (BUKAN resi, biar gak promote) + status +
-- channel→JNE(2) + ongkir aktual. NEVER bikin order, NEVER sentuh customer/produk.
-- Pola preview/apply (stage di reconciliation_batches). Idempotent. INVOKER.

-- ===== preview_mengantar_status_sync =====
DROP FUNCTION IF EXISTS public.preview_mengantar_status_sync(jsonb, text, int);

CREATE OR REPLACE FUNCTION public.preview_mengantar_status_sync(
  p_rows jsonb, p_file_name text DEFAULT NULL, p_file_size_bytes int DEFAULT NULL
)
RETURNS TABLE(
  batch_id bigint, total_rows int, matched int, ambiguous int, unmatched int,
  status_changes int, preview_data jsonb
)
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint; v_batch bigint; v_total int;
  v_matched int := 0; v_ambig int := 0; v_unmatch int := 0; v_changes int := 0;
  v_mrows jsonb := '[]'::jsonb; v_arows jsonb := '[]'::jsonb; v_urows jsonb := '[]'::jsonb;
  v_payload jsonb; v_row jsonb; v_p9 text; v_clean text; v_internal text;
  v_pid bigint; v_n int; v_n2 int; v_oid bigint; v_old text; v_onum text;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  v_total := COALESCE(jsonb_array_length(p_rows), 0);

  INSERT INTO public.reconciliation_batches (organization_id, channel_id, profile_id,
    uploaded_by, uploaded_at, file_name, file_size_bytes, total_rows, status)
  VALUES (v_org, 2, NULL, auth.uid(), NOW(), p_file_name, p_file_size_bytes, v_total, 'PREVIEW')
  RETURNING id INTO v_batch;

  FOR v_row IN SELECT jsonb_array_elements(p_rows) LOOP
    v_p9 := right(regexp_replace(COALESCE(v_row->>'customer_phone',''), '\D', '', 'g'), 9);
    v_clean := NULLIF(TRIM(v_row->>'product_clean'), '');
    v_internal := NULLIF(v_row->>'internal_status', '');
    IF v_p9 = '' OR length(v_p9) < 7 THEN
      v_unmatch := v_unmatch + 1;
      v_urows := v_urows || jsonb_build_array(jsonb_build_object('resi', v_row->>'resi',
        'customer_name', v_row->>'customer_name', 'reason', 'no_phone'));
      CONTINUE;
    END IF;

    -- resolve product_id (prefix / 2 kata pertama)
    v_pid := NULL;
    IF v_clean IS NOT NULL THEN
      SELECT p.id INTO v_pid FROM public.products p
      WHERE p.organization_id = v_org AND p.active AND (
        lower(v_clean) LIKE lower(p.name) || '%'
        OR (lower(split_part(v_clean,' ',1)) = lower(split_part(p.name,' ',1))
            AND split_part(p.name,' ',2) <> ''
            AND lower(split_part(v_clean,' ',2)) = lower(split_part(p.name,' ',2))))
      ORDER BY (lower(v_clean) LIKE lower(p.name)||'%') DESC, length(p.name) DESC LIMIT 1;
    END IF;

    -- match draft (resi NULL) by HP
    SELECT count(*) INTO v_n FROM public.orders_draft d
    WHERE d.organization_id = v_org AND d.resi IS NULL
      AND right(regexp_replace(COALESCE(d.customer_phone,''),'\D','','g'),9) = v_p9;

    v_oid := NULL;
    IF v_n = 1 THEN
      SELECT id, status, order_number INTO v_oid, v_old, v_onum FROM public.orders_draft d
      WHERE d.organization_id = v_org AND d.resi IS NULL
        AND right(regexp_replace(COALESCE(d.customer_phone,''),'\D','','g'),9) = v_p9;
    ELSIF v_n > 1 AND v_pid IS NOT NULL THEN
      -- pilah by produk
      SELECT count(*) INTO v_n2 FROM public.orders_draft d
      WHERE d.organization_id = v_org AND d.resi IS NULL
        AND right(regexp_replace(COALESCE(d.customer_phone,''),'\D','','g'),9) = v_p9
        AND EXISTS (SELECT 1 FROM public.order_items_draft oi WHERE oi.order_id = d.id AND oi.product_id = v_pid);
      IF v_n2 = 1 THEN
        SELECT id, status, order_number INTO v_oid, v_old, v_onum FROM public.orders_draft d
        WHERE d.organization_id = v_org AND d.resi IS NULL
          AND right(regexp_replace(COALESCE(d.customer_phone,''),'\D','','g'),9) = v_p9
          AND EXISTS (SELECT 1 FROM public.order_items_draft oi WHERE oi.order_id = d.id AND oi.product_id = v_pid);
      END IF;
    END IF;

    IF v_oid IS NOT NULL THEN
      v_matched := v_matched + 1;
      IF v_internal IS NOT NULL AND v_old IS DISTINCT FROM v_internal THEN v_changes := v_changes + 1; END IF;
      v_mrows := v_mrows || jsonb_build_array(jsonb_build_object(
        'order_id', v_oid, 'order_number', v_onum, 'customer_name', v_row->>'customer_name',
        'resi', v_row->>'resi', 'old_status', v_old, 'new_status', COALESCE(v_internal, v_old),
        'last_status', v_row->>'last_status', 'shipping_net', (v_row->>'shipping_net')::numeric));
    ELSIF v_n > 1 THEN
      v_ambig := v_ambig + 1;
      v_arows := v_arows || jsonb_build_array(jsonb_build_object('resi', v_row->>'resi',
        'customer_name', v_row->>'customer_name', 'phone9', v_p9, 'n', v_n));
    ELSE
      v_unmatch := v_unmatch + 1;
      v_urows := v_urows || jsonb_build_array(jsonb_build_object('resi', v_row->>'resi',
        'customer_name', v_row->>'customer_name', 'phone9', v_p9, 'reason', 'no_draft'));
    END IF;
  END LOOP;

  v_payload := jsonb_build_object('matched', v_mrows, 'ambiguous', v_arows, 'unmatched', v_urows);
  UPDATE public.reconciliation_batches SET matched_count = v_matched, variance_count = v_ambig,
    unmatched_count = v_unmatch, preview_payload = v_payload WHERE id = v_batch;

  RETURN QUERY SELECT v_batch, v_total, v_matched, v_ambig, v_unmatch, v_changes, v_payload;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.preview_mengantar_status_sync(jsonb, text, int) TO authenticated;

-- ===== apply_mengantar_status_sync =====
DROP FUNCTION IF EXISTS public.apply_mengantar_status_sync(bigint);

CREATE OR REPLACE FUNCTION public.apply_mengantar_status_sync(p_batch_id bigint)
RETURNS TABLE(batch_id bigint, status text, updated int, applied_at timestamptz)
LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org bigint; v_batch record; v_row jsonb; v_updated int := 0; v_new text;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  PERFORM set_config('grandbook.bypass_actual_check', 'true', true);

  SELECT * INTO v_batch FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % tidak ketemu', p_batch_id; END IF;
  IF v_batch.status = 'APPLIED' THEN RAISE EXCEPTION 'Batch % sudah APPLIED', p_batch_id; END IF;
  IF v_batch.status = 'CANCELLED' THEN RAISE EXCEPTION 'Batch % sudah CANCELLED', p_batch_id; END IF;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_batch.preview_payload->'matched', '[]'::jsonb)) LOOP
    v_new := v_row->>'new_status';
    UPDATE public.orders_draft SET
      tracking_no = COALESCE(NULLIF(btrim(COALESCE(v_row->>'resi','')),''), tracking_no),
      tracking_status = COALESCE(NULLIF(btrim(COALESCE(v_row->>'last_status','')),''), tracking_status),
      status = COALESCE(v_new, status),
      channel_id = 2,
      actual_shipping_fee = COALESCE((NULLIF(btrim(COALESCE(v_row->>'shipping_net','')),''))::numeric, actual_shipping_fee),
      delivered_at = CASE WHEN v_new = 'DITERIMA' THEN COALESCE(delivered_at, now()) ELSE delivered_at END,
      returned_at = CASE WHEN v_new = 'RETUR' THEN COALESCE(returned_at, now()) ELSE returned_at END,
      tracking_synced_at = now()
    WHERE id = (v_row->>'order_id')::bigint AND organization_id = v_org;
    v_updated := v_updated + 1;
  END LOOP;

  UPDATE public.reconciliation_batches SET status = 'APPLIED', applied_at = NOW(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT p_batch_id, 'APPLIED'::text, v_updated, NOW();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_mengantar_status_sync(bigint) TO authenticated;
