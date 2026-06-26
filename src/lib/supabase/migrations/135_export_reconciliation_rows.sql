-- 135 — Export Rekonsiliasi: dump transaksi (order-grain) buat double-check di spreadsheet.
-- Tiap baris = 1 order terminal (arsip), lengkap dimensi atribusi + CS/advertiser/channel
-- + angka duit (omzet, cod, payout, hpp, komisi, profit est/act, selisih ongkir, dicairkan).
-- Kode atribusi "Pavio F.A.1" DISUSUN dari produk(campaign_products) + platform→huruf
-- (META→F/GOOGLE→G/SNACK→S/TIKTOK→T) + ad_accounts.account_code + campaigns.campaign_marker,
-- karena campaigns.campaign_code NULL. Mirror fungsi codeFor() di /marketing/ad-setup.
-- Kolom eksternal (bank/SPX/Meta) DIKOSONGIN di layer export TS, bukan di RPC.
-- Sumber: orders (arsip). Idempotent. SECURITY INVOKER, scoped current_org_id() + RLS.

DROP FUNCTION IF EXISTS public.export_reconciliation_rows(date, date, text[]);

CREATE OR REPLACE FUNCTION public.export_reconciliation_rows(
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL,
  p_status text[] DEFAULT NULL
)
RETURNS TABLE(
  order_number text, resi text, order_date date, delivered_at timestamptz,
  status text, payment_method text,
  kode_atribusi text, campaign_name text, platform text,
  advertiser_name text, cs_name text, channel_name text, product_summary text,
  harga_barang numeric, ongkir numeric, penjualan numeric,
  cod_amount numeric, payout_amount numeric, shipping_diff numeric,
  est_hpp numeric, komisi numeric, estimated_profit numeric, actual_profit numeric,
  dicairkan numeric, cod_settled_at timestamptz
)
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  RETURN QUERY
  WITH fo AS (
    SELECT o.* FROM public.orders o
     WHERE o.organization_id = v_org_id
       AND (p_from IS NULL OR o.order_date >= p_from)
       AND (p_to IS NULL OR o.order_date <= p_to)
       AND (p_status IS NULL OR o.status = ANY(p_status))
  ),
  oprod AS (
    SELECT oi.order_id,
      STRING_AGG(
        COALESCE(p.name, oi.product_name_raw, 'Unknown') || ' (' || oi.qty || 'x)',
        ', ' ORDER BY oi.id
      ) AS product_summary,
      SUM(oi.hpp_snapshot * oi.qty) AS hpp
    FROM public.order_items oi
    LEFT JOIN public.products p ON p.id = oi.product_id
    GROUP BY oi.order_id
  )
  SELECT
    fo.order_number, fo.resi, fo.order_date, fo.delivered_at,
    fo.status, fo.payment_method,
    (SELECT
        CASE WHEN c.campaign_marker IS NOT NULL AND a.account_code IS NOT NULL THEN
          COALESCE((SELECT pr.name || ' ' FROM public.campaign_products cp
                     JOIN public.products pr ON pr.id = cp.product_id
                     WHERE cp.campaign_id = c.id ORDER BY cp.product_id LIMIT 1), '')
          || CASE a.platform
               WHEN 'META' THEN 'F' WHEN 'GOOGLE' THEN 'G'
               WHEN 'SNACK' THEN 'S' WHEN 'TIKTOK' THEN 'T'
               ELSE COALESCE(LEFT(a.platform, 1), '?') END
          || '.' || a.account_code || '.' || c.campaign_marker
        ELSE NULL END
      FROM public.campaigns c
      LEFT JOIN public.ad_accounts a ON a.id = c.account_id
      WHERE c.id = fo.campaign_id) AS kode_atribusi,
    (SELECT campaign_name FROM public.campaigns WHERE id = fo.campaign_id) AS campaign_name,
    (SELECT a.platform FROM public.campaigns c
       LEFT JOIN public.ad_accounts a ON a.id = c.account_id
       WHERE c.id = fo.campaign_id) AS platform,
    (SELECT full_name FROM public.profiles WHERE id = fo.advertiser_id) AS advertiser_name,
    (SELECT full_name FROM public.profiles WHERE id = fo.cs_id) AS cs_name,
    (SELECT name FROM public.courier_channels WHERE id = fo.channel_id) AS channel_name,
    COALESCE(op.product_summary, '—') AS product_summary,
    fo.total AS harga_barang,
    fo.shipping_cost AS ongkir,
    (COALESCE(fo.total, 0) + COALESCE(fo.shipping_cost, 0)) AS penjualan,
    fo.cod_amount,
    fo.payout_amount,
    CASE WHEN fo.shipping_cost_actual IS NOT NULL
         THEN fo.shipping_cost_actual - fo.shipping_cost ELSE NULL END AS shipping_diff,
    COALESCE(op.hpp, 0) AS est_hpp,
    COALESCE((SELECT SUM(cm.amount) FROM public.commissions cm
               WHERE cm.order_id = fo.id AND cm.status IN ('EARNED', 'PAID')), 0) AS komisi,
    fo.estimated_profit,
    CASE WHEN fo.payout_amount IS NOT NULL THEN
      COALESCE(fo.payout_amount, 0)
        - COALESCE(fo.shipping_cost_actual, fo.shipping_cost, 0)
        - COALESCE(op.hpp, 0)
    ELSE NULL END AS actual_profit,
    CASE WHEN fo.cod_settled_at IS NOT NULL
         THEN COALESCE(fo.payout_amount, fo.cod_amount) ELSE NULL END AS dicairkan,
    fo.cod_settled_at
  FROM fo
  LEFT JOIN oprod op ON op.order_id = fo.id
  ORDER BY fo.order_date DESC, fo.id DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.export_reconciliation_rows(date, date, text[]) TO authenticated;
