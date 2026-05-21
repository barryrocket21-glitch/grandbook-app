-- 058 — Laporan Laba Rugi bulanan (RPC laba_rugi_summary).
-- Applied via Supabase MCP (apply_migration: laba_rugi_summary_rpc).
--
-- Step 3 pembukuan: halaman /laba-rugi. P&L cascade bulanan dengan 2 kolom —
-- Estimasi (proyeksi semua order) vs Aktual (status-aware realized).
--
--   Total Penjualan − Biaya Kurir = Omset
--   Omset − HPP − Fee CS         = Gross Profit
--   Σ Gross Profit − Biaya Iklan − Biaya Operasional = LABA BERSIH
--
-- Kolom EST = agregat semua order seperti semua sukses. Kolom ACT = realized:
--   • DITERIMA → dihitung penuh
--   • RETUR    → omset & GP = −rts_loss (rugi ongkir), HPP & Fee CS = 0
--                (barang balik, CS tidak dapat fee)
--   • CANCEL / FAKE → 0
--   • masih jalan (BARU/SIAP_KIRIM/DIKIRIM/PROBLEM) → belum dihitung
--
-- rts_loss = shipping_cost × rate `rts_shipping_rate` (per-channel, time-versioned
-- via get_active_rate). SPX saat ini rate 0 (retur belum dipotong ongkir); ekspedisi
-- lain rate 1 (retur dipotong 1× ongkir). Ganti rate = tambah row baru di
-- courier_channel_rates dengan effective_from baru — tidak perlu ubah RPC.
--
-- ad_spend (kolom `spend`) + operational_expenses (kolom `amount`) di-sum
-- terpisah, period-level — bukan per order.
--
-- SECURITY INVOKER — RLS user pemanggil yang berlaku (anti privilege escalation).
-- Semua tabel sumber sudah RLS org-scoped + scoping lewat current_org_id().

DROP FUNCTION IF EXISTS public.laba_rugi_summary(date, date);

CREATE OR REPLACE FUNCTION public.laba_rugi_summary(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS TABLE(
  order_count bigint,
  diterima_count bigint,
  retur_count bigint,
  batal_count bigint,
  inflight_count bigint,
  retur_pct numeric,
  est_penjualan numeric,
  est_biaya_kurir numeric,
  est_omset numeric,
  est_hpp numeric,
  est_fee_cs numeric,
  est_gross_profit numeric,
  act_penjualan numeric,
  act_biaya_kurir numeric,
  act_omset numeric,
  act_hpp numeric,
  act_fee_cs numeric,
  act_gross_profit numeric,
  total_ad_spend numeric,
  total_opex numeric,
  laba_bersih_est numeric,
  laba_bersih_act numeric
)
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org BIGINT;
  v_ad NUMERIC;
  v_opex NUMERIC;
BEGIN
  v_org := public.current_org_id();

  SELECT COALESCE(SUM(spend), 0) INTO v_ad
  FROM public.ad_spend
  WHERE organization_id = v_org
    AND (p_from IS NULL OR spend_date >= p_from)
    AND (p_to IS NULL OR spend_date <= p_to);

  SELECT COALESCE(SUM(amount), 0) INTO v_opex
  FROM public.operational_expenses
  WHERE organization_id = v_org
    AND (p_from IS NULL OR expense_date >= p_from)
    AND (p_to IS NULL OR expense_date <= p_to);

  RETURN QUERY
  WITH ord AS (
    SELECT
      o.status,
      COALESCE(o.total, 0) AS total,
      COALESCE(o.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE(o.estimated_profit, 0) AS gp,
      COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items oi WHERE oi.order_id = o.id), 0) AS hpp,
      COALESCE(o.shipping_cost, 0) * COALESCE(
        public.get_active_rate(o.channel_id, 'rts_shipping_rate', COALESCE(o.order_date, CURRENT_DATE)), 0
      ) AS rts_loss
    FROM public.orders o
    WHERE o.organization_id = v_org
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
  ),
  calc AS (
    SELECT
      status, total, biaya_kurir, hpp, gp, rts_loss,
      (total - biaya_kurir) AS omset,
      ((total - biaya_kurir - hpp) - gp) AS fee_cs
    FROM ord
  )
  SELECT
    COUNT(*)::bigint,
    COUNT(*) FILTER (WHERE status = 'DITERIMA')::bigint,
    COUNT(*) FILTER (WHERE status = 'RETUR')::bigint,
    COUNT(*) FILTER (WHERE status IN ('CANCEL', 'FAKE'))::bigint,
    COUNT(*) FILTER (WHERE status IN ('BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM'))::bigint,
    CASE WHEN COUNT(*) FILTER (WHERE status IN ('DITERIMA', 'RETUR')) > 0
      THEN ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'RETUR')
                 / COUNT(*) FILTER (WHERE status IN ('DITERIMA', 'RETUR')), 2)
      ELSE 0 END,
    COALESCE(SUM(total), 0),
    COALESCE(SUM(biaya_kurir), 0),
    COALESCE(SUM(omset), 0),
    COALESCE(SUM(hpp), 0),
    COALESCE(SUM(fee_cs), 0),
    COALESCE(SUM(gp), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN total ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN biaya_kurir ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN omset WHEN status = 'RETUR' THEN -rts_loss ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN hpp ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN fee_cs ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN gp WHEN status = 'RETUR' THEN -rts_loss ELSE 0 END), 0),
    v_ad,
    v_opex,
    COALESCE(SUM(gp), 0) - v_ad - v_opex,
    COALESCE(SUM(CASE WHEN status = 'DITERIMA' THEN gp WHEN status = 'RETUR' THEN -rts_loss ELSE 0 END), 0) - v_ad - v_opex
  FROM calc;
END;
$function$;
