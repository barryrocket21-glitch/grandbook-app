-- 063 — Phase 8C: variant matcher + auto-capture trigger + backfill.
-- Applied via Supabase MCP (apply_migration: variant_matcher_and_backfill).
--
-- order_items.variant_id selama ini NULL semua (0/1067). Varian-nya kebawa
-- di teks product_name_raw ("...Ukuran: 6 X 3"). Fungsi ini resolve varian:
--   - produk 1 varian        → varian itu
--   - produk multi-varian    → cocokin nama varian (dinormalisasi) sebagai
--                              substring di teks raw; ambil match terpanjang,
--                              kalau seri panjang → NULL (ambigu).
-- Trigger BEFORE INSERT order_items → auto-isi variant_id (semua jalur input).
-- Backfill order_items existing dengan trigger noise di-disable sementara.

CREATE OR REPLACE FUNCTION public.match_product_variant(p_product_id bigint, p_raw text)
RETURNS bigint
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $func$
DECLARE
  v_count int;
  v_id bigint;
  v_norm_raw text;
  v_norm_variant text;
  r RECORD;
  v_best_id bigint := NULL;
  v_best_len int := 0;
BEGIN
  IF p_product_id IS NULL THEN RETURN NULL; END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.product_variants
  WHERE product_id = p_product_id AND active;

  IF v_count = 0 THEN RETURN NULL; END IF;

  -- Produk 1 varian → langsung varian itu
  IF v_count = 1 THEN
    SELECT id INTO v_id FROM public.product_variants
    WHERE product_id = p_product_id AND active;
    RETURN v_id;
  END IF;

  -- Multi-varian → cocokin nama varian sebagai substring teks raw
  IF p_raw IS NULL OR btrim(p_raw) = '' THEN RETURN NULL; END IF;
  v_norm_raw := lower(regexp_replace(p_raw, '[^a-z0-9]', '', 'gi'));

  FOR r IN
    SELECT id, variant_name FROM public.product_variants
    WHERE product_id = p_product_id AND active
  LOOP
    v_norm_variant := lower(regexp_replace(COALESCE(r.variant_name, ''), '[^a-z0-9]', '', 'gi'));
    IF length(v_norm_variant) >= 2 AND position(v_norm_variant IN v_norm_raw) > 0 THEN
      IF length(v_norm_variant) > v_best_len THEN
        v_best_len := length(v_norm_variant);
        v_best_id := r.id;
      ELSIF length(v_norm_variant) = v_best_len THEN
        v_best_id := NULL;  -- seri panjang → ambigu, jangan tebak
      END IF;
    END IF;
  END LOOP;

  RETURN v_best_id;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.match_product_variant(bigint, text) FROM anon, authenticated, public;

-- Auto-capture: tiap order_item baru, kalau variant_id belum di-set, resolve
-- dari product_name_raw. Berlaku untuk semua jalur insert (import, WA paste,
-- form manual, promote draft).
CREATE OR REPLACE FUNCTION public.set_order_item_variant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $func$
BEGIN
  IF NEW.variant_id IS NULL AND NEW.product_id IS NOT NULL THEN
    NEW.variant_id := public.match_product_variant(NEW.product_id, NEW.product_name_raw);
  END IF;
  RETURN NEW;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.set_order_item_variant() FROM anon, authenticated, public;

DROP TRIGGER IF EXISTS trg_set_order_item_variant ON public.order_items;
CREATE TRIGGER trg_set_order_item_variant
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_order_item_variant();

-- Backfill order_items existing. Audit / recompute / hpp-snapshot trigger
-- di-disable sementara supaya tidak nyampah audit log, recompute massal, atau
-- nimpa hpp_snapshot historis. Fresh setup: no-op (0 order_items).
ALTER TABLE public.order_items DISABLE TRIGGER trg_audit_log_order_items;
ALTER TABLE public.order_items DISABLE TRIGGER trg_order_items_recompute;
ALTER TABLE public.order_items DISABLE TRIGGER trg_snapshot_hpp_order_items;

UPDATE public.order_items
SET variant_id = public.match_product_variant(product_id, product_name_raw)
WHERE variant_id IS NULL AND product_id IS NOT NULL;

ALTER TABLE public.order_items ENABLE TRIGGER trg_audit_log_order_items;
ALTER TABLE public.order_items ENABLE TRIGGER trg_order_items_recompute;
ALTER TABLE public.order_items ENABLE TRIGGER trg_snapshot_hpp_order_items;
