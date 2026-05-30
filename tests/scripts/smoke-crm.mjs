#!/usr/bin/env node
/**
 * Smoke test — Brief #2: Modul CRM (mig 080, SHA 8210184).
 *  1. /crm queue — header, filter, kasus PROBLEM (TEST-CRM-001), tombol WA.
 *  2. WA link format wa.me/62...
 *  3. /crm/[id] detail — timeline aktivitas + tombol Resolve/Eskalasi.
 *  4. Sidebar "Follow Up".
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync } from 'node:fs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const session = join(ROOT, 'tests', 'auth', 'owner-session.json')
if (!existsSync(session)) { console.error('✗ session missing'); process.exit(1) }
const shotDir = join(ROOT, 'tests', 'screenshots'); mkdirSync(shotDir, { recursive: true })

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }
const ts = Date.now()

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ storageState: session, viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(e.message))

try {
  // 1. /crm queue
  console.log('\n[1] /crm queue')
  await page.goto(`${BASE_URL}/crm`, { waitUntil: 'networkidle', timeout: 45000 })
  try { await page.waitForSelector('text=Follow Up', { timeout: 15000 }) } catch {}
  if (page.url().includes('/login')) { console.error('✗ session expired'); await browser.close(); process.exit(2) }
  let body = await page.locator('body').innerText()
  errs.length === 0 ? pass('/crm no page error') : fail('page error', errs[0])
  body.includes('Follow Up') ? pass('header "Follow Up"') : fail('header', 'not found')
  body.includes('TEST-CRM-001') ? pass('kasus test tampil di antrian') : fail('test case', 'TEST-CRM-001 not in queue')
  // WA link format
  const waHref = await page.locator('a[href^="https://wa.me/62"]').first().getAttribute('href').catch(() => null)
  waHref ? pass(`tombol WA → ${waHref.slice(0, 40)}...`) : fail('WA link', 'wa.me/62 link not found')
  await page.screenshot({ path: join(shotDir, `crm-queue-${ts}.png`), fullPage: true })
  console.log(`    📸 crm-queue-${ts}.png`)

  // 2. detail
  console.log('\n[2] /crm/[id] detail')
  await page.locator('a:has-text("Detail")').first().click().catch(() => {})
  await page.waitForTimeout(3500)
  body = await page.locator('body').innerText()
  body.includes('Timeline Aktivitas') ? pass('timeline section') : fail('timeline', 'not found')
  body.includes('Catat Follow-Up') ? pass('form catat follow-up') : fail('form', 'not found')
  ;(body.includes('Resolve') && body.includes('Eskalasi')) ? pass('tombol Resolve + Eskalasi') : fail('actions', 'resolve/escalate missing')
  await page.screenshot({ path: join(shotDir, `crm-detail-${ts}.png`), fullPage: true })
  console.log(`    📸 crm-detail-${ts}.png`)

  // 3. sidebar
  console.log('\n[3] Sidebar "Follow Up"')
  const sideLink = await page.locator('a[href="/crm"]').count()
  sideLink > 0 ? pass('sidebar link /crm') : fail('sidebar link', 'not found')
} catch (err) {
  fail('RUNTIME', err.message)
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
await browser.close()
process.exit(passed === results.length ? 0 : 1)
