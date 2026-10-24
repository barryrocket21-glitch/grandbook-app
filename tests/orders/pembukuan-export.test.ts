import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Explicit isolated app directory, never production data or service-role credentials.
async function main() {
  const app = process.env.GRANDBOOK_EXPORT_APP
  if (!app) throw Error('GRANDBOOK_EXPORT_APP required')
  const { collectPembukuanExport: collect, pembukuanRowKey: key, buildPembukuanXlsxBlob: excel, buildPembukuanCsvBlob: csv } = await import(pathToFileURL(app + '/src/lib/orders/pembukuan-export.ts').href)
  const XLSX = createRequire(app + '/package.json')('xlsx')
  const rows = Array.from({ length: 2407 }, (_, i) => ({
    source: i % 2 ? 'draft' : 'final', id: Math.floor(i / 2) + 1,
    order_number: `SYNTH-${i}`, order_date: '2099-10-23', status: i % 2 ? 'BARU' : 'DITERIMA',
    zone: i % 2 ? 'Antrian' : 'Arsip (Delivered)', total_count: 2407,
    customer_name: 'Contoh', customer_city: null, cs_name: null, attribution_code_raw: 'Produk.Facebook.Akun.Campaign',
    campaign_name: 'Campaign', campaign_platform: 'Facebook', channel_name: null, product_summary: 'Produk',
    qty: 1, payment_method: 'COD', penjualan: 123456.78, ongkir: 10000,
    cod_amount: null, tracking_no: '001234567890', resi: null,
    est_omset: 100000.25, est_hpp: 30000.5, est_fee_cs: 2500, est_gross_profit: 67500.25,
    act_omset: null, act_hpp: null, act_fee_cs: null, act_gross_profit: null,
    dicairkan: i === 0 ? 0 : null, cod_settled_at: null, delivered_at: null, returned_at: null,
  }))
  const page = async (offset: number, limit: number) => rows.slice(offset, offset + limit)
  await test('2407 rows and source/id collisions survive response cap with overlapping pages', async () => {
    const calls: number[][] = [], progress: number[][] = []
    const result = await collect({ fetchPage: async (offset: number, limit: number) => { calls.push([offset, limit]); return page(offset, limit) }, onProgress: (r: number, t: number) => progress.push([r, t]) })
    assert.deepEqual(result, rows)
    assert(calls.every(([, limit]) => limit <= 500))
    assert.deepEqual(calls.slice(0, 3), [[0, 500], [499, 500], [998, 500]])
    assert.deepEqual(progress.at(-1), [2407, 2407])
  })
  await test('short responses still advance by actual rows rather than assumed limit', async () => {
    assert.deepEqual(await collect({ fetchPage: (o: number, l: number) => page(o, Math.min(l, 137)) }), rows)
  })
  await test('zone and compound selected identities apply across all pages using fresh values', async () => {
    const selected = new Set([key(rows[0]), key(rows[1]), key(rows[2210])])
    assert.deepEqual(await collect({ fetchPage: page, selected }), [rows[0], rows[1], rows[2210]])
    assert.deepEqual(await collect({ fetchPage: page, zone: 'Antrian' }), rows.filter(r => r.zone === 'Antrian'))
    await assert.rejects(collect({ fetchPage: page, selected, zone: 'Antrian' }), /pilihan/)
    await assert.rejects(collect({ fetchPage: page, selected: new Set(['draft:99999']) }), /pilihan/)
    await assert.rejects(collect({ fetchPage: page, selected: new Set() }), /Pilih/)
  })
  await test('read error, missing page, changing count, duplicate, shifted boundary and changed head reject partial output', async () => {
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => { if (o) throw Error('offline'); return page(o, l) } }), /offline/)
    await assert.rejects(collect({ fetchPage: (o: number, l: number) => o ? Promise.resolve([]) : page(o, l) }), /lengkap/)
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => (await page(o, l)).map(r => ({ ...r, total_count: o ? 2408 : 2407 })) }), /berubah/)
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => { const b = await page(o, l); if (o === 499) b[2] = b[1]; return b } }), /berubah/)
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => page(o === 499 ? 500 : o, l) }), /berubah/)
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => (await page(o, l)).map(r => o === 0 && l === 1 ? ({ ...r, penjualan: 1 }) : r) }), /berubah/)
  })
  await test('invalid totals/identities and oversized responses fail closed', async () => {
    for (const invalid of [null, -1, 'abc', 0, 2.5]) {
      await assert.rejects(collect({ fetchPage: async () => [{ ...rows[0], total_count: invalid }] }), /berubah/)
    }
    await assert.rejects(collect({ fetchPage: async () => [{ ...rows[0], source: 'other' }] }), /berubah/)
    await assert.rejects(collect({ fetchPage: async () => rows.slice(0, 501) }), /berubah/)
  })
  await test('growth at terminal probe and deletion on final recheck fail closed', async () => {
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => o === 2407 ? [rows[0]] : page(o, l) }), /berubah/)
    await assert.rejects(collect({ fetchPage: async (o: number, l: number) => o === 0 && l === 1 ? [] : page(o, l) }), /berubah/)
  })
  await test('abort before and during read, including final validation', async () => {
    const a = new AbortController(); a.abort()
    await assert.rejects(collect({ fetchPage: page, signal: a.signal }), { name: 'AbortError' })
    for (const point of [499, 2407]) {
      const b = new AbortController()
      await assert.rejects(collect({ signal: b.signal, fetchPage: async (o: number, l: number) => { if (o === point) b.abort(); return page(o, l) } }), { name: 'AbortError' })
    }
  })
  await test('empty result is rechecked without fabricated totals', async () => {
    assert.deepEqual(await collect({ fetchPage: async () => [] }), [])
  })
  await test('actual 2407-row XLSX retains numeric decimals, attribution, identifiers, formulas and unknown blanks', async () => {
    const result = await collect({ fetchPage: page })
    const wb = XLSX.read(Buffer.from(await excel(result).arrayBuffer()), { type: 'buffer', cellFormula: true })
    const ws = wb.Sheets.Pembukuan, data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    assert.equal(data.length, 2409)
    const column = (name: string) => data[0].indexOf(name)
    const cell = (name: string, r: number) => ws[XLSX.utils.encode_cell({ c: column(name), r })]
    for (const index of [1, 1001, 2407]) {
      assert.equal(cell('Tagihan pembeli', index).t, 'n')
      assert.equal(cell('Tagihan pembeli', index).v, 123456.78)
      assert.equal(cell('Kode Atribusi', index).v, 'Produk.Facebook.Akun.Campaign')
      assert.equal(cell('Resi', index).t, 's'); assert.equal(cell('Resi', index).v, '001234567890')
    }
    const total = cell('Tagihan pembeli', 2408)
    assert.equal(total.f, 'SUM(Q2:Q2408)')
    assert(Math.abs(total.v - rows.reduce((n, r) => n + r.penjualan, 0)) < 0.001)
    assert.equal(cell('Dicairkan (GrandBook)', 1).v, 0)
    assert.equal(cell('Dicairkan (GrandBook)', 2)?.v ?? '', '')
    assert.equal(cell('Fee Admin (Est)', 2408).v, '')
    assert.match(cell('Fee Admin (Est)', 2408).f, /^IF\(COUNT\(/)
    assert.equal(cell('Selisih Ongkir', 2408).v, '')
    const csvText = await csv(result).text()
    assert.equal(csvText.split('\n').filter(Boolean).length, 2409)
    assert(csvText.includes('SYNTH-2406'))
  })
}
main().catch(error => { console.error(error); process.exitCode = 1 })
