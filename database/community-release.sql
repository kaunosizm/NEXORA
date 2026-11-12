-- NEXORA Community Release v1: settings, roles and moderation.
-- Apply after database/schema.sql. All exposed tables use RLS and explicit grants.

create table if not exists public.community_settings (
  community_id uuid primary key references public.communities(id) on delete cascade,
  profanity_filter boolean not null default true,
  blocked_words text[] not null default '{}',
  slow_mode_seconds integer not null default 0 check (slow_mode_seconds between 0 and 300),
  media_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.community_settings enable row level security;
drop policy if exists "Members read community settings" on public.community_settings;
create policy "Members read community settings" on public.community_settings for select to authenticated
using (private.is_community_member(community_id));
drop policy if exists "Owners update community settings" on public.community_settings;
create policy "Owners update community settings" on public.community_settings for update to authenticated
using (exists(select 1 from public.community_members m where m.community_id=community_settings.community_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')))
with check (exists(select 1 from public.community_members m where m.community_id=community_settings.community_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')));
drop policy if exists "Owners insert community settings" on public.community_settings;
create policy "Owners insert community settings" on public.community_settings for insert to authenticated
with check (exists(select 1 from public.community_members m where m.community_id=community_settings.community_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin')));
grant select,insert,update on public.community_settings to authenticated;
revoke all on public.community_settings from anon;
insert into public.community_settings(community_id) select id from public.communities on conflict do nothing;

alter table public.community_members add column if not exists role_name text;
alter table public.community_members add column if not exists role_color text;
alter table public.community_members add column if not exists muted_until timestamptz;
alter table public.community_members add column if not exists mute_reason text;

create table if not exists public.community_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  moderator_id uuid not null references public.profiles(id) on delete cascade,
  action_type text not null check(action_type in ('mute','ban','unmute','unban')),
  reason text not null default '' check(char_length(reason)<=300),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists community_moderation_active_idx on public.community_moderation_actions(community_id,target_user_id,action_type,expires_at desc);
alter table public.community_moderation_actions enable row level security;
drop policy if exists "Members see their own moderation status" on public.community_moderation_actions;
create policy "Members see their own moderation status" on public.community_moderation_actions for select to authenticated
using (target_user_id=(select auth.uid()) or moderator_id=(select auth.uid()) or exists(select 1 from public.community_members m where m.community_id=community_moderation_actions.community_id and m.user_id=(select auth.uid()) and m.role in ('owner','admin','moderator')));
grant select on public.community_moderation_actions to authenticated;
revoke all on public.community_moderation_actions from anon;

create or replace function private.is_community_manager(p_community_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select auth.uid() is not null and exists(select 1 from public.community_members m
 where m.community_id=p_community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator'));
$$;
revoke all on function private.is_community_manager(uuid) from public,anon;
grant execute on function private.is_community_manager(uuid) to authenticated;

drop policy if exists "Community moderators clear messages" on public.community_messages;
create policy "Community moderators clear messages" on public.community_messages for delete to authenticated
using (private.is_community_manager(community_id));

drop policy if exists "Community managers remove members" on public.community_members;
create policy "Community managers remove members" on public.community_members for delete to authenticated
using (user_id<>(select auth.uid()) and exists(
  select 1 from public.community_members actor where actor.community_id=community_members.community_id
  and actor.user_id=(select auth.uid()) and (actor.role in ('owner','admin') or (actor.role='moderator' and community_members.role='member'))
) and community_members.role<>'owner');

drop policy if exists "Community owners assign member roles" on public.community_members;
create policy "Community owners assign member roles" on public.community_members for update to authenticated
using (user_id<>(select auth.uid()) and community_members.role<>'owner' and exists(
  select 1 from public.community_members actor where actor.community_id=community_members.community_id
  and actor.user_id=(select auth.uid()) and actor.role in ('owner','admin')
))
with check (role in ('member','moderator','admin') and exists(
  select 1 from public.community_members actor where actor.community_id=community_members.community_id
  and actor.user_id=(select auth.uid()) and actor.role in ('owner','admin')
));
grant update(role,role_name,role_color,muted_until,mute_reason) on public.community_members to authenticated;
grant delete on public.community_members to authenticated;

-- Prevent banned accounts from rejoining while their ban is active.
drop policy if exists "Users join public communities or claim ownership of their own" on public.community_members;
create policy "Users join public communities or claim ownership of their own" on public.community_members for insert to authenticated with check (
  (
    (user_id=(select auth.uid()) and (
      (role='member' and exists(select 1 from public.communities c where c.id=community_id and c.visibility='public'))
      or (role='owner' and exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())))
    ))
    or (role='member' and exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())))
  )
  and not exists(select 1 from public.community_moderation_actions a
    where a.community_id=community_members.community_id and a.target_user_id=(select auth.uid())
      and a.action_type='ban' and (a.expires_at is null or a.expires_at>now()))
);

create or replace function public.community_moderate_member(
 p_community_id uuid,p_target_user_id uuid,p_action text,p_duration_minutes integer default null,p_reason text default ''
) returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text; expiry timestamptz;
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 if p_action not in ('mute','unmute','ban','unban') then raise exception 'Geçersiz moderasyon işlemi.'; end if;
 select role into actor_role from public.community_members where community_id=p_community_id and user_id=auth.uid();
 select role into target_role from public.community_members where community_id=p_community_id and user_id=p_target_user_id;
 if actor_role is null then raise exception 'Bu topluluğun üyesi değilsin.'; end if;
 if p_action in ('mute','ban','unmute') and target_role is null then raise exception 'Üyelik bulunamadı.'; end if;
 if p_target_user_id=auth.uid() or target_role='owner' then raise exception 'Bu üyeye işlem uygulayamazsın.'; end if;
 if actor_role='moderator' and target_role<>'member' then raise exception 'Moderatör yalnızca üyeleri yönetebilir.'; end if;
 if actor_role not in ('owner','admin','moderator') then raise exception 'Bu işlem için yetkin yok.'; end if;
 if actor_role='admin' and target_role='admin' then raise exception 'Yönetici başka bir yöneticiyi yönetemez.'; end if;
 if p_action in ('mute','ban') and (p_duration_minutes is null or p_duration_minutes<1 or p_duration_minutes>43200) then
   raise exception 'Süre 1 dakika ile 30 gün arasında olmalı.';
 end if;
 expiry:=case when p_action in ('mute','ban') then now()+make_interval(mins=>p_duration_minutes) else null end;
 insert into public.community_moderation_actions(community_id,target_user_id,moderator_id,action_type,reason,expires_at)
 values(p_community_id,p_target_user_id,auth.uid(),p_action,left(coalesce(p_reason,''),300),expiry);
 if p_action='mute' then
   update public.community_members set muted_until=expiry,mute_reason=left(coalesce(p_reason,''),300)
   where community_id=p_community_id and user_id=p_target_user_id;
 elsif p_action='unmute' then
   update public.community_members set muted_until=null,mute_reason=null
   where community_id=p_community_id and user_id=p_target_user_id;
 elsif p_action='ban' then
   delete from public.community_members where community_id=p_community_id and user_id=p_target_user_id;
 end if;
end; $$;
revoke all on function public.community_moderate_member(uuid,uuid,text,integer,text) from public,anon;
grant execute on function public.community_moderate_member(uuid,uuid,text,integer,text) to authenticated;

create or replace function public.community_assign_role(
 p_community_id uuid,p_target_user_id uuid,p_role text,p_role_name text default null,p_role_color text default null
) returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text;
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 if p_role not in ('member','moderator','admin') then raise exception 'Geçersiz rol.'; end if;
 select role into actor_role from public.community_members where community_id=p_community_id and user_id=auth.uid();
 select role into target_role from public.community_members where community_id=p_community_id and user_id=p_target_user_id;
 if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Yalnızca kurucu veya yöneticiler rol atayabilir.'; end if;
 if target_role is null or target_role='owner' or p_target_user_id=auth.uid() then raise exception 'Bu üyeye rol atanamaz.'; end if;
 if actor_role='admin' and target_role='admin' then raise exception 'Yönetici başka bir yöneticiyi değiştiremez.'; end if;
 update public.community_members set role=p_role,role_name=nullif(left(coalesce(p_role_name,''),32),''),
 role_color=case when p_role_color ~ '^#[0-9A-Fa-f]{6}$' then p_role_color else null end
 where community_id=p_community_id and user_id=p_target_user_id;
end; $$;
revoke all on function public.community_assign_role(uuid,uuid,text,text,text) from public,anon;
grant execute on function public.community_assign_role(uuid,uuid,text,text,text) to authenticated;

create or replace function private.enforce_community_message_rules()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.community_settings%rowtype; mute_until timestamptz; last_message timestamptz; word text;
begin
 select * into cfg from public.community_settings where community_id=new.community_id;
 select m.muted_until into mute_until from public.community_members m where m.community_id=new.community_id and m.user_id=new.author_id;
 if mute_until is not null and mute_until>now() then raise exception 'Bu toplulukta % tarihine kadar susturuldun.',to_char(mute_until,'DD.MM.YYYY HH24:MI'); end if;
 if exists(select 1 from public.community_moderation_actions a where a.community_id=new.community_id and a.target_user_id=new.author_id and a.action_type='ban' and (a.expires_at is null or a.expires_at>now())) then
   raise exception 'Bu topluluğa erişimin kısıtlanmış.';
 end if;
 if cfg.community_id is not null and not cfg.media_enabled and new.message_type in ('image','audio') then
   raise exception 'Bu toplulukta fotoğraf ve ses paylaşımı kapalı.';
 end if;
 if cfg.community_id is not null and cfg.profanity_filter and new.message_type='text' then
   foreach word in array coalesce(cfg.blocked_words,'{}'::text[]) loop
     if length(trim(word))>=2 and position(lower(trim(word)) in lower(new.content))>0 then
       raise exception 'Mesajın topluluk kelime filtresine takıldı.';
     end if;
   end loop;
 end if;
 if coalesce(cfg.slow_mode_seconds,0)>0 and not exists(select 1 from public.community_members m where m.community_id=new.community_id and m.user_id=new.author_id and m.role in ('owner','admin','moderator')) then
   select max(created_at) into last_message from public.community_messages where room_id=new.room_id and author_id=new.author_id;
   if last_message is not null and last_message>now()-make_interval(secs=>cfg.slow_mode_seconds) then
     raise exception 'Yavaş mod açık. Bir sonraki mesaj için biraz bekle.';
   end if;
 end if;
 return new;
end; $$;
revoke all on function private.enforce_community_message_rules() from public,anon,authenticated;
drop trigger if exists community_message_rules_before_insert on public.community_messages;
create trigger community_message_rules_before_insert before insert on public.community_messages
for each row execute function private.enforce_community_message_rules();

create or replace function public.community_update_settings(
 p_community_id uuid,p_profanity_filter boolean,p_blocked_words text[],p_slow_mode_seconds integer,p_media_enabled boolean
) returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; cleaned text[];
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 select role into actor_role from public.community_members where community_id=p_community_id and user_id=auth.uid();
 if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Topluluk ayarlarını yalnızca kurucu veya yöneticiler değiştirebilir.'; end if;
 if p_slow_mode_seconds not between 0 and 300 then raise exception 'Yavaş mod 0-300 saniye olmalı.'; end if;
 select coalesce(array_agg(distinct left(trim(x),40)),'{}'::text[]) into cleaned
 from unnest(coalesce(p_blocked_words,'{}'::text[])) x where length(trim(x)) between 2 and 40;
 insert into public.community_settings(community_id,profanity_filter,blocked_words,slow_mode_seconds,media_enabled,updated_at)
 values(p_community_id,coalesce(p_profanity_filter,true),cleaned,p_slow_mode_seconds,coalesce(p_media_enabled,true),now())
 on conflict(community_id) do update set profanity_filter=excluded.profanity_filter,blocked_words=excluded.blocked_words,
 slow_mode_seconds=excluded.slow_mode_seconds,media_enabled=excluded.media_enabled,updated_at=now();
end; $$;
revoke all on function public.community_update_settings(uuid,boolean,text[],integer,boolean) from public,anon;
grant execute on function public.community_update_settings(uuid,boolean,text[],integer,boolean) to authenticated;

-- Extend channel/room management to admins as well as owners and moderators.
drop policy if exists "Community owners create channels" on public.community_channels;
drop policy if exists "Community managers create channels" on public.community_channels;
create policy "Community managers create channels" on public.community_channels for insert to authenticated
with check (created_by=auth.uid() and exists(select 1 from public.community_members m where m.community_id=community_channels.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')));
drop policy if exists "Community owners update channels" on public.community_channels;
drop policy if exists "Community managers update channels" on public.community_channels;
create policy "Community managers update channels" on public.community_channels for update to authenticated
using (exists(select 1 from public.community_members m where m.community_id=community_channels.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')))
with check (exists(select 1 from public.community_members m where m.community_id=community_channels.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')));
drop policy if exists "Community owners delete channels" on public.community_channels;
drop policy if exists "Community managers delete channels" on public.community_channels;
create policy "Community managers delete channels" on public.community_channels for delete to authenticated
using (exists(select 1 from public.community_members m where m.community_id=community_channels.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')));
drop policy if exists "Community owners create rooms" on public.community_rooms;
drop policy if exists "Community managers create rooms" on public.community_rooms;
create policy "Community managers create rooms" on public.community_rooms for insert to authenticated
with check (created_by=auth.uid() and exists(select 1 from public.community_members m where m.community_id=community_rooms.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator'))
 and exists(select 1 from public.community_channels ch where ch.id=community_rooms.channel_id and ch.community_id=community_rooms.community_id));
drop policy if exists "Community owners update rooms" on public.community_rooms;
drop policy if exists "Community managers update rooms" on public.community_rooms;
create policy "Community managers update rooms" on public.community_rooms for update to authenticated
using (exists(select 1 from public.community_members m where m.community_id=community_rooms.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')))
with check (exists(select 1 from public.community_members m where m.community_id=community_rooms.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator'))
 and exists(select 1 from public.community_channels ch where ch.id=community_rooms.channel_id and ch.community_id=community_rooms.community_id));
drop policy if exists "Community owners delete rooms" on public.community_rooms;
drop policy if exists "Community managers delete rooms" on public.community_rooms;
create policy "Community managers delete rooms" on public.community_rooms for delete to authenticated
using (exists(select 1 from public.community_members m where m.community_id=community_rooms.community_id and m.user_id=auth.uid() and m.role in ('owner','admin','moderator')));

-- Ensure every future community receives a default settings row.
create or replace function public.create_default_community_channel()
returns trigger language plpgsql security definer set search_path=''
as $$
declare channel_uuid uuid;
begin
 insert into public.community_settings(community_id) values(new.id) on conflict do nothing;
 insert into public.community_channels(community_id,name,created_by,sort_order)
 values(new.id,'Genel',new.created_by,0) returning id into channel_uuid;
 insert into public.community_rooms(community_id,channel_id,name,topic,created_by,sort_order)
 values(new.id,channel_uuid,'sohbet','Topluluğun genel sohbet odası',new.created_by,0);
 return new;
end; $$;
revoke all on function public.create_default_community_channel() from public,anon,authenticated;


-- Final security tightening: hierarchy-aware membership management and word-boundary filter.
drop policy if exists "Community managers remove members" on public.community_members;
create policy "Community managers remove members" on public.community_members for delete to authenticated
using (
 user_id<>(select auth.uid()) and community_members.role<>'owner'
 and exists(select 1 from public.community_members actor
   where actor.community_id=community_members.community_id and actor.user_id=(select auth.uid())
   and (actor.role='owner' or (actor.role='admin' and community_members.role in ('moderator','member'))
     or (actor.role='moderator' and community_members.role='member')))
);
drop policy if exists "Community owners assign member roles" on public.community_members;
create policy "Community owners assign member roles" on public.community_members for update to authenticated
using (
 user_id<>(select auth.uid()) and community_members.role<>'owner'
 and exists(select 1 from public.community_members actor
   where actor.community_id=community_members.community_id and actor.user_id=(select auth.uid())
   and (actor.role='owner' or (actor.role='admin' and community_members.role in ('moderator','member'))))
)
with check (
 role in ('member','moderator','admin')
 and exists(select 1 from public.community_members actor
   where actor.community_id=community_members.community_id and actor.user_id=(select auth.uid())
   and actor.role in ('owner','admin'))
);

create or replace function private.enforce_community_message_rules()
returns trigger language plpgsql security definer set search_path='' as $$
declare cfg public.community_settings%rowtype; mute_until timestamptz; last_message timestamptz; word text; all_words text[];
begin
 select * into cfg from public.community_settings where community_id=new.community_id;
 select m.muted_until into mute_until from public.community_members m where m.community_id=new.community_id and m.user_id=new.author_id;
 if mute_until is not null and mute_until>now() then raise exception 'Bu toplulukta % tarihine kadar susturuldun.',to_char(mute_until,'DD.MM.YYYY HH24:MI'); end if;
 if exists(select 1 from public.community_moderation_actions a where a.community_id=new.community_id and a.target_user_id=new.author_id and a.action_type='ban' and (a.expires_at is null or a.expires_at>now())) then
   raise exception 'Bu topluluğa erişimin kısıtlanmış.';
 end if;
 if cfg.community_id is not null and not cfg.media_enabled and new.message_type in ('image','audio') then
   raise exception 'Bu toplulukta fotoğraf ve ses paylaşımı kapalı.';
 end if;
 if cfg.community_id is not null and cfg.profanity_filter and new.message_type='text' then
   all_words:=array_cat(array['amk','aq','sik','siktir','orospu','piç','yarrak'],coalesce(cfg.blocked_words,'{}'::text[]));
   foreach word in array all_words loop
     if length(trim(word))>=2 and lower(trim(word))=any(regexp_split_to_array(lower(new.content),'[^[:alnum:]_]+')) then
       raise exception 'Mesajın topluluk kelime filtresine takıldı.';
     end if;
   end loop;
 end if;
 if coalesce(cfg.slow_mode_seconds,0)>0 and not exists(select 1 from public.community_members m where m.community_id=new.community_id and m.user_id=new.author_id and m.role in ('owner','admin','moderator')) then
   select max(created_at) into last_message from public.community_messages where room_id=new.room_id and author_id=new.author_id;
   if last_message is not null and last_message>now()-make_interval(secs=>cfg.slow_mode_seconds) then
     raise exception 'Yavaş mod açık. Bir sonraki mesaj için biraz bekle.';
   end if;
 end if;
 return new;
end; $$;


-- Performance and policy consolidation pass.
drop policy if exists "Users leave or owners remove community members" on public.community_members;
drop policy if exists "Community managers remove members" on public.community_members;
drop policy if exists "Community members leave or managers remove" on public.community_members;
create policy "Community members leave or managers remove" on public.community_members for delete to authenticated
using (
 (user_id=(select auth.uid()) and role<>'owner')
 or (
   user_id<>(select auth.uid()) and role<>'owner'
   and exists(select 1 from public.community_members actor
     where actor.community_id=community_members.community_id and actor.user_id=(select auth.uid())
     and (actor.role='owner' or (actor.role='admin' and community_members.role in ('moderator','member'))
       or (actor.role='moderator' and community_members.role='member')))
 )
);
drop policy if exists "Authors can undo own recent community messages" on public.community_messages;
drop policy if exists "Community moderators clear messages" on public.community_messages;
drop policy if exists "Authors undo recent messages or managers clear chat" on public.community_messages;
create policy "Authors undo recent messages or managers clear chat" on public.community_messages for delete to authenticated
using ((author_id=(select auth.uid()) and created_at>=now()-interval '15 minutes') or private.is_community_manager(community_id));
drop policy if exists "Users see their own memberships and owners see their community " on public.community_members;
create index if not exists community_channels_created_by_idx on public.community_channels(created_by);
create index if not exists community_join_requests_user_id_idx on public.community_join_requests(user_id);
create index if not exists community_messages_author_id_idx on public.community_messages(author_id);
create index if not exists community_messages_room_id_idx on public.community_messages(room_id);
create index if not exists community_moderation_moderator_id_idx on public.community_moderation_actions(moderator_id);
create index if not exists community_moderation_target_id_idx on public.community_moderation_actions(target_user_id);
create index if not exists community_rooms_community_id_idx on public.community_rooms(community_id);
create index if not exists community_rooms_created_by_idx on public.community_rooms(created_by);
create index if not exists friendships_user_b_idx on public.friendships(user_b);


-- Pin messages for community announcements and important information.
alter table public.community_messages add column if not exists is_pinned boolean not null default false;
alter table public.community_messages add column if not exists pinned_by uuid references public.profiles(id) on delete set null;
create index if not exists community_messages_room_pinned_created_idx on public.community_messages(room_id,is_pinned desc,created_at desc);
drop policy if exists "Community managers pin messages" on public.community_messages;
create policy "Community managers pin messages" on public.community_messages for update to authenticated
using (private.is_community_manager(community_id))
with check (private.is_community_manager(community_id));
grant update(is_pinned,pinned_by) on public.community_messages to authenticated;
