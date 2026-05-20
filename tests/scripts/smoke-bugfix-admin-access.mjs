#!/usr/bin/env node
/**
 * Smoke test — bug backlog fix (commit 03bfff4).
 *
 * Verifies:
 * - Admin (Indra) NOT blocked on: /analytics, /analytics/produk/[id],
 *   /commissions/manage, /cs-dashboard, /adv-dashboard
 * - Admin gets supervisor view (user-picker) on cs/adv dashboard
 * - Owner sees owner-aware empty state on /commissions/my
 *
 * Loads both indra + owner session files itself (ignores argv slot).
 */
import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = join(dirname(__filename), '..', '..')
const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'

const results = []
const pass = (t) => { results.push(1); console.log(`  ✓ ${t}`) }
const fail = (t, r) => { results.push(0); console.log(`  ✗ ${t}: ${r}`) }

function sessionPath(slot) {
  const p = join(REPO_ROOT, 'tests', 'auth', `${slot}-session.json`)
  if (!existsSync(p)) { console.error(`✗ Session missing: ${p} — run npm run capture-session`); process.exit(1) }
  return p
}

const visibleText = async (page) => (await page.locator('body').innerText()).toLowerCase()

const browser = await chromium.launch({ headless: true })
const ts = Date.now()

try {
  // ---------- Admin (Indra) page access ----------
  console.log(`\n=== Bug backlog smoke — Admin access (indra) ===\n`)
  const adminCtx = await browser.newContext({
    storageState: sessionPath('indra'),
    viewport: { width: 1600, height: 900 },
  })
  const ap = await adminCtx.newPage()

  // Pre-check: bail early with a clear message if the indra session expired.
  await ap.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle', timeout: 45000 })
  await ap.waitForTimeout(2000)
  if (ap.url().includes('/login')) {
    console.error('✗ indra session expired — re-run: npm run capture-session -- indra <email> <pwd>')
    await browser.close()
    process.exit(1)
  }

  const adminCases = [
    {
      route: '/analytics',
      blocked: 'bisa lihat full analytics',
      check: async (p, txt) => [txt.includes('per channel'), 'section nav rendered'],
    },
    {
      route: '/analytics/produk/1',
      blocked: 'halaman ini hanya untuk owner',
      check: null,
    },
    {
      route: '/commissions/manage',
      blocked: 'mengelola pencairan komisi',
      check: async (p) => [(await p.locator('[role="tablist"]').count()) > 0, 'filter tabs rendered'],
    },
    {
      route: '/cs-dashboard',
      blocked: 'cuma untuk role',
      check: async (p, txt) => [txt.includes('pilih cs dari dropdown'), 'supervisor user-picker'],
    },
    {
      route: '/adv-dashboard',
      blocked: 'cuma untuk role',
      check: async (p, txt) => [txt.includes('pilih advertiser dari dropdown'), 'supervisor user-picker'],
    },
  ]

  for (const c of adminCases) {
    await ap.goto(`${BASE_URL}${c.route}`, { waitUntil: 'networkidle', timeout: 45000 })
    await ap.waitForTimeout(4500)
    const txt = await visibleText(ap)
    if (txt.includes(c.blocked)) fail(`${c.route} — admin not blocked`, `blocked text present: "${c.blocked}"`)
    else pass(`${c.route} — admin not blocked`)
    if (c.check) {
      const [ok, label] = await c.check(ap, txt)
      if (ok) pass(`${c.route} — ${label}`)
      else fail(`${c.route} — ${label}`, 'expected content missing')
    }
    const shot = join(REPO_ROOT, 'tests', 'screenshots', `indra-bugfix${c.route.replace(/\W+/g, '-')}-${ts}.png`)
    await ap.screenshot({ path: shot })
    console.log(`    📸 ${shot}`)
  }
  await adminCtx.close()

  // ---------- Owner empty state ----------
  console.log(`\n=== Bug backlog smoke — Owner empty state (owner) ===\n`)
  const ownerCtx = await browser.newContext({
    storageState: sessionPath('owner'),
    viewport: { width: 1600, height: 900 },
  })
  const op = await ownerCtx.newPage()
  await op.goto(`${BASE_URL}/commissions/my`, { waitUntil: 'networkidle', timeout: 45000 })
  await op.waitForTimeout(4500)
  if (op.url().includes('/login')) {
    console.log('  ⊘ /commissions/my — SKIP: owner session expired (re-run npm run capture-session -- owner <email> <pwd>)')
  } else {
    const otxt = await visibleText(op)
    if (otxt.includes('buka kelola komisi')) pass('/commissions/my — owner-aware empty state + Kelola Komisi link')
    else fail('/commissions/my — owner empty state', '"Buka Kelola Komisi" not found (owner may have commission rows)')
    const oshot = join(REPO_ROOT, 'tests', 'screenshots', `owner-bugfix-commissions-my-${ts}.png`)
    await op.screenshot({ path: oshot })
    console.log(`    📸 ${oshot}`)
  }
  await ownerCtx.close()
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
