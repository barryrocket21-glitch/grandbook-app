-- 057 — Fix cost/commission engine stale HPP.
-- Applied via Supabase MCP (apply_migration: fix_stale_cost_engine_order_items_trigger
-- + backfill execute_sql + REVOKE).
--
-- Bug: compute_order_costs & compute_commissions fire pada trigger `orders`
-- (AFTER INSERT/UPDATE OF status,shipping_cost_actual,channel_id,total), tapi
-- order_items (yang bawa HPP) ke-insert sepersekian detik SETELAHNYA. Trigger
-- nggak re-fire pas item masuk → ~453/1067 order punya estimated_profit dengan
-- HPP=0 (profit kebesaran). Fix: trigger di order_items → recompute order induk.

CREATE OR REPLACE FUNCTION public.trg_recompute_order_on_items_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_order_id BIGINT;
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NOT NULL THEN
    -- commissions dulu — compute_order_costs baca tabel commissions
    PERFORM public.compute_commissions(v_order_id);
    PERFORM public.compute_order_costs(v_order_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.trg_recompute_order_on_items_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_order_items_recompute ON public.order_items;
CREATE TRIGGER trg_order_items_recompute
AFTER INSERT OR UPDATE OR DELETE ON public.order_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_order_on_items_change();

-- Backfill semua order existing (perbaiki ~453 yang stale). Saat dijalankan ke
-- prod, trigger audit `trg_audit_log_orders` + `trg_set_updated_at_orders`
-- di-disable sementara via ALTER TABLE supaya nggak nyampah audit log /
-- bump updated_at massal. Di fresh setup loop ini no-op (0 order).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.orders ORDER BY id LOOP
    PERFORM public.compute_commissions(r.id);
    PERFORM public.compute_order_costs(r.id);
  END LOOP;
END $$;
