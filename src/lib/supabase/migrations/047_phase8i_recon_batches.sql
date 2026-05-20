-- =============================================================
-- Phase 8I — SPX Financial Reconciliation
-- Migration 047 — 2026-05-20
-- =============================================================
-- New table reconciliation_batches + 2 RPCs (preview_spx_recon, apply_spx_recon).
-- Workflow: Upload .xlsx → Preview → User klik Apply → Write ke DB.
--
-- Status enum: PREVIEW | APPLIED | CANCELLED | FAILED
-- preview_payload JSONB simpan full diff (matched/variance/unmatched arrays)
-- supaya bisa di-recall jika browser refresh sebelum apply.
--
-- Variance threshold: ABS(new_payout - old_payout) > 100 (Rp 100 selisih).
--
-- RLS: owner/admin/akunting write, all org read.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.reconciliation_batches (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  channel_id BIGINT REFERENCES public.courier_channels(id),
  profile_id BIGINT REFERENCES public.converter_profiles(id),
  uploaded_by UUID REFERENCES public.profiles(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  file_name TEXT,
  file_size_bytes INT,
  total_rows INT NOT NULL DEFAULT 0,
  matched_count INT NOT NULL DEFAULT 0,
  unmatched_count INT NOT NULL DEFAULT 0,
  variance_count INT NOT NULL DEFAULT 0,
  total_payout_applied NUMERIC NOT NULL DEFAULT 0,
  total_shipping_applied NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PREVIEW' CHECK (status IN ('PREVIEW', 'APPLIED', 'CANCELLED', 'FAILED')),
  applied_at TIMESTAMPTZ,
  applied_by UUID REFERENCES public.profiles(id),
  preview_payload JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recon_batches_org_uploaded
  ON public.reconciliation_batches(organization_id, uploaded_at DESC);

ALTER TABLE public.reconciliation_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS recon_batches_select ON public.reconciliation_batches;
CREATE POLICY recon_batches_select ON public.reconciliation_batches
  FOR SELECT USING (organization_id = public.current_org_id());

DROP POLICY IF EXISTS recon_batches_insert ON public.reconciliation_batches;
CREATE POLICY recon_batches_insert ON public.reconciliation_batches
  FOR INSERT WITH CHECK (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'akunting')
  );

DROP POLICY IF EXISTS recon_batches_update ON public.reconciliation_batches;
CREATE POLICY recon_batches_update ON public.reconciliation_batches
  FOR UPDATE USING (
    organization_id = public.current_org_id()
    AND public.get_user_role() IN ('owner', 'admin', 'akunting')
  );

-- =============================================================
-- preview_spx_recon — input array of rows, categorize matched/variance/unmatched
-- =============================================================
DROP FUNCTION IF EXISTS public.preview_spx_recon(jsonb, text, int);

CREATE OR REPLACE FUNCTION public.preview_spx_recon(
  p_rows jsonb,
  p_file_name text DEFAULT NULL,
  p_file_size_bytes int DEFAULT NULL
)
RETURNS TABLE(
  batch_id BIGINT,
  total_rows INT,
  matched_count INT,
  unmatched_count INT,
  variance_count INT,
  total_payout_estimated NUMERIC,
  total_shipping_estimated NUMERIC,
  preview_data JSONB
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_batch_id BIGINT;
  v_total_rows INT;
  v_matched_count INT := 0;
  v_unmatched_count INT := 0;
  v_variance_count INT := 0;
  v_total_payout NUMERIC := 0;
  v_total_shipping NUMERIC := 0;
  v_matched JSONB := '[]'::JSONB;
  v_unmatched JSONB := '[]'::JSONB;
  v_variance JSONB := '[]'::JSONB;
  v_preview_payload JSONB;
  v_row JSONB;
  v_resi TEXT;
  v_new_payout NUMERIC;
  v_new_shipping NUMERIC;
  v_new_cod NUMERIC;
  v_order RECORD;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  v_total_rows := COALESCE(jsonb_array_length(p_rows), 0);

  INSERT INTO public.reconciliation_batches (
    organization_id, channel_id, profile_id, uploaded_by, uploaded_at,
    file_name, file_size_bytes, total_rows, status
  ) VALUES (
    v_org_id, 1, 2, auth.uid(), NOW(),
    p_file_name, p_file_size_bytes, v_total_rows, 'PREVIEW'
  ) RETURNING id INTO v_batch_id;

  FOR v_row IN SELECT jsonb_array_elements(p_rows)
  LOOP
    v_resi := NULLIF(TRIM(v_row->>'resi'), '');
    v_new_payout := COALESCE(NULLIF(v_row->>'payout_amount','')::NUMERIC, 0);
    v_new_shipping := COALESCE(NULLIF(v_row->>'shipping_cost_actual','')::NUMERIC, 0);
    v_new_cod := COALESCE(NULLIF(v_row->>'cod_amount','')::NUMERIC, 0);

    IF v_resi IS NULL THEN
      v_unmatched_count := v_unmatched_count + 1;
      v_unmatched := v_unmatched || jsonb_build_array(v_row || jsonb_build_object('reason', 'empty_resi'));
      CONTINUE;
    END IF;

    SELECT id, order_number, customer_name, payout_amount, shipping_cost_actual
      INTO v_order
    FROM public.orders
    WHERE resi = v_resi AND organization_id = v_org_id;

    IF NOT FOUND THEN
      v_unmatched_count := v_unmatched_count + 1;
      v_unmatched := v_unmatched || jsonb_build_array(v_row || jsonb_build_object('reason', 'no_order'));
    ELSIF v_order.payout_amount IS NOT NULL
       AND ABS(v_order.payout_amount - v_new_payout) > 100 THEN
      v_variance_count := v_variance_count + 1;
      v_variance := v_variance || jsonb_build_array(jsonb_build_object(
        'resi', v_resi,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'customer_name', v_order.customer_name,
        'old_payout', v_order.payout_amount,
        'new_payout', v_new_payout,
        'diff', v_new_payout - v_order.payout_amount,
        'old_shipping', v_order.shipping_cost_actual,
        'new_shipping', v_new_shipping,
        'new_cod', v_new_cod
      ));
      v_total_payout := v_total_payout + v_new_payout;
      v_total_shipping := v_total_shipping + v_new_shipping;
    ELSE
      v_matched_count := v_matched_count + 1;
      v_matched := v_matched || jsonb_build_array(jsonb_build_object(
        'resi', v_resi,
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'customer_name', v_order.customer_name,
        'old_payout', v_order.payout_amount,
        'new_payout', v_new_payout,
        'new_shipping', v_new_shipping,
        'new_cod', v_new_cod
      ));
      v_total_payout := v_total_payout + v_new_payout;
      v_total_shipping := v_total_shipping + v_new_shipping;
    END IF;
  END LOOP;

  v_preview_payload := jsonb_build_object(
    'matched', v_matched,
    'variance', v_variance,
    'unmatched', v_unmatched
  );

  UPDATE public.reconciliation_batches
  SET matched_count = v_matched_count,
      unmatched_count = v_unmatched_count,
      variance_count = v_variance_count,
      total_payout_applied = v_total_payout,
      total_shipping_applied = v_total_shipping,
      preview_payload = v_preview_payload
  WHERE id = v_batch_id;

  RETURN QUERY SELECT
    v_batch_id,
    v_total_rows,
    v_matched_count,
    v_unmatched_count,
    v_variance_count,
    v_total_payout,
    v_total_shipping,
    v_preview_payload;
END;
$function$;

-- =============================================================
-- apply_spx_recon — UPDATE orders + log unmatched + finalize batch
-- =============================================================
DROP FUNCTION IF EXISTS public.apply_spx_recon(bigint);

CREATE OR REPLACE FUNCTION public.apply_spx_recon(
  p_batch_id bigint
)
RETURNS TABLE(
  batch_id BIGINT,
  status TEXT,
  matched_updated INT,
  variance_updated INT,
  unmatched_logged INT,
  applied_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_batch RECORD;
  v_payload JSONB;
  v_row JSONB;
  v_matched_updated INT := 0;
  v_variance_updated INT := 0;
  v_unmatched_logged INT := 0;
  v_resi TEXT;
  v_new_payout NUMERIC;
  v_new_shipping NUMERIC;
BEGIN
  v_org_id := public.current_org_id();
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'No organization context';
  END IF;

  SELECT * INTO v_batch
  FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch % not found atau bukan dalam organization', p_batch_id;
  END IF;

  IF v_batch.status = 'APPLIED' THEN
    RAISE EXCEPTION 'Batch % sudah APPLIED pada %', p_batch_id, v_batch.applied_at;
  END IF;

  IF v_batch.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Batch % sudah CANCELLED', p_batch_id;
  END IF;

  v_payload := v_batch.preview_payload;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_payload->'matched', '[]'::jsonb))
  LOOP
    v_resi := v_row->>'resi';
    v_new_payout := (v_row->>'new_payout')::NUMERIC;
    v_new_shipping := (v_row->>'new_shipping')::NUMERIC;

    UPDATE public.orders
    SET payout_amount = v_new_payout,
        shipping_cost_actual = v_new_shipping
    WHERE resi = v_resi AND organization_id = v_org_id;

    v_matched_updated := v_matched_updated + 1;
  END LOOP;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_payload->'variance', '[]'::jsonb))
  LOOP
    v_resi := v_row->>'resi';
    v_new_payout := (v_row->>'new_payout')::NUMERIC;
    v_new_shipping := (v_row->>'new_shipping')::NUMERIC;

    UPDATE public.orders
    SET payout_amount = v_new_payout,
        shipping_cost_actual = v_new_shipping
    WHERE resi = v_resi AND organization_id = v_org_id;

    v_variance_updated := v_variance_updated + 1;
  END LOOP;

  FOR v_row IN SELECT jsonb_array_elements(COALESCE(v_payload->'unmatched', '[]'::jsonb))
  LOOP
    v_resi := COALESCE(v_row->>'resi', '');
    IF v_resi <> '' THEN
      INSERT INTO public.inbox_unmatched_resi (
        organization_id, source_profile_id, raw_resi, raw_data
      ) VALUES (
        v_org_id, 2, v_resi, v_row
      )
      ON CONFLICT DO NOTHING;
      v_unmatched_logged := v_unmatched_logged + 1;
    END IF;
  END LOOP;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED',
      applied_at = NOW(),
      applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN QUERY SELECT
    p_batch_id,
    'APPLIED'::TEXT,
    v_matched_updated,
    v_variance_updated,
    v_unmatched_logged,
    NOW();
END;
$function$;
