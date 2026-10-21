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
  // Number → auto-format ribuan (id-ID) biar call-site cukup pass angka mentah
  const display = typeof value === 'number' ? value.toLocaleString('id-ID') : value
  return (
    <div className={cn('min-w-0 rounded-xl border p-4', t.box, className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-xs font-medium leading-relaxed text-muted-foreground">{label}</p>
        {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
      </div>
      <p title={typeof display === 'string' || typeof display === 'number' ? String(display) : undefined} className={cn('mt-2 max-w-full overflow-x-auto whitespace-nowrap font-semibold leading-snug tracking-tight tabular-nums', size === 'lg' ? 'text-[clamp(1.25rem,2.3vw,1.875rem)]' : 'text-[clamp(1.125rem,2vw,1.5rem)]', t.value)}>
        {display}
      </p>
      {sub != null && sub !== '' && (
        <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{sub}</p>
      )}
    </div>
  )
}
