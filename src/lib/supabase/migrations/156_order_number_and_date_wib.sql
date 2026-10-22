-- =============================================================
-- 156 — GrandBook order date/number uses WIB for new orders
-- =============================================================
-- Business rule: Barry's operations are in Indonesia. New WA paste/form
-- orders created around midnight must use Asia/Jakarta date for:
-- - GB-YYYYMMDD prefix
-- - default order_date / Tanggal Terbit GB
-- Existing historical rows are intentionally not backfilled.

CREATE OR REPLACE FUNCTION public.generate_order_number(org_id bigint)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (NOW() AT TIME ZONE 'Asia/Jakarta')::date;
  date_prefix text := TO_CHAR((NOW() AT TIME ZONE 'Asia/Jakarta'), 'YYYYMMDD');
  counter int;
  candidate text;
  attempt int := 0;
BEGIN
  LOOP
    SELECT COALESCE(MAX(suffix_no), 0) + 1
    INTO counter
    FROM (
      SELECT NULLIF(RIGHT(o.order_number, 6), '')::int AS suffix_no
      FROM public.orders o
      WHERE o.organization_id = org_id
        AND o.order_number LIKE 'GB-' || date_prefix || '-%'
      UNION ALL
      SELECT NULLIF(RIGHT(d.order_number, 6), '')::int AS suffix_no
      FROM public.orders_draft d
      WHERE d.organization_id = org_id
        AND d.order_number LIKE 'GB-' || date_prefix || '-%'
    ) existing
    WHERE suffix_no IS NOT NULL;

    candidate := 'GB-' || date_prefix || '-' || LPAD((counter + attempt)::text, 6, '0');

    PERFORM 1 FROM public.orders
      WHERE organization_id = org_id AND order_number = candidate;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.orders_draft
        WHERE organization_id = org_id AND order_number = candidate;
      IF NOT FOUND THEN
        RETURN candidate;
      END IF;
    END IF;

    attempt := attempt + 1;
    IF attempt > 50 THEN
      RAISE EXCEPTION 'generate_order_number: could not produce unique WIB number after 50 attempts for %', v_today;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.generate_order_number(bigint) TO authenticated;

ALTER TABLE public.orders_draft
  ALTER COLUMN order_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Jakarta')::date);

ALTER TABLE public.orders
  ALTER COLUMN order_date SET DEFAULT ((NOW() AT TIME ZONE 'Asia/Jakarta')::date);

NOTIFY pgrst, 'reload schema';
