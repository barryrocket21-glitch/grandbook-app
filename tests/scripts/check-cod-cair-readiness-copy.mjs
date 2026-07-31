import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/(app)/reconciliation/spx-cashflow/page.tsx', 'utf8')

const mustHave = [
  'OwnerSafetyNote',
  'ApplyReadinessSummary',
  'Yang akan jadi COD cair',
  'Yang perlu dicek dulu',
  'Yang masuk Antrian Masalah',
  'Penarikan rekening',
  'Apply tetap harus konfirmasi manual',
  'Tidak ada data live yang berubah sebelum',
  'Komisi EARNED ikut ditandai PAID',
]

const mustKeep = [
  'preview_spx_cashflow_recon',
  'apply_spx_cashflow_recon',
  'preview_spx_cashflow_recon',
  'apply_spx_cashflow_recon',
  'confirm(',
  'cod_matched_count + result.cod_variance_count + result.withdrawal_count',
]

const failures = []
for (const needle of mustHave) {
  if (!page.includes(needle)) failures.push(`Missing COD Cair readiness marker: ${needle}`)
}
for (const needle of mustKeep) {
  if (!page.includes(needle)) failures.push(`Core COD Cair flow changed/missing: ${needle}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('COD Cair owner readiness guard OK')
