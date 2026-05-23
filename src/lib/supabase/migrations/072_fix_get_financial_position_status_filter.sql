-- =============================================================
-- Bug fix — get_financial_position pakai status filter yang salah
-- Migration 072 — 2026-05-23
-- =============================================================
-- BUG: RPC get_financial_position filter bank_withdrawals.status IN
-- ('APPROVED','COMPLETED'). Tapi data Phase 8I-v2 cashflow recon insert
-- dengan status bahasa Indonesia ('Berhasil','Ditolak','Pending'). Result:
-- total_withdrawn selalu 0, cod_at_spx over-stated, last_withdrawal_at null.
--
-- Fix: status IN ('Berhasil','APPROVED','COMPLETED') — accept both legacy
-- English values + new Indonesian values (defensive, supaya backward-compat
-- kalau ada data lama dengan English).
--
-- Discovery: financial audit 2026-05-23. Sample query show 0 returned
-- meskipun bank_withdrawals table sudah punya data 'Berhasil' status.
-- =============================================================

CREATE OR REPLACE FUNCTION public.get_financial_position()
RETURNS TABLE(
  in_transit_cod numeric,
  in_transit_orders bigint,
  cod_at_spx numeric,
  cod_at_spx_orders bigint,
  total_withdrawn numeric,
  withdrawal_count bigint,
  last_withdrawal_at timestamp with time zone,
  hpp_supplier_owed numeric,
  hpp_supplier_orders bigint,
  hpp_supplier_count integer,
  ongkir_spx_owed numeric,
  ongkir_spx_orders bigint,
  komisi_owed numeric,
  komisi_count bigint
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT;
  v_withdrawn NUMERIC;
  v_cod_diterima NUMERIC;
BEGIN
  v_org := public.current_org_id();

  -- Total ditarik dari SPX ke bank (kumulatif). FIX 072: accept 'Berhasil'
  -- (Indo, dari Phase 8I-v2 cashflow recon) + legacy English values.
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM public.bank_withdrawals
  WHERE organization_id = v_org
    AND status IN ('Berhasil', 'APPROVED', 'COMPLETED');

  SELECT COALESCE(SUM(cod_amount), 0) INTO v_cod_diterima
  FROM public.orders
  WHERE organization_id = v_org AND status = 'DITERIMA' AND payment_method = 'COD';

  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(cod_amount) FROM public.orders
      WHERE organization_id = v_org AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD'), 0),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD')::BIGINT,
    GREATEST(v_cod_diterima - v_withdrawn, 0),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org AND status = 'DITERIMA'
        AND payment_method = 'COD')::BIGINT,
    v_withdrawn,
    (SELECT COUNT(*) FROM public.bank_withdrawals
      WHERE organization_id = v_org
        AND status IN ('Berhasil', 'APPROVED', 'COMPLETED'))::BIGINT,
    (SELECT MAX(withdrawal_date) FROM public.bank_withdrawals
      WHERE organization_id = v_org),
    COALESCE((SELECT SUM(hpp_total) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING'), 0),
    (SELECT COUNT(*) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::INTEGER,
    COALESCE((SELECT SUM(o.estimated_total_cost) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status IN ('DIKIRIM','DITERIMA')
        AND cc.billing_model = 'MONTHLY_INVOICE'), 0),
    (SELECT COUNT(*) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status IN ('DIKIRIM','DITERIMA')
        AND cc.billing_model = 'MONTHLY_INVOICE')::BIGINT,
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED'), 0),
    (SELECT COUNT(*) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED')::BIGINT;
END;
$function$;
