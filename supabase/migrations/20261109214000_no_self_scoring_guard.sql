-- Guard manager evaluation against self-rating (self-assessment remains a separate entity).
create function itqan_private.prevent_manager_self_review()
returns trigger language plpgsql set search_path='' as $$
begin
 if new.reviewer_user_id is not null and new.reviewer_user_id=new.subject_user_id then
   raise exception 'Manager may not evaluate themselves' using errcode='42501';
 end if;
 return new;
end;$$;
create trigger prevent_manager_self_review before insert or update
on public.performance_reviews for each row execute function itqan_private.prevent_manager_self_review();
