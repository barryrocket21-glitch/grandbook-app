import { chromium } from 'playwright'

const baseURL = process.env.SMOKE_BASE_URL || 'http://localhost:3023'
const storageState = process.env.AUTH_STATE || 'tests/auth/owner-prodlocal-session.json'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ storageState, viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`) })
await page.goto(`${baseURL}/orders/wa-paste`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2000)
await page.getByRole('button', { name: /Isi sample/i }).click()
await page.getByRole('button', { name: /Parse & Preview/i }).click()
await page.waitForSelector('text=Ringkasan Cek Admin', { timeout: 30000 })
const body = await page.locator('body').innerText({ timeout: 10000 })
const required = ['Ringkasan Cek Admin', 'Wajib Fix', 'Perlu Dicek', 'Aman Diproses', 'Produk belum match master', 'HP invalid/kosong']
const missing = required.filter(t => !body.includes(t))
await page.screenshot({ path: '/tmp/grandbook-wa-paste-admin-helper.png', fullPage: true })
await browser.close()
if (missing.length) {
  console.error(`Missing labels: ${missing.join(', ')}`)
  process.exit(1)
}
if (errors.length) {
  console.error(errors.slice(0, 5).join('\n'))
  process.exit(1)
}
console.log('WA Paste admin helper smoke OK')
