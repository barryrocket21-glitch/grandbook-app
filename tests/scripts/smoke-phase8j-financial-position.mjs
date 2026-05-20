#!/usr/bin/env node
/**
 * Phase 8J smoke test: /financial-position dashboard.
 *
 * Verifies:
 * - Page loads
 * - 3 stat cards (Saldo SPX / In-transit COD / HPP Terutang)
 * - Net position banner
 * - SupplierPayableSheet button works
 * - Info panel visible
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
if (!existsSync(sessionPath)) { console.error(`✗ Session missing: ${sessionPath}`); process.exit(1) }

const results = []
function pass(t) { results.push({ ok: 1 }); console.log(`  ✓ ${t}`) }
function fail(t, r) { results.push({ ok: 0 }); console.log(`  ✗ ${t}: ${r}`) }

console.log(`\n=== Phase 8J Smoke (as ${slot}) ===\n`)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: sessionPath,
  viewport: { width: 1600, height: 900 },
})
const page = await context.newPage()
const ts = Date.now()

try {
  await page.goto(`${BASE_URL}/financial-position`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  if (page.url().includes('financial-position')) pass('Navigate to /financial-position')
  else fail('Navigate', `Redirected ${page.url()}`)

  if (await page.locator('text=Posisi Keuangan').count() > 0) pass('Heading "Posisi Keuangan"')
  else fail('Heading', 'not found')

  if (await page.locator('text=Saldo SPX').count() > 0) pass('Card "Saldo SPX" present')
  else fail('Saldo SPX card', 'not found')

  if (await page.locator('text=In-transit COD').count() > 0) pass('Card "In-transit COD" present')
  else fail('In-transit COD card', 'not found')

  if (await page.locator('text=HPP Terutang').count() > 0) pass('Card "HPP Terutang" present')
  else fail('HPP Terutang card', 'not found')

  if (await page.locator('text=Posisi bersih').count() > 0) pass('Net position banner')
  else fail('Net position banner', 'not found')

  if (await page.locator('text=Detail per supplier').count() > 0) pass('"Detail per supplier" trigger present')
  else fail('Detail per supplier link', 'not found')

  if (await page.locator('text=Cara baca').count() > 0) pass('Info panel "Cara baca"')
  else fail('Info panel', 'not found')

  const screenshotPath = join(REPO_ROOT, 'tests', 'screenshots', `${slot}-financial-position-${ts}.png`)
  await page.screenshot({ path: screenshotPath, fullPage: false })
  console.log(`\n📸 ${screenshotPath}`)
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.filter(r => r.ok).length
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
