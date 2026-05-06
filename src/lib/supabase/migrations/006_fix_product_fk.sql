-- Phase 7 fix: product FK constraints sebelumnya NO ACTION,
-- bikin DELETE produk gagal silently kalau ada order_items / commission_rules
-- yang reference. Reapply dengan ON DELETE behavior yang masuk akal.
--
-- Sudah diapply ke production via exec_sql RPC; file ini buat
-- dokumentasi & fresh installs.

ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_product_id_fkey,
  ADD CONSTRAINT order_items_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE public.commission_rules
  DROP CONSTRAINT IF EXISTS commission_rules_product_id_fkey,
  ADD CONSTRAINT commission_rules_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
