-- Run ONLY in disposable Supabase; all test identities and writes roll back.
BEGIN;

INSERT INTO auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
VALUES
('11111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','owner-test@itqan.invalid',now(),now(),now()),
('22222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','staff-test@itqan.invalid',now(),now(),now());
INSERT INTO public.user_roles(user_id,role_code)
VALUES ('11111111-1111-4111-8111-111111111111','site_admin');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);

DO $$
DECLARE s_empty uuid; s_linked uuid; s_second uuid; duplicate_rejected boolean;
BEGIN
  INSERT INTO public.schools(name) VALUES('Temporary empty school') RETURNING id INTO s_empty;
  IF NOT EXISTS (SELECT 1 FROM public.site_admin_audit
                 WHERE operation='school.create' AND target_id=s_empty) THEN
    RAISE EXCEPTION 'School creation audit missing';
  END IF;
  UPDATE public.schools SET name='Edited empty school' WHERE id=s_empty;
  IF NOT EXISTS (SELECT 1 FROM public.site_admin_audit
                 WHERE operation='school.update' AND target_id=s_empty) THEN
    RAISE EXCEPTION 'School edit audit missing';
  END IF;
  PERFORM public.itqan_admin_delete_empty_school(s_empty);
  IF EXISTS(SELECT 1 FROM public.schools WHERE id=s_empty) THEN
    RAISE EXCEPTION 'Empty school deletion failed';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.site_admin_audit
                WHERE operation='school.delete' AND target_id=s_empty) THEN
    RAISE EXCEPTION 'School deletion audit missing';
  END IF;

  INSERT INTO public.schools(name) VALUES('Temporary linked school') RETURNING id INTO s_linked;
  PERFORM public.itqan_admin_manage_membership(
    s_linked,'22222222-2222-4222-8222-222222222222','school_principal','principal','active');
  IF NOT EXISTS(SELECT 1 FROM public.school_memberships
                WHERE school_id=s_linked AND user_id='22222222-2222-4222-8222-222222222222'
                AND access_role='school_principal' AND status='active') THEN
    RAISE EXCEPTION 'Membership grant failed';
  END IF;
  -- A second school may not be active for the same account, even through a privileged RPC.
  INSERT INTO public.schools(name) VALUES('Temporary second school') RETURNING id INTO s_second;
  duplicate_rejected := false;
  BEGIN
    PERFORM public.itqan_admin_manage_membership(
      s_second,'22222222-2222-4222-8222-222222222222','employee','teacher','active');
  EXCEPTION WHEN unique_violation THEN
    duplicate_rejected := true;
  END;
  IF NOT duplicate_rejected THEN
    RAISE EXCEPTION 'A second active school was allowed for one account';
  END IF;
  IF EXISTS (SELECT 1 FROM public.school_memberships WHERE school_id=s_second
    AND user_id='22222222-2222-4222-8222-222222222222') THEN
    RAISE EXCEPTION 'Rejected school membership unexpectedly persisted';
  END IF;

  -- Inactive historical membership is retained and allows a new active school.
  PERFORM public.itqan_admin_manage_membership(
    s_linked,'22222222-2222-4222-8222-222222222222','school_principal','principal','inactive');
  PERFORM public.itqan_admin_manage_membership(
    s_second,'22222222-2222-4222-8222-222222222222','employee','teacher','active');
  IF (SELECT count(*) FROM public.school_memberships
      WHERE user_id='22222222-2222-4222-8222-222222222222' AND status='active') <> 1
     OR NOT EXISTS (SELECT 1 FROM public.school_memberships
      WHERE school_id=s_linked AND user_id='22222222-2222-4222-8222-222222222222'
        AND status='inactive') THEN
    RAISE EXCEPTION 'Membership transfer did not preserve one active plus historical inactive';
  END IF;

  BEGIN
    PERFORM public.itqan_admin_delete_empty_school(s_linked);
    RAISE EXCEPTION 'Delete guard failed';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  PERFORM public.itqan_admin_manage_site_role('22222222-2222-4222-8222-222222222222',true);
  IF NOT EXISTS(SELECT 1 FROM public.user_roles
                WHERE user_id='22222222-2222-4222-8222-222222222222'
                AND role_code='site_admin') THEN
    RAISE EXCEPTION 'Site admin grant failed';
  END IF;
  PERFORM public.itqan_admin_manage_site_role('22222222-2222-4222-8222-222222222222',false);
  IF EXISTS(SELECT 1 FROM public.user_roles
            WHERE user_id='22222222-2222-4222-8222-222222222222'
            AND role_code='site_admin') THEN
    RAISE EXCEPTION 'Site admin revoke failed';
  END IF;
  PERFORM public.itqan_admin_set_user_status('22222222-2222-4222-8222-222222222222','disabled');
  IF NOT EXISTS(SELECT 1 FROM public.users
                WHERE id='22222222-2222-4222-8222-222222222222' AND status='disabled') THEN
    RAISE EXCEPTION 'User status update failed';
  END IF;
END $$;
ROLLBACK;
