-- ITQAN #12: one active school membership per account at a time.
-- Historical inactive memberships remain available across schools.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.school_memberships
    WHERE status = 'active'
    GROUP BY user_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existing users with multiple active schools must be reconciled before enabling this constraint';
  END IF;
END;
$$;

CREATE UNIQUE INDEX school_memberships_one_active_school_per_user
ON public.school_memberships(user_id)
WHERE status = 'active';

COMMENT ON INDEX public.school_memberships_one_active_school_per_user IS
'ITQAN #12: A user may have one active school at a time; inactive memberships preserve past schools.';
