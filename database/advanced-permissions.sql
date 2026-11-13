-- NEXORA granular community roles and permissions
-- Apply after database/community-release.sql.
create table if not exists public.community_roles (
 id uuid primary key default gen_random_uuid(),
 community_id uuid not null references public.communities(id) on delete cascade,
 name text not null check (char_length(name) between 2 and 32),
 color text not null default '#8B9BB4' check (color ~ '^#[0-9A-Fa-f]{6}$'),
 position integer not null default 0,
 permissions text[] not null default '{}',
 is_default boolean not null default false,
 created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(community_id,name)
);
alter table public.community_members add column if not exists custom_role_id uuid references public.community_roles(id) on delete set null;
create index if not exists community_roles_community_position_idx on public.community_roles(community_id,position desc);
create index if not exists community_roles_created_by_idx on public.community_roles(created_by);
create index if not exists community_members_custom_role_idx on public.community_members(custom_role_id);
alter table public.community_roles enable row level security;
drop policy if exists "Members can view community roles" on public.community_roles;
create policy "Members can view community roles" on public.community_roles for select to authenticated using (private.is_community_member(community_id));
revoke all on public.community_roles from anon,authenticated;
grant select on public.community_roles to authenticated;

-- private.has_community_permission is the single permission evaluator used by RLS.
create or replace function private.has_community_permission(p_community_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path=''
as $$
 select exists(select 1 from public.community_members m where m.community_id=p_community_id and m.user_id=(select auth.uid())
 and (m.role='owner' or (select auth.uid())='242245a8-acf0-489a-9ba4-e9e4c1593f19'::uuid
 or (m.custom_role_id is not null and exists(select 1 from public.community_roles r where r.id=m.custom_role_id and r.community_id=m.community_id and p_permission=any(r.permissions)))
 or (m.custom_role_id is null and (
 (m.role='admin' and p_permission=any(array['manage_community','manage_settings','manage_channels','manage_roles','manage_members','kick_members','ban_members','timeout_members','manage_messages','delete_messages','pin_messages','send_messages','attach_files','mention_everyone','create_invites','manage_invites','view_audit_log','manage_voice','connect_voice','speak']::text[]))
 or (m.role='moderator' and p_permission=any(array['manage_messages','delete_messages','pin_messages','timeout_members','kick_members','send_messages','attach_files','connect_voice','speak']::text[]))
 or (m.role='member' and p_permission=any(array['send_messages','attach_files','connect_voice','speak']::text[]))))));
$$;
revoke all on function private.has_community_permission(uuid,text) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.has_community_permission(uuid,text) to authenticated;

-- RPC functions are SECURITY DEFINER so each one performs explicit auth and permission checks.
-- Their EXECUTE privilege is limited to authenticated users.
create or replace function public.community_get_my_permissions(p_community_id uuid)
returns text[] language plpgsql security definer set search_path='' as $$
declare result text[]:='{}'::text[]; key text;
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 foreach key in array array['manage_community','manage_settings','manage_channels','manage_roles','manage_members','kick_members','ban_members','timeout_members','manage_messages','delete_messages','pin_messages','send_messages','attach_files','mention_everyone','create_invites','manage_invites','view_audit_log','manage_voice','connect_voice','speak']::text[] loop
  if private.has_community_permission(p_community_id,key) then result:=array_append(result,key); end if;
 end loop;
 return result;
end; $$;
create or replace function public.community_create_role(p_community_id uuid,p_name text,p_color text,p_permissions text[])
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid; perm text;
begin
 if auth.uid() is null or not private.has_community_permission(p_community_id,'manage_roles') then raise exception 'Rol yönetme yetkin yok.'; end if;
 if p_name is null or char_length(trim(p_name)) not between 2 and 32 or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Rol adı veya rengi geçersiz.'; end if;
 if coalesce(array_length(p_permissions,1),0)>40 then raise exception 'Çok fazla izin seçildi.'; end if;
 foreach perm in array coalesce(p_permissions,'{}'::text[]) loop
  if perm not in ('manage_community','manage_settings','manage_channels','manage_roles','manage_members','kick_members','ban_members','timeout_members','manage_messages','delete_messages','pin_messages','send_messages','attach_files','mention_everyone','create_invites','manage_invites','view_audit_log','manage_voice','connect_voice','speak') then raise exception 'Geçersiz izin.'; end if;
  if not private.has_community_permission(p_community_id,perm) then raise exception 'Bu izni verme yetkin yok: %',perm; end if;
 end loop;
 insert into public.community_roles(community_id,name,color,permissions,created_by) values(p_community_id,trim(p_name),p_color,coalesce(p_permissions,'{}'::text[]),auth.uid()) returning id into new_id;
 return new_id;
end; $$;
create or replace function public.community_update_role(p_community_id uuid,p_role_id uuid,p_name text,p_color text,p_permissions text[])
returns boolean language plpgsql security definer set search_path='' as $$
declare perm text;
begin
 if auth.uid() is null or not private.has_community_permission(p_community_id,'manage_roles') then raise exception 'Rol yönetme yetkin yok.'; end if;
 if not exists(select 1 from public.community_roles where id=p_role_id and community_id=p_community_id and not is_default) then raise exception 'Rol bulunamadı.'; end if;
 if p_name is null or char_length(trim(p_name)) not between 2 and 32 or p_color !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'Rol adı veya rengi geçersiz.'; end if;
 foreach perm in array coalesce(p_permissions,'{}'::text[]) loop
  if perm not in ('manage_community','manage_settings','manage_channels','manage_roles','manage_members','kick_members','ban_members','timeout_members','manage_messages','delete_messages','pin_messages','send_messages','attach_files','mention_everyone','create_invites','manage_invites','view_audit_log','manage_voice','connect_voice','speak') then raise exception 'Geçersiz izin.'; end if;
  if not private.has_community_permission(p_community_id,perm) then raise exception 'Bu izni verme yetkin yok: %',perm; end if;
 end loop;
 update public.community_roles set name=trim(p_name),color=p_color,permissions=coalesce(p_permissions,'{}'::text[]) where id=p_role_id and community_id=p_community_id;
 return true;
end; $$;
create or replace function public.community_delete_role(p_community_id uuid,p_role_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.has_community_permission(p_community_id,'manage_roles') then raise exception 'Rol yönetme yetkin yok.'; end if;
 delete from public.community_roles where id=p_role_id and community_id=p_community_id and not is_default;
 if not found then raise exception 'Rol silinemedi veya varsayılan rol silinemez.'; end if;
 return true;
end; $$;
create or replace function public.community_assign_custom_role(p_community_id uuid,p_target_user_id uuid,p_role_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare perm text;
begin
 if auth.uid() is null or not private.has_community_permission(p_community_id,'manage_members') then raise exception 'Üye yönetme yetkin yok.'; end if;
 if not exists(select 1 from public.community_members where community_id=p_community_id and user_id=p_target_user_id and role<>'owner') or p_target_user_id=auth.uid() then raise exception 'Üye bulunamadı veya kendine rol atayamazsın.'; end if;
 if p_role_id is not null then
  if not exists(select 1 from public.community_roles where id=p_role_id and community_id=p_community_id) then raise exception 'Bu topluluğa ait rol seçilmedi.'; end if;
  for perm in select unnest(r.permissions) from public.community_roles r where r.id=p_role_id loop
   if not private.has_community_permission(p_community_id,perm) then raise exception 'Atadığın rol senin sahip olmadığın izin içeriyor: %',perm; end if;
  end loop;
 end if;
 update public.community_members set custom_role_id=p_role_id,role='member',role_name=null,role_color=null where community_id=p_community_id and user_id=p_target_user_id;
 return true;
end; $$;

-- Repoint channel, room, message and moderation checks to the granular permission evaluator.
drop policy if exists "Community managers create channels" on public.community_channels;
create policy "Community managers create channels" on public.community_channels for insert to authenticated with check (created_by=(select auth.uid()) and private.has_community_permission(community_id,'manage_channels'));
drop policy if exists "Community managers update channels" on public.community_channels;
create policy "Community managers update channels" on public.community_channels for update to authenticated using(private.has_community_permission(community_id,'manage_channels')) with check(private.has_community_permission(community_id,'manage_channels'));
drop policy if exists "Community managers delete channels" on public.community_channels;
create policy "Community managers delete channels" on public.community_channels for delete to authenticated using(private.has_community_permission(community_id,'manage_channels'));
drop policy if exists "Community managers create rooms" on public.community_rooms;
create policy "Community managers create rooms" on public.community_rooms for insert to authenticated with check(created_by=(select auth.uid()) and private.has_community_permission(community_id,'manage_channels') and exists(select 1 from public.community_channels ch where ch.id=community_rooms.channel_id and ch.community_id=community_rooms.community_id));
drop policy if exists "Community managers update rooms" on public.community_rooms;
create policy "Community managers update rooms" on public.community_rooms for update to authenticated using(private.has_community_permission(community_id,'manage_channels')) with check(private.has_community_permission(community_id,'manage_channels') and exists(select 1 from public.community_channels ch where ch.id=community_rooms.channel_id and ch.community_id=community_rooms.community_id));
drop policy if exists "Community managers delete rooms" on public.community_rooms;
create policy "Community managers delete rooms" on public.community_rooms for delete to authenticated using(private.has_community_permission(community_id,'manage_channels'));
drop policy if exists "Authors undo recent messages or managers clear chat" on public.community_messages;
create policy "Authors undo recent messages or managers clear chat" on public.community_messages for delete to authenticated using((author_id=(select auth.uid()) and created_at>=now()-interval '15 minutes') or private.has_community_permission(community_id,'delete_messages'));
drop policy if exists "Community managers pin messages" on public.community_messages;
create policy "Community managers pin messages" on public.community_messages for update to authenticated using(private.has_community_permission(community_id,'pin_messages')) with check(private.has_community_permission(community_id,'pin_messages'));
drop policy if exists "Community members send messages" on public.community_messages;
create policy "Community members send messages" on public.community_messages for insert to authenticated with check(author_id=(select auth.uid()) and private.has_community_permission(community_id,'send_messages') and (message_type not in ('image','audio') or private.has_community_permission(community_id,'attach_files')) and exists(select 1 from public.community_rooms r where r.id=community_messages.room_id and r.community_id=community_messages.community_id));
drop policy if exists "Community members leave or managers remove" on public.community_members;
create policy "Community members leave or managers remove" on public.community_members for delete to authenticated using((user_id=(select auth.uid()) and role<>'owner') or (user_id<>(select auth.uid()) and role<>'owner' and private.has_community_permission(community_id,'kick_members')));
drop policy if exists "Community owners update their communities" on public.communities;
create policy "Community managers update community details" on public.communities for update to authenticated using(created_by=(select auth.uid()) or private.has_community_permission(id,'manage_settings')) with check(created_by=(select auth.uid()) or private.has_community_permission(id,'manage_settings'));

-- Lock down RPC execution to authenticated users. Every RPC checks auth.uid() and the permission evaluator.
revoke all on function public.community_get_my_permissions(uuid) from public,anon;
revoke all on function public.community_create_role(uuid,text,text,text[]) from public,anon;
revoke all on function public.community_update_role(uuid,uuid,text,text,text[]) from public,anon;
revoke all on function public.community_delete_role(uuid,uuid) from public,anon;
revoke all on function public.community_assign_custom_role(uuid,uuid,uuid) from public,anon;
grant execute on function public.community_get_my_permissions(uuid) to authenticated;
grant execute on function public.community_create_role(uuid,text,text,text[]) to authenticated;
grant execute on function public.community_update_role(uuid,uuid,text,text,text[]) to authenticated;
grant execute on function public.community_delete_role(uuid,uuid) to authenticated;
grant execute on function public.community_assign_custom_role(uuid,uuid,uuid) to authenticated;

-- Existing RPCs must use the granular evaluator too.
create or replace function public.community_assign_role(p_community_id uuid,p_target_user_id uuid,p_role text,p_role_name text default null,p_role_color text default null)
returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text;
begin
 if auth.uid() is null or p_role not in ('member','moderator','admin') then raise exception 'Geçersiz istek.'; end if;
 if not private.has_community_permission(p_community_id,'manage_members') then raise exception 'Üye yönetme yetkin yok.'; end if;
 select role into actor_role from public.community_members where community_id=p_community_id and user_id=auth.uid();
 select role into target_role from public.community_members where community_id=p_community_id and user_id=p_target_user_id;
 if target_role is null or target_role='owner' or p_target_user_id=auth.uid() then raise exception 'Bu üyeye rol atanamaz.'; end if;
 if p_role='admin' and actor_role<>'owner' and auth.uid()<>'242245a8-acf0-489a-9ba4-e9e4c1593f19'::uuid then raise exception 'Yalnızca topluluk sahibi yönetici atayabilir.'; end if;
 if actor_role='admin' and target_role='admin' then raise exception 'Yönetici başka bir yöneticiyi değiştiremez.'; end if;
 update public.community_members set role=p_role,custom_role_id=null,role_name=nullif(left(coalesce(p_role_name,''),32),''),role_color=case when p_role_color ~ '^#[0-9A-Fa-f]{6}$' then p_role_color else null end where community_id=p_community_id and user_id=p_target_user_id;
end; $$;
create or replace function public.community_moderate_member(p_community_id uuid,p_target_user_id uuid,p_action text,p_duration_minutes integer default null,p_reason text default '')
returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target_role text; expiry timestamptz; required_permission text;
begin
 if auth.uid() is null or p_action not in ('mute','unmute','ban','unban') then raise exception 'Geçersiz istek.'; end if;
 required_permission:=case when p_action in ('mute','unmute') then 'timeout_members' else 'ban_members' end;
 if not private.has_community_permission(p_community_id,required_permission) then raise exception 'Bu moderasyon işlemi için yetkin yok.'; end if;
 select role into actor_role from public.community_members where community_id=p_community_id and user_id=auth.uid();
 select role into target_role from public.community_members where community_id=p_community_id and user_id=p_target_user_id;
 if target_role is null and p_action<>'unban' then raise exception 'Üyelik bulunamadı.'; end if;
 if p_target_user_id=auth.uid() or target_role='owner' then raise exception 'Bu üyeye işlem uygulayamazsın.'; end if;
 if actor_role='moderator' and target_role<>'member' then raise exception 'Moderatör yalnızca üyeleri yönetebilir.'; end if;
 if actor_role='admin' and target_role='admin' then raise exception 'Yönetici başka bir yöneticiyi yönetemez.'; end if;
 if p_action in ('mute','ban') and (p_duration_minutes is null or p_duration_minutes<1 or p_duration_minutes>43200) then raise exception 'Süre 1 dakika ile 30 gün arasında olmalı.'; end if;
 expiry:=case when p_action in ('mute','ban') then now()+make_interval(mins=>p_duration_minutes) else null end;
 insert into public.community_moderation_actions(community_id,target_user_id,moderator_id,action_type,reason,expires_at) values(p_community_id,p_target_user_id,auth.uid(),p_action,left(coalesce(p_reason,''),300),expiry);
 if p_action='mute' then update public.community_members set muted_until=expiry,mute_reason=left(coalesce(p_reason,''),300) where community_id=p_community_id and user_id=p_target_user_id;
 elsif p_action='unmute' then update public.community_members set muted_until=null,mute_reason=null where community_id=p_community_id and user_id=p_target_user_id;
 elsif p_action='ban' then delete from public.community_members where community_id=p_community_id and user_id=p_target_user_id; end if;
end; $$;
create or replace function public.community_update_settings(p_community_id uuid,p_profanity_filter boolean,p_blocked_words text[],p_slow_mode_seconds integer,p_media_enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
declare cleaned text[];
begin
 if auth.uid() is null or not private.has_community_permission(p_community_id,'manage_settings') then raise exception 'Ayarları değiştirme yetkin yok.'; end if;
 if p_slow_mode_seconds not between 0 and 300 then raise exception 'Yavaş mod 0-300 saniye olmalı.'; end if;
 select coalesce(array_agg(distinct left(trim(x),40)),'{}'::text[]) into cleaned from unnest(coalesce(p_blocked_words,'{}'::text[])) x where length(trim(x)) between 2 and 40;
 insert into public.community_settings(community_id,profanity_filter,blocked_words,slow_mode_seconds,media_enabled,updated_at) values(p_community_id,coalesce(p_profanity_filter,true),cleaned,p_slow_mode_seconds,coalesce(p_media_enabled,true),now())
 on conflict(community_id) do update set profanity_filter=excluded.profanity_filter,blocked_words=excluded.blocked_words,slow_mode_seconds=excluded.slow_mode_seconds,media_enabled=excluded.media_enabled,updated_at=now();
end; $$;
revoke all on function public.community_assign_role(uuid,uuid,text,text,text) from public,anon;
revoke all on function public.community_moderate_member(uuid,uuid,text,integer,text) from public,anon;
revoke all on function public.community_update_settings(uuid,boolean,text[],integer,boolean) from public,anon;
grant execute on function public.community_assign_role(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.community_moderate_member(uuid,uuid,text,integer,text) to authenticated;
grant execute on function public.community_update_settings(uuid,boolean,text[],integer,boolean) to authenticated;
