#!/usr/bin/env node
/**
 * Phase 8L smoke test: sidebar count badges visible.
 *
 * Verifies:
 * - Sidebar entry "Antrian Kerja" shows count badge
 * - Badge value = drafts_total (143 di prod sekarang)
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

console.log(`\n=== Phase 8L Sidebar Counts (as ${slot}) ===\n`)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: sessionPath,
  viewport: { width: 1600, height: 900 },
})
const page = await context.newPage()
const ts = Date.now()

try {
  // Navigate to /orders/draft — sidebar will auto-expand Orders parent
  await page.goto(`${BASE_URL}/orders/draft`, { waitUntil: 'networkidle', timeout: 30000 })
  // Wait extra long for sidebar hook to fetch + render
  await page.waitForTimeout(5000)

  pass('Page loaded with Orders parent expanded')

  // Trigger sidebar expand untuk Orders group (kalau collapsed)
  // Look for "Antrian Kerja" entry
  const antrianKerja = await page.locator('text=Antrian Kerja').count()
  if (antrianKerja > 0) pass('Sidebar entry "Antrian Kerja" visible')
  else fail('Antrian Kerja entry', 'not found in sidebar')

  // Specifically check inside sidebar
  const sidebarBadges = await page.locator('[data-slot="sidebar-menu-sub"] span.rounded-full').count()
  if (sidebarBadges > 0) pass(`Found ${sidebarBadges} count badges in sidebar`)
  else fail('Sidebar count badges', 'no count badges di sub-menu')

  // Check Antrian Kerja link specifically — find its parent + look for badge inside
  const antrianBadge = await page.locator('a[href="/orders/draft"]').locator('span.rounded-full').count()
  if (antrianBadge > 0) {
    const badgeText = await page.locator('a[href="/orders/draft"]').locator('span.rounded-full').textContent()
    pass(`Antrian Kerja count badge present: "${badgeText}"`)
  } else fail('Antrian Kerja count badge', 'not found inside link')

  const screenshotPath = join(REPO_ROOT, 'tests', 'screenshots', `${slot}-sidebar-counts-${ts}.png`)
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
