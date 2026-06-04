-- 124 — #3 Stok/Inventory v1: stok masuk manual − terkirim + retur − terkomit.
-- ============================================================================
-- Model AMAN (gak ada trigger auto-decrement yg rawan dobel-hitung):
--   stok_masuk = SUM(stock_movements RESTOCK/ADJUST)  ← owner catat manual pas beli/koreksi
--   terkomit   = qty order BARU/SIAP_KIRIM/PROBLEM (belum keluar, butuh stok)
--   terkirim   = qty order DIKIRIM/DITERIMA (udah keluar gudang)
--   retur      = qty order RETUR (balik stok)
--   sisa fisik = stok_masuk − terkirim + retur
--   available  = sisa − terkomit  (bisa dipakai order baru)
-- terkirim/retur/terkomit DIHITUNG live dari order → retur auto-balik, kirim auto-kurang.
-- Idempotent.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock_alert_threshold integer NOT NULL DEFAULT 5;

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  qty_change INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('RESTOCK','ADJUST')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON public.stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_org ON public.stock_movements(organization_id);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stock_mov_select ON public.stock_movements;
CREATE POLICY stock_mov_select ON public.stock_movements FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
DROP POLICY IF EXISTS stock_mov_write ON public.stock_movements;
CREATE POLICY stock_mov_write ON public.stock_movements FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id() AND public.get_user_role() IN ('owner','admin'));

-- catat pergerakan stok (restock/koreksi)
DROP FUNCTION IF EXISTS public.record_stock_movement(bigint, integer, text, text);
CREATE OR REPLACE FUNCTION public.record_stock_movement(p_product_id bigint, p_qty integer, p_reason text, p_note text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public'
AS $$
DECLARE v_org BIGINT; v_id BIGINT;
BEGIN
  v_org := public.current_org_id();
  INSERT INTO public.stock_movements(organization_id, product_id, qty_change, reason, note, created_by)
  VALUES (v_org, p_product_id, p_qty, p_reason, p_note, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION public.record_stock_movement(bigint, integer, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_stock_movement(bigint, integer, text, text) TO authenticated;

-- status inventory per produk (live)
DROP FUNCTION IF EXISTS public.inventory_status();
CREATE OR REPLACE FUNCTION public.inventory_status()
RETURNS TABLE(
  product_id bigint, product_name text, supplier_name text,
  stok_masuk numeric, terkomit numeric, terkirim numeric, retur numeric,
  sisa numeric, available numeric, threshold integer, status text
)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org BIGINT;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH oi AS (
    SELECT i.product_id, d.status::text AS st, i.qty FROM public.order_items_draft i JOIN public.orders_draft d ON d.id=i.order_id WHERE d.organization_id=v_org AND i.product_id IS NOT NULL
    UNION ALL
    SELECT i.product_id, o.status::text, i.qty FROM public.order_items i JOIN public.orders o ON o.id=i.order_id WHERE o.organization_id=v_org AND i.product_id IS NOT NULL
  ),
  agg AS (
    SELECT oi.product_id,
      COALESCE(SUM(oi.qty) FILTER (WHERE oi.st IN ('BARU','SIAP_KIRIM','PROBLEM')),0)::numeric AS terkomit,
      COALESCE(SUM(oi.qty) FILTER (WHERE oi.st IN ('DIKIRIM','DITERIMA')),0)::numeric AS terkirim,
      COALESCE(SUM(oi.qty) FILTER (WHERE oi.st='RETUR'),0)::numeric AS retur
    FROM oi GROUP BY oi.product_id
  ),
  sm AS (
    SELECT product_id, COALESCE(SUM(qty_change),0)::numeric AS masuk FROM public.stock_movements WHERE organization_id=v_org GROUP BY product_id
  )
  SELECT
    p.id, COALESCE(p.display_name,p.name) AS product_name, s.name,
    COALESCE(sm.masuk,0),
    COALESCE(agg.terkomit,0), COALESCE(agg.terkirim,0), COALESCE(agg.retur,0),
    (COALESCE(sm.masuk,0) - COALESCE(agg.terkirim,0) + COALESCE(agg.retur,0)) AS sisa,
    (COALESCE(sm.masuk,0) - COALESCE(agg.terkirim,0) + COALESCE(agg.retur,0) - COALESCE(agg.terkomit,0)) AS available,
    p.stock_alert_threshold,
    CASE
      WHEN (COALESCE(sm.masuk,0) - COALESCE(agg.terkirim,0) + COALESCE(agg.retur,0) - COALESCE(agg.terkomit,0)) <= 0 THEN 'Habis'
      WHEN (COALESCE(sm.masuk,0) - COALESCE(agg.terkirim,0) + COALESCE(agg.retur,0) - COALESCE(agg.terkomit,0)) <= p.stock_alert_threshold THEN 'Menipis'
      ELSE 'Ready'
    END AS status
  FROM public.products p
  LEFT JOIN public.suppliers s ON s.id = p.supplier_id
  LEFT JOIN agg ON agg.product_id = p.id
  LEFT JOIN sm ON sm.product_id = p.id
  WHERE p.organization_id = v_org AND p.active
  ORDER BY (COALESCE(sm.masuk,0) - COALESCE(agg.terkirim,0) + COALESCE(agg.retur,0) - COALESCE(agg.terkomit,0)) ASC;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.inventory_status() TO authenticated;
