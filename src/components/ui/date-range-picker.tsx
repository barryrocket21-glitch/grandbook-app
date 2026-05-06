'use client'

import { useState, useEffect } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DateRange {
  from: string  // YYYY-MM-DD
  to: string    // YYYY-MM-DD
  label?: string
}

const fmtDate = (d: Date) => d.toISOString().split('T')[0]
const today = () => new Date()
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const startOfWeek = (d: Date) => { const x = new Date(d); const day = x.getDay() || 7; x.setDate(x.getDate() - day + 1); return x }
const endOfWeek = (d: Date) => { const x = startOfWeek(d); x.setDate(x.getDate() + 6); return x }

const PRESETS: { label: string; getValue: () => { from: string; to: string } }[] = [
  { label: 'Hari ini', getValue: () => ({ from: fmtDate(today()), to: fmtDate(today()) }) },
  { label: 'Kemarin', getValue: () => ({ from: fmtDate(daysAgo(1)), to: fmtDate(daysAgo(1)) }) },
  { label: 'Hari ini dan kemarin', getValue: () => ({ from: fmtDate(daysAgo(1)), to: fmtDate(today()) }) },
  { label: '7 hari terakhir', getValue: () => ({ from: fmtDate(daysAgo(6)), to: fmtDate(today()) }) },
  { label: '14 hari terakhir', getValue: () => ({ from: fmtDate(daysAgo(13)), to: fmtDate(today()) }) },
  { label: '28 hari terakhir', getValue: () => ({ from: fmtDate(daysAgo(27)), to: fmtDate(today()) }) },
  { label: '30 hari terakhir', getValue: () => ({ from: fmtDate(daysAgo(29)), to: fmtDate(today()) }) },
  { label: 'Minggu ini', getValue: () => ({ from: fmtDate(startOfWeek(today())), to: fmtDate(today()) }) },
  { label: 'Minggu lalu', getValue: () => {
    const lastWeek = daysAgo(7)
    return { from: fmtDate(startOfWeek(lastWeek)), to: fmtDate(endOfWeek(lastWeek)) }
  }},
  { label: 'Bulan ini', getValue: () => ({ from: fmtDate(startOfMonth(today())), to: fmtDate(today()) }) },
  { label: 'Bulan lalu', getValue: () => {
    const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1)
    return { from: fmtDate(startOfMonth(lastMonth)), to: fmtDate(endOfMonth(lastMonth)) }
  }},
]

const formatDisplay = (from: string, to: string, label?: string): string => {
  if (label) return `${label}: ${from === to ? formatRange(from) : `${formatRange(from)} – ${formatRange(to)}`}`
  if (from === to) return formatRange(from)
  return `${formatRange(from)} – ${formatRange(to)}`
}

const formatRange = (iso: string): string => {
  const d = new Date(iso)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`
}

interface Props {
  value: DateRange
  onChange: (v: DateRange) => void
  className?: string
}

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(value.label || null)
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)

  useEffect(() => {
    setCustomFrom(value.from)
    setCustomTo(value.to)
    setSelectedPreset(value.label || null)
  }, [value.from, value.to, value.label])

  const pickPreset = (label: string) => {
    const p = PRESETS.find(p => p.label === label)
    if (!p) return
    const v = p.getValue()
    setSelectedPreset(label)
    setCustomFrom(v.from)
    setCustomTo(v.to)
  }

  const apply = () => {
    onChange({ from: customFrom, to: customTo, label: selectedPreset || undefined })
    setOpen(false)
  }

  const cancel = () => {
    setCustomFrom(value.from)
    setCustomTo(value.to)
    setSelectedPreset(value.label || null)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={
        <Button variant="outline" className={cn('gap-2 font-normal justify-start min-w-[240px]', className)}>
          <Calendar className="w-4 h-4 text-violet-400 shrink-0" />
          <span className="truncate">{formatDisplay(value.from, value.to, value.label)}</span>
        </Button>
      } />
      <PopoverContent className="w-[420px] p-0" align="end">
        <div className="flex flex-col">
          <div className="flex">
            {/* Preset list */}
            <div className="w-[180px] border-r p-2 max-h-[400px] overflow-y-auto">
              {PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => pickPreset(p.label)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors',
                    selectedPreset === p.label
                      ? 'bg-violet-500/15 text-violet-300 font-medium'
                      : 'hover:bg-muted text-foreground/80'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom inputs */}
            <div className="flex-1 p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Dari tanggal</label>
                <Input
                  type="date"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setSelectedPreset(null) }}
                  max={customTo}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Sampai tanggal</label>
                <Input
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setSelectedPreset(null) }}
                  min={customFrom}
                  max={fmtDate(today())}
                />
              </div>
              <p className="text-[10px] text-muted-foreground pt-2">
                {customFrom === customTo ? formatRange(customFrom) : `${formatRange(customFrom)} – ${formatRange(customTo)}`}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t p-3 bg-muted/20">
            <p className="text-[11px] text-muted-foreground">Tanggal dalam zona waktu kamu</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={cancel}>Batal</Button>
              <Button size="sm" onClick={apply} className="bg-violet-600 hover:bg-violet-700 text-white">Update</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Helper: get default range (7 days)
export const defaultRange = (): DateRange => ({
  from: fmtDate(daysAgo(6)),
  to: fmtDate(today()),
  label: '7 hari terakhir',
})
