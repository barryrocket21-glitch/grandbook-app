-- 062 — Phase 8H: RPC check_orders_spx_coverage.
-- Applied via Supabase MCP (apply_migration: check_orders_spx_coverage_rpc).
--
-- Dari daftar order_id, balikin order yang tujuannya ke kota/provinsi yang
-- SPX TIDAK layani (master_wilayah_spx.is_serviceable=FALSE). Dipakai di
-- /orders/export-resi step Preview — warning sebelum generate file SPX.
--
-- Match: customer_province order → state_normalized (lower, strip "(...)"),
--        customer_city order → city_normalized (lower, strip "KAB./KOTA ").
-- SECURITY INVOKER — RLS orders scope ke org pemanggil; master_wilayah_spx
-- readable semua authenticated.

DROP FUNCTION IF EXISTS public.check_orders_spx_coverage(bigint[]);

CREATE OR REPLACE FUNCTION public.check_orders_spx_coverage(p_order_ids bigint[])
RETURNS TABLE(
  order_id bigint,
  order_number text,
  customer_name text,
  customer_city text,
  customer_province text
)
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT o.id, o.order_number, o.customer_name, o.customer_city, o.customer_province
  FROM public.orders o
  WHERE o.id = ANY(p_order_ids)
    AND o.customer_city IS NOT NULL
    AND btrim(o.customer_city) <> ''
    AND EXISTS (
      SELECT 1 FROM public.master_wilayah_spx m
      WHERE m.is_serviceable = FALSE
        AND m.state_normalized = lower(regexp_replace(btrim(COALESCE(o.customer_province, '')), '\s*\([^)]*\)\s*', '', 'g'))
        AND m.city_normalized = lower(regexp_replace(btrim(o.customer_city), '^(kab\.?|kota)\s+', '', 'i'))
    )
  ORDER BY o.order_number;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.check_orders_spx_coverage(bigint[]) TO authenticated;
