import fs from 'node:fs'

const readme = fs.readFileSync('tests/auth/README.md', 'utf8')
const failures = []

for (const banned of ['GrandBook2026!', 'barry@owner.com', 'INDRA_PASSWORD_HERE']) {
  if (readme.includes(banned)) failures.push(`README still contains credential-like literal: ${banned}`)
}

for (const required of ['GB_EMAIL', 'GB_PASSWORD', 'npm run capture-session -- owner']) {
  if (!readme.includes(required)) failures.push(`README missing expected safe usage marker: ${required}`)
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log('Auth README credential hygiene guard OK')
