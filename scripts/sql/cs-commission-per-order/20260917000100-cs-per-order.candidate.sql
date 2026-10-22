-- CANDIDATE ONLY. No backfill or production application. Preserve existing grants.
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
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
  v_attribution_ok BOOLEAN;
  v_protect_cs boolean;
  v_protect_adv boolean;
  v_flat_count integer;
  v_flat_rates integer;
  v_percent_count integer;
  v_flat_seen integer := 0;
  v_flat_rate numeric;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  -- FIX 132: pakai COALESCE(o.advertiser_id, c.advertiser_id)
  -- Prioritaskan advertiser yang di-set langsung di order,
  -- fallback ke advertiser dari campaign kalau ada.
  SELECT
    o.organization_id, o.cs_id, o.status, o.order_date,
    COALESCE(o.advertiser_id, c.advertiser_id)
  INTO v_org, v_cs_id, v_status, v_order_date, v_adv_id
  FROM public.orders o
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  WHERE o.id = p_order_id FOR UPDATE OF o;

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

  SELECT EXISTS(SELECT 1 FROM public.commissions WHERE order_id=p_order_id
    AND role='cs' AND status IN ('EARNED','PAID')),
    EXISTS(SELECT 1 FROM public.commissions WHERE order_id=p_order_id
    AND role='advertiser' AND status IN ('EARNED','PAID'))
    INTO v_protect_cs,v_protect_adv;

  -- Resolve the same applicable rules as the loop before touching pending rows.
  -- Equal flat rules represent one fee per order, split deterministically in cents.
  IF NOT v_protect_cs THEN
    SELECT count(*) FILTER(WHERE r.rate_type='FLAT_PER_ORDER'),
      count(DISTINCT r.rate_value) FILTER(WHERE r.rate_type='FLAT_PER_ORDER'),
      max(r.rate_value) FILTER(WHERE r.rate_type='FLAT_PER_ORDER'),
      count(*) FILTER(WHERE r.rate_type='PERCENT_REVENUE')
      INTO v_flat_count,v_flat_rates,v_flat_rate,v_percent_count
    FROM public.order_items i
    CROSS JOIN LATERAL (
      SELECT rate_type,rate_value FROM public.commission_rules
      WHERE organization_id=v_org AND role='cs' AND active
        AND (user_id=v_cs_id OR user_id IS NULL)
        AND (product_id=i.product_id OR product_id IS NULL)
        AND (effective_from IS NULL OR effective_from<=v_order_date)
        AND (effective_to IS NULL OR effective_to>=v_order_date)
      ORDER BY user_id NULLS LAST,product_id NULLS LAST,effective_from DESC NULLS LAST
      LIMIT 1
    ) r WHERE i.order_id=p_order_id;
    IF v_flat_rates>1 OR (v_flat_count>0 AND v_percent_count>0) THEN
      RAISE EXCEPTION 'Conflicting CS flat rates: review per-order rule before recomputing';
    END IF;
  END IF;
  DELETE FROM public.commissions WHERE order_id=p_order_id AND status='PENDING'
    AND ((role='cs' AND NOT v_protect_cs) OR (role='advertiser' AND NOT v_protect_adv));

  FOR v_item IN
    SELECT oi.id AS item_id, oi.product_id, oi.qty, oi.price,
           (oi.qty * oi.price) AS line_revenue
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id ORDER BY oi.id
  LOOP
    v_revenue := COALESCE(v_item.line_revenue, 0);

    -- CS commission
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

    IF v_cs_rule.rate_type='FLAT_PER_ORDER' AND NOT v_protect_cs THEN
      v_flat_seen := v_flat_seen+1;
      v_cs_amount := round(v_flat_rate*v_flat_seen/v_flat_count,2)
        - round(v_flat_rate*(v_flat_seen-1)/v_flat_count,2);
    END IF;
    IF NOT v_protect_cs AND v_cs_id IS NOT NULL AND v_cs_amount > 0 THEN
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_cs_id, 'cs', v_cs_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW()
        WHERE commissions.status='PENDING';
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    -- Advertiser commission
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

    IF NOT v_protect_adv AND v_adv_id IS NOT NULL AND v_adv_amount > 0 THEN
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_adv_id, 'advertiser', v_adv_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW()
        WHERE commissions.status='PENDING';
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('order_id', p_order_id, 'inserted', v_inserted,
    'skipped', v_skipped, 'initial_status', v_initial_status);
END $function$;
