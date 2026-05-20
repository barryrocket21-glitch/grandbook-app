#!/usr/bin/env node
/**
 * Smoke test — sidebar layout: wide pages must not overflow horizontally.
 *
 * Regression guard for the bug where SidebarInset (flex child) without
 * min-w-0 got pinned to wide content's min-content size → horizontal page
 * overflow → content scrolled under the fixed sidebar.
 *
 * Checks /orders/draft + /orders/list (both have wide tables):
 * - no horizontal page overflow (docScrollW == clientW)
 * - page cannot be scrolled horizontally (so sidebar can't overlap content)
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
const ts = Date.now()

try {
  for (const route of ['/orders/draft', '/orders/list']) {
    const ctx = await browser.newContext({ storageState: session, viewport: { width: 1280, height: 900 } })
    const page = await ctx.newPage()
    await page.goto(`${BASE_URL}${route}`, { waitUntil: 'networkidle', timeout: 45000 })
    await page.waitForTimeout(5000)

    if (page.url().includes('/login')) {
      console.log(`  ⊘ ${route} — SKIP: owner session expired`)
      await ctx.close()
      continue
    }

    const r = await page.evaluate(() => {
      const inset = document.querySelector('[data-slot=sidebar-inset]')
      return {
        docScrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        insetMinWidth: inset ? getComputedStyle(inset).minWidth : 'MISSING',
      }
    })

    if (r.docScrollW <= r.clientW + 1) pass(`${route} — no horizontal overflow (${r.docScrollW}px)`)
    else fail(`${route} — horizontal overflow`, `docScrollW ${r.docScrollW} > clientW ${r.clientW}`)

    await page.evaluate(() => window.scrollTo(800, 0))
    await page.waitForTimeout(300)
    const scrollX = await page.evaluate(() => window.scrollX)
    if (scrollX === 0) pass(`${route} — page locked from horizontal scroll`)
    else fail(`${route} — horizontal scroll`, `scrollX=${scrollX} (content can slide under sidebar)`)

    await page.evaluate(() => window.scrollTo(0, 0))
    const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-sidebar${route.replace(/\W+/g, '-')}-${ts}.png`)
    await page.screenshot({ path: shot })
    console.log(`    📸 ${shot}`)
    await ctx.close()
  }
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
