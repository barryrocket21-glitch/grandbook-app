import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

async function main() {
  const app = process.env.GRANDBOOK_ADS_APP
  if (!app) throw Error('Explicit isolated application required')
  const req = createRequire(app + '/package.json')
  const { createClient } = req('@supabase/supabase-js')
  const { listAdSpend, summarizeAdSpend } = await import(pathToFileURL(app + '/src/lib/supabase/queries/ad-spend.ts').href)
  const original = Array.from({ length: 2407 }, (_, i) => ({
    id: i + 1, campaign_id: i % 3 + 1, spend_date: i < 2307 ? '2099-09-01' : '2099-10-01',
    created_at: '2099-09-01T00:00:00Z', source: i % 2 ? 'MANUAL' : 'CSV_IMPORT',
    spend: '100000.25', spend_total: i % 2 ? null : '112000.28', ppn_rate: i % 2 ? 0 : 12,
    meta_lead_count: i % 2 ? null : 2, campaign: { id: i % 3 + 1, platform: ['META', 'GOOGLE', 'SNACK'][i % 3] },
  }))
  const checks: string[] = []
  const pass = (s: string) => { checks.push(s); console.log('PASS ' + s) }
  function client(mode = 'normal', rows = original, controller?: AbortController) {
    let calls = 0
    const requests: URL[] = []
    const sb = createClient('https://synthetic.invalid', 'synthetic-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        calls++
        const u = new URL(String(input)); requests.push(u)
        assert.equal(u.pathname, '/rest/v1/ad_spend')
        assert(['GET', 'HEAD'].includes(init?.method ?? 'GET'))
        assert(String(new Headers(init?.headers).get('prefer')).includes('count=exact'))
        const dates = u.searchParams.getAll('spend_date'), after = Number((u.searchParams.get('id') ?? 'gt.0').slice(3))
        const filtered = rows.filter(r => r.spend_date >= dates.find(x => x.startsWith('gte.'))!.slice(4) &&
          r.spend_date <= dates.find(x => x.startsWith('lte.'))!.slice(4) &&
          (!u.searchParams.has('source') || r.source === u.searchParams.get('source')!.slice(3)) &&
          (!u.searchParams.has('campaign_id') || r.campaign_id === Number(u.searchParams.get('campaign_id')!.slice(3))))
        const remaining = filtered.filter(r => r.id > after)
        const head = init?.method === 'HEAD'
        if (!head) { assert.equal(u.searchParams.get('order'), 'id.asc'); assert.equal(u.searchParams.get('limit'), '500') }
        let batch = remaining.slice(0, 123) // Server cap can be smaller than the requested page.
        if (mode === 'error' && after > 0) return new Response(JSON.stringify({ message: 'Unavailable' }), { status: 503 })
        if (mode === 'duplicate' && after > 0 && batch.length) batch = [rows[0], ...batch.slice(1)]
        if (mode === 'null') return new Response('null', { headers: { 'content-type': 'application/json', 'content-range': '0-0/0' } })
        if (mode === 'invalid' && batch.length) batch = [{ ...batch[0], spend_total: 'not-a-number' }, ...batch.slice(1)]
        if (mode === 'abort') controller!.abort()
        const count = head ? filtered.length + (mode === 'end-drift' ? 1 : 0) : remaining.length + (mode === 'drift' && after > 0 ? 1 : 0)
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (mode !== 'no-count') headers['content-range'] = `0-${Math.max(batch.length - 1, 0)}/${count}`
        return new Response(head ? null : JSON.stringify(batch), { headers })
      } },
    })
    return { sb, requests, calls: () => calls }
  }
  const args = { from: '2099-09-01', to: '2099-09-30' }
  const c = client(), all = await listAdSpend(c.sb, args)
  assert.equal(all.length, 2307); assert.equal(new Set(all.map((r: { id: number }) => r.id)).size, 2307)
  assert(c.calls() > 19); assert.equal(c.requests.at(-1)!.searchParams.has('id'), false)
  assert.deepEqual(all.map((r: { id: number }) => r.id), original.slice(0, 2307).map(r => r.id).reverse())
  pass('2307 complete rows over short server pages; exact counts, terminal read, end count and stable display ordering')
  for (const platform of ['META', 'GOOGLE', 'SNACK']) {
    for (const source of [undefined, 'MANUAL', 'CSV_IMPORT']) {
      const ref = original.filter(r => r.spend_date === args.from && r.campaign.platform === platform && (!source || r.source === source))
      const result = await listAdSpend(client().sb, { ...args, platform, source })
      assert.deepEqual(result.map((r: { id: number }) => r.id).sort((a: number, b: number) => a - b), ref.map(r => r.id))
    }
  }
  const single = await listAdSpend(client().sb, { ...args, campaignId: 2, source: 'MANUAL' })
  assert(single.every((r: { campaign_id: number; source: string }) => r.campaign_id === 2 && r.source === 'MANUAL'))
  pass('all platform/source combinations and campaign filter retain off-page matches within inclusive period')
  const total = summarizeAdSpend(all)
  assert.equal(total.campaigns, 3); assert.equal(total.leads, 2308)
  assert(Math.abs(total.spendTotal - (1154 * 112000.28 + 1153 * 100000.25)) < 0.00001)
  assert.equal(total.cpr, total.spendTotal / total.leads)
  assert.deepEqual(summarizeAdSpend([]), { spend: 0, spendTotal: 0, leads: 0, campaigns: 0, cpr: 0 })
  pass('stored taxed decimals and null total fallback preserved; complete lead/CPR/campaign counts; valid empty totals zero')
  for (const mode of ['error', 'duplicate', 'no-count', 'null', 'invalid', 'drift', 'end-drift']) {
    await assert.rejects(() => listAdSpend(client(mode).sb, args))
  }
  pass('mid-page failure, duplicate IDs, missing count/null data/invalid costs and count drift reject partial results')
  const controller = new AbortController()
  await assert.rejects(() => listAdSpend(client('abort', original, controller).sb, { ...args, signal: controller.signal }))
  const pre = new AbortController(); pre.abort(); const never = client()
  await assert.rejects(() => listAdSpend(never.sb, { ...args, signal: pre.signal })); assert.equal(never.calls(), 0)
  pass('pre-aborted and superseded reads reject even if fetch ignores cancellation')
  await assert.rejects(() => listAdSpend(client().sb, { from: args.to, to: args.from }))
  assert.deepEqual(await listAdSpend(client('normal', []).sb, args), [])
  pass('invalid period rejects before a request; verified empty period remains a successful empty result')
  if (process.env.GRANDBOOK_ADS_PROOF) fs.writeFileSync(process.env.GRANDBOOK_ADS_PROOF, JSON.stringify({ pass: true, checks, businessWrites: 0 }, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
