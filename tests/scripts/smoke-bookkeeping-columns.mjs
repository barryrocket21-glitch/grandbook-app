#!/usr/bin/env node
/**
 * Smoke test — bookkeeping columns di Arsip (/orders/list).
 *
 * Verifies the page still loads after the list_orders_enriched RPC was
 * extended (now 68 cols), no page error, table renders, and the column
 * customizer lists the new "Pembukuan" column groups.
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
  await page.goto(`${BASE_URL}/orders/list`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/orders/list — no page error')
  else fail('/orders/list — page error', errors[0])

  const tableRows = await page.locator('table tbody tr').count()
  if (tableRows > 0) pass(`/orders/list — table rendered (${tableRows} rows)`)
  else fail('/orders/list — table', 'no rows')

  await page.locator('button:has-text("Kolom")').first().click({ timeout: 8000 })
  await page.waitForTimeout(1500)
  const txt = (await page.locator('body').innerText()).toLowerCase()

  if (txt.includes('pembukuan')) pass('customizer — "Pembukuan" column groups present')
  else fail('customizer — Pembukuan groups', 'not found in customizer')

  if (txt.includes('gross profit')) pass('customizer — bookkeeping columns listed (Gross Profit)')
  else fail('customizer — bookkeeping columns', '"Gross Profit" not found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-bookkeeping-columns-${ts}.png`)
  await page.screenshot({ path: shot })
  console.log(`    📸 ${shot}`)
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
