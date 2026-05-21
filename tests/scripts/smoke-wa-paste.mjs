#!/usr/bin/env node
/**
 * Smoke test — WA Paste key-value parser (Phase 8K, /orders/wa-paste).
 *
 * Pastes 3 real-format WA order messages into the page, picks the
 * `wa_paste_keyvalue` profile, runs Preview, and verifies the parser
 * splits the multi-order paste and extracts each order's fields.
 *
 * Preview only — does NOT click Import (no prod data written).
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

// 3 WA orders in Barry's key-value format (WA Web copy with timestamp prefix).
const SAMPLE = `[21.12, 20/5/2026] Grup Order: (10) CS : Fiaro
KODE ADV : Umo
Produk : 1 Sandal GD F (1pcs)

Nama penerima : Andi Darmawan
No HP : +6281234567890
Alamat Lengkap : Jl. Merdeka No. 10, RT 02/RW 03, Kel. Sukamaju
Kecamatan : Sukmajaya
Kota/Kab : Depok
Provinsi : Jawa Barat

Ongkir : Rp 15.000
Total Bayar : Rp 140.000
Pembayaran : COD

Keterangan : Coklat 40
[21.12, 20/5/2026] Grup Order: (11) CS : Fiaro
KODE ADV : Umo
Produk : 1 Kran Robotic Arm (1pcs)

Nama penerima : Siti Aisyah
No HP : +6285678901234
Alamat Lengkap : Jl. Pahlawan No. 45, RT 01/RW 05, Kel. Darmo
Kecamatan : Wonokromo
Kota/Kab : Surabaya
Provinsi : Jawa Timur

Ongkir : Rp 25.000
Total Bayar : Rp 175.000
Pembayaran : COD

Keterangan : Silver
[21.12, 20/5/2026] Grup Order: (12) CS : Fiaro
KODE ADV : Umo
Produk : 1 Sneakers Gover K35 F (1pcs)

Nama penerima : Rudi Hermawan
No HP : +6282134567891
Alamat Lengkap : Komplek Johor Indah Blok C No. 12, Kel. Gedung Johor
Kecamatan : Medan Johor
Kota/Kab : Medan
Provinsi : Sumatera Utara

Ongkir : Rp 45.000
Total Bayar : Rp 295.000
Pembayaran : COD

Keterangan : Putih 41`

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
  await page.goto(`${BASE_URL}/orders/wa-paste`, { waitUntil: 'networkidle', timeout: 45000 })
  await page.waitForTimeout(3000)
  if (page.url().includes('/login')) { console.error('✗ owner session expired'); await browser.close(); process.exit(1) }

  if (errors.length === 0) pass('/orders/wa-paste — no page error')
  else fail('/orders/wa-paste — page error', errors[0])

  // Pick the wa_paste_keyvalue profile
  await page.locator('button:has-text("Pilih profile WA Paste")').first().click({ timeout: 8000 })
  await page.waitForTimeout(1000)
  await page.locator('[role="option"]:has-text("wa_paste_keyvalue")').first().click({ timeout: 8000 })
  await page.waitForTimeout(1500)
  pass('profile wa_paste_keyvalue selectable')

  // Paste the 3 sample orders
  await page.locator('textarea').first().fill(SAMPLE)
  await page.waitForTimeout(400)

  // Run preview
  await page.locator('button:has-text("Preview Block")').click({ timeout: 8000 })
  await page.waitForTimeout(3000)

  const body = await page.locator('body').innerText()

  if (body.includes('3 block')) pass('multi-order split — 3 blocks detected')
  else fail('multi-order split', 'expected "3 block(s) terdeteksi"')

  const names = ['Andi Darmawan', 'Siti Aisyah', 'Rudi Hermawan']
  const okNames = names.filter((nm) => body.includes(nm))
  if (okNames.length === 3) pass('customer names extracted (3/3)')
  else fail('customer names', `only ${okNames.length}/3 found: ${okNames.join(', ')}`)

  const cities = ['Depok', 'Surabaya', 'Medan']
  const okCities = cities.filter((c) => body.includes(c))
  if (okCities.length === 3) pass('cities extracted (3/3)')
  else fail('cities', `only ${okCities.length}/3 found`)

  // numeric_id_currency: "Rp 140.000" -> 140000
  if (body.includes('140000') && body.includes('295000')) pass('totals parsed (Rp 140.000 -> 140000)')
  else fail('totals', 'parsed total values not found')

  if (body.includes('Fiaro')) pass('CS name extracted from "(NN) CS :" line')
  else fail('CS name', '"Fiaro" not found')

  if (body.toLowerCase().includes('errors')) fail('preview errors', 'preview reported errors')
  else pass('preview — no errors')

  const shot = join(REPO_ROOT, 'tests', 'screenshots', `owner-wa-paste-${ts}.png`)
  await page.screenshot({ path: shot, fullPage: true })
  console.log(`    📸 ${shot}`)
} catch (err) {
  fail('RUNTIME', err.message)
} finally {
  await browser.close()
}

const passed = results.reduce((a, b) => a + b, 0)
console.log(`\n=== Summary: ${passed}/${results.length} passed ===`)
process.exit(passed === results.length ? 0 : 1)
