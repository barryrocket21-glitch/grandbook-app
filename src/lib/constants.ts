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
} from 'lucide-react'

export const ORDER_STATUSES: { value: OrderStatus; label: string; color: string }[] = [
  { value: 'BARU', label: 'Baru', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400' },
  { value: 'SIAP_KIRIM', label: 'Siap Kirim', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'DIKIRIM', label: 'Dikirim', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400' },
  { value: 'DITERIMA', label: 'Diterima', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  { value: 'PROBLEM', label: 'Problem', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  { value: 'RETUR', label: 'Retur', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
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
  { value: 'AKTIF', label: 'Aktif (Dalam Pengiriman)', color: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400' },
  { value: 'DITERIMA', label: 'Diterima', color: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  { value: 'PROBLEM', label: 'Problem', color: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
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
  PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  APPROVED: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
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
  owner: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
  admin: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
  cs: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-400',
  advertiser: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
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
    // Dashboard Owner — control room Barry: order hari ini, profit estimasi vs real,
    // COD belum cair, problem order, campaign/produk/CS performance.
    title: 'Dashboard Owner',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['owner', 'admin'],
  },
  {
    // Input Order — semua cara masuk order/admin validation digabung sebagai 1 workflow.
    title: 'Input Order',
    href: '/orders/new',
    icon: ShoppingCart,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Input Order', href: '/orders/new', roles: ['owner', 'admin', 'cs'] },
      { title: 'Tempel Laporan WA', href: '/orders/wa-paste', roles: ['owner', 'admin', 'cs'] },
      { title: 'Upload Order', href: '/orders/bulk-upload', roles: ['owner', 'admin'] },
      { title: 'Antrian Validasi', href: '/inbox/pending-review', roles: ['owner', 'admin'] },
    ],
  },
  {
    // Order Problem / Rescue — order masih bisa diselamatkan: buyer unreachable,
    // alamat/no HP, resi/status nyangkut, atribusi kosong, dll.
    title: 'Order Problem / Rescue',
    href: '/crm',
    icon: UserRound,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Rescue Order', href: '/crm', roles: ['owner', 'admin', 'cs'] },
      { title: 'Antrian Masalah', href: '/inbox/pending-review', roles: ['owner', 'admin'] },
      { title: 'Atribusi Kosong', href: '/inbox/atribusi-required', roles: ['owner', 'admin'] },
      { title: 'Resi Nyangkut', href: '/inbox/unmatched-resi', roles: ['owner', 'admin'] },
      { title: 'Status Asing', href: '/inbox/unmapped-statuses', roles: ['owner', 'admin'] },
      { title: 'Alamat Bermasalah', href: '/inbox/address-review', roles: ['owner', 'admin'] },
      { title: 'No HP Bermasalah', href: '/inbox/phone-review', roles: ['owner', 'admin'] },
    ],
  },
  {
    // Pengiriman & Rekonsiliasi — kirim order, export, sync status ekspedisi,
    // preview matched/unmatched/ambiguous, apply status.
    title: 'Pengiriman & Rekonsiliasi',
    href: '/orders/draft',
    icon: ShoppingCart,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Antrian Kirim', href: '/orders/draft', roles: ['owner', 'admin', 'cs'] },
      { title: 'Export Ekspedisi', href: '/orders/export-resi', roles: ['owner', 'admin'] },
      { title: 'Setelah Export', href: '/orders/post-export', roles: ['owner', 'admin'] },
      { title: 'Sync Mengantar/JNE', href: '/import-mengantar', badge: 'BARU', roles: ['owner', 'admin'] },
      { title: 'Sync SPX', href: '/reconciliation/spx-status', roles: ['owner', 'admin'] },
      { title: 'Rekonsiliasi Status', href: '/reconciliation/ekspedisi', roles: ['owner', 'admin'] },
      { title: 'Upload File Status', href: '/reconciliation/upload', roles: ['owner', 'admin'] },
      { title: 'Export File Ekspedisi', href: '/export-rekonsiliasi', roles: ['owner', 'admin'] },
    ],
  },
  {
    // COD Cair — fokus uang real: payout SPX, COD belum cair, cash-in, selisih ongkir.
    title: 'COD Cair',
    href: '/reconciliation/spx-cashflow',
    icon: Scale,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Cashflow SPX', href: '/reconciliation/spx-cashflow' },
      { title: 'Payout SPX', href: '/reconciliation/spx' },
      { title: 'Posisi Uang', href: '/financial-position' },
      { title: 'Selisih Ongkir/COD', href: '/shipping-diff', roles: ['owner', 'admin'] },
    ],
  },
  {
    // Gajian CS — komisi/fee tim + aturan fee. Payroll cycle/carry-over akan
    // dibangun di sprint lanjutan, route existing tetap dipakai dulu.
    title: 'Gajian CS',
    href: '/commissions/manage',
    icon: Coins,
    roles: ['owner', 'admin', 'cs', 'advertiser'],
    children: [
      { title: 'Gajian CS', href: '/commissions/manage', roles: ['owner', 'admin'] },
      { title: 'Aturan Fee Tim', href: '/settings/commission-rules', roles: ['owner'] },
      { title: 'Komisi Saya', href: '/commissions/my', roles: ['cs', 'advertiser', 'owner', 'admin'] },
    ],
  },
  {
    // Advertiser Cockpit — keputusan scale/watch/kill campaign/produk/platform.
    title: 'Advertiser Cockpit',
    href: '/performa',
    icon: Megaphone,
    roles: ['owner', 'admin', 'advertiser'],
    children: [
      { title: 'Performa Campaign', href: '/performa' },
      { title: 'Distribusi Lead/CS', href: '/marketing/distribusi' },
      { title: 'Input Spend Iklan', href: '/ad-spend' },
      { title: 'Setup Campaign', href: '/marketing/ad-setup' },
      { title: 'Analytics Produk', href: '/analytics', roles: ['owner', 'admin'] },
      { title: 'Performa Iklan Lama', href: '/marketing/performa', roles: ['owner', 'admin'] },
      { title: 'Dashboard Advertiser', href: '/adv-dashboard', roles: ['advertiser', 'owner', 'admin'] },
      { title: 'Simulasi Margin/CPR', href: '/adv/margin-simulator', roles: ['owner', 'advertiser'] },
    ],
  },
  {
    // Laporan CS — jangan disembunyikan: lead harian CS adalah input utama
    // closing rate CS = closing/order CS ÷ lead_reported. Ini dipisah dari
    // Gajian CS supaya owner/admin tetap bisa cek performa, dan CS tetap bisa input lead.
    title: 'Laporan CS',
    href: '/cs-ringkasan',
    icon: UserRound,
    roles: ['owner', 'admin', 'cs'],
    children: [
      { title: 'Performa CS / Closing Rate', href: '/cs-ringkasan', roles: ['owner', 'admin', 'cs'] },
      { title: 'Laporan CS / Input Lead', href: '/cs-report', roles: ['owner', 'admin', 'cs'] },
    ],
  },
  {
    // Pembukuan & Finance Check — ledger, P&L, export audit/crosscheck Excel.
    title: 'Pembukuan & Finance Check',
    href: '/orders/pembukuan',
    icon: LineChart,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Pembukuan Ledger', href: '/orders/pembukuan' },
      { title: 'Owner Profit Cockpit', href: '/reports/owner-profit', badge: 'BARU' },
      { title: 'Laba Rugi', href: '/laba-rugi', badge: 'BARU' },
      { title: 'Posisi Keuangan', href: '/financial-position' },
      { title: 'Biaya/Gaji/OPEX', href: '/expenses' },
      { title: 'Finance Audit Pack', href: '/reports/export', badge: 'NANTI' },
      { title: 'Laporan Keuangan', href: '/reports/financial' },
      { title: 'Laporan Iklan', href: '/reports/ads' },
    ],
  },
  {
    // Master Data — konfigurasi, bukan kerja harian.
    title: 'Master Data',
    href: '/products',
    icon: Settings,
    roles: ['owner', 'admin', 'akunting'],
    children: [
      { title: 'Produk', href: '/products', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Stok', href: '/inventory', roles: ['owner', 'admin'] },
      { title: 'Supplier', href: '/settings/suppliers', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Kontrak Ekspedisi', href: '/settings/master-kurir', roles: ['owner', 'admin'] },
      { title: 'Master Kurir', href: '/settings/couriers', roles: ['owner', 'admin'] },
      { title: 'Channel/Aggregator', href: '/settings/courier-channels', roles: ['owner', 'admin'] },
      { title: 'Rate Ekspedisi', href: '/settings/courier-rates', roles: ['owner', 'admin'] },
      { title: 'Mapping Status Ekspedisi', href: '/settings/status-mapping', roles: ['owner', 'admin'] },
      { title: 'Template Import/Export', href: '/settings/converter-profiles', roles: ['owner', 'admin'] },
      { title: 'Wilayah & Coverage', href: '/settings/wilayah', roles: ['owner', 'admin', 'akunting'] },
      { title: 'Tim CS', href: '/team/cs', roles: ['owner', 'admin'] },
      { title: 'Tim Advertiser', href: '/team/advertisers', roles: ['owner', 'admin'] },
      { title: 'Tim & Akses', href: '/settings/users', roles: ['owner', 'admin'] },
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
