-- 000027: orders placed as a guest. Run it in the Supabase SQL editor. It is safe to run twice.
--
--  1. is_guest: the admin Orders list asks for it as one more column, to show a "Guest" label.
--  2. A guest who adds Google or an email keeps their profile, and now gets their name on it too (it was empty).
--  3. purge_old_guests(): deletes guest users nobody came back for. It never touches a guest who has an order or a chat.

-- 1. A computed column on orders: select=...,is_guest works through the API. Only people who can already read the order can read it.
create or replace function public.is_guest(o public.orders) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select u.is_anonymous from auth.users u where u.id = o.user_id), false);
$$;
revoke all on function public.is_guest(public.orders) from public, anon;
grant execute on function public.is_guest(public.orders) to authenticated, service_role;

-- 2. When a guest becomes a member (or any member's details change), fill an empty profile name from what they gave.
create or replace function public.fill_profile_name_from_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_first text;
  v_last  text;
  v_full  text;
begin
  v_first := coalesce(new.raw_user_meta_data ->> 'first_name', new.raw_user_meta_data ->> 'given_name', '');
  v_last  := coalesce(new.raw_user_meta_data ->> 'last_name',  new.raw_user_meta_data ->> 'family_name', '');
  v_full  := coalesce(new.raw_user_meta_data ->> 'full_name',  new.raw_user_meta_data ->> 'name', '');
  if v_first = '' and v_full <> '' then
    v_first := split_part(v_full, ' ', 1);
    v_last  := btrim(substr(v_full, length(v_first) + 2));
  end if;
  if v_first <> '' then
    update public.profiles set first_name = v_first, last_name = v_last where id = new.id and first_name = '';
  end if;
  return new;
end;
$$;

drop trigger if exists fill_profile_name_from_account on auth.users;
create trigger fill_profile_name_from_account
  after update of raw_user_meta_data, is_anonymous on auth.users
  for each row
  when (new.is_anonymous is not true)
  execute function public.fill_profile_name_from_account();

-- 3. Clean-up. Guests are real rows in the database, so old unused ones are removed. A guest with an order or a conversation is never removed,
--    and neither is one who was seen recently. One that cannot be removed for any reason is skipped, not an error.
create or replace function public.purge_old_guests(p_days int default 30) returns int
language plpgsql security definer set search_path = public, auth as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select u.id
      from auth.users u
     where u.is_anonymous is true
       and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(days => greatest(p_days, 7))
       and not exists (select 1 from public.orders o where o.user_id = u.id)
       and not exists (select 1 from public.conversations c where c.user_id = u.id)
  loop
    begin
      delete from auth.users where id = r.id;
      n := n + 1;
    exception when others then
      null;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.purge_old_guests(int) from public, anon, authenticated;
grant execute on function public.purge_old_guests(int) to service_role;

-- To run the clean-up every night (needs the pg_cron extension: Supabase > Database > Extensions > pg_cron), run this once:
--   select cron.schedule('purge-old-guests', '30 1 * * *', $$select public.purge_old_guests(30)$$);
-- Or run it by hand when you like:
--   select public.purge_old_guests(30);
