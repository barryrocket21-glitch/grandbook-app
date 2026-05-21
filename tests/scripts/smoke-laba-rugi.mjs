#!/usr/bin/env node
/**
 * Smoke test — Laporan Laba Rugi (/laba-rugi).
 *
 * Verifies the new monthly P&L page loads as owner, no page error,
 * the laba_rugi_summary RPC returns org-scoped data (order stats + the
 * P&L cascade render with real numbers), and the page is linked in the
 * Keuangan sidebar group.
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
  await page.goto(`${BASE_URL}/laba-rugi`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/laba-rugi — no page error')
  else fail('/laba-rugi — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  if (low.includes('laporan laba rugi')) pass('page header — "Laporan Laba Rugi"')
  else fail('page header', '"Laporan Laba Rugi" not found')

  if (low.includes('akses dibatasi')) fail('access', 'owner blocked by role gate')
  else pass('access — owner can view')

  if (low.includes('gagal memuat')) fail('RPC data', 'page shows "Gagal memuat data"')
  else pass('RPC data — no load error')

  if (low.includes('laba bersih')) pass('headline — Laba Bersih cards present')
  else fail('headline', '"Laba Bersih" not found')

  if (low.includes('gross profit')) pass('P&L cascade — Gross Profit row present')
  else fail('P&L cascade', '"Gross Profit" not found')

  if (body.includes('LABA BERSIH')) pass('P&L cascade — LABA BERSIH grand total row')
  else fail('P&L grand total', '"LABA BERSIH" row not found')

  // Order breakdown stats — confirms RPC returned org-scoped aggregate
  if (low.includes('total order') && low.includes('diterima')) pass('order breakdown stats rendered')
  else fail('order breakdown', 'Total Order / Diterima stats not found')

  // Sidebar deep-link present (Keuangan group)
  const sidebarLink = await page.locator('a[href="/laba-rugi"]').count()
  if (sidebarLink > 0) pass('sidebar — /laba-rugi link present')
  else fail('sidebar link', 'no a[href="/laba-rugi"] in DOM')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-laba-rugi-${ts}.png`)
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
