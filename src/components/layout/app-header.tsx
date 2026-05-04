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

function BreadcrumbNav() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  const breadcrumbMap: Record<string, string> = {
    dashboard: 'Dashboard',
    orders: 'Orders',
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
    <Breadcrumb>
      <BreadcrumbList>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1
          const href = '/' + segments.slice(0, index + 1).join('/')
          const label = breadcrumbMap[segment] || segment

          return (
            <span key={segment} className="flex items-center gap-1.5">
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
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
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />
      <BreadcrumbNav />
    </header>
  )
}
