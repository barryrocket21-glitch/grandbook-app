#!/usr/bin/env node
/**
 * Smoke test — /orders/draft row action menu (⋮) + Edit cepat.
 *
 * Regression guard for the Base UI #31 crash: DropdownMenuLabel rendered as
 * Menu.GroupLabel threw without a Menu.Group ancestor, so the ⋮ menu never
 * opened and Edit cepat / Hapus draft were unreachable.
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
  await page.goto(`${BASE_URL}/orders/draft`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  errors.length = 0 // only care about errors triggered by the ⋮ interaction
  const trig = page.locator('table tbody tr').first().locator('button.h-7.w-7')

  if (await trig.count() === 0) {
    fail('⋮ button present', 'not found in first row')
  } else {
    await trig.first().click({ timeout: 8000 })
    await page.waitForTimeout(1500)

    const baseUiErr = errors.find((e) => /Base UI error/i.test(e))
    if (baseUiErr) fail('⋮ click — no crash', baseUiErr)
    else pass('⋮ click — no crash')

    const editVisible = await page.locator('text=Edit cepat').count()
    if (editVisible > 0) pass('⋮ menu opened (Edit cepat visible)')
    else fail('⋮ menu opened', 'Edit cepat item not visible after click')

    if (editVisible > 0) {
      await page.locator('text=Edit cepat').first().click()
      await page.waitForTimeout(1500)
      const dialogOpen = await page.locator('text=Edit Draft').count()
      if (dialogOpen > 0) pass('Edit cepat → quick-edit dialog opened')
      else fail('Edit dialog', 'dialog did not open after clicking Edit cepat')
      const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-draft-rowaction-${ts}.png`)
      await page.screenshot({ path: shot })
      console.log(`    📸 ${shot}`)
    }
  }
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
