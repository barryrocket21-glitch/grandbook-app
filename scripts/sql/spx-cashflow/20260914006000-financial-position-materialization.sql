-- Evaluate the guarded receipt source once per report statement.
-- Same report signature, role/RLS context, source authority and financial formulas.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.get_financial_position()
 RETURNS TABLE(in_transit_cod numeric, in_transit_orders bigint, cod_at_spx numeric, cod_at_spx_orders bigint, total_withdrawn numeric, withdrawal_count bigint, last_withdrawal_at timestamp with time zone, hpp_supplier_owed numeric, hpp_supplier_orders bigint, hpp_supplier_count integer, ongkir_spx_owed numeric, ongkir_spx_orders bigint, komisi_owed numeric, komisi_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org bigint;
BEGIN
  v_org := public.current_org_id();
  RETURN QUERY
  WITH settled AS MATERIALIZED (SELECT * FROM public.recorded_cod_receipts()),
  withdrawn AS MATERIALIZED (
    SELECT coalesce(sum(amount),0) amount FROM public.bank_withdrawals
    WHERE organization_id=v_org AND status IN ('Berhasil','APPROVED','COMPLETED')
  )
  SELECT
    -- IN-TRANSIT: baca orders_draft (aktif, belum terminal)
    COALESCE((
      SELECT SUM(cod_amount) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM settled s WHERE s.order_number=orders_draft.order_number)
    ), 0),
    (SELECT COUNT(*) FROM public.orders_draft
      WHERE organization_id = v_org
        AND status IN ('SIAP_KIRIM','DIKIRIM')
        AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM settled s WHERE s.order_number=orders_draft.order_number))::BIGINT,

    -- COD DI SPX: DITERIMA − total ditarik
    (SELECT coalesce(sum(o.cod_amount),0) FROM public.orders o WHERE o.organization_id=v_org AND o.status='DITERIMA' AND o.payment_method='COD' AND NOT EXISTS(SELECT 1 FROM settled s WHERE s.order_number=o.order_number)) + (SELECT coalesce(sum(amount),0) FROM settled) - (SELECT amount FROM withdrawn),
    (SELECT COUNT(*) FROM public.orders
      WHERE organization_id = v_org
        AND status = 'DITERIMA' AND payment_method = 'COD' AND NOT EXISTS(SELECT 1 FROM settled s WHERE s.order_number=orders.order_number))::BIGINT + (SELECT count(*) FROM settled),

    -- RIWAYAT PENARIKAN
    (SELECT amount FROM withdrawn),
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
COMMIT;
