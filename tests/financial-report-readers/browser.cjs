/* Isolated UI fixture test. No successful business response comes from production. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module')
const root=process.env.GRANDBOOK_P1_REVIEW,base=process.env.GRANDBOOK_P1_BASE,sessionPath=process.env.GRANDBOOK_P1_SESSION
if(!root||!base||new URL(base).hostname!=='127.0.0.1'||!sessionPath)throw Error('Explicit loopback URL, private review and session paths required')
const {chromium}=createRequire(root+'/app/package.json')('playwright')
const rows=JSON.parse(fs.readFileSync(root+'/ui-ledger.json')),pnl=JSON.parse(fs.readFileSync(root+'/ui-pnl.json'))
const session=JSON.parse(fs.readFileSync(sessionPath)).session
assert(session.expires_at*1000>Date.now(),'Normal middleware session must be current')
const currency=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(n)
const compact=s=>s.replace(/\s+/g,'')
const checks=[],unexpected=[],errors=[]
let browser,page,mode='normal'
function pass(s){checks.push(s);console.log('PASS '+s)}
;(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'})
 const ctx=await browser.newContext({timezoneId:'Asia/Jakarta',viewport:{width:1440,height:1100},colorScheme:'light',acceptDownloads:true})
 const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3500}/g)
 await ctx.addCookies(chunks.map((value,i)=>({name:'sb-ubksitifaprqofujhova-auth-token'+(chunks.length>1?'.'+i:''),value,domain:'127.0.0.1',path:'/',secure:false})))
 await ctx.addInitScript(()=>localStorage.setItem('theme','light'))
 await ctx.route('**/*',async route=>{
  const r=route.request(),url=new URL(r.url()),endpoint=url.pathname.split('/').pop()
  if(url.origin===new URL(base).origin)return route.continue()
  if(url.pathname==='/auth/v1/user')return route.fulfill({json:session.user})
  if(url.pathname.startsWith('/rest/v1/')){
   if(endpoint==='profiles'&&r.method()==='GET')return route.fulfill({json:{id:session.user.id,organization_id:1,active:true,role:'owner',full_name:'Owner Contoh'}})
   if(endpoint==='notifications')return route.fulfill({json:[]})
   if(endpoint==='get_sidebar_counts')return route.fulfill({json:[]})
   if(['list_pembukuan','laba_rugi_summary'].includes(endpoint)&&r.method()==='POST'){
    const b=r.postDataJSON()||{}
    if(mode==='error')return route.fulfill({status:500,json:{code:'57014',message:'Synthetic read unavailable'}})
    if(endpoint==='laba_rugi_summary'){
     const inPeriod=(!b.p_from||b.p_from<='2099-10-23')&&(!b.p_to||b.p_to>='2099-10-23')
     return route.fulfill({json:inPeriod?[pnl]:[]})
    }
    const selected=rows.filter(row=>(!b.p_from||row.order_date>=b.p_from)&&(!b.p_to||row.order_date<=b.p_to)&&(!b.p_status||row.status===b.p_status)&&(!b.p_search||row.order_number.includes(b.p_search)))
    return route.fulfill({json:selected.slice(b.p_offset||0,(b.p_offset||0)+(b.p_limit||500)).map(row=>({...row,total_count:selected.length}))})
   }
  }
  unexpected.push({endpoint,method:r.method()});return route.abort()
 })
 page=await ctx.newPage();page.setDefaultTimeout(45000);page.on('pageerror',e=>errors.push(e.message))
 async function period(){
  await page.getByRole('button').filter({has:page.locator('svg.lucide-calendar')}).first().click()
  await page.getByLabel('Dari tanggal',{exact:true}).fill('2099-10-23')
  await page.getByLabel('Sampai tanggal',{exact:true}).fill('2099-10-23')
  await page.getByRole('button',{name:'Terapkan',exact:true}).click()
 }
 await page.goto(base+'/orders/pembukuan',{timeout:120000})
 await page.getByRole('button',{name:'Keuangan',exact:true}).waitFor()
 await period();await page.getByText('GB-20991023-P1-MATCH',{exact:true}).waitFor()
 await page.getByRole('button',{name:'Keuangan',exact:true}).click()
 await page.getByRole('columnheader',{name:'Tagihan pembeli',exact:true}).waitFor()
 const headers=await page.getByRole('columnheader').allTextContents(),cashIndex=headers.indexOf('Dicairkan'),buyerIndex=headers.indexOf('Tagihan pembeli')
 assert(cashIndex>=0&&buyerIndex>=0)
 assert.equal(await page.getByRole('columnheader',{name:'Fee CS',exact:true}).count(),0)
 for(const r of rows){
  const line=page.getByRole('row').filter({has:page.getByText(r.order_number,{exact:true})})
  assert.equal(compact(await line.locator('td').nth(buyerIndex).innerText()),compact(currency(r.penjualan)))
  assert.equal(compact(await line.locator('td').nth(cashIndex).innerText()),r.dicairkan===null?'—':compact(currency(r.dicairkan)))
 }
 pass('Buku: source-proven buyer amounts and three draft receipts; nonreceipts remain unknown')
 await page.getByRole('columnheader',{name:'Dicairkan',exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:root+'/candidate-book.png',fullPage:true})
 for(const width of[1440,390,320]){
  await page.setViewportSize({width,height:1100})
  const m=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}))
  assert(m.pageWidth<=m.width+1,'Buku page overflow '+JSON.stringify(m))
 }
 pass('Buku contained at1440/390/320')
 await page.setViewportSize({width:1440,height:1100})
 const download=page.waitForEvent('download')
 await page.getByRole('button',{name:'Export Excel',exact:true}).click()
 await(await download).saveAs(root+'/browser-export.xlsx')
 pass('Buku actual Excel download succeeds')
 await page.goto(base+'/laba-rugi',{timeout:120000})
 await page.getByRole('heading',{name:'Laporan Laba Rugi',exact:true}).waitFor()
 await period()
 await page.getByText('Laba setelah biaya tercatat · Proyeksi',{exact:true}).waitFor()
 await page.getByRole('cell',{name:'Komisi/selisih estimasi'}).waitFor()
 const gpRow=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Gross Profit',exact:true})})
 assert(compact(await gpRow.innerText()).includes(compact(currency(pnl.est_gross_profit))))
 assert.equal(await page.getByRole('cell',{name:'(−) Fee CS',exact:true}).count(),0)
 pass('P&L truthful all-role/residual label and stored GP preserved')
 await page.screenshot({path:root+'/candidate-pnl.png',fullPage:true})
 for(const width of[1440,390,320]){
  await page.setViewportSize({width,height:1100})
  const m=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}))
  assert(m.pageWidth<=m.width+1,'P&L page overflow '+JSON.stringify(m))
 }
 await page.screenshot({path:root+'/candidate-pnl-mobile.png',fullPage:true})
 pass('P&L contained at1440/390/320')
 mode='error';await page.getByRole('button',{name:'Muat ulang Laba Rugi'}).click()
 await page.getByText('Laporan belum berhasil dimuat',{exact:true}).waitFor()
 assert.equal(await page.getByRole('cell',{name:'Gross Profit',exact:true}).count(),0)
 mode='normal';await page.getByRole('button',{name:'Coba lagi',exact:true}).click()
 await page.getByRole('cell',{name:'Gross Profit',exact:true}).waitFor()
 pass('P&L failure/retry preserves unavailable state')
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[])
 fs.writeFileSync(root+'/browser-result.json',JSON.stringify({pass:true,environment:'isolated loopback built app, synthetic SQL fixtures',checks,errors,unexpected,noBusinessWrites:true},null,2))
 await browser.close()
})().catch(async error=>{
 fs.writeFileSync(root+'/browser-failure.private.json',JSON.stringify({error:error.message,checks,errors,unexpected},null,2))
 if(page)await page.screenshot({path:root+'/browser-failure.png',fullPage:true}).catch(()=>{})
 if(browser)await browser.close()
 console.error(error.stack);process.exit(1)
})
