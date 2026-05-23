-- =============================================================
-- Add 42 indexes untuk unindexed foreign keys
-- Migration 069 — 2026-05-23
-- =============================================================
-- Supabase advisor flag `unindexed_foreign_keys` 42 cases. Tanpa index,
-- DELETE/UPDATE parent table → sequential scan child table untuk cascade
-- check, juga query JOIN by FK column lambat.
--
-- Naming: idx_{table}_{column}. Idempotent via CREATE INDEX IF NOT EXISTS.
-- Trade-off: slight INSERT/UPDATE overhead vs faster JOIN + cascade.
-- Net positive untuk almost all FK columns.
--
-- Verified post-apply: 42 -> 0 unindexed FKs.
-- =============================================================

-- ad_spend
CREATE INDEX IF NOT EXISTS idx_ad_spend_created_by ON public.ad_spend(created_by);

-- audit_log (heavy write, index user_id critical untuk audit-by-user query)
CREATE INDEX IF NOT EXISTS idx_audit_log_user_id ON public.audit_log(user_id);

-- bank_withdrawals
CREATE INDEX IF NOT EXISTS idx_bank_withdrawals_channel_id ON public.bank_withdrawals(channel_id);
CREATE INDEX IF NOT EXISTS idx_bank_withdrawals_source_batch_id ON public.bank_withdrawals(source_batch_id);

-- commission_rules
CREATE INDEX IF NOT EXISTS idx_commission_rules_product_id ON public.commission_rules(product_id);

-- commissions
CREATE INDEX IF NOT EXISTS idx_commissions_paid_by ON public.commissions(paid_by);

-- commissions_legacy
CREATE INDEX IF NOT EXISTS idx_commissions_legacy_user_id ON public.commissions_legacy(user_id);

-- daily_cs_report
CREATE INDEX IF NOT EXISTS idx_daily_cs_report_created_by ON public.daily_cs_report(created_by);

-- expenses
CREATE INDEX IF NOT EXISTS idx_expenses_created_by ON public.expenses(created_by);

-- inbox_invalid_phone
CREATE INDEX IF NOT EXISTS idx_inbox_invalid_phone_resolved_by ON public.inbox_invalid_phone(resolved_by);

-- inbox_unmapped_statuses
CREATE INDEX IF NOT EXISTS idx_inbox_unmapped_statuses_channel_id ON public.inbox_unmapped_statuses(channel_id);
CREATE INDEX IF NOT EXISTS idx_inbox_unmapped_statuses_resolved_by ON public.inbox_unmapped_statuses(resolved_by);

-- inbox_unmatched_products
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_products_resolved_by ON public.inbox_unmatched_products(resolved_by);
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_products_resolved_to_product_id ON public.inbox_unmatched_products(resolved_to_product_id);
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_products_sample_order_id ON public.inbox_unmatched_products(sample_order_id);

-- inbox_unmatched_resi
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_resi_resolved_by ON public.inbox_unmatched_resi(resolved_by);
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_resi_resolved_to_order_id ON public.inbox_unmatched_resi(resolved_to_order_id);
CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_resi_source_profile_id ON public.inbox_unmatched_resi(source_profile_id);

-- inbox_unparsed_address
CREATE INDEX IF NOT EXISTS idx_inbox_unparsed_address_resolved_by ON public.inbox_unparsed_address(resolved_by);

-- operational_expenses
CREATE INDEX IF NOT EXISTS idx_operational_expenses_created_by ON public.operational_expenses(created_by);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_organization_id ON public.order_items(organization_id);

-- order_items_draft
CREATE INDEX IF NOT EXISTS idx_order_items_draft_organization_id ON public.order_items_draft(organization_id);
CREATE INDEX IF NOT EXISTS idx_order_items_draft_variant_id ON public.order_items_draft(variant_id);

-- order_status_history
CREATE INDEX IF NOT EXISTS idx_order_status_history_changed_by ON public.order_status_history(changed_by);
CREATE INDEX IF NOT EXISTS idx_order_status_history_organization_id ON public.order_status_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_order_status_history_source_profile_id ON public.order_status_history(source_profile_id);

-- orders (4 missing — critical untuk admin/campaign drilldown)
CREATE INDEX IF NOT EXISTS idx_orders_admin_id ON public.orders(admin_id);
CREATE INDEX IF NOT EXISTS idx_orders_campaign_id ON public.orders(campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON public.orders(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_source_profile_id ON public.orders(source_profile_id);

-- orders_draft (5 missing — same pattern as orders)
CREATE INDEX IF NOT EXISTS idx_orders_draft_admin_id ON public.orders_draft(admin_id);
CREATE INDEX IF NOT EXISTS idx_orders_draft_campaign_id ON public.orders_draft(campaign_id);
CREATE INDEX IF NOT EXISTS idx_orders_draft_created_by ON public.orders_draft(created_by);
CREATE INDEX IF NOT EXISTS idx_orders_draft_origin_supplier_id ON public.orders_draft(origin_supplier_id);
CREATE INDEX IF NOT EXISTS idx_orders_draft_source_profile_id ON public.orders_draft(source_profile_id);

-- product_attributes_assignment
CREATE INDEX IF NOT EXISTS idx_product_attributes_assignment_attribute_id ON public.product_attributes_assignment(attribute_id);

-- profiles (critical — used by current_org_id RLS helper)
CREATE INDEX IF NOT EXISTS idx_profiles_organization_id ON public.profiles(organization_id);

-- reconciliation_batches (4 missing)
CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_applied_by ON public.reconciliation_batches(applied_by);
CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_channel_id ON public.reconciliation_batches(channel_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_profile_id ON public.reconciliation_batches(profile_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_uploaded_by ON public.reconciliation_batches(uploaded_by);

-- supplier_payable
CREATE INDEX IF NOT EXISTS idx_supplier_payable_paid_by ON public.supplier_payable(paid_by);
