const assert=require('node:assert/strict'),{test}=require('node:test'),path=require('node:path')
const {createHarness}=require('./route-harness.cjs')
const root=process.env.GB_PACKING_CANDIDATE_ROOT,baseline=process.env.GB_PACKING_BASELINE_ROOT
if(!root||!baseline)throw Error('Explicit isolated candidate and baseline roots required')
function fixture(items=[{id:11,order_id:1,product_id:1,product_name_raw:'Synthetic product A',qty:2,hpp_snapshot:100,packing_fee_snapshot:5}]){
 return{orders:[{id:1,order_number:'SYNTHETIC-1',status:'DITERIMA',order_date:'2026-09-15',total:1000,cod_amount:1000,payout_amount:null,shipping_cost:50,shipping_cost_actual:30,estimated_shipping_net:0,estimated_cod_fee:0,campaign_id:1,meta:{platform:'FACEBOOK'}}],order_items:items,
 commissions:[{id:1,order_id:1,order_item_id:null,amount:25,status:'EARNED'}],ad_spend:[{id:1,campaign_id:1,spend_total:50,spend_date:'2026-09-15'}],campaigns:[{id:1,platform:'FACEBOOK'}],campaign_products:[{id:1,campaign_id:1,product_id:1,allocation_pct:100}],products:[{id:1,name:'Canonical A',display_name:null},{id:2,name:'Canonical B',display_name:null}]}
}
const payloadWithoutNotes=body=>{const{notes,...rest}=body;return rest}
test('stored packing is charged per delivered quantity exactly once; ADS/shipping/commission unchanged',async()=>{
 const f=fixture(),before=await createHarness(baseline,f).run(),h=createHarness(root,f),after=await h.run()
 assert.equal(after.status,200);assert.equal(before.body.totals.gross_profit_before_ads,745)
 assert.equal(after.body.totals.gross_profit_before_ads,735);assert.equal(after.body.totals.profit_after_ads,685)
 for(const k of['omset','ads_allocated','shipping_diff','delivered','total_orders'])assert.equal(before.body.totals[k],after.body.totals[k])
 assert(h.calls.some(c=>c.table==='order_items'&&c.columns.split(',').includes('packing_fee_snapshot')))
 assert(after.body.notes.some(n=>n.includes('packing tersimpan')))
})
test('multiple products receive their own packing cost; row/platform/grand totals reconcile',async()=>{
 const f=fixture([{id:11,order_id:1,product_id:1,qty:2,hpp_snapshot:100,packing_fee_snapshot:5},{id:12,order_id:1,product_id:2,qty:1,hpp_snapshot:50,packing_fee_snapshot:10}])
 const{body}=await createHarness(root,f).run()
 assert.equal(body.totals.gross_profit_before_ads,675);assert.equal(body.totals.profit_after_ads,625)
 assert.equal(body.productPlatform.reduce((n,r)=>n+r.gross_profit_before_ads,0),675)
 assert.equal(body.summary[0].gross_profit_before_ads,675)
})
test('null and zero packing preserve the entire legacy payload except the explanatory note',async()=>{
 for(const packing of[null,0]){
  const f=fixture();f.order_items[0].packing_fee_snapshot=packing
  const a=await createHarness(root,f).run(),b=await createHarness(baseline,f).run()
  assert.deepEqual(payloadWithoutNotes(a.body),payloadWithoutNotes(b.body))
 }
})
test('decimal snapshots keep cents until the existing final report rounding',async()=>{
 const f=fixture();Object.assign(f.order_items[0],{qty:3,hpp_snapshot:10.01,packing_fee_snapshot:0.12})
 const{body}=await createHarness(root,f).run()
 assert.equal(body.totals.gross_profit_before_ads,914.61);assert.equal(body.totals.profit_after_ads,864.61)
})
test('packing does not alter pending, return or canceled recognition',async()=>{
 for(const status of['BARU','DIKIRIM','RETUR','CANCEL','FAKE']){
  const f=fixture();f.orders[0].status=status
  const a=await createHarness(root,f).run(),b=await createHarness(baseline,f).run()
  assert.deepEqual(payloadWithoutNotes(a.body),payloadWithoutNotes(b.body))
 }
})
test('more than1000 delivered items and short provider pages include all packing',async()=>{
 const f=fixture();f.orders=Array.from({length:1201},(_,i)=>({...f.orders[0],id:i+1,order_number:'SYNTHETIC-'+(i+1),total:100,cod_amount:100,shipping_cost_actual:0}))
 f.order_items=f.orders.map(o=>({id:o.id,order_id:o.id,product_id:1,qty:1,hpp_snapshot:10,packing_fee_snapshot:2}));f.commissions=[];f.ad_spend=[]
 const{status,body}=await createHarness(root,f,{pageCap:73}).run()
 assert.equal(status,200);assert.equal(body.totals.total_orders,1201);assert.equal(body.totals.gross_profit_before_ads,105688)
})
test('failed item read rejects the whole report rather than publishing incomplete profit',async()=>{
 const{status,body}=await createHarness(root,fixture(),{failTable:'order_items'}).run()
 assert.equal(status,503);assert.equal(body.ok,undefined);assert.equal(body.totals,undefined)
})
test('authentication and finance role gates remain unchanged',async()=>{
 for(const options of[{noUser:true},{profile:{role:'cs',active:true,organization_id:1}},{profile:{role:'owner',active:false,organization_id:1}}]){
  const a=await createHarness(root,fixture(),options).run(),b=await createHarness(baseline,fixture(),options).run()
  assert.deepEqual(a,b);assert([401,403].includes(a.status))
 }
})
test('platform filtering excludes packing costs outside the selected platform',async()=>{
 const f=fixture();const a=await createHarness(root,f).run('2026-09','GOOGLE'),b=await createHarness(baseline,f).run('2026-09','GOOGLE')
 assert.deepEqual(payloadWithoutNotes(a.body),payloadWithoutNotes(b.body));assert.equal(a.body.totals.gross_profit_before_ads,0)
})
