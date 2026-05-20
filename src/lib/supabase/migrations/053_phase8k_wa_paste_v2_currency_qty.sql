-- =============================================================
-- PHASE 8K v2: WA Paste — Indonesian currency + qty extraction
-- =============================================================
-- Fix dua bug dari smoke test Barry:
--   1. "Rp 140.000" tersimpan sebagai 140 (numeric_or_zero treat "." sebagai
--      JS decimal point). New transform `numeric_id_currency` strip "."
--      sebagai thousand sep + replace "," sebagai decimal sep.
--   2. "Produk : 1 Sandal GD F (1pcs)" qty default 1 — regex update untuk
--      capture leading digit jadi qty + sisanya jadi product_name_raw.
--
-- IDEMPOTENT: CREATE OR REPLACE + DELETE+INSERT untuk mapping.
-- =============================================================

UPDATE public.converter_profiles
SET regex_pattern = '(?=[\s\S]*?Nama\s+penerima\s*:\s*(?<customer_name>[^\n\r]+))(?=[\s\S]*?No\s+HP\s*:\s*(?<customer_phone>[^\n\r]+))(?=[\s\S]*?Alamat\s+Lengkap\s*:\s*(?<customer_address_detail>[^\n\r]+))(?=[\s\S]*?Produk\s*:\s*(?:(?<qty>\d+)\s+)?(?<product_name_raw>[^\n\r]+))(?=[\s\S]*?Kecamatan\s*:\s*(?<customer_subdistrict>[^\n\r]+)|(?![\s\S]*?Kecamatan\s*:))(?=[\s\S]*?Kota[/\s]*Kab\s*:\s*(?<customer_city>[^\n\r]+)|(?![\s\S]*?Kota[/\s]*Kab\s*:))(?=[\s\S]*?Provinsi\s*:\s*(?<customer_province>[^\n\r]+)|(?![\s\S]*?Provinsi\s*:))(?=[\s\S]*?Ongkir\s*:\s*(?<shipping_cost>[^\n\r]+)|(?![\s\S]*?Ongkir\s*:))(?=[\s\S]*?Total\s+Bayar\s*:\s*(?<total>[^\n\r]+)|(?![\s\S]*?Total\s+Bayar\s*:))(?=[\s\S]*?Pembayaran\s*:\s*(?<payment_method>[^\n\r]+)|(?![\s\S]*?Pembayaran\s*:))(?=[\s\S]*?Keterangan\s*:\s*(?<customer_note>[^\n\r]+)|(?![\s\S]*?Keterangan\s*:))(?=[\s\S]*?(?:\(\d+\)\s*)?CS\s*:\s*(?<cs_name>[^\n\r]+)|(?![\s\S]*?CS\s*:))(?=[\s\S]*?KODE\s+ADV\s*:\s*(?<advertiser_code>[^\n\r]+)|(?![\s\S]*?KODE\s+ADV\s*:))[\s\S]+',
    updated_at = NOW()
WHERE code = 'wa_paste_keyvalue';

-- Switch shipping_cost + total ke numeric_id_currency
UPDATE public.converter_field_mappings
SET transform = 'numeric_id_currency'
WHERE profile_id = (SELECT id FROM public.converter_profiles WHERE code = 'wa_paste_keyvalue')
  AND source_field IN ('shipping_cost', 'total');

-- Add qty mapping (new named group)
INSERT INTO public.converter_field_mappings(
  profile_id, source_field, target_field, target_table, transform, required, display_order, notes
)
SELECT
  (SELECT id FROM public.converter_profiles WHERE code = 'wa_paste_keyvalue'),
  'qty', 'qty', 'order_items', 'numeric_or_zero', FALSE, 14,
  'Optional. Extract leading digit dari "Produk : N Nama Item (Npcs)". Default 1 di DB kalau tidak ke-capture.'
ON CONFLICT (profile_id, source_field) DO UPDATE SET
  target_field = EXCLUDED.target_field,
  target_table = EXCLUDED.target_table,
  transform = EXCLUDED.transform,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes;
