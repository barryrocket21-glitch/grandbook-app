-- 102 — Brief #16 PART 1: arahin agregasi /analytics + /laba-rugi ke UNION.
-- ============================================================================
-- Akar: RPC analitik/laba-rugi nargetin `orders` (kosong, 0 baris) — order hidup
-- di orders_draft. Fix: bikin 2 VIEW union (orders_draft ∪ orders) lalu repoint
-- semua RPC keuangan ke view itu.
--
-- NAMESPACE ID: draft pakai id NEGATIF (-id) di kedua view, terminal (orders)
-- pakai id positif. Join `oi.order_id = o.id` jadi aman (negatif ketemu negatif,
-- positif ketemu positif) — gak ada cross-match antar sumber. commissions.order_id
-- selalu positif → draft (negatif) otomatis 0 komisi (benar: draft belum ada komisi).
--
-- EST vs AKTUAL kejaga: RPC yang FILTER status='DITERIMA' (realized/act) tetap
-- akurat (draft gak pernah DITERIMA); yang SUM semua status (count, per-CS revenue,
-- per-produk qty) sekarang keisi dari draft. security_invoker=on → no advisor baru.

-- ── VIEW 1: header order (union) ────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_orders_union WITH (security_invoker = on) AS
SELECT
  (-d.id) AS id, d.organization_id, d.status, d.order_date, d.total, d.subtotal, d.discount,
  d.cod_amount, d.shipping_cost, d.actual_shipping_fee AS shipping_cost_actual,
  NULL::numeric AS payout_amount,
  d.estimated_total_cost, d.estimated_cash_in, d.estimated_profit, d.estimated_shipping_net,
  d.estimated_cod_fee, d.estimated_ppn, d.cs_id, d.cs_name, d.advertiser_id, d.admin_id,
  d.campaign_id, d.channel_id, d.wilayah_id, d.customer_city, d.customer_province,
  d.delivered_at, d.returned_at, d.created_at, d.order_number, d.priority, d.payment_method
FROM public.orders_draft d
UNION ALL
SELECT
  o.id, o.organization_id, o.status, o.order_date, o.total, o.subtotal, o.discount,
  o.cod_amount, o.shipping_cost, o.shipping_cost_actual, o.payout_amount,
  o.estimated_total_cost, o.estimated_cash_in, o.estimated_profit, o.estimated_shipping_net,
  o.estimated_cod_fee, o.estimated_ppn, o.cs_id, o.cs_name, o.advertiser_id, o.admin_id,
  o.campaign_id, o.channel_id, o.wilayah_id, o.customer_city, o.customer_province,
  o.delivered_at, o.returned_at, o.created_at, o.order_number, o.priority, o.payment_method
FROM public.orders o;
-- laba_rugi_summary = SECURITY INVOKER → query view sbg user authenticated.
-- GRANT SELECT (security_invoker=on → RLS underlying orders/orders_draft tetap
-- nge-scope per-org). REVOKE anon.
REVOKE ALL ON public.v_orders_union FROM PUBLIC, anon;
GRANT SELECT ON public.v_orders_union TO authenticated;

-- ── VIEW 2: line-item (union) ───────────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_order_items_union WITH (security_invoker = on) AS
SELECT (-di.order_id) AS order_id, di.organization_id, di.product_id, di.variant_id,
  di.qty, di.price, di.hpp_snapshot, di.packing_fee_snapshot,
  di.product_name_raw, di.variation, di.product_code_raw
FROM public.order_items_draft di
UNION ALL
SELECT i.order_id, i.organization_id, i.product_id, i.variant_id,
  i.qty, i.price, i.hpp_snapshot, i.packing_fee_snapshot,
  i.product_name_raw, i.variation, i.product_code_raw
FROM public.order_items i;
REVOKE ALL ON public.v_order_items_union FROM PUBLIC, anon;
GRANT SELECT ON public.v_order_items_union TO authenticated;

-- ── Repoint RPC keuangan ke view union (regex word-boundary, idempotent) ─────
-- `\morders\M` → match 'orders' sbg kata utuh (kena 'public.orders' & 'FROM orders'
-- tapi TIDAK kena 'orders_draft'/'total_orders'/'orders_agg'/'order_date'). Setelah
-- jadi 'v_orders_union', re-run gak match lagi ('orders' didahului '_') → idempotent.
DO $do$
DECLARE r RECORD; v_def TEXT;
BEGIN
  FOR r IN
    SELECT oid FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace AND proname = ANY(ARRAY[
      'laba_rugi_summary','analytics_daily_revenue','analytics_per_cs','analytics_per_advertiser',
      'analytics_per_channel','analytics_overview_v3','analytics_overview_v4',
      'analytics_profit_per_product_v2','analytics_profit_per_product_v3','analytics_roas_per_campaign',
      'analytics_funnel_per_product','analytics_cs_performance_per_product','analytics_campaigns_per_product',
      'analytics_variant_per_product','analytics_profit_per_product_per_platform'
    ])
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, '\morder_items\M', 'v_order_items_union', 'g');
    v_def := regexp_replace(v_def, '\morders\M', 'v_orders_union', 'g');
    BEGIN
      EXECUTE v_def;
    EXCEPTION WHEN OTHERS THEN
      -- fungsi ini refer kolom yang gak ada di view → biarin def lama (orders).
      RAISE WARNING 'skip repoint %: %', r.oid::regprocedure, SQLERRM;
    END;
  END LOOP;
END $do$;
