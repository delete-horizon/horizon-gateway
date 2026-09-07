-- Team chat signaling (no message bodies — P2P only).

create table if not exists public.device_keys (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,
  x25519_public text not null,
  updated_at timestamptz not null default now(),
  primary key (profile_id, device_id)
);

create table if not exists public.peer_sessions (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  device_id text not null,
  lan_hosts jsonb not null default '[]'::jsonb,
  lan_port int not null default 0,
  tunnel_url text,
  is_host boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, profile_id, device_id)
);

create table if not exists public.chat_rooms (
  id text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind text not null check (kind in ('dm', 'group')),
  name text,
  host_profile_id uuid references public.profiles (id) on delete set null,
  member_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_chat_rooms_workspace on public.chat_rooms (workspace_id);
create index if not exists idx_peer_sessions_workspace on public.peer_sessions (workspace_id);
create index if not exists idx_device_keys_profile on public.device_keys (profile_id);

alter table public.device_keys enable row level security;
alter table public.peer_sessions enable row level security;
alter table public.chat_rooms enable row level security;

drop policy if exists "device_keys_select_peers" on public.device_keys;
create policy "device_keys_select_peers" on public.device_keys
  for select to authenticated
  using (public.shares_workspace_with(profile_id));

drop policy if exists "device_keys_upsert_own" on public.device_keys;
create policy "device_keys_upsert_own" on public.device_keys
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "peer_sessions_select_ws" on public.peer_sessions;
create policy "peer_sessions_select_ws" on public.peer_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = peer_sessions.workspace_id
        and m.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = peer_sessions.workspace_id and w.owner_id = auth.uid()
    )
  );

drop policy if exists "peer_sessions_upsert_own" on public.peer_sessions;
create policy "peer_sessions_upsert_own" on public.peer_sessions
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists "chat_rooms_select_ws" on public.chat_rooms;
create policy "chat_rooms_select_ws" on public.chat_rooms
  for select to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = chat_rooms.workspace_id
        and m.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = chat_rooms.workspace_id and w.owner_id = auth.uid()
    )
  );

drop policy if exists "chat_rooms_write_member" on public.chat_rooms;
create policy "chat_rooms_write_member" on public.chat_rooms
  for all to authenticated
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = chat_rooms.workspace_id
        and m.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = chat_rooms.workspace_id and w.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = chat_rooms.workspace_id
        and m.profile_id = auth.uid()
    )
    or exists (
      select 1 from public.workspaces w
      where w.id = chat_rooms.workspace_id and w.owner_id = auth.uid()
    )
  );
