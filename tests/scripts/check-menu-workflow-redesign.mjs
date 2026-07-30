import { readFileSync } from 'node:fs'

const src = readFileSync('src/lib/constants.ts', 'utf8')

const requiredGroups = [
  'Dashboard Owner',
  'Input Order',
  'Order Problem / Rescue',
  'Pengiriman & Rekonsiliasi',
  'COD Cair',
  'Gajian CS',
  'Advertiser Cockpit',
  'Pembukuan & Finance Check',
  'Master Data',
]

const requiredLabels = [
  'Tempel Laporan WA',
  'Antrian Masalah',
  'Rescue Order',
  'Cashflow SPX',
  'Aturan Fee Tim',
  'Distribusi Lead/CS',
  'Laporan CS / Input Lead',
  'Performa CS / Closing Rate',
  'Finance Audit Pack',
  'Kontrak Ekspedisi',
  'Wilayah & Coverage',
]

const requiredRoutes = [
  '/orders/wa-paste',
  '/orders/bulk-upload',
  '/crm',
  '/reconciliation/spx-cashflow',
  '/commissions/manage',
  '/settings/commission-rules',
  '/marketing/distribusi',
  '/cs-report',
  '/cs-ringkasan',
  '/orders/pembukuan',
  '/settings/master-kurir',
]

const forbiddenTopLevel = [
  "title: 'Order'",
  "title: 'Pelanggan'",
  "title: 'Keuangan'",
  "title: 'Komisi'",
  "title: 'Marketing'",
  "title: 'Advertiser'",
  "title: 'CS'",
  "title: 'Pengaturan'",
]

const failures = []
for (const item of requiredGroups) if (!src.includes(`title: '${item}'`)) failures.push(`Missing workflow group: ${item}`)
for (const item of requiredLabels) if (!src.includes(`title: '${item}'`)) failures.push(`Missing business label: ${item}`)
for (const route of requiredRoutes) if (!src.includes(`href: '${route}'`)) failures.push(`Missing preserved route href: ${route}`)
for (const item of forbiddenTopLevel) if (src.includes(item)) failures.push(`Old top-level label still present: ${item}`)

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Menu workflow redesign guard OK')
