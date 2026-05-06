-- Phase 8: tracking ongkir actual untuk hitung selisih ongkir
-- Sudah diapply ke production via exec_sql RPC.
--
-- Selisih = shipping_cost (charged ke customer) - shipping_cost_actual (yang dibayar ke ekspedisi)
-- Positif: kita untung (diskon dari ekspedisi)
-- Negatif: kita rugi (CS kasih diskon ke customer)

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shipping_cost_actual numeric;

COMMENT ON COLUMN public.orders.shipping_cost_actual IS
  'Ongkir yang sebenarnya kita bayar ke ekspedisi (after diskon ekspedisi atau setelah CS kasih potongan ke customer). Diff = shipping_cost - shipping_cost_actual.';
