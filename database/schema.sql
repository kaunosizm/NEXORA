-- NEXORA initial schema. Applied to the connected NEXORA Supabase project.
create extension if not exists pgcrypto;
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'), display_name text not null default 'Yeni Üye' check (char_length(display_name) between 1 and 40), bio text not null default '' check (char_length(bio) <= 160), avatar_url text, xp integer not null default 0 check (xp >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.communities (id uuid primary key default gen_random_uuid(), name text not null check (char_length(name) between 3 and 48), slug text not null unique check (slug ~ '^[a-z0-9-]{3,56}$'), description text not null default '' check (char_length(description) <= 280), visibility text not null default 'public' check (visibility in ('public','private')), created_by uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now());
create table public.community_members (community_id uuid not null references public.communities(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, role text not null default 'member' check (role in ('owner','moderator','member')), joined_at timestamptz not null default now(), primary key (community_id,user_id));
create table public.posts (id uuid primary key default gen_random_uuid(), author_id uuid not null references public.profiles(id) on delete cascade, community_id uuid references public.communities(id) on delete cascade, content text not null check (char_length(content) between 1 and 1200), created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.comments (id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts(id) on delete cascade, author_id uuid not null references public.profiles(id) on delete cascade, content text not null check (char_length(content) between 1 and 500), created_at timestamptz not null default now());
create table public.post_likes (post_id uuid not null references public.posts(id) on delete cascade, user_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now(), primary key (post_id,user_id));
create index communities_created_at_idx on public.communities(created_at desc);
create index community_members_user_id_idx on public.community_members(user_id);
create index posts_created_at_idx on public.posts(created_at desc);
create index posts_community_created_idx on public.posts(community_id,created_at desc);
create index posts_author_id_idx on public.posts(author_id);
create index comments_post_created_idx on public.comments(post_id,created_at asc);
create index post_likes_user_id_idx on public.post_likes(user_id);
create or replace function public.set_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end; $$;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts for each row execute function public.set_updated_at();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$ declare requested_username text; safe_username text; requested_display_name text; begin requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username','')); safe_username := left(regexp_replace(requested_username,'[^a-z0-9_]','','g'),24); if char_length(safe_username)<3 then safe_username := 'user_' || left(replace(new.id::text,'-',''),8); end if; requested_display_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name','')),''); begin insert into public.profiles(id,username,display_name) values(new.id,safe_username,coalesce(left(requested_display_name,40),safe_username)); exception when unique_violation then insert into public.profiles(id,username,display_name) values(new.id,left(safe_username,14)||'_'||left(replace(new.id::text,'-',''),8),coalesce(left(requested_display_name,40),safe_username)); end; return new; end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public,anon,authenticated;
alter table public.profiles enable row level security;
alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_likes enable row level security;
create policy "Public profiles are readable" on public.profiles for select to anon,authenticated using(true);
create policy "Users update their own profile" on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy "Public communities are readable" on public.communities for select to anon,authenticated using(visibility='public' or created_by=(select auth.uid()));
create policy "Signed-in users create public communities" on public.communities for insert to authenticated with check(created_by=(select auth.uid()) and visibility='public');
create policy "Community owners update their communities" on public.communities for update to authenticated using(created_by=(select auth.uid())) with check(created_by=(select auth.uid()));
create policy "Community owners delete their communities" on public.communities for delete to authenticated using(created_by=(select auth.uid()));
create policy "Users see their own memberships and owners see their community members" on public.community_members for select to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())));
create policy "Users join public communities or claim ownership of their own" on public.community_members for insert to authenticated with check(user_id=(select auth.uid()) and ((role='member' and exists(select 1 from public.communities c where c.id=community_id and c.visibility='public')) or (role='owner' and exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())))));
create policy "Users leave or owners remove community members" on public.community_members for delete to authenticated using(user_id=(select auth.uid()) or exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())));
create policy "Public feed posts are readable" on public.posts for select to anon,authenticated using(community_id is null or exists(select 1 from public.communities c where c.id=community_id and c.visibility='public'));
create policy "Users create their own posts" on public.posts for insert to authenticated with check(author_id=(select auth.uid()) and (community_id is null or exists(select 1 from public.community_members m where m.community_id=posts.community_id and m.user_id=(select auth.uid()))));
create policy "Authors update their own posts" on public.posts for update to authenticated using(author_id=(select auth.uid())) with check(author_id=(select auth.uid()));
create policy "Authors delete their own posts" on public.posts for delete to authenticated using(author_id=(select auth.uid()));
create policy "Comments on visible posts are readable" on public.comments for select to anon,authenticated using(exists(select 1 from public.posts p where p.id=post_id));
create policy "Users comment as themselves on visible posts" on public.comments for insert to authenticated with check(author_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id));
create policy "Authors update their own comments" on public.comments for update to authenticated using(author_id=(select auth.uid())) with check(author_id=(select auth.uid()));
create policy "Authors delete their own comments" on public.comments for delete to authenticated using(author_id=(select auth.uid()));
create policy "Likes are readable" on public.post_likes for select to anon,authenticated using(true);
create policy "Users like as themselves" on public.post_likes for insert to authenticated with check(user_id=(select auth.uid()));
create policy "Users remove their own likes" on public.post_likes for delete to authenticated using(user_id=(select auth.uid()));
revoke all on table public.profiles,public.communities,public.community_members,public.posts,public.comments,public.post_likes from anon,authenticated;
grant select on table public.profiles,public.communities,public.posts,public.comments,public.post_likes to anon;
grant select on table public.profiles,public.communities,public.posts,public.comments,public.post_likes,public.community_members to authenticated;
grant update(username,display_name,bio,avatar_url) on public.profiles to authenticated;
grant insert,update,delete on public.communities to authenticated;
grant insert,delete on public.community_members to authenticated;
grant insert,update,delete on public.posts to authenticated;
grant insert,update,delete on public.comments to authenticated;
grant insert,delete on public.post_likes to authenticated;
grant all on table public.profiles,public.communities,public.community_members,public.posts,public.comments,public.post_likes to service_role;


-- Additional hardening and foreign-key indexes added after the initial deployment.
create index if not exists comments_author_id_idx on public.comments(author_id);
create index if not exists communities_created_by_idx on public.communities(created_by);

drop policy if exists "Authors update their own posts" on public.posts;
create policy "Authors update their own posts" on public.posts
for update to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and (
    community_id is null
    or exists (
      select 1 from public.community_members m
      where m.community_id = posts.community_id
        and m.user_id = (select auth.uid())
    )
  )
);

drop policy if exists "Authors update their own comments" on public.comments;
create policy "Authors update their own comments" on public.comments
for update to authenticated
using (author_id = (select auth.uid()))
with check (
  author_id = (select auth.uid())
  and exists (select 1 from public.posts p where p.id = post_id)
);

drop policy if exists "Likes are readable" on public.post_likes;
create policy "Likes on visible posts are readable" on public.post_likes
for select to anon, authenticated
using (exists (select 1 from public.posts p where p.id = post_id));

drop policy if exists "Users like as themselves" on public.post_likes;
create policy "Users like visible posts as themselves" on public.post_likes
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (select 1 from public.posts p where p.id = post_id)
);

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;


-- Private community join requests and member-only private content.
create table if not exists public.community_join_requests (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (community_id,user_id)
);
create index if not exists community_join_requests_owner_idx on public.community_join_requests(community_id,status,created_at);
alter table public.community_join_requests enable row level security;

-- Access policies for discoverable private communities with private member content.
drop policy if exists "Community directory is readable" on public.communities;
create policy "Community directory is readable" on public.communities for select to anon,authenticated using (true);
drop policy if exists "Signed-in users create communities" on public.communities;
create policy "Signed-in users create communities" on public.communities for insert to authenticated with check (created_by=(select auth.uid()) and visibility in ('public','private'));
drop policy if exists "Users join public communities or claim ownership of their own" on public.community_members;
create policy "Users join public communities or claim ownership of their own" on public.community_members for insert to authenticated with check (
  (user_id=(select auth.uid()) and ((role='member' and exists(select 1 from public.communities c where c.id=community_id and c.visibility='public')) or (role='owner' and exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())))))
  or (role='member' and exists(select 1 from public.communities c where c.id=community_id and c.created_by=(select auth.uid())))
);
drop policy if exists "Users create join requests" on public.community_join_requests;
create policy "Users create join requests" on public.community_join_requests for insert to authenticated with check (
  user_id=(select auth.uid()) and status='pending'
  and exists(select 1 from public.communities c where c.id=community_join_requests.community_id and c.visibility='private')
  and not exists(select 1 from public.community_members m where m.community_id=community_join_requests.community_id and m.user_id=(select auth.uid()))
);
drop policy if exists "Users and owners read join requests" on public.community_join_requests;
create policy "Users and owners read join requests" on public.community_join_requests for select to authenticated using (
  user_id=(select auth.uid()) or exists(select 1 from public.communities c where c.id=community_join_requests.community_id and c.created_by=(select auth.uid()))
);
drop policy if exists "Owners review join requests" on public.community_join_requests;
create policy "Owners review join requests" on public.community_join_requests for update to authenticated using (
  exists(select 1 from public.communities c where c.id=community_join_requests.community_id and c.created_by=(select auth.uid()))
) with check (
  exists(select 1 from public.communities c where c.id=community_join_requests.community_id and c.created_by=(select auth.uid()))
  and status in ('approved','rejected')
);
revoke update on public.community_join_requests from authenticated;
grant update(status,reviewed_at) on public.community_join_requests to authenticated;
drop policy if exists "Community posts are readable" on public.posts;
create policy "Public community posts readable" on public.posts for select to anon
using (community_id is not null and exists(select 1 from public.communities c where c.id=posts.community_id and c.visibility='public'));
create policy "Members read community posts" on public.posts for select to authenticated using (
  community_id is not null and exists(select 1 from public.communities c where c.id=posts.community_id and (
    c.visibility='public' or exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=(select auth.uid()))
  ))
);
grant select,insert on public.community_join_requests to authenticated;
revoke all on public.community_join_requests from anon;

alter table public.profiles add column if not exists username_changed_at timestamptz;
create or replace function public.change_username(p_username text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare changed_at timestamptz;
begin
 if auth.uid() is null then raise exception 'Giriş yapmalısın.'; end if;
 if p_username is null or p_username !~ '^[a-z0-9_]{3,24}$' then raise exception 'Kullanıcı adı 3-24 karakter olmalı.'; end if;
 select username_changed_at into changed_at from public.profiles where id=auth.uid() for update;
 if changed_at is not null and changed_at > now()-interval '7 days' then
  raise exception 'Kullanıcı adını 7 günde yalnızca bir kez değiştirebilirsin. Sonraki değişiklik: %',to_char(changed_at+interval '7 days','DD.MM.YYYY HH24:MI');
 end if;
 update public.profiles set username=p_username,username_changed_at=now(),updated_at=now() where id=auth.uid();
 return now();
end; $$;
revoke all on function public.change_username(text) from public,anon;
grant execute on function public.change_username(text) to authenticated;
revoke update(username) on public.profiles from authenticated;
create table if not exists public.friend_requests (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 receiver_id uuid not null references public.profiles(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(),
 check(sender_id<>receiver_id)
);
create unique index if not exists friend_requests_one_pending_pair on public.friend_requests(least(sender_id,receiver_id),greatest(sender_id,receiver_id)) where status='pending';
create unique index if not exists friend_requests_pending_direction_idx on public.friend_requests(sender_id,receiver_id) where status='pending';
create index if not exists friend_requests_receiver_idx on public.friend_requests(receiver_id,status,created_at desc);
alter table public.friend_requests enable row level security;
create table if not exists public.friendships (
 user_a uuid not null references public.profiles(id) on delete cascade,
 user_b uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(user_a,user_b),check(user_a<user_b)
);
alter table public.friendships enable row level security;
create or replace function public.are_friends(a uuid,b uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.friendships f where f.user_a=least(a,b) and f.user_b=greatest(a,b));
$$;
revoke all on function public.are_friends(uuid,uuid) from public,anon;
grant execute on function public.are_friends(uuid,uuid) to authenticated;
create or replace function public.accept_friend_request(p_request_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare req public.friend_requests%rowtype;
begin
 select * into req from public.friend_requests where id=p_request_id and receiver_id=auth.uid() and status='pending' for update;
 if not found then raise exception 'Bekleyen arkadaşlık isteği bulunamadı.'; end if;
 insert into public.friendships(user_a,user_b) values(least(req.sender_id,req.receiver_id),greatest(req.sender_id,req.receiver_id)) on conflict do nothing;
 update public.friend_requests set status='accepted' where id=req.id;
end; $$;
revoke all on function public.accept_friend_request(uuid) from public,anon;
grant execute on function public.accept_friend_request(uuid) to authenticated;
create policy "Participants read friend requests" on public.friend_requests for select to authenticated using(sender_id=auth.uid() or receiver_id=auth.uid());
create policy "Users send friend requests" on public.friend_requests for insert to authenticated with check(sender_id=auth.uid() and exists(select 1 from public.profiles p where p.id=receiver_id) and not public.are_friends(sender_id,receiver_id));
create policy "Receivers reject requests" on public.friend_requests for update to authenticated using(receiver_id=auth.uid() and status='pending') with check(receiver_id=auth.uid() and status='rejected');
create policy "Friends list visible to participants" on public.friendships for select to authenticated using(user_a=auth.uid() or user_b=auth.uid());
create table if not exists public.direct_messages (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references public.profiles(id) on delete cascade,
 receiver_id uuid not null references public.profiles(id) on delete cascade,
 content text not null check(char_length(content) between 1 and 2000),
 created_at timestamptz not null default now(),check(sender_id<>receiver_id)
);
create index if not exists direct_messages_pair_created_idx on public.direct_messages(sender_id,receiver_id,created_at desc);
create index if not exists direct_messages_receiver_created_idx on public.direct_messages(receiver_id,sender_id,created_at desc);
alter table public.direct_messages enable row level security;
create policy "Friends read direct messages" on public.direct_messages for select to authenticated using((sender_id=auth.uid() or receiver_id=auth.uid()) and public.are_friends(sender_id,receiver_id));
create policy "Friends send direct messages" on public.direct_messages for insert to authenticated with check(sender_id=auth.uid() and public.are_friends(sender_id,receiver_id));
grant select,insert on public.friend_requests,public.direct_messages to authenticated;
grant select on public.friendships to authenticated;
revoke all on public.friend_requests,public.friendships,public.direct_messages from anon;
