-- 060 — Posisi Keuangan v2: peta cashflow COD lengkap.
-- Applied via Supabase MCP (apply_migration: financial_position_v2_cashflow_map).
--
-- get_financial_position v1 (migration 054) cuma return: saldo SPX (dari
-- bank_withdrawals.balance_after), in-transit COD, HPP supplier. Lubang besar:
-- COD dari order yang sudah DITERIMA — uang sudah dipegang SPX tapi belum
-- ditarik — tidak keitung sama sekali (di prod ~Rp86jt hilang dari halaman).
--
-- v2 RETURNS 14 kolom — peta "duit gw ada di mana":
--   ASET   : in_transit_cod (pipeline) + cod_at_spx (DITERIMA, belum ditarik)
--   UTANG  : hpp_supplier_owed + ongkir_spx_owed + komisi_owed
--   INFO   : total_withdrawn / withdrawal_count / last_withdrawal_at
--
--   cod_at_spx = Σ cod_amount order DITERIMA COD − Σ bank_withdrawals.amount
--   ongkir_spx_owed = Σ estimated_total_cost order DIKIRIM/DITERIMA di channel
--                     MONTHLY_INVOICE (SPX tagih ongkir bulanan)
--
-- SECURITY INVOKER — RLS user pemanggil yang berlaku. Idempotent: DROP dulu
-- (return shape berubah dari v1) lalu CREATE.

DROP FUNCTION IF EXISTS public.get_financial_position();

CREATE OR REPLACE FUNCTION public.get_financial_position()
RETURNS TABLE(
  in_transit_cod NUMERIC,
  in_transit_orders BIGINT,
  cod_at_spx NUMERIC,
  cod_at_spx_orders BIGINT,
  total_withdrawn NUMERIC,
  withdrawal_count BIGINT,
  last_withdrawal_at TIMESTAMPTZ,
  hpp_supplier_owed NUMERIC,
  hpp_supplier_orders BIGINT,
  hpp_supplier_count INTEGER,
  ongkir_spx_owed NUMERIC,
  ongkir_spx_orders BIGINT,
  komisi_owed NUMERIC,
  komisi_count BIGINT
)
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT;
  v_withdrawn NUMERIC;
  v_cod_diterima NUMERIC;
BEGIN
  v_org := public.current_org_id();

  -- Total ditarik dari SPX ke bank (kumulatif)
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM public.bank_withdrawals
  WHERE organization_id = v_org AND status IN ('APPROVED','COMPLETED');

  -- COD dari order yang sudah DITERIMA (uang sudah masuk ke SPX)
  SELECT COALESCE(SUM(cod_amount), 0) INTO v_cod_diterima
  FROM public.orders
  WHERE organization_id = v_org AND status = 'DITERIMA' AND payment_method = 'COD';

  RETURN QUERY
  SELECT
    -- In-transit COD (pipeline — resi jalan, belum sampai)
    COALESCE((SELECT SUM(cod_amount) FROM public.orders
      WHERE organization_id = v_org AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD'), 0),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD')::BIGINT,
    -- COD di SPX belum ditarik = COD order DITERIMA − total withdrawn
    GREATEST(v_cod_diterima - v_withdrawn, 0),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org AND status = 'DITERIMA'
        AND payment_method = 'COD')::BIGINT,
    -- Riwayat penarikan
    v_withdrawn,
    (SELECT COUNT(*) FROM public.bank_withdrawals
      WHERE organization_id = v_org AND status IN ('APPROVED','COMPLETED'))::BIGINT,
    (SELECT MAX(withdrawal_date) FROM public.bank_withdrawals
      WHERE organization_id = v_org),
    -- Utang HPP ke supplier (PENDING)
    COALESCE((SELECT SUM(hpp_total) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING'), 0),
    (SELECT COUNT(*) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::INTEGER,
    -- Utang ongkir ke SPX (estimasi — order MONTHLY_INVOICE yang sudah jalan)
    COALESCE((SELECT SUM(o.estimated_total_cost) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status IN ('DIKIRIM','DITERIMA')
        AND cc.billing_model = 'MONTHLY_INVOICE'), 0),
    (SELECT COUNT(*) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status IN ('DIKIRIM','DITERIMA')
        AND cc.billing_model = 'MONTHLY_INVOICE')::BIGINT,
    -- Utang komisi ke tim (EARNED, belum dibayar)
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED'), 0),
    (SELECT COUNT(*) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED')::BIGINT;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_financial_position() TO authenticated;
