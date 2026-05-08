-- =============================================================
-- PHASE 1: Seed Data
-- =============================================================
-- Insert default organization, 2 couriers, 2 channels, status
-- mapping awal (SPX), dan 3 converter profiles dengan field/value
-- mappings lengkap.
--
-- IDEMPOTENT: pakai ON CONFLICT DO NOTHING / WHERE NOT EXISTS.
-- =============================================================

-- =============================================================
-- 1. Organization (already inserted in migration 010, idempotent)
-- =============================================================
INSERT INTO public.organizations (id, name, slug)
  VALUES (1, 'Default Organization', 'default')
  ON CONFLICT (id) DO NOTHING;

UPDATE public.profiles SET organization_id = 1 WHERE organization_id IS NULL;

-- =============================================================
-- 2. Couriers
-- =============================================================
INSERT INTO public.couriers (code, name, active) VALUES
  ('SPX', 'Shopee Express', TRUE),
  ('JNE', 'JNE', TRUE)
  ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 3. Courier Channels
-- =============================================================
INSERT INTO public.courier_channels (courier_id, code, name, aggregator, active) VALUES
  ((SELECT id FROM public.couriers WHERE code='SPX'), 'SPX_DIRECT', 'SPX (Direct)', NULL, TRUE),
  ((SELECT id FROM public.couriers WHERE code='JNE'), 'JNE_VIA_MENGANTAR', 'JNE via Mengantar', 'MENGANTAR', TRUE)
  ON CONFLICT (code) DO NOTHING;

-- =============================================================
-- 4. Status Mapping (SPX best-guess from common dashboard labels)
-- =============================================================
INSERT INTO public.courier_channel_statuses (channel_id, raw_status, internal_status) VALUES
  ((SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'), 'Delivered', 'DITERIMA'),
  ((SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'), 'Returned to Sender', 'RETUR'),
  ((SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'), 'Cancelled', 'CANCEL'),
  ((SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'), 'On Process', 'DIKIRIM'),
  ((SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'), 'Pickup', 'DIKIRIM')
  ON CONFLICT (channel_id, raw_status) DO NOTHING;
-- Mengantar/JNE: skip sampai user provide raw status sample dari file rekonsil.

-- =============================================================
-- 5. Converter Profile #1: Orderonline Inbound
-- =============================================================
INSERT INTO public.converter_profiles (
  code, name, direction, source_or_target, channel_id,
  primary_key_field, primary_key_target, file_format, file_delimiter, has_header_row, header_row_index, notes
) VALUES (
  'orderonline_inbound', 'Orderonline (Order Baru)', 'INBOUND_ORDER', 'orderonline',
  NULL,
  'order_id', 'external_order_id', 'CSV', ',', TRUE, 1,
  'Order baru dari platform Orderonline. Phone diasumsikan 628xxx atau 8xxx, harus dinormalisasi ke 08xxx. Tanggal format DD-MM-YYYY - HH:MM.'
) ON CONFLICT (code) DO NOTHING;

-- Field mappings (15 fields)
INSERT INTO public.converter_field_mappings (profile_id, source_field, target_field, target_table, transform, required, display_order) VALUES
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'order_id', 'external_order_id', 'orders', NULL, TRUE, 1),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'name', 'customer_name', 'orders', NULL, TRUE, 2),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'phone', 'customer_phone', 'orders', 'normalize_phone_id', TRUE, 3),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'address', 'customer_address', 'orders', NULL, TRUE, 4),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'product', 'product_name_raw', 'order_items', NULL, TRUE, 5),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'variation', 'variation', 'order_items', NULL, FALSE, 6),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'product_code', 'product_code_raw', 'order_items', NULL, FALSE, 7),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'product_price', 'price', 'order_items', NULL, TRUE, 8),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'quantity', 'qty', 'order_items', NULL, TRUE, 9),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'payment_method', 'payment_method', 'orders', 'uppercase', TRUE, 10),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'courier', 'courier_raw', 'meta', NULL, FALSE, 11),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'shipping_cost', 'shipping_cost', 'orders', NULL, TRUE, 12),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'gross_revenue', 'total', 'orders', NULL, TRUE, 13),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'created_at', 'order_date', 'orders', 'parse_date_dd-mm-yyyy', TRUE, 14),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'handled_by', 'cs_name', 'orders', NULL, FALSE, 15)
  ON CONFLICT (profile_id, source_field) DO NOTHING;

-- Value mappings (payment_method)
INSERT INTO public.converter_value_mappings (profile_id, source_field, raw_value, mapped_value) VALUES
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'payment_method', 'cod', 'COD'),
  ((SELECT id FROM public.converter_profiles WHERE code='orderonline_inbound'), 'payment_method', 'bank_transfer', 'TRANSFER')
  ON CONFLICT (profile_id, source_field, raw_value) DO NOTHING;

-- =============================================================
-- 6. Converter Profile #2: SPX Financial Rekonsil
-- =============================================================
INSERT INTO public.converter_profiles (
  code, name, direction, source_or_target, channel_id,
  primary_key_field, primary_key_target, file_format, has_header_row, header_row_index, notes
) VALUES (
  'spx_financial_rekonsil', 'SPX (Financial Report)', 'INBOUND_REKONSIL', 'spx',
  (SELECT id FROM public.courier_channels WHERE code='SPX_DIRECT'),
  'Tracking Number', 'resi', 'XLSX', TRUE, 2,
  'File punya 2 baris header (group + column). Header sebenarnya di row 2. Order status sering kosong, status diinferred dari kombinasi Escrow/COD/Return Fee di Phase 3 engine.'
) ON CONFLICT (code) DO NOTHING;

-- Field mappings (10 fields)
INSERT INTO public.converter_field_mappings (profile_id, source_field, target_field, target_table, transform, required, display_order) VALUES
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Tracking Number', 'resi', 'orders', NULL, TRUE, 1),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Sender Name', 'sender_name', 'meta', NULL, FALSE, 2),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Receiver Name', 'receiver_name_verify', 'meta', NULL, FALSE, 3),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Delivered/Returned Time', 'status_changed_at', 'orders', 'parse_datetime_yyyy-mm-dd', FALSE, 4),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'COD Amount (IDR)', 'cod_amount', 'orders', 'numeric_or_zero', FALSE, 5),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Total Fee (IDR)', 'total_fee_actual', 'meta', 'numeric_or_zero', FALSE, 6),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Actual Shipping Fee (IDR)', 'shipping_cost_actual', 'orders', 'numeric_or_zero', FALSE, 7),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Return Fee (IDR)', 'return_fee', 'meta', 'numeric_or_zero', FALSE, 8),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Adjustment Transaction Amount (IDR)', 'adjustment_fee', 'meta', 'numeric_or_zero', FALSE, 9),
  ((SELECT id FROM public.converter_profiles WHERE code='spx_financial_rekonsil'), 'Escrow amount (IDR)', 'payout_amount', 'orders', 'numeric_or_zero', FALSE, 10)
  ON CONFLICT (profile_id, source_field) DO NOTHING;

-- =============================================================
-- 7. Converter Profile #3: Mengantar Outbound (JNE)
-- =============================================================
INSERT INTO public.converter_profiles (
  code, name, direction, source_or_target, channel_id,
  primary_key_field, primary_key_target, file_format, file_delimiter, file_encoding, has_header_row, header_row_index, notes
) VALUES (
  'mengantar_outbound', 'Mengantar (Export ke JNE)', 'OUTBOUND_TO_COURIER', 'mengantar',
  (SELECT id FROM public.courier_channels WHERE code='JNE_VIA_MENGANTAR'),
  NULL, NULL, 'CSV', ';', 'utf-8-sig', TRUE, 1,
  'Template Mengantar.com untuk upload bulk order. Delimiter ;, encoding utf-8-sig. Field computed (total_weight, product_summary, dst.) di-resolve di engine Phase 3.'
) ON CONFLICT (code) DO NOTHING;

-- Field mappings (14 fields). target_table='file_column' for OUTBOUND.
INSERT INTO public.converter_field_mappings (profile_id, source_field, target_field, target_table, transform, required, display_order) VALUES
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_name', 'Nama Penerima', 'file_column', NULL, TRUE, 1),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_address_detail', 'Alamat Penerima', 'file_column', NULL, TRUE, 2),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_phone', 'Nomor Telepon', 'file_column', 'phone_to_628', TRUE, 3),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_zip', 'Kode Pos', 'file_column', NULL, FALSE, 4),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'order_items.total_weight', 'Berat', 'file_column', 'kg_format', TRUE, 5),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'total_if_transfer', 'Harga Barang (Jika NON-COD)', 'file_column', NULL, FALSE, 6),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'total_if_cod', 'Nilai COD (Jika COD)', 'file_column', NULL, FALSE, 7),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'order_items.product_summary', 'Isi Paketan (Nama Produk)', 'file_column', NULL, TRUE, 8),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_village', '*Kelurahan', 'file_column', NULL, FALSE, 9),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'customer_subdistrict', '*Kecamatan', 'file_column', NULL, FALSE, 10),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'order_items.total_qty', '**Quantity', 'file_column', NULL, TRUE, 11),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'order_number', 'Formulir ID', 'file_column', NULL, TRUE, 12),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'notes', '*Instruksi Pengiriman', 'file_column', NULL, FALSE, 13),
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'channel_courier_code', 'Courier', 'file_column', NULL, TRUE, 14)
  ON CONFLICT (profile_id, source_field) DO NOTHING;

-- Value mapping for Courier column (channel code → courier name di Mengantar)
INSERT INTO public.converter_value_mappings (profile_id, source_field, raw_value, mapped_value) VALUES
  ((SELECT id FROM public.converter_profiles WHERE code='mengantar_outbound'), 'channel_courier_code', 'JNE_VIA_MENGANTAR', 'JNE')
  ON CONFLICT (profile_id, source_field, raw_value) DO NOTHING;
