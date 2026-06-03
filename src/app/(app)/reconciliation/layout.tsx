// Rekonsiliasi hub — gabung semua proses rekon jadi 1 menu + tab.
// Layout otomatis bungkus semua /reconciliation/* dengan tab bar.
import { PageTabs, type PageTab } from '@/components/ui/page-tabs'

const TABS: PageTab[] = [
  { label: 'Rekonsiliasi Ekspedisi', href: '/reconciliation/ekspedisi' },
  { label: 'Sync Status SPX', href: '/reconciliation/spx-status' },
  { label: 'Cashflow SPX', href: '/reconciliation/spx-cashflow' },
]

export default function ReconciliationLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <PageTabs items={TABS} />
      {children}
    </div>
  )
}
