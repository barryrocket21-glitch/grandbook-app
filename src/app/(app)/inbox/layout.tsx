// Inbox hub — semua antrian benerin data digabung jadi 1 menu + tab.
// Layout otomatis bungkus semua /inbox/* dengan tab bar (zero edit ke page).
import { PageTabs, type PageTab } from '@/components/ui/page-tabs'

const TABS: PageTab[] = [
  { label: 'Pending Review', href: '/inbox/pending-review' },
  { label: 'Atribusi', href: '/inbox/atribusi-required' },
  { label: 'Resi Nyangkut', href: '/inbox/unmatched-resi' },
  { label: 'Status Asing', href: '/inbox/unmapped-statuses' },
  { label: 'Alamat', href: '/inbox/address-review' },
  { label: 'No HP', href: '/inbox/phone-review' },
]

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <PageTabs items={TABS} />
      {children}
    </div>
  )
}
