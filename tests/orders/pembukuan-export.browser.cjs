/* Loopback built-app test. Business responses synthetic; never writes live data. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module')
const root=process.env.GRANDBOOK_EXPORT_REVIEW,base=process.env.GRANDBOOK_EXPORT_BASE,sessionPath=process.env.GRANDBOOK_EXPORT_SESSION
if(!root||!base||new URL(base).hostname!=='127.0.0.1'||!sessionPath)throw Error('Explicit private review, loopback URL and normal session required')
const req=createRequire(root+'/app/package.json'),{chromium}=req('playwright'),XLSX=req('xlsx')
const session=JSON.parse(fs.readFileSync(sessionPath)).session
assert(session.expires_at*1000>Date.now(),'Normal middleware session must be current')
const rows=Array.from({length:2454},(_,i)=>({
 source:i%2?'draft':'final',id:Math.floor(i/2)+1,order_number:`SYNTH-${String(i).padStart(4,'0')}`,
 order_date:i<2407?'2099-10-23':i<2437?'2099-10-24':'2099-10-22',
 status:i>=2100&&i<2407?'PROBLEM':i%2?'BARU':'DITERIMA',zone:i>=2100&&i<2407?'Problem':i%2?'Antrian':'Arsip (Delivered)',
 customer_name:'Contoh',customer_city:null,cs_name:null,channel_name:null,product_summary:'Produk',
 attribution_code_raw:'Produk.Facebook.Akun.Campaign',campaign_name:'Campaign',campaign_platform:'Facebook',
 total:123456.78,penjualan:123456.78,ongkir:10000,actual_shipping_fee:null,cod_amount:null,tracking_no:'001234567890',resi:null,
 delivered_at:null,returned_at:null,exported_at:null,payment_method:'COD',qty:1,
 est_omset:100000.25,est_hpp:30000.5,est_fee_cs:2500,est_gross_profit:67500.25,
 act_omset:null,act_hpp:null,act_fee_cs:null,act_gross_profit:null,dicairkan:i===0?0:null,cod_settled_at:null,
}))
let browser,page,mode='normal',downloads=0
const checks=[],unexpected=[],errors=[],exportCalls=[]
const pass=s=>{checks.push(s);console.log('PASS '+s)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
;(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'})
 const ctx=await browser.newContext({timezoneId:'Asia/Jakarta',viewport:{width:1440,height:1100},colorScheme:'light',acceptDownloads:true})
 const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3500}/g)
 await ctx.addCookies(chunks.map((value,i)=>({name:'sb-ubksitifaprqofujhova-auth-token'+(chunks.length>1?'.'+i:''),value,domain:'127.0.0.1',path:'/',secure:false})))
 await ctx.addInitScript(()=>localStorage.setItem('theme','light'))
 await ctx.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url()),endpoint=u.pathname.split('/').pop()
  if(u.origin===new URL(base).origin)return route.continue()
  if(u.pathname==='/auth/v1/user')return route.fulfill({json:session.user})
  if(u.pathname.startsWith('/rest/v1/')){
   if(endpoint==='profiles'&&r.method()==='GET')return route.fulfill({json:{id:session.user.id,organization_id:1,active:true,role:'owner',full_name:'Owner Contoh'}})
   if(['notifications','get_sidebar_counts'].includes(endpoint))return route.fulfill({json:[]})
   if(endpoint==='list_pembukuan'&&r.method()==='POST'){
    const b=r.postDataJSON(),exportRead=b.p_limit===null,offset=exportRead?Number(u.searchParams.get('offset')):b.p_offset||0,limit=exportRead?Number(u.searchParams.get('limit')):b.p_limit||500
    if(exportRead){exportCalls.push({...b,p_offset:offset});assert.equal(u.searchParams.get('order'),'order_date.desc.nullslast,id.desc,source.asc')}
    if(exportRead&&offset>0&&mode==='error')return route.fulfill({status:500,json:{code:'57014',message:'Synthetic read unavailable'}})
    if(exportRead&&mode==='slow')await delay(700)
    if(r.failure())return route.abort()
    const filtered=rows.filter(row=>(!b.p_from||row.order_date>=b.p_from)&&(!b.p_to||row.order_date<=b.p_to)&&(!b.p_status||row.status===b.p_status)&&(!b.p_search||row.order_number.includes(b.p_search)))
    return route.fulfill({json:filtered.slice(offset,offset+limit).map(row=>({...row,total_count:mode==='drift'&&exportRead&&offset>0?filtered.length+1:filtered.length}))}).catch(()=>{})
   }
  }
  unexpected.push({endpoint,method:r.method()});return route.abort()
 })
 page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('download',()=>downloads++)
 const ready=()=>page.getByRole('button',{name:'Export Excel',exact:true}).isEnabled()
 async function waitReady(){await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Export Excel'));return b&&!b.disabled})}
 async function period(from,to){
  await page.getByRole('button').filter({has:page.locator('svg.lucide-calendar')}).first().click()
  await page.getByLabel('Dari tanggal',{exact:true}).fill(from)
  await page.getByLabel('Sampai tanggal',{exact:true}).fill(to)
  const read=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/list_pembukuan'&&r.request().postDataJSON().p_from===from&&r.request().postDataJSON().p_to===to)
  await page.getByRole('button',{name:'Terapkan',exact:true}).click();await read;await waitReady()
 }
 async function download(name,format='xlsx'){
  const d=page.waitForEvent('download');await page.getByRole('button',{name:format==='xlsx'?'Export Excel':'CSV',exact:true}).click()
  const event=await d;await event.saveAs(root+'/'+name+'.'+format);await waitReady()
  if(format==='csv')return fs.readFileSync(root+'/'+name+'.csv','utf8')
  const wb=XLSX.readFile(root+'/'+name+'.xlsx',{cellFormula:true}),ws=wb.Sheets.Pembukuan
  return {ws,values:XLSX.utils.sheet_to_json(ws,{header:1,defval:''}),filename:event.suggestedFilename()}
 }
 await page.goto(base+'/orders/pembukuan',{timeout:120000})
 await page.getByRole('button',{name:'Keuangan',exact:true}).waitFor();await period('2099-10-23','2099-10-23')
 let file=await download('all-period')
 assert.equal(file.values.length,2409);assert(file.filename.includes('2099-10-23_2099-10-23'))
 assert.equal(file.ws.Q2409.f,'SUM(Q2:Q2408)');assert.equal(file.ws.Q1002.t,'n');assert.equal(file.ws.Q1002.v,123456.78)
 assert.equal(file.ws.I1002.v,'Produk.Facebook.Akun.Campaign');assert.equal(file.ws.P1002.v,'001234567890')
 assert(exportCalls.some(b=>b.p_offset>1000)&&exportCalls.every(b=>b.p_from==='2099-10-23'&&b.p_to==='2099-10-23'))
 pass('actual download:2407 period-matched rows, numeric decimals, attribution, leading-zero resi and real TOTAL formulas')
 await page.getByRole('checkbox',{name:'Pilih SYNTH-0000 (final)',exact:true}).check()
 await page.getByRole('checkbox',{name:'Pilih SYNTH-0001 (draft)',exact:true}).check()
 await page.getByRole('button',{name:'Berikutnya ›',exact:true}).click()
 await page.getByRole('checkbox',{name:'Pilih SYNTH-0050 (final)',exact:true}).check()
 rows[50].penjualan=76543.21
 await page.getByLabel('Cakupan ekspor',{exact:true}).selectOption('selected')
 file=await download('selected')
 assert.equal(file.values.length,5);assert.deepEqual(file.values.slice(1,4).map(r=>r[1]),['SYNTH-0000','SYNTH-0001','SYNTH-0050'])
 assert.equal(file.values[3][16],76543.21);assert.equal(file.ws.Q5.f,'SUM(Q2:Q4)')
 pass('cross-page selection:3 exact compound identities, fresh financial values and scoped TOTAL range')
 await page.getByRole('button',{name:'Hapus pilihan',exact:true}).click()
 assert.equal(await ready(),false)
 await page.getByLabel('Cakupan ekspor',{exact:true}).selectOption('filtered');await waitReady()
 await page.getByRole('button',{name:'‹ Sebelumnya',exact:true}).click()
 await page.getByRole('checkbox',{name:'Pilih semua baris halaman ini',exact:true}).check()
 await page.getByText('50 order dipilih lintas halaman.',{exact:false}).waitFor()
 await page.getByRole('checkbox',{name:'Pilih semua baris halaman ini',exact:true}).uncheck()
 pass('select/deselect current page and clear selection controls')
 await page.getByRole('button',{name:'Problem · 0',exact:true}).click()
 file=await download('zone')
 assert.equal(file.values.length,309);assert(file.values.slice(1,-1).every(r=>r[4]==='Problem'))
 assert.equal(await page.getByRole('button',{name:'Berikutnya ›',exact:true}).isEnabled(),true)
 pass('zone filter exports all307 matches beyond loaded page; pagination remains available on empty zone page')
 await page.getByRole('button',{name:/^Semua ·/}).click()
 await page.getByRole('checkbox',{name:'Pilih SYNTH-0000 (final)',exact:true}).check()
 const search=page.getByRole('textbox',{name:'Cari nomor order atau pelanggan',exact:true})
 await search.fill('SYNTH-1');await waitReady()
 file=await download('search');assert.equal(file.values.length,1002);assert(file.values.slice(1,-1).every(r=>r[1].includes('SYNTH-1')))
 await search.fill('');await waitReady()
 assert.equal(await page.getByRole('checkbox',{name:'Pilih SYNTH-0000 (final)',exact:true}).isChecked(),false)
 pass('search exports1000 matching rows and filter changes permanently reset old selection')
 await page.getByRole('combobox',{name:'Filter status order',exact:true}).click();await page.getByRole('option',{name:'DITERIMA',exact:true}).click();await waitReady()
 file=await download('status');assert.equal(file.values.length,1052);assert(file.values.slice(1,-1).every(r=>r[3]==='DITERIMA'))
 pass('status filter exports1050 matches across all pages')
 await page.getByRole('combobox',{name:'Filter status order',exact:true}).click();await page.getByRole('option',{name:'Semua status',exact:true}).click();await waitReady()
 await period('2099-10-24','2099-10-24');file=await download('other-period');assert.equal(file.values.length,32)
 await page.getByRole('button',{name:'Semua',exact:true}).click();await waitReady()
 const csv=await download('all-time','csv');assert.equal(csv.split('\n').filter(Boolean).length,2456)
 pass('different date range and all-time CSV honor scope,2454 total rows')
 for(const failure of ['error','drift']){
  mode=failure;const before=downloads
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/list_pembukuan'&&Number(new URL(r.url()).searchParams.get('offset'))>0&&r.request().postDataJSON().p_limit===null)
  await page.getByRole('button',{name:'Export Excel',exact:true}).click()
  await response;await page.getByText('Gagal ekspor — file tidak diunduh',{exact:true}).first().waitFor();await waitReady()
  assert.equal(downloads,before)
  // Sonner pauses toast expiry while the pointer is over its top-right stack.
  await page.mouse.move(5,1000)
  await page.getByText('Gagal ekspor — file tidak diunduh',{exact:true}).first().waitFor({state:'hidden',timeout:15000})
 }
 pass('mid-export network error and count drift never download partial workbooks')
 mode='slow';const before=downloads
 await page.getByRole('button',{name:'Export Excel',exact:true}).click()
 await page.getByRole('button',{name:'Batalkan ekspor',exact:true}).click();await waitReady();await delay(800)
 assert.equal(downloads,before);mode='normal'
 pass('cancel interrupts export without file and allows retry')
 file=await download('retry');assert.equal(file.values.length,2456)
 await page.getByRole('button',{name:'Keuangan',exact:true}).click();await waitReady()
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1100})
  const m=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}))
  assert(m.pageWidth<=m.width+1,'Overflow '+JSON.stringify(m))
  await page.screenshot({path:root+`/export-${width}.png`,fullPage:true})
 }
 pass('retry succeeds; Ringkas/Keuangan and export controls remain contained at1440/390/320')
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[])
 fs.writeFileSync(root+'/browser-result.json',JSON.stringify({pass:true,checks,downloads,errors,unexpected,businessWrites:0,environment:'built isolated loopback app; synthetic business responses'},null,2))
 await browser.close()
})().catch(async e=>{
 if(page)await page.screenshot({path:root+'/browser-failure.png',fullPage:true}).catch(()=>{})
 fs.writeFileSync(root+'/browser-failure.private.json',JSON.stringify({error:e.message,checks,errors,unexpected},null,2))
 if(browser)await browser.close();console.error(e.stack);process.exit(1)
})
