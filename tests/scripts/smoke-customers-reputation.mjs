#!/usr/bin/env node
/**
 * Smoke test — Brief #1: Customer Reputation + Blacklist (mig 077, SHA 318a6df).
 *
 * Owner session against deployed Vercel:
 *  1. /customers list — header, filters, table.
 *  2. /customers/81236037367 detail — reputasi (WATCH, 2 order/1 retur), riwayat.
 *  3. /orders/new — input HP risky → warning banner muncul (debounced RPC).
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const RISKY_PHONE_RAW = '081236037367'   // canonical 81236037367 = WATCH (2 order, 1 retur)
const session = join(REPO_ROOT, 'tests', 'auth', 'owner-session.json')
if (!existsSync(session)) { console.error(`✗ Session missing: ${session}`); process.exit(1) }
const shotDir = join(REPO_ROOT, 'tests', 'screenshots')
mkdirSync(shotDir, { recursive: true })

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
  // ---- 1. /customers list ----
  console.log('\n[1] /customers list')
  await page.goto(`${BASE_URL}/customers`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired — recapture needed'); await browser.close(); process.exit(2) }

  let body = (await page.locator('body').innerText()).toLowerCase()
  errors.length === 0 ? pass('/customers — no page error') : fail('/customers — page error', errors[0])
  body.includes('pelanggan') ? pass('header "Pelanggan"') : fail('header', 'not found')
  ;(body.includes('blacklist') && body.includes('tier')) ? pass('filter blacklist + tier present') : fail('filters', 'blacklist/tier filter missing')
  const rowCount = await page.locator('table tbody tr').count()
  rowCount > 0 ? pass(`customers table renders (${rowCount} rows)`) : fail('table', 'no rows — backfill/RLS issue?')
  await page.screenshot({ path: join(shotDir, `customers-list-${ts}.png`), fullPage: true })
  console.log(`    📸 customers-list-${ts}.png`)

  // ---- 2. /customers/[phone] detail ----
  console.log('\n[2] /customers/81236037367 detail')
  await page.goto(`${BASE_URL}/customers/81236037367`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3500)
  body = (await page.locator('body').innerText()).toLowerCase()
  errors.length === 0 ? pass('detail — no page error') : fail('detail — page error', errors[errors.length-1])
  body.includes('total order') ? pass('stat cards (Total Order / Delivery / Return / LTV)') : fail('stat cards', 'not found')
  body.includes('perhatian') ? pass('tier badge WATCH ("Perhatian")') : fail('tier badge', 'WATCH not shown')
  body.includes('riwayat order') ? pass('riwayat order section') : fail('riwayat order', 'not found')
  const blBtn = await page.getByRole('button', { name: /blacklist/i }).count()
  blBtn > 0 ? pass('Blacklist button present (owner)') : fail('blacklist button', 'not found')
  await page.screenshot({ path: join(shotDir, `customers-detail-${ts}.png`), fullPage: true })
  console.log(`    📸 customers-detail-${ts}.png`)

  // ---- 3. Warning saat input order ----
  console.log('\n[3] /orders/new — warning reputasi')
  await page.goto(`${BASE_URL}/orders/new`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3000)
  const phoneInput = page.getByPlaceholder('08xxxxxxxxxx')
  if (await phoneInput.count() === 0) {
    fail('phone field', 'input No HP tidak ketemu')
  } else {
    await phoneInput.first().fill(RISKY_PHONE_RAW)
    await phoneInput.first().blur()
    await page.waitForTimeout(2500) // debounce 500ms + RPC
    body = (await page.locator('body').innerText()).toLowerCase()
    if (body.includes('perhatian') || body.includes('retur')) pass('warning banner muncul utk nomor WATCH')
    else fail('warning banner', 'tidak muncul setelah isi HP risky')
    await page.screenshot({ path: join(shotDir, `customers-input-warning-${ts}.png`), fullPage: false })
    console.log(`    📸 customers-input-warning-${ts}.png`)
  }
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
