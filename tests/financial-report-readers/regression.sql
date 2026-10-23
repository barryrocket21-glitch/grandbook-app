-- Isolated PG only. All synthetic business writes roll back.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'financial_p1_review' OR inet_server_addr()IS NOT NULL
 OR current_setting('listen_addresses')<>'' THEN RAISE EXCEPTION 'Isolated database required';END IF;
END $$;
SET LOCAL statement_timeout='30s';
SELECT set_config('request.jwt.claim.sub',
 (SELECT id::text FROM profiles WHERE active AND role='owner'AND organization_id=1 ORDER BY id LIMIT 1),true);
CREATE TEMP TABLE review_checks(name text PRIMARY KEY);
CREATE TEMP TABLE review_owner AS SELECT auth.uid() owner_id;
CREATE TEMP TABLE review_cases(name text PRIMARY KEY,expected_buyer numeric,expects_receipt boolean DEFAULT false);
INSERT INTO review_cases(name,expected_buyer,expects_receipt) VALUES
 ('MATCH',100000,true),('DECIMAL',100000,false),('MISMATCH',120000,true),
 ('MALFORMED',120000,false),('OTHERPROFILE',120000,true),('MISSING',120000,false);
INSERT INTO orders_draft(organization_id,order_number,customer_name,payment_method,status,order_date,
 total,subtotal,shipping_cost,cod_amount,source_profile_id,raw_data,cs_id)
SELECT 1,'GB-20991023-P1-'||name,'SYNTHETIC REVIEW','COD',
 CASE name WHEN 'MISMATCH' THEN 'DIKIRIM' WHEN 'OTHERPROFILE' THEN 'PROBLEM'ELSE'SIAP_KIRIM'END,
 '2099-10-23',100000,80000,20000,NULL,
 CASE WHEN name='OTHERPROFILE'THEN NULL ELSE(SELECT id FROM converter_profiles WHERE code='orderonline_inbound')END,
 CASE name WHEN'MATCH'THEN'{"gross_revenue":"100000"}'::jsonb
 WHEN'DECIMAL'THEN'{"gross_revenue":"100000.00"}'::jsonb
 WHEN'MISMATCH'THEN'{"gross_revenue":"99999"}'::jsonb
 WHEN'MALFORMED'THEN'{"gross_revenue":"not-a-number"}'::jsonb
 WHEN'OTHERPROFILE'THEN'{"gross_revenue":"100000"}'::jsonb ELSE'{}'::jsonb END,
 (SELECT id FROM profiles WHERE role='cs'AND active AND organization_id=1 ORDER BY id LIMIT 1)
FROM review_cases;
INSERT INTO order_items_draft(organization_id,order_id,product_name_raw,qty,price,hpp_snapshot,packing_fee_snapshot)
SELECT 1,id,'SYNTHETIC REVIEW',1,80000,20000,300 FROM orders_draft WHERE order_number LIKE'GB-20991023-P1-%';
-- Populate fixture snapshots, not cost inputs/rules. No compute/reconciliation replay.
UPDATE orders_draft SET estimated_shipping_net=12000,estimated_cod_fee=1000,estimated_ppn=120,
 estimated_total_cost=13120,estimated_cash_in=100000,estimated_profit=64080
WHERE order_number LIKE'GB-20991023-P1-%';
INSERT INTO spx_cashflow_entries(organization_id,external_id,review_id,recorded_by,source,target_table,target_id,origin_order_number)
SELECT 1,'SYNTHETIC-P1-'||c.name,(SELECT id FROM spx_cashflow_reviews WHERE organization_id=1 LIMIT 1),
 (SELECT owner_id FROM review_owner),
 jsonb_build_object('tx_type','COD','nominal',c.expected_buyer,'update_time','2099-10-23T01:02:03+00:00'),
 'orders_draft',d.id,d.order_number FROM orders_draft d JOIN review_cases c ON d.order_number='GB-20991023-P1-'||c.name
WHERE c.expects_receipt;
GRANT SELECT,INSERT ON review_checks TO authenticated;
GRANT SELECT ON review_cases,review_owner TO authenticated;
SET LOCAL ROLE authenticated;
DO $$ DECLARE c record;r record;p record;old record; BEGIN
 FOR c IN SELECT*FROM review_cases LOOP
  SELECT*INTO STRICT r FROM list_pembukuan('2099-10-23','2099-10-23',NULL,'GB-20991023-P1-'||c.name,50,0);
  SELECT*INTO STRICT old FROM review_original_list_pembukuan('2099-10-23','2099-10-23',NULL,'GB-20991023-P1-'||c.name,50,0);
  IF r.penjualan<>c.expected_buyer THEN RAISE EXCEPTION 'Buyer basis %',c.name;END IF;
  IF r.est_gross_profit<>old.est_gross_profit OR r.est_gross_profit<>64080 THEN RAISE EXCEPTION 'Stored profit changed';END IF;
  IF r.est_fee_cs<>r.penjualan-r.est_biaya_kurir-r.est_hpp-r.est_gross_profit THEN RAISE EXCEPTION 'Breakdown mismatch';END IF;
  IF c.expects_receipt THEN
   IF r.dicairkan IS DISTINCT FROM c.expected_buyer OR r.cod_settled_at IS DISTINCT FROM '2099-10-23T01:02:03+00:00'::timestamptz THEN RAISE EXCEPTION 'Receipt missing %',c.name;END IF;
  ELSIF r.dicairkan IS NOT NULL OR r.cod_settled_at IS NOT NULL THEN RAISE EXCEPTION 'Fabricated receipt';END IF;
  INSERT INTO review_checks VALUES('basis/receipt/'||c.name);
 END LOOP;
 SELECT*INTO p FROM laba_rugi_summary('2099-10-23','2099-10-23');
 IF p.order_count<>6 OR p.est_gross_profit<>6*64080 OR p.est_penjualan<>560000 THEN RAISE EXCEPTION 'P&L basis mismatch %',to_jsonb(p);END IF;
 IF p.est_omset<>(SELECT sum(est_omset)FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,1000,0))
 OR p.est_fee_cs<>(SELECT sum(est_fee_cs)FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,1000,0))
 THEN RAISE EXCEPTION 'P&L ledger disagreement';END IF;
 INSERT INTO review_checks VALUES('pnl/book components and GP');
 IF(SELECT count(*)FROM list_pembukuan('2099-10-23','2099-10-23','DIKIRIM',NULL,50,0))<>1
 OR(SELECT count(*)FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,2,2))<>2 THEN RAISE EXCEPTION 'Filter/page changed';END IF;
 INSERT INTO review_checks VALUES('status/search/pagination');
END $$;
RESET ROLE;
-- One guarded receipt follows the stable order number through real promotion.
UPDATE orders_draft SET status='DITERIMA'WHERE order_number='GB-20991023-P1-MATCH';
SET LOCAL ROLE authenticated;
DO $$ DECLARE r record;BEGIN
 SELECT*INTO STRICT r FROM list_pembukuan('2099-10-23','2099-10-23',NULL,'GB-20991023-P1-MATCH',50,0);
 IF r.source<>'final'OR r.dicairkan<>100000
 OR(SELECT count(*)FROM recorded_cod_receipts()WHERE order_number='GB-20991023-P1-MATCH')<>1 THEN RAISE EXCEPTION 'Promotion lost/duplicated receipt';END IF;
 INSERT INTO review_checks VALUES('draft→final stable receipt');
END $$;
RESET ROLE;
UPDATE orders SET payout_amount=100000,cod_settled_at='2099-10-23T01:02:03+00:00'
WHERE order_number='GB-20991023-P1-MATCH';
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF(SELECT count(*)FROM recorded_cod_receipts()WHERE order_number='GB-20991023-P1-MATCH')<>1
 OR(SELECT sum(dicairkan)FROM list_pembukuan('2099-10-23','2099-10-23',NULL,'GB-20991023-P1-MATCH',50,0))<>100000 THEN RAISE EXCEPTION 'Mirrored settlement double counted';END IF;
 INSERT INTO review_checks VALUES('mirrored final deduplicated');
END $$;
RESET ROLE;
DO $$ BEGIN
 BEGIN
  UPDATE orders SET payout_amount=99999 WHERE order_number='GB-20991023-P1-MATCH';
  PERFORM*FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,50,0);
  RAISE EXCEPTION 'Conflicting receipt accepted';
 EXCEPTION WHEN SQLSTATE'PT409'THEN NULL;END;
 INSERT INTO review_checks VALUES('conflicting evidence fails closed');
 BEGIN
  INSERT INTO spx_cashflow_entries(organization_id,external_id,review_id,recorded_by,source,target_table,target_id,origin_order_number)
  SELECT organization_id,'SYNTHETIC-P1-DUPLICATE',review_id,recorded_by,source,target_table,target_id,origin_order_number
  FROM spx_cashflow_entries WHERE external_id='SYNTHETIC-P1-MATCH';
  PERFORM*FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,50,0);
  RAISE EXCEPTION 'Duplicate receipt accepted';
 EXCEPTION WHEN SQLSTATE'PT409'THEN NULL;END;
 INSERT INTO review_checks VALUES('duplicate evidence fails closed');
END $$;
-- Ordinary staff keep the existing reader path; manager-only receipt source is not called.
SELECT set_config('request.jwt.claim.sub',(SELECT id::text FROM profiles WHERE active AND role='cs'AND organization_id=1 ORDER BY id LIMIT 1),true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE a jsonb;b jsonb;BEGIN
 SELECT jsonb_agg(to_jsonb(t)-ARRAY['penjualan','est_omset','est_fee_cs','act_omset','act_fee_cs']ORDER BY source,id)INTO a
 FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,1000,0)t;
 SELECT jsonb_agg(to_jsonb(t)-ARRAY['penjualan','est_omset','est_fee_cs','act_omset','act_fee_cs']ORDER BY source,id)INTO b
 FROM review_original_list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,1000,0)t;
 IF a IS DISTINCT FROM b THEN RAISE EXCEPTION 'Staff path changed';END IF;
 INSERT INTO review_checks VALUES('CS normal access and cash fields preserved');
END $$;
RESET ROLE;
-- Other organization cannot see org1 fixture after ordinary org scoping.
SAVEPOINT org_scope;
INSERT INTO organizations(name,slug)VALUES('SYNTHETIC REVIEW ORG','synthetic-financial-p1-org');
UPDATE profiles SET organization_id=(SELECT id FROM organizations WHERE slug='synthetic-financial-p1-org')
WHERE id=(SELECT owner_id FROM review_owner);
SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM review_owner),true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,50,0))
 THEN RAISE EXCEPTION 'Cross-org rows leaked';END IF;
END $$;
RESET ROLE;
ROLLBACK TO org_scope;
INSERT INTO review_checks VALUES('cross-org isolation preserved');
SELECT set_config('request.jwt.claim.sub',(SELECT owner_id::text FROM review_owner),true);
SET LOCAL ROLE authenticated;
SELECT jsonb_build_object('fixture_ledger',COALESCE(jsonb_agg(to_jsonb(t)ORDER BY source,id),'[]'))FROM list_pembukuan('2099-10-23','2099-10-23',NULL,NULL,1000,0)t;
SELECT jsonb_build_object('fixture_pnl',to_jsonb(t))FROM laba_rugi_summary('2099-10-23','2099-10-23')t;
RESET ROLE;
SELECT jsonb_build_object('checks',jsonb_agg(name ORDER BY name),'passed',count(*))FROM review_checks;
ROLLBACK;
