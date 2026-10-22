'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatRupiah } from '@/lib/format'
type Report={candidate_orders:number;total:number;already_recorded_orders:number;exceptions:Record<string,number>;by_cs:Array<{cs_name:string;orders:number;amount:number}>;candidates:Array<{ref:string;cs_name:string;amount:number;table:string}>;display_limit:number;read_at:string}
const reasons:Record<string,string>={missing_cs:'CS belum ditentukan',missing_or_ambiguous_observation:'Bukti SPX belum lengkap',ambiguous_gb_identity:'Identitas GB perlu ditinjau',existing_commission_needs_review:'Komisi lama perlu ditinjau',unverified_delivery_identity:'Identitas pengiriman belum terverifikasi',product_specific_rule_requires_review:'Aturan produk perlu ditinjau',missing_rate:'Tarif belum tersedia',ambiguous_rate:'Aturan tarif bertumpuk',non_flat_rule_requires_review:'Aturan bukan nominal per order'}
export default function Page(){
 const [today]=useState(()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10))
 const [from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today),[data,setData]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('')
 async function load(){setLoading(true);setError('');setData(null);try{const r=await fetch(`/api/commissions/spx-preview?from=${from}&to=${to}`,{cache:'no-store'});const body=await r.json();if(!r.ok)throw Error(body.error||'Gagal memuat');setData(body)}catch(e){setError(e instanceof Error?e.message:'Gagal memuat')}finally{setLoading(false)}}
 return <div className="space-y-4"><h1 className="text-2xl font-semibold">Komisi CS — Delivered SPX</h1>
 <p>Preview tambahan komisi, termasuk draft. Satu order dihitung sekali. Komisi yang sudah tercatat tidak ditambahkan lagi. Ini belum pencatatan atau pembayaran komisi.</p>
 <p className="text-sm text-muted-foreground">Tarif mengikuti aturan yang berlaku pada tanggal order. Bukti SPX, identitas resi, dan CS harus cocok. Data belum lengkap dipisahkan untuk ditinjau.</p>
 <Link className="underline" href="/settings/commission-rules">Lihat / edit aturan komisi</Link>
 <div className="flex flex-wrap gap-3 items-end"><label>Dari tanggal order<Input type="date" value={from} disabled={loading} onChange={e=>{setFrom(e.target.value);setData(null)}} /></label><label>Sampai tanggal order<Input type="date" value={to} disabled={loading} onChange={e=>{setTo(e.target.value);setData(null)}} /></label><Button disabled={loading||!from||!to||from>to} onClick={()=>void load()}>{loading?'Memeriksa sumber…':'Hitung preview'}</Button></div>
 {error&&<p role="alert" className="text-red-600">{error}</p>}
 {data&&<><div className="rounded border p-4"><h2 className="font-semibold">Tambahan terverifikasi: {formatRupiah(data.total)}</h2><p>{data.candidate_orders} order · {data.already_recorded_orders} order sudah memiliki komisi</p><p className="text-sm">Belum dibayar atau dicatat ke ledger. Pembacaan sumber: {data.read_at}.</p></div>
 <table className="w-full text-sm"><caption className="text-left font-semibold">Ringkasan per CS</caption><thead><tr><th className="text-left">CS</th><th>Order</th><th>Komisi</th></tr></thead><tbody>{data.by_cs.map((r,i)=><tr key={i}><td>{r.cs_name}</td><td className="text-center">{r.orders}</td><td className="text-center">{formatRupiah(r.amount)}</td></tr>)}</tbody></table>
 <div><h2 className="font-semibold">Perlu ditinjau</h2>{Object.entries(data.exceptions).map(([reason,count])=><p key={reason}>{reasons[reason]||reason}: {count} order</p>)}{!Object.keys(data.exceptions).length&&<p>Tidak ada pengecualian pada sumber yang terbaca.</p>}</div>
 <table className="w-full text-sm"><caption className="text-left">Detail maksimal {data.display_limit} order; total di atas mencakup seluruh hasil.</caption><thead><tr><th>GB</th><th>CS</th><th>Komisi</th></tr></thead><tbody>{data.candidates.map(r=><tr key={r.ref}><td>{r.ref}</td><td>{r.cs_name}</td><td>{formatRupiah(r.amount)}</td></tr>)}</tbody></table></>}
 </div>
}
