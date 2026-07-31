-- 142 — SPX Cashflow Apply Integrity
-- ============================================================================
-- Owner-safe hardening for Account Transaction List apply:
-- - match orders by resi OR tracking_no
-- - count only rows actually updated/inserted via ROW_COUNT
-- - flip commissions EARNED -> PAID after COD is settled
-- - keep PREVIEW manual approval flow; this migration does not apply any batch

DROP FUNCTION IF EXISTS public.apply_spx_cashflow_recon(bigint);

CREATE OR REPLACE FUNCTION public.apply_spx_cashflow_recon(p_batch_id bigint)
RETURNS TABLE(
  batch_id bigint,
  cod_updated integer,
  withdrawals_created integer,
  unmatched_to_inbox integer,
  commissions_paid integer
)
LANGUAGE plpgsql
SET search_path TO 'public'
SECURITY DEFINER
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_batch RECORD;
  v_payload JSONB;
  v_row JSONB;
  v_cod_updated INT := 0;
  v_withdrawals_created INT := 0;
  v_unmatched_to_inbox INT := 0;
  v_commissions_paid INT := 0;
  v_complete_time TIMESTAMPTZ;
  v_profile_id BIGINT;
  v_last_count INT := 0;
  v_order_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  -- Keep existing actual-profit guard bypass scoped to this transaction only.
  PERFORM set_config('grandbook.bypass_actual_check', 'true', true);

  SELECT * INTO v_batch
  FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org_id
  FOR UPDATE;

  IF v_batch.id IS NULL THEN
    RAISE EXCEPTION 'Batch not found: %', p_batch_id;
  END IF;

  IF v_batch.status <> 'PREVIEW' THEN
    RAISE EXCEPTION 'Batch status is %, can only apply PREVIEW batches', v_batch.status;
  END IF;

  v_payload := v_batch.preview_payload;
  v_profile_id := v_batch.profile_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'cod_matched', '[]'::jsonb)) LOOP
    v_complete_time := NULLIF(v_row->>'complete_time','')::TIMESTAMPTZ;
    v_order_id := NULL;

    UPDATE public.orders
    SET
      payout_amount = (v_row->>'new_payout')::NUMERIC,
      cod_settled_at = COALESCE(v_complete_time, cod_settled_at, NOW()),
      updated_at = NOW()
    WHERE organization_id = v_org_id AND (resi = v_row->>'tracking' OR tracking_no = v_row->>'tracking')
    RETURNING id INTO v_order_id;

    GET DIAGNOSTICS v_last_count = ROW_COUNT;
    v_cod_updated := v_cod_updated + v_last_count;

    IF v_last_count > 0 AND v_order_id IS NOT NULL THEN
      UPDATE public.commissions
      SET
        status = 'PAID',
        paid_at = NOW(),
        paid_by = auth.uid(),
        payment_method = COALESCE(payment_method, 'spx_cashflow'),
        payment_reference = COALESCE(payment_reference, 'SPX cashflow batch #' || p_batch_id),
        updated_at = NOW()
      WHERE order_id = v_order_id AND status = 'EARNED';

      GET DIAGNOSTICS v_last_count = ROW_COUNT;
      v_commissions_paid := v_commissions_paid + v_last_count;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'cod_variance', '[]'::jsonb)) LOOP
    v_complete_time := NULLIF(v_row->>'complete_time','')::TIMESTAMPTZ;
    v_order_id := NULL;

    UPDATE public.orders
    SET
      payout_amount = (v_row->>'new_payout')::NUMERIC,
      cod_settled_at = COALESCE(v_complete_time, cod_settled_at, NOW()),
      internal_note = COALESCE(internal_note || E'\n', '') ||
        'COD variance: ' || (v_row->>'old_payout') || ' → ' || (v_row->>'new_payout') ||
        ' (batch ' || p_batch_id || ', ' || NOW()::DATE || ')',
      updated_at = NOW()
    WHERE organization_id = v_org_id AND (resi = v_row->>'tracking' OR tracking_no = v_row->>'tracking')
    RETURNING id INTO v_order_id;

    GET DIAGNOSTICS v_last_count = ROW_COUNT;
    v_cod_updated := v_cod_updated + v_last_count;

    IF v_last_count > 0 AND v_order_id IS NOT NULL THEN
      UPDATE public.commissions
      SET
        status = 'PAID',
        paid_at = NOW(),
        paid_by = auth.uid(),
        payment_method = COALESCE(payment_method, 'spx_cashflow'),
        payment_reference = COALESCE(payment_reference, 'SPX cashflow batch #' || p_batch_id),
        updated_at = NOW()
      WHERE order_id = v_order_id AND status = 'EARNED';

      GET DIAGNOSTICS v_last_count = ROW_COUNT;
      v_commissions_paid := v_commissions_paid + v_last_count;
    END IF;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'withdrawals', '[]'::jsonb)) LOOP
    INSERT INTO public.bank_withdrawals(
      organization_id, channel_id, external_id, withdrawal_date,
      amount, fee, net_received, bank_account, reference_no, status,
      balance_before, balance_after, source_batch_id
    )
    VALUES(
      v_org_id, 1, v_row->>'external_id', NULLIF(v_row->>'complete_time','')::TIMESTAMPTZ,
      (v_row->>'amount')::NUMERIC, (v_row->>'fee')::NUMERIC, (v_row->>'net_received')::NUMERIC,
      v_row->>'bank_account', v_row->>'reference_no', v_row->>'status',
      (v_row->>'balance_before')::NUMERIC, (v_row->>'balance_after')::NUMERIC, p_batch_id
    )
    ON CONFLICT (organization_id, external_id) DO NOTHING;

    GET DIAGNOSTICS v_last_count = ROW_COUNT;
    v_withdrawals_created := v_withdrawals_created + v_last_count;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'cod_unmatched', '[]'::jsonb)) LOOP
    IF COALESCE(v_row->>'tracking', '') <> '' THEN
      INSERT INTO public.inbox_unmatched_resi(
        organization_id, source_profile_id, raw_resi, raw_data
      )
      VALUES(
        v_org_id, v_profile_id, v_row->>'tracking', v_row
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_last_count = ROW_COUNT;
      v_unmatched_to_inbox := v_unmatched_to_inbox + v_last_count;
    END IF;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED', applied_at = NOW(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT p_batch_id, v_cod_updated, v_withdrawals_created, v_unmatched_to_inbox, v_commissions_paid;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.apply_spx_cashflow_recon(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_spx_cashflow_recon(bigint) TO authenticated;
