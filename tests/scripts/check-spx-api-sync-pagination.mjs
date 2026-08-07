import fs from 'node:fs'
import path from 'node:path'

const repoRoot = '/root/work/grandbook-app'
const routePath = path.join(repoRoot, 'src/app/api/reconciliation/spx-cashflow/sync/route.ts')
const code = fs.readFileSync(routePath, 'utf8')

const fail = (msg) => { console.error(msg); process.exit(1) }

const pageSizeMatch = code.match(/const DEFAULT_PAGE_SIZE = (\d+)/)
if (!pageSizeMatch) fail('Missing DEFAULT_PAGE_SIZE in SPX sync route')
const pageSize = Number(pageSizeMatch[1])

const maxPagesMatch = code.match(/const MAX_PAGES = (\d+)/)
if (!maxPagesMatch) fail('Missing MAX_PAGES guard in SPX sync route')
const maxPages = Number(maxPagesMatch[1])

const capacity = pageSize * maxPages
if (capacity < 3000) {
  fail(`SPX API sync pagination capacity too low: ${capacity} rows (< 3000). June/July real pulls already exceed 2000 rows.`)
}

console.log(`SPX API sync pagination guard OK (${capacity} rows max)`)
