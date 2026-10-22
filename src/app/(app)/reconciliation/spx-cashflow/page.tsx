'use client'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useAuth } from '@/components/providers/auth-provider'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { formatRupiah } from '@/lib/format'
import { CashflowHistory } from './_components/cashflow-history'
import { readCashflowFile } from '@/lib/recon/spx-cashflow-input'
const sb=createClient()
type Row={external_id:string;classification:string;source:{nominal:number;tracking:string;tx_type:string;update_time:string}}
type Plan={review_id:string;total_rows:number;contract:number;rows:Row[]}
const eligible=new Set(['cod_final','cod_draft_ledger','withdrawal'])
const labels:Record<string,string>={cod_final:'COD order final',cod_draft_ledger:'COD draft — catatan terpisah',withdrawal:'Penarikan SPX',duplicate:'Sudah dicatat',review_shipping:'Ongkir — perlu review',review_adjustment:'Penyesuaian — perlu review',unmatched:'Order belum ditemukan',ambiguous:'Identitas order bertabrakan',review_existing_settlement:'Pencairan lama perlu review',review_payment_method:'Metode pembayaran perlu review',review_withdrawal_amount:'Nominal penarikan perlu review',review_status:'Status belum terverifikasi',conflicting_transaction:'ID transaksi berbeda isi',review_type_or_amount:'Jenis/nominal perlu review',review_existing_withdrawal:'Penarikan sudah ada'}
export default function Page(){
 const {role}=useAuth();const allowed=['owner','admin','akunting'].includes(role??'')
 const [plan,setPlan]=useState<Plan|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[page,setPage]=useState(0),[filter,setFilter]=useState('all'),[history,setHistory]=useState<{id:string;created_at:string}[]>([])
 const lock=useRef(false)
 async function historyLoad(){const r=await sb.from('spx_cashflow_reviews').select('id,created_at').order('created_at',{ascending:false}).limit(20);if(!r.error)setHistory(r.data)}
 useEffect(()=>{const timer=window.setTimeout(()=>{if(allowed)void historyLoad()},0);return()=>window.clearTimeout(timer)},[allowed])
 function accept(p:Plan){if(p.contract!==2||p.total_rows!==p.rows?.length)throw Error('Preview tidak lengkap.');setPlan(p);setSelected(new Set());setPage(0);setFilter('all')}
 async function upload(f?:File){if(!f||lock.current)return;lock.current=true;setBusy(true);setMessage('');setPlan(null);setSelected(new Set());setPage(0);try{const rows=await readCashflowFile(f);const r=await sb.rpc('preview_spx_cashflow_v2',{p_request_id:crypto.randomUUID(),p_rows:rows});if(r.error)throw r.error;accept(r.data);await historyLoad()}catch(e){setMessage(e instanceof Error?e.message:String((e as {message?:string}).message??e))}finally{lock.current=false;setBusy(false)}}
 async function resume(id:string){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');setSelected(new Set());try{const r=await sb.from('spx_cashflow_reviews').select('plan').eq('id',id).single();if(r.error)throw r.error;accept(r.data.plan)}catch(e){setMessage(String((e as {message?:string}).message??e))}finally{lock.current=false;setBusy(false)}}
 async function apply(){if(!plan||!selected.size||lock.current)return
 const rows=plan.rows.filter(r=>selected.has(r.external_id))
 if(!confirm(`Catat ${rows.length} transaksi terpilih? COD final memperbarui pencairan order. COD draft hanya dicatat pada ledger terpisah. Komisi CS tidak dibayar oleh tindakan ini. Penarikan SPX bukan verifikasi mutasi bank.`))return
 lock.current=true;setBusy(true);let done=0
 try{for(let i=0;i<rows.length;i+=150){const chunk=rows.slice(i,i+150);const r=await sb.rpc('apply_spx_cashflow_v2',{p_review_id:plan.review_id,p_external_ids:chunk.map(r=>r.external_id)});if(r.error)throw r.error;if(r.data.recorded+r.data.replayed!==chunk.length)throw Error('Konfirmasi server tidak lengkap. Ulangi ID yang sama.');done+=chunk.length}setMessage(`${done} transaksi terkonfirmasi. Komisi CS tetap terpisah. Transaksi lain masih menunggu review.`)}catch(e){setMessage(`${done} transaksi pada batch sebelumnya terkonfirmasi; batch yang gagal dibatalkan. ${String((e as {message?:string}).message??e)} Retry memakai pilihan yang sama; bila order berubah, buat preview baru.`)}finally{lock.current=false;setBusy(false)}}
 if(!allowed)return <p>Akses pencairan untuk owner, admin, atau akunting aktif.</p>
 const counts:Record<string,number>={};for(const r of plan?.rows??[])counts[r.classification]=(counts[r.classification]??0)+1
 const visible=(plan?.rows??[]).filter(r=>filter==='all'||r.classification===filter)
 return <div className="space-y-5"><PageHeader title="Review Pencairan SPX" description="Periksa setiap transaksi sebelum mencatat pencairan. Ongkir, penyesuaian dan konflik tetap menunggu review."/>
 <div className="rounded border p-4 space-y-3"><label htmlFor="cashflow-file">Account Transaction SPX (.xlsx) atau transaksi JSON</label><input id="cashflow-file" type="file" accept=".xlsx,.json" disabled={busy} onChange={e=>{void upload(e.target.files?.[0]);e.target.value=''}}/>
 <p className="text-sm">Tanggal Excel dibaca sebagai WIB. COD draft disimpan sebagai catatan pencairan terpisah; draft tetap di antrian dan pencairannya masuk laporan tanpa dihitung ulang saat menjadi order final.</p>
 {busy&&<p role="status">Memproses…</p>}{message&&<p role="status" className="whitespace-pre-wrap">{message}</p>}</div>
 {plan&&<><p>{plan.total_rows} transaksi dalam preview; {selected.size} dipilih. Tidak ada transaksi dipilih otomatis.</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={()=>{setFilter('all');setPage(0)}}>Semua</Button>{Object.entries(counts).map(([k,n])=><Button key={k} variant="outline" onClick={()=>{setFilter(k);setPage(0)}}>{labels[k]??k}: {n}</Button>)}</div>
 <div className="flex flex-wrap gap-3"><Button disabled={busy} variant="outline" onClick={()=>setSelected(new Set(visible.filter(r=>eligible.has(r.classification)).map(r=>r.external_id)))}>Pilih yang siap pada filter ini</Button><Button disabled={busy} variant="outline" onClick={()=>setSelected(new Set())}>Kosongkan pilihan</Button><Button disabled={busy||!selected.size} onClick={()=>void apply()}>Catat transaksi terpilih ({selected.size})</Button></div>
 <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{['Pilih','ID transaksi','Jenis','Resi','Nominal','Hasil review'].map(h=><th className="p-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>{visible.slice(page*50,page*50+50).map(r=><tr key={r.external_id} className="border-t"><td className="p-2"><input type="checkbox" aria-label={`Pilih ${r.external_id}`} disabled={busy||!eligible.has(r.classification)} checked={selected.has(r.external_id)} onChange={e=>setSelected(old=>{const next=new Set(old);if(e.target.checked)next.add(r.external_id);else next.delete(r.external_id);return next})}/></td><td className="p-2">{r.external_id}</td><td className="p-2">{r.source.tx_type}</td><td className="p-2">{r.source.tracking||'—'}</td><td className="p-2">{formatRupiah(r.source.nominal)}</td><td className="p-2">{labels[r.classification]??r.classification}</td></tr>)}</tbody></table></div>
 <div className="flex gap-3"><Button variant="outline" disabled={page===0} onClick={()=>setPage(page-1)}>Sebelumnya</Button><span>Halaman {page+1} / {Math.max(1,Math.ceil(visible.length/50))}</span><Button variant="outline" disabled={(page+1)*50>=visible.length} onClick={()=>setPage(page+1)}>Berikutnya</Button></div></>}
 <section className="rounded border p-4"><h2>Preview tersimpan</h2><p className="text-sm">Membuka preview lama tidak mengabaikan pemeriksaan perubahan data saat Apply.</p>{history.map(h=><Button key={h.id} disabled={busy} variant="ghost" onClick={()=>void resume(h.id)}>{new Date(h.created_at).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})} WIB</Button>)}</section>
 <section><h2>Riwayat impor sebelumnya</h2><CashflowHistory /></section>
 </div>
}
