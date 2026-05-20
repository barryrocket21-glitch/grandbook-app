#!/usr/bin/env node
/**
 * Smoke test — restructured sidebar nav (10 workflow-ordered groups).
 *
 * Verifies the 10 group titles render for owner + admin, the Order
 * submenu is in pipeline order, and a sub-link navigates.
 *
 * Loads owner + indra sessions itself (ignores argv slot).
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }

function sessionPath(slot) {
  const p = join(REPO_ROOT, 'tests', 'auth', `${slot}-session.json`)
  if (!existsSync(p)) { console.error(`✗ Session missing: ${p}`); process.exit(1) }
  return p
}

const GROUPS = ['Dashboard', 'Order', 'Inbox', 'Keuangan', 'Komisi', 'Marketing', 'CS', 'Analytics', 'Master Data', 'Pengaturan Sistem']
const ORDER_FLOW = ['Input Order Baru', 'Upload Massal', 'WA Paste', 'Antrian Kerja', 'Export ke Ekspedisi', 'Arsip Semua Order']

const browser = await chromium.launch({ headless: true })
const ts = Date.now()

async function run(slot) {
  console.log(`\n=== Sidebar nav — ${slot} ===\n`)
  const ctx = await browser.newContext({ storageState: sessionPath(slot), viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(5000)
  if (page.url().includes('/login')) { fail(`${slot} session`, 'expired'); await ctx.close(); return }

  const sidebar = page.locator('[data-slot="sidebar-container"]')
  const missing = []
  for (const g of GROUPS) {
    if (await sidebar.getByText(g, { exact: true }).count() === 0) missing.push(g)
  }
  if (missing.length === 0) pass(`${slot}: 10 grup tampil`)
  else fail(`${slot}: grup`, `hilang: ${missing.join(', ')}`)

  if (errors.length) fail(`${slot}: no pageerror`, errors[0])
  else pass(`${slot}: no pageerror`)

  if (slot === 'owner') {
    await sidebar.getByText('Order', { exact: true }).click()
    await page.waitForTimeout(900)
    const subTexts = await page.locator('[data-slot="sidebar-menu-sub-button"]').allInnerTexts()
    const flat = subTexts.map((t) => t.replace(/\s+/g, ' ').trim())
    const idx = ORDER_FLOW.map((label) => flat.findIndex((t) => t.includes(label)))
    const allFound = idx.every((i) => i >= 0)
    const inOrder = idx.every((v, i) => i === 0 || v > idx[i - 1])
    if (allFound && inOrder) pass('owner: Order submenu urut alur (Input→Upload→WA→Antrian→Export→Arsip)')
    else fail('owner: Order submenu order', `idx=${JSON.stringify(idx)} items=${JSON.stringify(flat)}`)

    await page.locator('[data-slot="sidebar-menu-sub-button"]').filter({ hasText: 'Antrian Kerja' }).first().click()
    await page.waitForTimeout(2500)
    if (page.url().includes('/orders/draft')) pass('owner: klik "Antrian Kerja" → /orders/draft')
    else fail('owner: nav sub-link', `URL ${page.url()}`)
  }

  await page.screenshot({ path: join(REPO_ROOT, 'tests', 'screenshots', `${slot}-sidebar-nav-${ts}.png`) })
  await ctx.close()
}

try {
  await run('owner')
  await run('indra')
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
