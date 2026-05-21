#!/usr/bin/env node
/**
 * Smoke test — Dashboard utama (rework).
 *
 * Verifies the reworked owner dashboard loads: no page error, hero cards
 * (Laba Bersih + Posisi Bersih) render and link to their detail pages,
 * KPI cards + charts + Top Produk render, and real org data is present.
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
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(6000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/dashboard — no page error')
  else fail('/dashboard — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  if (low.includes('laba bersih')) pass('hero — Laba Bersih card')
  else fail('hero Laba Bersih', 'not found')

  if (low.includes('posisi bersih')) pass('hero — Posisi Bersih card')
  else fail('hero Posisi Bersih', 'not found')

  const labaLink = await page.locator('a[href="/laba-rugi"]').count()
  const posisiLink = await page.locator('a[href="/financial-position"]').count()
  if (labaLink > 0 && posisiLink > 0) pass('hero cards link to /laba-rugi & /financial-position')
  else fail('hero links', `laba=${labaLink} posisi=${posisiLink}`)

  if (low.includes('omzet bulan ini') && low.includes('roas blended')) pass('KPI cards rendered')
  else fail('KPI cards', 'Omzet Bulan Ini / ROAS Blended not found')

  if (low.includes('trend 30 hari') && low.includes('status order')) pass('charts rendered')
  else fail('charts', 'trend / status chart not found')

  if (low.includes('top 5 produk')) pass('Top 5 Produk section')
  else fail('top produk', '"Top 5 Produk" not found')

  if (/\d{1,3}\.\d{3}\.\d{3}/.test(body)) pass('real org data (rupiah figures present)')
  else fail('real data', 'no millions-range rupiah figure found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-dashboard-${ts}.png`)
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
