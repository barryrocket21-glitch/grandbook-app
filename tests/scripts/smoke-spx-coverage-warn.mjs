#!/usr/bin/env node
/**
 * Smoke test — Phase 8H input-time SPX coverage warn at /orders/new.
 *
 * Verifies /orders/new still loads cleanly after wiring `spx_city_coverage`
 * RPC into the cascade-picker effect. The RPC behaviour itself was verified
 * server-side (spx_city_coverage('Bali','Kab. Badung') → 'NOT_COVERED' etc.).
 * Interactive Combobox-click verification was attempted but the cmdk role
 * selectors weren't stable under Playwright; leaving as a load+structure
 * smoke.
 *
 * Loads owner session itself.
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
  await page.goto(`${BASE_URL}/orders/new`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(4000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/orders/new — no page error')
  else fail('/orders/new — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  // Cascade picker fields present
  if (low.includes('provinsi') && low.includes('kota / kabupaten')) pass('cascade picker rendered (Provinsi + Kota)')
  else fail('cascade picker', 'Provinsi/Kota labels not found')

  // Province combobox trigger exists
  const provTrigger = await page.locator('button:has-text("Pilih provinsi")').count()
  if (provTrigger > 0) pass('province combobox trigger present')
  else fail('province combobox', 'trigger not found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-orders-new-${ts}.png`)
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
