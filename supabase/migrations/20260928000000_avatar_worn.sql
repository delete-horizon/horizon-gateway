-- Last outfit the wearer published. Teammates can read it and the parts it uses.
-- It does not list the avatar in the catalog.

create table if not exists public.avatar_worn (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  body_ref text not null,
  head_ref text not null,
  outfit_ref text not null,
  back_ref text not null,
  held_ref text not null,
  updated_at timestamptz not null default now()
);

alter table public.avatar_worn enable row level security;

create or replace function public.shares_workspace(other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select other = auth.uid()
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs
        on theirs.workspace_id = mine.workspace_id
      where mine.profile_id = auth.uid()
        and theirs.profile_id = other
    )
    or exists (
      select 1
      from public.workspaces owned_by_me
      join public.workspace_members member on member.workspace_id = owned_by_me.id
      where owned_by_me.owner_id = auth.uid()
        and member.profile_id = other
    )
    or exists (
      select 1
      from public.workspaces owned_by_them
      join public.workspace_members member on member.workspace_id = owned_by_them.id
      where owned_by_them.owner_id = other
        and member.profile_id = auth.uid()
    );
$$;

grant execute on function public.shares_workspace(uuid) to authenticated;

grant select, insert, update on public.avatar_worn to authenticated;

drop policy if exists avatar_worn_owner_write on public.avatar_worn;
create policy avatar_worn_owner_write on public.avatar_worn
  for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

drop policy if exists avatar_worn_team_read on public.avatar_worn;
create policy avatar_worn_team_read on public.avatar_worn
  for select to authenticated
  using (public.shares_workspace(profile_id));

drop policy if exists avatar_user_parts_worn_team_read on public.avatar_user_parts;
create policy avatar_user_parts_worn_team_read on public.avatar_user_parts
  for select to authenticated
  using (
    exists (
      select 1
      from public.avatar_worn worn
      where public.shares_workspace(worn.profile_id)
        and (
          worn.body_ref = 'user:' || avatar_user_parts.id::text
          or worn.head_ref = 'user:' || avatar_user_parts.id::text
          or worn.outfit_ref = 'user:' || avatar_user_parts.id::text
          or worn.back_ref = 'user:' || avatar_user_parts.id::text
          or worn.held_ref = 'user:' || avatar_user_parts.id::text
        )
    )
  );
