import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync('src/lib/converter/engine.ts', 'utf8')

assert.match(source, /const CHUNK_SIZE = 100/)
assert.match(source, /statement timeout\|canceling statement due to statement timeout\|57014/)
assert.match(source, /rows\.slice\(0, midpoint\)/)
assert.match(source, /rows\.slice\(midpoint\)/)
assert.match(source, /getErrorMessage\(bulkErr\)/)
assert.doesNotMatch(source, /`Bulk insert draft gagal: \$\{bulkErr\.message\}`/)

console.log('bulk upload timeout regression: PASS')
