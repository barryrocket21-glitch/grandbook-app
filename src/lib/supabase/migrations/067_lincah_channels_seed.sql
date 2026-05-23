-- =============================================================
-- 067 — Phase 8K-Geo: seed Lincah courier channels + value mappings
-- =============================================================
-- Bikin Lincah profile fully usable end-to-end. Lincah aggregator routes
-- ke beberapa courier (JNE, Ninja, J&T, SiCepat); tiap kombinasi punya
-- channel sendiri. Value mappings translate channel_courier_code
-- internal ke string yang Lincah expect di file output.
-- =============================================================

-- 1. New couriers (JNE & ANTERAJA udah ada)
INSERT INTO public.couriers (code, name)
VALUES
  ('NINJA', 'Ninja Xpress'),
  ('JT', 'J&T Express'),
  ('SICEPAT', 'SiCepat')
ON CONFLICT (code) DO NOTHING;

-- 2. Channel rows: <courier>_VIA_LINCAH, aggregator='LINCAH'
INSERT INTO public.courier_channels (courier_id, code, name, aggregator, active)
SELECT c.id, channels.code, channels.name, 'LINCAH', true
  FROM (VALUES
    ('JNE',     'JNE_VIA_LINCAH',     'JNE via Lincah'),
    ('NINJA',   'NINJA_VIA_LINCAH',   'Ninja via Lincah'),
    ('JT',      'JT_VIA_LINCAH',      'J&T via Lincah'),
    ('SICEPAT', 'SICEPAT_VIA_LINCAH', 'SiCepat via Lincah')
  ) AS channels(courier_code, code, name)
  JOIN public.couriers c ON c.code = channels.courier_code
ON CONFLICT (code) DO NOTHING;

-- 3. Value mappings on lincah_outbound profile:
--    channel_courier_code (internal) → courier name Lincah expects.
WITH p AS (SELECT id FROM public.converter_profiles WHERE code = 'lincah_outbound')
INSERT INTO public.converter_value_mappings
  (profile_id, source_field, raw_value, mapped_value)
SELECT p.id, vm.source_field, vm.raw_value, vm.mapped_value FROM p,
  (VALUES
    ('channel_courier_code', 'JNE_VIA_LINCAH',     'JNE'),
    ('channel_courier_code', 'NINJA_VIA_LINCAH',   'Ninja'),
    ('channel_courier_code', 'JT_VIA_LINCAH',      'J&T'),
    ('channel_courier_code', 'SICEPAT_VIA_LINCAH', 'SiCepat')
  ) AS vm(source_field, raw_value, mapped_value)
ON CONFLICT DO NOTHING;

-- 4. Set Lincah profile's primary channel_id = JNE_VIA_LINCAH (most common).
--    Order eligibility / filtering uses channel per-row anyway, this is just
--    a sensible default the UI can pre-select.
UPDATE public.converter_profiles
   SET channel_id = (SELECT id FROM public.courier_channels WHERE code = 'JNE_VIA_LINCAH')
 WHERE code = 'lincah_outbound' AND channel_id IS NULL;
