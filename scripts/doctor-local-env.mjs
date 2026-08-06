#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const envPath = resolve(process.cwd(), '.env.local')

function parseEnv(text) {
  const map = new Map()
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const idx = line.indexOf('=')
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    map.set(key, value)
  }
  return map
}

const failures = []
const warnings = []

if (!existsSync(envPath)) {
  console.error(`✗ Missing ${envPath}`)
  process.exit(1)
}

const env = parseEnv(readFileSync(envPath, 'utf8'))

const requiredRuntime = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
]

for (const key of requiredRuntime) {
  if (!env.get(key)) failures.push(`${key} missing`)
}

const url = env.get('NEXT_PUBLIC_SUPABASE_URL') || ''
const anon = env.get('NEXT_PUBLIC_SUPABASE_ANON_KEY') || ''
const service = env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (url && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
  failures.push('NEXT_PUBLIC_SUPABASE_URL invalid format')
}
if (url.includes('placeholder')) {
  failures.push('NEXT_PUBLIC_SUPABASE_URL still placeholder')
}
if (anon && !anon.startsWith('eyJ')) {
  failures.push('NEXT_PUBLIC_SUPABASE_ANON_KEY does not look like a JWT')
}
if (anon && anon.toLowerCase().includes('your-')) {
  failures.push('NEXT_PUBLIC_SUPABASE_ANON_KEY still placeholder')
}
if (!service) {
  warnings.push('SUPABASE_SERVICE_ROLE_KEY missing — app runtime/build OK, but admin routes + seed/repair scripts will fail')
}

const projectRef = url ? url.replace(/^https:\/\//i, '').split('.')[0] : null

if (failures.length) {
  console.error('✗ Local Supabase env invalid')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log('✓ Local Supabase runtime env OK')
console.log(`  - project_ref: ${projectRef || 'unknown'}`)
console.log('  - runtime keys: present')
if (service) {
  console.log('  - service role: present')
} else {
  console.log('  - service role: missing (warning)')
}
for (const warning of warnings) console.log(`  ! ${warning}`)
