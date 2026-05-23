-- =============================================================
-- RLS perf — wrap auth.uid() di (SELECT auth.uid()) untuk 32 policies
-- Migration 070 — 2026-05-23
-- =============================================================
-- Supabase advisor flag `auth_rls_initplan` 40 cases (32 policies × multiple
-- matches per policy at qual+with_check). Tanpa SELECT wrap, PostgreSQL
-- evaluate `auth.uid()` PER ROW saat RLS qual/with_check di-check. Untuk
-- tabel 1000+ row → ratusan kali auth.uid() call per query → latency
-- ke-akumulasi (5-30% slower untuk wide scans).
--
-- Fix: `auth.uid() = X` -> `(SELECT auth.uid()) = X`. Subquery jadi
-- "initplan" yang PostgreSQL eval ONCE per query lalu cache. Same hold
-- untuk EXISTS subquery yg embed auth.uid() — kita re-write supaya
-- inner reference juga pakai (SELECT auth.uid()).
--
-- Semantic identik. Only perf improvement.
-- Verified post-apply: unwrapped count 32 -> 0.
-- =============================================================

ALTER POLICY ad_reconciliation_all ON public.ad_reconciliation
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid()) AND profiles.role = 'owner'));

ALTER POLICY ad_spend_own ON public.ad_spend
  USING (created_by = (SELECT auth.uid()));

ALTER POLICY channel_billing_config_modify ON public.channel_billing_config
  USING (EXISTS (SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid()) AND p.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY channel_billing_config_select ON public.channel_billing_config
  USING ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY commission_rules_write ON public.commission_rules
  USING (organization_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.profiles
           WHERE profiles.id = (SELECT auth.uid())
             AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (organization_id = public.current_org_id()
         AND EXISTS (SELECT 1 FROM public.profiles
           WHERE profiles.id = (SELECT auth.uid())
             AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY commissions_select ON public.commissions
  USING (user_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.profiles
           WHERE profiles.id = (SELECT auth.uid())
             AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY commissions_own ON public.commissions_legacy
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY converter_field_mappings_admin_write ON public.converter_field_mappings
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY converter_profiles_admin_write ON public.converter_profiles
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY converter_value_mappings_admin_write ON public.converter_value_mappings
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY courier_channel_rates_admin_write ON public.courier_channel_rates
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY courier_channel_statuses_admin_write ON public.courier_channel_statuses
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY courier_channels_admin_write ON public.courier_channels
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY couriers_admin_write ON public.couriers
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY cs_daily_leads_insert ON public.cs_daily_leads
  WITH CHECK (cs_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY cs_daily_leads_select ON public.cs_daily_leads
  USING (cs_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY cs_daily_leads_update ON public.cs_daily_leads
  USING (cs_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY daily_cs_report_delete ON public.daily_cs_report
  USING (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY daily_cs_report_insert ON public.daily_cs_report
  WITH CHECK (organization_id = public.current_org_id()
    AND (cs_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.profiles
           WHERE profiles.id = (SELECT auth.uid())
             AND profiles.role = ANY (ARRAY['owner','admin']))));

ALTER POLICY daily_cs_report_update ON public.daily_cs_report
  USING (organization_id = public.current_org_id()
    AND (cs_id = (SELECT auth.uid())
         OR EXISTS (SELECT 1 FROM public.profiles
           WHERE profiles.id = (SELECT auth.uid())
             AND profiles.role = ANY (ARRAY['owner','admin']))));

ALTER POLICY inbox_unmatched_products_write ON public.inbox_unmatched_products
  USING (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY master_wilayah_owner_write ON public.master_wilayah
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'owner'));

ALTER POLICY notifications_select ON public.notifications
  USING (recipient_id = (SELECT auth.uid())
    AND organization_id = public.current_org_id());

ALTER POLICY notifications_update ON public.notifications
  USING (recipient_id = (SELECT auth.uid()))
  WITH CHECK (recipient_id = (SELECT auth.uid()));

ALTER POLICY organizations_owner_write ON public.organizations
  USING (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles
    WHERE profiles.id = (SELECT auth.uid())
      AND profiles.role = 'owner'));

ALTER POLICY attr_values_write ON public.product_attribute_values
  USING (attribute_id IN (SELECT product_attributes.id FROM public.product_attributes
    WHERE product_attributes.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (attribute_id IN (SELECT product_attributes.id FROM public.product_attributes
    WHERE product_attributes.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY attrs_write ON public.product_attributes
  USING (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY prod_attr_assign_write ON public.product_attributes_assignment
  USING (product_id IN (SELECT products.id FROM public.products
    WHERE products.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (product_id IN (SELECT products.id FROM public.products
    WHERE products.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY variants_write ON public.product_variants
  USING (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (organization_id = public.current_org_id()
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));

ALTER POLICY "Users can update their own profiles" ON public.profiles
  USING ((SELECT auth.uid()) = id);

ALTER POLICY var_attr_values_write ON public.variant_attribute_values
  USING (variant_id IN (SELECT product_variants.id FROM public.product_variants
    WHERE product_variants.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])))
  WITH CHECK (variant_id IN (SELECT product_variants.id FROM public.product_variants
    WHERE product_variants.organization_id = public.current_org_id())
    AND EXISTS (SELECT 1 FROM public.profiles
      WHERE profiles.id = (SELECT auth.uid())
        AND profiles.role = ANY (ARRAY['owner','admin'])));
