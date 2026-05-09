import { type UserRole, type OrderStatus, type ResiStatus } from './types'
import {
  LayoutDashboard,
  ShoppingCart,
  ClipboardList,
  Megaphone,
  DollarSign,
  Package,
  Receipt,
  BarChart3,
  FileText,
  Users,
  Settings,
  Coins,
  TrendingUp,
  ClipboardCheck,
  LineChart,
  Scale,
  Copy,
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
  children?: { title: string; href: string }[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
    roles: ['owner'],
  },
  {
    title: 'Analytics',
    href: '/analytics',
    icon: LineChart,
    roles: ['owner'],
  },
  {
    title: 'Orders',
    href: '/orders',
    icon: ShoppingCart,
    roles: ['owner', 'admin', 'cs', 'akunting', 'advertiser'],
    children: [
      { title: 'Input Order Baru', href: '/orders/new' },
      { title: 'Upload Massal', href: '/orders/bulk-upload' },
      { title: 'WA Paste', href: '/orders/wa-paste' },
      { title: 'Export Outbound', href: '/orders/outbound' },
      { title: 'Daftar Order', href: '/orders/list' },
    ],
  },
  {
    title: 'ADV',
    href: '/adv-dashboard',
    icon: Megaphone,
    roles: ['owner', 'advertiser'],
    children: [
      { title: 'Dashboard ADV', href: '/adv-dashboard' },
      { title: 'Campaigns', href: '/campaigns' },
      { title: 'Ad Spend', href: '/ad-spend' },
      { title: 'Daftar Advertiser', href: '/team/advertisers' },
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
      { title: 'Daftar CS', href: '/team/cs' },
    ],
  },
  {
    title: 'Produk',
    href: '/products',
    icon: Package,
    roles: ['owner', 'akunting'],
  },
  {
    title: 'Biaya Operasional',
    href: '/expenses',
    icon: Receipt,
    roles: ['owner', 'akunting'],
  },
  {
    title: 'Selisih Ongkir',
    href: '/shipping-diff',
    icon: Truck,
    roles: ['owner'],
  },
  {
    title: 'Duplicate Inbox',
    href: '/duplicates',
    icon: Copy,
    roles: ['owner'],
  },
  {
    title: 'Reconciliation',
    href: '/reconciliation',
    icon: Scale,
    roles: ['owner', 'admin'],
    children: [
      { title: 'Cross-check Platform', href: '/reconciliation' },
      { title: 'Upload File Rekonsil', href: '/reconciliation/upload' },
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
    ],
  },
  {
    title: 'Inbox',
    href: '/inbox/pending-review',
    icon: Inbox,
    roles: ['owner', 'admin'],
    children: [
      { title: 'Pending Review', href: '/inbox/pending-review' },
      { title: 'Unmatched Resi', href: '/inbox/unmatched-resi' },
      { title: 'Unmapped Statuses', href: '/inbox/unmapped-statuses' },
    ],
  },
  {
    title: 'Settings',
    href: '/settings',
    icon: Settings,
    roles: ['owner'],
    children: [
      { title: 'Users & Roles', href: '/settings/users' },
      { title: 'Aturan Komisi', href: '/settings/commission-rules' },
      { title: 'Reset Data', href: '/settings/reset-data' },
    ],
  },
]

export function getNavItemsForRole(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role)).map((item) => {
    if (item.children) {
      // Filter children too for specific roles
      if (role === 'admin' && item.href === '/orders') {
        return { ...item, children: item.children }
      }
      if (role !== 'owner' && item.href === '/commissions') {
        return { ...item, children: [{ title: 'Komisi Saya', href: '/commissions/my' }] }
      }
    }
    return item
  })
}
