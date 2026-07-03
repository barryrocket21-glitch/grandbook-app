import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * StatCard — kartu statistik baku GrandBook.
 * Satu gaya konsisten dipakai di seluruh app (menggantikan ~belasan salinan
 * lokal: Stat/StatCard/StatChip/MiniStatCard/Metric).
 *
 * Layout: label (kecil, uppercase, muted) di atas → value (bold, tabular-nums)
 * → sub (opsional, muted). Tone mewarnai value + border/bg tint tipis.
 * Palet in-brand: default(netral)/emerald/amber/red/zinc.
 */
export type StatTone = 'default' | 'emerald' | 'amber' | 'red' | 'zinc'

const TONE: Record<StatTone, { box: string; value: string }> = {
  default: { box: 'border-border bg-card', value: 'text-foreground' },
  zinc: { box: 'border-zinc-500/30 bg-zinc-500/10', value: 'text-zinc-600 dark:text-zinc-400' },
  emerald: { box: 'border-emerald-500/30 bg-emerald-500/10', value: 'text-emerald-600 dark:text-emerald-400' },
  amber: { box: 'border-amber-500/30 bg-amber-500/10', value: 'text-amber-600 dark:text-amber-400' },
  red: { box: 'border-red-500/30 bg-red-500/10', value: 'text-red-600 dark:text-red-400' },
}

export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
  icon: Icon,
  size = 'default',
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: StatTone
  icon?: LucideIcon
  size?: 'default' | 'lg'
  className?: string
}) {
  const t = TONE[tone]
  return (
    <div className={cn('rounded-lg border p-3', t.box, className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <p className={cn('mt-1 font-bold tabular-nums', size === 'lg' ? 'text-3xl' : 'text-2xl', t.value)}>
        {value}
      </p>
      {sub != null && sub !== '' && (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>
      )}
    </div>
  )
}
