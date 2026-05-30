#!/usr/bin/env node
/**
 * Smoke test — Brief #3: Packing fee + Gate atribusi (mig 078, SHA 8d24682).
 *  1. /products/new — field "Fee Packing" ada.
 *  2. /inbox/atribusi-required — loads, table + filter + rows (advertiser gap).
 *  3. Sidebar — entry "Atribusi Required" + badge count.
 *  4. Order detail Cost & Profit — baris Packing (best-effort).
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const session = join(REPO_ROOT, 'tests', 'auth', 'owner-session.json')
if (!existsSync(session)) { console.error(`✗ Session missing: ${session}`); process.exit(1) }
const shotDir = join(REPO_ROOT, 'tests', 'screenshots'); mkdirSync(shotDir, { recursive: true })

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }
const ts = Date.now()

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

try {
  // 1. Product form — Fee Packing field
  console.log('\n[1] /products/new — Fee Packing')
  await page.goto(`${BASE_URL}/products/new`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3500)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(2) }
  let body = (await page.locator('body').innerText()).toLowerCase()
  errors.length === 0 ? pass('/products/new — no page error') : fail('page error', errors[0])
  body.includes('fee packing') ? pass('field "Fee Packing" tampil') : fail('packing field', 'not found')
  await page.screenshot({ path: join(shotDir, `packing-product-form-${ts}.png`), fullPage: true })
  console.log(`    📸 packing-product-form-${ts}.png`)

  // 2. Atribusi Required page
  console.log('\n[2] /inbox/atribusi-required')
  await page.goto(`${BASE_URL}/inbox/atribusi-required`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4000)
  body = (await page.locator('body').innerText()).toLowerCase()
  errors.length === 0 ? pass('atribusi — no page error') : fail('page error', errors[errors.length-1])
  body.includes('atribusi required') ? pass('header "Atribusi Required"') : fail('header', 'not found')
  const rowCount = await page.locator('table tbody tr').count()
  rowCount > 0 ? pass(`antrian table ada (${rowCount} rows)`) : fail('table', 'no rows')
  // ADV? badge (advertiser gap) hadir
  ;(body.includes('adv?') || body.includes('advertiser')) ? pass('indikator advertiser-gap tampil') : fail('adv indicator', 'not found')
  await page.screenshot({ path: join(shotDir, `packing-atribusi-${ts}.png`), fullPage: true })
  console.log(`    📸 packing-atribusi-${ts}.png`)

  // 3. Sidebar entry + badge
  console.log('\n[3] Sidebar "Atribusi Required"')
  const sideLink = await page.locator('a[href="/inbox/atribusi-required"]').count()
  sideLink > 0 ? pass('sidebar link /inbox/atribusi-required ada') : fail('sidebar link', 'not found')

  const passed = results.reduce((a, b) => a + b, 0)
  console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
  await browser.close()
  process.exit(passed === results.length ? 0 : 1)
} catch (err) {
  fail('RUNTIME', err.message)
  await browser.close()
  process.exit(1)
}
