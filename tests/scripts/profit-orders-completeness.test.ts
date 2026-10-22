import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const root = process.env.GB_PROFIT_CANDIDATE_ROOT
if (!root) throw Error('Set GB_PROFIT_CANDIDATE_ROOT')
const { completeReportRead, assertReportRelations } = createRequire(import.meta.url)(`${root}/src/lib/analytics/complete-report-read.ts`)
const rows = Array.from({length: 1201}, (_, i) => ({ id: i + 1 }))
const source = (cap=500, change=(r:any)=>r) => async (after:number) => {
 const remaining=rows.filter(r=>r.id>after)
 return change({data:remaining.slice(0,cap),count:remaining.length,error:null})
}
test('all rows including short provider pages survive report limits',async()=>{
 assert.deepEqual(await completeReportRead(source(73)),rows)
})
test('server failure, silent missing page and changed count reject entire report',async()=>{
 for(const failure of [{data:null,count:701,error:{message:'timeout'}},{data:[],count:701,error:null},{data:rows.slice(500,1000),count:700,error:null}]) {
  await assert.rejects(completeReportRead(async(after:number)=>after?failure:source()(0)))
 }
})
test('count unavailable, duplicate identities and oversized scope fail closed',async()=>{
 await assert.rejects(completeReportRead(source(500,r=>({...r,count:null}))))
 await assert.rejects(completeReportRead(async(after:number)=>after?{data:[rows[0]],count:701,error:null}:source()(0)))
 await assert.rejects(completeReportRead(source(500,r=>({...r,count:100001}))))
})
test('order/item/commission relations require complete matching identities',()=>{
 const orders=[{id:1},{id:2}],items=[{id:11,order_id:1},{id:21,order_id:2}]
 assert.doesNotThrow(()=>assertReportRelations(orders,items,[{order_id:1,order_item_id:11},{order_id:2,order_item_id:null}]))
 assert.throws(()=>assertReportRelations(orders,items.slice(0,1),[]))
 assert.throws(()=>assertReportRelations(orders,[...items,{id:31,order_id:3}],[]))
 assert.throws(()=>assertReportRelations(orders,items,[{order_id:1,order_item_id:21}]))
})
