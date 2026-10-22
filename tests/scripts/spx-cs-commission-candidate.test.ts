import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
const root = process.env.GB_COMMISSION_CANDIDATE_ROOT
if (!root) throw Error('Set GB_COMMISSION_CANDIDATE_ROOT to the isolated reviewed candidate')
const { previewCommission } = createRequire(import.meta.url)(`${root}/src/lib/commissions/spx-preview.ts`)
const source = () => ({orders:[],drafts:[{id:1,ref:'GB-SYNTHETIC',table:'orders_draft',cs_id:'cs',order_date:'2026-09-01',tracking_no:'TRACK-SYNTHETIC',tracking_status:'Delivered'}],observations:[{ref:'GB-SYNTHETIC',target_id:1,target_table:'orders_draft',tracking_no:'TRACK-SYNTHETIC',tracking_status:'Delivered',delivered_at:'2026-09-03T00:00:00Z'}],rules:[{id:1,role:'cs',active:true,user_id:null,product_id:null,effective_from:null,effective_to:null,rate_type:'FLAT_PER_ORDER',rate_value:2500}],commissions:[]})
const preview = (s:unknown) => previewCommission(s,'2026-07-01','2026-09-15')
test('one verified draft earns one candidate fee',()=>{const r=preview(source());assert.equal(r.total,2500);assert.equal(r.candidates.length,1)})
test('paid final after promotion never earns a second fee',()=>{const s=source();const final={...s.drafts[0],id:2,table:'orders'};const r=preview({...s,drafts:[],orders:[final],commissions:[{order_id:2,user_id:'cs',amount:2500,status:'PAID'}]});assert.equal(r.total,0);assert.equal(r.already_recorded_orders,1)})
test('unpaid promoted identity matches unique original observation',()=>{const s=source();const r=preview({...s,drafts:[],orders:[{...s.drafts[0],id:2,table:'orders'}]});assert.equal(r.total,2500)})
test('wrong tracking and missing observation remain exceptions',()=>{const s=source();s.observations[0].tracking_no='WRONG';assert.equal(preview(s).exceptions.unverified_delivery_identity,1);s.observations=[];assert.equal(preview(s).exceptions.missing_or_ambiguous_observation,1)})
test('colliding reference and existing pending cannot become new fees',()=>{const s=source();assert.equal(preview({...s,orders:[{...s.drafts[0],id:2,table:'orders'}]}).exceptions.ambiguous_gb_identity,1);assert.equal(preview({...s,drafts:[],orders:[{...s.drafts[0],table:'orders'}],commissions:[{order_id:1,user_id:'cs',amount:2500,status:'PENDING'}]}).exceptions.existing_commission_needs_review,1)})
test('dated rule selection, ambiguity and null rate fail safely',()=>{const s=source();assert.equal(preview({...s,rules:[{...s.rules[0],effective_from:'2026-09-02'}]}).exceptions.missing_rate,1);assert.equal(preview({...s,rules:[...s.rules,{...s.rules[0],id:2}]}).exceptions.ambiguous_rate,1);assert.throws(()=>preview({...s,rules:[{...s.rules[0],rate_value:null}]}),/Invalid commission rate/)})
