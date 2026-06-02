import { type UserRole, type OrderStatus, type ResiStatus } from './types'
import {
  LayoutDashboard,
  ShoppingCart,
  Megaphone,
  Package,
  Users,
  Settings,
  Coins,
  LineChart,
  Scale,
  Inbox,
  UserRound,
  Headset,
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
      { title: 'Input Order Baru', href: '/orders/new', roles: ['owner', 'admin', 'cs'] },
      { title: 'Upload Massal', href: '/orders/bulk-upload', roles: ['owner', 'admin'] },
      { title: 'WA Paste', href: '/orders/wa-paste', roles: ['owner', 'admin', 'cs'] },
      { title: 'Antrian Kerja', href: '/orders/draft', roles: ['owner', 'admin', 'cs'] },
      { title: 'Export ke Ekspedisi', href: '/orders/export-resi', roles: ['owner', 'admin'] },
      { title: 'Post-Export (Nunggu Resi)', href: '/orders/post-export', roles: ['owner', 'admin', 'cs'] },
      { title: 'Sync Status SPX', href: '/reconciliation/spx-status', roles: ['owner', 'admin'] },
      { title: 'Arsip Semua Order', href: '/orders/list', roles: ['owner', 'admin', 'akunting'] },
    ],
  },
  {
    // Brief #1 — Pelanggan: reputasi per nomor HP + blacklist.
    // owner/admin manage; akunting read-only. CS dapet warning di form (bukan menu).
    title: 'Pelanggan',
    href: '/customers',
    icon: UserRound,
    roles: ['owner', 'admin', 'akunting'],
  },
  {
    // Brief #2 — CRM: follow-up order PROBLEM. owner/admin semua kasus,
    // cs kasus order-nya sendiri (PEMBELI aksi, EKSPEDISI read-only).
    title: 'Follow Up',
    href: '/crm',
    icon: Headset,
    roles: ['owner', 'admin', 'cs'],
  },
  {
    // Inbox — item yang nyangkut di pipeline, perlu resolusi manual.
    title: 'Inbox',
    href: '/inbox',
    icon: Inbox,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Pending Review', href: '/inbox/pending-review', roles: ['owner', 'admin'] },
      { title: 'Atribusi Required', href: '/inbox/atribusi-required', roles: ['owner', 'admin'] },
      { title: 'Unmatched Resi', href: '/inbox/unmatched-resi', roles: ['owner', 'admin'] },
      { title: 'Unmapped Statuses', href: '/inbox/unmapped-statuses', roles: ['owner', 'admin'] },
      { title: 'Address Review', href: '/inbox/address-review' },
      { title: 'Phone Review', href: '/inbox/phone-review' },
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
      { title: 'Rekonsiliasi Ekspedisi', href: '/reconciliation/ekspedisi' },
      { title: 'Cross-check Platform Iklan', href: '/reconciliation' },
      { title: 'Selisih Ongkir', href: '/shipping-diff', roles: ['owner', 'admin'] },
      { title: 'Biaya Operasional', href: '/expenses' },
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
    title: 'Marketing',
    href: '/adv-dashboard',
    icon: Megaphone,
    roles: ['owner', 'admin', 'advertiser'],
    children: [
      { title: 'Dashboard ADV', href: '/adv-dashboard' },
      { title: 'Akun & Atribusi', href: '/marketing/ad-setup' },
      { title: 'Distribusi Atribusi', href: '/marketing/distribusi' },
      { title: 'Campaigns', href: '/campaigns' },
      { title: 'Ad Spend', href: '/ad-spend' },
      { title: 'Margin Simulator', href: '/adv/margin-simulator', roles: ['owner', 'advertiser'] },
      { title: 'Performa Advertiser', href: '/team/advertisers', roles: ['owner', 'admin'] },
    ],
  },
  {
    title: 'CS',
    href: '/cs-dashboard',
    icon: Users,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Dashboard CS', href: '/cs-dashboard' },
      { title: 'Laporan Harian', href: '/cs-report' },
      { title: 'Performa CS', href: '/team/cs', roles: ['owner', 'admin'] },
    ],
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: LineChart,
    roles: ['owner', 'admin'],
  },
  {
    // Master Data — config bisnis. Per-child roles supaya CS/Advertiser
    // gak lihat menu config operational yang gak relevan untuk mereka.
    title: 'Master Data',
    href: '/products',
    icon: Package,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Produk', href: '/products', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Supplier', href: '/settings/suppliers', roles: ['owner', 'admin', 'akunting'] },
      // Brief #12 — 4 menu master kurir digabung jadi 1 "Master Kurir". Halaman
      // lama tetap routable (fallback advanced) tapi gak di sidebar.
      { title: 'Setup Kurir', href: '/settings/master-kurir', roles: ['owner', 'admin'] },
      { title: 'Converter Profiles', href: '/settings/converter-profiles', roles: ['owner', 'admin'] },
      { title: 'Master Wilayah', href: '/settings/wilayah', roles: ['owner', 'admin', 'akunting'] },
    ],
  },
  {
    title: 'Pengaturan Sistem',
    href: '/settings/users',
    icon: Settings,
    roles: ['owner', 'admin'],
    children: [
      { title: 'Users & Roles', href: '/settings/users' },
      // Aturan Komisi moved to Komisi group (sebelumnya duplicate di sini).
      { title: 'Audit Log', href: '/settings/audit-log' },
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
