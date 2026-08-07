import fs from 'node:fs'
import path from 'node:path'

const repoRoot = '/root/work/grandbook-app'
const applyIntegrityPath = path.join(repoRoot, 'src/lib/supabase/migrations/142_spx_cashflow_apply_integrity.sql')
const previewIntegrityPath = path.join(repoRoot, 'src/lib/supabase/migrations/143_spx_cashflow_preview_integrity.sql')

const applySql = fs.readFileSync(applyIntegrityPath, 'utf8')
const previewSql = fs.readFileSync(previewIntegrityPath, 'utf8')

if (!/WHERE organization_id = v_org_id AND \(resi = v_row->>'tracking' OR tracking_no = v_row->>'tracking'\)/.test(applySql)) {
  console.error('Apply integrity migration no longer matches resi OR tracking_no')
  process.exit(1)
}

if (!/WHERE organization_id = v_org_id AND \(resi = v_tracking OR tracking_no = v_tracking\)/.test(previewSql)) {
  console.error('Preview SPX cashflow still does not match resi OR tracking_no')
  process.exit(1)
}

console.log('SPX preview/apply match integrity OK')
