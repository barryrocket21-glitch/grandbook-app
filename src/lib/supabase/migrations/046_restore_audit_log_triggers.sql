-- =============================================================
-- Phase 8I-Followup Fix 4.2 — Restore audit_log triggers
-- Migration 046 — 2026-05-20
-- =============================================================
-- Incident 2026-05-19: accidental reset via /settings/reset-data → 24 orders
-- tanggal 19 Mei HARD DELETED. Audit log ga track DELETE karena triggers di
-- orders/order_items/order_status_history/commissions sudah ke-drop pas Phase
-- 8E refactor (saat re-design status_changed_at + new enrichment columns).
--
-- Recovery butuh backfill manual dari file SPX Pelacakan + Customer Reference
-- (lucky preserved via Phase 8G outbound feature).
--
-- Fix: re-create audit_log triggers untuk 4 tabel utama:
--   - orders                (INSERT, UPDATE, DELETE)
--   - order_items           (INSERT, UPDATE, DELETE)
--   - order_status_history  (DELETE only — INSERT happens via trigger sendiri,
--                            log INSERT akan duplicate noise)
--   - commissions           (INSERT, UPDATE, DELETE)
--
-- SECURITY DEFINER + SET search_path TO 'public' supaya:
-- 1) Bisa INSERT ke audit_log walau caller ga punya privilege langsung
-- 2) Lulus advisor `function_search_path_mutable`
--
-- audit.uid() yang dipakai capture user yang melakukan operation. Kalau
-- operation lewat service role (mis. background job), v_user_id = NULL —
-- masih ke-log, hanya tanpa user attribution. Better than nothing.
--
-- Idempotent: DROP TRIGGER IF EXISTS + CREATE OR REPLACE FUNCTION.
-- =============================================================

-- =============================================================
-- orders trigger
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_orders_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, new_value)
    VALUES (v_user_id, 'orders', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'orders', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'orders', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_orders ON public.orders;
CREATE TRIGGER trg_audit_log_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_orders_trigger();

-- =============================================================
-- order_items trigger
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_order_items_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, new_value)
    VALUES (v_user_id, 'order_items', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'order_items', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'order_items', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_order_items ON public.order_items;
CREATE TRIGGER trg_audit_log_order_items
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_order_items_trigger();

-- =============================================================
-- order_status_history trigger — DELETE only (INSERT auto via log_order_status_change)
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_order_status_history_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'order_status_history', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_order_status_history ON public.order_status_history;
CREATE TRIGGER trg_audit_log_order_status_history
  AFTER DELETE ON public.order_status_history
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_order_status_history_trigger();

-- =============================================================
-- commissions trigger
-- =============================================================
CREATE OR REPLACE FUNCTION public.audit_log_commissions_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, new_value)
    VALUES (v_user_id, 'commissions', NEW.id::text, 'INSERT', to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value, new_value)
    VALUES (v_user_id, 'commissions', NEW.id::text, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(user_id, table_name, record_id, action, old_value)
    VALUES (v_user_id, 'commissions', OLD.id::text, 'DELETE', to_jsonb(OLD));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_audit_log_commissions ON public.commissions;
CREATE TRIGGER trg_audit_log_commissions
  AFTER INSERT OR UPDATE OR DELETE ON public.commissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_commissions_trigger();
