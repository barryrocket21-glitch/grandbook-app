import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/(app)/orders/wa-paste/page.tsx', 'utf8')

const mustHave = [
  'issueStats',
  'Ringkasan Cek Admin',
  'Wajib Fix',
  'Perlu Dicek',
  'Aman Diproses',
  'Produk belum match master',
  'HP invalid/kosong',
  'CS belum match',
  'Atribusi perlu dicek',
  'Tidak mengubah parser atau cara submit',
  '<IssueSummary',
]

const mustKeep = [
  'parseWaPasteV3(text)',
  'adaptOrder(p, i, ctx, refData)',
  'insertAdaptedOrders(supabase, orgId, adapted)',
  '<WaPastePreviewTable orders={adapted}',
]

const failures = []
for (const needle of mustHave) {
  if (!page.includes(needle)) failures.push(`Missing WA admin helper marker: ${needle}`)
}
for (const needle of mustKeep) {
  if (!page.includes(needle)) failures.push(`Core WA Paste flow changed/missing: ${needle}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('WA Paste admin helper guard OK')
