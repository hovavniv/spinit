create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  business_name text,
  phone         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint full_name_len     check (char_length(full_name) <= 100),
  constraint business_name_len check (business_name is null or char_length(business_name) <= 100),
  constraint phone_fmt         check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$')
);

alter table public.profiles enable row level security;

create policy "select own profile" on public.profiles
  for select using ((select auth.uid()) = id);

create policy "update own profile" on public.profiles
  for update using ((select auth.uid()) = id)
             with check ((select auth.uid()) = id);

-- grant exactly what the app needs, to exactly the role that needs it
grant select, update on public.profiles to authenticated;

-- and make the absence of the rest explicit, so it survives the
-- "Automatically expose new tables" setting being on, or later turned on
revoke insert, delete, truncate on public.profiles from anon, authenticated;
revoke all on public.profiles from anon;

create extension if not exists moddatetime schema extensions;

create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function extensions.moddatetime(updated_at);

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, business_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name',
             new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'business_name', ''),
    nullif(new.raw_user_meta_data->>'phone', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
