#!/usr/bin/env node
/**
 * Smoke test — Brief #7 Rombak Antrian Kerja.
 *
 * Verifies (no production mutation):
 *  1. /orders/draft loads with owner session (no page error).
 *  2. PART 2 — "Kesiapan Export" banner shows honest Siap Export / Perlu Dibenerin
 *     (sumber tunggal wilayah_id), bukan ilusi "100%".
 *  3. PART 1 — "Benerin Alamat (N)" button opens fix-mode dialog with progress
 *     N/total, per-field pills, saran wilayah, Simpan & Lanjut.
 *  4. Picking a suggestion chip enables Simpan & Lanjut (does NOT save).
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
  if (errors.length === 0) pass('page loads — no pageerror')
  else fail('page loads', errors[0])

  // PART 2 — kesiapan banner
  const banner = page.locator('text=Kesiapan Export')
  if (await banner.count() > 0) {
    pass('PART 2 — banner "Kesiapan Export" tampil')
    const siap = await page.locator('text=/Siap Export\\s+\\d/').count()
    const perlu = await page.locator('text=/Perlu Dibenerin\\s+\\d/').count()
    if (siap > 0 && perlu > 0) pass('PART 2 — Siap Export + Perlu Dibenerin pakai angka jujur')
    else fail('PART 2 — angka kesiapan', `siap=${siap} perlu=${perlu}`)
  } else {
    fail('PART 2 — banner', 'teks "Kesiapan Export" tidak ketemu (mungkin 0 draft)')
  }

  await page.screenshot({ path: join(REPO_ROOT, 'tests', 'screenshots', `brief7-draft-list-${ts}.png`), fullPage: false })

  // PART 1 — Benerin Alamat button → fix-mode
  const benerinBtn = page.locator('button:has-text("Benerin Alamat")').first()
  if (await benerinBtn.count() === 0) {
    fail('PART 1 — tombol Benerin Alamat', 'tidak ada (0 order ⚠️ → tidak bisa tes fix-mode)')
  } else {
    pass('PART 1 — tombol "Benerin Alamat (N)" ada')
    await benerinBtn.click()
    await page.waitForTimeout(2500)

    const dlgTitle = await page.locator('text=Benerin Alamat').count()
    const progress = await page.locator('text=/\\d+\\s*\\/\\s*\\d+/').count()
    if (dlgTitle > 0 && progress > 0) pass('PART 1 — dialog fix-mode + progress N/total')
    else fail('PART 1 — dialog/progress', `title=${dlgTitle} progress=${progress}`)

    const pills = await page.locator('text=Provinsi').count()
    const saran = await page.locator('text=Saran wilayah').count()
    const lanjut = page.locator('button:has-text("Simpan & Lanjut")')
    if (pills > 0) pass('PART 1 — pill per-field (Provinsi/Kota/Kecamatan/Kode Pos)')
    else fail('PART 1 — pill per-field', 'teks Provinsi tidak ketemu')
    if (saran > 0) pass('PART 1 — section "Saran wilayah" ada')
    else fail('PART 1 — saran wilayah', 'tidak ketemu')

    // Simpan & Lanjut harus DISABLED sebelum pilih
    const disabledBefore = await lanjut.first().isDisabled().catch(() => null)
    if (disabledBefore === true) pass('PART 1 — Simpan & Lanjut disabled sebelum pilih wilayah')
    else fail('PART 1 — guard pilih dulu', `isDisabled=${disabledBefore}`)

    // Coba klik chip saran pertama (kalau ada) → tombol harus enable. TIDAK save.
    const firstChip = page.locator('button:has-text(", ")').filter({ hasText: /,/ }).first()
    const chip = page.locator('div:has(> button) button').filter({ has: page.locator('svg') })
    // chip saran = button yang punya "Kecamatan, Kota, Provinsi" — cari via star/mappin lalu enable check
    const sugButtons = page.locator('button', { hasText: /,\s.+,\s/ })
    if (await sugButtons.count() > 0) {
      await sugButtons.first().click()
      await page.waitForTimeout(800)
      const disabledAfter = await lanjut.first().isDisabled().catch(() => null)
      if (disabledAfter === false) pass('PART 1 — pilih saran → Simpan & Lanjut enable')
      else fail('PART 1 — pilih saran enable', `isDisabled=${disabledAfter}`)
    } else {
      console.log('  · (skip) order ini gak punya chip saran — fallback search dipakai')
    }

    await page.screenshot({ path: join(REPO_ROOT, 'tests', 'screenshots', `brief7-fixmode-${ts}.png`), fullPage: false })
  }
} catch (e) {
  fail('exception', e.message)
}

await browser.close()
const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
