BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.spx_cashflow_entries ADD COLUMN IF NOT EXISTS origin_order_number text;
-- Only enrich the new reference; immutable transaction evidence remains unchanged.
UPDATE public.spx_cashflow_entries e SET origin_order_number=o.order_number FROM public.orders o
 WHERE e.origin_order_number IS NULL AND e.source->>'tx_type'='COD' AND e.target_table='orders' AND e.target_id=o.id AND e.organization_id=o.organization_id;
UPDATE public.spx_cashflow_entries e SET origin_order_number=o.order_number FROM public.orders_draft o
 WHERE e.origin_order_number IS NULL AND e.source->>'tx_type'='COD' AND e.target_table='orders_draft' AND e.target_id=o.id AND e.organization_id=o.organization_id;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.spx_cashflow_entries WHERE source->>'tx_type'='COD' AND nullif(origin_order_number,'') IS NULL) THEN
  RAISE EXCEPTION 'Referensi GB pada pencairan lama belum dapat dipastikan; hentikan migrasi' USING ERRCODE='PT409'; END IF;
END $$;
CREATE INDEX IF NOT EXISTS spx_cashflow_entries_origin ON public.spx_cashflow_entries(organization_id,origin_order_number) WHERE source->>'tx_type'='COD';
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
  INSERT INTO public.spx_cashflow_entries(organization_id,external_id,review_id,recorded_by,source,target_table,target_id,origin_order_number)
   VALUES(org,r->>'external_id',p_review_id,actor,src,r->>'target_table',(r->>'target_id')::bigint,CASE WHEN src->>'tx_type'='COD' THEN before_row->>'order_number' END);
  n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('recorded',n,'cod_final_updated',finals,'cod_draft_ledger',drafts,'withdrawals_recorded',withdrawals,'replayed',repeats,'commissions_paid',0);
END $$;

CREATE OR REPLACE FUNCTION public.recorded_cod_receipts()
RETURNS TABLE(order_number text,amount numeric,settled_at timestamptz,source_kind text)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO public,pg_catalog AS $$
DECLARE org bigint;
BEGIN
 SELECT p.organization_id INTO org FROM public.profiles p WHERE p.id=auth.uid() AND p.active AND p.role::text IN('owner','admin','akunting');
 IF org IS NULL THEN RAISE EXCEPTION 'Akses laporan pencairan ditolak' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD' AND nullif(e.origin_order_number,'') IS NULL) THEN
  RAISE EXCEPTION 'Referensi GB pencairan belum terverifikasi' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD' GROUP BY e.origin_order_number HAVING count(*)>1) THEN
  RAISE EXCEPTION 'Lebih dari satu pencairan untuk referensi GB yang sama' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM public.orders o WHERE o.organization_id=org AND o.payment_method='COD' AND o.cod_settled_at IS NOT NULL AND o.payout_amount IS NULL AND NOT EXISTS(SELECT 1 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD' AND (e.origin_order_number=o.order_number OR (e.target_table='orders' AND e.target_id=o.id)))) THEN
  RAISE EXCEPTION 'Nominal pencairan historis belum tersedia' USING ERRCODE='PT409';END IF;
 IF EXISTS(SELECT 1 FROM public.spx_cashflow_entries e JOIN public.orders o ON o.organization_id=e.organization_id AND (o.order_number=e.origin_order_number OR (e.target_table='orders' AND o.id=e.target_id)) WHERE e.organization_id=org AND e.source->>'tx_type'='COD' AND o.cod_settled_at IS NOT NULL AND (o.payout_amount IS DISTINCT FROM (e.source->>'nominal')::numeric OR o.cod_settled_at IS DISTINCT FROM (e.source->>'update_time')::timestamptz)) THEN
  RAISE EXCEPTION 'Catatan pencairan dan order final berbeda; perlu rekonsiliasi' USING ERRCODE='PT409';END IF;
 RETURN QUERY
 SELECT e.origin_order_number,(e.source->>'nominal')::numeric,(e.source->>'update_time')::timestamptz,'ledger'::text
 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD'
 UNION ALL
 SELECT o.order_number,o.payout_amount,o.cod_settled_at,'legacy'::text FROM public.orders o
 WHERE o.organization_id=org AND o.payment_method='COD' AND o.cod_settled_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM public.spx_cashflow_entries e WHERE e.organization_id=org AND e.source->>'tx_type'='COD' AND (e.origin_order_number=o.order_number OR (e.target_table='orders' AND e.target_id=o.id)));
END $$;
REVOKE ALL ON FUNCTION public.recorded_cod_receipts() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.recorded_cod_receipts() TO authenticated;
CREATE OR REPLACE FUNCTION public.get_payout_position()
 RETURNS TABLE(cair_total numeric, cair_count bigint, uncair_total numeric, uncair_count bigint, aging_0_7_count bigint, aging_0_7_amount numeric, aging_8_14_count bigint, aging_8_14_amount numeric, aging_15plus_count bigint, aging_15plus_amount numeric, komisi_paid numeric, komisi_earned numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org bigint := public.current_org_id();
BEGIN
  RETURN QUERY
  WITH settled AS MATERIALIZED (SELECT * FROM public.recorded_cod_receipts()), o AS (
    SELECT status, payout_amount, cod_amount, cod_settled_at,
           (now() - delivered_at) AS age
    FROM public.orders oo WHERE organization_id = v_org AND payment_method='COD' AND NOT EXISTS(SELECT 1 FROM settled s WHERE s.order_number=oo.order_number)
  ),
  unc AS (SELECT * FROM o WHERE status = 'DITERIMA' AND cod_settled_at IS NULL)
  SELECT
    COALESCE((SELECT SUM(amount) FROM settled), 0),
    (SELECT COUNT(*) FROM settled)::bigint,
    COALESCE((SELECT SUM(COALESCE(NULLIF(payout_amount,0), cod_amount)) FROM unc), 0),
    (SELECT COUNT(*) FROM unc)::bigint,
    (SELECT COUNT(*) FROM unc WHERE age < interval '8 days')::bigint,
    COALESCE((SELECT SUM(COALESCE(NULLIF(payout_amount,0), cod_amount)) FROM unc WHERE age < interval '8 days'), 0),
    (SELECT COUNT(*) FROM unc WHERE age >= interval '8 days' AND age < interval '15 days')::bigint,
    COALESCE((SELECT SUM(COALESCE(NULLIF(payout_amount,0), cod_amount)) FROM unc WHERE age >= interval '8 days' AND age < interval '15 days'), 0),
    (SELECT COUNT(*) FROM unc WHERE age >= interval '15 days' OR age IS NULL)::bigint,
    COALESCE((SELECT SUM(COALESCE(NULLIF(payout_amount,0), cod_amount)) FROM unc WHERE age >= interval '15 days' OR age IS NULL), 0),
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c JOIN public.orders oo ON oo.id = c.order_id
              WHERE oo.organization_id = v_org AND c.status = 'PAID'), 0),
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c JOIN public.orders oo ON oo.id = c.order_id
              WHERE oo.organization_id = v_org AND c.status = 'EARNED'), 0);
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_cashflow_summary()
 RETURNS TABLE(saldo_terakhir numeric, total_cod_bulan_ini numeric, total_penarikan_bulan_ini numeric, last_withdrawal_date timestamp with time zone, last_withdrawal_amount numeric, unsettled_count integer, unsettled_amount numeric)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org_id BIGINT;
  v_now_month timestamptz; v_next_month timestamptz;
BEGIN
  v_org_id := public.current_org_id();
  v_now_month := date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
 v_next_month := (date_trunc('month',now() AT TIME ZONE 'Asia/Jakarta')+interval '1 month') AT TIME ZONE 'Asia/Jakarta';
 PERFORM * FROM public.recorded_cod_receipts();

  RETURN QUERY
  SELECT
    (SELECT balance_after FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
     ORDER BY withdrawal_date DESC, id DESC LIMIT 1) AS saldo_terakhir,
    COALESCE((SELECT SUM(amount) FROM public.recorded_cod_receipts()
              WHERE settled_at >= v_now_month AND settled_at < v_next_month), 0) AS total_cod_bulan_ini,
    COALESCE((SELECT SUM(amount) FROM public.bank_withdrawals
              WHERE organization_id = v_org_id
                AND withdrawal_date >= v_now_month AND withdrawal_date < v_next_month
                AND status = 'Berhasil'), 0) AS total_penarikan_bulan_ini,
    (SELECT withdrawal_date FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
       AND status = 'Berhasil'
     ORDER BY withdrawal_date DESC, id DESC LIMIT 1) AS last_withdrawal_date,
    (SELECT amount FROM public.bank_withdrawals
     WHERE organization_id = v_org_id
       AND status = 'Berhasil'
     ORDER BY withdrawal_date DESC, id DESC LIMIT 1) AS last_withdrawal_amount,
    (SELECT COUNT(*)::INT FROM public.orders
     WHERE organization_id = v_org_id
       AND status = 'DITERIMA'
       AND cod_settled_at IS NULL AND payment_method='COD' AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders.order_number))::INT AS unsettled_count,
    COALESCE((SELECT SUM(cod_amount) FROM public.orders
              WHERE organization_id = v_org_id
                AND status = 'DITERIMA'
                AND cod_settled_at IS NULL AND payment_method='COD' AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders.order_number)), 0) AS unsettled_amount;
END;
$function$;
CREATE OR REPLACE FUNCTION public.get_financial_position()
 RETURNS TABLE(in_transit_cod numeric, in_transit_orders bigint, cod_at_spx numeric, cod_at_spx_orders bigint, total_withdrawn numeric, withdrawal_count bigint, last_withdrawal_at timestamp with time zone, hpp_supplier_owed numeric, hpp_supplier_orders bigint, hpp_supplier_count integer, ongkir_spx_owed numeric, ongkir_spx_orders bigint, komisi_owed numeric, komisi_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_org          BIGINT;
  v_withdrawn    NUMERIC;
  v_cod_diterima NUMERIC;
BEGIN
  v_org := public.current_org_id();
  PERFORM * FROM public.recorded_cod_receipts();

  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawn
  FROM public.bank_withdrawals
  WHERE organization_id = v_org
    AND status IN ('Berhasil', 'APPROVED', 'COMPLETED');

  SELECT COALESCE(SUM(cod_amount), 0) INTO v_cod_diterima
  FROM public.orders
  WHERE organization_id = v_org AND status = 'DITERIMA' AND payment_method = 'COD'
 AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders.order_number);
 v_cod_diterima:=v_cod_diterima+(SELECT coalesce(sum(amount),0) FROM public.recorded_cod_receipts());

  RETURN QUERY
  SELECT
    -- IN-TRANSIT: baca orders_draft (aktif, belum terminal)
    COALESCE((
      SELECT SUM(cod_amount) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders_draft.order_number)
    ), 0),
    (SELECT COUNT(*) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders_draft.order_number))::BIGINT,

    -- COD DI SPX: DITERIMA − total ditarik
    v_cod_diterima - v_withdrawn,
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org
        AND status = 'DITERIMA' AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM public.recorded_cod_receipts() s WHERE s.order_number=orders.order_number))::BIGINT + (SELECT count(*) FROM public.recorded_cod_receipts()),

    -- RIWAYAT PENARIKAN
    v_withdrawn,
    (SELECT COUNT(*) FROM public.bank_withdrawals
      WHERE organization_id = v_org
        AND status IN ('Berhasil', 'APPROVED', 'COMPLETED'))::BIGINT,
    (SELECT MAX(withdrawal_date) FROM public.bank_withdrawals
      WHERE organization_id = v_org),

    -- UTANG HPP KE SUPPLIER
    COALESCE((SELECT SUM(hpp_total) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING'), 0),
    (SELECT COUNT(*) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(DISTINCT supplier_id) FROM public.supplier_payable
      WHERE organization_id = v_org AND status = 'PENDING')::INTEGER,

    -- UTANG ONGKIR SPX: DIKIRIM(draft) + DITERIMA(orders)
    COALESCE((
      SELECT SUM(d.estimated_total_cost)
      FROM public.orders_draft d
      JOIN public.courier_channels cc ON cc.id = d.channel_id
      WHERE d.organization_id = v_org
        AND d.status = 'DIKIRIM'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    ), 0) +
    COALESCE((
      SELECT SUM(o.estimated_total_cost)
      FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org
        AND o.status = 'DITERIMA'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    ), 0),
    (
      SELECT COUNT(*) FROM public.orders_draft d
      JOIN public.courier_channels cc ON cc.id = d.channel_id
      WHERE d.organization_id = v_org AND d.status = 'DIKIRIM'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    )::BIGINT +
    (
      SELECT COUNT(*) FROM public.orders o
      JOIN public.courier_channels cc ON cc.id = o.channel_id
      WHERE o.organization_id = v_org AND o.status = 'DITERIMA'
        AND cc.billing_model = 'MONTHLY_INVOICE'
    )::BIGINT,

    -- KOMISI OWED: dari orders terminal (EARNED, belum dibayar)
    COALESCE((SELECT SUM(c.amount) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED'), 0),
    (SELECT COUNT(*) FROM public.commissions c
      JOIN public.orders o ON o.id = c.order_id
      WHERE o.organization_id = v_org AND c.status = 'EARNED')::BIGINT;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_cashflow_summary(),public.get_payout_position(),public.get_financial_position() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.get_cashflow_summary(),public.get_payout_position(),public.get_financial_position() TO authenticated;
COMMIT;
