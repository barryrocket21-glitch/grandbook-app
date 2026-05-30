#!/usr/bin/env node
/**
 * Smoke test — Brief #4: Retur Root-Cause (mig 082).
 * Pakai dummy data TEST-RETUR (10 order: 6 DITERIMA + 3 RETUR + 1 FAKE, 1 produk).
 *  1. /analytics?section=retur — nav "Retur", panels muncul.
 *  2. Return rate math: produk 3/(6+3) = 33.3%.
 *  3. FAKE kolom kepisah, drill reject_reason.
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const session = join(ROOT, 'tests', 'auth', 'owner-session.json')
if (!existsSync(session)) { console.error('✗ session missing'); process.exit(1) }
const shotDir = join(ROOT, 'tests', 'screenshots'); mkdirSync(shotDir, { recursive: true })

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }
const ts = Date.now()

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 950 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))

try {
  await page.goto(`${BASE_URL}/analytics?section=retur`, { waitUntil: 'networkidle', timeout: 45000 })
  try { await page.waitForSelector('text=Per Produk', { timeout: 18000 }) } catch {}
  if (page.url().includes('/login')) { console.error('✗ session expired'); await browser.close(); process.exit(2) }
  await page.waitForTimeout(2500)
  const body = await page.locator('body').innerText()

  errs.length === 0 ? pass('/analytics retur — no page error') : fail('page error', errs[0])
  // nav has Retur
  const navRetur = await page.locator('button[role="tab"]:has-text("Retur")').count()
  navRetur > 0 ? pass('nav tab "Retur" ada') : fail('nav', 'Retur tab not found')
  // panels
  ;(body.includes('Per Produk') && body.includes('Per CS') && body.includes('Per Campaign') && body.includes('Per Wilayah') && body.includes('Per Kurir'))
    ? pass('5 panel (Produk/CS/Campaign/Wilayah/Kurir)') : fail('panels', 'not all 5 panels present')
  // math 33.3% for test product
  body.includes('TEST RETUR PRODUK') ? pass('produk test muncul') : fail('test product', 'not found')
  body.includes('33.3%') ? pass('return_rate 33.3% (3/(6+3), FAKE excluded)') : fail('return rate math', '33.3% not found')
  // FAKE column header
  body.includes('Fake') ? pass('kolom Fake (kepisah dari retur)') : fail('fake column', 'not found')
  // campaign sanding cols
  ;(body.includes('CPR') && body.includes('Net Profit')) ? pass('panel campaign: CPR + Net Profit sebaris') : fail('campaign cols', 'CPR/Net Profit missing')

  await page.screenshot({ path: join(shotDir, `retur-${ts}.png`), fullPage: true })
  console.log(`    📸 retur-${ts}.png`)

  // drill reject_reason — klik baris produk
  await page.locator('tr:has-text("TEST RETUR PRODUK")').first().click().catch(() => {})
  await page.waitForTimeout(2000)
  const body2 = await page.locator('body').innerText()
  ;(body2.includes('Alasan retur') || body2.includes('Alamat tidak ditemukan') || body2.includes('menolak'))
    ? pass('drill reject_reason muncul') : fail('drill', 'reject_reason breakdown not shown')
} catch (err) {
  fail('RUNTIME', err.message)
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
await browser.close()
process.exit(passed === results.length ? 0 : 1)
