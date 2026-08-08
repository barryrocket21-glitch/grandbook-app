-- 136 — First-class raw attribution persistence + pembukuan export exposure.
-- ============================================================================
-- Problem:
-- - Admin sudah input kode atribusi saat WA paste, tapi selama ini raw code utama
--   cuma diparkir di meta JSONB.
-- - Export SPX TIDAK membawa kode atribusi, jadi data itu tidak bisa dipulihkan
--   dari file SPX saja.
-- - GrandBook butuh raw attribution code sebagai data operasional/audit yang
--   gampang dibaca, bukan cuma hasil resolve campaign_id.
--
-- Fix:
-- 1) tambah kolom first-class di orders_draft + orders
-- 2) backfill dari meta lama
-- 3) preserve saat draft dipromote ke orders
-- 4) expose ke list_pembukuan biar ikut kebawa export spreadsheet

ALTER TABLE public.orders_draft
  ADD COLUMN IF NOT EXISTS attribution_code_raw TEXT,
  ADD COLUMN IF NOT EXISTS attribution_platform TEXT,
  ADD COLUMN IF NOT EXISTS attribution_account_code TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign_marker TEXT;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attribution_code_raw TEXT,
  ADD COLUMN IF NOT EXISTS attribution_platform TEXT,
  ADD COLUMN IF NOT EXISTS attribution_account_code TEXT,
  ADD COLUMN IF NOT EXISTS attribution_campaign_marker TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_draft_attr_code
  ON public.orders_draft(organization_id, attribution_code_raw)
  WHERE attribution_code_raw IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_attr_code
  ON public.orders(organization_id, attribution_code_raw)
  WHERE attribution_code_raw IS NOT NULL;

-- Backfill existing rows from meta parkiran lama.
UPDATE public.orders_draft
SET
  attribution_code_raw = COALESCE(attribution_code_raw, NULLIF(meta->>'product_code_full', '')),
  attribution_platform = COALESCE(attribution_platform, NULLIF(meta->>'platform', '')),
  attribution_account_code = COALESCE(attribution_account_code, NULLIF(meta->>'atribusi_account', '')),
  attribution_campaign_marker = COALESCE(attribution_campaign_marker, NULLIF(meta->>'atribusi_campaign', ''))
WHERE meta IS NOT NULL;

UPDATE public.orders
SET
  attribution_code_raw = COALESCE(attribution_code_raw, NULLIF(meta->>'product_code_full', '')),
  attribution_platform = COALESCE(attribution_platform, NULLIF(meta->>'platform', '')),
  attribution_account_code = COALESCE(attribution_account_code, NULLIF(meta->>'atribusi_account', '')),
  attribution_campaign_marker = COALESCE(attribution_campaign_marker, NULLIF(meta->>'atribusi_campaign', ''))
WHERE meta IS NOT NULL;

-- Preserve kolom atribusi saat promote draft -> orders terminal.
CREATE OR REPLACE FUNCTION public.promote_draft_on_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_new_order_id BIGINT;
BEGIN
  IF NEW.status IN ('DITERIMA','RETUR','CANCEL')
     AND COALESCE(OLD.status,'') NOT IN ('DITERIMA','RETUR','CANCEL') THEN

    INSERT INTO public.orders(
      organization_id, order_number, external_order_id, resi,
      source_profile_id, channel_id,
      customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip,
      customer_address_detail, customer_address, wilayah_id,
      subtotal, shipping_cost, discount, total, cod_amount,
      estimated_shipping_net, estimated_cod_fee, estimated_ppn,
      estimated_total_cost, estimated_cash_in, estimated_profit,
      shipping_cost_actual, return_shipping_fee, retur_reason,
      tracking_no, tracking_status, delivered_at, returned_at,
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
      attribution_code_raw, attribution_platform, attribution_account_code, attribution_campaign_marker,
      origin_supplier_id, is_multi_origin, created_by,
      notes, meta, raw_data,
      internal_note, customer_note, reject_reason, cs_attempts,
      last_contact_at, tags,
      order_date, resi_printed_at,
      created_at, updated_at
    )
    VALUES (
      NEW.organization_id, NEW.order_number, NEW.external_order_id,
      COALESCE(NULLIF(TRIM(COALESCE(NEW.resi,'')),''), NEW.tracking_no),
      NEW.source_profile_id, NEW.channel_id,
      NEW.customer_name, NEW.customer_phone, NEW.customer_province, NEW.customer_city,
      NEW.customer_subdistrict, NEW.customer_village, NEW.customer_zip,
      NEW.customer_address_detail, NEW.customer_address, NEW.wilayah_id,
      NEW.subtotal, NEW.shipping_cost, NEW.discount, NEW.total, NEW.cod_amount,
      NEW.estimated_shipping_net, NEW.estimated_cod_fee, NEW.estimated_ppn,
      NEW.estimated_total_cost, NEW.estimated_cash_in, NEW.estimated_profit,
      NEW.actual_shipping_fee, NEW.return_shipping_fee, NEW.retur_reason,
      NEW.tracking_no, NEW.tracking_status, NEW.delivered_at, NEW.returned_at,
      NEW.payment_method, NEW.status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
      NEW.attribution_code_raw, NEW.attribution_platform, NEW.attribution_account_code, NEW.attribution_campaign_marker,
      NEW.origin_supplier_id, NEW.is_multi_origin, NEW.created_by,
      NEW.notes, NEW.meta, NEW.raw_data,
      NEW.internal_note, NEW.customer_note, NEW.reject_reason, NEW.cs_attempts,
      NEW.last_contact_at, NEW.tags,
      NEW.order_date, NEW.resi_printed_at,
      NEW.created_at, NOW()
    )
    RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items(
      organization_id, order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    INSERT INTO public.order_status_history(
      organization_id, order_id, order_number, from_status, to_status,
      changed_at, changed_by, source, raw_status, note
    ) VALUES (
      NEW.organization_id, v_new_order_id, NEW.order_number,
      OLD.status, NEW.status, NOW(), auth.uid(), 'spx_sync',
      NEW.tracking_status, 'Promote terminal via sync SPX'
    );

    PERFORM public.compute_commissions(v_new_order_id);

    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(), 'orders_draft', NEW.id::text, 'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'terminal_status', NEW.status)
    );

    DELETE FROM public.orders_draft WHERE id = NEW.id;
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_draft_on_terminal ON public.orders_draft;
CREATE TRIGGER trg_promote_draft_on_terminal
  BEFORE UPDATE OF status ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.promote_draft_on_terminal();

-- Pembukuan: expose raw attribution code biar ikut kebawa export.
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
  product_summary TEXT, attribution_code_raw TEXT,
  total NUMERIC, penjualan NUMERIC, ongkir NUMERIC, cod_amount NUMERIC,
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
      d.attribution_code_raw,
      d.total, (COALESCE(d.total,0) + COALESCE(d.shipping_cost,0)) AS penjualan, COALESCE(d.shipping_cost,0) AS ongkir, d.cod_amount, d.tracking_no, d.resi,
      d.actual_shipping_fee, d.return_shipping_fee, d.retur_reason,
      d.delivered_at, d.returned_at, d.exported_at,
      d.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0)::bigint AS qty,
      COALESCE(d.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.qty * (COALESCE(oi.hpp_snapshot,0) + COALESCE(oi.packing_fee_snapshot,0))) FROM public.order_items_draft oi WHERE oi.order_id = d.id), 0) AS hpp,
      COALESCE(d.estimated_profit, 0) AS gp,
      0::numeric AS rts_loss,
      NULL::numeric AS dicairkan_raw,
      NULL::timestamptz AS cod_settled_at
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
    UNION ALL
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
      o.attribution_code_raw,
      o.total, (COALESCE(o.total,0) + COALESCE(o.shipping_cost,0)) AS penjualan, COALESCE(o.shipping_cost,0) AS ongkir, o.cod_amount, o.tracking_no, o.resi,
      o.shipping_cost_actual AS actual_shipping_fee, o.return_shipping_fee, o.retur_reason,
      o.delivered_at, o.returned_at, NULL::timestamptz AS exported_at,
      o.payment_method,
      COALESCE((SELECT SUM(oi.qty) FROM public.order_items oi WHERE oi.order_id = o.id), 0)::bigint AS qty,
      COALESCE(o.estimated_total_cost, 0) AS biaya_kurir,
      COALESCE((SELECT SUM(oi.qty * (COALESCE(oi.hpp_snapshot,0) + COALESCE(oi.packing_fee_snapshot,0))) FROM public.order_items oi WHERE oi.order_id = o.id), 0) AS hpp,
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
           OR u.customer_name ILIKE '%'||p_search||'%'
           OR COALESCE(u.attribution_code_raw, '') ILIKE '%'||p_search||'%')
  ),
  cnt AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT f.source, f.id, f.order_number, f.order_date, f.status, f.zone,
         f.customer_name, f.customer_city, f.cs_name, f.channel_name,
         f.product_summary, f.attribution_code_raw,
         f.total, f.penjualan, f.ongkir, f.cod_amount, f.tracking_no, f.resi,
         f.actual_shipping_fee, f.return_shipping_fee, f.retur_reason,
         f.delivered_at, f.returned_at, f.exported_at,
         f.payment_method, f.qty,
         f.biaya_kurir AS est_biaya_kurir,
         (f.penjualan - f.biaya_kurir) AS est_omset,
         f.hpp AS est_hpp,
         ((f.penjualan - f.biaya_kurir - f.hpp) - f.gp) AS est_fee_cs,
         f.gp AS est_gross_profit,
         CASE f.status WHEN 'DITERIMA' THEN (f.penjualan - f.biaya_kurir)
                       WHEN 'RETUR' THEN -f.rts_loss
                       WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_omset,
         CASE f.status WHEN 'DITERIMA' THEN f.hpp
                       WHEN 'RETUR' THEN 0 WHEN 'CANCEL' THEN 0 WHEN 'FAKE' THEN 0 ELSE NULL END AS act_hpp,
         CASE f.status WHEN 'DITERIMA' THEN ((f.penjualan - f.biaya_kurir - f.hpp) - f.gp)
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
