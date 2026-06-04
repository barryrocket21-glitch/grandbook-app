-- 121 — #1 Auto-atribusi: resolve campaign/ADV OTOMATIS pas order masuk.
-- ============================================================================
-- Sebelumnya resolve_order_attribution cuma jalan MANUAL (tombol Distribusi),
-- jadi 0 order ke-resolve walau kode atribusi udah ke-capture. Trigger ini
-- auto-panggil resolver pas order_draft di-insert dengan kode atribusi → ADV +
-- campaign keisi sendiri. Yg gak nemu campaign tetap pending → Inbox Atribusi.
-- Idempotent.

CREATE OR REPLACE FUNCTION public.trg_auto_resolve_attribution()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $$
BEGIN
  -- cuma kalau ada kode atribusi & belum ke-resolve (hemat: skip yg gak relevan)
  IF COALESCE(NEW.meta->>'atribusi_account','') <> '' AND NEW.campaign_id IS NULL THEN
    PERFORM public.resolve_order_attribution(ARRAY[NEW.id]);
  END IF;
  RETURN NULL; -- AFTER trigger
END $$;

DROP TRIGGER IF EXISTS trg_auto_resolve_attribution ON public.orders_draft;
CREATE TRIGGER trg_auto_resolve_attribution
  AFTER INSERT ON public.orders_draft
  FOR EACH ROW EXECUTE FUNCTION public.trg_auto_resolve_attribution();
