import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverEnvironmentResponse } from '@/lib/server/environment-guard'
import { previewCommission, type Order, type Observation, type Commission, type Rule } from '@/lib/commissions/spx-preview'
export const maxDuration = 120
export async function GET(request:Request) {
 const guard=serverEnvironmentResponse('GET','/api/commissions/spx-preview');if(guard)return guard
 const sb=await createClient();const {data:{user},error}=await sb.auth.getUser()
 if(error||!user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const profile=await sb.from('profiles').select('organization_id,active,role').eq('id',user.id).single()
 if(profile.error||!profile.data?.active||!['owner','admin'].includes(profile.data.role))return NextResponse.json({error:'Akses owner/admin diperlukan'},{status:403})
 const org=profile.data.organization_id;if(!org)return NextResponse.json({error:'Organisasi tidak tersedia'},{status:403})
 const params=new URL(request.url).searchParams
 const from=params.get('from')||'',to=params.get('to')||''
 const valid=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v
 if(!valid(from)||!valid(to)||from>to)return NextResponse.json({error:'Rentang tanggal order tidak valid'},{status:400})
 async function pages<T extends {id:number}>(fetch:(after:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null}>):Promise<T[]>{
  let after=0;const rows:T[]=[]
  for(;;){const r=await fetch(after);if(r.error||!r.data)throw Error('Incomplete read');if(!r.data.length)return rows
   for(const row of r.data){if(!Number.isSafeInteger(row.id)||row.id<=after)throw Error('Invalid page');rows.push(row);after=row.id}
   if(rows.length>100000)throw Error('Source limit reached')
  }
 }
 try {
  const fields='id,ref:order_number,cs_id,order_date,tracking_no,tracking_status'
  const startedAt=new Date().toISOString()
  const [orders,drafts,rules,commissions,profiles]=await Promise.all([
   pages<Omit<Order,'table'>>(after=>sb.from('orders').select(fields).eq('organization_id',org).gt('id',after).order('id').limit(500)),
   pages<Omit<Order,'table'>>(after=>sb.from('orders_draft').select(fields).eq('organization_id',org).gt('id',after).order('id').limit(500)),
   pages<Rule>(after=>sb.from('commission_rules').select('id,role,active,user_id,product_id,effective_from,effective_to,rate_type,rate_value').eq('organization_id',org).eq('role','cs').gt('id',after).order('id').limit(500)),
   pages<Commission&{id:number}>(after=>sb.from('commissions').select('id,order_id,user_id,status,amount,orders!commissions_order_id_fkey!inner(organization_id)').eq('orders.organization_id',org).eq('role','cs').gt('id',after).order('id').limit(500)),
   sb.from('profiles').select('id,full_name').eq('organization_id',org),
  ])
  if(profiles.error||!profiles.data)throw Error('Profiles incomplete')
  // Observation table has a tracking-number key, not a numeric id.
  const observations:Observation[]=[];let after=''
  for(;;){const r=await sb.from('spx_tracking_sync_state').select('ref:source_ref,target_id,target_table,tracking_no,tracking_status,delivered_at').eq('organization_id',org).gt('tracking_no',after).order('tracking_no').limit(500)
   if(r.error||!r.data)throw Error('Observations incomplete');if(!r.data.length)break
   for(const row of r.data){if(row.tracking_no<=after)throw Error('Invalid observation page');observations.push(row);after=row.tracking_no}
   if(observations.length>100000)throw Error('Observation limit reached')
  }
  const result=previewCommission({orders:orders.map(r=>({...r,table:'orders'})),drafts:drafts.map(r=>({...r,table:'orders_draft'})),rules,commissions,observations},from,to)
  const names=new Map(profiles.data.map(p=>[p.id,p.full_name]))
  const byCs=new Map<string,{cs_name:string;orders:number;amount:number}>()
  for(const c of result.candidates){const row=byCs.get(c.cs_id)||{cs_name:names.get(c.cs_id)||'CS tidak tersedia',orders:0,amount:0};row.orders++;row.amount+=Math.round(c.amount*100);byCs.set(c.cs_id,row)}
  return NextResponse.json({mode:'READ_ONLY_NOT_PAID_NOT_APPLIED',from,to,started_at:startedAt,read_at:new Date().toISOString(),candidate_orders:result.candidates.length,total:result.total,already_recorded_orders:result.already_recorded_orders,exceptions:result.exceptions,by_cs:[...byCs.values()].map(r=>({...r,amount:r.amount/100})),candidates:result.candidates.slice(0,500).map(({cs_id,...r})=>({...r,cs_name:names.get(cs_id)||'CS tidak tersedia'})),display_limit:500,source_consistency:'Independent paginated reads; preview only, not an atomic apply plan'}, {headers:{'Cache-Control':'no-store'}})
 }catch{return NextResponse.json({error:'Sumber komisi belum terbaca lengkap. Muat ulang; angka parsial tidak ditampilkan.'},{status:503})}
}
