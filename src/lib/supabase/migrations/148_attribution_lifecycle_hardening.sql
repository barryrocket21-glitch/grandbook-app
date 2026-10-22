-- 148 — Attribution lifecycle hardening.
-- ============================================================================
-- Guarantees:
-- 1) Raw attribution is persisted independently from campaign resolution.
-- 2) Every new draft has an explicit attribution_status (never silent NULL).
-- 3) Resolver reads first-class attribution columns and legacy meta fallback.
-- 4) Resolver retries after order items, resi, tracking, or attribution fields change.
--
-- A resi alone cannot invent a missing attribution code. It can, however, trigger
-- a retry once the raw attribution/reference data is present or campaign masters
-- become available.

ALTER TABLE public.orders_draft
  ADD COLUMN IF NOT EXISTS attribution_status TEXT;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attribution_status TEXT;

-- Existing rows are backfilled separately in bounded batches. Do not perform a
-- wide table update inside this migration: production datasets can exceed the
-- statement timeout. The DEFAULT below guarantees the invariant for new rows.

ALTER TABLE public.orders_draft
  ALTER COLUMN attribution_status SET DEFAULT 'PENDING';
ALTER TABLE public.orders
  ALTER COLUMN attribution_status SET DEFAULT 'PENDING';

ALTER TABLE public.orders_draft
  DROP CONSTRAINT IF EXISTS orders_draft_attribution_status_check;
ALTER TABLE public.orders_draft
  ADD CONSTRAINT orders_draft_attribution_status_check
  CHECK (attribution_status IN ('RESOLVED','PENDING','UNKNOWN'));
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_attribution_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_attribution_status_check
  CHECK (attribution_status IN ('RESOLVED','PENDING','UNKNOWN'));

CREATE INDEX IF NOT EXISTS idx_orders_draft_attribution_pending
  ON public.orders_draft(organization_id, attribution_status)
  WHERE attribution_status <> 'RESOLVED';

CREATE OR REPLACE FUNCTION public.resolve_order_attribution(p_ids bigint[] DEFAULT NULL::bigint[])
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT;
  r RECORD;
  v_camp RECORD;
  c_resolved INT := 0;
  c_pending INT := 0;
BEGIN
  v_org := public.current_org_id();

  FOR r IN
    SELECT
      d.id,
      d.meta,
      d.attribution_platform,
      d.attribution_account_code,
      d.attribution_campaign_marker
    FROM public.orders_draft d
    WHERE d.organization_id = v_org
      AND (p_ids IS NULL OR d.id = ANY(p_ids))
      AND COALESCE(
        d.attribution_account_code,
        NULLIF(d.meta->>'atribusi_account','')
      ) <> ''
      AND COALESCE(
        d.attribution_campaign_marker,
        NULLIF(d.meta->>'atribusi_campaign','')
      ) <> ''
      AND d.campaign_id IS NULL
  LOOP
    SELECT c.id AS campaign_id, a.advertiser_id
    INTO v_camp
    FROM public.campaigns c
    JOIN public.ad_accounts a ON a.id = c.account_id
    WHERE a.organization_id = v_org
      AND lower(a.platform) = lower(COALESCE(
        r.attribution_platform,
        NULLIF(r.meta->>'platform','')
      ))
      AND lower(a.account_code) = lower(COALESCE(
        r.attribution_account_code,
        NULLIF(r.meta->>'atribusi_account','')
      ))
      AND lower(c.campaign_marker) = lower(COALESCE(
        r.attribution_campaign_marker,
        NULLIF(r.meta->>'atribusi_campaign','')
      ))
    ORDER BY
      (EXISTS (
        SELECT 1
        FROM public.campaign_products cp
        JOIN public.order_items_draft oi ON oi.product_id = cp.product_id
        WHERE cp.campaign_id = c.id AND oi.order_id = r.id
      )) DESC,
      c.id ASC
    LIMIT 1;

    IF v_camp.campaign_id IS NOT NULL THEN
      UPDATE public.orders_draft d SET
        campaign_id = v_camp.campaign_id,
        advertiser_id = COALESCE(d.advertiser_id, v_camp.advertiser_id),
        attribution_status = 'RESOLVED',
        meta = jsonb_set(
          jsonb_set(COALESCE(d.meta,'{}'::jsonb), '{atribusi_pending}', 'false'::jsonb, true),
          '{atribusi_status}', '"RESOLVED"'::jsonb, true
        ),
        updated_at = now()
      WHERE d.id = r.id;
      c_resolved := c_resolved + 1;
    ELSE
      UPDATE public.orders_draft d SET
        attribution_status = CASE
          WHEN COALESCE(d.attribution_code_raw, NULLIF(d.meta->>'product_code_full','')) IS NULL
            THEN 'UNKNOWN'
          ELSE 'PENDING'
        END,
        meta = jsonb_set(
          COALESCE(d.meta,'{}'::jsonb),
          '{atribusi_status}',
          to_jsonb(CASE
            WHEN COALESCE(d.attribution_code_raw, NULLIF(d.meta->>'product_code_full','')) IS NULL
              THEN 'UNKNOWN' ELSE 'PENDING' END),
          true
        ),
        updated_at = now()
      WHERE d.id = r.id;
      c_pending := c_pending + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('resolved', c_resolved, 'still_pending', c_pending);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_auto_resolve_attribution()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.campaign_id IS NULL
     AND (
       COALESCE(NEW.attribution_account_code, '') <> ''
       OR COALESCE(NEW.meta->>'atribusi_account', '') <> ''
     )
     AND (
       COALESCE(NEW.attribution_campaign_marker, '') <> ''
       OR COALESCE(NEW.meta->>'atribusi_campaign', '') <> ''
     ) THEN
    PERFORM public.resolve_order_attribution(ARRAY[NEW.id]);
  ELSIF NEW.campaign_id IS NULL THEN
    UPDATE public.orders_draft
    SET attribution_status = CASE
          WHEN COALESCE(NEW.attribution_code_raw, NULLIF(NEW.meta->>'product_code_full','')) IS NULL
            THEN 'UNKNOWN' ELSE 'PENDING' END,
        meta = jsonb_set(
          COALESCE(NEW.meta,'{}'::jsonb), '{atribusi_status}',
          to_jsonb(CASE
            WHEN COALESCE(NEW.attribution_code_raw, NULLIF(NEW.meta->>'product_code_full','')) IS NULL
              THEN 'UNKNOWN' ELSE 'PENDING' END), true
        )
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_resolve_attribution ON public.orders_draft;
CREATE TRIGGER trg_auto_resolve_attribution
  AFTER INSERT OR UPDATE OF resi, tracking_no, attribution_code_raw,
    attribution_platform, attribution_account_code, attribution_campaign_marker
  ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_resolve_attribution();

CREATE OR REPLACE FUNCTION public.trg_retry_attribution_after_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public.resolve_order_attribution(ARRAY[NEW.order_id]);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_retry_attribution_after_item ON public.order_items_draft;
CREATE TRIGGER trg_retry_attribution_after_item
  AFTER INSERT OR UPDATE OF product_id ON public.order_items_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_retry_attribution_after_item();

CREATE OR REPLACE FUNCTION public.trg_sync_final_attribution_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.attribution_status := CASE
    WHEN NEW.campaign_id IS NOT NULL THEN 'RESOLVED'
    WHEN COALESCE(NEW.attribution_code_raw, NULLIF(NEW.meta->>'product_code_full','')) IS NULL
      THEN 'UNKNOWN'
    ELSE 'PENDING'
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_final_attribution_status ON public.orders;
CREATE TRIGGER trg_sync_final_attribution_status
  BEFORE INSERT OR UPDATE OF campaign_id, attribution_code_raw, meta
  ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_final_attribution_status();


