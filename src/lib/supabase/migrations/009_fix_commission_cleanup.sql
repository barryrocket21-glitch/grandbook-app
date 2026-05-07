-- Phase 10 fix: compute_commissions sebelumnya gak hapus row ESTIMATED
-- yang user_id-nya bukan assignee lagi. Akibatnya kalau order di-reassign
-- (cs_id ganti), CS lama tetap punya commission row stale.
--
-- Sudah diapply ke production via exec_sql RPC.
--
-- Tweak:
-- 1. Awal function: delete ESTIMATED commissions yang (role, user_id) gak ada
--    di assignee list saat ini. EARNED/CANCELLED dibiarkan (historical)
-- 2. ON CONFLICT DO UPDATE sekarang punya WHERE clause yang skip kalau
--    status sudah bukan ESTIMATED — biar amount EARNED/CANCELLED gak
--    di-overwrite kalau order di-edit

CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_role text;
  v_user_id uuid;
  v_rule public.commission_rules%ROWTYPE;
  v_amount numeric;
  v_first_product_id bigint;
  v_assigned_pairs text[];
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_order.duplicate_of IS NOT NULL THEN RETURN; END IF;

  SELECT product_id INTO v_first_product_id
    FROM public.order_items WHERE order_id = p_order_id LIMIT 1;

  -- Build assignee list
  v_assigned_pairs := ARRAY[]::text[];
  IF v_order.cs_id IS NOT NULL THEN
    v_assigned_pairs := array_append(v_assigned_pairs, 'cs:' || v_order.cs_id::text);
  END IF;
  IF v_order.advertiser_id IS NOT NULL THEN
    v_assigned_pairs := array_append(v_assigned_pairs, 'advertiser:' || v_order.advertiser_id::text);
  END IF;
  IF v_order.admin_id IS NOT NULL THEN
    v_assigned_pairs := array_append(v_assigned_pairs, 'admin:' || v_order.admin_id::text);
  END IF;

  -- Cleanup ESTIMATED commissions yang sudah bukan assignee
  DELETE FROM public.commissions
  WHERE order_id = p_order_id
    AND status = 'ESTIMATED'
    AND (role || ':' || user_id::text) <> ALL (v_assigned_pairs);

  FOR v_role, v_user_id IN
    SELECT 'cs', v_order.cs_id WHERE v_order.cs_id IS NOT NULL
    UNION ALL
    SELECT 'advertiser', v_order.advertiser_id WHERE v_order.advertiser_id IS NOT NULL
    UNION ALL
    SELECT 'admin', v_order.admin_id WHERE v_order.admin_id IS NOT NULL
  LOOP
    SELECT * INTO v_rule
      FROM public.commission_rules
      WHERE role = v_role
        AND active = true
        AND (effective_from IS NULL OR effective_from <= v_order.order_date)
        AND (user_id IS NULL OR user_id = v_user_id)
        AND (product_id IS NULL OR product_id = v_first_product_id)
      ORDER BY
        ((user_id IS NOT NULL)::int + (product_id IS NOT NULL)::int) DESC,
        (user_id IS NOT NULL) DESC,
        (product_id IS NOT NULL) DESC,
        effective_from DESC NULLS LAST
      LIMIT 1;

    IF NOT FOUND THEN CONTINUE; END IF;

    IF v_rule.rule_type = 'PERCENT_REVENUE' THEN
      v_amount := v_order.total * v_rule.value / 100.0;
    ELSIF v_rule.rule_type = 'FLAT_PER_ORDER' THEN
      v_amount := v_rule.value;
    ELSE CONTINUE;
    END IF;

    -- Hanya update kalau status masih ESTIMATED. EARNED/CANCELLED jangan disentuh.
    INSERT INTO public.commissions (order_id, user_id, role, amount, status)
      VALUES (p_order_id, v_user_id, v_role, v_amount, 'ESTIMATED')
      ON CONFLICT (order_id, user_id, role) DO UPDATE
        SET amount = EXCLUDED.amount
        WHERE public.commissions.status = 'ESTIMATED';
  END LOOP;
END $$;
