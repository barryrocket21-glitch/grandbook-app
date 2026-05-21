#!/usr/bin/env node
/**
 * Smoke test — SPX coverage warning at export (Phase 8H, /orders/export-resi).
 *
 * Drives the export flow to the Preview step (select SIAP_KIRIM orders +
 * spx_outbound profile) and verifies the non-coverage warning banner shows.
 * Stops at Preview — does NOT click Generate (no file, no status change).
 *
 * Loads owner session itself (ignores argv slot).
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const session = join(REPO_ROOT, 'tests', 'auth', 'owner-session.json')
if (!existsSync(session)) { console.error(`✗ Session missing: ${session}`); process.exit(1) }

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const ts = Date.now()

try {
  await page.goto(`${BASE_URL}/orders/export-resi`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4500)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/orders/export-resi — no page error')
  else fail('/orders/export-resi — page error', errors[0])

  // Step 1 — orders listed, select all
  const rowCount = await page.locator('table tbody tr').count()
  if (rowCount > 0) pass(`step 1 — ${rowCount} orders listed`)
  else fail('step 1 orders', 'no rows in table')

  await page.locator('table thead').getByRole('checkbox').first().click({ timeout: 8000 })
  await page.waitForTimeout(700)
  await page.locator('button:has-text("Lanjutkan")').click({ timeout: 8000 })
  await page.waitForTimeout(1200)

  // Step 2 — pick the spx_outbound profile
  await page.locator('button:has-text("Pilih profile outbound")').first().click({ timeout: 8000 })
  await page.waitForTimeout(900)
  await page.locator('[role="option"]:has-text("spx_outbound")').first().click({ timeout: 8000 })
  await page.waitForTimeout(700)
  pass('step 2 — spx_outbound profile selected')

  // Step 3 — preview (previewOutbound + check_orders_spx_coverage RPC)
  await page.locator('button:has-text("Lanjut ke Preview")').click({ timeout: 8000 })
  await page.waitForTimeout(7000)
  const body = await page.locator('body').innerText()

  if (body.includes('Preview') && body.includes('order')) pass('step 3 — preview rendered')
  else fail('step 3 preview', 'preview step did not render')

  if (body.includes('TIDAK dilayani SPX')) pass('coverage warning banner shown')
  else fail('coverage banner', '"TIDAK dilayani SPX" not found at preview')

  const m = body.match(/(\d+) order ke area yang TIDAK dilayani SPX/)
  if (m && Number(m[1]) > 0) pass(`banner flags ${m[1]} non-coverage order(s)`)
  else fail('banner count', 'non-coverage order count not found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-spx-coverage-${ts}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  console.log(`    📸 ${shot}`)
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
