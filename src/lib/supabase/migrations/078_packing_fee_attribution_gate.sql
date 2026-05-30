-- 078 — Brief #3: Packing Fee per Produk + Gate Atribusi CS/ADV
-- ============================================================================
-- BAGIAN A — packing_fee per produk, di-snapshot per order_item (sejajar HPP),
--   per-pcs (packing_fee × qty), ikut formula profit di tempat yang sama dgn HPP.
-- BAGIAN B — gate atribusi. Keputusan Barry: GATE cs_id SAJA (komisi CS-only;
--   advertiser kosong di SEMUA 1548 order → kalau di-gate bakal freeze semua
--   komisi). attribution_resolved = cs_id ada. Antrian "Atribusi Required"
--   surface order yg cs/advertiser kosong (buat analitik + batch assign) tanpa
--   nahan duit. Export ekspedisi TIDAK ke-block (prinsip kunci).
--
-- Slot 078 (077 = customers). Idempotent.
-- Part 2 (fold packing ke 12 RPC profit) di-append oleh generator script —
-- lihat blok "GENERATED: packing folded into HPP" di bawah.

-- ============================================================================
-- BAGIAN A — Packing Fee per Produk
-- ============================================================================

-- A.1 — kolom packing_fee di products (default 0, existing = 0)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS packing_fee numeric NOT NULL DEFAULT 0;

-- A.2 — snapshot per item (mirror hpp_snapshot) di orders + draft
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS packing_fee_snapshot numeric;
ALTER TABLE public.order_items_draft
  ADD COLUMN IF NOT EXISTS packing_fee_snapshot numeric;

-- A.3 — extend trigger snapshot: populate packing_fee_snapshot dari products.packing_fee
--   (packing per-produk, BUKAN per-variant → ambil dari products saja).
--   Idempotent: caller boleh override dgn set explicit (sama pola hpp_snapshot).
CREATE OR REPLACE FUNCTION public.snapshot_hpp_on_order_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Step 1: denormalize parent product_id dari variant_id
  IF NEW.product_id IS NULL AND NEW.variant_id IS NOT NULL THEN
    SELECT pv.product_id INTO NEW.product_id
    FROM public.product_variants pv
    WHERE pv.id = NEW.variant_id;
  END IF;

  -- Step 2: snapshot HPP — variant preferred, parent product fallback
  IF NEW.hpp_snapshot IS NULL THEN
    IF NEW.variant_id IS NOT NULL THEN
      SELECT pv.hpp INTO NEW.hpp_snapshot
      FROM public.product_variants pv
      WHERE pv.id = NEW.variant_id;
    ELSIF NEW.product_id IS NOT NULL THEN
      SELECT p.hpp INTO NEW.hpp_snapshot
      FROM public.products p
      WHERE p.id = NEW.product_id;
    END IF;
  END IF;

  -- Step 3 (Brief #3): snapshot packing fee dari products (per produk)
  IF NEW.packing_fee_snapshot IS NULL AND NEW.product_id IS NOT NULL THEN
    SELECT COALESCE(p.packing_fee, 0) INTO NEW.packing_fee_snapshot
    FROM public.products p
    WHERE p.id = NEW.product_id;
  END IF;

  RETURN NEW;
END $function$;

-- Pastikan trigger ada di order_items DAN order_items_draft (idempotent).
DROP TRIGGER IF EXISTS trg_snapshot_hpp ON public.order_items;
CREATE TRIGGER trg_snapshot_hpp
  BEFORE INSERT OR UPDATE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_hpp_on_order_items();

DROP TRIGGER IF EXISTS trg_snapshot_hpp_draft ON public.order_items_draft;
CREATE TRIGGER trg_snapshot_hpp_draft
  BEFORE INSERT OR UPDATE ON public.order_items_draft
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_hpp_on_order_items();

-- A.4 — promote_draft_to_orders: ikut copy packing_fee_snapshot dari draft
CREATE OR REPLACE FUNCTION public.promote_draft_to_orders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_order_id BIGINT;
  v_archive_status TEXT;
BEGIN
  IF NEW.resi IS NOT NULL AND TRIM(NEW.resi) <> ''
     AND (OLD.resi IS NULL OR TRIM(OLD.resi) = '') THEN

    v_archive_status := CASE
      WHEN NEW.status IN ('PROBLEM','CANCEL') THEN NEW.status
      ELSE 'SIAP_KIRIM'
    END;

    INSERT INTO public.orders(
      organization_id, order_number, external_order_id, resi,
      source_profile_id, channel_id,
      customer_name, customer_phone, customer_province, customer_city,
      customer_subdistrict, customer_village, customer_zip,
      customer_address_detail, customer_address, wilayah_id,
      subtotal, shipping_cost, discount, total, cod_amount,
      estimated_shipping_net, estimated_cod_fee, estimated_ppn,
      estimated_total_cost, estimated_cash_in, estimated_profit,
      payment_method, status, status_changed_at, priority, rate_snapshot,
      cs_id, cs_name, advertiser_id, admin_id, campaign_id,
      origin_supplier_id, is_multi_origin, created_by,
      notes, meta, raw_data,
      internal_note, customer_note, reject_reason, cs_attempts,
      last_contact_at, tags,
      order_date, resi_printed_at,
      created_at, updated_at
    )
    VALUES (
      NEW.organization_id, NEW.order_number, NEW.external_order_id, NEW.resi,
      NEW.source_profile_id, NEW.channel_id,
      NEW.customer_name, NEW.customer_phone, NEW.customer_province, NEW.customer_city,
      NEW.customer_subdistrict, NEW.customer_village, NEW.customer_zip,
      NEW.customer_address_detail, NEW.customer_address, NEW.wilayah_id,
      NEW.subtotal, NEW.shipping_cost, NEW.discount, NEW.total, NEW.cod_amount,
      NEW.estimated_shipping_net, NEW.estimated_cod_fee, NEW.estimated_ppn,
      NEW.estimated_total_cost, NEW.estimated_cash_in, NEW.estimated_profit,
      NEW.payment_method, v_archive_status, NOW(), NEW.priority, NEW.rate_snapshot,
      NEW.cs_id, NEW.cs_name, NEW.advertiser_id, NEW.admin_id, NEW.campaign_id,
      NEW.origin_supplier_id, NEW.is_multi_origin, NEW.created_by,
      NEW.notes, NEW.meta, NEW.raw_data,
      NEW.internal_note, NEW.customer_note, NEW.reject_reason, NEW.cs_attempts,
      NEW.last_contact_at, NEW.tags,
      NEW.order_date, COALESCE(NEW.resi_printed_at, NOW()),
      NEW.created_at, NOW()
    )
    RETURNING id INTO v_new_order_id;

    INSERT INTO public.order_items(
      organization_id, order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    )
    SELECT
      organization_id, v_new_order_id, product_id, variant_id,
      product_name_raw, variation, product_code_raw,
      qty, weight_per_unit, price, hpp_snapshot, packing_fee_snapshot, notes
    FROM public.order_items_draft
    WHERE order_id = NEW.id;

    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (
      auth.uid(),
      'orders_draft',
      NEW.id::text,
      'PROMOTE_TO_ORDERS',
      jsonb_build_object('draft_id', NEW.id, 'order_number', NEW.order_number),
      jsonb_build_object('orders_id', v_new_order_id, 'resi', NEW.resi, 'archive_status', v_archive_status)
    );

    DELETE FROM public.orders_draft WHERE id = NEW.id;

    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- A.5 — TIDAK backfill order_items existing. packing_fee_snapshot dibiarkan NULL
--   utk order lama → COALESCE(packing_fee_snapshot, 0) = 0 di semua RPC profit
--   (historis stabil + packing memang 0 sekarang). Update order_items existing
--   bakal fire trigger recompute commission (1548×) → timeout + bentrok PAID.
--   Order baru / item di-edit dapet snapshot via trigger snapshot_hpp_on_order_items.

-- ============================================================================
-- BAGIAN B — Gate Atribusi (cs_id)
-- ============================================================================

-- B.1 — attribution_resolved: generated column (cs_id ada). DB-maintained,
--   gak bisa di-set manual, auto-update saat cs_id berubah.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS attribution_resolved boolean
  GENERATED ALWAYS AS (cs_id IS NOT NULL) STORED;

CREATE INDEX IF NOT EXISTS idx_orders_attribution_resolved
  ON public.orders(attribution_resolved) WHERE attribution_resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_orders_advertiser_id_null
  ON public.orders(organization_id) WHERE advertiser_id IS NULL;

-- B.2 — compute_commissions: EARNED hanya kalau DITERIMA DAN attribution_resolved
--   (cs_id ada). Kalau DITERIMA tapi cs kosong → komisi PENDING (ditahan, gak
--   hangus). VOIDED tetap utk RETUR/CANCEL/FAKE.
CREATE OR REPLACE FUNCTION public.compute_commissions(p_order_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_org BIGINT;
  v_cs_id UUID;
  v_adv_id UUID;
  v_status TEXT;
  v_order_date DATE;
  v_item RECORD;
  v_revenue NUMERIC;
  v_cs_rule RECORD;
  v_adv_rule RECORD;
  v_cs_amount NUMERIC;
  v_adv_amount NUMERIC;
  v_initial_status TEXT;
  v_attribution_ok BOOLEAN;
  v_inserted INT := 0;
  v_skipped INT := 0;
BEGIN
  SELECT o.organization_id, o.cs_id, o.status, o.order_date, c.advertiser_id
  INTO v_org, v_cs_id, v_status, v_order_date, v_adv_id
  FROM public.orders o
  LEFT JOIN public.campaigns c ON c.id = o.campaign_id
  WHERE o.id = p_order_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Order % not found', p_order_id;
  END IF;

  -- Brief #3 gate: atribusi lengkap = cs_id ada (keputusan Barry: cs-only).
  v_attribution_ok := (v_cs_id IS NOT NULL);

  IF v_status IN ('RETUR', 'CANCEL', 'FAKE') THEN
    v_initial_status := 'VOIDED';
  ELSIF v_status = 'DITERIMA' AND v_attribution_ok THEN
    v_initial_status := 'EARNED';
  ELSE
    -- DITERIMA-tapi-atribusi-belum-lengkap, atau status pre-final → PENDING (ditahan)
    v_initial_status := 'PENDING';
  END IF;

  DELETE FROM public.commissions
  WHERE order_id = p_order_id AND status IN ('PENDING', 'EARNED');

  FOR v_item IN
    SELECT oi.id AS item_id, oi.product_id, oi.qty, oi.price,
           (oi.qty * oi.price) AS line_revenue
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
  LOOP
    v_revenue := COALESCE(v_item.line_revenue, 0);

    SELECT * INTO v_cs_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'cs'
      AND active = TRUE
      AND (user_id = v_cs_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY user_id NULLS LAST, product_id NULLS LAST, effective_from DESC NULLS LAST
    LIMIT 1;

    IF v_cs_rule IS NULL THEN
      v_cs_amount := 0;
    ELSIF v_cs_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_cs_amount := COALESCE(v_cs_rule.rate_value, 0);
    ELSIF v_cs_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_cs_amount := v_revenue * (COALESCE(v_cs_rule.rate_value, 0) / 100.0);
    ELSE
      v_cs_amount := 0;
    END IF;

    IF v_cs_id IS NOT NULL AND v_cs_amount > 0 THEN
      -- Idempotent: kalau ada row VOIDED/PAID utk key sama (DELETE di atas cuma
      -- buang PENDING/EARNED), update — tapi PAID JANGAN di-downgrade (audit-safe).
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_cs_id, 'cs', v_cs_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW();
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;

    SELECT * INTO v_adv_rule
    FROM public.commission_rules
    WHERE organization_id = v_org
      AND role = 'advertiser'
      AND active = TRUE
      AND (user_id = v_adv_id OR user_id IS NULL)
      AND (product_id = v_item.product_id OR product_id IS NULL)
      AND (effective_from IS NULL OR effective_from <= v_order_date)
      AND (effective_to IS NULL OR v_order_date <= effective_to)
    ORDER BY user_id NULLS LAST, product_id NULLS LAST, effective_from DESC NULLS LAST
    LIMIT 1;

    IF v_adv_rule IS NULL THEN
      v_adv_amount := 0;
    ELSIF v_adv_rule.rate_type = 'FLAT_PER_ORDER' THEN
      v_adv_amount := COALESCE(v_adv_rule.rate_value, 0);
    ELSIF v_adv_rule.rate_type = 'PERCENT_REVENUE' THEN
      v_adv_amount := v_revenue * (COALESCE(v_adv_rule.rate_value, 0) / 100.0);
    ELSE
      v_adv_amount := 0;
    END IF;

    IF v_adv_id IS NOT NULL AND v_adv_amount > 0 THEN
      INSERT INTO public.commissions (order_id, order_item_id, user_id, role, amount, status)
      VALUES (p_order_id, v_item.item_id, v_adv_id, 'advertiser', v_adv_amount, v_initial_status)
      ON CONFLICT ON CONSTRAINT commissions_unique DO UPDATE
        SET amount = EXCLUDED.amount,
            status = CASE WHEN commissions.status = 'PAID' THEN 'PAID' ELSE EXCLUDED.status END,
            updated_at = NOW();
      v_inserted := v_inserted + 1;
    ELSE
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('order_id', p_order_id, 'inserted', v_inserted,
    'skipped', v_skipped, 'initial_status', v_initial_status);
END $function$;

-- B.3 — transition trigger: guard EARNED dgn attribution_resolved + recompute
--   saat cs_id/advertiser_id diisi belakangan (PENDING → EARNED otomatis).
CREATE OR REPLACE FUNCTION public.update_commission_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Atribusi baru diisi/diubah → recompute penuh (status komisi ikut benar).
  IF (NEW.cs_id IS DISTINCT FROM OLD.cs_id)
     OR (NEW.advertiser_id IS DISTINCT FROM OLD.advertiser_id) THEN
    PERFORM public.compute_commissions(NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'DITERIMA' AND NEW.attribution_resolved THEN
      -- PENDING → EARNED hanya kalau atribusi lengkap (cs_id). Kalau belum,
      -- komisi tetap PENDING (ditahan, gak hangus) sampai atribusi diisi.
      UPDATE public.commissions SET status = 'EARNED', updated_at = NOW()
      WHERE order_id = NEW.id AND status = 'PENDING';
    ELSIF NEW.status IN ('RETUR', 'CANCEL', 'FAKE') THEN
      UPDATE public.commissions SET status = 'VOIDED', updated_at = NOW()
      WHERE order_id = NEW.id AND status IN ('PENDING', 'EARNED');
    ELSIF NEW.status IN ('BARU', 'SIAP_KIRIM', 'DIKIRIM', 'PROBLEM')
          AND OLD.status IN ('DITERIMA', 'RETUR', 'CANCEL', 'FAKE') THEN
      UPDATE public.commissions SET status = 'PENDING', updated_at = NOW()
      WHERE order_id = NEW.id AND status IN ('EARNED', 'VOIDED');
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- Re-create trigger supaya fire juga saat cs_id / advertiser_id berubah.
DROP TRIGGER IF EXISTS trg_update_commission_on_status ON public.orders;
CREATE TRIGGER trg_update_commission_on_status
  AFTER UPDATE OF status, cs_id, advertiser_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.update_commission_on_order_status();

-- B.4 — RPC antrian Atribusi Required. Surface order yg cs/advertiser kosong
--   (buat batch assign + analitik). SECURITY INVOKER → RLS orders scope org.
DROP FUNCTION IF EXISTS public.list_attribution_required(date, date, text, int, int);
CREATE OR REPLACE FUNCTION public.list_attribution_required(
  p_from   date DEFAULT NULL,
  p_to     date DEFAULT NULL,
  p_missing text DEFAULT 'any',   -- 'cs' | 'adv' | 'any'
  p_limit  int DEFAULT 100,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id              bigint,
  order_number    text,
  order_date      date,
  status          text,
  customer_name   text,
  cs_id           uuid,
  cs_name         text,
  advertiser_id   uuid,
  campaign_id     bigint,
  total           numeric,
  missing_cs      boolean,
  missing_adv     boolean,
  total_count     bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH filtered AS (
    SELECT o.*
    FROM public.orders o
    WHERE o.organization_id = (SELECT public.current_org_id())
      AND (p_from IS NULL OR o.order_date >= p_from)
      AND (p_to IS NULL OR o.order_date <= p_to)
      AND (
        CASE p_missing
          WHEN 'cs'  THEN o.cs_id IS NULL
          WHEN 'adv' THEN o.advertiser_id IS NULL
          ELSE (o.cs_id IS NULL OR o.advertiser_id IS NULL)
        END
      )
  )
  SELECT
    f.id, f.order_number, f.order_date, f.status, f.customer_name,
    f.cs_id, f.cs_name, f.advertiser_id, f.campaign_id, f.total,
    (f.cs_id IS NULL) AS missing_cs,
    (f.advertiser_id IS NULL) AS missing_adv,
    (SELECT count(*) FROM filtered) AS total_count
  FROM filtered f
  ORDER BY f.order_date DESC NULLS LAST, f.id DESC
  LIMIT GREATEST(p_limit, 1) OFFSET GREATEST(p_offset, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_attribution_required(date, date, text, int, int) TO authenticated;

-- B.5 — get_sidebar_counts: tambah attribution_required (cs ATAU adv kosong)
DROP FUNCTION IF EXISTS public.get_sidebar_counts();
CREATE OR REPLACE FUNCTION public.get_sidebar_counts()
RETURNS TABLE(drafts_total bigint, drafts_baru bigint, drafts_problem bigint, supplier_payable_pending bigint, inbox_pending_review bigint, inbox_unmatched_resi bigint, inbox_unmapped_statuses bigint, inbox_address_review bigint, inbox_phone_review bigint, commissions_earned bigint, attribution_required bigint)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_org_id BIGINT;
BEGIN
  v_org_id := public.current_org_id();
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id)::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.orders_draft WHERE organization_id = v_org_id AND status = 'PROBLEM')::BIGINT,
    (SELECT COUNT(*) FROM public.supplier_payable WHERE organization_id = v_org_id AND status = 'PENDING')::BIGINT,
    (SELECT COUNT(*) FROM public.orders WHERE organization_id = v_org_id AND status = 'BARU')::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmatched_resi WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unmapped_statuses WHERE organization_id = v_org_id AND resolved = FALSE)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_unparsed_address WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.inbox_invalid_phone WHERE organization_id = v_org_id AND resolved_at IS NULL)::BIGINT,
    (SELECT COUNT(*) FROM public.commissions c
       JOIN public.orders o ON o.id = c.order_id
       WHERE o.organization_id = v_org_id AND c.status = 'EARNED')::BIGINT,
    -- Brief #3: order yg cs ATAU advertiser kosong (atribusi belum lengkap)
    (SELECT COUNT(*) FROM public.orders
       WHERE organization_id = v_org_id
         AND (cs_id IS NULL OR advertiser_id IS NULL))::BIGINT;
END;
$function$;

-- ============================================================================
-- BAGIAN A — Part 2: fold packing_fee_snapshot ke SEMUA RPC profit yang sum HPP.
-- Server-side rewrite: tiap COALESCE(<alias>hpp_snapshot, 0) → ditambah
-- COALESCE(<alias>packing_fee_snapshot, 0) (packing sejajar HPP, per-pcs karena
-- selalu di dalam SUM(qty * ...)). Idempotent: skip fungsi yg sudah ke-fold.
-- EXCLUDE: populate_supplier_payable + backfill_spx_batch (HPP = utang ke
-- supplier, packing BUKAN utang supplier) + snapshot/promote (sudah di-handle).
-- ============================================================================
DO $fold$
DECLARE
  v_oid oid;
  v_def text;
  v_new text;
  v_fns text[] := ARRAY[
    'analytics_overview', 'compute_order_costs', 'analytics_profit_per_product',
    'analytics_overview_v2', 'analytics_profit_per_product_v2', 'list_orders_enriched',
    'laba_rugi_summary', 'analytics_variant_per_product', 'analytics_overview_v3',
    'analytics_overview_v4', 'analytics_profit_per_product_v3',
    'analytics_profit_per_product_per_platform'
  ];
BEGIN
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_fns)
  LOOP
    v_def := pg_get_functiondef(v_oid);
    IF v_def IS NULL THEN CONTINUE; END IF;
    IF v_def LIKE '%packing_fee_snapshot%' THEN CONTINUE; END IF;  -- sudah ke-fold
    IF v_def NOT LIKE '%hpp_snapshot%' THEN CONTINUE; END IF;       -- gak ada HPP
    v_new := regexp_replace(
      v_def,
      'COALESCE\(((?:\w+\.)?)hpp_snapshot,\s*0\)',
      '(COALESCE(\1hpp_snapshot, 0) + COALESCE(\1packing_fee_snapshot, 0))',
      'g'
    );
    IF v_new <> v_def THEN
      EXECUTE v_new;
    END IF;
  END LOOP;
END;
$fold$;

-- Part 2b: pola kedua `<alias>.hpp_snapshot * <alias>.qty` (tanpa COALESCE,
-- qty di belakang) — dipakai laba_rugi_summary + list_orders_enriched.
DO $fold2$
DECLARE
  v_oid oid; v_def text; v_new text;
  v_fns text[] := ARRAY[
    'analytics_overview','compute_order_costs','analytics_profit_per_product',
    'analytics_overview_v2','analytics_profit_per_product_v2','list_orders_enriched',
    'laba_rugi_summary','analytics_variant_per_product','analytics_overview_v3',
    'analytics_overview_v4','analytics_profit_per_product_v3',
    'analytics_profit_per_product_per_platform'
  ];
BEGIN
  FOR v_oid IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY(v_fns)
  LOOP
    v_def := pg_get_functiondef(v_oid);
    IF v_def IS NULL OR v_def LIKE '%packing_fee_snapshot%' THEN CONTINUE; END IF;
    v_new := regexp_replace(
      v_def,
      '(\w+)\.hpp_snapshot\s*\*\s*(\w+)\.qty',
      '(\1.hpp_snapshot + COALESCE(\1.packing_fee_snapshot, 0)) * \2.qty',
      'g'
    );
    IF v_new <> v_def THEN EXECUTE v_new; END IF;
  END LOOP;
END;
$fold2$;

-- NB: tidak recompute estimated_profit existing orders — packing_fee_snapshot=0
-- utk semua order lama (historis stabil, sesuai brief). Order baru / order yg
-- item-nya di-edit akan otomatis ikut packing via trigger compute_order_costs.
