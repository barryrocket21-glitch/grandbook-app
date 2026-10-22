import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportProductGroup } from '../../../src/lib/orders/export-groups'
import { confirmSameDayPhones } from '../../../src/lib/orders/phone-warning'
import { formatDate } from '../../../src/lib/format'

test('export grouping uses canonical names and keeps mixed/unmapped packages explicit', () => {
  assert.deepEqual(exportProductGroup([{ product_id: 1, product_name_raw: 'Raw', product: { name: 'Canonical Demo' } }]), { key: '1', label: 'Canonical Demo' })
  assert.equal(exportProductGroup([{ product_id: 1, product_name_raw: 'A' }, { product_id: 2, product_name_raw: 'B' }]).key, 'MIXED')
  assert.equal(exportProductGroup([{ product_id: null, product_name_raw: 'Unmapped Demo' }]).key, 'UNMAPPED')
  assert.equal(exportProductGroup([]).key, 'UNMAPPED')
})

test('formatted dates use WIB at a UTC day boundary', () => {
  assert.match(formatDate('2026-09-06T18:47:55.327Z'), /07 Sep 2026/)
})

test('phone warning reads all batches and respects cancellation without any submit', async () => {
  const oldFetch = globalThis.fetch, oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const requests: Array<{ path: string; size: number }> = []
  let confirmations = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => { confirmations++; return false } } })
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as { phones: string[] }
    requests.push({ path: String(input), size: body.phones.length })
    return Response.json({ phones: requests.length === 1 ? [body.phones[0]] : [] })
  }
  try {
    const phones = Array.from({ length: 1001 }, (_, i) => '6281999' + String(i).padStart(6, '0'))
    assert.equal(await confirmSameDayPhones(phones), false)
    assert.deepEqual(requests.map(r => r.size), [1000, 1])
    assert(requests.every(r => r.path === '/api/orders/wa-paste/existing-phones'))
    assert.equal(confirmations, 1)
  } finally {
    globalThis.fetch = oldFetch
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('unavailable duplicate source blocks the workflow before confirmation or saving', async () => {
  const oldFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{}', { status: 503 })
  try { await assert.rejects(confirmSameDayPhones(['6281999000001']), /belum tersedia/) }
  finally { globalThis.fetch = oldFetch }
})
