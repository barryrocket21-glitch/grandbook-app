#!/usr/bin/env node
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3002'
const session = process.env.AUTH_STATE || join(REPO_ROOT, 'tests', 'auth', 'owner-session.json')
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
  await page.goto(`${BASE_URL}/reports/owner-profit`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(6000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/reports/owner-profit — no page error')
  else fail('/reports/owner-profit — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  if (low.includes('owner profit cockpit')) pass('header — Owner Profit Cockpit')
  else fail('header', 'Owner Profit Cockpit not found')

  if (low.includes('profit setelah ads')) pass('headline — Profit Setelah Ads')
  else fail('headline', 'Profit Setelah Ads not found')

  if (low.includes('produk × platform') || low.includes('produk x platform')) pass('table — Produk × Platform')
  else fail('produk x platform', 'section not found')

  if (low.includes('read_only_owner_profit_cockpit')) pass('read-only marker visible')
  else fail('read-only marker', 'READ_ONLY_OWNER_PROFIT_COCKPIT not found')

  const exportBtn = await page.locator('button:has-text("Export Excel")').count()
  if (exportBtn > 0) pass('Export Excel button present')
  else fail('export button', 'Export Excel button not found')

  if (low.includes('gagal memuat owner profit cockpit')) fail('data load', 'page shows load error')
  else pass('data load — no load error banner')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-profit-cockpit-${ts}.png`)
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
