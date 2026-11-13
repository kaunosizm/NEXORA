-- NEXORA community voice channels
create table if not exists public.community_voice_channels (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 32),
  created_by uuid not null references auth.users(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists community_voice_channels_community_sort_idx
  on public.community_voice_channels(community_id, sort_order, created_at);
create unique index if not exists community_voice_channels_unique_name_idx
  on public.community_voice_channels(community_id, lower(name));

alter table public.community_voice_channels enable row level security;
grant select, insert, update, delete on public.community_voice_channels to authenticated;

drop policy if exists "Community members read voice channels" on public.community_voice_channels;
create policy "Community members read voice channels"
on public.community_voice_channels for select to authenticated
using (private.is_community_member(community_id));

drop policy if exists "Voice managers create voice channels" on public.community_voice_channels;
create policy "Voice managers create voice channels"
on public.community_voice_channels for insert to authenticated
with check (created_by = (select auth.uid()) and private.has_community_permission(community_id, 'manage_voice'));

drop policy if exists "Voice managers update voice channels" on public.community_voice_channels;
create policy "Voice managers update voice channels"
on public.community_voice_channels for update to authenticated
using (private.has_community_permission(community_id, 'manage_voice'))
with check (private.has_community_permission(community_id, 'manage_voice'));

drop policy if exists "Voice managers delete voice channels" on public.community_voice_channels;
create policy "Voice managers delete voice channels"
on public.community_voice_channels for delete to authenticated
using (private.has_community_permission(community_id, 'manage_voice'));

-- The existing permission helper grants connect_voice and speak to members and moderators,
-- and manage_voice to administrators and community owners.

drop policy if exists "NEXORA voice members receive signaling" on realtime.messages;
create policy "NEXORA voice members receive signaling"
on realtime.messages for select to authenticated
using (
  extension in ('broadcast','presence')
  and exists (
    select 1 from public.community_voice_channels vc
    where vc.id::text = split_part(realtime.topic(), ':', 3)
      and vc.community_id::text = split_part(realtime.topic(), ':', 2)
      and split_part(realtime.topic(), ':', 1) = 'voice'
      and private.is_community_member(vc.community_id)
      and private.has_community_permission(vc.community_id, 'connect_voice')
  )
);

drop policy if exists "NEXORA voice members send signaling" on realtime.messages;
create policy "NEXORA voice members send signaling"
on realtime.messages for insert to authenticated
with check (
  extension in ('broadcast','presence')
  and exists (
    select 1 from public.community_voice_channels vc
    where vc.id::text = split_part(realtime.topic(), ':', 3)
      and vc.community_id::text = split_part(realtime.topic(), ':', 2)
      and split_part(realtime.topic(), ':', 1) = 'voice'
      and private.is_community_member(vc.community_id)
      and private.has_community_permission(vc.community_id, 'connect_voice')
  )
);
