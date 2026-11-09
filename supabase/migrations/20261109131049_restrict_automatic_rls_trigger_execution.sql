-- This optional hardening step applies when auto-RLS function exists.
-- A clean project without that Supabase dashboard option must still bootstrap.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
