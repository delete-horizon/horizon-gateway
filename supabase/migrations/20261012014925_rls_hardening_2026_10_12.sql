-- DH Supabase RLS fix (project fcngkhnadezrggqgwhuk)
-- Written 2026-09-29 from a read-only review of the live policies.
-- Revised 2026-10-12: seat_limit 3, ownership transfer allowed for current owner, 'revoked' = decline,
--   shareable-token (email 'link@shareable') carve-out so the existing app flows keep working.
-- Apply in one go (SQL editor or as a migration). Everything runs in one transaction.
-- Rollback: 99_rollback.sql


-- ============================================================
-- 1) profiles: stop anyone (including logged-out visitors) from reading every email / github id
--    What remains: read your own row + rows of people you share a workspace with.
--    avatar_author_name() is SECURITY DEFINER, so shared-avatar author names keep working.
-- ============================================================
drop policy if exists "Allow public read for profiles" on public.profiles;


-- ============================================================
-- 2) team_entitlement / sponsor fields: only the server may set them
--    - UPDATE: team_entitlement is now guarded along with the sponsor fields.
--    - INSERT: the old trigger only ran on UPDATE, so a user could create their own profile row
--      with is_sponsor / team_entitlement already set. On insert from the API these are reset.
--    - Only requests coming through the API (session_user = 'authenticator') without the
--      service_role key are restricted. Direct DB/SQL editor sessions are not blocked.
-- ============================================================
create or replace function public.prevent_sponsor_field_tamper()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated'))
     and coalesce(auth.role(), 'anon') is distinct from 'service_role' then
    if tg_op = 'INSERT' then
      new.is_sponsor       := false;
      new.sponsor_tier     := null;
      new.sponsor_since    := null;
      new.team_entitlement := null;
    elsif new.is_sponsor       is distinct from old.is_sponsor
       or new.sponsor_tier     is distinct from old.sponsor_tier
       or new.sponsor_since    is distinct from old.sponsor_since
       or new.team_entitlement is distinct from old.team_entitlement then
      raise exception 'is_sponsor / sponsor_tier / sponsor_since / team_entitlement can only be updated by the server';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_prevent_sponsor_tamper on public.profiles;
create trigger trg_prevent_sponsor_tamper
  before insert or update on public.profiles
  for each row execute function public.prevent_sponsor_field_tamper();


-- ============================================================
-- 3) workspace_invites: remove "OR status = 'pending'"
--    Before: any signed-in user could read every pending invite (token, email) and edit it (role, email).
--    After: workspace members can read; admins can edit; the invitee (matching email) can only
--    move their own pending invite to accepted/declined.
-- ============================================================
drop policy if exists workspace_invites_select_member_or_invitee on public.workspace_invites;
create policy workspace_invites_select_member_or_invitee
  on public.workspace_invites for select to authenticated
  using (
    is_workspace_member(workspace_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
    or (email = 'link@shareable' and status = 'pending')
  );

drop policy if exists workspace_invites_update_admin_or_invitee on public.workspace_invites;
create policy workspace_invites_update_admin_or_invitee
  on public.workspace_invites for update to authenticated
  using (
    is_workspace_admin(workspace_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
    or (email = 'link@shareable' and status = 'pending')
  )
  with check (
    is_workspace_admin(workspace_id)
    or lower(email) = lower(auth.jwt() ->> 'email')
    or email = 'link@shareable'
  );

create or replace function public.guard_invitee_invite_update()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated'))
     and coalesce(auth.role(), 'anon') is distinct from 'service_role'
     and not public.is_workspace_admin(old.workspace_id) then
    if new.workspace_id is distinct from old.workspace_id
       or new.email      is distinct from old.email
       or new.role       is distinct from old.role
       or new.token      is distinct from old.token
       or new.invited_by is distinct from old.invited_by then
      raise exception 'invitee can only change the invite status';
    end if;
    -- app: acceptInvite sets 'accepted', declineInvite sets 'revoked' (status check allows pending/accepted/revoked/expired)
    if old.status <> 'pending' or new.status not in ('accepted', 'revoked') then
      raise exception 'invitee can only accept or decline a pending invite';
    end if;
    if old.email = 'link@shareable' and new.status <> 'accepted' then
      raise exception 'a shareable invite can only be accepted by a non-admin';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_invitee_invite_update on public.workspace_invites;
create trigger trg_guard_invitee_invite_update
  before update on public.workspace_invites
  for each row execute function public.guard_invitee_invite_update();


-- ============================================================
-- 4) workspace_members (found while re-checking today)
--    Before: insert_self only checked profile_id = auth.uid(), so any signed-in user could add
--    themselves to ANY workspace with ANY role (even 'owner'). update_admin also allowed
--    profile_id = auth.uid(), so a plain member could promote their own row to admin.
--    After: you can add yourself only as the workspace owner, or with a matching invite
--    (same workspace, same role, your email). Only admins can change member rows.
-- ============================================================
drop policy if exists workspace_members_insert_self on public.workspace_members;
create policy workspace_members_insert_self
  on public.workspace_members for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (
      exists (
        select 1 from public.workspaces w
        where w.id = workspace_members.workspace_id
          and w.owner_id = auth.uid()
      )
      or exists (
        select 1 from public.workspace_invites i
        where i.workspace_id = workspace_members.workspace_id
          and i.role = workspace_members.role
          and (
            (lower(i.email) = lower(auth.jwt() ->> 'email') and i.status in ('pending', 'accepted'))
            or (i.email = 'link@shareable' and i.status = 'pending')
          )
      )
    )
  );

drop policy if exists workspace_members_update_admin on public.workspace_members;
create policy workspace_members_update_admin
  on public.workspace_members for update to authenticated
  using (is_workspace_admin(workspace_id))
  with check (is_workspace_admin(workspace_id));

-- ============================================================
-- 5) workspaces: plan / seat_limit / status / ls_subscription_id are billing fields (added 2026-10-05)
--    Before: workspaces_update_admin let any workspace admin change every column, and
--    workspaces_insert_owner let any signed-in user create a workspace with plan='pro'
--    and any seat_limit. Only the lemon-squeezy-webhook (service_role) should set these.
--    After: on insert from the API they are reset to the defaults (free / 3 / active / null);
--    on update from the API, changing them raises an error. name etc. stay editable by admins.
-- ============================================================
create or replace function public.guard_workspace_billing_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (session_user = 'authenticator' or coalesce(auth.role(), '') in ('anon', 'authenticated'))
     and coalesce(auth.role(), 'anon') is distinct from 'service_role' then
    if tg_op = 'INSERT' then
      new.plan               := 'free';
      new.seat_limit         := 3;  -- matches src/entities/team/api.ts:29 and migration 20260806000000
      new.status             := 'active';
      new.ls_subscription_id := null;
    elsif new.plan               is distinct from old.plan
       or new.seat_limit         is distinct from old.seat_limit
       or new.status             is distinct from old.status
       or new.ls_subscription_id is distinct from old.ls_subscription_id then
      raise exception 'plan / seat_limit / status / ls_subscription_id can only be changed by the server';
    elsif new.owner_id is distinct from old.owner_id
      -- app: transferWorkspaceOwnership. Only the current owner may hand over, and only to an existing member.
      and not (
        old.owner_id = auth.uid()
        and exists (
          select 1 from public.workspace_members m
          where m.workspace_id = old.id and m.profile_id = new.owner_id
        )
      ) then
      raise exception 'only the current owner can transfer ownership, and only to an existing member';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_guard_workspace_billing_fields on public.workspaces;
create trigger trg_guard_workspace_billing_fields
  before insert or update on public.workspaces
  for each row execute function public.guard_workspace_billing_fields();

