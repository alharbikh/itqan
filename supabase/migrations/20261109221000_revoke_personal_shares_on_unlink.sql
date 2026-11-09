-- Closing a school membership must also revoke personal evidence sharing with the former school.
-- Historical school evidence records and published evaluations remain retained independently.
create or replace function itqan_private.freeze_school_reviews_and_delegations()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status='active' and new.status='inactive' then
  update public.performance_reviews set status='frozen',updated_at=now()
   where school_id=old.school_id and subject_user_id=old.user_id and status in ('draft','submitted');
  update public.school_review_delegations set revoked_at=now()
   where school_id=old.school_id and revoked_at is null
    and (delegate_user_id=old.user_id or subject_user_id=old.user_id);
  update public.personal_evidence_shares set revoked_at=now()
   where school_id=old.school_id and user_id=old.user_id and revoked_at is null;
 end if;
 return new;
end;$$;
