import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { serverEnvironmentResponse } from '@/lib/server/environment-guard'
import { normalizeSpxFinanceApiRows,toUnixStartOfDay,toUnixEndOfDay } from '@/lib/recon/spx-api'
export async function POST(request:Request){
 const environment=serverEnvironmentResponse('POST','/api/reconciliation/spx-cashflow/sync');if(environment)return environment
 const sb=await createClient();const user=await sb.auth.getUser();if(!user.data.user)return NextResponse.json({error:'Unauthorized'},{status:401})
 const profile=await sb.from('profiles').select('role,active,organization_id').eq('id',user.data.user.id).single()
 if(!profile.data?.active||!profile.data.organization_id||!['owner','admin','akunting'].includes(profile.data.role))return NextResponse.json({error:'Akses pencairan ditolak'},{status:403})
 const body=await request.json().catch(()=>null)
 const from=body?.from,to=body?.to??from
 if(typeof from!=='string'||typeof to!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return NextResponse.json({error:'Tanggal WIB tidak valid'},{status:400})
 const start=toUnixStartOfDay(from),end=toUnixEndOfDay(to)
 if(!Number.isFinite(start)||!Number.isFinite(end)||new Date(start*1000+25200000).toISOString().slice(0,10)!==from||new Date((end+1)*1000+25200000-1).toISOString().slice(0,10)!==to||end<start||end-start>=32*86400)return NextResponse.json({error:'Gunakan rentang valid maksimal satu bulan'},{status:400})
 const cookie=body.spxCookie||process.env.SPX_ADMIN_COOKIE,account=body.bizAccountId||process.env.SPX_BIZ_ACCOUNT_ID
 if(typeof cookie!=='string'||!cookie||/[\r\n]/.test(cookie)||!/^\d+$/.test(String(account??'')))return NextResponse.json({error:'Sesi dan akun SPX belum tersedia'},{status:400})
 const query={business_entity:4,product_line:7,biz_account_id:String(account),tran_time_start:start,tran_time_end:Math.min(end,Math.floor(Date.now()/1000))}
 if(query.tran_time_end<start)return NextResponse.json({error:'Periode masih di masa depan'},{status:400})
 const base='https://spx.co.id/shipment/forward/account/api/spx_seller/seller_balance/'
 const raw:Record<string,unknown>[]=[],ids=new Set<string>();let total:number|null=null
 try{
  for(let offset=0;offset<10000;offset+=100){
   const response=await fetch(base+'transaction_list',{method:'POST',headers:{cookie,'Content-Type':'application/json',accept:'application/json',Origin:'https://spx.co.id',Referer:'https://spx.co.id/spx-admin/finance/my-seller-balance'},body:JSON.stringify({...query,offset,size:100}),cache:'no-store',signal:AbortSignal.timeout(30000)})
   if(!response.ok)throw Error('SPX menolak pembacaan; periksa sesi dan coba lagi.')
   const payload=await response.json();const data=payload?.data
   if(payload?.retcode!==0||!Array.isArray(data?.list)||!Number.isSafeInteger(data.total)||data.total<0||data.total>10000)throw Error('Sumber SPX tidak lengkap atau melebihi batas; persempit periode.')
   if(total!==null&&data.total!==total)throw Error('Jumlah transaksi berubah selama pembacaan; ulangi preview.')
   total=Number(data.total)
   for(const row of data.list){if(typeof row.transaction_id_str!=='string'||!row.transaction_id_str||ids.has(row.transaction_id_str)||!Number.isInteger(row.tran_time)||row.tran_time<query.tran_time_start||row.tran_time>query.tran_time_end)throw Error('Identitas atau periode transaksi SPX tidak konsisten.');ids.add(row.transaction_id_str);raw.push(row)}
   if(raw.length===total)break
   if(!data.list.length||raw.length>total)throw Error('Halaman transaksi tidak lengkap.')
  }
  if(raw.length!==total||!raw.length)throw Error('Tidak ada sumber lengkap untuk preview.')
  const rows=normalizeSpxFinanceApiRows(raw).map(({raw:_raw,...r})=>r)
  if(rows.length!==raw.length)throw Error('Parser tidak mempertahankan semua transaksi.')
  const {data,error}=await sb.rpc('preview_spx_cashflow_v2',{p_request_id:crypto.randomUUID(),p_rows:rows})
  if(error)return NextResponse.json({error:error.message},{status:400})
  return NextResponse.json({ok:true,source:'spx_api',pulled_rows:raw.length,source_cutoff:query.tran_time_end,preview:data})
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Pembacaan SPX gagal; tidak ada preview diterapkan.'},{status:502})}
}
