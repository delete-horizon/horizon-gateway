-- Follow-up to rls_hardening_2026_10_12 (remote version 20261012014925).
-- Trigger functions fire as the table owner; they do not need EXECUTE to run.
-- Drop the default grants so anon, authenticated, and public cannot call them
-- through the Data API.
--
-- Those functions are created by 20261012014925_rls_hardening_2026_10_12.sql,
-- which sorts before this file. Revoke each function only when it is installed
-- so a database that has not replayed that migration still applies.
do $$
begin
  if to_regprocedure('public.prevent_sponsor_field_tamper()') is not null then
    revoke execute on function public.prevent_sponsor_field_tamper() from anon, authenticated, public;
  end if;
  if to_regprocedure('public.guard_invitee_invite_update()') is not null then
    revoke execute on function public.guard_invitee_invite_update() from anon, authenticated, public;
  end if;
  if to_regprocedure('public.guard_workspace_billing_fields()') is not null then
    revoke execute on function public.guard_workspace_billing_fields() from anon, authenticated, public;
  end if;
end
$$;
