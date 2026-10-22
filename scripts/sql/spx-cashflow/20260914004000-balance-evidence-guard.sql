-- CANDIDATE: balance evidence conflicts block new writes; absent balances remain unverified.
BEGIN;
CREATE OR REPLACE FUNCTION public.preview_spx_cashflow_v2(p_request_id uuid,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog SET jit=off SET timezone='UTC' SET lock_timeout='3s' AS $$
#variable_conflict use_column
DECLARE
 actor uuid:=auth.uid(); org bigint; previous public.spx_cashflow_reviews%ROWTYPE;
 r jsonb; hit jsonb; matches jsonb; match_index jsonb; source jsonb; entry public.spx_cashflow_entries%ROWTYPE;
 v_txid text; kind text; track text; state text; amount numeric; event_time timestamptz;
 result jsonb; result_rows jsonb[]:='{}'; seen text[]:='{}'; seen_targets text[]:='{}'; target text; n int:=0;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=actor AND active AND role::text IN('owner','admin','akunting') FOR SHARE;
 IF org IS NULL THEN RAISE EXCEPTION 'Akses pencairan ditolak' USING ERRCODE='42501'; END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 10000 THEN
 RAISE EXCEPTION 'Preview memerlukan 1–10000 transaksi dan request ID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-cashflow-preview:'||p_request_id,0));
 SELECT * INTO previous FROM public.spx_cashflow_reviews WHERE id=p_request_id;
 IF FOUND THEN
  IF previous.organization_id<>org OR previous.input IS DISTINCT FROM p_rows THEN RAISE EXCEPTION 'Request ID berbeda isi' USING ERRCODE='PT409'; END IF;
  RETURN previous.plan;
 END IF;
 WITH requested AS MATERIALIZED (
  SELECT DISTINCT upper(btrim(value->>'tracking')) track FROM jsonb_array_elements(p_rows) WHERE value->>'tx_type'='COD'
 ), existing AS MATERIALIZED (
  SELECT 'orders' target_table,o.id target_id,o.resi,o.tracking_no,md5(to_jsonb(o)::text) version,to_jsonb(o) record FROM public.orders o WHERE o.organization_id=org
  UNION ALL SELECT 'orders_draft',o.id,o.resi,o.tracking_no,md5(to_jsonb(o)::text),to_jsonb(o) FROM public.orders_draft o WHERE o.organization_id=org
 ), hits AS (
  SELECT DISTINCT req.track,e.target_table,e.target_id,e.version,e.record FROM existing e
  CROSS JOIN LATERAL unnest(ARRAY[upper(btrim(e.resi)),upper(btrim(e.tracking_no))]) k
  JOIN requested req ON req.track=k
 ), grouped AS (
  SELECT hits.track,jsonb_agg(to_jsonb(hits)-'track') data FROM hits GROUP BY hits.track
 ) SELECT coalesce(jsonb_object_agg(grouped.track,data),'{}') INTO match_index FROM grouped;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  n:=n+1; v_txid:=btrim(r->>'external_id'); kind:=r->>'tx_type'; track:=upper(btrim(coalesce(r->>'tracking','')));
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR v_txid IS NULL OR length(v_txid) NOT BETWEEN 1 AND 160 OR
   jsonb_typeof(r->'external_id') IS DISTINCT FROM 'string' OR v_txid=ANY(seen) THEN
   RAISE EXCEPTION 'ID transaksi kosong/duplikat/tidak valid pada baris %',n USING ERRCODE='22023'; END IF;
  seen:=array_append(seen,v_txid);
  IF coalesce(r->>'nominal','') !~ '^-?[0-9]+([.][0-9]{1,2})?$' THEN RAISE EXCEPTION 'Nominal tidak valid' USING ERRCODE='22023'; END IF;
  amount:=(r->>'nominal')::numeric;
  IF abs(amount)>1000000000000 THEN RAISE EXCEPTION 'Nominal di luar batas' USING ERRCODE='22023'; END IF;
  IF coalesce(r->>'update_time','') !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' THEN RAISE EXCEPTION 'Tanggal transaksi perlu zona waktu' USING ERRCODE='22023'; END IF;
  BEGIN event_time:=(r->>'update_time')::timestamptz; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Tanggal transaksi tidak valid' USING ERRCODE='22023'; END;
  IF event_time<'2000-01-01Z'::timestamptz OR event_time>now()+interval '5 minutes' THEN RAISE EXCEPTION 'Tanggal di luar batas' USING ERRCODE='22023'; END IF;
  -- Whitelist the reviewed financial evidence. Ignore transport-only raw fields.
  source:=jsonb_build_object('external_id',v_txid,'tx_type',kind,'tracking',track,'nominal',amount,'update_time',event_time,
   'status',r->>'status','balance_before',r->'balance_before','balance_after',r->'balance_after',
   'withdrawal_fee',r->'withdrawal_fee','net_received',r->'net_received','reference_no',r->>'reference_no');
  hit:=NULL; state:=NULL;
  SELECT * INTO entry FROM public.spx_cashflow_entries WHERE organization_id=org AND external_id=v_txid;
  IF FOUND THEN
   state:=CASE WHEN entry.source=source THEN 'duplicate' ELSE 'conflicting_transaction' END;
  ELSIF r->>'status' IS DISTINCT FROM 'Berhasil' THEN state:='review_status';
  ELSIF ((r->>'balance_before' IS NOT NULL OR r->>'balance_after' IS NOT NULL) AND NOT CASE
   WHEN coalesce(r->>'balance_before','') ~ '^-?[0-9]+([.][0-9]{1,2})?$' AND coalesce(r->>'balance_after','') ~ '^-?[0-9]+([.][0-9]{1,2})?$'
   THEN (r->>'balance_after')::numeric-(r->>'balance_before')::numeric=amount ELSE false END) THEN state:='review_type_or_amount';
  ELSIF kind='Ongkos Kirim' THEN state:='review_shipping';
  ELSIF kind='Penyesuaian' THEN state:='review_adjustment';
  ELSIF kind='COD' AND amount>0 AND track<>'' THEN
   matches:=coalesce(match_index->track,'[]'::jsonb);
   IF jsonb_array_length(matches)=0 THEN state:='unmatched';
   ELSIF jsonb_array_length(matches)>1 THEN state:='ambiguous';
   ELSE
    hit:=matches->0; target:=hit->>'target_table'||':'||(hit->>'target_id');
    IF target=ANY(seen_targets) THEN RAISE EXCEPTION 'Lebih dari satu transaksi COD untuk satu order; perlu review' USING ERRCODE='PT409'; END IF;
    seen_targets:=array_append(seen_targets,target);
    IF hit->'record'->>'payment_method' IS DISTINCT FROM 'COD' THEN state:='review_payment_method';
    ELSIF hit->'record'->>'cod_settled_at' IS NOT NULL OR coalesce((hit->'record'->>'payout_amount')::numeric,0)<>0 THEN state:='review_existing_settlement';
    ELSIF EXISTS(SELECT 1 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD' AND e.source->>'tracking'=track) THEN state:='review_existing_settlement';
    ELSE state:=CASE hit->>'target_table' WHEN 'orders' THEN 'cod_final' ELSE 'cod_draft_ledger' END; END IF;
   END IF;
  ELSIF kind='Penarikan' AND amount<0 THEN
   IF coalesce(r->>'withdrawal_fee','') !~ '^[0-9]+([.][0-9]{1,2})?$' OR coalesce(r->>'net_received','') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN state:='review_withdrawal_amount';
   ELSIF (r->>'withdrawal_fee')::numeric+(r->>'net_received')::numeric<>abs(amount) THEN state:='review_withdrawal_amount';
   ELSIF EXISTS(SELECT 1 FROM public.bank_withdrawals w WHERE w.organization_id=org AND w.external_id=v_txid) THEN state:='review_existing_withdrawal';
   ELSE state:='withdrawal'; END IF;
  ELSE state:='review_type_or_amount'; END IF;
  result_rows:=array_append(result_rows,jsonb_build_object('index',n-1,'external_id',v_txid,'classification',state,'source',source,
   'target_table',hit->>'target_table','target_id',hit->'target_id','version',hit->>'version'));
 END LOOP;
 result:=jsonb_build_object('review_id',p_request_id,'total_rows',n,'rows',to_jsonb(result_rows),'contract',2);
 INSERT INTO public.spx_cashflow_reviews(id,organization_id,created_by,input,plan) VALUES(p_request_id,org,actor,p_rows,result);
 RETURN result;
END $$;
CREATE OR REPLACE FUNCTION public.apply_spx_cashflow_v2(p_review_id uuid,p_external_ids text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_catalog SET jit=off SET timezone='UTC' SET lock_timeout='3s' AS $$
#variable_conflict use_column
DECLARE
 actor uuid:=auth.uid(); org bigint; review public.spx_cashflow_reviews%ROWTYPE; e public.spx_cashflow_entries%ROWTYPE;
 r jsonb; src jsonb; before_row jsonb; after_row jsonb; matches jsonb; channel bigint;
 n int:=0; finals int:=0; drafts int:=0; withdrawals int:=0; repeats int:=0;
BEGIN
 SELECT organization_id INTO org FROM public.profiles WHERE id=actor AND active AND role::text IN('owner','admin','akunting') FOR SHARE;
 IF org IS NULL THEN RAISE EXCEPTION 'Akses pencairan ditolak' USING ERRCODE='42501'; END IF;
 IF p_external_ids IS NULL OR cardinality(p_external_ids) NOT BETWEEN 1 AND 150 OR
  EXISTS(SELECT 1 FROM unnest(p_external_ids) x GROUP BY x HAVING count(*)>1) OR array_position(p_external_ids,NULL) IS NOT NULL THEN
 RAISE EXCEPTION 'Pilih ID transaksi unik yang telah direview' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('grandbook-wa:'||org,0));
 SELECT * INTO review FROM public.spx_cashflow_reviews WHERE id=p_review_id AND organization_id=org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Preview tidak ditemukan' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(review.plan->'rows') x WHERE x->>'external_id'=ANY(p_external_ids))<>cardinality(p_external_ids) THEN
 RAISE EXCEPTION 'Transaksi tidak ada dalam preview' USING ERRCODE='PT409'; END IF;
 LOCK TABLE public.orders,public.orders_draft IN SHARE ROW EXCLUSIVE MODE;
 SELECT id INTO channel FROM public.courier_channels WHERE code='SPX_DIRECT';
 IF channel IS NULL THEN RAISE EXCEPTION 'Channel SPX tidak tersedia' USING ERRCODE='22023'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(review.plan->'rows') WHERE value->>'external_id'=ANY(p_external_ids) LOOP
  src:=r->'source';
  SELECT * INTO e FROM public.spx_cashflow_entries WHERE organization_id=org AND external_id=r->>'external_id';
  IF FOUND THEN
   IF e.source IS DISTINCT FROM src THEN RAISE EXCEPTION 'ID transaksi berubah isi' USING ERRCODE='PT409'; END IF;
   repeats:=repeats+1; CONTINUE;
  END IF;
  -- Recheck saved previews created before this guard as well.
  IF ((src->>'balance_before' IS NOT NULL OR src->>'balance_after' IS NOT NULL) AND NOT CASE
   WHEN coalesce(src->>'balance_before','') ~ '^-?[0-9]+([.][0-9]{1,2})?$' AND coalesce(src->>'balance_after','') ~ '^-?[0-9]+([.][0-9]{1,2})?$'
   THEN (src->>'balance_after')::numeric-(src->>'balance_before')::numeric=(src->>'nominal')::numeric ELSE false END) THEN
   RAISE EXCEPTION 'Nominal transaksi tidak cocok dengan perubahan saldo; periksa sumber SPX' USING ERRCODE='PT409'; END IF;
  IF r->>'classification' NOT IN('cod_final','cod_draft_ledger','withdrawal') THEN
   RAISE EXCEPTION 'Transaksi memerlukan penyelesaian review sebelum Apply' USING ERRCODE='PT409'; END IF;
  IF r->>'classification' IN('cod_final','cod_draft_ledger') THEN
   SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO matches FROM (
    SELECT 'orders' kind,o.id,md5(to_jsonb(o)::text) version,to_jsonb(o) record FROM public.orders o WHERE o.organization_id=org AND (upper(btrim(o.resi))=src->>'tracking' OR upper(btrim(o.tracking_no))=src->>'tracking')
    UNION ALL SELECT 'orders_draft',o.id,md5(to_jsonb(o)::text),to_jsonb(o) FROM public.orders_draft o WHERE o.organization_id=org AND (upper(btrim(o.resi))=src->>'tracking' OR upper(btrim(o.tracking_no))=src->>'tracking')
   ) x;
   IF jsonb_array_length(matches)<>1 OR matches->0->>'kind' IS DISTINCT FROM r->>'target_table' OR matches->0->'id' IS DISTINCT FROM r->'target_id' OR matches->0->>'version' IS DISTINCT FROM r->>'version' THEN
    RAISE EXCEPTION 'Order berubah; buat preview baru' USING ERRCODE='PT409'; END IF;
   IF EXISTS(SELECT 1 FROM public.spx_cashflow_entries x WHERE x.organization_id=org AND x.source->>'tx_type'='COD' AND x.source->>'tracking'=src->>'tracking') THEN
    RAISE EXCEPTION 'Order sudah memiliki transaksi COD' USING ERRCODE='PT409'; END IF;
   before_row:=matches->0->'record';
   IF r->>'classification'='cod_final' THEN
    PERFORM set_config('grandbook.bypass_actual_check','true',true);
    UPDATE public.orders SET payout_amount=(src->>'nominal')::numeric,cod_settled_at=(src->>'update_time')::timestamptz,updated_at=now()
     WHERE id=(r->>'target_id')::bigint AND organization_id=org RETURNING to_jsonb(orders.*) INTO after_row;
    PERFORM set_config('grandbook.bypass_actual_check','false',true);
    IF before_row-ARRAY['payout_amount','cod_settled_at','updated_at'] IS DISTINCT FROM after_row-ARRAY['payout_amount','cod_settled_at','updated_at'] THEN
     RAISE EXCEPTION 'Kolom bisnis lain berubah; transaksi dibatalkan' USING ERRCODE='PT409'; END IF;
    finals:=finals+1;
   ELSE drafts:=drafts+1; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM public.bank_withdrawals w WHERE w.organization_id=org AND w.external_id=r->>'external_id') THEN RAISE EXCEPTION 'Penarikan sudah berubah; preview ulang' USING ERRCODE='PT409'; END IF;
   INSERT INTO public.bank_withdrawals(organization_id,channel_id,external_id,withdrawal_date,amount,fee,net_received,status,balance_before,balance_after,reference_no)
    VALUES(org,channel,r->>'external_id',(src->>'update_time')::timestamptz,abs((src->>'nominal')::numeric),(src->>'withdrawal_fee')::numeric,
     (src->>'net_received')::numeric,'Berhasil',(src->>'balance_before')::numeric,(src->>'balance_after')::numeric,src->>'reference_no');
   withdrawals:=withdrawals+1;
  END IF;
  INSERT INTO public.spx_cashflow_entries(organization_id,external_id,review_id,recorded_by,source,target_table,target_id)
   VALUES(org,r->>'external_id',p_review_id,actor,src,r->>'target_table',(r->>'target_id')::bigint);
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('recorded',n,'cod_final_updated',finals,'cod_draft_ledger',drafts,'withdrawals_recorded',withdrawals,'replayed',repeats,'commissions_paid',0);
END $$;
REVOKE ALL ON FUNCTION public.preview_spx_cashflow_v2(uuid,jsonb),public.apply_spx_cashflow_v2(uuid,text[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.preview_spx_cashflow_v2(uuid,jsonb),public.apply_spx_cashflow_v2(uuid,text[]) TO authenticated;
-- Coordinate with the new UI; old cached clients cannot execute legacy payroll effects.
REVOKE ALL ON FUNCTION public.preview_spx_cashflow_recon(jsonb,text,integer),public.apply_spx_cashflow_recon(bigint) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
