import { readFileSync } from 'node:fs'

const checks = [
  {
    file: 'src/app/(app)/commissions/manage/page.tsx',
    must: ['title="Gajian CS"', 'Aturan Fee Tim', 'Carry-over', 'Order masih di jalan belum dibayar'],
    mustNot: ['title="Kelola Komisi"', 'Aturan Komisi'],
  },
  {
    file: 'src/app/(app)/settings/commission-rules/page.tsx',
    must: ['title="Aturan Fee Tim"', 'CS / Advertiser', 'per user, produk, dan periode', 'Tambah Aturan Fee'],
    mustNot: ['title="Aturan Komisi"', 'Tambah Rule'],
  },
  {
    file: 'src/app/(app)/crm/page.tsx',
    must: ['title="Rescue Order"', 'order bermasalah yang masih bisa diselamatkan', 'Follow up pembeli/ekspedisi'],
    mustNot: ['title="Follow Up (CRM)"'],
  },
  {
    file: 'src/app/(app)/inbox/layout.tsx',
    must: ['Antrian Masalah', 'Atribusi Kosong', 'Alamat Bermasalah', 'No HP Bermasalah'],
    mustNot: ['Pending Review'],
  },
  {
    file: 'src/app/(app)/reconciliation/spx-cashflow/page.tsx',
    must: ['title="COD Cair SPX"', 'Upload file pencairan SPX', 'COD cair + penarikan rekening'],
    mustNot: ['title="SPX Cashflow Harian"'],
  },
  {
    file: 'src/app/(app)/performa/page.tsx',
    must: ['title="Advertiser Cockpit"', 'Scale, watch, atau matiin campaign', 'profit real'],
    mustNot: ['title="Performa Bisnis"'],
  },
  {
    file: 'src/app/(app)/orders/pembukuan/page.tsx',
    must: ['title="Pembukuan Ledger"', 'Finance Check', 'audit/crosscheck'],
    mustNot: ['title="Pembukuan (Satu Tampilan)"'],
  },
]

const failures = []
for (const check of checks) {
  const src = readFileSync(check.file, 'utf8')
  for (const needle of check.must) {
    if (!src.includes(needle)) failures.push(`${check.file}: missing ${needle}`)
  }
  for (const needle of check.mustNot) {
    if (src.includes(needle)) failures.push(`${check.file}: still contains ${needle}`)
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('Business-friendly page copy guard OK')
