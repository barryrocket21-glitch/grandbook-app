#!/usr/bin/env python3
"""Run synthetic financial-reader regressions only on an explicit isolated Unix socket."""
import argparse,hashlib,json,os,subprocess
from pathlib import Path

def main():
    a=argparse.ArgumentParser(description=__doc__)
    a.add_argument('--psql',type=Path,required=True)
    a.add_argument('--socket',type=Path,required=True)
    a.add_argument('--port',type=int,default=55543)
    a.add_argument('--baseline-book',type=Path,required=True)
    a.add_argument('--output',type=Path,required=True)
    args=a.parse_args()
    if not args.socket.is_absolute() or not str(args.socket).startswith('/tmp/grandbook-financial-p1-'):
        a.error('A dedicated /tmp/grandbook-financial-p1-* socket is required; no hosted/TCP URL accepted')
    args.output.mkdir(mode=0o700,parents=True,exist_ok=False)
    env={k:v for k,v in os.environ.items()if not k.startswith('PG')}
    cmd=[str(args.psql),'-XAt','-v','ON_ERROR_STOP=1','-h',str(args.socket),'-p',str(args.port),'-U','postgres','-d','financial_p1_review']
    def run(sql,name):
        r=subprocess.run(cmd,input=sql,text=True,capture_output=True,env=env,timeout=240)
        (args.output/(name+'.private.log')).write_text(r.stdout+r.stderr)
        if r.returncode:raise RuntimeError(name+' failed; inspect private log')
        return r.stdout
    guard="""DO $$ BEGIN IF current_database()<>'financial_p1_review' OR inet_server_addr()IS NOT NULL OR current_setting('listen_addresses')<>''THEN RAISE EXCEPTION 'Isolated DB required';END IF;END $$;"""
    run(guard,'isolation')
    baseline=args.baseline_book.read_text()
    expected='ac8ce592b3cc431f3823ad054c90b8a7'
    # Hash is pinned below from the reviewed installed source, not inferred from output totals.
    if hashlib.md5(baseline.encode()).hexdigest()!=expected:raise RuntimeError('Baseline drift')
    baseline=baseline.replace('public.list_pembukuan(','public.review_original_list_pembukuan(',1)
    setup=baseline+"; REVOKE ALL ON FUNCTION public.review_original_list_pembukuan(date,date,text,text,integer,integer)FROM PUBLIC,anon,service_role; GRANT EXECUTE ON FUNCTION public.review_original_list_pembukuan(date,date,text,text,integer,integer)TO authenticated;"
    sql=Path(__file__).with_name('regression.sql').read_text()
    sql=sql.replace("SET LOCAL statement_timeout='30s';",setup+"\nSET LOCAL statement_timeout='30s';",1)
    raw=run(sql,'regression')
    records=[json.loads(s)for s in raw.splitlines()if s.startswith('{')]
    result=next(x for x in records if'checks'in x)
    if result['passed']!=14:raise RuntimeError('Incomplete regression result')
    (args.output/'result.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result))
if __name__=='__main__':main()
