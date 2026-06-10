-- 131 — Fix get_financial_position: baca orders_draft untuk in-transit.
-- ============================================================================
-- BUG: get_financial_position() baca 'SIAP_KIRIM'/'DIKIRIM' dari tabel orders.
-- Sejak Phase 8H (mig 049), semua order aktif ada di orders_draft. Tabel orders
-- hanya berisi terminal (DITERIMA/RETUR/CANCEL). Akibat:
--   • COD di Perjalanan → selalu 0
--   • Utang Ongkir SPX → under-count (missing DIKIRIM dari orders_draft)
--
-- Fix: in_transit baca orders_draft; ongkir_owed = DIKIRIM(draft) + DITERIMA(orders)
-- cod_at_spx + komisi tetap dari orders (terminal, sudah benar).
-- Idempotent. INVOKER.

CREATE OR REPLACE FUNCTION public.get_financial_position()
RETURNS TABLE(
  in_transit_cod       NUMERIC,
  in_transit_orders    BIGINT,
  cod_at_spx           NUMERIC,
  cod_at_spx_orders    BIGINT,
  total_withdrawn      NUMERIC,
  withdrawal_count     BIGINT,
  last_withdrawal_at   TIMESTAMPTZ,
  hpp_supplier_owed    NUMERIC,
  hpp_supplier_orders  BIGINT,
  hpp_supplier_count   INTEGER,
  ongkir_spx_owed      NUMERIC,
  ongkir_spx_orders    BIGINT,
  komisi_owed          NUMERIC,
  komisi_count         BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org          BIGINT;
  v_withdrawn    NUMERIC;
  v_cod_diterima NUMERIC;
BEGIN
  v_org := public.current_org_id();

  -- Total ditarik dari SPX ke bank (kumulatif)
  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM public.bank_withdrawals
  WHERE organization_id = v_org
    AND status IN ('Berhasil', 'APPROVED', 'COMPLETED');

  -- COD dari order yang sudah DITERIMA (uang sudah masuk ke SPX, dari tabel archive)
  SELECT COALESCE(SUM(cod_amount), 0) INTO v_cod_diterima
  FROM public.orders
  WHERE organization_id = v_org AND status = 'DITERIMA' AND payment_method = 'COD';

  RETURN QUERY
  SELECT
    -- ── IN-TRANSIT: baca orders_draft (aktif, belum terminal) ─────────────
    COALESCE((
      SELECT SUM(cod_amount) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD'
    ), 0),
    (SELECT COUNT(*) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD')::BIGINT,

    -- ── COD DI SPX: DITERIMA − total ditarik (dari orders archive) ────────
    GREATEST(v_cod_diterima - v_withdrawn, 0),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org
        AND status = 'DITERIMA' AND payment_method = 'COD')::BIGINT,

    -- ── RIWAYAT PENARIKAN ─────────────────────────────────────────────────
    v_withdrawn,
    (SELECT COUNT(*) FROM public.bank_withdrawals
      WHERE organization_id = v_org
        AND status IN ('Berhasil', 'APPROVED', 'COMPLETED'))::BIGINT,
    (SELECT MAX(withdrawal_date) FROM public.bank_withdrawals
      WHERE organization_id = v_org),

    -- ── UTANG HPP KE SUPPLIER ─────────────────────────────────────────────
    COALESCE((SELECT SUM(hpp_total) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING'), 0),
    (SELECT COUNT(*) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::INTEGER,

    -- ── UTANG ONGKIR SPX: DIKIRIM(draft) + DITERIMA(orders) ──────────────
    COALESCE((
      -- DIKIRIM di orders_draft (belum terminal)
      SELECT SUM(d.estimated_total_cost)
      FROM public.orders_draft d
      JOIN public.courier_channels cc ON cc.id = d.channel_id
      WHERE d.organization_id = v_org
        AND d.status = 'DIKIRIM'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    ), 0) +
    COALESCE((
      -- DITERIMA di orders (sudah terminal, tapi tagihan SPX belum lunas)
      SELECT SUM(o.estimated_total_cost)
      FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org
        AND o.status = 'DITERIMA'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    ), 0),
    (
      SELECT COUNT(*) FROM public.orders_draft d
      JOIN public.courier_channels cc ON cc.id = d.channel_id
      WHERE d.organization_id = v_org AND d.status = 'DIKIRIM'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    )::BIGINT +
    (
      SELECT COUNT(*) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status = 'DITERIMA'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    )::BIGINT,

    -- ── KOMISI OWED: dari orders terminal (EARNED, belum dibayar) ─────────
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED'), 0),
    (SELECT COUNT(*) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED')::BIGINT;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_financial_position() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_financial_position() TO authenticated;
