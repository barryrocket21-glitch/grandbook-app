import assert from 'node:assert/strict'
import { dateRangePreset, isCalendarDate, shiftCalendarDate, wibTimestampBounds } from '../../src/lib/date/ranges'

const now = new Date('2026-10-21T18:00:00Z') // 22 October WIB, still 21 October UTC.
assert.deepEqual(dateRangePreset('today', now), { from: '2026-10-22', to: '2026-10-22', label: 'Hari ini' })
assert.deepEqual(dateRangePreset('month', now), { from: '2026-10-01', to: '2026-10-22', label: 'Bulan ini' })
assert.deepEqual(dateRangePreset('previous_week', now), { from: '2026-10-12', to: '2026-10-18', label: 'Minggu lalu' })
assert.deepEqual(dateRangePreset('previous_month', new Date('2026-01-31T05:00:00Z')), {
  from: '2025-12-01', to: '2025-12-31', label: 'Bulan lalu',
})
assert.equal(isCalendarDate('2024-02-29'), true)
assert.equal(isCalendarDate('2026-02-29'), false)
assert.equal(isCalendarDate('2026-13-01'), false)
assert.equal(shiftCalendarDate('2026-12-31', 1), '2027-01-01')
assert.deepEqual(wibTimestampBounds('2026-09-07', '2026-09-07'), {
  from: '2026-09-06T17:00:00.000Z', toExclusive: '2026-09-07T17:00:00.000Z',
})
assert.throws(() => wibTimestampBounds('2026-09-08', '2026-09-07'), /Rentang tanggal tidak valid/)
assert.throws(() => shiftCalendarDate('2026-02-29', 1), /Tanggal tidak valid/)
console.log('date-ranges.test.ts passed')
