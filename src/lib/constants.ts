import { type UserRole, type OrderStatus, type ResiStatus } from './types'
import {
  LayoutDashboard,
  ShoppingCart,
  Megaphone,
  Package,
  Receipt,
  Users,
  Settings,
  Coins,
  LineChart,
  Scale,
  Truck,
  Inbox,
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
    // Phase 8H audit — Admin Indra perlu lihat KPI overview operasional.
    roles: ['owner', 'admin'],
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: LineChart,
    // Phase 8H audit — Admin perlu lihat conversion/profit untuk decision harian.
    roles: ['owner', 'admin'],
  },
  {
    title: 'Orders',
    href: '/orders',
    icon: ShoppingCart,
    roles: ['owner', 'admin', 'cs', 'akunting', 'advertiser'],
    children: [
      // Phase 8H — Antrian Kerja default landing untuk CS/Admin.
      // Per-child role filter (Phase 8H audit): tighten beyond parent scope
      // supaya cs/akunting/advertiser tidak lihat menu yang bukan untuk mereka.
      { title: 'Antrian Kerja', href: '/orders/draft', badge: 'BARU', roles: ['owner', 'admin', 'cs'] },
      { title: 'Input Order Baru', href: '/orders/new', roles: ['owner', 'admin', 'cs'] },
      { title: 'Upload Massal', href: '/orders/bulk-upload', roles: ['owner', 'admin'] },
      { title: 'WA Paste', href: '/orders/wa-paste', roles: ['owner', 'admin', 'cs'] },
      { title: 'Export ke Ekspedisi', href: '/orders/export-resi', roles: ['owner', 'admin'] },
      { title: 'Arsip Semua Order', href: '/orders/list', roles: ['owner', 'admin', 'akunting'] },
    ],
  },
  {
    title: 'ADV',
    href: '/adv-dashboard',
    icon: Megaphone,
    roles: ['owner', 'admin', 'advertiser'],
    children: [
      { title: 'Dashboard ADV', href: '/adv-dashboard' },
      { title: 'Campaigns', href: '/campaigns' },
      { title: 'Ad Spend', href: '/ad-spend' },
      // Phase 7: Margin Simulator — owner+advertiser (admin hidden via per-child filter)
      { title: 'Margin Simulator', href: '/adv/margin-simulator', roles: ['owner', 'advertiser'] },
      // Phase 8: Daftar Advertiser — team perf dashboard, owner+admin only
      // (advertiser sendiri tidak boleh lihat performance advertiser lain).
      { title: 'Daftar Advertiser', href: '/team/advertisers', roles: ['owner', 'admin'] },
    ],
  },
  {
    title: 'CS',
    href: '/cs-dashboard',
    icon: Users,
    // admin di-keep untuk akses sub-pages (Laporan Harian / Daftar CS) tapi
    // /cs-dashboard sendiri di-gate ke cs+owner di komponen.
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Dashboard CS', href: '/cs-dashboard' },
      { title: 'Laporan Harian', href: '/cs-report' },
      // Daftar CS: team performance dashboard — hanya owner+admin
      // (CS sendiri tidak boleh lihat performance CS lain).
      { title: 'Daftar CS', href: '/team/cs', roles: ['owner', 'admin'] },
    ],
  },
  {
    title: 'Produk',
    href: '/products',
    icon: Package,
    roles: ['owner', 'admin', 'akunting'],
  },
  {
    title: 'Biaya Operasional',
    href: '/expenses',
    icon: Receipt,
    roles: ['owner', 'admin', 'akunting'],
  },
  {
    title: 'Reconciliation',
    href: '/reconciliation',
    icon: Scale,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      // Phase 8J — Financial Position dashboard ("duit gw ada di mana")
      { title: 'Posisi Keuangan', href: '/financial-position', badge: 'BARU' },
      { title: 'Cross-check Platform', href: '/reconciliation' },
      { title: 'Upload File Rekonsil', href: '/reconciliation/upload' },
      { title: 'SPX Financial', href: '/reconciliation/spx' },
      { title: 'SPX Cashflow Harian', href: '/reconciliation/spx-cashflow' },
      { title: 'Selisih Ongkir', href: '/shipping-diff' },
    ],
  },
  {
    title: 'Komisi',
    href: '/commissions',
    icon: Coins,
    roles: ['owner', 'admin', 'cs', 'advertiser'],
    children: [
      { title: 'Komisi Saya', href: '/commissions/my' },
      { title: 'Kelola Komisi', href: '/commissions/manage' },
    ],
  },
  {
    title: 'Master Data',
    href: '/settings/couriers',
    icon: Truck,
    roles: ['owner', 'admin', 'cs', 'advertiser', 'akunting'],
    children: [
      { title: 'Couriers', href: '/settings/couriers' },
      { title: 'Channels', href: '/settings/courier-channels' },
      { title: 'Rates', href: '/settings/courier-rates' },
      { title: 'Status Mapping', href: '/settings/status-mapping' },
      { title: 'Converter Profiles', href: '/settings/converter-profiles' },
      { title: 'Master Wilayah', href: '/settings/wilayah' },
      // Phase 8A — Multi-supplier (write owner+admin, read semua role
      // karena form produk/order butuh dropdown)
      { title: 'Suppliers', href: '/settings/suppliers' },
    ],
  },
  {
    title: 'Inbox',
    href: '/inbox/pending-review',
    icon: Inbox,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Pending Review', href: '/inbox/pending-review', roles: ['owner', 'admin'] },
      { title: 'Unmatched Resi', href: '/inbox/unmatched-resi', roles: ['owner', 'admin'] },
      { title: 'Unmapped Statuses', href: '/inbox/unmapped-statuses', roles: ['owner', 'admin'] },
      // Phase 8F — CS perlu akses untuk resolve alamat
      { title: 'Address Review', href: '/inbox/address-review' },
      // Phase 8G — CS resolve phone yang corrupt dari CSV
      { title: 'Phone Review', href: '/inbox/phone-review' },
    ],
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    // Phase 8H audit — extend parent ke owner+admin. Per-child roles tighten
    // back ke owner-only untuk Aturan Komisi + Reset Data.
    roles: ['owner', 'admin'],
    children: [
      { title: 'Users & Roles', href: '/settings/users' },
      { title: 'Aturan Komisi', href: '/settings/commission-rules', roles: ['owner'] },
      // Phase 8E — Audit Log. Phase 8H audit: extend ke admin.
      { title: 'Audit Log', href: '/settings/audit-log' },
      { title: 'Reset Data', href: '/settings/reset-data', roles: ['owner'] },
    ],
  },
]

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => {
    if (!item.children) return item

    // Per-child role filter (Phase 8): child with explicit roles[] only shown
    // to roles in that array. Used for Margin Simulator (owner+advertiser),
    // Daftar CS + Daftar Advertiser (owner+admin).
    let filtered = item.children.filter(c => !c.roles || c.roles.includes(role))

    // Commissions group — owner+admin lihat semua (Kelola + Saya), role lain
    // cuma "Komisi Saya". Phase 8H audit: admin perlu Kelola untuk approve
    // pencairan + mark paid (workflow operasional harian).
    if (role !== 'owner' && role !== 'admin' && item.href === '/commissions') {
      filtered = [{ title: 'Komisi Saya', href: '/commissions/my' }]
    }

    return { ...item, children: filtered }
  })
}
