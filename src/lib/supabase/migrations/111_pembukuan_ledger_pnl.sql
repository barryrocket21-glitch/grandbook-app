-- 111 — Pembukuan jadi LEDGER KEUANGAN per-order (P&L EST vs AKTUAL + Dicairkan).
-- ============================================================================
-- Barry mau /orders/pembukuan nampilin ledger keuangan kaya pembukuan lama dia:
-- per baris ada Pendapatan, Biaya Kurir, Omset, HPP, Fee CS, Gross Profit —
-- dipasangin EST (proyeksi) vs AKTUAL (realisasi pas terminal) + kolom Dicairkan.
--
-- KAIDAH (samain PERSIS dgn laba_rugi_summary biar total footer rekonsil 1:1):
--   Biaya Kurir = estimated_total_cost
--   Omset       = total − biaya_kurir
--   HPP         = Σ(hpp_snapshot × qty)
--   Gross Profit= estimated_profit   (ANCHOR — ini yg di-SUM laba_rugi)
--   Fee CS      = (total − biaya_kurir − HPP) − gross_profit   (derivasi sama)
--
-- AKTUAL (realisasi, akrual basis — revenue diakui pas barang sampai):
--   • DITERIMA → nilai penuh (= EST)
--   • RETUR    → omset & GP = −rts_loss (rugi ongkir balik), HPP & Fee CS = 0
--   • CANCEL/FAKE → 0
--   • masih jalan (draft: BARU/SIAP_KIRIM/DIKIRIM/PROBLEM) → NULL (belum final)
--   rts_loss = shipping_cost × rate 'rts_shipping_rate' (get_active_rate, per-channel)
--
-- DICAIRKAN = payout_amount kalau cod_settled_at keisi (cuma di tabel orders/terminal).
-- Ad spend & opex TIDAK per-order (biaya periode) → ditarik di footer via laba_rugi_summary.
--
-- Signature param TETAP (date,date,text,text,int,int) → halaman gak perlu ganti cara panggil.
-- INVOKER, org-scoped, idempotent.

DROP FUNCTION IF EXISTS public.list_pembukuan(date, date, text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_pembukuan(
  p_from   DATE    DEFAULT NULL,
  p_to     DATE    DEFAULT NULL,
  p_status TEXT    DEFAULT NULL,
  p_search TEXT    DEFAULT NULL,
  p_limit  INTEGER DEFAULT 500,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
  source TEXT, id BIGINT, order_number TEXT, order_date DATE,
  status TEXT, zone TEXT,
  customer_name TEXT, customer_city TEXT, cs_name TEXT, channel_name TEXT,
  product_summary TEXT, total NUMERIC, cod_amount NUMERIC,
  tracking_no TEXT, resi TEXT,
  actual_shipping_fee NUMERIC, return_shipping_fee NUMERIC, retur_reason TEXT,
  delivered_at TIMESTAMPTZ, returned_at TIMESTAMPTZ, exported_at TIMESTAMPTZ,
  payment_method TEXT, qty BIGINT,
  est_biaya_kurir NUMERIC, est_omset NUMERIC, est_hpp NUMERIC,
  est_fee_cs NUMERIC, est_gross_profit NUMERIC,
  act_omset NUMERIC, act_hpp NUMERIC, act_fee_cs NUMERIC, act_gross_profit NUMERIC,
  dicairkan NUMERIC, cod_settled_at TIMESTAMPTZ,
  total_count BIGINT
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH unioned AS (
    -- IN-FLIGHT (orders_draft): proyeksi penuh, AKTUAL belum (NULL), belum cair
    SELECT
      'draft'::text AS source, d.id, d.order_number, d.order_date, d.status,
      CASE d.status
        WHEN 'BARU' THEN 'Baru'
        WHEN 'DIKIRIM' THEN 'Dikirim'
        WHEN 'PROBLEM' THEN 'Problem'
        WHEN 'SIAP_KIRIM' THEN CASE WHEN d.exported_at IS NOT NULL THEN 'Nunggu Resi' ELSE 'Antrian' END
        ELSE d.status
      END AS zone,
      d.customer_name, d.customer_city,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = d.cs_id), d.cs_name) AS cs_name,
      (SELECT name FROM public.courier_channels WHERE id = d.channel_id) AS channel_name,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items_draft oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = d.id), '—') AS product_summary,
      d.total, d.cod_amount, d.tracking_no, d.resi,
      d.actual_shipping_fee, d.return_shipping_fee, d.retur_reason,
      d.delivered_at, d.returned_at, d.exported_at,
      d.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0)::bigint AS qty,
      COALESCE(d.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0) AS hpp,
      COALESCE(d.estimated_profit, 0) AS gp,
      0::numeric AS rts_loss,
      NULL::numeric AS dicairkan_raw,
      NULL::timestamptz AS cod_settled_at
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
    UNION ALL
    -- TERMINAL (orders): EST tetap proyeksi, AKTUAL = realisasi per status, bisa cair
    SELECT
      'final'::text AS source, o.id, o.order_number, o.order_date, o.status,
      CASE o.status
        WHEN 'DITERIMA' THEN 'Arsip (Delivered)'
        WHEN 'RETUR' THEN 'Retur'
        WHEN 'CANCEL' THEN 'Batal'
        WHEN 'FAKE' THEN 'Fake'
        ELSE o.status
      END AS zone,
      o.customer_name, o.customer_city,
      COALESCE((SELECT full_name FROM public.profiles WHERE id = o.cs_id), o.cs_name) AS cs_name,
      (SELECT name FROM public.courier_channels WHERE id = o.channel_id) AS channel_name,
      COALESCE((SELECT STRING_AGG(COALESCE(p.display_name, p.name, oi.product_name_raw) || ' (' || oi.qty || 'x)', ', ' ORDER BY oi.id)
                FROM public.order_items oi LEFT JOIN public.products p ON p.id = oi.product_id
                WHERE oi.order_id = o.id), '—') AS product_summary,
      o.total, o.cod_amount, o.tracking_no, o.resi,
      o.shipping_cost_actual AS actual_shipping_fee, o.return_shipping_fee, o.retur_reason,
      o.delivered_at, o.returned_at, NULL::timestamptz AS exported_at,
      o.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items oi WHERE oi.order_id = o.id), 0)::bigint AS qty,
      COALESCE(o.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.hpp_snapshot * oi.qty) FROM public.order_items oi WHERE oi.order_id = o.id), 0) AS hpp,
      COALESCE(o.estimated_profit, 0) AS gp,
      COALESCE(o.shipping_cost, 0) * COALESCE(
        public.get_active_rate(o.channel_id, 'rts_shipping_rate', COALESCE(o.order_date, CURRENT_DATE)), 0
      ) AS rts_loss,
      CASE WHEN o.cod_settled_at IS NOT NULL THEN o.payout_amount ELSE NULL END AS dicairkan_raw,
      o.cod_settled_at
    FROM public.orders o
    WHERE o.organization_id = v_org
  ),
  filtered AS (
    SELECT * FROM unioned u
    WHERE (p_from IS NULL OR u.order_date >= p_from)
      AND (p_to IS NULL OR u.order_date <= p_to)
      AND (p_status IS NULL OR u.status = p_status)
      AND (p_search IS NULL
           OR u.order_number ILIKE '%'||p_search||'%'
           OR u.customer_name ILIKE '%'||p_search||'%')
  ),
  cnt AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT f.source, f.id, f.order_number, f.order_date, f.status, f.zone,
         f.customer_name, f.customer_city, f.cs_name, f.channel_name,
         f.product_summary, f.total, f.cod_amount, f.tracking_no, f.resi,
         f.actual_shipping_fee, f.return_shipping_fee, f.retur_reason,
         f.delivered_at, f.returned_at, f.exported_at,
         f.payment_method, f.qty,
         -- EST (proyeksi, selalu keisi)
         f.biaya_kurir AS est_biaya_kurir,
         (f.total - f.biaya_kurir) AS est_omset,
         f.hpp AS est_hpp,
         ((f.total - f.biaya_kurir - f.hpp) - f.gp) AS est_fee_cs,
         f.gp AS est_gross_profit,
         -- AKTUAL (realisasi per status terminal; NULL kalau belum final)
         CASE f.status WHEN 'DITERIMA' THEN (f.total - f.biaya_kurir)
                       WHEN 'RETUR' THEN -f.rts_loss
                       WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_omset,
         CASE f.status WHEN 'DITERIMA' THEN f.hpp
                       WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_hpp,
         CASE f.status WHEN 'DITERIMA' THEN ((f.total - f.biaya_kurir - f.hpp) - f.gp)
                       WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_fee_cs,
         CASE f.status WHEN 'DITERIMA' THEN f.gp
                       WHEN 'RETUR' THEN -f.rts_loss
                       WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_gross_profit,
         f.dicairkan_raw AS dicairkan, f.cod_settled_at,
         (SELECT n FROM cnt) AS total_count
  FROM filtered f
  ORDER BY f.order_date DESC NULLS LAST, f.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.list_pembukuan(date, date, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pembukuan(date, date, text, text, integer, integer) TO authenticated;
