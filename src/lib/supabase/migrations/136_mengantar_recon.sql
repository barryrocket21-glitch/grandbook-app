-- 136 — Rekonsiliasi Mengantar (JNE via Mengantar, channel id 2).
-- Sync status + keuangan dari export Order Mengantar. Pola 2-RPC preview/apply
-- (mirror SPX mig 047). Parser TS (mengantar-parser.ts) udah strip resi, map
-- status (8-state), turunin shipping_net & payout → kirim rows bersih ke sini.
-- Match by resi. Apply: UPDATE status + shipping_cost_actual + payout (bypass
-- block-trigger admin via set_config). Unmatched → inbox_unmatched_resi.
-- Idempotent. SECURITY INVOKER, scoped current_org_id() + RLS.

-- ===== preview_mengantar_recon =====
DROP FUNCTION IF EXISTS public.preview_mengantar_recon(jsonb, text, int);

CREATE OR REPLACE FUNCTION public.preview_mengantar_recon(
  p_rows jsonb,
  p_file_name text DEFAULT NULL,
  p_file_size_bytes int DEFAULT NULL
)
RETURNS TABLE(
  batch_id bigint, total_rows int, matched_count int, unmatched_count int,
  unmapped_count int, status_change_count int, total_payout numeric, preview_data jsonb
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint; v_batch bigint; v_total int;
  v_matched_count int := 0; v_unmatched_count int := 0; v_unmapped_count int := 0;
  v_status_change int := 0; v_total_payout numeric := 0;
  v_matched jsonb := '[]'::jsonb; v_unmatched jsonb := '[]'::jsonb; v_unmapped jsonb := '[]'::jsonb;
  v_payload jsonb; v_row jsonb; v_resi text; v_internal text; v_payout numeric; v_o record;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;
  v_total := COALESCE(jsonb_array_length(p_rows), 0);

  INSERT INTO public.reconciliation_batches (
    organization_id, channel_id, profile_id, uploaded_by, uploaded_at,
    file_name, file_size_bytes, total_rows, status
  ) VALUES (v_org, 2, NULL, auth.uid(), NOW(), p_file_name, p_file_size_bytes, v_total, 'PREVIEW')
  RETURNING id INTO v_batch;

  FOR v_row IN SELECT jsonb_array_elements(p_rows) LOOP
    v_resi := NULLIF(TRIM(v_row->>'resi'), '');
    v_internal := NULLIF(v_row->>'internal_status', '');
    v_payout := (v_row->>'payout')::numeric;

    IF v_resi IS NULL THEN
      v_unmatched_count := v_unmatched_count + 1;
      v_unmatched := v_unmatched || jsonb_build_array(v_row || jsonb_build_object('reason','empty_resi'));
      CONTINUE;
    END IF;

    SELECT id, order_number, customer_name, status, payout_amount INTO v_o
    FROM public.orders WHERE resi = v_resi AND organization_id = v_org;

    IF NOT FOUND THEN
      v_unmatched_count := v_unmatched_count + 1;
      v_unmatched := v_unmatched || jsonb_build_array(v_row || jsonb_build_object('reason','no_order'));
    ELSIF v_internal IS NULL THEN
      v_unmapped_count := v_unmapped_count + 1;
      v_unmapped := v_unmapped || jsonb_build_array(jsonb_build_object(
        'resi', v_resi, 'order_number', v_o.order_number, 'customer_name', v_o.customer_name,
        'last_status', v_row->>'last_status'));
    ELSE
      v_matched_count := v_matched_count + 1;
      IF v_o.status IS DISTINCT FROM v_internal THEN v_status_change := v_status_change + 1; END IF;
      IF v_payout IS NOT NULL THEN v_total_payout := v_total_payout + v_payout; END IF;
      v_matched := v_matched || jsonb_build_array(jsonb_build_object(
        'resi', v_resi, 'order_id', v_o.id, 'order_number', v_o.order_number,
        'customer_name', v_o.customer_name, 'last_status', v_row->>'last_status',
        'old_status', v_o.status, 'new_status', v_internal,
        'old_payout', v_o.payout_amount, 'new_payout', v_payout,
        'shipping_net', (v_row->>'shipping_net')::numeric, 'cod', (v_row->>'cod')::numeric));
    END IF;
  END LOOP;

  v_payload := jsonb_build_object('matched', v_matched, 'unmatched', v_unmatched, 'unmapped', v_unmapped);

  UPDATE public.reconciliation_batches
  SET matched_count = v_matched_count, unmatched_count = v_unmatched_count,
      variance_count = v_unmapped_count, total_payout_applied = v_total_payout,
      preview_payload = v_payload
  WHERE id = v_batch;

  RETURN QUERY SELECT v_batch, v_total, v_matched_count, v_unmatched_count,
    v_unmapped_count, v_status_change, v_total_payout, v_payload;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.preview_mengantar_recon(jsonb, text, int) TO authenticated;

-- ===== apply_mengantar_recon =====
DROP FUNCTION IF EXISTS public.apply_mengantar_recon(bigint);

CREATE OR REPLACE FUNCTION public.apply_mengantar_recon(p_batch_id bigint)
RETURNS TABLE(
  batch_id bigint, status text, matched_updated int, unmatched_logged int, applied_at timestamptz
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org bigint; v_batch record; v_payload jsonb; v_row jsonb;
  v_matched int := 0; v_unmatched int := 0; v_resi text;
BEGIN
  v_org := public.current_org_id();
  IF v_org IS NULL THEN RAISE EXCEPTION 'No organization context'; END IF;

  -- bypass block-trigger admin/akunting utk update payout/shipping_actual
  PERFORM set_config('grandbook.bypass_actual_check', 'true', true);

  SELECT * INTO v_batch FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Batch % tidak ketemu', p_batch_id; END IF;
  IF v_batch.status = 'APPLIED' THEN RAISE EXCEPTION 'Batch % sudah APPLIED', p_batch_id; END IF;
  IF v_batch.status = 'CANCELLED' THEN RAISE EXCEPTION 'Batch % sudah CANCELLED', p_batch_id; END IF;

  v_payload := v_batch.preview_payload;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_payload->'matched', '[]'::jsonb)) LOOP
    UPDATE public.orders SET
      status = v_row->>'new_status',
      shipping_cost_actual = (v_row->>'shipping_net')::numeric,
      payout_amount = COALESCE((v_row->>'new_payout')::numeric, payout_amount)
    WHERE id = (v_row->>'order_id')::bigint AND organization_id = v_org;
    v_matched := v_matched + 1;
  END LOOP;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_payload->'unmatched', '[]'::jsonb)) LOOP
    v_resi := COALESCE(v_row->>'resi', '');
    IF v_resi <> '' THEN
      INSERT INTO public.inbox_unmatched_resi (organization_id, source_profile_id, raw_resi, raw_data)
      VALUES (v_org, NULL, v_resi, v_row) ON CONFLICT DO NOTHING;
      v_unmatched := v_unmatched + 1;
    END IF;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED', applied_at = NOW(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT p_batch_id, 'APPLIED'::text, v_matched, v_unmatched, NOW();
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_mengantar_recon(bigint) TO authenticated;
