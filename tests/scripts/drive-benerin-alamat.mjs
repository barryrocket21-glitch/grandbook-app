#!/usr/bin/env node
/**
 * Brief #7 — driver fix-mode "Benerin Alamat" via UI nyata (Indra/admin, lewat RLS).
 * SAFE: cuma SAVE kalau KOTA dari saran muncul di alamat mentah (korroborasi
 * tinggi). Selain itu → Lewati (biar di-review manusia). Bukan blind auto-apply.
 */
import { chromium } from 'playwright'
import { join } from 'node:path'

const REPO = process.cwd()
const BASE = process.env.SMOKE_BASE_URL || 'https://grandbook-app.vercel.app'
const SESSION = process.env.SMOKE_SESSION || 'tests/auth/indra-session.json'
const norm = (s) => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()

const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ storageState: SESSION, viewport: { width: 1440, height: 950 } })
const p = await ctx.newPage()
const ts = Date.now()
let saved = 0, skipped = 0
const log = []

try {
  await p.goto(`${BASE}/orders/draft`, { waitUntil: 'networkidle', timeout: 45000 })
  await p.waitForTimeout(5000)
  if (p.url().includes('/login')) { console.error('session expired'); process.exit(1) }

  const btn = p.locator('button:has-text("Benerin Alamat")').first()
  if (await btn.count() === 0) { console.log('Gak ada order ⚠️ — selesai.'); await b.close(); process.exit(0) }
  await btn.click(); await p.waitForTimeout(2500)

  const dialog = p.locator('[role="dialog"]').first()
  // total dari "N / total"
  const headTxt = await dialog.locator('text=/\\d+\\s*\\/\\s*\\d+/').first().textContent().catch(() => '0 / 0')
  const total = parseInt((headTxt.split('/')[1] || '0').trim()) || 0
  console.log(`Antrian ⚠️: ${total}`)

  for (let i = 0; i < total + 2; i++) {
    // selesai?
    if (await dialog.locator('text=/Selesai!|udah beres/').count() > 0) break
    const lanjut = dialog.locator('button:has-text("Simpan & Lanjut")').first()
    if (await lanjut.count() === 0) break

    const ordNum = (await dialog.locator('span.font-mono').first().textContent().catch(() => '?')) || '?'
    // alamat mentah = teks di div setelah label "Alamat mentah"
    const rawEl = dialog.locator('xpath=.//p[contains(translate(text(),"ALMENT","alment"),"alamat mentah")]/following-sibling::div[1]')
    const raw = (await rawEl.first().textContent().catch(() => '')) || ''
    const rawN = norm(raw)

    // tombol saran = button dengan ≥2 koma (Sub, Kota, Prov)
    const sugBtns = dialog.locator('button').filter({ hasText: /.+,.+,.+/ })
    const n = await sugBtns.count()
    let picked = null
    for (let j = 0; j < n; j++) {
      const t = (await sugBtns.nth(j).textContent()) || ''
      const head = t.split('·')[0]
      const parts = head.split(',')
      if (parts.length < 2) continue
      const city = norm(parts[1])
      const prov = norm(parts[2] || '')
      // korroborasi: kota (atau provinsi) muncul di alamat mentah
      if (city && rawN.includes(city)) { picked = { idx: j, city: parts[1].trim(), prov: parts[2]?.trim() }; break }
      if (prov && prov.length >= 5 && rawN.includes(prov)) { picked = { idx: j, city: parts[1].trim(), prov: parts[2]?.trim() }; break }
    }

    if (picked) {
      await sugBtns.nth(picked.idx).click(); await p.waitForTimeout(350)
      if (saved < 2) await p.screenshot({ path: join(REPO, 'tests', 'screenshots', `benerin-save-${ts}-${saved}.png`) })
      await lanjut.click(); await p.waitForTimeout(900)
      saved++
      log.push(`✓ ${ordNum} → ${picked.city}${picked.prov ? ', ' + picked.prov : ''}`)
    } else {
      const lewati = dialog.locator('button:has-text("Lewati")').first()
      await lewati.click(); await p.waitForTimeout(700)
      skipped++
      log.push(`· ${ordNum} → lewati (gak ada saran ter-korroborasi)`)
    }
  }
} catch (e) {
  console.error('ERR', e.message)
}
await b.close()
console.log(log.join('\n'))
console.log(`\nSAVED=${saved}  SKIPPED=${skipped}  ts=${ts}`)
