/* Offline execution of the actual route and report helpers; no network or DB. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module')
function createHarness(root,datasets,options={}){
 const req=createRequire(path.join(root,'package.json')),ts=req('typescript'),calls=[]
 const clone=x=>JSON.parse(JSON.stringify(x))
 const field=(row,key)=>key.startsWith('order.')?(datasets.orders||[]).find(x=>x.id===row.order_id)?.[key.slice(6)]:row[key]
 class Query{
  constructor(table){this.table=table;this.filters=[];this.cap=Infinity;this.cols=''}
  select(cols){this.cols=cols;return this}
  eq(k,v){this.filters.push(r=>field(r,k)===v);return this}
  gt(k,v){this.filters.push(r=>field(r,k)>v);return this}
  gte(k,v){this.filters.push(r=>field(r,k)>=v);return this}
  lte(k,v){this.filters.push(r=>field(r,k)<=v);return this}
  in(k,vs){this.filters.push(r=>vs.includes(field(r,k)));return this}
  order(){return this}
  limit(n){this.cap=n;return this}
  single(){return Promise.resolve({data:options.profile===undefined?{role:'owner',active:true,organization_id:1}:options.profile,error:null})}
  then(ok,fail){
   calls.push({table:this.table,columns:this.cols})
   if(options.failTable===this.table)return Promise.resolve({data:null,count:null,error:{message:'Synthetic read failure'}}).then(ok,fail)
   const all=(datasets[this.table]||[]).filter(r=>this.filters.every(f=>f(r))).sort((a,b)=>(a.id??0)-(b.id??0))
   const data=all.slice(0,Math.min(this.cap,options.pageCap||Infinity)).map(clone)
   if(this.table==='order_items'&&!this.cols.split(',').includes('packing_fee_snapshot'))for(const row of data)delete row.packing_fee_snapshot
   return Promise.resolve({data,count:all.length,error:null}).then(ok,fail)
  }
 }
 const sb={auth:{getUser:async()=>({data:{user:options.noUser?null:{id:'synthetic-owner'}}})},from:table=>new Query(table),rpc:async(name,args)=>{
  calls.push({rpc:name});if(name!=='order_shipping_cost_evidence')throw Error('Unexpected RPC')
  return{data:(datasets.shipping_evidence||[]).filter(r=>args.p_order_numbers.includes(r.order_number)),error:null}
 }}
 const cache=new Map()
 function load(filename){
  const resolved=path.resolve(filename)
  if(cache.has(resolved))return cache.get(resolved).exports
  const module={exports:{}};cache.set(resolved,module)
  const source=fs.readFileSync(resolved,'utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const requireLocal=name=>{
   if(name==='@/lib/supabase/server')return{createClient:async()=>sb}
   if(name==='@/lib/server/environment-guard')return{serverEnvironmentResponse:()=>null}
   if(name.startsWith('@/'))return load(path.join(root,'src',name.slice(2))+'.ts')
   if(name.startsWith('.'))return load(path.resolve(path.dirname(resolved),name)+(path.extname(name)?'':'.ts'))
   return req(name)
  }
  const factory=vm.runInNewContext('(function(require,module,exports){'+code+'\n})',{URL,URLSearchParams,Request,Response,Headers,console,Date,Map,Set,Number,Math,JSON},{filename:resolved})
  factory(requireLocal,module,module.exports);return module.exports
 }
 const route=load(path.join(root,'src/app/api/reports/owner-profit/route.ts'))
 return{calls,run:async(month='2026-09',platform='ALL')=>{
  const response=await route.GET(new Request('http://isolated.invalid/api/reports/owner-profit?month='+month+'&platform='+platform))
  return{status:response.status,body:await response.json()}
 }}
}
module.exports={createHarness}
