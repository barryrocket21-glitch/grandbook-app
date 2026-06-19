'use client'
// =============================================================
// AnalyticsNav — Horizontal pill nav untuk /analytics.
// Replaces vertical sidebar (PR #12 first iteration). User feedback:
// sidebar duplikat dengan app shell sidebar. Pakai horizontal pill,
// sticky di top content area.
// =============================================================
import { BarChart3, Truck, Package, Headphones, Megaphone, Target, Undo2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AnalyticsSection =
  | 'overview'
  | 'channel'
  | 'produk'
  | 'cs'
  | 'adv'
  | 'campaign'
  | 'retur'

interface NavItem {
  key: AnalyticsSection
  label: string
  icon: typeof BarChart3
}

const ITEMS: NavItem[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'channel', label: 'Per Channel', icon: Truck },
  { key: 'produk', label: 'Per Produk', icon: Package },
  { key: 'cs', label: 'Per CS', icon: Headphones },
  { key: 'adv', label: 'Per Advertiser', icon: Megaphone },
  { key: 'campaign', label: 'ROAS Campaign', icon: Target },
  { key: 'retur', label: 'Retur', icon: Undo2 },
]

export const ANALYTICS_SECTIONS: AnalyticsSection[] = ITEMS.map(i => i.key)

export function isAnalyticsSection(v: string | null): v is AnalyticsSection {
  return ANALYTICS_SECTIONS.includes(v as AnalyticsSection)
}

export function getSectionLabel(s: AnalyticsSection): string {
  return ITEMS.find(i => i.key === s)?.label ?? s
}

interface Props {
  section: AnalyticsSection
  onSelect: (s: AnalyticsSection) => void
}

export function AnalyticsNav({ section, onSelect }: Props) {
  return (
    <div
      className="sticky top-0 z-10 -mx-1 bg-background/85 backdrop-blur-sm border-b"
      role="tablist"
      aria-label="Analytics sections"
    >
      <div className="overflow-x-auto">
        <div className="flex gap-1.5 px-1 py-2 w-max">
          {ITEMS.map(item => {
            const Icon = item.icon
            const active = section === item.key
            return (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelect(item.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors',
                  active
                    ? 'bg-zinc-500/10 text-zinc-700 dark:text-zinc-300 font-medium'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
