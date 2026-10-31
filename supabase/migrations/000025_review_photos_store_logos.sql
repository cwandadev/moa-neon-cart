-- 000025: a reviewer's profile photo shows on their review, and each store can have a logo. Run it after 000024. Idempotent: safe to run twice.
--
--  A reviewer's circle is the SAME picture their account shows: the photo they added, else the photo from their Google account, else their
--  initials (the app decides the last part). Only the photo's path or address is returned, never an email.
--  A store (warehouse) gets an optional logo, kept in its own public folder; only an admin can set or remove it. The product page shows it,
--  or a store icon when there is none.

-- ============================================================ A. reviewers' photos
create or replace function public.review_json(r public.product_reviews, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body, 'name', public.review_display_name(r.user_id),
    'created_at', r.created_at, 'edited', r.edited_at is not null, 'helpful', r.helpful_count,
    'reply', r.reply, 'reply_at', r.reply_at, 'mine', (p_uid is not null and r.user_id = p_uid),
    'voted', (p_uid is not null and exists (select 1 from public.review_votes v where v.review_id = r.id and v.user_id = p_uid)),
    'avatar_path', (select pr.avatar_path from public.profiles pr where pr.id = r.user_id),
    'google_photo', (select case when g.url ~ '^https://' then g.url end
                       from (select coalesce(nullif(u.raw_user_meta_data ->> 'avatar_url', ''), nullif(u.raw_user_meta_data ->> 'picture', '')) as url
                               from auth.users u where u.id = r.user_id) g));
$$;

-- ============================================================ B. a logo for each store
alter table public.warehouses add column if not exists logo_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('store-logos', 'store-logos', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists store_logos_admin_insert on storage.objects;
create policy store_logos_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'store-logos' and public.is_admin());
drop policy if exists store_logos_admin_update on storage.objects;
create policy store_logos_admin_update on storage.objects for update to authenticated using (bucket_id = 'store-logos' and public.is_admin()) with check (bucket_id = 'store-logos' and public.is_admin());
drop policy if exists store_logos_admin_delete on storage.objects;
create policy store_logos_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'store-logos' and public.is_admin());
drop policy if exists store_logos_admin_select on storage.objects;
create policy store_logos_admin_select on storage.objects for select to authenticated using (bucket_id = 'store-logos' and public.is_admin());

-- The only way to set it. What is saved is the file's PATH inside the store's own folder (the app builds the address). An empty path removes the logo.
create or replace function public.admin_set_warehouse_logo(p_id uuid, p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_path text := nullif(trim(coalesce(p_path, '')), '');
begin
  if not public.is_admin() then raise exception 'Only an admin can change a store logo'; end if;
  if not exists (select 1 from public.warehouses where id = p_id) then raise exception 'Warehouse not found'; end if;
  if v_path is not null then
    if split_part(v_path, '/', 1) <> p_id::text then raise exception 'That logo is not in this store''s folder.'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'store-logos' and name = v_path) then raise exception 'That logo was not uploaded.'; end if;
  end if;
  update public.warehouses set logo_path = v_path, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_set_warehouse_logo(uuid, text) from public, anon;
grant execute on function public.admin_set_warehouse_logo(uuid, text) to authenticated;

-- Which stores have this product, now with each one's logo path (names and paths only: never quantities or addresses).
create or replace function public.product_stores(p_product text, p_variant uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'logo_path', s.logo_path) order by s.is_default desc, s.name), '[]'::jsonb)
    from (select w.id, w.name, w.is_default, w.logo_path
            from public.warehouses w
           where w.active and w.archived_at is null
             and exists (select 1 from public.warehouse_stock ws
                          where ws.warehouse_id = w.id and ws.product_id = p_product and ws.qty > 0
                            and (p_variant is null or ws.variant_id = p_variant))) s;
$$;
