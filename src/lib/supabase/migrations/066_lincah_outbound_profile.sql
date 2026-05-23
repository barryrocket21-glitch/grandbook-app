-- =============================================================
-- 066 — Phase 8K-Geo: Lincah outbound converter profile
-- =============================================================
-- Lincah (aggregator) accepts one address line + postal code + a per-row
-- Tipe Pengiriman flag. Mirrors mengantar_outbound but column shape and
-- the COD label differ. channel_id is null because Lincah's courier
-- channels (NINJA_VIA_LINCAH, JNE_VIA_LINCAH, ...) aren't seeded yet —
-- Barry can add them via the existing courier-channel workflow and
-- update converter_profiles.channel_id once he uses Lincah.
-- =============================================================

INSERT INTO public.converter_profiles
  (code, name, direction, source_or_target, file_format, has_header_row,
   header_row_index, active, notes)
VALUES
  ('lincah_outbound',
   'Lincah (Mass Order Upload)',
   'OUTBOUND_TO_COURIER',
   'lincah',
   'XLSX',
   true,
   1,
   true,
   'Outbound ke aggregator Lincah. 13 kolom, alamat full (concat wilayah), Tipe Pengiriman = COD/NON COD. Set channel_id setelah courier_channel Lincah (NINJA_VIA_LINCAH / JNE_VIA_LINCAH / dsb) di-seed.')
ON CONFLICT (code) DO NOTHING;

-- Field mappings (13 columns, ordering = Lincah's Default Template)
WITH p AS (SELECT id FROM public.converter_profiles WHERE code = 'lincah_outbound')
INSERT INTO public.converter_field_mappings
  (profile_id, source_field, target_field, target_table, transform, required, display_order, notes)
SELECT p.id, m.source_field, m.target_field, 'file_column', m.transform, m.required, m.display_order, m.notes FROM p,
  (VALUES
    ('payment_method',             'Tipe Pengiriman',              NULL,          true,  1,  'COD / NON COD via value_mappings'),
    ('channel_courier_code',       'Kurir',                        NULL,          true,  2,  'Diisi dari channel order — Ninja/JNE/dsb via value_mappings'),
    ('customer_name',              'Nama Penerima',                NULL,          true,  3,  NULL),
    ('customer_phone',             'No. Telp. Penerima',           'phone_to_628', true,  4,  NULL),
    ('concat_address',             'Alamat Penerima',              NULL,          true,  5,  'Detail + kelurahan/kecamatan/kota/provinsi digabung'),
    ('customer_zip',               'Kode Pos Penerima',            NULL,          true,  6,  NULL),
    ('order_total_weight_kg',      'Berat (kg)',                   NULL,          true,  7,  NULL),
    ('order_items.total_qty',      'Jumlah Barang',                NULL,          true,  8,  NULL),
    ('order_items.product_summary','Isi Paket',                    NULL,          true,  9,  NULL),
    ('total_if_transfer',          'Harga Barang (Jika Non-COD)',  NULL,          false, 10, NULL),
    ('total_if_cod',               'Nilai COD (Jika COD)',         NULL,          false, 11, NULL),
    ('notes',                      'Catatan Pengiriman',           NULL,          false, 12, NULL),
    ('order_number',               'Kode Referensi',               NULL,          true,  13, NULL)
  ) AS m(source_field, target_field, transform, required, display_order, notes);

-- Value mappings: payment_method (raw enum) → Lincah label
WITH p AS (SELECT id FROM public.converter_profiles WHERE code = 'lincah_outbound')
INSERT INTO public.converter_value_mappings
  (profile_id, source_field, raw_value, mapped_value)
SELECT p.id, vm.source_field, vm.raw_value, vm.mapped_value FROM p,
  (VALUES
    ('payment_method', 'COD',      'COD'),
    ('payment_method', 'TRANSFER', 'NON COD')
  ) AS vm(source_field, raw_value, mapped_value);
