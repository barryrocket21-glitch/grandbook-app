-- =============================================================
-- Phase 8I-v2 — SPX Cashflow Daily Reconciliation
-- Migration 048 — 2026-05-20
-- =============================================================
-- Extends Phase 8I dengan:
--   - bank_withdrawals table (track penarikan SPX → bank)
--   - orders.cod_settled_at column (track kapan COD masuk saldo)
--   - audit_log trigger untuk bank_withdrawals
--   - converter profile spx_account_transaction + 15 field mappings
--   - 3 RPCs: preview_spx_cashflow_recon, apply_spx_cashflow_recon,
--     get_cashflow_summary
--
-- Workflow harian: download Account Transaction List dari Shopee Seller
-- Center → upload ke /reconciliation/spx-cashflow → preview 4 kategori
-- (matched/variance/unmatched COD + withdrawals + duplicates) → klik
-- Apply → UPDATE orders + INSERT bank_withdrawals + INSERT inbox.
-- =============================================================

-- =============================================================
-- bank_withdrawals table + audit trigger
-- =============================================================
CREATE TABLE IF NOT EXISTS public.bank_withdrawals (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  channel_id BIGINT REFERENCES public.courier_channels(id),
  external_id TEXT,
  withdrawal_date TIMESTAMPTZ NOT NULL,
  amount NUMERIC NOT NULL,
  fee NUMERIC NOT NULL DEFAULT 0,
  net_received NUMERIC NOT NULL,
  bank_account TEXT,
  reference_no TEXT,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  balance_before NUMERIC,
  balance_after NUMERIC,
  source_batch_id BIGINT REFERENCES public.reconciliation_batches(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_withdrawals_external_id
  ON public.bank_withdrawals(organization_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_withdrawals_date
  ON public.bank_withdrawals(organization_id, withdrawal_date DESC);

ALTER TABLE public.bank_withdrawals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bank_withdrawals_select ON public.bank_withdrawals;
CREATE POLICY bank_withdrawals_select ON public.bank_withdrawals
  FOR SELECT USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS bank_withdrawals_insert ON public.bank_withdrawals;
CREATE POLICY bank_withdrawals_insert ON public.bank_withdrawals
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'akunting')
  );

DROP POLICY IF EXISTS bank_withdrawals_update ON public.bank_withdrawals;
CREATE POLICY bank_withdrawals_update ON public.bank_withdrawals
  FOR UPDATE USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'akunting')
  );

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cod_settled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_cod_settled
  ON public.orders(organization_id, cod_settled_at DESC)
  WHERE cod_settled_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.audit_log_bank_withdrawals_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, new_value)
    VALUES (v_user_id, 'bank_withdrawals', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'bank_withdrawals', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'bank_withdrawals', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_bank_withdrawals ON public.bank_withdrawals;
CREATE TRIGGER trg_audit_log_bank_withdrawals
  AFTER INSERT OR UPDATE OR DELETE ON public.bank_withdrawals
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_log_bank_withdrawals_trigger();

-- =============================================================
-- Converter profile + 15 field mappings
-- (Mappings target_table='meta' karena CHECK constraint hanya allow
--  orders/order_items/meta/file_column. RPC handle parsing directly.)
-- =============================================================
INSERT INTO public.converter_profiles (
  code, name, direction, channel_id, file_format,
  source_or_target, primary_key_target, header_row_index, has_header_row, active
)
SELECT
  'spx_account_transaction',
  'SPX Account Transaction (Daily Cashflow)',
  'INBOUND_REKONSIL', 1, 'XLSX',
  'Shopee Seller Center → Saldo → Riwayat Transaksi → Export',
  'resi', 1, TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.converter_profiles WHERE code = 'spx_account_transaction');

DO $$
DECLARE v_profile_id BIGINT;
BEGIN
  SELECT id INTO v_profile_id FROM public.converter_profiles WHERE code = 'spx_account_transaction';
  IF v_profile_id IS NULL THEN RETURN; END IF;

  -- Idempotent: only insert mappings if profile has zero mappings
  IF NOT EXISTS (SELECT 1 FROM public.converter_field_mappings WHERE profile_id = v_profile_id) THEN
    INSERT INTO public.converter_field_mappings(profile_id, source_field, target_field, target_table, transform, required, display_order) VALUES
      (v_profile_id, 'ID Transaksi',                          'external_id',         'meta',   NULL,                          TRUE,  1),
      (v_profile_id, 'Tipe Transaksi',                        'tx_type',             'meta',   NULL,                          TRUE,  2),
      (v_profile_id, 'Tracking Number',                       'tracking',            'orders', 'null_if_empty',               FALSE, 3),
      (v_profile_id, 'Waktu Pembaruan Status',                'update_time',         'meta',   'parse_datetime_yyyy-mm-dd',   FALSE, 4),
      (v_profile_id, 'Nominal Transaksi(IDR)',                'nominal',             'meta',   'numeric_or_zero',             TRUE,  5),
      (v_profile_id, 'Saldo Sebelum(IDR)',                    'balance_before',      'meta',   'numeric_or_zero',             FALSE, 6),
      (v_profile_id, 'Saldo Sesudah(IDR)',                    'balance_after',       'meta',   'numeric_or_zero',             FALSE, 7),
      (v_profile_id, 'Biaya Penarikan(IDR)',                  'withdrawal_fee',      'meta',   'numeric_or_zero',             FALSE, 8),
      (v_profile_id, 'Jumlah Transfer Bank Penarikan(IDR)',   'net_received',        'meta',   'numeric_or_zero',             FALSE, 9),
      (v_profile_id, 'Status',                                'status',              'meta',   NULL,                          TRUE, 10),
      (v_profile_id, 'Akun bank penarikan',                   'bank_account',        'meta',   'null_if_empty',               FALSE,11),
      (v_profile_id, 'Transaction Reference No',              'reference_no',        'meta',   'null_if_empty',               FALSE,12),
      (v_profile_id, 'Alasan Penolakan Penarikan',            'rejection_reason',    'meta',   'null_if_empty',               FALSE,13),
      (v_profile_id, 'Create Time',                           'create_time',         'meta',   'parse_datetime_yyyy-mm-dd',   FALSE,14),
      (v_profile_id, 'Complete Time',                         'complete_time',       'meta',   'parse_datetime_yyyy-mm-dd',   TRUE, 15);
  END IF;
END $$;

-- =============================================================
-- preview_spx_cashflow_recon — parse input rows, categorize, save preview
-- =============================================================
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

      SELECT id, order_number, resi, customer_name, payout_amount, cod_settled_at
      INTO v_existing_order
      FROM public.orders
      WHERE organization_id = v_org_id AND resi = v_tracking
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

-- =============================================================
-- apply_spx_cashflow_recon — UPDATE orders + INSERT withdrawals + log unmatched
-- =============================================================
DROP FUNCTION IF EXISTS public.apply_spx_cashflow_recon(bigint);

CREATE OR REPLACE FUNCTION public.apply_spx_cashflow_recon(p_batch_id bigint)
RETURNS TABLE(
  batch_id bigint,
  cod_updated integer,
  withdrawals_created integer,
  unmatched_to_inbox integer
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
  v_complete_time TIMESTAMPTZ;
  v_profile_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  SELECT * INTO v_batch FROM public.reconciliation_batches WHERE id = p_batch_id AND organization_id = v_org_id FOR UPDATE;

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
    UPDATE public.orders
    SET
      payout_amount = (v_row->>'new_payout')::NUMERIC,
      cod_settled_at = v_complete_time,
      updated_at = NOW()
    WHERE organization_id = v_org_id AND resi = v_row->>'tracking';
    v_cod_updated := v_cod_updated + 1;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_payload->'cod_variance', '[]'::jsonb)) LOOP
    v_complete_time := NULLIF(v_row->>'complete_time','')::TIMESTAMPTZ;
    UPDATE public.orders
    SET
      payout_amount = (v_row->>'new_payout')::NUMERIC,
      cod_settled_at = v_complete_time,
      internal_note = COALESCE(internal_note || E'\n', '') ||
        'COD variance: ' || (v_row->>'old_payout') || ' → ' || (v_row->>'new_payout') ||
        ' (batch ' || p_batch_id || ', ' || NOW()::DATE || ')',
      updated_at = NOW()
    WHERE organization_id = v_org_id AND resi = v_row->>'tracking';
    v_cod_updated := v_cod_updated + 1;
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
    v_withdrawals_created := v_withdrawals_created + 1;
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
      v_unmatched_to_inbox := v_unmatched_to_inbox + 1;
    END IF;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED', applied_at = NOW(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT p_batch_id, v_cod_updated, v_withdrawals_created, v_unmatched_to_inbox;
END;
$function$;

-- =============================================================
-- get_cashflow_summary — dashboard widget data
-- =============================================================
DROP FUNCTION IF EXISTS public.get_cashflow_summary();

CREATE OR REPLACE FUNCTION public.get_cashflow_summary()
RETURNS TABLE(
  saldo_terakhir numeric,
  total_cod_bulan_ini numeric,
  total_penarikan_bulan_ini numeric,
  last_withdrawal_date timestamptz,
  last_withdrawal_amount numeric,
  unsettled_count integer,
  unsettled_amount numeric
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_now_month DATE;
BEGIN
  v_org_id := public.current_org_id();
  v_now_month := DATE_TRUNC('month', NOW())::DATE;

  RETURN QUERY
  SELECT
    (SELECT balance_after FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
     ORDER BY withdrawal_date DESC LIMIT 1) AS saldo_terakhir,
    COALESCE((SELECT SUM(payout_amount) FROM public.orders
              WHERE organization_id = v_org_id
                AND cod_settled_at >= v_now_month), 0) AS total_cod_bulan_ini,
    COALESCE((SELECT SUM(amount) FROM public.bank_withdrawals
              WHERE organization_id = v_org_id
                AND withdrawal_date >= v_now_month
                AND status = 'Berhasil'), 0) AS total_penarikan_bulan_ini,
    (SELECT withdrawal_date FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
       AND status = 'Berhasil'
     ORDER BY withdrawal_date DESC LIMIT 1) AS last_withdrawal_date,
    (SELECT amount FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
       AND status = 'Berhasil'
     ORDER BY withdrawal_date DESC LIMIT 1) AS last_withdrawal_amount,
    (SELECT COUNT(*)::INT FROM public.orders
     WHERE organization_id = v_org_id
       AND status = 'DITERIMA'
       AND cod_settled_at IS NULL)::INT AS unsettled_count,
    COALESCE((SELECT SUM(cod_amount) FROM public.orders
              WHERE organization_id = v_org_id
                AND status = 'DITERIMA'
                AND cod_settled_at IS NULL), 0) AS unsettled_amount;
END;
$function$;
