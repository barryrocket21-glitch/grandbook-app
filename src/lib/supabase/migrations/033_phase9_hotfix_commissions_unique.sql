-- =============================================================
-- Phase 9 hotfix — commissions unique + compute_commissions fix
-- =============================================================
-- Auto-test mengungkap 2 bug:
--
-- BUG 1: compute_commissions INSERT pakai kolom `organization_id` yang
--   TIDAK ADA di tabel commissions. Skema commissions org-scoped via
--   JOIN ke orders.order_id → orders.organization_id (pattern existing
--   Phase 4A/4B analytics). Fix: drop organization_id dari INSERT.
--
-- BUG 2: commissions_unique = (order_id, user_id, role) — block multi-
--   item commission. Phase 9 design: 1 row per (order, item, role).
--   Fix: ganti constraint jadi (order_id, order_item_id, user_id, role).
--
-- BUG 3 (bonus): commission_rules UNIQUE (org, role, product_id) tidak
--   guard duplicate default rules karena Postgres NULL-distinct. Owner
--   bisa accidentally bikin 2 default cs rules. Fix: partial unique
--   index untuk product_id IS NULL.
-- =============================================================

-- Fix BUG 2: replace commissions_unique
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_unique;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_unique
  UNIQUE (order_id, order_item_id, user_id, role);

-- Fix BUG 3: partial unique untuk default rule per role
DROP INDEX IF EXISTS idx_commission_rules_default_role;
CREATE UNIQUE INDEX idx_commission_rules_default_role
  ON public.commission_rules(organization_id, role)
  WHERE product_id IS NULL AND active = TRUE;

-- Fix BUG 1: recreate compute_commissions tanpa organization_id di INSERT
DROP FUNCTION IF EXISTS public.compute_commissions(BIGINT);
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org BIGINT;
  v_cs_id UUID;
  v_adv_id UUID;
  v_status TEXT;
  v_item RECORD;
  v_revenue NUMERIC;
  v_cs_rule RECORD;
  v_adv_rule RECORD;
  v_cs_amount NUMERIC;
  v_adv_amount NUMERIC;
  v_initial_status TEXT;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  SELECT o.organization_id, o.cs_id, o.status, c.advertiser_id
  INTO v_org, v_cs_id, v_status, v_adv_id
  FROM public.orders o
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  WHERE o.id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  IF v_status = 'DITERIMA' THEN
    v_initial_status := 'EARNED';
  ELSIF v_status IN ('RETUR', 'CANCEL', 'FAKE') THEN
    v_initial_status := 'VOIDED';
  ELSE
    v_initial_status := 'PENDING';
  END IF;

  -- Clear PENDING/EARNED — PAID/VOIDED protected
  DELETE FROM public.commissions
  WHERE order_id = p_order_id AND status IN ('PENDING', 'EARNED');

  FOR v_item IN
    SELECT oi.id AS item_id, oi.product_id, oi.qty, oi.price,
           (oi.qty * oi.price) AS line_revenue
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    v_revenue := COALESCE(v_item.line_revenue, 0);

    -- CS rule lookup
    SELECT * INTO v_cs_rule
    FROM public.commission_rules
    WHERE organization_id = v_org AND role = 'cs' AND active = TRUE
      AND (product_id = v_item.product_id OR product_id IS NULL)
    ORDER BY product_id NULLS LAST LIMIT 1;

    IF v_cs_rule IS NULL THEN
      v_cs_amount := 0;
    ELSIF v_cs_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_cs_amount := COALESCE(v_cs_rule.rate_value, 0);
    ELSIF v_cs_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_cs_amount := v_revenue * (COALESCE(v_cs_rule.rate_value, 0) / 100.0);
    ELSE
      v_cs_amount := 0;
    END IF;

    IF v_cs_id IS NOT NULL AND v_cs_amount > 0 THEN
      INSERT INTO public.commissions (
        order_id, order_item_id, user_id, role, amount, status
      ) VALUES (
        p_order_id, v_item.item_id, v_cs_id, 'cs', v_cs_amount, v_initial_status
      );
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    -- ADV rule lookup
    SELECT * INTO v_adv_rule
    FROM public.commission_rules
    WHERE organization_id = v_org AND role = 'advertiser' AND active = TRUE
      AND (product_id = v_item.product_id OR product_id IS NULL)
    ORDER BY product_id NULLS LAST LIMIT 1;

    IF v_adv_rule IS NULL THEN
      v_adv_amount := 0;
    ELSIF v_adv_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_adv_amount := COALESCE(v_adv_rule.rate_value, 0);
    ELSIF v_adv_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_adv_amount := v_revenue * (COALESCE(v_adv_rule.rate_value, 0) / 100.0);
    ELSE
      v_adv_amount := 0;
    END IF;

    IF v_adv_id IS NOT NULL AND v_adv_amount > 0 THEN
      INSERT INTO public.commissions (
        order_id, order_item_id, user_id, role, amount, status
      ) VALUES (
        p_order_id, v_item.item_id, v_adv_id, 'advertiser', v_adv_amount, v_initial_status
      );
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'inserted', v_inserted,
    'skipped',  v_skipped,
    'initial_status', v_initial_status
  );
END $$;

GRANT EXECUTE ON FUNCTION public.compute_commissions(BIGINT) TO authenticated;
