-- =============================================================
-- PHASE 8K: WA Paste Converter Profile
-- =============================================================
-- CS sering terima order via WhatsApp. Workflow: CS paste teks chat
-- yang sudah ter-format key-value (Nama: X / HP: Y / Alamat: Z / Produk: W),
-- engine parser pakai regex named groups → extract field → masuk
-- orders_draft (Antrian Kerja).
--
-- Format yang diharapkan (key-value strict, 1 paste = 1 order):
--   Nama: Budi Santoso
--   HP: 081234567890
--   Alamat: Jl. Mawar No. 5
--   Produk: Madu Hutan 250ml
--   Kota: Bandung           (optional)
--   Provinsi: Jawa Barat    (optional)
--   Kodepos: 40123          (optional)
--   Catatan: tolong dibungkus rapih  (optional)
--
-- Regex pattern menggunakan lookahead positions supaya field order-independent
-- (urutan field tidak harus persis). Case-insensitive untuk huruf pertama
-- (Nama|nama, HP|hp|Hp). Required fields gagal match → row skipped.
--
-- IDEMPOTENT: idempotent via ON CONFLICT (code) DO UPDATE.
-- =============================================================

INSERT INTO public.converter_profiles (
  code, name, direction, source_or_target,
  primary_key_field, primary_key_target,
  file_format, has_header_row, header_row_index,
  regex_pattern, active, notes
) VALUES (
  'wa_paste_keyvalue',
  'WA Paste — Key-Value Format',
  'WA_PASTE',
  'WhatsApp',
  NULL, NULL,
  'TEXT', FALSE, 1,
  -- Lookahead-based pattern. Required: Nama, HP, Alamat, Produk.
  -- Optional: Kota, Provinsi, Kodepos, Catatan.
  -- Each (?=...) is zero-width — order-independent.
  -- Final [\s\S]+ consumes text so re.exec advances (prevent infinite loop).
  -- Required fields use lookahead (must match or whole regex fails).
  -- Optional fields use alternation: match field OR negative-lookahead (field absent everywhere).
  -- Without alternation, `(?=...)?` lets JS engine skip the inner match (lazy match shortcut)
  -- causing optional named groups to never capture even when field is present.
  '(?=[\s\S]*?[Nn]ama\s*:\s*(?<customer_name>[^\n\r]+))(?=[\s\S]*?(?:HP|hp|Hp)\s*:\s*(?<customer_phone>[^\n\r]+))(?=[\s\S]*?[Aa]lamat\s*:\s*(?<customer_address_detail>[^\n\r]+))(?=[\s\S]*?[Pp]roduk\s*:\s*(?<product_name_raw>[^\n\r]+))(?=[\s\S]*?[Kk]ota\s*:\s*(?<customer_city>[^\n\r]+)|(?![\s\S]*?[Kk]ota\s*:))(?=[\s\S]*?[Pp]rovinsi\s*:\s*(?<customer_province>[^\n\r]+)|(?![\s\S]*?[Pp]rovinsi\s*:))(?=[\s\S]*?(?:[Kk]odepos|[Kk]ode\s*[Pp]os)\s*:\s*(?<customer_zip>[^\n\r]+)|(?![\s\S]*?(?:[Kk]odepos|[Kk]ode\s*[Pp]os)\s*:))(?=[\s\S]*?(?:[Cc]atatan|[Kk]et)\s*:\s*(?<customer_note>[^\n\r]+)|(?![\s\S]*?(?:[Cc]atatan|[Kk]et)\s*:))[\s\S]+',
  TRUE,
  'Phase 8K — 1 paste = 1 order. Engine target orders_draft (workspace pre-resi). CS edit detail (channel, harga, qty) di /orders/draft setelah import.'
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
-- Field mappings — source_field = named group dari regex
-- =============================================================
WITH p AS (SELECT id FROM public.converter_profiles WHERE code = 'wa_paste_keyvalue')
INSERT INTO public.converter_field_mappings(
  profile_id, source_field, target_field, target_table, transform, required, display_order, notes
)
SELECT p.id, src.source_field, src.target_field, src.target_table, src.transform, src.required, src.display_order, src.notes
FROM p,
(VALUES
  -- Required fields
  ('customer_name',           'customer_name',           'orders',      'trim',                 TRUE,  1,  'Required. Dari prefix "Nama:".'),
  ('customer_phone',          'customer_phone',          'orders',      'normalize_phone_id',   TRUE,  2,  'Required. Strip non-digit + normalize 62 prefix.'),
  ('customer_address_detail', 'customer_address_detail', 'orders',      'trim',                 TRUE,  3,  'Required. Free text address.'),
  ('product_name_raw',        'product_name_raw',        'order_items', 'trim',                 TRUE,  4,  'Required. Single product (qty=1 default).'),
  -- Optional fields
  ('customer_city',           'customer_city',           'orders',      'trim',                 FALSE, 5,  'Optional. Dari prefix "Kota:".'),
  ('customer_province',       'customer_province',       'orders',      'trim',                 FALSE, 6,  'Optional. Dari prefix "Provinsi:".'),
  ('customer_zip',            'customer_zip',            'orders',      'trim',                 FALSE, 7,  'Optional. Dari prefix "Kodepos:" / "Kode Pos:".'),
  ('customer_note',           'customer_note',           'orders',      'trim',                 FALSE, 8,  'Optional. Dari prefix "Catatan:" / "Ket:".')
) AS src(source_field, target_field, target_table, transform, required, display_order, notes)
ON CONFLICT (profile_id, source_field) DO UPDATE SET
  target_field = EXCLUDED.target_field,
  target_table = EXCLUDED.target_table,
  transform = EXCLUDED.transform,
  required = EXCLUDED.required,
  display_order = EXCLUDED.display_order,
  notes = EXCLUDED.notes;
