#!/usr/bin/env node
/**
 * Smoke test — Variant analytics (Phase 8C, /analytics/produk/[id]).
 *
 * Loads the Jaring Paranet product detail page and verifies the new
 * "Performa per Varian" table renders with the size variants + their
 * sales/retur figures.
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

const PRODUCT_ID = 5 // Jaring Paranet — 5 size variants, 100% matched in backfill

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
  await page.goto(`${BASE_URL}/analytics/produk/${PRODUCT_ID}`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(7000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/analytics/produk/5 — no page error')
  else fail('/analytics/produk/5 — page error', errors[0])

  const body = await page.locator('body').innerText()
  const low = body.toLowerCase()

  if (low.includes('performa per varian')) pass('section — "Performa per Varian" present')
  else fail('variant section', '"Performa per Varian" not found')

  // Paranet size variants
  const sizes = ['2x3', '3x3', '4x3', '5x3', '6x3']
  const found = sizes.filter((s) => body.includes(s))
  if (found.length >= 3) pass(`variant rows rendered (${found.length}/5 sizes: ${found.join(', ')})`)
  else fail('variant rows', `only ${found.length}/5 sizes found`)

  // Table has Omset & Retur columns
  if (low.includes('omset') && low.includes('retur')) pass('variant table columns (Omset, Retur)')
  else fail('variant columns', 'Omset / Retur headers not found')

  // Real data — rupiah figures present in the section
  if (/\d{1,3}\.\d{3}\.\d{3}/.test(body)) pass('variant figures rendered (rupiah present)')
  else fail('variant figures', 'no rupiah figure found')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-variant-analytics-${ts}.png`)
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
