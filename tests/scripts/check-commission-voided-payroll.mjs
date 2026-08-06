import fs from 'node:fs'

const manage = fs.readFileSync('src/app/(app)/commissions/manage/page.tsx', 'utf8')
const queries = fs.readFileSync('src/lib/supabase/queries/commissions.ts', 'utf8')

const failures = []

if (!manage.includes("r.status === 'VOIDED'")) {
  failures.push('Manage commissions page must count VOIDED rows in hangus tally')
}

if (!queries.includes("case 'VOIDED'")) {
  failures.push('Commission stats helper must count VOIDED rows')
}

if (manage.includes("r.status === 'CANCELLED'")) {
  failures.push('Manage commissions page still depends on legacy CANCELLED runtime status')
}

if (queries.includes("case 'CANCELLED'")) {
  failures.push('Commission stats helper still depends on legacy CANCELLED runtime status')
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Commission VOIDED payroll guard OK')
