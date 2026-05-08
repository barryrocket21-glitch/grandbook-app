-- =============================================================
-- PHASE 1: Foundation & Database Schema (FINAL)
-- =============================================================
-- Drops legacy orders/order_items + builds new schema for
-- multi-channel order management (Orderonline, Scalev, WA, manual)
-- with structural address, courier channels, converter profiles,
-- and inbox tables for unmatched/unmapped data.
--
-- IDEMPOTENT: safe to re-run (uses IF NOT EXISTS / IF EXISTS DROP).
-- =============================================================

-- =============================================================
-- 1. DROP legacy tables (CASCADE — flushes FK + triggers + dependencies)
-- =============================================================
DROP TABLE IF EXISTS public.orders CASCADE;
DROP TABLE IF EXISTS public.order_items CASCADE;

-- Drop old commission engine functions (triggers auto-dropped via CASCADE above)
DROP FUNCTION IF EXISTS public.compute_commissions(bigint);
DROP FUNCTION IF EXISTS public.transition_commissions(bigint, commission_status, text);
DROP FUNCTION IF EXISTS public.orders_commission_trigger();

-- =============================================================
-- 2. organizations (multi-tenant prep)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.organizations (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default org if not exists
INSERT INTO public.organizations (id, name, slug)
  VALUES (1, 'Default Organization', 'default')
  ON CONFLICT (id) DO NOTHING;

-- Bump sequence so future inserts don't collide
SELECT setval('organizations_id_seq', GREATEST((SELECT MAX(id) FROM public.organizations), 1));

-- Add organization_id to profiles (keep existing users working)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_id BIGINT REFERENCES public.organizations(id);
UPDATE public.profiles SET organization_id = 1 WHERE organization_id IS NULL;

-- =============================================================
-- 3. master_wilayah (shared, ~82547 rows imported via TS script)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.master_wilayah (
  id BIGSERIAL PRIMARY KEY,
  province TEXT NOT NULL,
  city TEXT NOT NULL,
  subdistrict TEXT NOT NULL,
  village TEXT NOT NULL,
  zip TEXT NOT NULL,
  province_normalized TEXT NOT NULL,
  city_normalized TEXT NOT NULL,
  subdistrict_normalized TEXT NOT NULL,
  village_normalized TEXT NOT NULL,
  CONSTRAINT master_wilayah_unique UNIQUE (province, city, subdistrict, village, zip)
);

CREATE INDEX IF NOT EXISTS idx_wilayah_province ON public.master_wilayah(province_normalized);
CREATE INDEX IF NOT EXISTS idx_wilayah_city ON public.master_wilayah(province_normalized, city_normalized);
CREATE INDEX IF NOT EXISTS idx_wilayah_subdistrict ON public.master_wilayah(province_normalized, city_normalized, subdistrict_normalized);
CREATE INDEX IF NOT EXISTS idx_wilayah_village ON public.master_wilayah(village_normalized);
CREATE INDEX IF NOT EXISTS idx_wilayah_zip ON public.master_wilayah(zip);

-- =============================================================
-- 4. couriers (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.couriers (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 5. courier_channels (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.courier_channels (
  id BIGSERIAL PRIMARY KEY,
  courier_id BIGINT NOT NULL REFERENCES public.couriers(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  aggregator TEXT,
  active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_courier_channels_courier ON public.courier_channels(courier_id);

-- =============================================================
-- 6. courier_channel_rates (master, shared, time-bounded)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.courier_channel_rates (
  id BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES public.courier_channels(id),
  rate_key TEXT NOT NULL,
  rate_value NUMERIC(12,4) NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT courier_channel_rates_unique UNIQUE (channel_id, rate_key, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_rates_channel ON public.courier_channel_rates(channel_id);
CREATE INDEX IF NOT EXISTS idx_rates_active ON public.courier_channel_rates(channel_id, rate_key)
  WHERE effective_to IS NULL;

-- =============================================================
-- 7. courier_channel_statuses (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.courier_channel_statuses (
  id BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES public.courier_channels(id),
  raw_status TEXT NOT NULL,
  internal_status TEXT NOT NULL CHECK (internal_status IN
    ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT courier_channel_statuses_unique UNIQUE (channel_id, raw_status)
);

CREATE INDEX IF NOT EXISTS idx_status_map_channel ON public.courier_channel_statuses(channel_id);

-- =============================================================
-- 8. converter_profiles (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.converter_profiles (
  id BIGSERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN
    ('INBOUND_ORDER','INBOUND_REKONSIL','OUTBOUND_TO_COURIER','WA_PASTE')),
  source_or_target TEXT NOT NULL,
  channel_id BIGINT REFERENCES public.courier_channels(id),
  primary_key_field TEXT,
  primary_key_target TEXT CHECK (primary_key_target IN ('external_order_id','resi','order_number')),
  file_format TEXT NOT NULL CHECK (file_format IN ('CSV','XLSX','TEXT')),
  file_delimiter TEXT,
  file_encoding TEXT DEFAULT 'utf-8',
  has_header_row BOOLEAN DEFAULT TRUE,
  header_row_index INT DEFAULT 1,
  regex_pattern TEXT,
  active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_direction ON public.converter_profiles(direction);
CREATE INDEX IF NOT EXISTS idx_profiles_channel ON public.converter_profiles(channel_id);

-- =============================================================
-- 9. converter_field_mappings (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.converter_field_mappings (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES public.converter_profiles(id) ON DELETE CASCADE,
  source_field TEXT NOT NULL,
  target_field TEXT NOT NULL,
  target_table TEXT NOT NULL CHECK (target_table IN ('orders','order_items','meta','file_column')),
  transform TEXT,
  required BOOLEAN DEFAULT FALSE,
  display_order INT DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT converter_field_mappings_unique UNIQUE (profile_id, source_field)
);

CREATE INDEX IF NOT EXISTS idx_field_mappings_profile ON public.converter_field_mappings(profile_id);

-- =============================================================
-- 10. converter_value_mappings (master, shared)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.converter_value_mappings (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES public.converter_profiles(id) ON DELETE CASCADE,
  source_field TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  mapped_value TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT converter_value_mappings_unique UNIQUE (profile_id, source_field, raw_value)
);

CREATE INDEX IF NOT EXISTS idx_value_mappings_profile ON public.converter_value_mappings(profile_id);

-- =============================================================
-- 11. orders (transactional, isolated by org) — NEW SCHEMA
-- =============================================================
CREATE TABLE public.orders (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),

  -- Identifiers
  order_number TEXT NOT NULL,
  external_order_id TEXT,
  resi TEXT,

  -- Source & Channel
  source_profile_id BIGINT REFERENCES public.converter_profiles(id),
  channel_id BIGINT REFERENCES public.courier_channels(id),

  -- Customer struktural
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_province TEXT,
  customer_city TEXT,
  customer_subdistrict TEXT,
  customer_village TEXT,
  customer_zip TEXT,
  customer_address_detail TEXT,
  customer_address TEXT,
  wilayah_id BIGINT REFERENCES public.master_wilayah(id),

  -- Money
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_cost_actual NUMERIC(12,2),
  discount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cod_amount NUMERIC(12,2),
  payout_amount NUMERIC(12,2),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('COD','TRANSFER')),

  -- Status
  status TEXT NOT NULL DEFAULT 'BARU' CHECK (status IN
    ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE')),
  status_changed_at TIMESTAMPTZ DEFAULT NOW(),

  -- Snapshot rate
  rate_snapshot JSONB,

  -- People
  cs_name TEXT,
  cs_id UUID REFERENCES public.profiles(id),
  advertiser_id UUID REFERENCES public.profiles(id),
  campaign_id BIGINT REFERENCES public.campaigns(id),
  admin_id UUID REFERENCES public.profiles(id),
  created_by UUID REFERENCES public.profiles(id),

  -- Misc
  notes TEXT,
  meta JSONB,
  raw_data JSONB,

  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT orders_org_number_unique UNIQUE (organization_id, order_number),
  CONSTRAINT orders_org_external_unique UNIQUE (organization_id, external_order_id)
);

CREATE INDEX idx_orders_org_date ON public.orders(organization_id, order_date DESC);
CREATE INDEX idx_orders_status ON public.orders(organization_id, status);
CREATE INDEX idx_orders_resi ON public.orders(resi) WHERE resi IS NOT NULL;
CREATE INDEX idx_orders_external ON public.orders(external_order_id) WHERE external_order_id IS NOT NULL;
CREATE INDEX idx_orders_channel ON public.orders(channel_id);
CREATE INDEX idx_orders_cs ON public.orders(cs_id);
CREATE INDEX idx_orders_advertiser ON public.orders(advertiser_id);
CREATE INDEX idx_orders_wilayah ON public.orders(wilayah_id);

-- =============================================================
-- 12. order_items (transactional, isolated by org)
-- =============================================================
CREATE TABLE public.order_items (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES public.products(id),
  product_name_raw TEXT NOT NULL,
  variation TEXT,
  product_code_raw TEXT,
  qty INT NOT NULL DEFAULT 1,
  weight_per_unit NUMERIC(8,2),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  hpp_snapshot NUMERIC(12,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order ON public.order_items(order_id);
CREATE INDEX idx_order_items_product ON public.order_items(product_id);

-- =============================================================
-- 13. order_status_history (audit trail, isolated by org)
-- =============================================================
CREATE TABLE public.order_status_history (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  order_id BIGINT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  changed_by UUID REFERENCES public.profiles(id),
  source TEXT NOT NULL CHECK (source IN
    ('manual','converter_inbound','converter_rekonsil','wa_paste','admin_review','system')),
  source_profile_id BIGINT REFERENCES public.converter_profiles(id),
  raw_status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_status_history_order ON public.order_status_history(order_id, changed_at DESC);

-- =============================================================
-- 14. inbox_unmatched_resi (review queue)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.inbox_unmatched_resi (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  source_profile_id BIGINT NOT NULL REFERENCES public.converter_profiles(id),
  raw_resi TEXT NOT NULL,
  raw_data JSONB NOT NULL,
  resolved BOOLEAN DEFAULT FALSE,
  resolution TEXT CHECK (resolution IN ('linked','ignored','created_new')),
  resolved_to_order_id BIGINT REFERENCES public.orders(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inbox_unmatched_resi_org ON public.inbox_unmatched_resi(organization_id, resolved);

-- =============================================================
-- 15. inbox_unmapped_statuses (review queue)
-- =============================================================
CREATE TABLE IF NOT EXISTS public.inbox_unmapped_statuses (
  id BIGSERIAL PRIMARY KEY,
  organization_id BIGINT NOT NULL REFERENCES public.organizations(id),
  channel_id BIGINT NOT NULL REFERENCES public.courier_channels(id),
  raw_status TEXT NOT NULL,
  occurrence_count INT DEFAULT 1,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW(),
  resolved BOOLEAN DEFAULT FALSE,
  resolved_to_internal TEXT CHECK (resolved_to_internal IN
    ('BARU','SIAP_KIRIM','DIKIRIM','DITERIMA','PROBLEM','RETUR','CANCEL','FAKE')),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.profiles(id),
  CONSTRAINT inbox_unmapped_statuses_unique UNIQUE (organization_id, channel_id, raw_status)
);

CREATE INDEX IF NOT EXISTS idx_inbox_unmapped_status_org ON public.inbox_unmapped_statuses(organization_id, resolved);

-- =============================================================
-- 16. Triggers
-- =============================================================

-- Generic set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at_orders ON public.orders;
CREATE TRIGGER trg_set_updated_at_orders
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_set_updated_at_converter_profiles ON public.converter_profiles;
CREATE TRIGGER trg_set_updated_at_converter_profiles
  BEFORE UPDATE ON public.converter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- log_order_status_change: auto-insert ke order_status_history
CREATE OR REPLACE FUNCTION public.log_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_status_history (
      organization_id, order_id, from_status, to_status,
      changed_by, source, note
    ) VALUES (
      NEW.organization_id, NEW.id, NULL, NEW.status,
      NEW.created_by, 'system', 'Order created'
    );
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.order_status_history (
      organization_id, order_id, from_status, to_status,
      changed_by, source
    ) VALUES (
      NEW.organization_id, NEW.id, OLD.status, NEW.status,
      NEW.created_by, 'system'
    );
    NEW.status_changed_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE INSERT/UPDATE so status_changed_at can be set on NEW row
DROP TRIGGER IF EXISTS trg_log_order_status ON public.orders;
CREATE TRIGGER trg_log_order_status
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

DROP TRIGGER IF EXISTS trg_log_order_status_update ON public.orders;
CREATE TRIGGER trg_log_order_status_update
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_status_change();

-- =============================================================
-- 17. RLS — transactional (org-isolated)
-- =============================================================
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS BIGINT AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS orders_org_policy ON public.orders;
CREATE POLICY orders_org_policy ON public.orders
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_items_org_policy ON public.order_items;
CREATE POLICY order_items_org_policy ON public.order_items
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

ALTER TABLE public.order_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_status_history_org_policy ON public.order_status_history;
CREATE POLICY order_status_history_org_policy ON public.order_status_history
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

ALTER TABLE public.inbox_unmatched_resi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_unmatched_resi_org_policy ON public.inbox_unmatched_resi;
CREATE POLICY inbox_unmatched_resi_org_policy ON public.inbox_unmatched_resi
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

ALTER TABLE public.inbox_unmapped_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_unmapped_statuses_org_policy ON public.inbox_unmapped_statuses;
CREATE POLICY inbox_unmapped_statuses_org_policy ON public.inbox_unmapped_statuses
  FOR ALL USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- =============================================================
-- 18. RLS — master tables (read-all-auth, write-admin-only)
-- =============================================================
ALTER TABLE public.couriers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS couriers_select ON public.couriers;
CREATE POLICY couriers_select ON public.couriers FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS couriers_admin_write ON public.couriers;
CREATE POLICY couriers_admin_write ON public.couriers FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.courier_channels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_channels_select ON public.courier_channels;
CREATE POLICY courier_channels_select ON public.courier_channels FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS courier_channels_admin_write ON public.courier_channels;
CREATE POLICY courier_channels_admin_write ON public.courier_channels FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.courier_channel_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_channel_rates_select ON public.courier_channel_rates;
CREATE POLICY courier_channel_rates_select ON public.courier_channel_rates FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS courier_channel_rates_admin_write ON public.courier_channel_rates;
CREATE POLICY courier_channel_rates_admin_write ON public.courier_channel_rates FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.courier_channel_statuses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS courier_channel_statuses_select ON public.courier_channel_statuses;
CREATE POLICY courier_channel_statuses_select ON public.courier_channel_statuses FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS courier_channel_statuses_admin_write ON public.courier_channel_statuses;
CREATE POLICY courier_channel_statuses_admin_write ON public.courier_channel_statuses FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.converter_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS converter_profiles_select ON public.converter_profiles;
CREATE POLICY converter_profiles_select ON public.converter_profiles FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS converter_profiles_admin_write ON public.converter_profiles;
CREATE POLICY converter_profiles_admin_write ON public.converter_profiles FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.converter_field_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS converter_field_mappings_select ON public.converter_field_mappings;
CREATE POLICY converter_field_mappings_select ON public.converter_field_mappings FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS converter_field_mappings_admin_write ON public.converter_field_mappings;
CREATE POLICY converter_field_mappings_admin_write ON public.converter_field_mappings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.converter_value_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS converter_value_mappings_select ON public.converter_value_mappings;
CREATE POLICY converter_value_mappings_select ON public.converter_value_mappings FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS converter_value_mappings_admin_write ON public.converter_value_mappings;
CREATE POLICY converter_value_mappings_admin_write ON public.converter_value_mappings FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('owner','admin')));

ALTER TABLE public.master_wilayah ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS master_wilayah_select ON public.master_wilayah;
CREATE POLICY master_wilayah_select ON public.master_wilayah FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS master_wilayah_owner_write ON public.master_wilayah;
CREATE POLICY master_wilayah_owner_write ON public.master_wilayah FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'));

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS organizations_select ON public.organizations;
CREATE POLICY organizations_select ON public.organizations FOR SELECT
  USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS organizations_owner_write ON public.organizations;
CREATE POLICY organizations_owner_write ON public.organizations FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner'));
