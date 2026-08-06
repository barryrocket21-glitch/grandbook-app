import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()
const pagePath = path.join(repoRoot, 'src/app/(app)/reports/owner-profit/page.tsx')
const constantsPath = path.join(repoRoot, 'src/lib/constants.ts')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!fs.existsSync(pagePath)) {
  fail('Missing Owner Profit Cockpit page route: /reports/owner-profit')
}

const page = fs.readFileSync(pagePath, 'utf8')
const constants = fs.readFileSync(constantsPath, 'utf8')

for (const marker of [
  'Owner Profit Cockpit',
  'Profit Setelah Ads',
  'Produk × Platform',
  'Return Rate',
  'Delivered Rate',
  'Selisih Ongkir',
  'Export Excel',
  'exportOwnerProfitWorkbook',
  'Owner Profit Cockpit Export',
  'READ_ONLY_OWNER_PROFIT_COCKPIT',
]) {
  if (!page.includes(marker)) fail(`Owner Profit Cockpit missing marker: ${marker}`)
}

if (!constants.includes("/reports/owner-profit")) {
  fail('Owner Profit Cockpit nav link missing from src/lib/constants.ts')
}

for (const banned of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
  if (page.includes(banned)) fail(`Owner Profit Cockpit page must stay read-only, found: ${banned}`)
}

console.log('Owner Profit Cockpit guard OK')
