-- Backfill missing workspace owner rows into workspace_members.
-- Owners can be referenced only via workspaces.owner_id; list UI reads workspace_members.

insert into public.workspace_members (workspace_id, profile_id, role)
select w.id, w.owner_id, 'owner'
from public.workspaces w
where w.owner_id is not null
  and not exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = w.id
      and m.profile_id = w.owner_id
  )
on conflict (workspace_id, profile_id) do update
set role = excluded.role;

-- Keep owner role in sync when a non-owner row already exists for the owner profile.
update public.workspace_members m
set role = 'owner'
from public.workspaces w
where m.workspace_id = w.id
  and m.profile_id = w.owner_id
  and m.role is distinct from 'owner';
