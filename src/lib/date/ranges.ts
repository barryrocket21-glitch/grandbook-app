import { jakartaDateString } from './jakarta'

export interface DateRange {
  from: string
  to: string
  label?: string
}

export const DATE_PRESETS = [
  { id: 'today', label: 'Hari ini' },
  { id: 'yesterday', label: 'Kemarin' },
  { id: 'today_yesterday', label: 'Hari ini dan kemarin' },
  { id: 'last7', label: '7 hari terakhir' },
  { id: 'last14', label: '14 hari terakhir' },
  { id: 'last28', label: '28 hari terakhir' },
  { id: 'last30', label: '30 hari terakhir' },
  { id: 'week', label: 'Minggu ini' },
  { id: 'previous_week', label: 'Minggu lalu' },
  { id: 'month', label: 'Bulan ini' },
  { id: 'previous_month', label: 'Bulan lalu' },
] as const

export type DatePreset = typeof DATE_PRESETS[number]['id']

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function shiftCalendarDate(value: string, days: number): string {
  if (!isCalendarDate(value)) throw new Error('Tanggal tidak valid')
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function dateRangePreset(id: DatePreset, now: Date = new Date()): DateRange {
  const today = jakartaDateString(now)
  const date = new Date(`${today}T00:00:00Z`)
  const monday = shiftCalendarDate(today, 1 - (date.getUTCDay() || 7))
  const month = `${today.slice(0, 7)}-01`
  let from = today
  let to = today
  if (id === 'yesterday') from = to = shiftCalendarDate(today, -1)
  if (id === 'today_yesterday') from = shiftCalendarDate(today, -1)
  if (id === 'last7') from = shiftCalendarDate(today, -6)
  if (id === 'last14') from = shiftCalendarDate(today, -13)
  if (id === 'last28') from = shiftCalendarDate(today, -27)
  if (id === 'last30') from = shiftCalendarDate(today, -29)
  if (id === 'week') from = monday
  if (id === 'previous_week') {
    from = shiftCalendarDate(monday, -7)
    to = shiftCalendarDate(monday, -1)
  }
  if (id === 'month') from = month
  if (id === 'previous_month') {
    to = shiftCalendarDate(month, -1)
    from = `${to.slice(0, 7)}-01`
  }
  return { from, to, label: DATE_PRESETS.find(preset => preset.id === id)?.label }
}

/** Inclusive calendar dates -> a half-open timestamp interval in WIB. */
export function wibTimestampBounds(from: string, to: string): { from: string; toExclusive: string } {
  if (!isCalendarDate(from) || !isCalendarDate(to) || from > to) throw new Error('Rentang tanggal tidak valid')
  return {
    from: new Date(`${from}T00:00:00+07:00`).toISOString(),
    toExclusive: new Date(`${shiftCalendarDate(to, 1)}T00:00:00+07:00`).toISOString(),
  }
}
