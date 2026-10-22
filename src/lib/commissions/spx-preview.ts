export type Order = { id:number; ref:string; cs_id:string|null; order_date:string; tracking_no:string|null; tracking_status:string|null; table:'orders'|'orders_draft' }
export type Observation = { ref:string; target_id:number; target_table:string; tracking_no:string; tracking_status:string; delivered_at:string|null }
export type Rule = { id:number; role:string; active:boolean; user_id:string|null; product_id:number|null; effective_from:string|null; effective_to:string|null; rate_type:string; rate_value:number|null }
export type Commission = { order_id:number; user_id:string; status:string; amount:number }
export type Source = { orders:Order[]; drafts:Order[]; observations:Observation[]; rules:Rule[]; commissions:Commission[] }
export function previewCommission(source:Source, from:string, to:string) {
 const groups=new Map<string,Order[]>(), finals=new Map<number,Order>(), ledger=new Map<string,Commission[]>(), observations=new Map<string,Observation[]>()
 for(const row of [...source.orders,...source.drafts]) {groups.set(row.ref,[...(groups.get(row.ref)||[]),row]);if(row.table==='orders'){if(finals.has(row.id))throw Error('Duplicate final identity');finals.set(row.id,row)}}
 for(const c of source.commissions){const order=finals.get(c.order_id);if(!order)throw Error('Missing commission order');ledger.set(order.ref,[...(ledger.get(order.ref)||[]),c])}
 for(const o of source.observations)observations.set(o.ref,[...(observations.get(o.ref)||[]),o])
 const candidates:Array<{ref:string;cs_id:string;table:string;amount:number;delivered_at:string;rule_id:number}>=[]
 const exceptions:Record<string,number>={};let recorded=0
 for(const [ref,matches] of groups){
  const row=matches.find(r=>r.order_date.slice(0,10)>=from&&r.order_date.slice(0,10)<=to&&r.tracking_status?.toUpperCase()==='DELIVERED');if(!row)continue
  let reason='';const entries=ledger.get(ref)||[],events=observations.get(ref)||[]
  if(matches.length!==1)reason='ambiguous_gb_identity'
  else if(!row.cs_id)reason='missing_cs'
  else if(entries.length){if(entries.every(c=>['EARNED','PAID'].includes(c.status)&&c.user_id===row.cs_id)){recorded++;continue}reason='existing_commission_needs_review'}
  if(!reason&&(events.length!==1||!row.tracking_no))reason='missing_or_ambiguous_observation'
  const event=events[0]
  if(!reason){const exact=event.target_table===row.table&&event.target_id===row.id;const promoted=event.target_table==='orders_draft'&&row.table==='orders';if(!(exact||promoted)||event.tracking_no!==row.tracking_no||event.tracking_status.toUpperCase()!=='DELIVERED'||!event.delivered_at)reason='unverified_delivery_identity'}
  const day=row.order_date.slice(0,10)
  const rules=source.rules.filter(r=>r.active&&r.role==='cs'&&(r.user_id===null||r.user_id===row.cs_id)&&(!r.effective_from||r.effective_from<=day)&&(!r.effective_to||r.effective_to>=day))
  if(!reason&&rules.some(r=>r.product_id!==null))reason='product_specific_rule_requires_review'
  rules.sort((a,b)=>Number(b.user_id!==null)-Number(a.user_id!==null)||(b.effective_from||'').localeCompare(a.effective_from||''))
  if(!reason){if(!rules.length)reason='missing_rate';else if(rules.length>1&&rules[0].user_id===rules[1].user_id&&rules[0].effective_from===rules[1].effective_from)reason='ambiguous_rate';else if(rules[0].rate_type!=='FLAT_PER_ORDER')reason='non_flat_rule_requires_review'}
  if(reason){exceptions[reason]=(exceptions[reason]||0)+1;continue}
  const amount=Number(rules[0].rate_value),cents=Math.round(amount*100)
  if(rules[0].rate_value===null||!Number.isSafeInteger(cents)||amount<0||Math.abs(amount*100-cents)>1e-6)throw Error('Invalid commission rate')
  candidates.push({ref,cs_id:row.cs_id!,table:row.table,amount:cents/100,delivered_at:event.delivered_at!,rule_id:rules[0].id})
 }
 const totalCents=candidates.reduce((sum,r)=>sum+Math.round(r.amount*100),0)
 if(!Number.isSafeInteger(totalCents))throw Error('Commission total overflow')
 return {candidates,total:totalCents/100,already_recorded_orders:recorded,exceptions}
}
