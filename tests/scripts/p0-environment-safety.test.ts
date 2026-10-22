import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClient } from '@supabase/supabase-js'
import { environmentError, isBlockedWrite } from '../../src/lib/environment-safety'
import { protectSupabaseClient } from '../../src/lib/staging-readonly'
import { waPasteRequest } from '../../src/lib/schemas/wa-paste-request'
import { isAllowedRequestOrigin } from '../../src/lib/server/request-origin'

test('origin guard uses public host while rejecting foreign, malformed and downgraded origins', () => {
  const request = (origin: string, extra = {}) => new Request('http://localhost:55444/api/auth/logout', {
    headers: { host: '127.0.0.1:55444', origin, ...extra },
  })
  assert.equal(isAllowedRequestOrigin(request('http://127.0.0.1:55444')), true)
  for (const origin of ['null', 'https://evil.example', 'http://127.0.0.1:55445', 'https://127.0.0.1:55444']) {
    assert.equal(isAllowedRequestOrigin(request(origin)), false)
  }
  assert.equal(isAllowedRequestOrigin(request('http://127.0.0.1:55444', { 'sec-fetch-site': 'cross-site' })), false)
  assert.equal(isAllowedRequestOrigin(request('http://evil.example', { 'x-forwarded-host': 'evil.example' })), false)
})

test('preview and explicit staging reject production URL even with read-only label', () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://ubksitifaprqofujhova.supabase.co/' }
  assert.ok(environmentError({ ...env, VERCEL_ENV: 'preview' }))
  assert.ok(environmentError({ ...env, GRANDBOOK_ENV: 'staging', NEXT_PUBLIC_GRANDBOOK_STAGING_READONLY: '1' }))
  assert.equal(environmentError({ ...env, VERCEL_ENV: 'production' }), null)
  assert.ok(environmentError({ GRANDBOOK_ENV: 'staging' }))
  assert.equal(environmentError({ GRANDBOOK_ENV: 'staging', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55441' }), null)
})

test('read-only guard blocks server writes and Server Actions but permits logout and explicit reads', () => {
  const env = { GRANDBOOK_STAGING_READONLY: '1' }
  for (const route of ['/api/orders/wa-paste/submit', '/api/admin/users', '/orders/draft']) {
    assert.ok(isBlockedWrite('POST', route, env))
    assert.ok(isBlockedWrite('PATCH', route, env))
  }
  assert.equal(isBlockedWrite('POST', '/api/auth/logout', env), false)
  assert.equal(isBlockedWrite('POST', '/api/orders/address-review/suggestions', env), false)
  assert.equal(isBlockedWrite('GET', '/api/orders/wa-paste/ref-data', env), false)
})

test('Supabase server client rejects writes, schema-scoped writes and all RPCs before network', async () => {
  process.env.GRANDBOOK_STAGING_READONLY = '1'
  let requests = 0
  const client = protectSupabaseClient(createClient('http://127.0.0.1:55441', 'local-fixture-key', {
    auth: { persistSession: false },
    global: { fetch: async () => { requests++; return new Response('[]', { headers: { 'content-type': 'application/json' } }) } },
  }))
  try {
    await assert.rejects(Promise.resolve(client.from('orders').insert({ total: 1 })), /read-only/)
    await assert.rejects(Promise.resolve(client.schema('public').from('orders').delete()), /read-only/)
    await assert.rejects(Promise.resolve(client.rpc('a_function_without_a_write_prefix')), /read-only/)
    assert.equal(requests, 0)
    const result = await client.from('orders').select('id')
    assert.equal(result.error, null)
    assert.equal(requests, 1)
  } finally { delete process.env.GRANDBOOK_STAGING_READONLY }
})

test('WA request rejects missing CS and strips caller-controlled identity and arbitrary columns', () => {
  const payload = {
    channel_id: 1, status: 'BARU', customer_name: 'Synthetic', payment_method: 'COD',
    cod_amount: 100, total: 100, shipping_cost: 0, cs_id: '10000000-0000-4000-8000-000000000001',
    attribution_status: 'PENDING', meta: null, organization_id: 999, created_by: 'forged', payout_amount: 99,
    _item: { organization_id: 999, product_id: null, product_name_raw: 'Synthetic', qty: 1, price: 100, weight_per_unit: 1 },
  }
  const parsed = waPasteRequest.parse({ requestId: '20000000-0000-4000-8000-000000000001', orders: [{ originalIndex: 0, payload }] }).orders[0].payload
  assert.equal('organization_id' in parsed, false)
  assert.equal('created_by' in parsed, false)
  assert.equal('payout_amount' in parsed, false)
  assert.equal('organization_id' in parsed._item, false)
  assert.equal(waPasteRequest.safeParse({ orders: [{ originalIndex: 0, payload: { ...payload, cs_id: null } }] }).success, false)
})
