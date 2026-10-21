import assert from 'node:assert/strict'
import { buildDataOrderExportRpcParams, filterDataOrderRowsForExport } from '../../src/lib/orders/data-order-export-params'

const withSpx = buildDataOrderExportRpcParams({
  category: 'ALL',
  search: ' SPXID ',
  gbDateFrom: '2026-08-01',
  gbDateTo: '2026-08-31',
  spxDateFrom: '2026-09-01',
  spxDateTo: '2026-09-30',
})
assert.equal(withSpx.p_date_basis, 'spx_created_at')
assert.equal(withSpx.p_category, 'FIX_ORDER')
assert.equal(withSpx.p_gb_from, null)
assert.equal(withSpx.p_gb_to, null)
assert.equal(withSpx.p_spx_from, '2026-09-01')
assert.equal(withSpx.p_spx_to, '2026-09-30')
assert.equal(withSpx.p_search, 'SPXID')

const withoutSpx = buildDataOrderExportRpcParams({
  category: 'FIX_ORDER',
  search: '',
  gbDateFrom: '2026-08-01',
  gbDateTo: '2026-08-31',
  spxDateFrom: '',
  spxDateTo: '',
})
assert.equal(withoutSpx.p_date_basis, 'order_date')
assert.equal(withoutSpx.p_gb_from, '2026-08-01')
assert.equal(withoutSpx.p_gb_to, '2026-08-31')
assert.equal(withoutSpx.p_category, 'FIX_ORDER')
assert.equal(withoutSpx.p_search, null)

const mixedRows = [
  { order_number: 'GB-1', spx_created_at: '2026-09-07T00:00:00+00:00' },
  { order_number: 'GB-2', spx_created_at: '2026-09-05T00:00:00+00:00' },
  { order_number: 'GB-3', spx_created_at: null },
  { order_number: 'GB-4', spx_created_at: '2026-09-07' },
]
const filtered = filterDataOrderRowsForExport(mixedRows, { spxDateFrom: '2026-09-07', spxDateTo: '2026-09-07' })
assert.deepEqual(filtered.map((row) => row.order_number), ['GB-1', 'GB-4'])


// A no-resi export cannot use a shipping date: retain the chosen GB period.
const noResi = buildDataOrderExportRpcParams({
  category: 'GB_NO_RESI', search: '',
  gbDateFrom: '2026-08-01', gbDateTo: '2026-08-31',
  spxDateFrom: '2026-09-01', spxDateTo: '2026-09-30',
  limit: 1000, offset: 1000,
})
assert.equal(noResi.p_category, 'GB_NO_RESI')
assert.equal(noResi.p_date_basis, 'order_date')
assert.equal(noResi.p_gb_from, '2026-08-01')
assert.equal(noResi.p_gb_to, '2026-08-31')
assert.equal(noResi.p_spx_from, null)
assert.equal(noResi.p_spx_to, null)
assert.equal(noResi.p_limit, 1000)
assert.equal(noResi.p_offset, 1000)

// Date boundaries are WIB regardless of the machine/browser timezone.
const midnightRows = [
  { id: 'previous-utc-day', spx_created_at: '2026-09-06T18:47:55.327Z' },
  { id: 'next-wib-day', spx_created_at: '2026-09-07T18:00:00.000Z' },
  { id: 'missing', spx_created_at: null },
]
assert.deepEqual(filterDataOrderRowsForExport(midnightRows, {
  spxDateFrom: '2026-09-07', spxDateTo: '2026-09-07',
}).map(row => row.id), ['previous-utc-day'])
assert.equal(filterDataOrderRowsForExport(midnightRows, { spxDateFrom: '', spxDateTo: '' }).length, 3)

console.log('data-order-export-params.test.ts passed')
