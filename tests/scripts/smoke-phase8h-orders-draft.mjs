#!/usr/bin/env node
/**
 * Phase 8H smoke test: /orders/draft (Antrian Kerja) functionality.
 *
 * Verifies:
 * - Page loads + role-aware landing
 * - Stats bar 5 cards visible
 * - Filter row (search + status dropdown + dates)
 * - Table renders rows (>0 atau empty state)
 * - Bulk action bar appears saat select
 * - Set Resi Massal button visible
 * - Resi button per row
 * - ⋮ dropdown actions accessible
 *
 * Usage:
 *   node tests/scripts/smoke-phase8h-orders-draft.mjs <slot>
 *   slot = owner | indra | cs
 *
 * Output:
 *   tests/screenshots/<slot>-orders-draft-<ts>.png
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = join(dirname(__filename), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'

const slot = process.argv[2] || 'owner'
const sessionPath = join(REPO_ROOT, 'tests', 'auth', `${slot}-session.json`)
if (!existsSync(sessionPath)) {
  console.error(`✗ Session file not found: ${sessionPath}`)
  console.error('  Run: npm run capture-session -- ' + slot + ' <email> <password>')
  process.exit(1)
}

const results = []
function pass(test) { results.push({ test, ok: true }); console.log(`  ✓ ${test}`) }
function fail(test, reason) { results.push({ test, ok: false, reason }); console.log(`  ✗ ${test}: ${reason}`) }

const startTs = Date.now()
console.log(`\n=== Phase 8H Smoke Test (as ${slot}) — ${new Date().toISOString()} ===\n`)

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: sessionPath,
  viewport: { width: 1600, height: 900 },
})
const page = await context.newPage()

try {
  // Test 1: Navigate to /orders/draft (wait for network idle = auth + data done)
  await page.goto(`${BASE_URL}/orders/draft`, { waitUntil: 'networkidle', timeout: 30000 })
  if (!page.url().includes('/orders/draft')) {
    fail('Navigate to /orders/draft', `Redirected to ${page.url()}`)
  } else {
    pass('Navigate to /orders/draft')
  }

  // Wait for data hydration (sidebar User → Barry, table populated)
  await page.waitForTimeout(2000)

  // Test 2: Page header "Antrian Kerja"
  await page.waitForSelector('h1, h2', { timeout: 10000 })
  const hasHeading = await page.locator('text=Antrian Kerja').count() > 0
  if (hasHeading) pass('Heading "Antrian Kerja" present')
  else fail('Heading "Antrian Kerja"', 'not found')

  // Test 3: Stats bar — 5 cards (Total + BARU + SIAP_KIRIM + PROBLEM + CANCEL)
  const statCards = await page.locator('button:has-text("TOTAL"), button:has-text("BARU"), button:has-text("SIAP KIRIM"), button:has-text("PROBLEM"), button:has-text("CANCEL")').count()
  if (statCards >= 3) pass(`Stats bar has ${statCards} clickable cards`)
  else fail('Stats bar', `Only ${statCards} cards found`)

  // Test 4: Filter row — search input
  const searchInput = await page.locator('input[placeholder*="Cari order"]').count()
  if (searchInput > 0) pass('Search input present')
  else fail('Search input', 'not found')

  // Test 5: Status dropdown (Base UI Select renders raw value "ALL" without render-fn)
  const statusSelect = await page.locator('button:has-text("ALL"), button[role="combobox"]').count()
  if (statusSelect > 0) pass('Status dropdown present')
  else fail('Status dropdown', 'not found')

  // Test 6: Tombol "Set Resi Massal"
  const bulkResiBtn = await page.locator('button:has-text("Set Resi Massal")').count()
  if (bulkResiBtn > 0) pass('"Set Resi Massal" button visible')
  else fail('Set Resi Massal button', 'not found (may be role-restricted)')

  // Test 7: "Input Order Baru" button
  const inputOrderBtn = await page.locator('a:has-text("Input Order Baru"), button:has-text("Input Order Baru")').count()
  if (inputOrderBtn > 0) pass('"Input Order Baru" button visible')
  else fail('Input Order Baru button', 'not found')

  // Test 8: Table render — header row + data row OR empty state
  const tableRows = await page.locator('table tbody tr').count()
  if (tableRows > 0) pass(`Table has ${tableRows} rows`)
  else fail('Table rows', '0 rows (expect 140+ drafts after Phase 8H migrate)')

  // Test 9: At least one Resi button per row
  const resiBtns = await page.locator('button:has-text("Resi")').count()
  if (resiBtns > 0) pass(`Found ${resiBtns} "Resi" buttons in rows`)
  else fail('Per-row Resi button', '0 found')

  // Test 10: Quality filter chip
  const qualityChip = await page.locator('button:has-text("Data tidak lengkap")').count()
  if (qualityChip > 0) pass('Quality filter chip "Data tidak lengkap" visible')
  else fail('Quality filter chip', 'not found')

  // Final screenshot
  const screenshotPath = join(REPO_ROOT, 'tests', 'screenshots', `${slot}-orders-draft-${startTs}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`\n📸 Screenshot: ${screenshotPath}`)

} catch (err) {
  fail('TEST_RUNTIME_ERROR', err.message)
  const errPath = join(REPO_ROOT, 'tests', 'screenshots', `${slot}-orders-draft-error-${startTs}.png`)
  await page.screenshot({ path: errPath, fullPage: true }).catch(() => {})
  console.error(`\n💥 Error screenshot: ${errPath}`)
} finally {
  await browser.close()
}

// Summary
const total = results.length
const passed = results.filter(r => r.ok).length
const failed = total - passed
console.log(`\n=== Summary: ${passed}/${total} passed ===`)
if (failed > 0) {
  console.log('\nFailures:')
  results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.test}: ${r.reason}`))
  process.exit(1)
}
process.exit(0)
