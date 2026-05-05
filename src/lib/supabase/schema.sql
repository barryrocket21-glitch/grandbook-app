-- GrandBook Database Schema
-- Sistem Pembukuan Bisnis Online

-- Enable RLS on all tables
ALTER DATABASE postgres SET "app.jwt_secret" TO 'your-jwt-secret';

-- PROFILES (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','cs','advertiser','akunting')),
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- PRODUCTS
CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  price_default NUMERIC(12,2) NOT NULL,
  hpp NUMERIC(12,2) NOT NULL,
  category TEXT,
  active BOOLEAN DEFAULT TRUE
);
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- CAMPAIGNS (master campaign iklan)
CREATE TABLE IF NOT EXISTS campaigns (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT CHECK (platform IN ('META','GOOGLE','TIKTOK','SNACK','OTHER')),
  campaign_name TEXT NOT NULL,
  advertiser_id UUID REFERENCES profiles(id),
  active BOOLEAN DEFAULT TRUE,
  UNIQUE(platform, campaign_name)
);
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- ORDERS
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_city TEXT,
  customer_province TEXT,
  customer_address TEXT,
  subtotal NUMERIC(12,2) NOT NULL,
  shipping_cost NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('COD','TRANSFER')),
  status TEXT NOT NULL DEFAULT 'BARU'
    CHECK (status IN ('BARU','DIPROSES','DIKIRIM','SAMPAI','SELESAI','RETUR','FAKE','CANCEL')),
  campaign_id BIGINT REFERENCES campaigns(id),
  advertiser_id UUID REFERENCES profiles(id),
  cs_id UUID REFERENCES profiles(id),
  admin_id UUID REFERENCES profiles(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_orders_date ON orders(order_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_campaign ON orders(campaign_id);
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- ORDER ITEMS (multi-product per order)
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT REFERENCES orders(id) ON DELETE CASCADE,
  product_id BIGINT REFERENCES products(id),
  qty INT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  hpp_snapshot NUMERIC(12,2) NOT NULL
);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- AD SPEND (input harian per campaign)
CREATE TABLE IF NOT EXISTS ad_spend (
  id BIGSERIAL PRIMARY KEY,
  spend_date DATE NOT NULL,
  campaign_id BIGINT REFERENCES campaigns(id),
  spend NUMERIC(12,2) NOT NULL,
  impressions BIGINT,
  clicks BIGINT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(spend_date, campaign_id)
);
ALTER TABLE ad_spend ENABLE ROW LEVEL SECURITY;

-- OPERATIONAL EXPENSES
CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  expense_date DATE NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  created_by UUID REFERENCES profiles(id)
);
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

-- COMMISSION RULES
CREATE TABLE IF NOT EXISTS commission_rules (
  id BIGSERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  rule_type TEXT CHECK (rule_type IN ('PERCENT_REVENUE','FLAT_PER_ORDER')),
  value NUMERIC(12,4) NOT NULL,
  applies_to_status TEXT[] DEFAULT ARRAY['SELESAI'],
  product_id BIGINT REFERENCES products(id),
  active BOOLEAN DEFAULT TRUE,
  effective_from DATE
);
ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;

-- COMMISSION LOG (calculated)
CREATE TABLE IF NOT EXISTS commissions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  period_start DATE,
  period_end DATE,
  amount NUMERIC(12,2),
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','PAID')),
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;

-- AUDIT LOG
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id),
  table_name TEXT,
  record_id TEXT,
  action TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- ROW LEVEL SECURITY POLICIES
-- ==========================================

-- Helper function to get user role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- PROFILES Policies
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY "Owner can view all profiles" ON profiles FOR SELECT USING (get_user_role() = 'owner');
CREATE POLICY "Owner can manage profiles" ON profiles FOR ALL USING (get_user_role() = 'owner');

-- PRODUCTS Policies (everyone can read, owner/akunting can write)
CREATE POLICY "Everyone can view active products" ON products FOR SELECT USING (true);
CREATE POLICY "Owner/akunting can manage products" ON products FOR ALL USING (get_user_role() IN ('owner', 'akunting'));

-- CAMPAIGNS Policies
CREATE POLICY "Everyone can view campaigns" ON campaigns FOR SELECT USING (true);
CREATE POLICY "Owner can manage campaigns" ON campaigns FOR ALL USING (get_user_role() = 'owner');
CREATE POLICY "Advertiser can view own campaigns" ON campaigns FOR SELECT USING (advertiser_id = auth.uid());

-- ORDERS Policies
CREATE POLICY "Admin sees own orders" ON orders FOR SELECT USING (
  get_user_role() = 'admin' AND admin_id = auth.uid()
);
CREATE POLICY "Owner/akunting sees all orders" ON orders FOR SELECT USING (
  get_user_role() IN ('owner', 'akunting')
);
CREATE POLICY "CS sees all orders" ON orders FOR SELECT USING (
  get_user_role() = 'cs'
);
CREATE POLICY "Advertiser sees own campaign orders" ON orders FOR SELECT USING (
  get_user_role() = 'advertiser' AND campaign_id IN (
    SELECT id FROM campaigns WHERE advertiser_id = auth.uid()
  )
);
CREATE POLICY "Admin can insert orders" ON orders FOR INSERT WITH CHECK (
  get_user_role() = 'admin'
);
CREATE POLICY "Admin can update own orders same day" ON orders FOR UPDATE USING (
  get_user_role() = 'admin' AND admin_id = auth.uid() AND order_date = CURRENT_DATE
);
CREATE POLICY "CS can update order status" ON orders FOR UPDATE USING (
  get_user_role() = 'cs'
);
CREATE POLICY "Owner can manage all orders" ON orders FOR ALL USING (
  get_user_role() = 'owner'
);

-- ORDER ITEMS Policies
CREATE POLICY "View order items with order access" ON order_items FOR SELECT USING (true);
CREATE POLICY "Admin/owner can manage order items" ON order_items FOR ALL USING (
  get_user_role() IN ('admin', 'owner')
);

-- AD SPEND Policies
CREATE POLICY "Advertiser sees own spend" ON ad_spend FOR SELECT USING (
  created_by = auth.uid()
);
CREATE POLICY "Owner/akunting sees all spend" ON ad_spend FOR SELECT USING (
  get_user_role() IN ('owner', 'akunting')
);
CREATE POLICY "Advertiser can insert spend" ON ad_spend FOR INSERT WITH CHECK (
  get_user_role() = 'advertiser'
);
CREATE POLICY "Owner can manage all spend" ON ad_spend FOR ALL USING (
  get_user_role() = 'owner'
);

-- EXPENSES Policies
CREATE POLICY "Owner/akunting sees all expenses" ON expenses FOR SELECT USING (
  get_user_role() IN ('owner', 'akunting')
);
CREATE POLICY "Akunting can manage expenses" ON expenses FOR ALL USING (
  get_user_role() IN ('owner', 'akunting')
);

-- COMMISSION RULES Policies
CREATE POLICY "Everyone can view commission rules" ON commission_rules FOR SELECT USING (true);
CREATE POLICY "Owner can manage commission rules" ON commission_rules FOR ALL USING (
  get_user_role() = 'owner'
);

-- COMMISSIONS Policies
CREATE POLICY "Users see own commissions" ON commissions FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Owner sees all commissions" ON commissions FOR SELECT USING (get_user_role() = 'owner');
CREATE POLICY "Owner can manage commissions" ON commissions FOR ALL USING (get_user_role() = 'owner');

-- AUDIT LOG Policies
CREATE POLICY "Owner/akunting can view audit log" ON audit_log FOR SELECT USING (
  get_user_role() IN ('owner', 'akunting')
);
CREATE POLICY "System can insert audit log" ON audit_log FOR INSERT WITH CHECK (true);

-- ==========================================
-- FUNCTIONS & TRIGGERS
-- ==========================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'admin')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Generate order number
CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
DECLARE
  today_count INT;
  order_num TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO today_count
  FROM orders
  WHERE order_date = CURRENT_DATE;
  
  order_num := 'ORD-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(today_count::TEXT, 4, '0');
  RETURN order_num;
END;
$$ LANGUAGE plpgsql;

-- Audit log generic function
CREATE OR REPLACE FUNCTION audit_log_trigger()
RETURNS TRIGGER AS $$
DECLARE
  action_name TEXT;
  old_data JSONB;
  new_data JSONB;
BEGIN
  action_name := TG_OP;
  
  IF (TG_OP = 'DELETE') THEN
    old_data := to_jsonb(OLD);
    new_data := NULL;
  ELSIF (TG_OP = 'UPDATE') THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
  ELSIF (TG_OP = 'INSERT') THEN
    old_data := NULL;
    new_data := to_jsonb(NEW);
  END IF;

  INSERT INTO audit_log (user_id, table_name, record_id, action, old_value, new_value)
  VALUES (auth.uid(), TG_TABLE_NAME, COALESCE(NEW.id, OLD.id)::TEXT, action_name, old_data, new_data);
  
  IF (TG_OP = 'DELETE') THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for orders
DROP TRIGGER IF EXISTS audit_orders ON orders;
CREATE TRIGGER audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();

-- Trigger for expenses
DROP TRIGGER IF EXISTS audit_expenses ON expenses;
CREATE TRIGGER audit_expenses
  AFTER INSERT OR UPDATE OR DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION audit_log_trigger();
