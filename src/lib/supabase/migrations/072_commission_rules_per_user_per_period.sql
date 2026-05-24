-- =============================================================
-- 072 — Phase 4A v2: commission_rules per-user + period support
-- =============================================================
-- Sebelum: commission_rules cuma punya role + product_id. Priority
-- (role+product) > (role only). Tidak ada per-user spesifik dan tidak
-- ada period validity.
--
-- Sekarang nambah:
--  1. user_id (UUID FK profiles, nullable) — kalau set, rule berlaku
--     khusus user itu (e.g. Lisa beda dari Miranda).
--  2. effective_from / effective_to (DATE, nullable) — period validity.
--     NULL = open-ended. compute_commissions filter berdasarkan
--     orders.order_date.
--
-- Lookup priority baru (4 tier):
--   1. (user_id + product_id specific)
--   2. (user_id only, product_id NULL)
--   3. (role + product_id specific, user_id NULL)
--   4. (role only, user_id NULL + product_id NULL)
--
-- Tie-breaker untuk overlapping period: effective_from DESC (newest period wins).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP FUNCTION IF EXISTS.
-- =============================================================

-- 1. Add columns
ALTER TABLE public.commission_rules
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS effective_from DATE,
  ADD COLUMN IF NOT EXISTS effective_to DATE;

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_commission_rules_user_id
  ON public.commission_rules(user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_commission_rules_active_effective
  ON public.commission_rules(active, effective_from, effective_to)
  WHERE active = TRUE;

-- 3. Rewrite compute_commissions with user_id + date filter
DROP FUNCTION IF EXISTS public.compute_commissions(BIGINT);

CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id BIGINT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT;
  v_cs_id UUID;
  v_adv_id UUID;
  v_status TEXT;
  v_order_date DATE;
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
  SELECT o.organization_id, o.cs_id, o.status, o.order_date, c.advertiser_id
  INTO v_org, v_cs_id, v_status, v_order_date, v_adv_id
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

  DELETE FROM public.commissions
  WHERE order_id = p_order_id AND status IN ('PENDING', 'EARNED');

  FOR v_item IN
    SELECT oi.id AS item_id, oi.product_id, oi.qty, oi.price,
           (oi.qty * oi.price) AS line_revenue
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    v_revenue := COALESCE(v_item.line_revenue, 0);

    -- CS rule lookup — priority: (user+product) > (user) > (role+product) > (role)
    SELECT * INTO v_cs_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'cs'
      AND active = TRUE
      AND (user_id = v_cs_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY
      user_id NULLS LAST,
      product_id NULLS LAST,
      effective_from DESC NULLS LAST
    LIMIT 1;

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

    -- Advertiser rule lookup (same priority logic)
    SELECT * INTO v_adv_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'advertiser'
      AND active = TRUE
      AND (user_id = v_adv_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY
      user_id NULLS LAST,
      product_id NULLS LAST,
      effective_from DESC NULLS LAST
    LIMIT 1;

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
    'skipped', v_skipped,
    'initial_status', v_initial_status
  );
END $function$;
