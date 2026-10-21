'use client'

import { useState, useEffect, useId } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

import { DATE_PRESETS, dateRangePreset, isCalendarDate, type DateRange } from '@/lib/date/ranges'
import { jakartaDateString } from '@/lib/date/jakarta'
export type { DateRange } from '@/lib/date/ranges'

const formatDisplay = (from: string, to: string, label?: string): string => {
  if (label) return `${label}: ${from === to ? formatRange(from) : `${formatRange(from)} – ${formatRange(to)}`}`
  if (from === to) return formatRange(from)
  return `${formatRange(from)} – ${formatRange(to)}`
}

const formatRange = (iso: string): string => {
  if (!isCalendarDate(iso)) return '—'
  const [year, month, day] = iso.split('-').map(Number)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  return `${day} ${months[month - 1]} ${year}`
}

interface Props {
  value: DateRange
  onChange: (v: DateRange) => void
  className?: string
}

export function DateRangePicker({ value, onChange, className }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string | null>(value.label || null)
  const [customFrom, setCustomFrom] = useState(value.from)
  const [customTo, setCustomTo] = useState(value.to)

  useEffect(() => {
    // Synchronize the edit buffer after the parent changes the selected range.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCustomFrom(value.from)
    setCustomTo(value.to)
    setSelectedPreset(value.label || null)
  }, [value.from, value.to, value.label])

  const pickPreset = (label: string) => {
    const p = DATE_PRESETS.find(p => p.label === label)
    if (!p) return
    const v = dateRangePreset(p.id)
    setSelectedPreset(label)
    setCustomFrom(v.from)
    setCustomTo(v.to)
  }

  const validRange = isCalendarDate(customFrom) && isCalendarDate(customTo) && customFrom <= customTo

  const apply = () => {
    if (!validRange) return
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
        <Button variant="outline" className={cn('gap-2 font-normal justify-start min-w-0 max-w-full', className)}>
          <Calendar className="w-4 h-4 text-zinc-400 shrink-0" />
          <span className="truncate">{formatDisplay(value.from, value.to, value.label)}</span>
        </Button>
      } />
      <PopoverContent className="w-[min(420px,calc(100vw-2rem))] p-0" align="end">
        <div className="flex flex-col">
          <div className="flex flex-col sm:flex-row">
            {/* Preset list */}
            <div className="grid grid-cols-2 gap-1 border-b p-2 sm:block sm:w-[170px] sm:shrink-0 sm:border-r sm:border-b-0 max-h-[240px] overflow-y-auto">
              {DATE_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => pickPreset(p.label)}
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors',
                    selectedPreset === p.label
                      ? 'bg-accent text-accent-foreground font-medium'
                      : 'hover:bg-muted text-foreground/80'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Custom inputs */}
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-4">
              <div className="space-y-1.5">
                <label htmlFor={`${id}-from`} className="text-xs text-muted-foreground">Dari tanggal</label>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={customFrom}
                  onChange={e => { setCustomFrom(e.target.value); setSelectedPreset(null) }}
                  max={customTo}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor={`${id}-to`} className="text-xs text-muted-foreground">Sampai tanggal</label>
                <Input
                  id={`${id}-to`}
                  type="date"
                  value={customTo}
                  onChange={e => { setCustomTo(e.target.value); setSelectedPreset(null) }}
                  min={customFrom}
                  max={jakartaDateString()}
                />
              </div>
              <p className="text-[10px] text-muted-foreground pt-2">
                {customFrom === customTo ? formatRange(customFrom) : `${formatRange(customFrom)} – ${formatRange(customTo)}`}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t p-3 bg-muted/20">
            <p className="text-[11px] text-muted-foreground">Tanggal menggunakan WIB</p>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={cancel}>Batal</Button>
              <Button size="sm" disabled={!validRange} onClick={apply}>Terapkan</Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// Existing imports keep working; every preset uses the same WIB calendar.
export const defaultRange = (): DateRange => dateRangePreset('today')
export const last7Days = (): DateRange => dateRangePreset('last7')
export const last30Days = (): DateRange => dateRangePreset('last30')
export const thisMonth = (): DateRange => dateRangePreset('month')
