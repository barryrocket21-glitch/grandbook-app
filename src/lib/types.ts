// Database types for GrandBook
export type UserRole = 'owner' | 'admin' | 'cs' | 'advertiser' | 'akunting'

export type OrderStatus = 'BARU' | 'DIPROSES' | 'DIKIRIM' | 'SAMPAI' | 'SELESAI' | 'RETUR' | 'FAKE' | 'CANCEL'

export type ResiStatus = 'AKTIF' | 'DITERIMA' | 'PROBLEM' | 'RETUR'

export type PaymentMethod = 'COD' | 'TRANSFER'

export type AdPlatform = 'META' | 'GOOGLE' | 'TIKTOK' | 'SNACK' | 'OTHER'

export type CommissionRuleType = 'PERCENT_REVENUE' | 'FLAT_PER_ORDER'

export type CommissionStatus = 'PENDING' | 'APPROVED' | 'PAID'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  active: boolean
  created_at: string
  email?: string
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

export interface Order {
  id: number
  order_number: string
  order_date: string
  customer_name: string
  customer_phone: string | null
  customer_city: string | null
  customer_province: string | null
  customer_address: string | null
  subtotal: number
  shipping_cost: number
  discount: number
  total: number
  payment_method: PaymentMethod
  status: OrderStatus
  campaign_id: number | null
  advertiser_id: string | null
  cs_id: string | null
  admin_id: string | null
  notes: string | null
  resi: string | null
  ekspedisi: string | null
  resi_status: ResiStatus | null
  created_at: string
  updated_at: string
  // Relations
  campaign?: Campaign
  advertiser?: Profile
  cs?: Profile
  admin?: Profile
  items?: OrderItem[]
}

export interface OrderItem {
  id: number
  order_id: number
  product_id: number
  qty: number
  price: number
  hpp_snapshot: number
  product?: Product
}

export interface AdSpend {
  id: number
  spend_date: string
  campaign_id: number
  spend: number
  impressions: number | null
  clicks: number | null
  created_by: string | null
  created_at: string
  campaign?: Campaign
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
  active: boolean
  effective_from: string | null
}

export interface Commission {
  id: number
  user_id: string
  period_start: string
  period_end: string
  amount: number
  status: CommissionStatus
  details: Record<string, unknown> | null
  created_at: string
  user?: Profile
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

// Dashboard stat types
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

// Form types
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

// Navigation config
export interface NavItem {
  title: string
  href: string
  icon: string
  roles: UserRole[]
  children?: NavItem[]
}
