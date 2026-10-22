import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const root = process.env.GB_PROFIT_CANDIDATE_ROOT
if (!root) throw Error('Set GB_PROFIT_CANDIDATE_ROOT')
const { readProfitCostEvidence: read, profitShippingCost: cost } = createRequire(import.meta.url)(`${root}/src/lib/analytics/profit-cost-evidence.ts`)
const exact = (ref: string) => ({ order_number: ref, basis: 'VERIFIED_COMPONENTS', shipping: '5400', cod: '1320.90', total: '6720.90', ppn: null, external_id: ref })
const index = async (table: string, refs: string[]) => ({ data: table === 'spx_actual_costs' ? refs.map(order_number => ({order_number})) : [], count: table === 'spx_actual_costs' ? refs.length : 0, error: null })
const detail = async (refs: string[]) => ({data: refs.map(exact), error: null})
test('all 1201 references use bounded reads, preserve final short batch', async () => {
 const refs = Array.from({length:1201}, (_,i) => `GB-${i}`); let max = 0
 const rows = await read(refs, (table: string, batch: string[]) => { max=Math.max(max,batch.length);return index(table,batch) }, detail)
 assert.equal(rows.size,1201);assert.equal(max,500)
})
test('verified total replaces legacy/estimate once, without adding COD or rounding nominal', async () => {
 const evidence = await read(['a'],index,detail)
 assert.deepEqual(cost({order_number:'a',shipping_cost_actual:8000,estimated_shipping_net:9000,estimated_cod_fee:1500},evidence),{amount:6720.90,basis:'verified'})
})
test('unverified legacy and estimate remain labelled; missing cost is never verified zero', () => {
 const empty=new Map(), base={order_number:'a',shipping_cost_actual:null,estimated_shipping_net:null,estimated_cod_fee:null}
 assert.deepEqual(cost(base,empty),{amount:0,basis:'missing'})
 assert.deepEqual(cost({...base,shipping_cost_actual:0,estimated_cod_fee:1190},empty),{amount:1190,basis:'estimate'})
 assert.deepEqual(cost({...base,shipping_cost_actual:6429.90},empty),{amount:6429.90,basis:'legacy'})
 assert.throws(()=>cost({...base,shipping_cost_actual:-1},empty))
})
test('index truncation, duplicate evidence, wrong identity and API errors fail closed',async()=>{
 for (const bad of [async()=>({data:[],count:1,error:null}),async()=>({data:[],count:null,error:null}),async()=>({data:[{order_number:'wrong'}],count:1,error:null}),async()=>({data:[],count:0,error:{}}),async()=>({data:[{order_number:'a'}],count:1,error:null})]) await assert.rejects(read(['a'],bad,detail))
 await assert.rejects(read(['a','a'],index,detail))
})
test('detail omissions, stale estimate, inconsistent components and failure fail closed',async()=>{
 for (const data of [[],[{...exact('a'),basis:'ESTIMATE'}],[{...exact('a'),total:'6721'}]]) await assert.rejects(read(['a'],index,async()=>({data,error:null})))
 await assert.rejects(read(['a'],index,async()=>({data:null,error:{}})))
})
test('no recorded evidence needs no detail RPC',async()=>{
 let calls=0
 const rows=await read(['a'],async()=>({data:[],count:0,error:null}),async()=>{calls++;throw Error()})
 assert.equal(rows.size,0);assert.equal(calls,0)
})
