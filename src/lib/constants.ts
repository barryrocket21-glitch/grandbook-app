import { type UserRole, type OrderStatus, type ResiStatus } from './types'
import {
  LayoutDashboard,
  ShoppingCart,
  Megaphone,
  Settings,
  Coins,
  Scale,
  UserRound,
  LineChart,
  Users,
} from 'lucide-react'

export const ORDER_STATUSES: { value: OrderStatus; label: string; color: string }[] = [
  { value: 'BARU', label: 'Baru', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { value: 'SIAP_KIRIM', label: 'Siap Kirim', color: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400' },
  { value: 'DIKIRIM', label: 'Dikirim', color: 'bg-purple-500/15 text-purple-700 dark:text-purple-400' },
  { value: 'DITERIMA', label: 'Diterima', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  { value: 'PROBLEM', label: 'Problem', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'RETUR', label: 'Retur', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  { value: 'FAKE', label: 'Fake Order', color: 'bg-red-500/15 text-red-700 dark:text-red-400' },
  { value: 'CANCEL', label: 'Cancel', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400' },
]

export const EKSPEDISI_LIST = [
  { value: 'SPX', label: 'SPX (Shopee Express)' },
  { value: 'JNE', label: 'JNE' },
  { value: 'JNT', label: 'J&T Express' },
  { value: 'SICEPAT', label: 'SiCepat' },
  { value: 'ANTERAJA', label: 'AnterAja' },
  { value: 'LION', label: 'Lion Parcel' },
  { value: 'NINJA', label: 'Ninja Express' },
  { value: 'POS', label: 'POS Indonesia' },
  { value: 'TIKI', label: 'TIKI' },
  { value: 'GOSEND', label: 'GoSend' },
  { value: 'GRAB', label: 'GrabExpress' },
  { value: 'OTHER', label: 'Lainnya' },
]

export const RESI_STATUSES: { value: ResiStatus; label: string; color: string }[] = [
  { value: 'AKTIF', label: 'Aktif (Dalam Pengiriman)', color: 'bg-blue-500/15 text-blue-700 dark:text-blue-400' },
  { value: 'DITERIMA', label: 'Diterima', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  { value: 'PROBLEM', label: 'Problem', color: 'bg-orange-500/15 text-orange-700 dark:text-orange-400' },
  { value: 'RETUR', label: 'Retur', color: 'bg-red-500/15 text-red-700 dark:text-red-400' },
]

export const AD_PLATFORMS = [
  { value: 'META', label: 'Meta (Facebook/Instagram)' },
  { value: 'GOOGLE', label: 'Google Ads' },
  { value: 'TIKTOK', label: 'TikTok Ads' },
  { value: 'SNACK', label: 'Snack Video' },
  { value: 'OTHER', label: 'Lainnya' },
]

// Brief #19 — SINGLE SOURCE kosakata platform: kode huruf (token atribusi #14)
// → platform KANONIK (samain dgn campaigns.platform/ad_accounts.platform/AdPlatform).
// Huruf "F" = Facebook = platform Meta → nilai tersimpan "META". Dipakai parser
// #14 + form ad-setup + resolver biar gak melenceng lagi.
export const PLATFORM_CODE_MAP: Record<string, string> = {
  F: 'META', G: 'GOOGLE', S: 'SNACK', T: 'TIKTOK',
}

export const PAYMENT_METHODS = [
  { value: 'COD', label: 'COD (Cash on Delivery)' },
  { value: 'TRANSFER', label: 'Transfer Bank' },
]

export const COMMISSION_STATUS_COLORS = {
  PENDING: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400',
  APPROVED: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  PAID: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin Input Order',
  cs: 'Customer Service',
  advertiser: 'Advertiser',
  akunting: 'Akunting',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  owner: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  admin: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  cs: 'bg-teal-500/15 text-teal-700 dark:text-teal-400',
  advertiser: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  akunting: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
}

export interface NavItem {
  title: string
  href: string
  icon: typeof LayoutDashboard
  roles: UserRole[]
  children?: NavChild[]
}

export interface NavChild {
  title: string
  href: string
  /**
   * Optional per-child role filter. Kalau di-set, hanya role yang
   * masuk array ini yang lihat menu item ini di sidebar. Default
   * (undefined) = inherit dari parent group roles.
   */
  roles?: UserRole[]
  /**
   * Optional small badge label (e.g. "BARU") yang ditampilkan di kanan
   * label menu untuk highlight item baru / penting.
   */
  badge?: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['owner', 'admin'],
  },
  {
    // Order — pipeline utama. Submenu urut alur kerja:
    // 3 cara input → numpuk di Antrian Kerja → Export → pindah ke Arsip.
    title: 'Order',
    href: '/orders',
    icon: ShoppingCart,
    roles: ['owner', 'admin', 'cs', 'akunting'],
    children: [
      { title: 'Pembukuan (Satu Tampilan)', href: '/orders/pembukuan', roles: ['owner', 'admin', 'cs', 'akunting'] },
      // Input Order digabung jadi 1 menu — di halaman ada tab (Ketik Manual /
      // Upload CSV / Tempel WA). Sebelumnya 3 menu kepisah.
      { title: 'Input Order', href: '/orders/new', roles: ['owner', 'admin', 'cs'] },
      // Kirim Order — 1 menu, tab di dalam: Antrian Kerja → Export → Post-Export
      // (alur kirim berurutan). Sebelumnya 3 menu kepisah.
      { title: 'Kirim Order', href: '/orders/draft', roles: ['owner', 'admin', 'cs'] },
      { title: 'Sync Status SPX', href: '/reconciliation/spx-status', roles: ['owner', 'admin'] },
      // Inbox (benerin data nyangkut) masuk grup Order — masih bagian pipeline.
      // Sub-antrian jadi tab di dalam halaman (inbox/layout.tsx). 'Arsip' dibuang
      // (Pembukuan udah superset). Halaman lama tetap routable.
      { title: 'Inbox', href: '/inbox/pending-review', roles: ['owner', 'admin'] },
    ],
  },
  {
    // Pelanggan — gabung Daftar Pelanggan (blacklist/VIP) + Follow Up (CRM).
    title: 'Pelanggan',
    href: '/customers',
    icon: UserRound,
    roles: ['owner', 'admin', 'akunting', 'cs'],
    children: [
      { title: 'Daftar Pelanggan', href: '/customers', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Follow Up', href: '/crm', roles: ['owner', 'admin', 'cs'] },
    ],
  },
  {
    // Keuangan — gabungan Reconciliation + Biaya Operasional.
    title: 'Keuangan',
    href: '/financial-position',
    icon: Scale,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Posisi Keuangan', href: '/financial-position' },
      { title: 'Laporan Laba Rugi', href: '/laba-rugi', badge: 'BARU' },
      // Rekonsiliasi jadi 1 hub — tab di dalam: Ekspedisi / Sync Status SPX /
      // Cashflow SPX (lihat reconciliation/layout.tsx).
      { title: 'Rekonsiliasi', href: '/reconciliation/ekspedisi' },
      { title: 'Selisih Ongkir', href: '/shipping-diff', roles: ['owner', 'admin'] },
      { title: 'Biaya Operasional', href: '/expenses' },
      // 'Cross-check Platform Iklan' (/reconciliation) dibuang dari nav (peninggalan lama). Routable.
    ],
  },
  {
    title: 'Komisi',
    href: '/commissions',
    icon: Coins,
    roles: ['owner', 'admin', 'cs', 'advertiser'],
    children: [
      { title: 'Komisi Saya', href: '/commissions/my' },
      { title: 'Kelola Komisi', href: '/commissions/manage', roles: ['owner', 'admin'] },
      { title: 'Aturan Komisi', href: '/settings/commission-rules', roles: ['owner'] },
    ],
  },
  {
    // Marketing — analisa strategis (owner/admin).
    title: 'Marketing',
    href: '/performa',
    icon: LineChart,
    roles: ['owner', 'admin'],
    children: [
      { title: 'Performa Bisnis', href: '/performa', badge: 'BARU' },
      { title: 'Analytics', href: '/analytics' },
    ],
  },
  {
    // Advertiser — workspace iklan (setup + input spend + performa iklan).
    title: 'Advertiser',
    href: '/marketing/ad-setup',
    icon: Megaphone,
    roles: ['owner', 'admin', 'advertiser'],
    children: [
      { title: 'Setup Iklan', href: '/marketing/ad-setup' },
      { title: 'Input Harian', href: '/ad-spend' },
      // Performa Iklan digabung ke Performa Bisnis (tab Campaign). Advertiser
      // diarahkan ke /performa; route lama /marketing/performa tetap reachable.
      { title: 'Performa Campaign', href: '/performa', roles: ['advertiser'] },
      { title: 'Margin Simulator', href: '/adv/margin-simulator', roles: ['owner', 'advertiser'] },
    ],
  },
  {
    // CS — workspace customer service (input lead/closing + performa).
    title: 'CS',
    href: '/cs-ringkasan',
    icon: Users,
    roles: ['owner', 'admin', 'cs'],
    children: [
      // Ringkasan CS = gabungan Dashboard CS + Performa CS (liat semua CS + drill
      // per produk). Dashboard/Performa lama tetap reachable via URL.
      { title: 'Ringkasan CS', href: '/cs-ringkasan', badge: 'BARU' },
      { title: 'Laporan Harian', href: '/cs-report' },
    ],
  },
  {
    // Pengaturan — gabung Master Data (produk/kurir/wilayah) + Sistem (users/audit/reset).
    title: 'Pengaturan',
    href: '/products',
    icon: Settings,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Produk', href: '/products', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Stok / Inventory', href: '/inventory', roles: ['owner', 'admin'], badge: 'BARU' },
      { title: 'Supplier', href: '/settings/suppliers', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Setup Kurir', href: '/settings/master-kurir', roles: ['owner', 'admin'] },
      { title: 'Converter Profiles', href: '/settings/converter-profiles', roles: ['owner', 'admin'] },
      { title: 'Master Wilayah', href: '/settings/wilayah', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Users & Roles', href: '/settings/users', roles: ['owner', 'admin'] },
      { title: 'Audit Log', href: '/settings/audit-log', roles: ['owner', 'admin'] },
      { title: 'Reset Data', href: '/settings/reset-data', roles: ['owner'] },
    ],
  },
]

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS
    .filter((item) => item.roles.includes(role))
    .map((item) => {
      if (!item.children) return item
      // Per-child role filter — child tanpa roles[] inherit dari parent group.
      const children = item.children.filter((c) => !c.roles || c.roles.includes(role))
      return { ...item, children }
    })
    // Buang group yang semua child-nya ter-filter habis untuk role ini.
    .filter((item) => !item.children || item.children.length > 0)
}
