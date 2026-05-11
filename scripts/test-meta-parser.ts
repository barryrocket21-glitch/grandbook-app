/* eslint-disable @typescript-eslint/no-explicit-any, no-console */
// Quick smoke test for src/lib/csv/meta-ads-parser.ts
// Run: npx tsx scripts/test-meta-parser.ts
//
// Validates 4 sample CSVs (3 Indonesia + 1 English) untuk Phase 5B-fix.
import {
  parseMetaAdsCsv,
  parseDateFlexible,
  type ExportMode,
} from '../src/lib/csv/meta-ads-parser'

// ─── Sample CSVs ──────────────────────────────────────────────────────────

// 1. Indonesia SNAPSHOT_SINGLE_DAY (mirrors user's real export 25 columns)
const idSnapshotSingleDay = `Awal pelaporan,Akhir pelaporan,Nama kampanye,Penayangan kampanye,Pengaturan atribusi,Hasil,Indikator Hasil,Jangkauan,Frekuensi,Biaya per Hasil,Anggaran Set Iklan,Jenis Anggaran Set Iklan,Jumlah yang dibelanjakan (IDR),Berakhir,Impresi,CPM (Biaya Per 1.000 Tayangan) (IDR),Klik tautan,shop_clicks,CPC (biaya per klik tautan) (IDR),CTR (rasio klik tayang tautan),Klik (semua),CTR (Semua),CPC (semua) (IDR),Tayangan halaman tujuan,Biaya per Tayangan Halaman Landas (IDR)
2026-05-11,2026-05-11,1-5 Nature Gemuk Badan ABO-BID Advented+,active,7d_click,18,actions:purchase,7500,1.20,27778,500000,daily,500000,no,9000,55556,150,5,3333,1.67,180,2.00,2778,120,4167
2026-05-11,2026-05-11,11-4 Kran Robotic ABO Adventeds+ BID,active,7d_click,12,actions:purchase,4800,1.15,33333,400000,daily,400000,no,5500,72727,90,3,4444,1.64,110,2.00,3636,80,5000
2026-05-11,2026-05-11,Test Campaign Indonesia 3,active,7d_click,5,actions:purchase,2000,1.10,40000,200000,daily,200000,no,2200,90909,30,1,6667,1.36,40,1.82,5000,25,8000
`

// 2. Indonesia DAILY_BREAKDOWN — 2 campaigns × 3 hari = 6 rows
const idDailyBreakdown = `Awal pelaporan,Akhir pelaporan,Nama kampanye,Jumlah yang dibelanjakan (IDR),Impresi,Jangkauan,Klik tautan,Hasil,Nilai Konversi Pembelian
2026-05-08,2026-05-08,Camp A Indonesia,150000,3000,2500,50,5,1500000
2026-05-09,2026-05-09,Camp A Indonesia,200000,4000,3200,75,8,2400000
2026-05-10,2026-05-10,Camp A Indonesia,180000,3500,2800,65,7,2100000
2026-05-08,2026-05-08,Camp B Indonesia,120000,2500,2000,40,4,1200000
2026-05-09,2026-05-09,Camp B Indonesia,140000,2800,2300,45,5,1500000
2026-05-10,2026-05-10,Camp B Indonesia,160000,3100,2500,55,6,1800000
`

// 3. Indonesia SNAPSHOT_DATE_RANGE_AGGREGATE — start != end, 11 hari aggregate
const idDateRangeAggregate = `Awal pelaporan,Akhir pelaporan,Nama kampanye,Jumlah yang dibelanjakan (IDR),Impresi,Jangkauan,Klik tautan,Hasil
2026-05-01,2026-05-11,Camp X Aggregate,1650000,33000,27000,500,50
2026-05-01,2026-05-11,Camp Y Aggregate,1320000,26000,21000,440,42
2026-05-01,2026-05-11,Camp Z Aggregate,990000,19000,15500,330,33
`

// 4. English DAILY_BREAKDOWN (backward compat dari Phase 5B v1)
const enDailyBreakdown = `Day,Campaign name,Campaign ID,Amount spent (IDR),Impressions,Reach,Link clicks,Purchases,Purchases conversion value
2026-05-08,Camp ENG One,12345,500000,12000,8500,180,15,4500000
2026-05-09,Camp ENG One,12345,450000,11000,7800,170,14,4200000
2026-05-08,Camp ENG Two,67890,300000,8000,6500,120,8,2400000
`

interface Sample {
  name: string
  csv: string
  expectMode: ExportMode
  expectRows: number
}

const samples: Sample[] = [
  { name: '1. ID SNAPSHOT_SINGLE_DAY', csv: idSnapshotSingleDay, expectMode: 'SNAPSHOT_SINGLE_DAY', expectRows: 3 },
  { name: '2. ID DAILY_BREAKDOWN', csv: idDailyBreakdown, expectMode: 'DAILY_BREAKDOWN', expectRows: 6 },
  { name: '3. ID SNAPSHOT_DATE_RANGE_AGGREGATE', csv: idDateRangeAggregate, expectMode: 'SNAPSHOT_DATE_RANGE_AGGREGATE', expectRows: 3 },
  { name: '4. EN DAILY_BREAKDOWN', csv: enDailyBreakdown, expectMode: 'DAILY_BREAKDOWN', expectRows: 3 },
]

async function main(): Promise<void> {
  let pass = 0
  let fail = 0

  for (const s of samples) {
    console.log(`\n──── ${s.name} ────`)
    const result = await parseMetaAdsCsv(s.csv)
    console.log('  rows:', result.rows.length, '/ expect', s.expectRows)
    console.log('  errors:', result.errors.length, result.errors.slice(0, 3))
    console.log('  warnings:', result.warnings.length, result.warnings.slice(0, 2))
    console.log('  detectedColumns:', result.detectedColumns.join(' | '))
    console.log('  currency:', result.currencyDetected)
    console.log('  mode:', result.mode, '/ expect', s.expectMode)
    console.log('  distinctRanges:', result.modeDetails.distinctDateRanges.length)
    if (result.rows.length > 0) {
      const r = result.rows[0]
      console.log('  sample row:', {
        spend_date: r.spend_date,
        start: r.report_start_date,
        end: r.report_end_date,
        campaign: r.campaign_name.slice(0, 40),
        spend: r.spend,
        impr: r.impressions,
        reach: r.reach,
        clicks: r.clicks,
        conv: r.conversions,
        rev: r.revenue_reported,
      })
    }

    let ok = true
    if (result.rows.length !== s.expectRows) {
      console.log('  ❌ FAIL row count')
      ok = false
    }
    if (result.mode !== s.expectMode) {
      console.log('  ❌ FAIL mode')
      ok = false
    }
    if (result.errors.length > 0) {
      console.log('  ❌ FAIL has errors')
      ok = false
    }
    // Required columns must NOT be MISSING
    const requiredOk = ['start=', 'campaign=', 'spend='].every(prefix =>
      result.detectedColumns.some(c => c.startsWith(prefix) && !c.includes('=MISSING'))
    )
    if (!requiredOk) {
      console.log('  ❌ FAIL required column missing')
      ok = false
    }
    // For sample #1 (ID full 25 cols), expect ALL fields detected (no =(none) for our 7 fields)
    if (s.name.includes('SNAPSHOT_SINGLE_DAY')) {
      const allFields = ['start', 'campaign', 'spend', 'impr', 'reach', 'clicks', 'conv']
      for (const f of allFields) {
        const found = result.detectedColumns.find(c => c.startsWith(f + '='))
        if (!found || found.includes('=MISSING') || found.includes('=(none)')) {
          console.log(`  ❌ FAIL ID sample #1 should detect ${f}, got ${found}`)
          ok = false
        }
      }
    }
    if (ok) {
      console.log('  ✅ PASS')
      pass++
    } else {
      fail++
    }
  }

  // Date parsing tests
  console.log('\n──── Date parsing ────')
  const dateTests: Array<[string, string | null]> = [
    ['2026-05-11', '2026-05-11'],
    ['11/05/2026', '2026-05-11'],
    ['2026/05/11', '2026-05-11'],
    ['11-05-2026', '2026-05-11'],
    ['garbage', null],
  ]
  for (const [input, expected] of dateTests) {
    const got = parseDateFlexible(input)
    const ok = got === expected
    console.log(`  ${ok ? '✅' : '❌'} "${input}" → ${got} (expect ${expected})`)
    if (ok) pass++
    else fail++
  }

  console.log('\n══════════════════')
  console.log(`PASS: ${pass}, FAIL: ${fail}`)
  if (fail > 0) process.exit(1)
}

void main()
