import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
async function main(){
const root=process.env.GRANDBOOK_P1_REVIEW
if(!root)throw Error('Explicit private review directory required')
const req=createRequire(root+'/app/package.json'),XLSX=req('xlsx')
const {buildPembukuanXlsxBlob,buildPembukuanCsvBlob}=await import(pathToFileURL(root+'/app/src/lib/orders/pembukuan-export.ts').href)
const rows=JSON.parse(fs.readFileSync(root+'/ui-ledger.json','utf8'))
const book=await buildPembukuanXlsxBlob(rows).arrayBuffer()
fs.writeFileSync(root+'/candidate-synthetic.xlsx',Buffer.from(book))
const wb=XLSX.read(Buffer.from(book),{type:'buffer',cellFormula:true}),ws=wb.Sheets.Pembukuan
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''}),headers=data[0]
const col=(name:string)=>headers.indexOf(name),cell=(name:string,row:number)=>ws[XLSX.utils.encode_cell({r:row,c:col(name)})]
assert(col('Tagihan pembeli')>=0 && col('Komisi/selisih estimasi (Est)')>=0)
assert.equal(col('Fee CS (Est)'),-1)
for(let i=0;i<rows.length;i++){
 assert.equal(cell('Tagihan pembeli',i+1).t,'n')
 assert.equal(cell('Tagihan pembeli',i+1).v,rows[i].penjualan)
 const amount=cell('Dicairkan (GrandBook)',i+1)
 if(rows[i].dicairkan===null)assert(!amount||amount.v==='')
 else {assert.equal(amount.t,'n');assert.equal(amount.v,rows[i].dicairkan)}
}
const total=rows.length+1
assert.match(cell('Dicairkan (GrandBook)',total).f,/^SUM\(/)
assert.equal(cell('Dicairkan (GrandBook)',total).v,340000)
assert.match(cell('Komisi/selisih estimasi (Est)',total).f,/^SUM\(/)
assert.equal(cell('Selisih Ongkir',total).v,'')
assert.match(cell('Selisih Ongkir',total).f,/^IF\(COUNT\(/)
assert.equal(cell('Fee Admin (Est)',total).v,'')
const mixed=rows.map((r:any,i:number)=>({...r,est_fee_admin:i===0?10:undefined}))
const mixedWs=XLSX.read(Buffer.from(await buildPembukuanXlsxBlob(mixed).arrayBuffer()),{type:'buffer',cellFormula:true}).Sheets.Pembukuan
assert.equal(mixedWs[XLSX.utils.encode_cell({r:total,c:col('Fee Admin (Est)')})].v,'','Unknown rows must not become a complete partial total')
const csv=await buildPembukuanCsvBlob(rows).text()
assert(csv.includes('Tagihan pembeli') && !csv.includes('Fee CS'))
const summary={pass:true,checks:['buyer amounts numeric and source-correct','three draft receipts and true blank nonreceipts','cash total real SUM formula and340000','commission label and SUM formula','missing detail totals conditional formula and blank cache','mixed missing detail never partial total','CSV aligned labels'],synthetic:true,rows:rows.length}
fs.writeFileSync(root+'/export-result.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary))

}
main().catch(error=>{console.error(error);process.exit(1)})
