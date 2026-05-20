#!/usr/bin/env node
/**
 * Capture Playwright storageState untuk role tertentu.
 *
 * Usage:
 *   node scripts/capture-session.mjs <slot> <email> <password>
 *
 *   slot = nama file output (owner / indra / cs / dst)
 *   email = login email
 *   password = login password
 *
 * Output:
 *   tests/auth/<slot>-session.json
 *
 * Phase 8K-Playwright. Headed mode by default — user lihat browser, bisa
 * intervene kalau ada 2FA / captcha. Set HEADLESS=1 untuk CI/headless.
 */
import { chromium } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')

const BASE_URL = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const HEADLESS = process.env.HEADLESS === '1'

async function main() {
  const [, , slot, email, password] = process.argv
  if (!slot || !email || !password) {
    console.error('Usage: node scripts/capture-session.mjs <slot> <email> <password>')
    process.exit(1)
  }

  const outPath = join(REPO_ROOT, 'tests', 'auth', `${slot}-session.json`)
  await mkdir(dirname(outPath), { recursive: true })

  console.log(`[capture] Launching browser (headless=${HEADLESS})...`)
  const browser = await chromium.launch({ headless: HEADLESS })
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    console.log(`[capture] Navigating to ${BASE_URL}/login`)
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' })

    // Fill login form
    await page.fill('input[type="email"], input[name="email"], input[id="email"]', email)
    await page.fill('input[type="password"], input[name="password"], input[id="password"]', password)
    console.log(`[capture] Submitting login for ${email}...`)
    await Promise.all([
      page.waitForURL(/\/(dashboard|orders|adv-dashboard|reconciliation|cs-dashboard)/, { timeout: 15000 }),
      page.click('button[type="submit"]'),
    ])

    console.log(`[capture] Logged in successfully. Current URL: ${page.url()}`)

    // Save storage state
    const state = await context.storageState()
    await writeFile(outPath, JSON.stringify(state, null, 2))
    console.log(`[capture] ✓ Session state saved → ${outPath}`)
    console.log(`[capture]   Cookies: ${state.cookies.length}`)
    console.log(`[capture]   Origins: ${state.origins.length}`)
  } catch (err) {
    console.error(`[capture] ✗ Failed:`, err.message)
    if (!HEADLESS) {
      console.error('[capture] Browser tetap open untuk inspect. Tekan Ctrl+C untuk exit.')
      await new Promise(() => {}) // keep alive
    }
    process.exit(1)
  } finally {
    if (HEADLESS) await browser.close()
  }

  await browser.close()
}

main().catch(err => { console.error(err); process.exit(1) })
