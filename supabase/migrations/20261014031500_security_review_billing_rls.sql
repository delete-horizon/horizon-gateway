-- Billing, invite, and profile least-privilege hardening.
-- Apply this migration BEFORE deploying edge functions. create-checkout,
-- lemon-squeezy-webhook, and github-sponsors-webhook call the RPCs and
-- columns introduced here.
--
-- private is not in [api] schemas. Tables there are service paths for
-- security definer functions only.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.api_rate_limits (
  bucket text primary key,
  window_started_at timestamptz not null,
  hits integer not null
);

create table if not exists private.invite_accept_nonce (
  nonce uuid primary key,
  uid uuid not null,
  invite_id uuid not null,
  workspace_id uuid not null,
  created_at timestamptz not null default now()
);

alter table private.api_rate_limits enable row level security;
alter table private.invite_accept_nonce enable row level security;
revoke all on private.api_rate_limits from public, anon, authenticated, service_role;
revoke all on private.invite_accept_nonce from public, anon, authenticated, service_role;

alter table public.profiles
  add column if not exists sponsor_cycle_at timestamptz;

comment on column public.profiles.sponsor_cycle_at is
  'GitHub sponsorship.created_at of the last applied sponsors webhook. Server write only.';

-- GitHub identity is matched by the sponsors webhook. Skip the unique index
-- when historical duplicates already exist so this migration can still apply.
do $$
begin
  if not exists (
    select 1
    from public.profiles
    where github_id is not null
    group by github_id
    having count(*) > 1
  ) then
    create unique index if not exists profiles_github_id_key
      on public.profiles (github_id)
      where github_id is not null;
  else
    raise notice 'skipped profiles_github_id_key because duplicate github_id values exist';
  end if;

  if not exists (
    select 1
    from public.profiles
    where github_login is not null
    group by lower(github_login)
    having count(*) > 1
  ) then
    create unique index if not exists profiles_github_login_key
      on public.profiles (lower(github_login))
      where github_login is not null;
  else
    raise notice 'skipped profiles_github_login_key because duplicate github_login values exist';
  end if;
end $$;

create or replace function private.github_identity()
returns table (provider_id text, login text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when i.provider_id ~ '^[0-9]{1,12}$' then i.provider_id
      else null
    end,
    case
      when coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')
        ~ '^[A-Za-z0-9-]{1,39}$'
        then coalesce(i.identity_data ->> 'user_name', i.identity_data ->> 'preferred_username')
      else null
    end
  from auth.identities i
  where i.user_id = auth.uid()
    and i.provider = 'github'
  limit 1;
$$;

revoke all on function private.github_identity() from public, anon, authenticated, service_role;

-- Privileged profile columns are server-managed. GitHub id/login may be filled
-- only from auth.identities (user_metadata is editable and is not consulted).
create or replace function public.guard_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ident_id text;
  ident_login text;
  jwt_email text;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  select g.provider_id, g.login
    into ident_id, ident_login
  from private.github_identity() g;

  jwt_email := nullif(lower(trim(coalesce(auth.jwt() ->> 'email', ''))), '');

  if tg_op = 'INSERT' then
    new.is_sponsor := false;
    new.sponsor_tier := null;
    new.sponsor_since := null;
    new.sponsor_cycle_at := null;
    new.team_entitlement := null;
    if auth.uid() is null then
      new.github_id := null;
      new.github_login := null;
    else
      new.github_id := ident_id;
      new.github_login := ident_login;
      if jwt_email is not null then
        new.email := jwt_email;
      elsif auth.uid() is not null then
        new.email := '';
      end if;
    end if;
    return new;
  end if;

  new.is_sponsor := old.is_sponsor;
  new.sponsor_tier := old.sponsor_tier;
  new.sponsor_since := old.sponsor_since;
  new.sponsor_cycle_at := old.sponsor_cycle_at;
  new.team_entitlement := old.team_entitlement;

  if jwt_email is not null then
    new.email := jwt_email;
  else
    new.email := old.email;
  end if;

  if old.github_id is null and ident_id is not null and new.github_id is not distinct from ident_id then
    new.github_id := ident_id;
  else
    new.github_id := old.github_id;
  end if;

  if ident_login is not null and new.github_login is not distinct from ident_login
     and (old.github_login is null or lower(old.github_login) = lower(ident_login)) then
    new.github_login := ident_login;
  else
    new.github_login := old.github_login;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_sponsor_tamper on public.profiles;
drop trigger if exists trg_guard_profile_privileged_columns on public.profiles;
drop function if exists public.prevent_sponsor_field_tamper();

create trigger trg_guard_profile_privileged_columns
  before insert or update on public.profiles
  for each row execute function public.guard_profile_privileged_columns();

revoke all on function public.guard_profile_privileged_columns() from public, anon, authenticated, service_role;

-- Workspace billing columns (plan, status, seat_limit, ls_subscription_id)
-- move only through the Lemon webhook (service_role). Clients may rename a
-- workspace and the current owner may transfer ownership after the new owner
-- membership row is already role = owner.
create or replace function public.guard_workspace_billing_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.name is null or char_length(trim(new.name)) < 1 or char_length(trim(new.name)) > 80 then
      raise exception 'workspace name is invalid';
    end if;
    new.name := trim(new.name);
  elsif new.name is distinct from old.name then
    if new.name is null or char_length(trim(new.name)) < 1 or char_length(trim(new.name)) > 80 then
      raise exception 'workspace name is invalid';
    end if;
    new.name := trim(new.name);
  end if;

  if tg_op = 'INSERT' then
    new.plan := 'free';
    new.status := 'active';
    new.seat_limit := 3;
    new.ls_subscription_id := null;
    if new.owner_id is distinct from auth.uid() then
      raise exception 'workspace owner must be the signed-in user';
    end if;
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.status is distinct from old.status
     or new.seat_limit is distinct from old.seat_limit
     or new.ls_subscription_id is distinct from old.ls_subscription_id then
    raise exception 'billing fields are server-managed';
  end if;

  if new.owner_id is distinct from old.owner_id then
    if old.owner_id is distinct from auth.uid() then
      raise exception 'only the workspace owner can transfer ownership';
    end if;
    if not exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = old.id
        and m.profile_id = new.owner_id
        and m.role = 'owner'
    ) then
      raise exception 'new owner must be an owner member';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_workspace_billing_fields on public.workspaces;
create trigger trg_guard_workspace_billing_fields
  before insert or update on public.workspaces
  for each row execute function public.guard_workspace_billing_fields();

revoke all on function public.guard_workspace_billing_fields() from public, anon, authenticated, service_role;

-- Direct membership inserts are limited to the workspace owner repairing their
-- own owner row. Invite acceptance goes through accept_workspace_invite, which
-- writes a one-shot nonce the trigger checks. The nonce row is not writable
-- through the Data API.
create or replace function public.guard_workspace_member_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nonce_text text;
  nonce_ok boolean := false;
  caller_is_owner boolean := false;
  caller_is_admin boolean := false;
  target_is_owner boolean := false;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.profile_id is distinct from auth.uid() then
      raise exception 'cannot add another user directly';
    end if;

    if new.role = 'owner' and exists (
      select 1
      from public.workspaces w
      where w.id = new.workspace_id
        and w.owner_id = auth.uid()
    ) then
      return new;
    end if;

    nonce_text := nullif(current_setting('app.invite_accept_nonce', true), '');
    if new.role in ('admin', 'member')
       and nonce_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select exists (
        select 1
        from private.invite_accept_nonce n
        where n.nonce = nonce_text::uuid
          and n.uid = auth.uid()
          and n.workspace_id = new.workspace_id
      ) into nonce_ok;
      if nonce_ok then
        return new;
      end if;
    end if;

    raise exception 'cannot join this workspace directly';
  end if;

  if new.profile_id is distinct from old.profile_id
     or new.workspace_id is distinct from old.workspace_id then
    raise exception 'membership identity is immutable';
  end if;

  -- Owner keeps full control, including promote-to-owner for a transfer.
  -- Admins may update a regular member only when the role stays member.
  -- They cannot grant owner or admin, edit the owner or another admin, or
  -- raise their own role.
  select exists (
    select 1
    from public.workspaces w
    where w.id = old.workspace_id
      and w.owner_id = auth.uid()
  ) into caller_is_owner;

  if caller_is_owner then
    if old.profile_id = auth.uid() and new.role not in ('owner', 'admin') then
      raise exception 'the workspace owner cannot drop below admin';
    end if;
    return new;
  end if;

  if old.profile_id = auth.uid()
     and (
       (old.role = 'member' and new.role in ('admin', 'owner'))
       or (old.role = 'admin' and new.role = 'owner')
     ) then
    raise exception 'cannot raise your own role';
  end if;

  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = old.workspace_id
      and m.profile_id = auth.uid()
      and m.role = 'admin'
  ) into caller_is_admin;

  if not caller_is_admin then
    raise exception 'only a workspace owner or admin can change roles';
  end if;

  if old.profile_id = auth.uid() then
    raise exception 'cannot change your own role';
  end if;

  select old.role = 'owner' or exists (
    select 1
    from public.workspaces w
    where w.id = old.workspace_id
      and w.owner_id = old.profile_id
  ) into target_is_owner;

  if target_is_owner or old.role = 'admin' then
    raise exception 'admins cannot change the owner or another admin';
  end if;

  if new.role in ('owner', 'admin') then
    raise exception 'admins cannot promote a member to owner or admin';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_workspace_member_write on public.workspace_members;
create trigger trg_guard_workspace_member_write
  before insert or update on public.workspace_members
  for each row execute function public.guard_workspace_member_write();

revoke all on function public.guard_workspace_member_write() from public, anon, authenticated, service_role;

create or replace function public.guard_workspace_member_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return old;
  end if;

  if exists (
    select 1
    from public.workspaces w
    where w.id = old.workspace_id
      and w.owner_id = old.profile_id
  ) then
    raise exception 'cannot remove the workspace owner';
  end if;

  return old;
end;
$$;

drop trigger if exists trg_guard_workspace_member_delete on public.workspace_members;
create trigger trg_guard_workspace_member_delete
  before delete on public.workspace_members
  for each row execute function public.guard_workspace_member_delete();

revoke all on function public.guard_workspace_member_delete() from public, anon, authenticated, service_role;

-- Invite rows: admins create member/admin invites. Email, role, token, and
-- workspace are immutable. Invitees may decline. Acceptance is only the
-- nonce path inside accept_workspace_invite.
create or replace function public.guard_invitee_invite_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  nonce_text text;
  nonce_ok boolean := false;
  caller_email text;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if not public.is_workspace_admin(new.workspace_id) then
      raise exception 'not allowed to create invites';
    end if;
    if new.role not in ('admin', 'member') then
      raise exception 'invite role is not allowed';
    end if;
    new.email := lower(trim(coalesce(new.email, '')));
    if char_length(new.email) < 3 or char_length(new.email) > 320 then
      raise exception 'invite email is invalid';
    end if;
    if new.email is distinct from 'link@shareable'
       and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'invite email is invalid';
    end if;
    return new;
  end if;

  if new.workspace_id is distinct from old.workspace_id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.token is distinct from old.token
     or new.invited_by is distinct from old.invited_by
     or new.id is distinct from old.id then
    raise exception 'invite fields are immutable';
  end if;

  if old.status is distinct from 'pending' then
    raise exception 'invite cannot be changed';
  end if;

  nonce_text := nullif(current_setting('app.invite_accept_nonce', true), '');
  if new.status = 'accepted'
     and nonce_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select exists (
      select 1
      from private.invite_accept_nonce n
      where n.nonce = nonce_text::uuid
        and n.uid = auth.uid()
        and n.invite_id = old.id
    ) into nonce_ok;
    if nonce_ok then
      return new;
    end if;
  end if;

  caller_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  if new.status = 'revoked' and (
    public.is_workspace_admin(old.workspace_id)
    or (old.email is distinct from 'link@shareable' and old.email = caller_email)
  ) then
    return new;
  end if;

  raise exception 'invite cannot be changed';
end;
$$;

drop trigger if exists trg_guard_invitee_invite_update on public.workspace_invites;
create trigger trg_guard_invitee_invite_update
  before insert or update on public.workspace_invites
  for each row execute function public.guard_invitee_invite_update();

revoke all on function public.guard_invitee_invite_update() from public, anon, authenticated, service_role;

-- Replace policies on the tables whose previous policies were broader than
-- the product rules. Permissive policies are OR'd, so a leftover remote
-- policy would keep the old hole open.
do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles',
        'feedbacks',
        'events',
        'workspaces',
        'workspace_members',
        'workspace_invites',
        'peer_sessions'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

alter table public.profiles enable row level security;
alter table public.feedbacks enable row level security;
alter table public.events enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.peer_sessions enable row level security;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_select_workspace_peers" on public.profiles
  for select to authenticated
  using (public.shares_workspace_with(id));

create policy "profiles_insert_own" on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "feedbacks_insert_bounded" on public.feedbacks
  for insert to anon, authenticated
  with check (
    (profile_id is null or profile_id = auth.uid())
    and char_length(content) between 1 and 20000
    and char_length(coalesce(category, '')) <= 32
    and char_length(coalesce(app_version, '')) <= 40
    and char_length(coalesce(os, '')) <= 40
    and char_length(coalesce(install_id, '')) <= 80
    and char_length(coalesce(context, '')) <= 200
  );

create policy "events_insert_bounded" on public.events
  for insert to anon, authenticated
  with check (
    char_length(install_id) between 1 and 80
    and char_length(event) between 1 and 64
    and char_length(coalesce(app_version, '')) <= 40
    and char_length(coalesce(os, '')) <= 40
    and pg_column_size(props) <= 8192
  );

create policy "workspaces_select_member" on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id) or owner_id = auth.uid());

create policy "workspaces_insert_owner" on public.workspaces
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "workspaces_update_admin" on public.workspaces
  for update to authenticated
  using (public.is_workspace_admin(id))
  with check (public.is_workspace_admin(id));

create policy "workspaces_delete_owner" on public.workspaces
  for delete to authenticated
  using (owner_id = auth.uid());

create policy "workspace_members_select_member" on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id) or profile_id = auth.uid());

create policy "workspace_members_insert_owner_self" on public.workspace_members
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1
      from public.workspaces w
      where w.id = workspace_id
        and w.owner_id = auth.uid()
    )
  );

create policy "workspace_members_update_owner" on public.workspace_members
  for update to authenticated
  using (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_members.workspace_id
        and w.owner_id = auth.uid()
    )
    or public.is_workspace_admin(workspace_members.workspace_id)
  )
  with check (
    exists (
      select 1
      from public.workspaces w
      where w.id = workspace_members.workspace_id
        and w.owner_id = auth.uid()
    )
    or (
      public.is_workspace_admin(workspace_members.workspace_id)
      and role = 'member'
      and profile_id is distinct from auth.uid()
    )
  );

create policy "workspace_members_delete_admin_or_self" on public.workspace_members
  for delete to authenticated
  using (public.is_workspace_admin(workspace_id) or profile_id = auth.uid());

create policy "workspace_invites_select_admin_or_invitee" on public.workspace_invites
  for select to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or (
      email is distinct from 'link@shareable'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create policy "workspace_invites_insert_admin" on public.workspace_invites
  for insert to authenticated
  with check (
    public.is_workspace_admin(workspace_id)
    and role in ('admin', 'member')
  );

create policy "workspace_invites_update_admin_or_invitee" on public.workspace_invites
  for update to authenticated
  using (
    public.is_workspace_admin(workspace_id)
    or (
      email is distinct from 'link@shareable'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  )
  with check (
    public.is_workspace_admin(workspace_id)
    or (
      email is distinct from 'link@shareable'
      and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

create policy "peer_sessions_select_ws" on public.peer_sessions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy "peer_sessions_write_own" on public.peer_sessions
  for all to authenticated
  using (profile_id = auth.uid() and public.is_workspace_member(workspace_id))
  with check (profile_id = auth.uid() and public.is_workspace_member(workspace_id));

-- Fixed windows. Callers cannot pass their own limit or window.
create or replace function public.consume_user_rate_limit(action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  max_hits integer;
  window_seconds integer;
  v_bucket text;
  current_hits integer;
  started timestamptz;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  if action = 'create_checkout' then
    max_hits := 10;
    window_seconds := 3600;
  elsif action = 'accept_invite' then
    max_hits := 30;
    window_seconds := 3600;
  else
    raise exception 'rate limit exceeded';
  end if;

  v_bucket := action || ':' || uid::text;

  insert into private.api_rate_limits (bucket, window_started_at, hits)
  values (v_bucket, now(), 0)
  on conflict (bucket) do nothing;

  select hits, window_started_at
    into current_hits, started
  from private.api_rate_limits
  where bucket = v_bucket
  for update;

  if started < now() - make_interval(secs => window_seconds) then
    update private.api_rate_limits
    set hits = 1, window_started_at = now()
    where bucket = v_bucket;
    return;
  end if;

  if current_hits >= max_hits then
    raise exception 'rate limit exceeded';
  end if;

  update private.api_rate_limits
  set hits = current_hits + 1
  where bucket = v_bucket;
end;
$$;

revoke all on function public.consume_user_rate_limit(text) from public, anon, authenticated, service_role;
grant execute on function public.consume_user_rate_limit(text) to authenticated;

create or replace function public.accept_workspace_invite(invite_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  caller_email text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  inv public.workspace_invites%rowtype;
  v_nonce uuid := gen_random_uuid();
  v_seats integer;
  v_status text;
  v_owner uuid;
  v_entitlement text;
  v_used bigint;
  v_already boolean;
  result json;
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  -- Business failures return JSON instead of raising so the rate-limit row
  -- commits. A raise would roll the attempt counter back.
  perform public.consume_user_rate_limit('accept_invite');

  if invite_token is null
     or invite_token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return json_build_object('error', 'invite not found');
  end if;

  select wi.*
    into inv
  from public.workspace_invites wi
  where wi.token = invite_token::uuid
    and wi.status = 'pending'
  for update;

  if not found then
    return json_build_object('error', 'invite not found');
  end if;

  if inv.role not in ('admin', 'member') then
    return json_build_object('error', 'invite not found');
  end if;

  if inv.email is distinct from 'link@shareable' and inv.email is distinct from caller_email then
    return json_build_object('error', 'invite not found');
  end if;

  select w.seat_limit, w.status, w.owner_id
    into v_seats, v_status, v_owner
  from public.workspaces w
  where w.id = inv.workspace_id
  for update;

  if v_owner is null then
    return json_build_object('error', 'invite not found');
  end if;

  select p.team_entitlement
    into v_entitlement
  from public.profiles p
  where p.id = v_owner;

  if v_status in ('past_due', 'canceled') and v_entitlement is null then
    return json_build_object('error', 'workspace is not active');
  end if;

  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = inv.workspace_id
      and m.profile_id = uid
  ) into v_already;

  if not v_already then
    select count(*)::bigint
      into v_used
    from public.workspace_members m
    where m.workspace_id = inv.workspace_id;

    if v_entitlement is distinct from 'unlimited' and v_used >= v_seats then
      return json_build_object('error', 'seat limit reached');
    end if;

    insert into private.invite_accept_nonce (nonce, uid, invite_id, workspace_id)
    values (v_nonce, uid, inv.id, inv.workspace_id);
    perform set_config('app.invite_accept_nonce', v_nonce::text, true);

    insert into public.workspace_members (workspace_id, profile_id, role)
    values (inv.workspace_id, uid, inv.role);
  else
    insert into private.invite_accept_nonce (nonce, uid, invite_id, workspace_id)
    values (v_nonce, uid, inv.id, inv.workspace_id);
    perform set_config('app.invite_accept_nonce', v_nonce::text, true);
  end if;

  update public.workspace_invites wi
  set status = 'accepted'
  where wi.id = inv.id
    and wi.status = 'pending';

  delete from private.invite_accept_nonce where nonce = v_nonce;

  select json_build_object(
    'id', m.id,
    'workspace_id', m.workspace_id,
    'profile_id', m.profile_id,
    'role', m.role,
    'created_at', m.created_at
  )
    into result
  from public.workspace_members m
  where m.workspace_id = inv.workspace_id
    and m.profile_id = uid;

  if result is null then
    return json_build_object('error', 'invite not found');
  end if;

  return result;
end;
$$;

revoke all on function public.accept_workspace_invite(text) from public, anon, authenticated, service_role;
grant execute on function public.accept_workspace_invite(text) to authenticated;

-- Helpers used by RLS stay callable by signed-in users. They are not part of
-- the anon surface. Trigger functions stay revoked.
revoke all on function public.is_workspace_member(uuid) from public, anon, authenticated;
revoke all on function public.is_workspace_admin(uuid) from public, anon, authenticated;
revoke all on function public.shares_workspace_with(uuid) from public, anon, authenticated;
revoke all on function public.shares_workspace(uuid) from public, anon, authenticated;
revoke all on function public.avatar_author_name(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid) to authenticated;
grant execute on function public.shares_workspace_with(uuid) to authenticated;
grant execute on function public.shares_workspace(uuid) to authenticated;
grant execute on function public.avatar_author_name(uuid) to authenticated;
