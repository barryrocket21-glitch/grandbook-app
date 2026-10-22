import test from 'node:test'
import assert from 'node:assert/strict'
import { cents, rupiah, parseReferences, validateCosts, costTotals, latestCostReferences } from '../../src/lib/financial/actual-cost-report'
const actual = {order_number:'GB-A',basis:'VERIFIED_COMPONENTS',shipping:'100.25',cod:'10.10',ppn:null,total:'110.35',external_id:'TX'}
test('decimal money and large aggregates retain precision',()=>{
 assert.equal(cents('100.25')+cents('10.10'),cents('110.35'))
 assert.equal(rupiah(cents('1234567.89')),'Rp1.234.567,89')
 for(const v of [NaN,Infinity,'1e5','1.001','']) assert.throws(()=>cents(v))
})
test('actual and estimate totals remain separate; missing remains missing',()=>{
 const rows=validateCosts([actual,{...actual,order_number:'GB-B',basis:'ESTIMATE',total:42,external_id:null},{...actual,order_number:'GB-C',basis:'MISSING',total:null,external_id:null}],['GB-A','GB-B','GB-C'])
 assert.deepEqual(costTotals(rows),{actual:cents('110.35'),estimate:cents(42),actualCount:1,estimateCount:1,missingCount:1})
})
test('partial, duplicate and foreign identities fail',()=>{
 assert.throws(()=>validateCosts([],['GB-A']))
 assert.throws(()=>validateCosts([actual,actual],['GB-A','GB-B']))
 assert.throws(()=>validateCosts([actual],['GB-Z']))
})
test('inconsistent verified evidence cannot become actual',()=>{
 for(const patch of [{total:111},{ppn:0},{external_id:5},{shipping:-1,cod:111.35},{shipping:0,cod:0,total:0},{cod:null}]) assert.throws(()=>validateCosts([{...actual,...patch}],['GB-A']))
 assert.throws(()=>validateCosts([{...actual,basis:'ESTIMATE',total:null}],['GB-A']))
 assert.throws(()=>validateCosts([{...actual,basis:'MISSING'}],['GB-A']))
})
test('reference selection is bounded and deduplicated',()=>{
 assert.deepEqual(parseReferences('GB-A, GB-B\nGB-A;'),['GB-A','GB-B'])
 assert.throws(()=>parseReferences(''))
 assert.throws(()=>parseReferences(Array.from({length:501},(_,i)=>`GB-${i}`).join('\n')))
})

test('settlement totals preserve cash discrepancies without double counting',()=>{
 const row={...actual,basis:'VERIFIED_SETTLEMENT',settlement_sn:'S1',nominal:'-110',balance_before:'200',balance_after:'91',actual_minus_nominal_debit:'0.35',actual_minus_balance_debit:'1.35',cash_reconciled:false}
 assert.equal(costTotals(validateCosts([row],['GB-A'])).actual,cents('110.35'))
 for(const patch of [{nominal:'110'},{actual_minus_nominal_debit:'0'},{balance_after:'90'},{cash_reconciled:true},{settlement_sn:''},{nominal:110}]) assert.throws(()=>validateCosts([{...row,...patch}],['GB-A']))
})

test('latest records merge both modes chronologically and remain bounded',()=>{
 const rows=Array.from({length:70},(_,i)=>({order_number:`GB-${i}`,external_id:`T-${i}`,transaction_at:new Date(1700000000000+i*1000).toISOString()}))
 const refs=latestCostReferences([rows.slice(0,35),rows.slice(35)])
 assert.equal(refs.length,50);assert.equal(refs[0],'GB-69');assert.equal(refs[49],'GB-20')
 assert.throws(()=>latestCostReferences([[rows[0]],[rows[0]]]))
 assert.throws(()=>latestCostReferences([[{...rows[0],transaction_at:'invalid'}]]))
})
