-- Cost-only HPP edits preserve commission records. Signature/security/grants unchanged.
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

  -- HPP is not an input to commission rules. Preserve commission identities
  -- when only the historical HPP snapshot changes; retain normal cost refresh.
  IF TG_OP <> 'UPDATE' THEN
    PERFORM public.compute_commissions(v_order_id);
  ELSIF (to_jsonb(NEW) - 'hpp_snapshot') IS DISTINCT FROM
        (to_jsonb(OLD) - 'hpp_snapshot') THEN
    PERFORM public.compute_commissions(v_order_id);
  END IF;
  PERFORM public.compute_order_costs(v_order_id);
  RETURN COALESCE(NEW, OLD);
END;
$function$;
