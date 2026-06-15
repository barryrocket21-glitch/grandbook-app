-- 132 — Fix compute_commissions: v_adv_id dari orders.advertiser_id (bukan hanya campaign)
-- ============================================================================
-- Bug: fungsi JOIN campaigns untuk dapat advertiser_id. Order yang punya
-- advertiser_id langsung di kolom orders tapi tidak punya campaign_id
-- → LEFT JOIN campaigns return NULL → v_adv_id = NULL → komisi advertiser 0.
-- 78 order dari 755 yang punya advertiser miss komisinya.
--
-- Fix: COALESCE(o.advertiser_id, c.advertiser_id) — orders-direct priority.
-- Idempotent. INVOKER.

CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
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
  v_attribution_ok BOOLEAN;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  SELECT
    o.organization_id, o.cs_id, o.status, o.order_date,
    COALESCE(o.advertiser_id, c.advertiser_id)
  INTO v_org, v_cs_id, v_status, v_order_date, v_adv_id
  FROM public.orders o
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  WHERE o.id = p_order_id;

  IF v_org IS NULL THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'skipped', 'order_not_found');
  END IF;

  v_attribution_ok := (v_cs_id IS NOT NULL);

  IF v_status IN ('RETUR', 'CANCEL', 'FAKE') THEN
    v_initial_status := 'VOIDED';
  ELSIF v_status = 'DITERIMA' AND v_attribution_ok THEN
    v_initial_status := 'EARNED';
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

    SELECT * INTO v_cs_rule
    FROM public.commission_rules
    WHERE organization_id = v_org AND role = 'cs' AND active = TRUE
      AND (user_id = v_cs_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY user_id NULLS LAST, product_id NULLS LAST, effective_from DESC NULLS LAST
    LIMIT 1;

    v_cs_amount := CASE
      WHEN v_cs_rule IS NULL THEN 0
      WHEN v_cs_rule.rate_type = 'FLAT_PER_ORDER' THEN COALESCE(v_cs_rule.rate_value, 0)
      WHEN v_cs_rule.rate_type = 'PERCENT_REVENUE' THEN v_revenue * (COALESCE(v_cs_rule.rate_value, 0) / 100.0)
      ELSE 0 END;

    IF v_cs_id IS NOT NULL AND v_cs_amount > 0 THEN
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_cs_id, 'cs', v_cs_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW();
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    SELECT * INTO v_adv_rule
    FROM public.commission_rules
    WHERE organization_id = v_org AND role = 'advertiser' AND active = TRUE
      AND (user_id = v_adv_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY user_id NULLS LAST, product_id NULLS LAST, effective_from DESC NULLS LAST
    LIMIT 1;

    v_adv_amount := CASE
      WHEN v_adv_rule IS NULL THEN 0
      WHEN v_adv_rule.rate_type = 'FLAT_PER_ORDER' THEN COALESCE(v_adv_rule.rate_value, 0)
      WHEN v_adv_rule.rate_type = 'PERCENT_REVENUE' THEN v_revenue * (COALESCE(v_adv_rule.rate_value, 0) / 100.0)
      ELSE 0 END;

    IF v_adv_id IS NOT NULL AND v_adv_amount > 0 THEN
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_adv_id, 'advertiser', v_adv_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW();
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('order_id', p_order_id, 'inserted', v_inserted,
    'skipped', v_skipped, 'initial_status', v_initial_status);
END $$;

REVOKE EXECUTE ON FUNCTION public.compute_commissions(BIGINT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.compute_commissions(BIGINT) TO authenticated;
