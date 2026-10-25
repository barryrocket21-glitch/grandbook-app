/* Built isolated loopback app. Every business response is synthetic; writes rejected. */
const fs=require('node:fs'),assert=require('node:assert/strict'),{createRequire}=require('node:module')
const root=process.env.GRANDBOOK_ADS_REVIEW,base=process.env.GRANDBOOK_ADS_BASE,sessionPath=process.env.GRANDBOOK_ADS_SESSION
if(!root||!base||new URL(base).hostname!=='127.0.0.1'||!sessionPath)throw Error('Explicit private review, loopback URL and normal session required')
const req=createRequire(root+'/app/package.json'),{chromium}=req('playwright')
const session=JSON.parse(fs.readFileSync(sessionPath)).session
assert(session.expires_at*1000>Date.now(),'Normal middleware session must be current')
const rows=Array.from({length:2437},(_,i)=>({id:i+1,campaign_id:i<1207?1:2,
 spend_date:i<2407?'2099-09-01':'2099-10-01',created_at:'2099-09-01T00:00:00Z',
 campaign:{id:i<1207?1:2,campaign_name:`Contoh-${i+1}`,platform:i<1207?'META':'GOOGLE',campaign_code:'Produk.Platform.Akun.Campaign'},
 source:i%3?'CSV_IMPORT':'MANUAL',spend:100000.25,spend_total:i%2?null:112000.28,ppn_rate:i%2?0:12,
 ppn_amount:i%2?0:12000.03,meta_lead_count:2,impressions:10,clicks:1,
}))
const nf=n=>new Intl.NumberFormat('id-ID').format(n),rp=n=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0,maximumFractionDigits:0}).format(n)
let browser,page,mode='normal',role='owner',delayManual=false,adRequests=0,perfRequests=0
const checks=[],unexpected=[],errors=[],trace=[]
const pass=s=>{checks.push(s);console.log('PASS '+s)}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
;(async()=>{
 browser=await chromium.launch({headless:true,executablePath:'/root/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'})
 const ctx=await browser.newContext({timezoneId:'Asia/Jakarta',viewport:{width:1440,height:1100},colorScheme:'light'})
 const chunks=('base64-'+Buffer.from(JSON.stringify(session)).toString('base64url')).match(/.{1,3500}/g)
 await ctx.addCookies(chunks.map((value,i)=>({name:'sb-ubksitifaprqofujhova-auth-token'+(chunks.length>1?'.'+i:''),value,domain:'127.0.0.1',path:'/',secure:false})))
 await ctx.addInitScript(()=>localStorage.setItem('theme','light'))
 await ctx.route('**/*',async route=>{
  const r=route.request(),u=new URL(r.url()),endpoint=u.pathname.split('/').pop()
  if(u.origin===new URL(base).origin)return route.continue()
  if(u.pathname==='/auth/v1/user')return route.fulfill({json:session.user})
  if(u.pathname.startsWith('/rest/v1/')){
   if(endpoint==='profiles'&&r.method()==='GET')return route.fulfill({json:{id:session.user.id,organization_id:1,active:true,role,full_name:'Owner Contoh'}})
   if(['notifications','get_sidebar_counts'].includes(endpoint))return route.fulfill({json:[]})
   if(endpoint==='campaigns'&&r.method()==='GET')return route.fulfill({json:[]})
   if(endpoint==='ad_spend'&&['GET','HEAD'].includes(r.method())){
    adRequests++
    const dates=u.searchParams.getAll('spend_date'),after=Number((u.searchParams.get('id')||'gt.0').slice(3))
    const source=(u.searchParams.get('source')||'').slice(3)
    if(delayManual&&source==='MANUAL')await delay(1200)
    const filtered=rows.filter(row=>row.spend_date>=dates.find(v=>v.startsWith('gte.')).slice(4)&&row.spend_date<=dates.find(v=>v.startsWith('lte.')).slice(4)&&(!source||row.source===source))
    const remaining=filtered.filter(row=>row.id>after),head=r.method()==='HEAD'
    if(mode==='error'&&after>0)return route.fulfill({status:503,json:{message:'Synthetic unavailable'}}).catch(()=>{})
    const count=(head?filtered.length:remaining.length)+(mode==='drift'&&after>0?1:0)
    trace.push({after,source,head,count,from:dates[0]})
    return route.fulfill({status:200,headers:{'content-type':'application/json','content-range':`0-0/${count}`,'access-control-expose-headers':'content-range'},body:head?'':JSON.stringify(remaining.slice(0,317))}).catch(()=>{})
   }
   if(endpoint==='analytics_campaign_profit'&&r.method()==='POST'){
    perfRequests++
    if(mode==='perf-error')return route.fulfill({status:503,json:{message:'Unavailable'}})
    const b=r.postDataJSON();assert.equal(b.p_from,'2099-09-01');assert.equal(b.p_to,'2099-09-30')
    const pf=[{campaign_id:1,campaign_name:'Camp META',platform:'META',spend:100,net_profit:50,delivered:2,retur:1,total_order:3,gross_profit:150,leads:2,roi:50},
      {campaign_id:2,campaign_name:'Camp GOOGLE',platform:'GOOGLE',spend:100,net_profit:-20,delivered:1,retur:0,total_order:1,gross_profit:80,leads:1,roi:-20}]
    return route.fulfill({json:pf,headers:{'content-range':'0-1/'+(mode==='perf-truncated'?3:2),'access-control-expose-headers':'content-range'}})
   }
  }
  unexpected.push({endpoint,method:r.method()});return route.abort()
 })
 page=await ctx.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message))
 const ref=(platform,source)=>rows.filter(r=>r.spend_date==='2099-09-01'&&(!platform||r.campaign.platform===platform)&&(!source||r.source===source))
 async function summary(expected){
  const total=expected.reduce((s,r)=>s+Number(r.spend_total??r.spend),0)
  await page.getByText(`${nf(expected.length)} entry • Total ${rp(total)} (termasuk PPN tercatat)`,{exact:true}).waitFor()
  const card=page.getByText('Total Spend',{exact:true}).locator('..')
  assert.equal((await card.getByText(rp(total),{exact:true}).count()),1)
  assert.equal(await page.getByText('Total Lead',{exact:true}).locator('..').getByText(nf(expected.length*2),{exact:true}).count(),1)
 }
 async function select(label,value){await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:value,exact:true}).click()}
 async function period(from,to){
  await page.getByRole('button').filter({has:page.locator('svg.lucide-calendar')}).first().click()
  await page.getByLabel('Dari tanggal',{exact:true}).fill(from);await page.getByLabel('Sampai tanggal',{exact:true}).fill(to)
  await page.getByRole('button',{name:'Terapkan',exact:true}).click()
 }
 await page.goto(base+'/ad-spend',{timeout:120000});await page.getByRole('heading',{name:'Ad Spend',exact:true}).waitFor()
 await period('2099-09-01','2099-09-30');await summary(ref())
 assert.equal(perfRequests,0,'Profit RPC must not block spend summary')
 const seen=[]
 for(;;){
   const names=await page.locator('tbody tr').allTextContents()
   seen.push(...names.map(v=>Number(v.match(/Contoh-(\d+)/)[1])))
   if(!await page.getByRole('button',{name:'Berikutnya',exact:true}).isEnabled())break
   await page.getByRole('button',{name:'Berikutnya',exact:true}).click()
 }
 assert.equal(seen.length,2407);assert.equal(new Set(seen).size,2407);assert.deepEqual(seen,ref().map(r=>r.id).reverse());await summary(ref())
 pass('2407 complete filtered rows across49 table pages; header/cards stable and identical; no profit RPC dependency')
 await select('Filter platform','Meta (FB/IG)');await summary(ref('META'))
 await page.getByText('Halaman 1 / 25',{exact:false}).waitFor()
 await select('Filter source','Manual');await summary(ref('META','MANUAL'))
 await select('Filter source','CSV Import');await summary(ref('META','CSV_IMPORT'))
 pass('platform and combined source filters retain all off-page matches and reset table pagination')
 delayManual=true
 await select('Filter source','Manual')
 await page.getByText('Memuat Ad Spend lengkap…',{exact:true}).waitFor()
 await select('Filter source','CSV Import');await summary(ref('META','CSV_IMPORT'));await delay(1500);await summary(ref('META','CSV_IMPORT'));delayManual=false
 pass('rapid filter changes hide old values immediately; delayed superseded result cannot overwrite new scope')
 await page.getByRole('button',{name:'Performa Campaign',exact:true}).click()
 await page.getByText('Performa belum mendukung filter source.',{exact:false}).waitFor();assert.equal(perfRequests,0)
 await select('Filter source','Semua source');await summary(ref('META'))
 await page.getByText('Laba Bersih (proyeksi):',{exact:false}).waitFor()
 assert.equal(await page.getByText('Camp META (META)',{exact:false}).count(),1);assert.equal(await page.getByText('Camp GOOGLE',{exact:false}).count(),0)
 pass('profit isolated in explicit all-source performance tab; selected-source profit withheld; platform filter honored')
 mode='perf-error';await page.getByRole('button',{name:'Spend Harian',exact:true}).click();await page.getByRole('button',{name:'Performa Campaign',exact:true}).click()
 await page.getByText('Performa campaign gagal dimuat; proyeksi tidak tersedia.',{exact:true}).waitFor();await summary(ref('META'))
 mode='perf-truncated';const truncatedResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/rest/v1/rpc/analytics_campaign_profit'&&r.status()===200)
 await page.getByRole('button',{name:'Coba lagi performa',exact:true}).click();await truncatedResponse
 await page.getByText('Performa campaign gagal dimuat; proyeksi tidak tersedia.',{exact:true}).waitFor()
 mode='normal';await page.getByRole('button',{name:'Coba lagi performa',exact:true}).click();await page.getByText('Laba Bersih (proyeksi):',{exact:false}).waitFor()
 pass('profit failure/truncation shows independent error; spend totals remain valid; performance retry succeeds')
 await page.getByRole('button',{name:'Spend Harian',exact:true}).click()
 for(const failure of ['error','drift']){
  mode=failure;await select('Filter source','Manual')
  await page.getByRole('alert').filter({hasText:'Ad Spend gagal dibaca lengkap.'}).waitFor()
  assert.equal(await page.getByText(/entry • Total/).count(),0);assert.equal(await page.getByText(/^Contoh-/).count(),0)
  assert.equal(await page.getByText('Total Spend',{exact:true}).locator('..').getByText('—',{exact:true}).count(),1)
  mode='normal';await page.getByRole('button',{name:'Coba lagi',exact:true}).click();await summary(ref('META','MANUAL'))
  await select('Filter source','Semua source');await summary(ref('META'))
 }
 pass('mid-read error/count drift hide partial rows and totals; retries recover genuine data')
 await period('2099-09-02','2099-09-02');await summary([])
 await page.getByText('Tidak ada Ad Spend sesuai filter',{exact:true}).waitFor()
 pass('verified empty period shows zero totals and honest filter-specific empty message')
 await period('2099-09-01','2099-09-30');await summary(ref('META'))
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1100})
  const m=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}))
  assert(m.pageWidth<=m.width+1,'Overflow '+JSON.stringify(m))
  await page.screenshot({path:root+`/ad-spend-${width}.png`,fullPage:false})
 }
 pass('responsive summary, filters and paginated table contained at1440/390/320')
 role='cs';await page.reload();await page.getByRole('heading',{name:'Ad Spend',exact:true}).waitFor()
 assert.equal(await page.getByRole('button',{name:'Tambah Manual',exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Upload CSV',exact:true}).count(),0)
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[])
 pass('existing writer visibility preserved for synthetic CS session; zero unexpected requests or business writes')
 fs.writeFileSync(root+'/browser-result.json',JSON.stringify({pass:true,checks,adRequests,perfRequests,errors,unexpected,businessWrites:0,environment:'built isolated loopback app; synthetic business responses'},null,2))
 await browser.close()
})().catch(async e=>{console.error(e);console.error(JSON.stringify({mode,adRequests,perfRequests,unexpected,trace}));if(page){console.error((await page.locator('body').innerText()).slice(0,7000));await page.screenshot({path:root+'/failure.png',fullPage:true})}if(browser)await browser.close();process.exit(1)})
