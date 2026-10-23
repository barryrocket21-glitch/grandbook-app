/* Runtime fixture: loopback only; normal Owner middleware, synthetic business reads. */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const { chromium } = require('playwright')
const base = process.env.GRANDBOOK_DASHBOARD_TEST_BASE
const output = process.env.GRANDBOOK_DASHBOARD_TEST_OUTPUT
const sessionPath = process.env.GRANDBOOK_DASHBOARD_TEST_SESSION
if (!base || new URL(base).hostname !== '127.0.0.1' || !output || !sessionPath) throw Error('Explicit loopback URL and private output/session paths required')
const session = JSON.parse(fs.readFileSync(sessionPath)).session
assert(session.expires_at * 1000 > Date.now(), 'Normal Owner session must be current')
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const drafts = Array.from({ length: 1001 }, (_, index) => ({
  id: index + 1, order_number: 'FIXTURE-' + (index + 1), total: 100, status: 'BARU', order_date: today,
  estimated_profit: 25, estimated_total_cost: 75, estimated_cod_fee: 1, estimated_ppn: .12,
}))
const tables = {
  orders_draft: drafts, orders: [],
  order_items_draft: drafts.map(row => ({ id: row.id, order_id: row.id, qty: 2, price: 30,
    products: { name: 'Produk Kanonik Contoh' }, orders_draft: { id: row.id, order_date: row.order_date, status: row.status } })),
  order_items: [], ad_spend: Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, spend_date: today, spend: 1 })),
}
let mode = 'normal', role = 'owner', blockPickup = null, pickupCalls = 0
const calls = [], unexpected = [], checks = [], errors = []
let activePage, activeBrowser
function record(name) { checks.push(name); console.log('PASS ' + name) }
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: '/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome' })
  activeBrowser = browser
  const ctx = await browser.newContext({ timezoneId: 'Asia/Jakarta', viewport: { width: 1440, height: 1100 }, colorScheme: 'light' })
  const chunks = ('base64-' + Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3500}/g)
  await ctx.addCookies(chunks.map((value, i) => ({
    name: 'sb-ubksitifaprqofujhova-auth-token' + (chunks.length > 1 ? '.' + i : ''), value, domain: '127.0.0.1', path: '/', secure: false,
  })))
  await ctx.addInitScript(() => localStorage.setItem('theme', 'light'))
  await ctx.route('**/rest/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), endpoint = url.pathname.split('/').pop(), head = request.method() === 'HEAD'
    const after = Number((url.searchParams.get('id') || 'gt.0').slice(3))
    calls.push({ endpoint, after, method: request.method() })
    const json = value => route.fulfill({ json: value })
    if (endpoint === 'profiles') return json({ id: session.user.id, organization_id: 1, active: true, role, full_name: 'Owner Contoh' })
    if (endpoint === 'notifications') return json([])
    if (endpoint === 'get_sidebar_counts') return json([{ drafts_total: 1001, inbox_pending_review: 0, inbox_unmatched_resi: 0 }])
    if (endpoint === 'get_payout_position') {
      if (mode === 'payout-error') return json([])
      return json([{ cair_total: 1234, cair_count: 1, uncair_total: 567, uncair_count: 2 }])
    }
    if (endpoint === 'get_cashflow_summary') {
      if (mode === 'widget-error') return route.fulfill({ status: 400, json: { message: 'Synthetic widget unavailable' } })
      return json([{ saldo_terakhir: 5000 }])
    }
    if (endpoint === 'pending_pickup_summary') {
      pickupCalls++
      if (mode === 'widget-error') return route.fulfill({ status: 400, json: { message: 'Synthetic pickup unavailable' } })
      if (mode === 'pickup-race' && !blockPickup) {
        let release
        const wait = new Promise(resolve => { release = resolve })
        blockPickup = release
        await wait
        try { return await json([{ total_count: 99, total_value: 999, oldest_days_pending: 9, by_channel: {} }]) } catch { return }
      }
      return json([{ total_count: 0, total_value: 0, oldest_days_pending: 0, by_channel: {} }])
    }
    if (Object.hasOwn(tables, endpoint)) {
      assert(['GET', 'HEAD'].includes(request.method()), 'No business writes')
      if ((mode === 'page-error' && endpoint === 'orders_draft' && after > 0) ||
          (mode === 'first-error' && endpoint === 'orders_draft')) {
        return route.fulfill({ status: 400, json: { message: 'Synthetic incomplete read' } })
      }
      const all = mode === 'empty' ? [] : tables[endpoint], remaining = all.filter(row => row.id > after)
      const rows = remaining.slice(0, 399)
      return route.fulfill({ status: 200, body: head ? '' : JSON.stringify(rows), headers: {
        'content-type': 'application/json', 'access-control-expose-headers': 'content-range', 'content-range': '*/' + (head ? all.length : remaining.length),
      } })
    }
    unexpected.push({ endpoint, method: request.method() }); return route.abort()
  })
  const page = await ctx.newPage()
  activePage = page
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(30000)
  const visit = async () => { await page.goto(base + '/dashboard', { timeout: 120000 }) }
  const ready = async () => {
    await Promise.race([
      page.locator('[data-dashboard-coverage]').waitFor({ timeout: 30000 }),
      page.getByRole('heading', { name: 'Dashboard belum dapat ditampilkan', exact: true }).waitFor({ timeout: 30000 }).then(() => { throw Error('Main dashboard fixture read failed') }),
    ])
    await page.getByRole('heading', { name: 'Saldo SPX & Cashflow', exact: true }).waitFor()
    await page.getByRole('heading', { name: /Resi Pending Pickup/ }).waitFor()
  }
  await visit(); await ready()
  await page.getByText('2002 unit terjual', { exact: true }).waitFor()
  assert((await page.locator('[data-dashboard-coverage]').innerText()).includes('1001 order'))
  assert(calls.some(call => call.endpoint === 'orders_draft' && call.after > 1000))
  record('complete >1000 rows using server cap399')
  await page.waitForTimeout(1800)
  const plotted = await page.locator('.recharts-area-curve, .recharts-pie-sector path').evaluateAll(nodes => nodes.map(node => node.getAttribute('d') || ''))
  assert(plotted.length >= 4 && plotted.every(value => value && !value.includes('NaN')), 'Trend/status SVG must render finite paths')
  record('trend and status plot finite paths')
  const ticks = (await page.locator('.recharts-cartesian-axis-tick-value').allTextContents()).filter(value => /^\d[\d.,]*(?:\s+(?:rb|jt|M|T))?$/.test(value))
  assert(ticks.length >= 3 && new Set(ticks).size === ticks.length, 'Different axis values must not round to identical labels')
  record('trend axis distinguishes small currency values')
  await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true, style: 'nextjs-portal { display:none !important; }' })
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 1100 })
    await page.waitForTimeout(1600)
    const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }))
    assert(layout.scroll <= layout.width + 1, 'Dashboard overflow ' + width + ': ' + JSON.stringify(layout))
    record('layout ' + width)
    if (width === 390) await page.screenshot({ path: path.join(output, 'dashboard-mobile.png'), fullPage: true, style: 'nextjs-portal { display:none !important; }' })
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  for (mode of ['first-error', 'page-error', 'payout-error']) {
    await page.getByRole('button', { name: 'Refresh', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Dashboard belum dapat ditampilkan', exact: true }).waitFor()
    assert.equal(await page.getByText('Omzet Bulan Ini', { exact: true }).count(), 0)
    assert.equal(await page.locator('[data-dashboard-coverage]').count(), 0)
    record(mode + ': no old totals, partial totals or zero fallback')
    if (mode === 'page-error') await page.screenshot({ path: path.join(output, 'dashboard-error.png'), fullPage: true, style: 'nextjs-portal { display:none !important; }' })
    mode = 'normal'; await page.getByRole('button', { name: 'Coba lagi', exact: true }).click(); await ready()
  }
  mode = 'empty'; await page.getByRole('button', { name: 'Refresh', exact: true }).first().click(); await ready()
  assert((await page.locator('[data-dashboard-coverage]').innerText()).includes('0 order'))
  await page.getByText('Belum ada data produk', { exact: true }).waitFor()
  record('valid empty dataset renders zero')
  mode = 'widget-error'; await page.getByRole('button', { name: 'Refresh', exact: true }).first().click()
  await page.getByText('Data pickup belum terbaca lengkap.', { exact: true }).waitFor()
  await page.getByText('Data saldo dan pencairan belum terbaca lengkap.', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-slot="card"][role="alert"]').count(), 2)
  record('independent widget failures explicit')
  mode = 'normal'
  await page.locator('[data-slot="card"][role="alert"]').filter({ hasText: 'Data pickup belum terbaca lengkap.' }).getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await page.locator('[data-slot="card"][role="alert"]').filter({ hasText: 'Data saldo dan pencairan belum terbaca lengkap.' }).getByRole('button', { name: 'Coba lagi', exact: true }).click()
  await ready(); record('widget retries recover')
  // Focus can overlap the pickup refresh. The old result must never replace the new result.
  mode = 'pickup-race'; await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  for (let i = 0; i < 100 && !blockPickup; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert(blockPickup, 'First pickup request reached fixture')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByText('✅ Tidak ada resi stuck. Semua order SIAP_KIRIM masih dalam threshold.', { exact: true }).waitFor()
  assert(blockPickup); blockPickup()
  await page.waitForTimeout(250)
  assert.equal(await page.getByText('99', { exact: true }).count(), 0)
  record('superseded/aborted widget response cannot overwrite latest data')
  mode = 'normal'; role = 'cs'
  const before = calls.length
  await visit(); await page.getByRole('heading', { name: 'Akses Terbatas', exact: true }).waitFor()
  assert.equal(calls.slice(before).filter(call => Object.hasOwn(tables, call.endpoint) || ['get_payout_position', 'get_cashflow_summary', 'pending_pickup_summary'].includes(call.endpoint)).length, 0)
  record('client verified role gate reads no dashboard business data for CS')
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
  fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify({ pass: true, checks, errors, unexpected, fixture: true, noBusinessWrites: true, pickupCalls }, null, 2))
  await browser.close()
})().catch(async error => {
  fs.writeFileSync(path.join(output, 'browser-failure.json'), JSON.stringify({ message: error.message, calls, unexpected, errors, checks }, null, 2))
  if (activePage) {
    fs.writeFileSync(path.join(output, 'browser-failure-body.txt'), await activePage.locator('body').innerText())
    await activePage.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true, style: 'nextjs-portal { display:none !important; }' })
  }
  if (activeBrowser) await activeBrowser.close()
  console.error(error.stack); process.exit(1)
})
