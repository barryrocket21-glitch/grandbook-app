import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getEntryRedirect, getRoleLanding } from '../../src/lib/auth/landing'

test('entry routes use the authenticated role without upgrading any role', () => {
  const expected = {owner:'/dashboard',admin:'/orders/draft',cs:'/cs/resi',advertiser:'/adv-dashboard',akunting:'/reconciliation/spx'}
  for (const [role, path] of Object.entries(expected)) {
    assert.equal(getRoleLanding(role), path)
    assert.equal(getEntryRedirect('/', role), path)
    assert.equal(getEntryRedirect('/login', role), path)
  }
})

test('non-owner dashboard entry goes home; owner/admin keep dashboard access', () => {
  for (const role of ['cs', 'advertiser', 'akunting']) assert.equal(getEntryRedirect('/dashboard', role), getRoleLanding(role))
  for (const role of ['owner', 'admin']) assert.equal(getEntryRedirect('/dashboard', role), null)
  assert.equal(getEntryRedirect('/cs/resi', 'cs'), null)
  assert.equal(getEntryRedirect('/api/orders/wa-paste/submit', 'cs'), null)
})

test('missing, unknown and prototype roles never select a privileged fallback', () => {
  for (const role of [null, undefined, '', 'Owner', 'owner ', '__proto__', 'constructor', 'toString', 1, {}]) {
    assert.equal(getRoleLanding(role), null)
    assert.equal(getEntryRedirect('/', role), null)
    assert.equal(getEntryRedirect('/dashboard', role), null)
  }
})
