#!/usr/bin/env node
/**
 * Phase 8K smoke test: /orders/wa-paste profile selector + textarea.
 *
 * Verifies:
 * - Page loads
 * - Profile select shows "WA Paste — Format Barry"
 * - Textarea + Preview button visible
 * - Format help card present (4 wajib + 9 opsional)
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

console.log(`\n=== Phase 8K Smoke (as ${slot}) ===\n`)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  storageState: sessionPath,
  viewport: { width: 1600, height: 900 },
})
const page = await context.newPage()
const ts = Date.now()

try {
  await page.goto(`${BASE_URL}/orders/wa-paste`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)

  if (page.url().includes('wa-paste')) pass('Navigate to /orders/wa-paste')
  else fail('Navigate', `Redirected ${page.url()}`)

  if (await page.locator('text=WA Paste Order').count() > 0) pass('Heading present')
  else fail('Heading', 'not found')

  if (await page.locator('text=Profile WA Paste').count() > 0) pass('Profile selector label')
  else fail('Profile selector', 'not found')

  if (await page.locator('textarea').count() > 0) pass('Textarea for paste input')
  else fail('Textarea', 'not found')

  if (await page.locator('button:has-text("Preview Block")').count() > 0) pass('Preview button')
  else fail('Preview button', 'not found')

  if (await page.locator('text=Format yang ke-recognize').count() > 0) pass('Format help card visible')
  else fail('Format help card', 'not found')

  if (await page.locator('text=Wajib (4)').count() > 0) pass('Required fields (4) labeled')
  else fail('Wajib (4) label', 'not found')

  if (await page.locator('text=Opsional (9)').count() > 0) pass('Optional fields (9) labeled')
  else fail('Opsional (9) label', 'not found')

  // Type sample paste and click Preview
  const profileSelect = await page.locator('button[role="combobox"]').first()
  await profileSelect.click()
  await page.waitForTimeout(500)
  const waPasteOption = await page.locator('text=Format Barry').first()
  if (await waPasteOption.count() > 0) {
    await waPasteOption.click()
    pass('Selected "WA Paste — Format Barry" profile')
  } else {
    fail('Profile option', 'WA Paste Format Barry not in dropdown')
  }

  const screenshotPath = join(REPO_ROOT, 'tests', 'screenshots', `${slot}-wa-paste-${ts}.png`)
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
