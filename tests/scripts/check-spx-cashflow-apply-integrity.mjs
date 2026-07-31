import { readFileSync } from 'node:fs'

const page = readFileSync('src/app/(app)/reconciliation/spx-cashflow/page.tsx', 'utf8')
const types = readFileSync('src/lib/types.ts', 'utf8')
const migration = readFileSync('src/lib/supabase/migrations/142_spx_cashflow_apply_integrity.sql', 'utf8')

const mustHavePage = [
  'Owner approval checkpoint',
  'Tidak ada data live yang berubah sebelum',
  'Komisi EARNED ikut ditandai PAID',
  'matched 99,92% ke order GrandBook',
  'commissions_paid',
]

const mustHaveMigration = [
  'apply_spx_cashflow_recon(p_batch_id bigint)',
  'GET DIAGNOSTICS v_last_count = ROW_COUNT',
  "WHERE organization_id = v_org_id AND (resi = v_row->>'tracking' OR tracking_no = v_row->>'tracking')",
  "UPDATE public.commissions",
  "status = 'PAID'",
  "status = 'EARNED'",
  'v_commissions_paid',
  'ON CONFLICT (organization_id, external_id) DO NOTHING',
]

const mustNotHaveMigration = [
  'v_withdrawals_created := v_withdrawals_created + 1;\n  END LOOP;',
  'v_cod_updated := v_cod_updated + 1;\n  END LOOP;',
]

const failures = []
for (const needle of mustHavePage) if (!page.includes(needle)) failures.push(`Page missing: ${needle}`)
for (const needle of mustHaveMigration) if (!migration.includes(needle)) failures.push(`Migration missing: ${needle}`)
for (const needle of mustNotHaveMigration) if (migration.includes(needle)) failures.push(`Migration still has unsafe blind counter: ${needle}`)
if (!types.includes('commissions_paid: number')) failures.push('Types missing CashflowApplyResult.commissions_paid')

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log('SPX cashflow apply integrity guard OK')
