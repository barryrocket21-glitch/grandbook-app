-- 103 — Sub-brief #17: Rekonsiliasi Payout/Cair SPX (EARNED → PAID).
-- ============================================================================
-- Nutup loop uang: order delivered → CAIR (cod_settled_at + payout_amount) →
-- komisi EARNED→PAID + posisi kas/aging. Reuse kolom existing (cod_settled_at,
-- payout_amount, commissions, bank_withdrawals, reconciliation_batches).
-- Clawback (RETUR/CANCEL→VOIDED) udah ditangani trigger update_commission_on_order_status.
-- 3 RPC INVOKER + REVOKE anon → advisor 0 baru. Idempotent.

-- ── PART 1: preview payout (match GB-/resi/tracking, batch PREVIEW) ──────────
DROP FUNCTION IF EXISTS public.preview_payout_recon(jsonb, text, integer);
CREATE OR REPLACE FUNCTION public.preview_payout_recon(
  p_rows jsonb, p_file_name text DEFAULT NULL, p_file_size integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  v_org bigint; r jsonb; v_ref text; v_oid bigint; v_exp numeric;
  v_payout numeric; v_net numeric; v_fee numeric;
  v_matched jsonb := '[]'::jsonb; v_variance jsonb := '[]'::jsonb; v_unmatched jsonb := '[]'::jsonb;
  v_total numeric := 0; v_batch_id bigint; m int := 0; vr int := 0; um int := 0;
BEGIN
  v_org := public.current_org_id();
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RETURN jsonb_build_object('error', 'no rows');
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) AS t(value) LOOP
    v_ref := btrim(COALESCE(r->>'ref', ''));
    v_payout := NULLIF(btrim(COALESCE(r->>'payout_amount','')), '')::numeric;
    v_net := NULLIF(btrim(COALESCE(r->>'net_received','')), '')::numeric;
    v_fee := NULLIF(btrim(COALESCE(r->>'fee','')), '')::numeric;
    IF v_ref = '' THEN
      v_unmatched := v_unmatched || jsonb_build_object('ref', v_ref, 'reason', 'no_ref'); um := um + 1; CONTINUE;
    END IF;
    SELECT id, COALESCE(estimated_cash_in, cod_amount) INTO v_oid, v_exp
    FROM public.orders
    WHERE organization_id = v_org AND (order_number = v_ref OR resi = v_ref OR tracking_no = v_ref)
    LIMIT 1;
    IF v_oid IS NULL THEN
      v_unmatched := v_unmatched || jsonb_build_object('ref', v_ref, 'reason', 'no_match', 'payout', v_payout); um := um + 1; CONTINUE;
    END IF;
    v_total := v_total + COALESCE(v_payout, 0);
    IF v_payout IS NOT NULL AND abs(v_payout - COALESCE(v_exp, 0)) > 100 THEN
      v_variance := v_variance || jsonb_build_object('ref', v_ref, 'order_id', v_oid, 'payout', v_payout,
        'expected', v_exp, 'net', v_net, 'fee', v_fee, 'withdrawal_date', r->>'withdrawal_date'); vr := vr + 1;
    ELSE
      v_matched := v_matched || jsonb_build_object('ref', v_ref, 'order_id', v_oid, 'payout', v_payout,
        'net', v_net, 'fee', v_fee, 'withdrawal_date', r->>'withdrawal_date'); m := m + 1;
    END IF;
  END LOOP;
  INSERT INTO public.reconciliation_batches(
    organization_id, channel_id, file_name, file_size_bytes, total_rows,
    matched_count, unmatched_count, variance_count, total_payout_applied, status,
    preview_payload, uploaded_at, uploaded_by
  ) VALUES (
    v_org, 1, p_file_name, p_file_size, jsonb_array_length(p_rows),
    m, um, vr, v_total, 'PREVIEW',
    jsonb_build_object('matched', v_matched, 'variance', v_variance, 'unmatched', v_unmatched),
    now(), auth.uid()
  ) RETURNING id INTO v_batch_id;
  RETURN jsonb_build_object('batch_id', v_batch_id, 'matched', m, 'variance', vr, 'unmatched', um, 'total_payout', v_total);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.preview_payout_recon(jsonb, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_payout_recon(jsonb, text, integer) TO authenticated;

-- ── PART 2+3: apply payout → set cair + flip komisi EARNED→PAID ──────────────
DROP FUNCTION IF EXISTS public.apply_payout_recon(bigint);
CREATE OR REPLACE FUNCTION public.apply_payout_recon(p_batch_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE
  v_org bigint; v_batch record; v_payload jsonb; r jsonb; v_oid bigint; v_wdt timestamptz;
  v_settled int := 0; v_comm int := 0; v_inbox int := 0; v_cnt int;
  v_pay numeric := 0; v_net numeric := 0; v_fee numeric := 0;
BEGIN
  v_org := public.current_org_id();
  -- bypass block-trigger admin edit payout (Phase 8E) — local scope, auto-reset.
  PERFORM set_config('grandbook.bypass_actual_check', 'true', true);

  SELECT * INTO v_batch FROM public.reconciliation_batches
  WHERE id = p_batch_id AND organization_id = v_org FOR UPDATE;
  IF v_batch.id IS NULL THEN RAISE EXCEPTION 'Batch % gak ada di org', p_batch_id; END IF;
  IF v_batch.status <> 'PREVIEW' THEN
    RAISE EXCEPTION 'Batch status %, cuma PREVIEW yang bisa di-apply (anti dobel)', v_batch.status;
  END IF;
  v_payload := v_batch.preview_payload;

  FOR r IN SELECT value FROM jsonb_array_elements(
    COALESCE(v_payload->'matched','[]'::jsonb) || COALESCE(v_payload->'variance','[]'::jsonb)
  ) AS t(value) LOOP
    v_oid := (r->>'order_id')::bigint;
    v_wdt := COALESCE(NULLIF(r->>'withdrawal_date','')::timestamptz, now());
    UPDATE public.orders SET
      payout_amount = COALESCE((r->>'payout')::numeric, payout_amount),
      cod_settled_at = COALESCE(cod_settled_at, v_wdt),
      updated_at = now()
    WHERE id = v_oid AND organization_id = v_org;
    IF NOT FOUND THEN CONTINUE; END IF;
    v_settled := v_settled + 1;
    v_pay := v_pay + COALESCE((r->>'payout')::numeric, 0);
    v_net := v_net + COALESCE((r->>'net')::numeric, (r->>'payout')::numeric, 0);
    v_fee := v_fee + COALESCE((r->>'fee')::numeric, 0);
    -- PART 3: komisi EARNED → PAID (idempotent: cuma EARNED yang ke-flip)
    UPDATE public.commissions SET
      status = 'PAID', paid_at = now(), paid_by = auth.uid(),
      payment_method = COALESCE(payment_method, 'spx_payout'),
      payment_reference = COALESCE(payment_reference, 'payout batch ' || p_batch_id),
      updated_at = now()
    WHERE order_id = v_oid AND status = 'EARNED';
    GET DIAGNOSTICS v_cnt = ROW_COUNT; v_comm := v_comm + v_cnt;
  END LOOP;

  FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(v_payload->'unmatched','[]'::jsonb)) AS t(value) LOOP
    IF COALESCE(r->>'ref','') <> '' THEN
      INSERT INTO public.inbox_unmatched_resi(organization_id, raw_resi, raw_data)
      VALUES (v_org, r->>'ref', r) ON CONFLICT DO NOTHING;
      v_inbox := v_inbox + 1;
    END IF;
  END LOOP;

  -- catat batch di bank_withdrawals (idempotent: guard NOT EXISTS per external_id;
  -- bank_withdrawals gak punya unique constraint → pakai guard, bukan ON CONFLICT)
  IF v_pay > 0 AND NOT EXISTS (
    SELECT 1 FROM public.bank_withdrawals
    WHERE organization_id = v_org AND external_id = 'PAYOUT-' || p_batch_id
  ) THEN
    INSERT INTO public.bank_withdrawals(
      organization_id, channel_id, external_id, withdrawal_date,
      amount, fee, net_received, status, source_batch_id
    ) VALUES (
      v_org, 1, 'PAYOUT-' || p_batch_id, now(), v_pay, v_fee, v_net, 'Berhasil', p_batch_id
    );
  END IF;

  UPDATE public.reconciliation_batches
  SET status = 'APPLIED', applied_at = now(), applied_by = auth.uid()
  WHERE id = p_batch_id;

  RETURN jsonb_build_object('settled', v_settled, 'commissions_paid', v_comm,
    'unmatched_inbox', v_inbox, 'payout_total', v_pay, 'net_received', v_net);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.apply_payout_recon(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_payout_recon(bigint) TO authenticated;

-- ── PART 4: posisi kas cair vs belum-cair + aging ───────────────────────────
DROP FUNCTION IF EXISTS public.get_payout_position();
CREATE OR REPLACE FUNCTION public.get_payout_position()
RETURNS TABLE(
  cair_total numeric, cair_count bigint, uncair_total numeric, uncair_count bigint,
  aging_0_7_count bigint, aging_0_7_amount numeric,
  aging_8_14_count bigint, aging_8_14_amount numeric,
  aging_15plus_count bigint, aging_15plus_amount numeric,
  komisi_paid numeric, komisi_earned numeric
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE v_org bigint := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH o AS (
    SELECT status, payout_amount, cod_amount, cod_settled_at,
           (now() - delivered_at) AS age
    FROM public.orders WHERE organization_id = v_org
  ),
  unc AS (SELECT * FROM o WHERE status = 'DITERIMA' AND cod_settled_at IS NULL)
  SELECT
    COALESCE((SELECT SUM(payout_amount) FROM o WHERE cod_settled_at IS NOT NULL), 0),
    (SELECT COUNT(*) FROM o WHERE cod_settled_at IS NOT NULL)::bigint,
    COALESCE((SELECT SUM(COALESCE(payout_amount, cod_amount)) FROM unc), 0),
    (SELECT COUNT(*) FROM unc)::bigint,
    (SELECT COUNT(*) FROM unc WHERE age < interval '8 days')::bigint,
    COALESCE((SELECT SUM(COALESCE(payout_amount, cod_amount)) FROM unc WHERE age < interval '8 days'), 0),
    (SELECT COUNT(*) FROM unc WHERE age >= interval '8 days' AND age < interval '15 days')::bigint,
    COALESCE((SELECT SUM(COALESCE(payout_amount, cod_amount)) FROM unc WHERE age >= interval '8 days' AND age < interval '15 days'), 0),
    (SELECT COUNT(*) FROM unc WHERE age >= interval '15 days' OR age IS NULL)::bigint,
    COALESCE((SELECT SUM(COALESCE(payout_amount, cod_amount)) FROM unc WHERE age >= interval '15 days' OR age IS NULL), 0),
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c JOIN public.orders oo ON oo.id = c.order_id
              WHERE oo.organization_id = v_org AND c.status = 'PAID'), 0),
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c JOIN public.orders oo ON oo.id = c.order_id
              WHERE oo.organization_id = v_org AND c.status = 'EARNED'), 0);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_payout_position() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_payout_position() TO authenticated;
