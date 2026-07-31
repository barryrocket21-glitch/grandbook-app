import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/(app)/reconciliation/spx-status/page.tsx', 'utf8')

const mustHave = [
  'Rescue Queue Preview',
  'Prioritas Tinggi',
  'Follow-up admin/CS',
  'potensi COD diselamatkan',
  'rescuePriority',
  'COD Amount',
  'Delivery failed Reason',
  'delivery onhold reason',
  'Returning',
  'Pending Pickup',
  'On Hold',
]

const mustKeep = [
  'apply_spx_status_sync',
  'record_spx_status_batch',
  'Apply Sync',
  'Gak pernah bikin order baru',
]

const failures = []
for (const needle of mustHave) if (!page.includes(needle)) failures.push(`Missing SPX rescue marker: ${needle}`)
for (const needle of mustKeep) if (!page.includes(needle)) failures.push(`Core SPX sync marker missing: ${needle}`)

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('SPX status rescue queue guard OK')
