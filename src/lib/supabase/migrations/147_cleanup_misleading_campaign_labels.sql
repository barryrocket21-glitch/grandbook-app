-- 147 — Cleanup misleading campaign labels after attribution repair.
-- ============================================================================
-- Only rename clearly misleading labels where raw attribution/product/account
-- already proves the intended canonical code.

UPDATE public.campaigns
SET campaign_name = 'Ramuan Segar Waras F.A.1', updated_at = now()
WHERE id = 128 AND campaign_name = '1.Segar Waras F.A.1';

UPDATE public.campaigns
SET campaign_name = 'Pembasmi Rayap F.B.1', updated_at = now()
WHERE id = 131 AND campaign_name = '1.Spray Rayap F.B.1';

UPDATE public.campaigns
SET campaign_name = 'Shower Jet F.B.1', updated_at = now()
WHERE id = 132 AND campaign_name = '1.Shower Jet F.A.1';
