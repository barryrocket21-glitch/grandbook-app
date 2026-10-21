'use client'

import { usePathname } from 'next/navigation'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { NotificationBell } from '@/components/layout/notification-bell'

function BreadcrumbNav() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  const breadcrumbMap: Record<string, string> = {
    dashboard: 'Dashboard',
    orders: 'Order',
    data: 'Data Order',
    pembukuan: 'Buku Order',
    'laba-rugi': 'Laba Rugi',
    draft: 'Antrean Kirim',
    'post-export': 'Setelah Ekspor',
    'export-resi': 'Ekspor Ekspedisi',
    'wa-paste': 'Tempel Laporan WA',
    new: 'Input Baru',
    list: 'Daftar',
    campaigns: 'Campaigns',
    'ad-spend': 'Ad Spend',
    products: 'Produk',
    expenses: 'Biaya Operasional',
    reports: 'Laporan',
    financial: 'Keuangan',
    ads: 'Iklan',
    export: 'Export',
    commissions: 'Komisi',
    my: 'Komisi Saya',
    manage: 'Kelola',
    settings: 'Settings',
    users: 'Users & Roles',
    'commission-rules': 'Aturan Komisi',
  }

  return (
    <Breadcrumb className="min-w-0 flex-1 overflow-hidden">
      <BreadcrumbList className="flex-nowrap">
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          const href = '/' + segments.slice(0, index + 1).join('/')
          const label = breadcrumbMap[segment] || segment

          return (
            <span key={segment} className="flex min-w-0 items-center gap-1.5">
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage className="truncate">{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function AppHeader() {
  return (
    <header className="flex min-w-0 h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />
      <BreadcrumbNav />
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <NotificationBell />
      </div>
    </header>
  )
}
