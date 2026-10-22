const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {build}=require('esbuild'),{NextRequest}=require('next/server');
const root=path.resolve(__dirname,'../..');
process.env.VERCEL_ENV='production';
process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-fixture-only';
delete process.env.GRANDBOOK_ENV;
delete process.env.GRANDBOOK_STAGING_READONLY;
const mock=[
"exports.createServerClient=(_url,_key,options)=>{",
" const fixture=globalThis.__GB_AUTH_FIXTURE__;",
" return {",
"  auth:{getUser:async()=>{",
"   if(fixture.rotateCookie)options.cookies.setAll([{name:'synthetic-auth',value:'rotated',options:{path:'/'}}]);",
"   return {data:{user:fixture.user}};",
"  }},",
"  from(name){",
"   if(name!=='profiles')throw Error('Unexpected business read');",
"   const q={select(){return q},eq(){return q},single:async()=>({data:fixture.profile,error:fixture.error??null})};",
"   return q;",
"  }",
" };",
"};"
].join('\n');
test('real middleware entry routing preserves role, inactive-profile, API and refresh-cookie boundaries',async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gb-auth-middleware-'));
 try{
  const out=path.join(tmp,'middleware.cjs');
  await build({entryPoints:[path.join(root,'src/lib/supabase/middleware.ts')],outfile:out,bundle:true,platform:'node',format:'cjs',external:['next/server'],plugins:[{name:'synthetic-auth-only',setup(b){
   b.onResolve({filter:/^@supabase\/ssr$/},()=>({path:'ssr-fixture',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:mock,loader:'js'}));
   b.onResolve({filter:/^@\//},args=>{
    const base=path.join(root,'src',args.path.slice(2));
    const file=[base,base+'.ts',base+'.tsx'].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());
    return file?{path:file}:undefined;
   });
  }}]});
  const Module=require('node:module'),compiled=new Module(out,module);
  compiled.filename=out;compiled.paths=module.paths;compiled._compile(fs.readFileSync(out,'utf8'),out);
  const {updateSession}=compiled.exports;
  const owner={active:true,organization_id:1,role:'owner'};
  async function request(route,profile=owner,extra={}){
   globalThis.__GB_AUTH_FIXTURE__={user:{id:'10000000-0000-4000-8000-000000000001'},profile,...extra};
   return updateSession(new NextRequest('https://app.example'+route));
  }
  const expected={owner:'/dashboard',admin:'/orders/draft',cs:'/cs/resi',advertiser:'/adv-dashboard',akunting:'/reconciliation/spx'};
  for(const [role,landing] of Object.entries(expected)){
   for(const entry of ['/?unused=1','/login?next=//untrusted.invalid']){
    const result=await request(entry,{...owner,role},{rotateCookie:true});
    assert.equal(result.status,307);
    assert.equal(result.headers.get('location'),'https://app.example'+landing);
    assert.match(result.headers.get('set-cookie'),/synthetic-auth=rotated/);
   }
  }
  for(const role of ['owner','admin'])assert.equal((await request('/dashboard',{...owner,role})).status,200);
  for(const role of ['cs','advertiser','akunting'])assert.equal((await request('/dashboard',{...owner,role})).headers.get('location'),'https://app.example'+expected[role]);
  assert.equal((await request('/cs/resi',{...owner,role:'cs'})).status,200);
  assert.equal((await request('/',null,{user:null})).headers.get('location'),'https://app.example/login');
  assert.equal((await request('/api/orders/wa-paste/ref-data',null,{user:null})).status,401);
  for(const profile of [{...owner,active:false},{...owner,organization_id:null},{...owner,role:'__proto__'},null]){
   assert.equal((await request('/',profile)).status,403);
  }
  assert.equal((await request('/',null,{error:{message:'synthetic lookup failure'}})).status,503);
 }finally{
  delete globalThis.__GB_AUTH_FIXTURE__;
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});
