-- Existing function grants are preserved. Future functions created by postgres
-- need explicit grants. PUBLIC's built-in default is global: a schema-only
-- REVOKE cannot remove it. Do not alter provider-managed creator roles.
BEGIN;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
COMMIT;
