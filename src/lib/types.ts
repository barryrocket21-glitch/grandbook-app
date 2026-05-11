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

// Phase 4A commission status enum (migration 016 — TEXT + CHECK constraint).
// 'PENDING' / 'APPROVED' adalah legacy values dari pre-Phase 1 — tidak diproduksi
// engine v2 tapi masih ada di type union supaya halaman lama tidak break kalau
// referensi data historis.
export type CommissionStatus = 'ESTIMATED' | 'EARNED' | 'CANCELLED' | 'PAID' | 'PENDING' | 'APPROVED'

export const COMMISSION_V2_STATUSES = ['ESTIMATED', 'EARNED', 'CANCELLED', 'PAID'] as const
export type CommissionV2Status = (typeof COMMISSION_V2_STATUSES)[number]

export type CommissionPaymentMethod = 'TRANSFER' | 'CASH' | 'OTHER'

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

export type BillingModel =
  | 'MONTHLY_INVOICE'
  | 'NETT_OFF_PER_ORDER'
  | 'DIRECT_TRANSFER'
  | 'NO_RECONCILIATION'

export type CodFeeBase = 'NOMINAL_COD' | 'BARANG_PLUS_ONGKIR_GROSS' | 'BARANG_PLUS_ONGKIR_NET'
export type CodFeeRounding = 'FLOOR' | 'ROUND' | 'CEIL'
export type PpnAppliedTo = 'COD_FEE_ONLY' | 'COD_FEE_PLUS_SHIPPING' | 'NONE'

export interface CourierChannel {
  id: number
  courier_id: number
  code: string
  name: string
  aggregator: string | null
  active: boolean
  notes: string | null
  created_at: string
  // Phase 4C
  billing_model?: BillingModel
  shipping_discount_label?: string
  courier?: Courier
}

export interface ChannelBillingConfig {
  id: number
  channel_id: number
  cod_fee_base: CodFeeBase
  cod_fee_rounding: CodFeeRounding
  ppn_applied_to: PpnAppliedTo
  effective_from: string
  effective_to: string | null
  notes: string | null
  created_at: string
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

  // Phase 4C: estimated cost fields (computed via trigger)
  estimated_shipping_net?: number | null
  estimated_cod_fee?: number | null
  estimated_ppn?: number | null
  estimated_total_cost?: number | null
  estimated_cash_in?: number | null
  estimated_profit?: number | null
  cost_computed_at?: string | null

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
  source: 'manual' | 'converter_inbound' | 'converter_rekonsil' | 'outbound_export' | 'wa_paste' | 'admin_review' | 'system'
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

export interface ProductCategory {
  id: number
  organization_id: number
  name: string
  slug: string
  description: string | null
  display_order: number
  active: boolean
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  organization_id?: number
  sku: string | null
  name: string
  price_default: number
  hpp: number
  // Legacy text column — preserved for read compat, new writes use category_id
  category: string | null
  // Phase 5A
  category_id?: number | null
  variation?: string | null
  notes?: string | null
  created_at?: string
  updated_at?: string
  active: boolean
  category_ref?: ProductCategory | null
}

export type CampaignStatus = 'ACTIVE' | 'PAUSED' | 'ENDED'

export type AdSpendSource = 'MANUAL' | 'CSV_IMPORT' | 'API'

export interface Campaign {
  id: number
  organization_id?: number
  platform: AdPlatform
  campaign_name: string
  campaign_code?: string | null
  advertiser_id: string | null
  active: boolean
  // Phase 5B
  status?: CampaignStatus
  start_date?: string | null
  end_date?: string | null
  daily_budget?: number | null
  objective?: string | null
  notes?: string | null
  created_at?: string
  updated_at?: string
  advertiser?: Profile | null
  linked_products?: CampaignProduct[]
}

export interface CampaignProduct {
  id: number
  organization_id: number
  campaign_id: number
  product_id: number
  allocation_pct: number
  notes: string | null
  created_at: string
  product?: Product | null
  campaign?: Campaign | null
}

export interface AdSpend {
  id: number
  organization_id?: number
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  clicks: number | null
  // Phase 0 legacy column (BIGINT) — preserved for backward compat
  lead_platform: number | null
  // Phase 5B additions
  reach?: number | null
  conversions?: number | null
  revenue_reported?: number | null
  source?: AdSpendSource
  import_batch_id?: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at?: string
  campaign?: Campaign | null
  campaigns?: Campaign | null
}

// Legacy expenses table — kept for backward compat. New writes go to
// operational_expenses (Phase 5A).
export interface Expense {
  id: number
  expense_date: string
  category: string
  description: string | null
  amount: number
  created_by: string | null
}

// Phase 5A — Operational Expenses (extended)
export type OperationalExpenseCategory =
  | 'GAJI'
  | 'SEWA'
  | 'UTILITY'
  | 'MARKETING'
  | 'OPERASIONAL'
  | 'PERLENGKAPAN'
  | 'PAJAK'
  | 'JASA'
  | 'LAIN_LAIN'

export type RecurrencePeriod = 'MONTHLY' | 'WEEKLY' | 'YEARLY'

export interface OperationalExpense {
  id: number
  organization_id: number
  expense_date: string
  category: OperationalExpenseCategory
  description: string
  amount: number
  payment_method: string | null
  payment_reference: string | null
  vendor_name: string | null
  recurring: boolean
  recurrence_period: RecurrencePeriod | null
  notes: string | null
  attachment_url: string | null
  created_at: string
  created_by: string | null
  updated_at: string
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
  // Phase 4A pencairan tracking
  paid_at?: string | null
  paid_by?: string | null
  payment_method?: string | null
  payment_reference?: string | null
  payment_note?: string | null
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
