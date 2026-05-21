#!/usr/bin/env node
/**
 * Smoke test — Posisi Keuangan v2 (/financial-position).
 *
 * Verifies the rebuilt COD cashflow map loads as owner: no page error,
 * get_financial_position RPC returns org data, asset + liability buckets
 * render with real numbers, and the net-position headline is present.
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
  await page.goto(`${BASE_URL}/financial-position`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/financial-position — no page error')
  else fail('/financial-position — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  if (low.includes('posisi keuangan')) pass('page header — "Posisi Keuangan"')
  else fail('page header', '"Posisi Keuangan" not found')

  if (low.includes('akses dibatasi')) fail('access', 'owner blocked by role gate')
  else pass('access — owner can view')

  if (low.includes('gagal memuat')) fail('RPC data', 'page shows "Gagal memuat"')
  else pass('RPC data — no load error')

  if (low.includes('posisi bersih')) pass('headline — Posisi Bersih')
  else fail('headline', '"Posisi Bersih" not found')

  if (low.includes('cod di perjalanan') && low.includes('cod di spx')) pass('asset buckets rendered')
  else fail('asset buckets', 'COD di Perjalanan / COD di SPX not found')

  if (low.includes('hpp ke supplier') && low.includes('ongkir spx') && low.includes('komisi tim'))
    pass('liability buckets rendered')
  else fail('liability buckets', 'HPP / Ongkir SPX / Komisi Tim not found')

  // Real data — a millions-range dotted rupiah figure must render
  if (/\d{1,3}\.\d{3}\.\d{3}/.test(body)) pass('RPC returned real org data (rupiah figures present)')
  else fail('real data', 'no millions-range rupiah figure found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-financial-position-${ts}.png`)
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
