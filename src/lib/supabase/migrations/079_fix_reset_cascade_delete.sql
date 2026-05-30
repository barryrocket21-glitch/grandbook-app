-- 079 — Fix: Reset Data / DELETE FROM orders gagal (orders gak ke-hapus).
-- ============================================================================
-- Root cause: trigger trg_order_items_recompute (di order_items, fire INSERT/
-- UPDATE/DELETE) manggil compute_commissions(order_id). Pas DELETE FROM orders
-- → CASCADE ke order_items → trigger fire dgn OLD.order_id, tapi parent order
-- udah ke-hapus → compute_commissions RAISE 'Order % not found' → seluruh
-- DELETE abort → orders tetap 1548 (reset gagal diam-diam).
--
-- Fix 2 lapis:
--   1. trg_recompute_order_on_items_change: skip recompute kalau TG_OP=DELETE
--      dan order-nya udah gak ada (lagi di-cascade-delete).
--   2. compute_commissions: return graceful (bukan RAISE) kalau order not found
--      — defense in depth utk semua jalur cascade delete.
-- Plus: drop duplicate snapshot trigger trg_snapshot_hpp (dibuat mig 078;
--   trg_snapshot_hpp_order_items yg lama sudah ada + panggil fungsi yg sama).
-- Idempotent.

-- ----------------------------------------------------------------------------
-- Fix 1 — recompute trigger skip saat order lagi di-delete
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_recompute_order_on_items_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id BIGINT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Kalau item dihapus DAN parent order sudah gak ada (cascade delete dari
  -- DELETE FROM orders), gak ada yg perlu di-recompute → skip biar gak RAISE.
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = v_order_id) THEN
    RETURN OLD;
  END IF;

  PERFORM public.compute_commissions(v_order_id);
  PERFORM public.compute_order_costs(v_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ----------------------------------------------------------------------------
-- Fix 2 — compute_commissions return graceful kalau order not found.
--   Pakai server-side replace dari def live supaya gak perlu re-type fungsi
--   panjang (semua logic Brief #3 / gate tetap utuh). Idempotent.
-- ----------------------------------------------------------------------------
DO $patch$
DECLARE v_def text; v_new text;
BEGIN
  v_def := pg_get_functiondef('public.compute_commissions(bigint)'::regprocedure);
  v_new := replace(
    v_def,
    'RAISE EXCEPTION ''Order % not found'', p_order_id;',
    'RETURN jsonb_build_object(''order_id'', p_order_id, ''skipped'', ''order_not_found'');'
  );
  IF v_new <> v_def THEN EXECUTE v_new; END IF;
END;
$patch$;

-- ----------------------------------------------------------------------------
-- Fix 3 — drop duplicate snapshot trigger (mig 078 bikin trg_snapshot_hpp,
--   padahal trg_snapshot_hpp_order_items udah ada + panggil fungsi sama).
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_snapshot_hpp ON public.order_items;
