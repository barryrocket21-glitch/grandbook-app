import assert from 'node:assert/strict'
import { jakartaDateString } from '../../src/lib/date/jakarta'

assert.equal(jakartaDateString(new Date('2026-09-06T18:47:55.327Z')), '2026-09-07')
assert.equal(jakartaDateString(new Date('2026-09-05T23:22:14.559Z')), '2026-09-06')
assert.equal(jakartaDateString(new Date('2026-09-07T03:00:00.000Z')), '2026-09-07')

console.log('jakarta-date.test.ts passed')
