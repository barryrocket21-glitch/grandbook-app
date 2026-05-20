-- =============================================================
-- PHASE 8H AUDIT: extend list_audit_logs ke admin
-- =============================================================
-- Phase 8E (migration 035) gate audit log RPC ke owner-only.
-- Phase 8H audit Indra: admin perlu akses audit log untuk
-- monitoring + recovery (cek DELETE/UPDATE history). Owner-only
-- gate di-relax ke owner+admin. Critical financial actions (e.g.
-- mark commission paid) tetap punya audit trail terlihat admin.
--
-- IDEMPOTENT: CREATE OR REPLACE overwrite definition.
-- =============================================================

CREATE OR REPLACE FUNCTION public.list_audit_logs(
  p_from timestamp with time zone DEFAULT NULL,
  p_to timestamp with time zone DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_table_name text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id bigint, user_id uuid, user_name text, user_role text,
  table_name text, record_id text, action text,
  old_value jsonb, new_value jsonb,
  created_at timestamp with time zone, total_count bigint
)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE v_role TEXT;
BEGIN
  v_role := public.get_user_role();
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Hanya owner atau admin yang bisa akses audit log' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT a.* FROM public.audit_log a
     WHERE (p_from IS NULL OR a.created_at >= p_from)
       AND (p_to IS NULL OR a.created_at <= p_to)
       AND (p_user_id IS NULL OR a.user_id = p_user_id)
       AND (p_table_name IS NULL OR a.table_name = p_table_name)
       AND (p_action IS NULL OR a.action = p_action)
       AND (p_search IS NULL OR
            a.record_id ILIKE '%' || p_search || '%' OR
            a.table_name ILIKE '%' || p_search || '%')
  ),
  total AS (SELECT COUNT(*) AS cnt FROM filtered)
  SELECT f.id, f.user_id, p.full_name AS user_name, p.role AS user_role,
    f.table_name, f.record_id, f.action, f.old_value, f.new_value, f.created_at,
    (SELECT cnt FROM total) AS total_count
  FROM filtered f
  LEFT JOIN public.profiles p ON p.id = f.user_id
  ORDER BY f.created_at DESC, f.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$function$;
