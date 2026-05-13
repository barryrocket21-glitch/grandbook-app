-- =============================================================
-- Phase 8.5 — HPP snapshot trigger di order_items
-- =============================================================
-- Audit nemu: column `hpp_snapshot` udah ada di Phase 1, dan semua RPC
-- analytics udah pakai snapshot-based COGS (`SUM(qty * COALESCE(hpp_snapshot, 0))`).
-- TAPI 3 jalur INSERT (manual /orders/new, edit /orders/[id], bulk engine)
-- semua TIDAK populate hpp_snapshot. Result: NULL → COGS=0 → profit=revenue
-- (overstated). Production order_items empty post-cleanup, jadi belum ada damage.
--
-- Fix: BEFORE INSERT OR UPDATE trigger yang auto-populate hpp_snapshot dari
-- products.hpp saat hpp_snapshot belum di-set + product_id sudah valid.
-- UPDATE included supaya admin yang manual set product_id (kasus item dari
-- bulk upload yang tadinya unmatched) auto-trigger snapshot population.
--
-- Override behavior: kalau caller udah explicit set hpp_snapshot (e.g. import
-- historis dari CSV legacy yang punya actual cost), trigger TIDAK overwrite.
-- =============================================================

CREATE OR REPLACE FUNCTION public.snapshot_hpp_on_order_items()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hpp_snapshot IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT hpp INTO NEW.hpp_snapshot
    FROM public.products
    WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_snapshot_hpp_order_items ON public.order_items;
CREATE TRIGGER trg_snapshot_hpp_order_items
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_hpp_on_order_items();

-- =============================================================
-- Smoke test (manual):
--   1. INSERT order_items (product_id=X, hpp_snapshot=NULL)
--      → hpp_snapshot auto = products.hpp
--   2. INSERT order_items (product_id=NULL, hpp_snapshot=NULL)
--      → hpp_snapshot tetap NULL (no product to snapshot from)
--   3. UPDATE order_items SET product_id = X WHERE id = <row from #2>
--      → trigger fires, hpp_snapshot auto-populated
--   4. INSERT order_items (product_id=X, hpp_snapshot=50000)
--      → hpp_snapshot tetap 50000 (override respected)
-- =============================================================
