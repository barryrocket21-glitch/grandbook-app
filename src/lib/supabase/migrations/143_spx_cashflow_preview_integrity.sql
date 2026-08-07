-- 143 — SPX Cashflow Preview Integrity
-- ============================================================================
-- Keep preview logic consistent with apply integrity:
-- - match COD rows by orders.resi OR orders.tracking_no
-- - avoid false unmatched in preview when tracking is stored in tracking_no

DROP FUNCTION IF EXISTS public.preview_spx_cashflow_recon(jsonb, text, integer);

CREATE OR REPLACE FUNCTION public.preview_spx_cashflow_recon(
  p_rows jsonb,
  p_file_name text DEFAULT NULL,
  p_file_size_bytes integer DEFAULT NULL
)
RETURNS TABLE(
  batch_id bigint,
  total_rows integer,
  cod_matched_count integer,
  cod_unmatched_count integer,
  cod_variance_count integer,
  withdrawal_count integer,
  duplicate_count integer,
  total_cod_amount numeric,
  total_withdrawal_amount numeric,
  preview_data jsonb
)
LANGUAGE plpgsql
SET search_path TO 'public'
SECURITY DEFINER
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_batch_id BIGINT;
  v_profile_id BIGINT;
  v_row JSONB;
  v_tracking TEXT;
  v_tx_type TEXT;
  v_external_id TEXT;
  v_nominal NUMERIC;
  v_existing_order RECORD;
  v_existing_withdrawal_id BIGINT;

  v_cod_matched JSONB := '[]'::JSONB;
  v_cod_unmatched JSONB := '[]'::JSONB;
  v_cod_variance JSONB := '[]'::JSONB;
  v_withdrawals JSONB := '[]'::JSONB;
  v_duplicates JSONB := '[]'::JSONB;

  v_cod_matched_count INT := 0;
  v_cod_unmatched_count INT := 0;
  v_cod_variance_count INT := 0;
  v_withdrawal_count INT := 0;
  v_duplicate_count INT := 0;
  v_total_cod NUMERIC := 0;
  v_total_withdrawal NUMERIC := 0;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  SELECT id INTO v_profile_id FROM public.converter_profiles WHERE code = 'spx_account_transaction';

  INSERT INTO public.reconciliation_batches(
    organization_id, channel_id, profile_id, uploaded_by,
    file_name, file_size_bytes, status, total_rows
  )
  VALUES(
    v_org_id, 1, v_profile_id, auth.uid(),
    p_file_name, p_file_size_bytes, 'PREVIEW', jsonb_array_length(p_rows)
  )
  RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
    v_tx_type := v_row->>'tx_type';
    v_external_id := v_row->>'external_id';
    v_nominal := COALESCE(NULLIF(v_row->>'nominal','')::NUMERIC, 0);

    IF v_tx_type = 'Penarikan' THEN
      SELECT id INTO v_existing_withdrawal_id
      FROM public.bank_withdrawals
      WHERE organization_id = v_org_id AND external_id = v_external_id;

      IF v_existing_withdrawal_id IS NOT NULL THEN
        v_duplicates := v_duplicates || jsonb_build_object(
          'external_id', v_external_id,
          'tx_type', 'Penarikan',
          'nominal', v_nominal,
          'reason', 'Sudah pernah di-import'
        );
        v_duplicate_count := v_duplicate_count + 1;
        CONTINUE;
      END IF;

      v_withdrawals := v_withdrawals || jsonb_build_object(
        'external_id', v_external_id,
        'complete_time', v_row->>'complete_time',
        'amount', ABS(v_nominal),
        'fee', COALESCE(NULLIF(v_row->>'withdrawal_fee','')::NUMERIC, 0),
        'net_received', COALESCE(NULLIF(v_row->>'net_received','')::NUMERIC, 0),
        'bank_account', v_row->>'bank_account',
        'reference_no', v_row->>'reference_no',
        'status', v_row->>'status',
        'balance_before', COALESCE(NULLIF(v_row->>'balance_before','')::NUMERIC, 0),
        'balance_after', COALESCE(NULLIF(v_row->>'balance_after','')::NUMERIC, 0)
      );
      v_withdrawal_count := v_withdrawal_count + 1;
      v_total_withdrawal := v_total_withdrawal + ABS(v_nominal);
      CONTINUE;
    END IF;

    IF v_tx_type = 'COD' THEN
      v_tracking := NULLIF(TRIM(v_row->>'tracking'), '');

      IF v_tracking IS NULL THEN
        v_cod_unmatched := v_cod_unmatched || jsonb_build_object(
          'tracking', '',
          'nominal', v_nominal,
          'complete_time', v_row->>'complete_time',
          'reason', 'Tracking kosong'
        );
        v_cod_unmatched_count := v_cod_unmatched_count + 1;
        v_total_cod := v_total_cod + v_nominal;
        CONTINUE;
      END IF;

      SELECT id, order_number, resi, tracking_no, customer_name, payout_amount, cod_settled_at
      INTO v_existing_order
      FROM public.orders
      WHERE organization_id = v_org_id AND (resi = v_tracking OR tracking_no = v_tracking)
      LIMIT 1;

      IF v_existing_order.id IS NULL THEN
        v_cod_unmatched := v_cod_unmatched || jsonb_build_object(
          'tracking', v_tracking,
          'nominal', v_nominal,
          'complete_time', v_row->>'complete_time',
          'reason', 'Tracking belum ada di orders'
        );
        v_cod_unmatched_count := v_cod_unmatched_count + 1;
        v_total_cod := v_total_cod + v_nominal;
        CONTINUE;
      END IF;

      IF v_existing_order.cod_settled_at IS NOT NULL THEN
        v_duplicates := v_duplicates || jsonb_build_object(
          'tracking', v_tracking,
          'order_number', v_existing_order.order_number,
          'reason', 'COD sudah ter-settle pada ' || TO_CHAR(v_existing_order.cod_settled_at, 'DD Mon YYYY')
        );
        v_duplicate_count := v_duplicate_count + 1;
        CONTINUE;
      END IF;

      IF v_existing_order.payout_amount IS NOT NULL
         AND ABS(COALESCE(v_existing_order.payout_amount, 0) - v_nominal) > 100 THEN
        v_cod_variance := v_cod_variance || jsonb_build_object(
          'tracking', v_tracking,
          'order_number', v_existing_order.order_number,
          'customer_name', v_existing_order.customer_name,
          'old_payout', v_existing_order.payout_amount,
          'new_payout', v_nominal,
          'diff', v_nominal - v_existing_order.payout_amount,
          'complete_time', v_row->>'complete_time'
        );
        v_cod_variance_count := v_cod_variance_count + 1;
      ELSE
        v_cod_matched := v_cod_matched || jsonb_build_object(
          'tracking', v_tracking,
          'order_number', v_existing_order.order_number,
          'customer_name', v_existing_order.customer_name,
          'old_payout', v_existing_order.payout_amount,
          'new_payout', v_nominal,
          'complete_time', v_row->>'complete_time'
        );
        v_cod_matched_count := v_cod_matched_count + 1;
      END IF;
      v_total_cod := v_total_cod + v_nominal;
    END IF;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET
    matched_count = v_cod_matched_count,
    unmatched_count = v_cod_unmatched_count,
    variance_count = v_cod_variance_count,
    total_payout_applied = v_total_cod,
    preview_payload = jsonb_build_object(
      'cod_matched', v_cod_matched,
      'cod_unmatched', v_cod_unmatched,
      'cod_variance', v_cod_variance,
      'withdrawals', v_withdrawals,
      'duplicates', v_duplicates,
      'withdrawal_count', v_withdrawal_count,
      'total_withdrawal_amount', v_total_withdrawal
    )
  WHERE id = v_batch_id;

  RETURN QUERY SELECT
    v_batch_id,
    jsonb_array_length(p_rows)::INT,
    v_cod_matched_count,
    v_cod_unmatched_count,
    v_cod_variance_count,
    v_withdrawal_count,
    v_duplicate_count,
    v_total_cod,
    v_total_withdrawal,
    (SELECT preview_payload FROM public.reconciliation_batches WHERE id = v_batch_id);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.preview_spx_cashflow_recon(jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_spx_cashflow_recon(jsonb, text, integer) TO authenticated;
