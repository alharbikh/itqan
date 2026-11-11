-- #47: isolated self-school-registration transaction; fixtures never committed.
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES ('b7777777-7777-4777-8777-777777777777',
'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
'self-school@itqan.invalid',now(),now(),now());
SET LOCAL ROLE authenticated;
DO $test$
DECLARE
 v_school uuid;
 v_count integer;
 v_failed boolean := false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub','b7777777-7777-4777-8777-777777777777',true);
 v_school:=public.itqan_self_register_school('ITQAN temporary school','9900000017','secondary','male',null);
 IF v_school IS NULL THEN RAISE EXCEPTION 'No school id returned'; END IF;
 SELECT count(*) INTO v_count FROM public.school_memberships
 WHERE school_id=v_school AND user_id='b7777777-7777-4777-8777-777777777777'
 AND access_role='school_principal' AND job_role='principal' AND status='active';
 IF v_count<>1 THEN RAISE EXCEPTION 'Principal membership missing'; END IF;
 IF NOT itqan_private.has_school_permission(v_school,'school.manage_members')
    OR itqan_private.has_system_permission('system.manage_users') THEN
    RAISE EXCEPTION 'School privilege boundary incorrect'; END IF;
 BEGIN
   PERFORM public.itqan_self_register_school('Second school','9900000018','secondary','male',null);
 EXCEPTION WHEN unique_violation THEN v_failed:=true;
 END;
 IF NOT v_failed THEN RAISE EXCEPTION 'Second active school not blocked'; END IF;
END $test$;
RESET ROLE;
ROLLBACK;
