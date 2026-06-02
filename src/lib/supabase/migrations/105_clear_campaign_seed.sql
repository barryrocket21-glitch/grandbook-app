-- 105 — Brief #19 PART 2: hapus 19 campaign seed biar Candra daftar fresh.
-- ============================================================================
-- VERIFIED aman: orders_draft.campaign_id + orders.campaign_id semua NULL (0),
-- ad_spend = 0, ad_accounts = 0 → gak ada dependent. Cuma hapus DATA campaign
-- seed (+ campaign_products). JANGAN sentuh produk/ad_accounts/struktur tabel.
-- Idempotent (re-run hapus 0).

DELETE FROM public.campaign_products
WHERE campaign_id IN (SELECT id FROM public.campaigns);

DELETE FROM public.campaigns
WHERE organization_id IS NOT NULL;
