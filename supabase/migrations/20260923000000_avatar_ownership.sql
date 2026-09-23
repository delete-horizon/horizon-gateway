-- User-owned avatars, forked parts, and purchase entitlements.
-- Official parts stay in the on-disk catalog. These rows are personal copies.

create table if not exists public.avatar_user_parts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  slot text not null,
  slug text not null default '',
  ko text not null default '',
  en text not null default '',
  set_key text not null default '',
  shop boolean not null default false,
  glyphs jsonb not null,
  copied_from text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avatar_user_parts_slot_check check (slot in ('body', 'head', 'outfit', 'back', 'held'))
);

create table if not exists public.avatar_owned (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name_ko text not null default '',
  name_en text not null default '',
  body_ref text not null,
  head_ref text not null,
  outfit_ref text not null,
  back_ref text not null,
  held_ref text not null,
  palette text not null default 'dusk',
  copied_from text,
  visibility text not null default 'private',
  listed_for_sale boolean not null default false,
  price_cents integer,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint avatar_owned_visibility_check check (visibility in ('private', 'shared'))
);

create table if not exists public.avatar_entitlements (
  id uuid primary key default gen_random_uuid(),
  avatar_id uuid not null references public.avatar_owned (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  revision integer not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (avatar_id, buyer_id)
);

create index if not exists avatar_user_parts_owner_idx on public.avatar_user_parts (owner_id);
create index if not exists avatar_owned_owner_idx on public.avatar_owned (owner_id);
create index if not exists avatar_owned_visibility_idx on public.avatar_owned (visibility);

alter table public.avatar_user_parts enable row level security;
alter table public.avatar_owned enable row level security;
alter table public.avatar_entitlements enable row level security;

drop policy if exists avatar_user_parts_owner on public.avatar_user_parts;
create policy avatar_user_parts_owner on public.avatar_user_parts
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists avatar_user_parts_shared_read on public.avatar_user_parts;
create policy avatar_user_parts_shared_read on public.avatar_user_parts
  for select to authenticated
  using (
    exists (
      select 1
      from public.avatar_owned owned
      where owned.owner_id = avatar_user_parts.owner_id
        and (owned.visibility = 'shared' or owned.listed_for_sale)
        and (
          owned.body_ref = 'user:' || avatar_user_parts.id::text
          or owned.head_ref = 'user:' || avatar_user_parts.id::text
          or owned.outfit_ref = 'user:' || avatar_user_parts.id::text
          or owned.back_ref = 'user:' || avatar_user_parts.id::text
          or owned.held_ref = 'user:' || avatar_user_parts.id::text
        )
    )
  );

drop policy if exists avatar_owned_owner on public.avatar_owned;
create policy avatar_owned_owner on public.avatar_owned
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists avatar_owned_shared_read on public.avatar_owned;
create policy avatar_owned_shared_read on public.avatar_owned
  for select to authenticated
  using (visibility = 'shared' or listed_for_sale);

drop policy if exists avatar_entitlements_read on public.avatar_entitlements;
create policy avatar_entitlements_read on public.avatar_entitlements
  for select to authenticated
  using (
    buyer_id = auth.uid()
    or exists (
      select 1 from public.avatar_owned owned
      where owned.id = avatar_id and owned.owner_id = auth.uid()
    )
  );

drop policy if exists avatar_entitlements_buy on public.avatar_entitlements;
create policy avatar_entitlements_buy on public.avatar_entitlements
  for insert to authenticated
  with check (
    buyer_id = auth.uid()
    and exists (
      select 1 from public.avatar_owned owned
      where owned.id = avatar_id
        and owned.listed_for_sale
        and owned.owner_id <> auth.uid()
    )
  );

drop policy if exists avatar_entitlements_owner_update on public.avatar_entitlements;
create policy avatar_entitlements_owner_update on public.avatar_entitlements
  for update to authenticated
  using (
    exists (
      select 1 from public.avatar_owned owned
      where owned.id = avatar_id and owned.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.avatar_owned owned
      where owned.id = avatar_id and owned.owner_id = auth.uid()
    )
  );

create or replace function public.avatar_author_name(target uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(nullif(display_name, ''), '회원')
  from public.profiles
  where id = target
    and exists (
      select 1
      from public.avatar_owned owned
      where owned.owner_id = target
        and (owned.visibility = 'shared' or owned.listed_for_sale)
    );
$$;
