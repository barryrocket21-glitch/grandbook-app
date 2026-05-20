-- =============================================================
-- PHASE 8K: WA Paste Converter Profile (Format Barry)
-- =============================================================
-- CS sering terima order via WhatsApp. Workflow: CS paste teks chat
-- yang sudah ter-format key-value (format real dari sample Barry),
-- engine parser pakai regex named groups → extract field → masuk
-- orders_draft (Antrian Kerja).
--
-- Format yang diharapkan (1 paste = 1 order, urutan field bebas):
--   (53) CS : Fiaro                                        (optional)
--   KODE ADV : Umo                                         (optional)
--   Produk : 1 PAVIO SLIPPERS (1pcs)                       (REQUIRED)
--
--   Nama penerima :  Jems Suawa                            (REQUIRED)
--   No HP : +6281354807676                                 (REQUIRED)
--   Alamat Lengkap : Lingkungan 4 RT 12 ...                (REQUIRED)
--   Kecamatan : Aertembaga                                 (optional)
--   Kota/Kab : Bitung                                      (optional)
--   Provinsi : Sulawesi Utara                              (optional)
--
--   Ongkir : Rp 63.000                                     (optional)
--   Total Bayar :  Rp 188.000                              (optional)
--   Pembayaran : COD                                       (optional)
--
--   Keterangan : Hitam 42                                  (optional)
--
-- Regex menggunakan lookahead positions supaya field order-independent.
-- Required fields gagal match → row skipped.
-- Optional fields pakai alternation: match field OR negative-lookahead
-- (field absent everywhere). Tanpa alternation, JS engine skip optional
-- inner match (lazy shortcut) → field selalu undefined.
--
-- IDEMPOTENT: ON CONFLICT (code) DO UPDATE.
-- =============================================================

INSERT INTO public.converter_profiles (
  code, name, direction, source_or_target,
  primary_key_field, primary_key_target,
  file_format, has_header_row, header_row_index,
  regex_pattern, active, notes
) VALUES (
  'wa_paste_keyvalue',
  'WA Paste — Format Barry (CS, ADV, Pembayaran)',
  'WA_PASTE',
  'WhatsApp',
  NULL, NULL,
  'TEXT', FALSE, 1,
  '(?=[\s\S]*?Nama\s+penerima\s*:\s*(?<customer_name>[^\n\r]+))(?=[\s\S]*?No\s+HP\s*:\s*(?<customer_phone>[^\n\r]+))(?=[\s\S]*?Alamat\s+Lengkap\s*:\s*(?<customer_address_detail>[^\n\r]+))(?=[\s\S]*?Produk\s*:\s*(?<product_name_raw>[^\n\r]+))(?=[\s\S]*?Kecamatan\s*:\s*(?<customer_subdistrict>[^\n\r]+)|(?![\s\S]*?Kecamatan\s*:))(?=[\s\S]*?Kota[/\s]*Kab\s*:\s*(?<customer_city>[^\n\r]+)|(?![\s\S]*?Kota[/\s]*Kab\s*:))(?=[\s\S]*?Provinsi\s*:\s*(?<customer_province>[^\n\r]+)|(?![\s\S]*?Provinsi\s*:))(?=[\s\S]*?Ongkir\s*:\s*(?<shipping_cost>[^\n\r]+)|(?![\s\S]*?Ongkir\s*:))(?=[\s\S]*?Total\s+Bayar\s*:\s*(?<total>[^\n\r]+)|(?![\s\S]*?Total\s+Bayar\s*:))(?=[\s\S]*?Pembayaran\s*:\s*(?<payment_method>[^\n\r]+)|(?![\s\S]*?Pembayaran\s*:))(?=[\s\S]*?Keterangan\s*:\s*(?<customer_note>[^\n\r]+)|(?![\s\S]*?Keterangan\s*:))(?=[\s\S]*?(?:\(\d+\)\s*)?CS\s*:\s*(?<cs_name>[^\n\r]+)|(?![\s\S]*?CS\s*:))(?=[\s\S]*?KODE\s+ADV\s*:\s*(?<advertiser_code>[^\n\r]+)|(?![\s\S]*?KODE\s+ADV\s*:))[\s\S]+',
  TRUE,
  'Phase 8K — Format real Barry. Required: Nama penerima, No HP, Alamat Lengkap, Produk. Optional: (NN) CS, KODE ADV, Kecamatan, Kota/Kab, Provinsi, Ongkir, Total Bayar, Pembayaran, Keterangan. Urutan field bebas. 1 paste = 1 order → orders_draft.'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  direction = EXCLUDED.direction,
  source_or_target = EXCLUDED.source_or_target,
  file_format = EXCLUDED.file_format,
  has_header_row = EXCLUDED.has_header_row,
  header_row_index = EXCLUDED.header_row_index,
  regex_pattern = EXCLUDED.regex_pattern,
  active = EXCLUDED.active,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- =============================================================
-- Field mappings (13 total — replace any prior set for this profile)
-- =============================================================
DELETE FROM public.converter_field_mappings
WHERE profile_id = (SELECT id FROM public.converter_profiles WHERE code = 'wa_paste_keyvalue');

WITH p AS (SELECT id FROM public.converter_profiles WHERE code = 'wa_paste_keyvalue')
INSERT INTO public.converter_field_mappings(
  profile_id, source_field, target_field, target_table, transform, required, display_order, notes
)
SELECT p.id, src.source_field, src.target_field, src.target_table, src.transform, src.required, src.display_order, src.notes
FROM p,
(VALUES
  -- Required (4)
  ('customer_name',           'customer_name',           'orders',      'trim',                 TRUE,  1,  'Required. Dari prefix "Nama penerima :".'),
  ('customer_phone',          'customer_phone',          'orders',      'normalize_phone_id',   TRUE,  2,  'Required. Strip non-digit (+62 prefix handled).'),
  ('customer_address_detail', 'customer_address_detail', 'orders',      'trim',                 TRUE,  3,  'Required. Dari prefix "Alamat Lengkap :".'),
  ('product_name_raw',        'product_name_raw',        'order_items', 'trim',                 TRUE,  4,  'Required. Single product per paste (qty default 1).'),
  -- Optional address (3)
  ('customer_subdistrict',    'customer_subdistrict',    'orders',      'trim',                 FALSE, 5,  'Optional. Dari prefix "Kecamatan :".'),
  ('customer_city',           'customer_city',           'orders',      'trim',                 FALSE, 6,  'Optional. Dari prefix "Kota/Kab :".'),
  ('customer_province',       'customer_province',       'orders',      'trim',                 FALSE, 7,  'Optional. Dari prefix "Provinsi :".'),
  -- Optional financial (3)
  ('shipping_cost',           'shipping_cost',           'orders',      'numeric_or_zero',      FALSE, 8,  'Optional. "Rp 63.000" → 63000.'),
  ('total',                   'total',                   'orders',      'numeric_or_zero',      FALSE, 9,  'Optional. "Rp 188.000" → 188000.'),
  ('payment_method',          'payment_method',          'orders',      'uppercase',            FALSE, 10, 'Optional. "Transfer" → TRANSFER, "COD" → COD (CHECK constraint enforces enum).'),
  -- Optional team + notes (3)
  ('customer_note',           'customer_note',           'orders',      'trim',                 FALSE, 11, 'Optional. Dari prefix "Keterangan :".'),
  ('cs_name',                 'cs_name',                 'orders',      'trim',                 FALSE, 12, 'Optional. Dari prefix "(NN) CS :" — engine auto-resolve ke cs_id by full_name.'),
  ('advertiser_code',         'advertiser_code',         'meta',        'trim',                 FALSE, 13, 'Optional. Dari prefix "KODE ADV :". Disimpan di orders.meta (bukan FK advertiser_id).')
) AS src(source_field, target_field, target_table, transform, required, display_order, notes);
