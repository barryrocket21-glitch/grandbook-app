import assert from 'node:assert/strict'
import { detectDuplicatePhones } from '../../src/lib/converter/wa-paste-phone-dup'

// All phone values are fabricated test fixtures.
// Within-batch duplicates
const withinBatch = detectDuplicatePhones({
  parsedPhones: ['08123456789', '08123456789', '08999999999'],
  existingDbPhones: [],
})
assert.equal(withinBatch.length, 1)
assert.equal(withinBatch[0].phone, '08123456789')
assert.equal(withinBatch[0].count, 2)
assert.equal(withinBatch[0].scope, 'batch')
assert.ok(withinBatch[0].message.includes('2×'))

// No duplicates
const noDup = detectDuplicatePhones({
  parsedPhones: ['08111111111', '08222222222', '08333333333'],
  existingDbPhones: [],
})
assert.equal(noDup.length, 0)

// DB duplicates
const dbDup = detectDuplicatePhones({
  parsedPhones: ['08123456789'],
  existingDbPhones: ['08123456789', '08123456789'],
})
assert.equal(dbDup.length, 1)
assert.equal(dbDup[0].scope, 'database')
assert.ok(dbDup[0].message.includes('sudah diinput hari ini (WIB)'))

console.log('wa-paste-phone-dup.test.ts passed')
