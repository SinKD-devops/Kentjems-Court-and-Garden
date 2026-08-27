-- The privilege guard on profiles blocks anyone who is not already an
-- operator from changing `role` or `is_backup_admin`. That is exactly right
-- for customers, but it also made the first operator impossible to create:
-- a direct database connection has no auth.uid(), so is_operator() is false
-- and the trigger refuses.
--
-- Trusted server contexts are allowed through: a direct psql/migration
-- connection as `postgres`, or `service_role`, which already bypasses RLS
-- entirely and so gains nothing here. A customer's session is never either
-- of those, so self-promotion is still refused.

create or replace function guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     or new.is_backup_admin is distinct from old.is_backup_admin then

    if is_operator() then
      return new;
    end if;

    -- No JWT at all means this is a server-side administrative connection,
    -- not a customer acting through the API.
    if auth.uid() is null
       and current_user in ('postgres', 'service_role', 'supabase_admin') then
      return new;
    end if;

    raise exception 'insufficient privilege: role and is_backup_admin are operator-only';
  end if;

  return new;
end;
$$;
