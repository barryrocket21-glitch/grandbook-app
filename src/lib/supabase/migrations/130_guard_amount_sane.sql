-- =============================================================
-- Migration 130 — guard nilai uang absurd (cegah overflow numeric(12,2))
-- =============================================================
-- Kasus: WA paste salah parse -> total/price = 1.8 TRILIUN -> pas sync/promote,
-- cost engine overflow numeric(12,2) -> SELURUH batch sync gagal. Guard: tolak
-- total/cod/shipping >= 1 miliar (gak ada order COD sebesar itu) di insert.
-- Parse-error ke depan ke-reject per-row (loud), bukan simpan sampah diam2.
-- Data existing udah dibersihin (order 1953). Idempotent.
-- =============================================================
ALTER TABLE public.orders_draft DROP CONSTRAINT IF EXISTS chk_draft_amounts_sane;
ALTER TABLE public.orders_draft ADD CONSTRAINT chk_draft_amounts_sane CHECK (
  COALESCE(total,0) < 1000000000 AND COALESCE(cod_amount,0) < 1000000000 AND COALESCE(ABS(shipping_cost),0) < 1000000000
);
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS chk_orders_amounts_sane;
ALTER TABLE public.orders ADD CONSTRAINT chk_orders_amounts_sane CHECK (
  COALESCE(total,0) < 1000000000 AND COALESCE(cod_amount,0) < 1000000000 AND COALESCE(ABS(shipping_cost),0) < 1000000000
);
