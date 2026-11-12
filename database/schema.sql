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
