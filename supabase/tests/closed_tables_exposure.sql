-- All explicitly closed tables use SECURITY DEFINER RPC gates only.
-- This protects intentional RLS-without-policy tables from accidental REST grants.
DO $closed_table_policy$
DECLARE t record; role_name text; operation text; grants integer:=0; checked integer:=0;
BEGIN
 FOR t IN
   SELECT c.oid,c.relname
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')
     AND c.relrowsecurity
     AND NOT EXISTS(
       SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
     )
 LOOP
   checked:=checked+1;
   FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
     FOREACH operation IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
       IF has_table_privilege(role_name,t.oid,operation) THEN
         RAISE EXCEPTION 'Closed table public.% unexpectedly grants % to %',
           t.relname,operation,role_name;
       END IF;
     END LOOP;
   END LOOP;
 END LOOP;
 IF checked < 10 THEN
   RAISE EXCEPTION 'Expected at least 10 explicitly closed application tables, found %',checked;
 END IF;
END;
$closed_table_policy$;
