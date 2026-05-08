// Database types for GrandBook
// =============================================================
// Phase 1: Foundation schema. Order/OrderItem totally reshaped.
// Some legacy types (ResiStatus, etc.) kept for backward-compat
// while pages get refactored Phase 2/3.
// =============================================================

export type UserRole = 'owner' | 'admin' | 'cs' | 'advertiser' | 'akunting'

// New Phase 1 status enum
export type OrderStatus =
  | 'BARU'
  | 'SIAP_KIRIM'
  | 'DIKIRIM'
  | 'DITERIMA'
  | 'PROBLEM'
  | 'RETUR'
  | 'CANCEL'
  | 'FAKE'

// LEGACY: dipakai pages lama yang belum di-refactor. Hapus saat Phase 2 selesai.
export type ResiStatus = 'AKTIF' | 'DITERIMA' | 'PROBLEM' | 'RETUR'

export type PaymentMethod = 'COD' | 'TRANSFER'

export type AdPlatform = 'META' | 'GOOGLE' | 'TIKTOK' | 'SNACK' | 'OTHER'

export type CommissionRuleType = 'PERCENT_REVENUE' | 'FLAT_PER_ORDER'

// Legacy commission status (pre-Phase 4 redesign)
export type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID' | 'ESTIMATED' | 'EARNED' | 'CANCELLED'

// =============================================================
// Phase 1 — New core entities
// =============================================================

export interface Organization {
  id: number
  name: string
  slug: string
  active: boolean
  created_at: string
}

export interface MasterWilayah {
  id: number
  province: string
  city: string
  subdistrict: string
  village: string
  zip: string
  province_normalized: string
  city_normalized: string
  subdistrict_normalized: string
  village_normalized: string
}

export interface Courier {
  id: number
  code: string
  name: string
  active: boolean
  created_at: string
}

export interface CourierChannel {
  id: number
  courier_id: number
  code: string
  name: string
  aggregator: string | null
  active: boolean
  notes: string | null
  created_at: string
  courier?: Courier
}

export interface CourierChannelRate {
  id: number
  channel_id: number
  rate_key: string
  rate_value: number
  effective_from: string
  effective_to: string | null
  notes: string | null
  created_at: string
}

export interface CourierChannelStatus {
  id: number
  channel_id: number
  raw_status: string
  internal_status: OrderStatus
  notes: string | null
  created_at: string
}

export type ConverterDirection =
  | 'INBOUND_ORDER'
  | 'INBOUND_REKONSIL'
  | 'OUTBOUND_TO_COURIER'
  | 'WA_PASTE'

export type ConverterFileFormat = 'CSV' | 'XLSX' | 'TEXT'

export type ConverterTargetTable = 'orders' | 'order_items' | 'meta' | 'file_column'

export interface ConverterProfile {
  id: number
  code: string
  name: string
  direction: ConverterDirection
  source_or_target: string
  channel_id: number | null
  primary_key_field: string | null
  primary_key_target: 'external_order_id' | 'resi' | 'order_number' | null
  file_format: ConverterFileFormat
  file_delimiter: string | null
  file_encoding: string
  has_header_row: boolean
  header_row_index: number
  regex_pattern: string | null
  active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  channel?: CourierChannel
}

export interface ConverterFieldMapping {
  id: number
  profile_id: number
  source_field: string
  target_field: string
  target_table: ConverterTargetTable
  transform: string | null
  required: boolean
  display_order: number
  notes: string | null
  created_at: string
}

export interface ConverterValueMapping {
  id: number
  profile_id: number
  source_field: string
  raw_value: string
  mapped_value: string
  notes: string | null
  created_at: string
}

// =============================================================
// Phase 1 — Orders (new schema)
// =============================================================

export interface Order {
  id: number
  organization_id: number

  // Identifiers
  order_number: string
  external_order_id: string | null
  resi: string | null

  // Source & Channel
  source_profile_id: number | null
  channel_id: number | null

  // Customer struktural
  customer_name: string
  customer_phone: string | null
  customer_province: string | null
  customer_city: string | null
  customer_subdistrict: string | null
  customer_village: string | null
  customer_zip: string | null
  customer_address_detail: string | null
  customer_address: string | null
  wilayah_id: number | null

  // Money
  subtotal: number
  shipping_cost: number
  shipping_cost_actual: number | null
  discount: number
  total: number
  cod_amount: number | null
  payout_amount: number | null
  payment_method: PaymentMethod

  // Status
  status: OrderStatus
  status_changed_at: string

  // Snapshot
  rate_snapshot: Record<string, unknown> | null

  // People
  cs_name: string | null
  cs_id: string | null
  advertiser_id: string | null
  campaign_id: number | null
  admin_id: string | null
  created_by: string | null

  // Misc
  notes: string | null
  meta: Record<string, unknown> | null
  raw_data: Record<string, unknown> | null

  order_date: string
  created_at: string
  updated_at: string

  // Relations
  campaign?: Campaign
  advertiser?: Profile
  cs?: Profile
  admin?: Profile
  channel?: CourierChannel
  source_profile?: ConverterProfile
  wilayah?: MasterWilayah
  items?: OrderItem[]
}

export interface OrderItem {
  id: number
  organization_id: number
  order_id: number
  product_id: number | null
  product_name_raw: string
  variation: string | null
  product_code_raw: string | null
  qty: number
  weight_per_unit: number | null
  price: number
  hpp_snapshot: number | null
  notes: string | null
  created_at: string
  product?: Product
}

export interface OrderStatusHistory {
  id: number
  organization_id: number
  order_id: number
  from_status: OrderStatus | null
  to_status: OrderStatus
  changed_at: string
  changed_by: string | null
  source: 'manual' | 'converter_inbound' | 'converter_rekonsil' | 'wa_paste' | 'admin_review' | 'system'
  source_profile_id: number | null
  raw_status: string | null
  note: string | null
  created_at: string
}

export interface InboxUnmatchedResi {
  id: number
  organization_id: number
  source_profile_id: number
  raw_resi: string
  raw_data: Record<string, unknown>
  resolved: boolean
  resolution: 'linked' | 'ignored' | 'created_new' | null
  resolved_to_order_id: number | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
}

export interface InboxUnmappedStatus {
  id: number
  organization_id: number
  channel_id: number
  raw_status: string
  occurrence_count: number
  first_seen_at: string
  last_seen_at: string
  resolved: boolean
  resolved_to_internal: OrderStatus | null
  resolved_at: string | null
  resolved_by: string | null
}

// =============================================================
// Existing entities (unchanged structurally in Phase 1)
// =============================================================

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  active: boolean
  created_at: string
  email?: string
  organization_id?: number
}

export interface Product {
  id: number
  sku: string | null
  name: string
  price_default: number
  hpp: number
  category: string | null
  active: boolean
}

export interface Campaign {
  id: number
  platform: AdPlatform
  campaign_name: string
  advertiser_id: string | null
  active: boolean
  advertiser?: Profile
}

export interface AdSpend {
  id: number
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  clicks: number | null
  lead_platform: number | null
  notes: string | null
  created_by: string | null
  created_at: string
  campaign?: Campaign
  campaigns?: Campaign  // Supabase aliased relation
}

export interface Expense {
  id: number
  expense_date: string
  category: string
  description: string | null
  amount: number
  created_by: string | null
}

export interface CommissionRule {
  id: number
  role: UserRole
  rule_type: CommissionRuleType
  value: number
  applies_to_status: OrderStatus[]
  product_id: number | null
  user_id: string | null
  active: boolean
  effective_from: string | null
}

export interface Commission {
  id: number
  user_id: string
  // Phase 1+: per-order model. Legacy period-based fields kept optional for old pages.
  order_id?: number
  role?: UserRole
  amount: number
  status: CommissionStatus
  earned_at?: string | null
  cancelled_at?: string | null
  cancelled_reason?: string | null
  // Legacy
  period_start?: string
  period_end?: string
  details?: Record<string, unknown> | null
  created_at: string
  user?: Profile
  orders?: Order
}

export interface AuditLog {
  id: number
  user_id: string
  table_name: string
  record_id: string
  action: string
  old_value: Record<string, unknown> | null
  new_value: Record<string, unknown> | null
  created_at: string
  user?: Profile
}

// =============================================================
// Dashboard / Form types (legacy, may be refactored Phase 2+)
// =============================================================

export interface DashboardStats {
  omzetHariIni: number
  omzetMingguIni: number
  omzetBulanIni: number
  totalOrders: number
  ordersByStatus: Record<OrderStatus, number>
  profitEstimasi: number
  totalAdSpend: number
  blendedROAS: number
  returPercentage: number
  fakePercentage: number
}

export interface TopProduct {
  name: string
  totalQty: number
  totalRevenue: number
}

export interface TopCampaign {
  campaign_name: string
  platform: AdPlatform
  orders: number
  revenue: number
  spend: number
  roas: number
  cpa: number
}

export interface OrderFormData {
  order_date: string
  customer_name: string
  customer_phone: string
  customer_city: string
  customer_province: string
  customer_address: string
  payment_method: PaymentMethod
  campaign_id: number | null
  advertiser_id: string | null
  cs_id: string | null
  shipping_cost: number
  discount: number
  notes: string
  items: OrderItemFormData[]
}

export interface OrderItemFormData {
  product_id: number
  qty: number
  price: number
}

export interface AdSpendFormData {
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  clicks: number | null
}

export interface NavItem {
  title: string
  href: string
  icon: string
  roles: UserRole[]
  children?: NavItem[]
}
