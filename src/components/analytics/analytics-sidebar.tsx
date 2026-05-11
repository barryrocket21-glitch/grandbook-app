'use client'
// =============================================================
// AnalyticsSidebar — Notion/Linear-style left nav untuk /analytics.
// 4 groups: Bisnis, Produk, Tim, Marketing. URL state via ?section=X.
// Desktop: fixed-width left column. Mobile: horizontal scroll pill-bar.
// =============================================================
import { LayoutDashboard, Truck, Package, Headphones, Megaphone, Target } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AnalyticsSection =
  | 'overview'
  | 'channel'
  | 'produk'
  | 'cs'
  | 'adv'
  | 'campaign'

interface NavItem {
  key: AnalyticsSection
  label: string
  icon: typeof LayoutDashboard
}

interface NavGroup {
  title: string
  items: NavItem[]
}

const GROUPS: NavGroup[] = [
  {
    title: 'Bisnis',
    items: [
      { key: 'overview', label: 'Overview', icon: LayoutDashboard },
      { key: 'channel', label: 'Per Channel', icon: Truck },
    ],
  },
  {
    title: 'Produk',
    items: [
      { key: 'produk', label: 'Per Produk', icon: Package },
    ],
  },
  {
    title: 'Tim',
    items: [
      { key: 'cs', label: 'Per CS', icon: Headphones },
      { key: 'adv', label: 'Per Advertiser', icon: Megaphone },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { key: 'campaign', label: 'ROAS per Campaign', icon: Target },
    ],
  },
]

export const ANALYTICS_SECTIONS: AnalyticsSection[] =
  GROUPS.flatMap(g => g.items.map(i => i.key))

export function isAnalyticsSection(v: string | null): v is AnalyticsSection {
  return ANALYTICS_SECTIONS.includes(v as AnalyticsSection)
}

interface Props {
  section: AnalyticsSection
  onSelect: (s: AnalyticsSection) => void
}

export function AnalyticsSidebar({ section, onSelect }: Props) {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:block w-44 lg:w-48 shrink-0 border-r pr-3 self-stretch">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-2 mb-3">
          Analytics
        </p>
        <nav className="space-y-4">
          {GROUPS.map(g => (
            <div key={g.title} className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/70 px-2">
                {g.title}
              </p>
              <div className="space-y-0.5">
                {g.items.map(item => {
                  const Icon = item.icon
                  const active = section === item.key
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onSelect(item.key)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                        active
                          ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 font-medium'
                          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                      )}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Mobile/tablet: horizontal scrollable pill bar */}
      <div className="md:hidden -mx-1 mb-2 overflow-x-auto pb-1">
        <div className="flex gap-1.5 px-1 w-max">
          {GROUPS.flatMap(g => g.items).map(item => {
            const Icon = item.icon
            const active = section === item.key
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors border',
                  active
                    ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300 border-violet-500/30 font-medium'
                    : 'text-muted-foreground border-border hover:bg-muted/50'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}

export function getSectionLabel(s: AnalyticsSection): string {
  for (const g of GROUPS) {
    for (const i of g.items) if (i.key === s) return i.label
  }
  return s
}

export function getSectionGroup(s: AnalyticsSection): string {
  for (const g of GROUPS) {
    for (const i of g.items) if (i.key === s) return g.title
  }
  return ''
}
