#!/usr/bin/env node
/**
 * Run all smoke tests sequentially. Spawn child processes per script.
 *
 * Usage:
 *   node tests/scripts/smoke-all.mjs [slot]
 *   default slot = owner
 */
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const slot = process.argv[2] || 'owner'

const scripts = readdirSync(__dirname)
  .filter(f => f.startsWith('smoke-') && f.endsWith('.mjs') && f !== 'smoke-all.mjs')
  .sort()

console.log(`\n=== Running ${scripts.length} smoke tests (slot=${slot}) ===\n`)

const summary = []
for (const script of scripts) {
  const fullPath = join(__dirname, script)
  console.log(`\n▶  ${script}`)
  console.log('─'.repeat(60))
  const result = spawnSync('node', [fullPath, slot], { stdio: 'inherit' })
  summary.push({ script, ok: result.status === 0 })
}

console.log(`\n${'═'.repeat(60)}`)
console.log(`=== FINAL SUMMARY (slot=${slot}) ===`)
console.log('═'.repeat(60))
summary.forEach(s => console.log(`  ${s.ok ? '✓' : '✗'}  ${s.script}`))
const passed = summary.filter(s => s.ok).length
console.log(`\n${passed}/${summary.length} test suites passed.`)
process.exit(passed === summary.length ? 0 : 1)
