import * as XLSX from 'xlsx'
import { normalizeSpxFinanceApiRows } from './spx-api'

export function cashflowDate(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(Math.round((value - 25569) * 86400000) - 7 * 3600000).toISOString()
  const s=String(value ?? '').trim()
  const m=s.match(/^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:\d{2})?$/)
  if(!m) throw new Error('Tanggal harus lengkap dengan jam; tanggal tanpa zona dibaca sebagai WIB.')
  const [,y,mo,d,h,mi,se='00',zone='+07:00']=m
  const date=new Date(Date.UTC(+y,+mo-1,+d,+h,+mi,+se))
  if(date.getUTCFullYear()!==+y || date.getUTCMonth()!==+mo-1 || date.getUTCDate()!==+d || +h>23 || +mi>59 || +se>59) throw new Error('Tanggal transaksi tidak valid.')
  const parsed=new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`)
  if(!Number.isFinite(parsed.getTime()))throw new Error('Zona waktu tidak valid.')
  return parsed.toISOString()
}
function money(v: unknown,required=false): number|null {
  if(v==null || v==='') { if(required)throw new Error('Nominal transaksi kosong.'); return null }
  if(!/^-?\d+(\.\d{1,2})?$/.test(String(v).trim()) || !Number.isFinite(Number(v)))throw new Error('Nominal harus berupa angka rupiah, tanpa pemisah ribuan.')
  return Number(v)
}
export async function readCashflowFile(file: File): Promise<Record<string,unknown>[]> {
  let rows:Record<string,unknown>[]
  if(file.name.toLowerCase().endsWith('.json')) {
    const data=JSON.parse(await file.text())
    const source=Array.isArray(data)?data:data.rows
    if(!Array.isArray(source))throw new Error('JSON harus berisi array transaksi.')
    rows=source.some(r=>r.transaction_id_str!==undefined||r.transaction_id!==undefined)
      ? normalizeSpxFinanceApiRows(source).map(r=>({...r})):source
    if(rows.length!==source.length)throw new Error('Ada transaksi tanpa ID. Preview dibatalkan.')
  } else {
    const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false})
    const sheet=book.Sheets[book.SheetNames[0]]
    if(!sheet)throw new Error('Sheet kosong.')
    const cells=Object.keys(sheet).filter(k=>/^[A-Z]+[1-9]\d*$/.test(k)).map(k=>XLSX.utils.decode_cell(k))
    if(cells.length)sheet['!ref']=XLSX.utils.encode_range({s:{r:0,c:0},e:cells.reduce((a,c)=>({r:Math.max(a.r,c.r),c:Math.max(a.c,c.c)}),{r:0,c:0})})
    const matrix=XLSX.utils.sheet_to_json<unknown[]>(sheet,{header:1,raw:true,defval:''})
    const header=(matrix.shift()??[]).map(String)
    const required=['ID Transaksi','Tipe Transaksi','Nominal Transaksi(IDR)','Waktu Pembaruan Status','Status']
    if(required.some(h=>!header.includes(h)))throw new Error('Header Account Transaction SPX tidak lengkap.')
    rows=matrix.filter(r=>r.some(v=>v!==''&&v!=null)).map(arr=>{
      const v=(name:string)=>arr[header.indexOf(name)]
      const id=v('ID Transaksi')
      if(typeof id==='number'&&!Number.isSafeInteger(id))throw new Error('ID transaksi kehilangan presisi Excel; gunakan export asli dengan ID teks.')
      return {external_id:String(id??'').trim(),tx_type:v('Tipe Transaksi'),tracking:String(v('Tracking Number')??''),
        nominal:money(v('Nominal Transaksi(IDR)'),true),update_time:cashflowDate(v('Waktu Pembaruan Status')),status:v('Status'),
        balance_before:money(v('Saldo Sebelum(IDR)')),balance_after:money(v('Saldo Sesudah(IDR)')),
        withdrawal_fee:money(v('Biaya Penarikan(IDR)')),net_received:money(v('Jumlah Transfer Bank Penarikan(IDR)')),
        reference_no:String(v('Transaction Reference No')??'')}
    })
  }
  if(rows.length<1||rows.length>10000)throw new Error('Pilih 1–10000 transaksi per file.')
  const ids=new Set<string>()
  for(const r of rows){
    if(typeof r.external_id!=='string'||!r.external_id.trim()||ids.has(r.external_id))throw new Error('ID transaksi kosong atau duplikat.')
    ids.add(r.external_id);money(r.nominal,true)
    // JSON transport retains its explicit provider timezone, including milliseconds.
    if(typeof r.update_time!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(r.update_time)||!Number.isFinite(Date.parse(r.update_time)))throw new Error('Tanggal JSON memerlukan zona waktu yang valid.')
  }
  return rows.map(({raw,...r})=>r)
}
