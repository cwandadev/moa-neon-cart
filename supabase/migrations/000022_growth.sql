-- 000022: smart feed, profile photos, auto-assign riders (run it after 000021). Idempotent: safe to run twice.
--
--  A. Smart feed. The shop's "smart" order is now: what is bought and wishlisted, with recent activity counting more than old
--     (it halves every 30 days), counting only PAID orders that were not cancelled, sold-out products last, and a place every few
--     products for new arrivals so they get seen. The page needs no change: it already asks the database for the "smart" order.
--  B. Profile photos. A place to keep a customer's own photo (their own folder, size and type limits), and one safe way to set it.
--  C. Auto-assign. Riders can go online and share where they are. When an order is ready, the nearest FREE online rider (within the
--     radius from the order's warehouse) is OFFERED it for a short time; if they decline or do not answer, the next nearest is offered it;
--     after a few tries it simply stays in the Available list for everyone, as it does today. It is OFF until an admin turns it on.

-- ============================================================ A. Smart feed
create or replace function public.catalog_products(
  p_search     text    default null,
  p_categories text[]  default null,
  p_min_price  int     default null,
  p_max_price  int     default null,
  p_in_stock   boolean default false,
  p_min_rating numeric default null,
  p_sort       text    default 'smart',
  p_limit      int     default 12,
  p_offset     int     default 0
) returns jsonb
language sql stable security definer set search_path = public as $$
  with base as (
    select
      p.*,
      c.name as category_name,
      (select count(*) from wishlist_items w where w.product_id = p.id) as wishlist_count,
      (select coalesce(sum(oi.qty), 0) from order_items oi where oi.product_id = p.id) as order_count,
      -- what counts for the smart order: paid, not cancelled, and recent activity worth more than old (half-life 30 days)
      (select coalesce(sum(oi.qty * power(0.5, greatest(0, extract(epoch from (now() - coalesce(o.paid_at, o.created_at)))) / 86400.0 / 30.0)), 0)
         from order_items oi join orders o on o.id = oi.order_id
        where oi.product_id = p.id and o.payment_status = 'paid' and o.fulfilment_status <> 'cancelled') as bought_recent,
      (select coalesce(sum(power(0.5, greatest(0, extract(epoch from (now() - w.created_at))) / 86400.0 / 30.0)), 0)
         from wishlist_items w where w.product_id = p.id) as wished_recent
    from products p
    join categories c on c.id = p.category_id
    where p.archived_at is null
      and (p_search is null or p_search = ''
           or p.name ilike '%' || p_search || '%'
           or c.name ilike '%' || p_search || '%'
           or array_to_string(p.tags, ' ') ilike '%' || p_search || '%')
      and (p_categories is null or cardinality(p_categories) = 0 or c.name = any (p_categories))
      and (p_min_price is null or p.price >= p_min_price)
      and (p_max_price is null or p.price <= p_max_price)
      and (not coalesce(p_in_stock, false) or p.stock > 0)
      and (p_min_rating is null or p.rating >= p_min_rating)
  ),
  scored as (
    select b.*,
      round((b.bought_recent * 3 + b.wished_recent * 1.6)::numeric, 3) as smart_score,
      (b.stock > 0 and b.created_at > now() - interval '14 days') as is_new
    from base b
  ),
  ranked as (
    select s.*,
      row_number() over (order by (s.stock > 0) desc, s.smart_score desc, s.created_at desc, s.id) as pop_rank,
      case when s.is_new then row_number() over (partition by s.is_new order by s.created_at desc, s.id) end as new_rank
    from scored s
  ),
  keyed as (
    -- a new product takes every fourth place (the 4th, 8th, 12th ...), unless it has already earned a better one;
    -- sold-out products go after everything else
    select r.*,
      case when r.stock > 0 then least(r.pop_rank::numeric, coalesce(r.new_rank * 4 - 0.5, 1e9)) else 1e6 + r.pop_rank end as smart_key
    from ranked r
  ),
  page as (
    select *
    from keyed
    order by
      case p_sort
        when 'price-asc'  then price::numeric
        when 'price-desc' then -price::numeric
        when 'rating'     then -rating::numeric
        when 'new'        then -(extract(epoch from created_at))::numeric
        else smart_key
      end asc,
      created_at desc, id
    limit least(greatest(coalesce(p_limit, 12), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(x) - 'bought_recent' - 'wished_recent' - 'pop_rank' - 'new_rank' - 'smart_key' - 'is_new' order by
          case p_sort
            when 'price-asc'  then x.price::numeric
            when 'price-desc' then -x.price::numeric
            when 'rating'     then -x.rating::numeric
            when 'new'        then -(extract(epoch from x.created_at))::numeric
            else x.smart_key
          end asc,
          x.created_at desc, x.id)
        from page x
      ),
      '[]'::jsonb
    )
  )
$$;
revoke all on function public.catalog_products(text, text[], int, int, boolean, numeric, text, int, int) from public, anon, authenticated;
grant execute on function public.catalog_products(text, text[], int, int, boolean, numeric, text, int, int) to anon, authenticated, service_role;

-- ============================================================ B. Profile photos
alter table public.profiles add column if not exists avatar_path text;

-- Public to read by its address (that is how a photo is shown), but only the owner can add, replace or remove files, only in their own
-- folder, and only small pictures. The "select" policy is limited to your own folder too: removing a file needs it, but it must never let
-- anyone LIST everyone's files.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- The only way to set the photo. What is saved is the file's PATH inside the person's own avatars folder (the app builds the address),
-- never a web address someone typed: so it cannot point at another website (which could be used to see who opens a page), nor at
-- someone else's photo, and the file must really be there.
create or replace function public.set_my_avatar(p_path text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_path is not null then
    if p_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9._-]+$') then raise exception 'That is not one of your photos.'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = p_path) then raise exception 'That photo was not uploaded.'; end if;
  end if;
  update public.profiles set avatar_path = p_path, updated_at = now() where id = auth.uid();
  return jsonb_build_object('ok', true, 'avatar_path', p_path);
end $$;
revoke all on function public.set_my_avatar(text) from public, anon;
grant execute on function public.set_my_avatar(text) to authenticated;

-- ============================================================ C. Auto-assign riders
alter table public.delivery_settings
  add column if not exists auto_assign boolean not null default false,
  add column if not exists auto_radius_km numeric not null default 5 check (auto_radius_km between 0.5 and 100),
  add column if not exists offer_seconds int not null default 60 check (offer_seconds between 15 and 300),
  add column if not exists auto_max_offers int not null default 3 check (auto_max_offers between 1 and 10),
  add column if not exists location_fresh_seconds int not null default 180 check (location_fresh_seconds between 30 and 1800);

-- Where each online rider is. A rider whose phone is locked or whose app is closed stops sending it, so it goes stale and they are not offered anything.
create table if not exists public.rider_presence (
  rider_id uuid primary key references public.profiles (id) on delete cascade,
  online boolean not null default false,
  lat double precision,
  lng double precision,
  accuracy_m int,
  located_at timestamptz,
  online_since timestamptz,
  updated_at timestamptz not null default now(),
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180))
);
alter table public.rider_presence enable row level security;
drop policy if exists rider_presence_select on public.rider_presence;
create policy rider_presence_select on public.rider_presence for select to authenticated using (public.is_staff() or rider_id = auth.uid());

create table if not exists public.delivery_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'accepted', 'declined', 'expired', 'cancelled')),
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  rider_distance_m int
);
create unique index if not exists delivery_offers_one_open_per_order on public.delivery_offers (order_id) where status = 'open';
create unique index if not exists delivery_offers_one_open_per_rider on public.delivery_offers (rider_id) where status = 'open';
create index if not exists delivery_offers_by_order on public.delivery_offers (order_id);
alter table public.delivery_offers enable row level security;
drop policy if exists delivery_offers_select on public.delivery_offers;
create policy delivery_offers_select on public.delivery_offers for select to authenticated using (public.is_staff() or rider_id = auth.uid());

alter table public.orders add column if not exists dispatch_broadcast_at timestamptz;

-- When an order has nobody to be offered to, every rider is told it is waiting: once, not every time something checks again.
create or replace function public.broadcast_order_waiting(p_order_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_code text; v_wh uuid;
begin
  perform set_config('app.order_system', 'on', true);
  update public.orders set dispatch_broadcast_at = now() where id = p_order_id and dispatch_broadcast_at is null returning code, warehouse_id into v_code, v_wh;
  if v_code is not null then
    perform public.notify_riders('delivery_available', 'info', 'New order ' || v_code || ' is ready',
      'Collect it at ' || coalesce((select name from public.warehouses where id = v_wh), 'the warehouse') || '.', '/rider');
  end if;
end $$;

-- Offer one order to the nearest free, online rider who has not been offered it. Returns true when an offer was made.
create or replace function public.dispatch_order(p_order_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_set public.delivery_settings%rowtype; v_o public.orders%rowtype; v_w public.warehouses%rowtype;
  v_rider uuid; v_dist int;
begin
  select * into v_set from public.delivery_settings where id = 1;
  if not found or not v_set.auto_assign then return false; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.fulfilment_status <> 'confirmed' then return false; end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id) then return false; end if;
  if exists (select 1 from public.delivery_offers where order_id = p_order_id and status = 'open') then return false; end if;
  -- after a few riders have turned it down or missed it, it stays in the Available list for everyone
  if (select count(*) from public.delivery_offers where order_id = p_order_id and status in ('declined', 'expired')) >= v_set.auto_max_offers then
    perform public.broadcast_order_waiting(p_order_id);
    return false;
  end if;
  select * into v_w from public.warehouses where id = coalesce(v_o.warehouse_id, (select id from public.warehouses where active and is_default limit 1));

  select p.rider_id,
         case when v_w.lat is not null then public.distance_m(v_w.lat, v_w.lng, p.lat, p.lng) end
    into v_rider, v_dist
    from public.rider_presence p
    join public.profiles pr on pr.id = p.rider_id and pr.role = 'rider'
   where p.online and p.lat is not null
     and p.located_at > now() - make_interval(secs => v_set.location_fresh_seconds)
     -- free: nothing on their hands, and not already being offered something
     and not exists (select 1 from public.deliveries d where d.rider_id = p.rider_id and d.status in ('assigned', 'picked_up'))
     and not exists (select 1 from public.delivery_offers f where f.rider_id = p.rider_id and f.status = 'open')
     -- never the same rider twice for the same order (declined, missed, or gave it back)
     and not exists (select 1 from public.delivery_offers f where f.rider_id = p.rider_id and f.order_id = p_order_id)
     -- not too far from where the parcel is collected
     and (v_w.lat is null or public.distance_m(v_w.lat, v_w.lng, p.lat, p.lng) <= v_set.auto_radius_km * 1000)
   order by case when v_w.lat is not null then public.distance_m(v_w.lat, v_w.lng, p.lat, p.lng) end nulls last,
            coalesce((select max(d.delivered_at) from public.deliveries d where d.rider_id = p.rider_id), '-infinity'::timestamptz)
   limit 1;
  if v_rider is null then
    perform public.broadcast_order_waiting(p_order_id);
    return false;
  end if;

  insert into public.delivery_offers (order_id, rider_id, expires_at, rider_distance_m)
  values (p_order_id, v_rider, now() + make_interval(secs => v_set.offer_seconds), v_dist);
  perform public.notify_user(v_rider, 'delivery_offer', 'info', 'New order ' || v_o.code || ' for you',
    'Open the app and accept it within ' || v_set.offer_seconds || ' seconds.', '/rider');
  return true;
exception when unique_violation then
  return false;
end $$;

-- Moves things along: closes offers that ran out of time (or whose rider went quiet) and offers waiting orders to the next rider.
create or replace function public.dispatch_tick() returns void
language plpgsql security definer set search_path = public as $$
declare v_set public.delivery_settings%rowtype; r record;
begin
  update public.delivery_offers set status = 'expired', responded_at = now() where status = 'open' and expires_at <= now();
  select * into v_set from public.delivery_settings where id = 1;
  if not found or not v_set.auto_assign then return; end if;
  update public.delivery_offers f set status = 'cancelled', responded_at = now()
   where f.status = 'open'
     and not exists (select 1 from public.rider_presence p where p.rider_id = f.rider_id and p.online
                       and p.located_at > now() - make_interval(secs => v_set.location_fresh_seconds));
  for r in
    select o.id from public.orders o
     where o.fulfilment_status = 'confirmed'
       -- only orders that became ready in the last day: turning this on must not suddenly offer old orders that were handled some other way
       and coalesce(o.paid_at, o.updated_at) > now() - interval '24 hours'
       and not exists (select 1 from public.deliveries d where d.order_id = o.id)
       and not exists (select 1 from public.delivery_offers f where f.order_id = o.id and f.status = 'open')
     order by coalesce(o.paid_at, o.updated_at)
     limit 50
  loop
    perform public.dispatch_order(r.id);
  end loop;
end $$;

-- A new paid order is offered to the nearest free rider; if there is nobody to offer it to, every rider is told, as before.
create or replace function public.trg_order_ready_notify_riders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status = 'confirmed' and old.fulfilment_status is distinct from 'confirmed' and not exists (select 1 from public.deliveries where order_id = new.id) then
    if public.dispatch_order(new.id) then return new; end if;
    perform public.broadcast_order_waiting(new.id);       -- (a no-op if dispatch_order already told everyone)
  end if;
  return new;
end $$;

-- However a delivery starts (the offer was accepted, a rider took it, or the office gave it), any open offer for that order is closed.
create or replace function public.trg_delivery_closes_offers() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.delivery_offers set status = case when rider_id = new.rider_id then 'accepted' else 'cancelled' end, responded_at = now()
   where order_id = new.order_id and status = 'open';
  return new;
end $$;
drop trigger if exists delivery_closes_offers on public.deliveries;
create trigger delivery_closes_offers after insert on public.deliveries for each row execute function public.trg_delivery_closes_offers();

-- While an order is being offered to one rider, no other rider can take it from the list.
create or replace function public.rider_accept_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype; v_set public.delivery_settings%rowtype; v_active int; v_id uuid;
begin
  if not public.is_rider() then raise exception 'Only riders can take deliveries'; end if;
  select * into v_set from public.delivery_settings where id = 1;
  select count(*) into v_active from public.deliveries where rider_id = auth.uid() and status in ('assigned', 'picked_up');
  if v_active >= v_set.max_active_per_rider then raise exception 'You already have % deliveries. Finish one first.', v_active; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id) then raise exception 'Another rider just took this order.'; end if;
  if v_order.fulfilment_status <> 'confirmed' then raise exception 'This order is not ready for a rider.'; end if;
  if exists (select 1 from public.delivery_offers where order_id = p_order_id and status = 'open' and expires_at > now() and rider_id <> auth.uid()) then
    raise exception 'This order was offered to another rider first.';
  end if;
  insert into public.deliveries (order_id, rider_id, code) values (p_order_id, auth.uid(), public.new_delivery_code()) returning id into v_id;
  perform public.log_delivery_event(p_order_id, v_id, 'taken', jsonb_build_object('rider', auth.uid()));
  return jsonb_build_object('ok', true);
end $$;

-- The list of orders waiting for any rider: not the ones being offered to someone right now.
create or replace function public.rider_available_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_rider() or public.is_staff()) then raise exception 'Riders only'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'ready_since')
      from (
        select jsonb_build_object(
          'order_id', o.id, 'code', o.code, 'ready_since', coalesce(o.paid_at, o.updated_at),
          'warehouse', w.name,
          'distance_km', case when o.lat is not null and w.lat is not null then round(public.distance_m(w.lat, w.lng, o.lat, o.lng) / 1000.0, 1) end
        ) as x
        from public.orders o
        left join public.warehouses w on w.id = coalesce(o.warehouse_id, (select id from public.warehouses where active and is_default limit 1))
        where o.fulfilment_status = 'confirmed'
          and not exists (select 1 from public.deliveries d where d.order_id = o.id)
          and not exists (select 1 from public.delivery_offers f where f.order_id = o.id and f.status = 'open' and f.expires_at > now())
      ) s
  ), '[]'::jsonb);
end $$;

-- Going online or offline. Going offline withdraws any offer they had, so it goes to the next rider at once.
create or replace function public.rider_set_online(p_online boolean, p_lat double precision default null, p_lng double precision default null, p_accuracy integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then raise exception 'That location is not valid.'; end if;
  insert into public.rider_presence (rider_id, online, lat, lng, accuracy_m, located_at, online_since, updated_at)
  values (auth.uid(), coalesce(p_online, false), p_lat, p_lng, p_accuracy, case when p_lat is not null then now() end, case when p_online then now() end, now())
  on conflict (rider_id) do update set
    online = coalesce(p_online, false),
    lat = coalesce(p_lat, rider_presence.lat), lng = coalesce(p_lng, rider_presence.lng),
    accuracy_m = case when p_lat is not null then p_accuracy else rider_presence.accuracy_m end,
    located_at = case when p_lat is not null then now() else rider_presence.located_at end,
    online_since = case when p_online and not rider_presence.online then now() when p_online then rider_presence.online_since end,
    updated_at = now();
  if not coalesce(p_online, false) then
    update public.delivery_offers set status = 'cancelled', responded_at = now() where rider_id = auth.uid() and status = 'open';
  end if;
  perform public.dispatch_tick();
  return jsonb_build_object('ok', true, 'online', coalesce(p_online, false));
end $$;

-- A rider who is online tells us where they are, now and then, while the app is open.
create or replace function public.rider_ping(p_lat double precision, p_lng double precision, p_accuracy integer default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_online boolean;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'That location is not valid.'; end if;
  update public.rider_presence set lat = p_lat, lng = p_lng, accuracy_m = p_accuracy, located_at = now(), updated_at = now()
   where rider_id = auth.uid() and online returning online into v_online;
  return jsonb_build_object('ok', coalesce(v_online, false), 'online', coalesce(v_online, false));
end $$;

-- What the rider's screen needs: are they online, and is there an order being offered to them right now. (No contents, no customer.)
create or replace function public.rider_my_offer() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_f public.delivery_offers%rowtype; v_o public.orders%rowtype; v_w public.warehouses%rowtype; v_offer jsonb; v_auto boolean;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  perform public.dispatch_tick();
  select auto_assign into v_auto from public.delivery_settings where id = 1;
  select f.* into v_f from public.delivery_offers f join public.orders o on o.id = f.order_id
   where f.rider_id = auth.uid() and f.status = 'open' and f.expires_at > now() and o.fulfilment_status = 'confirmed' limit 1;
  if found then
    select * into v_o from public.orders where id = v_f.order_id;
    select * into v_w from public.warehouses where id = coalesce(v_o.warehouse_id, (select id from public.warehouses where active and is_default limit 1));
    v_offer := jsonb_build_object(
      'offer_id', v_f.id, 'order_id', v_o.id, 'code', v_o.code,
      'warehouse', jsonb_build_object('name', v_w.name, 'address', v_w.address),
      'pickup_m', v_f.rider_distance_m,
      'delivery_km', case when v_o.lat is not null and v_w.lat is not null then round(public.distance_m(v_w.lat, v_w.lng, v_o.lat, v_o.lng) / 1000.0, 1) end,
      'seconds_left', greatest(0, ceil(extract(epoch from (v_f.expires_at - now())))::int),
      'expires_at', v_f.expires_at);
  end if;
  return jsonb_build_object('auto', coalesce(v_auto, false), 'online', coalesce((select online from public.rider_presence where rider_id = auth.uid()), false), 'offer', v_offer);
end $$;

-- Accept or decline an offer. Accepting makes it an ordinary delivery. Declining (or running out of time) offers it to the next rider.
create or replace function public.rider_respond_offer(p_offer uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_f public.delivery_offers%rowtype;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  select * into v_f from public.delivery_offers where id = p_offer and rider_id = auth.uid() for update;
  if not found then raise exception 'This offer is not yours.'; end if;
  if v_f.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'gone'); end if;
  if v_f.expires_at <= now() then
    update public.delivery_offers set status = 'expired', responded_at = now() where id = p_offer;
    perform public.dispatch_order(v_f.order_id);
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if not coalesce(p_accept, false) then
    update public.delivery_offers set status = 'declined', responded_at = now() where id = p_offer;
    perform public.dispatch_order(v_f.order_id);
    return jsonb_build_object('ok', true, 'declined', true);
  end if;
  begin
    perform public.rider_accept_order(v_f.order_id);
  exception when others then
    update public.delivery_offers set status = 'cancelled', responded_at = now() where id = p_offer and status = 'open';
    return jsonb_build_object('ok', false, 'reason', 'gone', 'message', sqlerrm);
  end;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================ who may call what
revoke all on function public.broadcast_order_waiting(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_order(uuid) from public, anon, authenticated;
revoke all on function public.dispatch_tick() from public, anon, authenticated;
revoke all on function public.rider_accept_order(uuid) from public, anon;
revoke all on function public.rider_available_orders() from public, anon;
revoke all on function public.rider_set_online(boolean, double precision, double precision, integer) from public, anon;
revoke all on function public.rider_ping(double precision, double precision, integer) from public, anon;
revoke all on function public.rider_my_offer() from public, anon;
revoke all on function public.rider_respond_offer(uuid, boolean) from public, anon;
grant execute on function public.rider_accept_order(uuid) to authenticated;
grant execute on function public.rider_available_orders() to authenticated;
grant execute on function public.rider_set_online(boolean, double precision, double precision, integer) to authenticated;
grant execute on function public.rider_ping(double precision, double precision, integer) to authenticated;
grant execute on function public.rider_my_offer() to authenticated;
grant execute on function public.rider_respond_offer(uuid, boolean) to authenticated;

-- Every minute, so offers move on even when no rider's app is open. (Skipped quietly where scheduled jobs are not available.)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'moa-dispatch-tick';
    perform cron.schedule('moa-dispatch-tick', '* * * * *', 'select public.dispatch_tick()');
  end if;
exception when others then
  raise notice 'Could not schedule the dispatch job: %', sqlerrm;
end $$;
