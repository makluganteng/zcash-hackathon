-- The application accesses PostgreSQL through its trusted server role, never
-- through Supabase's browser Data API. Owners/BYPASSRLS roles retain access.
-- Restrict only our tables; do not change other applications' schema defaults.
DO $$
DECLARE
  table_name text;
  api_role text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'auctions', 'creation_requests', 'bid_blobs', 'bid_submissions',
    'claim_challenges', 'invoices', 'claim_sessions', 'payment_observations',
    'worker_health'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, api_role);
      END IF;
    END LOOP;
  END LOOP;
END $$;
