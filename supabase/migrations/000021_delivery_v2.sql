-- 000021: delivery, second round (run it after 000020).
--  * Warehouses: as many pickup points as you like (MOA Mart Kigali, MOA Mart Musanze, ...). Each paid order is given the nearest one automatically
--    (staff can change it), and the rider sees where to collect it. Stock is still one shared pool: these are pickup points, not separate stock.
--  * The code is the proof. A delivery is completed with the customer's 4-digit code alone. A photo is only for when the code cannot be used,
--    and then it needs a reason, the name of the person who received it, the rider's location and a fresh photo, and the office is asked to review it.
--  * A rider's phone never receives what is in a parcel, and not the customer's name, address or phone until the parcel has been collected.
--  * Riders get notifications: a new order is ready, an order was given to them or taken away, it was cancelled, the code was unlocked.
-- Idempotent: safe to run twice.

-- ============ Warehouses ============
create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 60),
  address text not null default '' check (char_length(address) <= 200),
  phone text not null default '' check (char_length(phone) <= 30),
  lat double precision,
  lng double precision,
  active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180))
);
create unique index if not exists warehouses_one_default on public.warehouses (is_default) where is_default;
alter table public.warehouses enable row level security;
drop policy if exists warehouses_staff_select on public.warehouses;
create policy warehouses_staff_select on public.warehouses for select to authenticated using (public.is_staff());
-- No insert, update or delete policy: changes go through admin_save_warehouse, which keeps one default and never leaves none active.

-- The pickup point that was in the settings becomes the first warehouse.
insert into public.warehouses (name, address, phone, lat, lng, is_default)
select coalesce(nullif(trim(pickup_name), ''), 'MOA Mart'), pickup_address, pickup_phone, pickup_lat, pickup_lng, true
  from public.delivery_settings where id = 1 and not exists (select 1 from public.warehouses);
insert into public.warehouses (name, is_default) select 'MOA Mart', true where not exists (select 1 from public.warehouses);

alter table public.orders
  add column if not exists warehouse_id uuid references public.warehouses (id) on delete restrict,
  add column if not exists warehouse_auto boolean not null default true;

alter table public.deliveries
  add column if not exists verified_by text,
  add column if not exists needs_review boolean not null default false,
  add column if not exists fallback_reason text,
  add column if not exists received_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliveries_verified_by_check') then
    alter table public.deliveries add constraint deliveries_verified_by_check check (verified_by is null or verified_by in ('code', 'photo', 'office'));
  end if;
end $$;
-- Deliveries made before this update were made with a code (and a photo), or by the office with a reason.
update public.deliveries set verified_by = case when override_reason is not null then 'office' else 'code' end where status = 'delivered' and verified_by is null;

create or replace function public.pick_warehouse(p_lat double precision, p_lng double precision) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.warehouses where active and lat is not null and p_lat is not null and p_lng is not null order by public.distance_m(lat, lng, p_lat, p_lng) limit 1),
    (select id from public.warehouses where active and is_default limit 1),
    (select id from public.warehouses where active order by created_at limit 1)
  );
$$;

-- Orders already waiting or on the way get a warehouse too.
update public.orders set warehouse_id = public.pick_warehouse(lat, lng)
 where warehouse_id is null and fulfilment_status in ('confirmed', 'out_for_delivery');

-- A paid order is given its warehouse the moment it becomes "confirmed" (after the payment rule has set that status, hence the name).
create or replace function public.trg_order_pick_warehouse() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status = 'confirmed' and old.fulfilment_status is distinct from 'confirmed' and new.warehouse_id is null then
    new.warehouse_id := public.pick_warehouse(new.lat, new.lng);
  end if;
  return new;
end $$;
drop trigger if exists zzz_order_warehouse_upd on public.orders;
create trigger zzz_order_warehouse_upd before update on public.orders for each row execute function public.trg_order_pick_warehouse();

create or replace function public.admin_save_warehouse(
  p_id uuid, p_name text, p_address text, p_phone text, p_lat double precision, p_lng double precision, p_active boolean default true, p_make_default boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_old public.warehouses%rowtype; v_name text := trim(coalesce(p_name, ''));
begin
  if not public.is_admin() then raise exception 'Only an admin can change warehouses'; end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then raise exception 'Give the warehouse a name (2 to 60 letters).'; end if;
  if (p_lat is null) <> (p_lng is null) then raise exception 'Give both the latitude and the longitude, or neither.'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then raise exception 'That location is not valid.'; end if;
  if p_id is null then
    insert into public.warehouses (name, address, phone, lat, lng, active) values (v_name, trim(coalesce(p_address, '')), trim(coalesce(p_phone, '')), p_lat, p_lng, coalesce(p_active, true)) returning id into v_id;
  else
    select * into v_old from public.warehouses where id = p_id for update;
    if not found then raise exception 'Warehouse not found'; end if;
    if v_old.is_default and not coalesce(p_active, true) then raise exception 'This is the default warehouse. Make another one the default first.'; end if;
    update public.warehouses set name = v_name, address = trim(coalesce(p_address, '')), phone = trim(coalesce(p_phone, '')), lat = p_lat, lng = p_lng, active = coalesce(p_active, true), updated_at = now() where id = p_id;
    v_id := p_id;
  end if;
  if not exists (select 1 from public.warehouses where active) then raise exception 'At least one warehouse must stay active.'; end if;
  if coalesce(p_make_default, false) or not exists (select 1 from public.warehouses where is_default) then
    if not (select active from public.warehouses where id = v_id) then raise exception 'A closed warehouse cannot be the default.'; end if;
    update public.warehouses set is_default = false where is_default and id <> v_id;
    update public.warehouses set is_default = true where id = v_id;
  end if;
  return v_id;
end $$;

-- ============ Notifications for riders ============
create or replace function public.notify_riders(p_kind text, p_severity text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, severity, title, body, link)
  select id, p_kind, p_severity, p_title, coalesce(p_body, ''), p_link from public.profiles where role = 'rider';
$$;
revoke all on function public.notify_riders(text, text, text, text, text) from public, anon, authenticated;

create or replace function public.trg_order_ready_notify_riders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status = 'confirmed' and old.fulfilment_status is distinct from 'confirmed' and not exists (select 1 from public.deliveries where order_id = new.id) then
    perform public.notify_riders('delivery_available', 'info', 'New order ' || new.code || ' is ready',
      'Collect it at ' || coalesce((select name from public.warehouses where id = new.warehouse_id), 'the warehouse') || '.', '/rider');
  end if;
  return new;
end $$;
drop trigger if exists order_ready_notify_riders on public.orders;
-- Not limited to the status column: a payment changes the status as a side effect, so the statement itself never mentions it.
create trigger order_ready_notify_riders after update on public.orders for each row execute function public.trg_order_ready_notify_riders();

-- Cancelling an order closes its delivery, and tells the rider not to deliver it.
create or replace function public.trg_order_cancel_closes_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.fulfilment_status = 'cancelled' and old.fulfilment_status is distinct from 'cancelled' then
    for r in select id, rider_id from public.deliveries where order_id = new.id and status in ('assigned', 'picked_up') loop
      update public.deliveries set status = 'failed', failed_at = now(), failed_reason = 'cancelled' where id = r.id;
      perform public.notify_user(r.rider_id, 'delivery_cancelled', 'critical', 'Order ' || new.code || ' was cancelled',
        'Do not deliver it. If you already have it, bring it back to the warehouse.', '/rider');
    end loop;
  end if;
  return new;
end $$;

-- ============ What a rider is allowed to see ============
-- An order waiting to be taken: its code, where to collect it, how far it goes, how long it has waited. Nothing about what is in it, and nothing about the customer.
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
        where o.fulfilment_status = 'confirmed' and not exists (select 1 from public.deliveries d where d.order_id = o.id)
      ) s
  ), '[]'::jsonb);
end $$;

-- The rider's own deliveries. The customer's details arrive only once the parcel is collected. Never the contents, never prices, never the code.
create or replace function public.rider_my_deliveries() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_today timestamptz := date_trunc('day', now() at time zone 'Africa/Kigali') at time zone 'Africa/Kigali';
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  return coalesce((
    select jsonb_agg(x order by (x->>'sort_at') desc)
      from (
        select jsonb_build_object(
          'order_id', o.id, 'code', o.code, 'status', d.status, 'order_status', o.fulfilment_status,
          'assigned_at', d.assigned_at, 'picked_up_at', d.picked_up_at, 'delivered_at', d.delivered_at,
          'failed_reason', d.failed_reason, 'attempts_left', greatest(0, 5 - d.code_attempts), 'verified_by', d.verified_by,
          'warehouse', (select jsonb_build_object('name', w.name, 'address', w.address, 'phone', w.phone, 'lat', w.lat, 'lng', w.lng)
                          from public.warehouses w where w.id = coalesce(o.warehouse_id, (select id from public.warehouses where active and is_default limit 1))),
          'customer_name', case when d.status = 'picked_up' then o.customer_name end,
          'phone', case when d.status = 'picked_up' then o.phone end,
          'location', case when d.status = 'picked_up' then o.location end,
          'preferred_time', case when d.status = 'picked_up' then o.preferred_time end,
          'notes', case when d.status = 'picked_up' then o.notes end,
          'lat', case when d.status = 'picked_up' then o.lat end,
          'lng', case when d.status = 'picked_up' then o.lng end,
          'sort_at', coalesce(d.delivered_at, d.failed_at, d.picked_up_at, d.assigned_at)
        ) as x
        from public.deliveries d join public.orders o on o.id = d.order_id
        where d.rider_id = auth.uid()
          and (d.status in ('assigned', 'picked_up') or coalesce(d.delivered_at, d.failed_at) >= v_today)
      ) s
  ), '[]'::jsonb);
end $$;

-- Kept so an older copy of the rider app still works until it is updated.
create or replace function public.rider_pickup_point() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_rider() or public.is_staff() then
    (select jsonb_build_object('name', name, 'address', address, 'phone', phone, 'lat', lat, 'lng', lng) from public.warehouses where active and is_default limit 1)
  end;
$$;

-- ============ Completing a delivery ============
-- With the code alone. A wrong code is an answer, not an error, so the attempt is kept.
drop function if exists public.rider_complete_delivery(uuid, text, text, double precision, double precision);
create or replace function public.rider_complete_delivery(p_order_id uuid, p_code text, p_lat double precision default null, p_lng double precision default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_o public.orders%rowtype; v_set public.delivery_settings%rowtype; v_dist int; v_flag text;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status = 'delivered' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_d.status <> 'picked_up' then raise exception 'Collect the order first.'; end if;
  if v_o.fulfilment_status <> 'out_for_delivery' then raise exception 'This order was cancelled or changed. Check with the office.'; end if;
  if v_d.code_attempts >= 5 then return jsonb_build_object('ok', false, 'reason', 'locked', 'attempts_left', 0); end if;
  if coalesce(trim(p_code), '') <> v_d.code then
    update public.deliveries set code_attempts = code_attempts + 1 where id = v_d.id;
    perform public.log_delivery_event(p_order_id, v_d.id, 'code_wrong', jsonb_build_object('attempt', v_d.code_attempts + 1));
    return jsonb_build_object('ok', false, 'reason', case when v_d.code_attempts + 1 >= 5 then 'locked' else 'wrong_code' end, 'attempts_left', greatest(0, 5 - (v_d.code_attempts + 1)));
  end if;
  select * into v_set from public.delivery_settings where id = 1;
  if v_o.lat is null then v_flag := 'no_pin';
  elsif p_lat is null or p_lng is null then v_flag := 'no_location';
  else
    v_dist := public.distance_m(v_o.lat, v_o.lng, p_lat, p_lng);
    if v_dist > v_set.proof_radius_m then v_flag := 'far_from_pin'; end if;
  end if;
  perform set_config('app.order_system', 'on', true);
  update public.deliveries set status = 'delivered', delivered_at = now(), proof_lat = p_lat, proof_lng = p_lng, proof_distance_m = v_dist, proof_flag = v_flag,
         verified_by = 'code', needs_review = false where id = v_d.id;
  update public.orders set fulfilment_status = 'delivered' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'delivered', jsonb_build_object('by', 'code', 'flag', v_flag, 'distance_m', v_dist));
  if v_flag = 'far_from_pin' then
    perform public.notify_staff('delivery_flag', 'warning', 'Check delivery ' || v_o.code, 'The rider was about ' || v_dist || ' m from the customer''s pin when delivering.', '/admin/orders?q=' || v_o.code);
  end if;
  return jsonb_build_object('ok', true, 'flag', v_flag);
end $$;

-- Only when the code cannot be used. This needs a reason, the name of the person who received it, the rider's location and a fresh photo,
-- and the office is asked to review it.
create or replace function public.rider_complete_without_code(
  p_order_id uuid, p_reason text, p_received_by text, p_proof_path text, p_lat double precision, p_lng double precision
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.deliveries%rowtype; v_o public.orders%rowtype; v_set public.delivery_settings%rowtype;
  v_recv text := trim(coalesce(p_received_by, '')); v_dist int; v_flag text; v_made timestamptz;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  if p_reason not in ('no_phone', 'code_not_working', 'someone_else') then raise exception 'Pick a reason.'; end if;
  if char_length(v_recv) < 2 or char_length(v_recv) > 60 then raise exception 'Write the name of the person who received it.'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status = 'delivered' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_d.status <> 'picked_up' then raise exception 'Collect the order first.'; end if;
  if v_o.fulfilment_status <> 'out_for_delivery' then raise exception 'This order was cancelled or changed. Check with the office.'; end if;
  if p_lat is null or p_lng is null then return jsonb_build_object('ok', false, 'reason', 'location_required'); end if;
  select created_at into v_made from storage.objects
    where bucket_id = 'delivery-proofs' and name = p_proof_path and owner = auth.uid() and split_part(name, '/', 1) = p_order_id::text;
  if p_proof_path is null or v_made is null or v_made < v_d.picked_up_at or v_made < now() - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'photo_missing');
  end if;
  select * into v_set from public.delivery_settings where id = 1;
  if v_o.lat is null then v_flag := 'no_pin';
  else
    v_dist := public.distance_m(v_o.lat, v_o.lng, p_lat, p_lng);
    if v_dist > v_set.proof_radius_m then v_flag := 'far_from_pin'; end if;
  end if;
  perform set_config('app.order_system', 'on', true);
  update public.deliveries set status = 'delivered', delivered_at = now(), proof_path = p_proof_path, proof_lat = p_lat, proof_lng = p_lng, proof_distance_m = v_dist,
         proof_flag = v_flag, verified_by = 'photo', needs_review = true, fallback_reason = p_reason, received_by = v_recv where id = v_d.id;
  update public.orders set fulfilment_status = 'delivered' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'delivered_no_code', jsonb_build_object('reason', p_reason, 'received_by', v_recv, 'flag', v_flag, 'distance_m', v_dist));
  perform public.notify_staff('delivery_review', 'warning', 'Delivered without a code: ' || v_o.code,
    case p_reason when 'no_phone' then 'The customer could not open the code (no phone or battery).' when 'code_not_working' then 'The customer could not find or read the code.' else 'Someone else received it.' end
    || ' Received by ' || v_recv || '. Please check the photo.', '/admin/orders?q=' || v_o.code);
  return jsonb_build_object('ok', true, 'flag', v_flag);
end $$;

create or replace function public.admin_review_delivery(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if not found then raise exception 'This order has no delivery.'; end if;
  update public.deliveries set needs_review = false where id = v_d.id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'reviewed', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ============ Staff actions: the same rules as before, now telling the rider ============
create or replace function public.admin_set_order_warehouse(p_order_id uuid, p_warehouse_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_w public.warehouses%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select * into v_w from public.warehouses where id = p_warehouse_id and active;
  if not found then raise exception 'Pick an open warehouse.'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.fulfilment_status not in ('pending', 'confirmed', 'out_for_delivery') then raise exception 'This order is finished.'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if found and v_d.status in ('picked_up', 'delivered') then raise exception 'The rider has already collected it.'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.orders set warehouse_id = p_warehouse_id, warehouse_auto = false where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'warehouse_changed', jsonb_build_object('warehouse', v_w.name));
  if v_d.id is not null and v_d.status = 'assigned' then
    perform public.notify_user(v_d.rider_id, 'delivery_moved', 'warning', 'New place to collect ' || v_o.code, 'Collect it at ' || v_w.name || '.', '/rider');
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.set_order_pin(p_code text, p_lat double precision, p_lng double precision, p_accuracy integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'That location is not valid.'; end if;
  select * into v_o from public.orders where code = upper(trim(p_code)) and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.fulfilment_status in ('delivered', 'cancelled') then raise exception 'This order is finished.'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.orders set lat = p_lat, lng = p_lng, pin_accuracy_m = greatest(0, least(coalesce(p_accuracy, 0), 100000)), pin_set_at = now(),
         -- a warehouse chosen by the system follows the customer's pin until a rider has the order; one chosen by staff stays
         warehouse_id = case when warehouse_auto and fulfilment_status = 'confirmed' and not exists (select 1 from public.deliveries d where d.order_id = orders.id)
                             then public.pick_warehouse(p_lat, p_lng) else warehouse_id end
   where id = v_o.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_assign_delivery(p_order_id uuid, p_rider uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_id uuid; v_old uuid;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if not exists (select 1 from public.profiles where id = p_rider and role = 'rider') then raise exception 'That person is not a rider.'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if found then
    if v_d.status in ('delivered') then raise exception 'This order was already delivered.'; end if;
    if v_d.status = 'picked_up' then raise exception 'The rider has already collected it. Wait for the result, or ask them to report it.'; end if;
    v_old := v_d.rider_id;
    perform set_config('app.order_system', 'on', true);
    update public.deliveries set rider_id = p_rider, status = 'assigned', assigned_by = auth.uid(), assigned_at = now(), code = public.new_delivery_code(),
           code_attempts = 0, picked_up_at = null, failed_at = null, failed_reason = null, failed_note = null, failed_photo_path = null where id = v_d.id;
    if v_o.fulfilment_status = 'out_for_delivery' then update public.orders set fulfilment_status = 'confirmed' where id = p_order_id; end if;
    v_id := v_d.id;
    perform public.log_delivery_event(p_order_id, v_id, 'reassigned', jsonb_build_object('rider', p_rider));
    if v_old is not null and v_old <> p_rider then
      perform public.notify_user(v_old, 'delivery_removed', 'warning', 'Order ' || v_o.code || ' was given to someone else', 'You do not need to deliver it.', '/rider');
    end if;
  else
    if v_o.fulfilment_status <> 'confirmed' then raise exception 'Only a confirmed order can be given to a rider.'; end if;
    insert into public.deliveries (order_id, rider_id, code, assigned_by) values (p_order_id, p_rider, public.new_delivery_code(), auth.uid()) returning id into v_id;
    perform public.log_delivery_event(p_order_id, v_id, 'assigned', jsonb_build_object('rider', p_rider));
  end if;
  perform public.notify_user(p_rider, 'delivery_assigned', 'info', 'New delivery ' || v_o.code, 'An order was given to you. Open the rider app.', '/rider');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_unassign_delivery(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_status text; v_code text;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select fulfilment_status, code into v_status, v_code from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if not found then raise exception 'This order has no rider.'; end if;
  if v_d.status = 'delivered' then raise exception 'This order was already delivered.'; end if;
  if v_d.status = 'picked_up' then raise exception 'The rider has already collected it. Wait for the result, or ask them to report it.'; end if;
  perform public.log_delivery_event(p_order_id, v_d.id, 'unassigned', '{}'::jsonb);
  perform set_config('app.order_system', 'on', true);
  if v_status = 'out_for_delivery' then update public.orders set fulfilment_status = 'confirmed' where id = p_order_id; end if;
  delete from public.deliveries where id = v_d.id;
  if v_d.status = 'assigned' then
    perform public.notify_user(v_d.rider_id, 'delivery_removed', 'warning', 'Order ' || v_code || ' was taken off you', 'You do not need to deliver it.', '/rider');
  end if;
  perform public.notify_riders('delivery_available', 'info', 'Order ' || v_code || ' is ready again', 'It needs a rider.', '/rider');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_code_attempts(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_code text;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select code into v_code from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if not found then raise exception 'This order has no rider.'; end if;
  update public.deliveries set code_attempts = 0 where id = v_d.id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'code_reset', '{}'::jsonb);
  perform public.notify_user(v_d.rider_id, 'delivery_unlocked', 'info', 'Order ' || v_code || ' is unlocked', 'You can enter the customer''s code again.', '/rider');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_mark_delivered(p_order_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if char_length(v_reason) < 5 then raise exception 'Write why this order is being marked delivered (at least 5 characters).'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.fulfilment_status not in ('confirmed', 'out_for_delivery') then raise exception 'Only an order that is being prepared or on its way can be marked delivered.'; end if;
  perform set_config('app.order_system', 'on', true);
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if found then
    update public.deliveries set status = 'delivered', delivered_at = now(), override_reason = v_reason, override_by = auth.uid(), verified_by = 'office', needs_review = false where id = v_d.id;
  end if;
  update public.orders set fulfilment_status = 'delivered' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'override_delivered', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ============ Who may call what ============
revoke all on function public.pick_warehouse(double precision, double precision) from public, anon, authenticated;
revoke all on function public.admin_save_warehouse(uuid, text, text, text, double precision, double precision, boolean, boolean) from public, anon;
revoke all on function public.rider_complete_delivery(uuid, text, double precision, double precision) from public, anon;
revoke all on function public.rider_complete_without_code(uuid, text, text, text, double precision, double precision) from public, anon;
revoke all on function public.admin_review_delivery(uuid) from public, anon;
revoke all on function public.admin_set_order_warehouse(uuid, uuid) from public, anon;
revoke all on function public.rider_available_orders() from public, anon;
revoke all on function public.rider_my_deliveries() from public, anon;
revoke all on function public.rider_pickup_point() from public, anon;
revoke all on function public.set_order_pin(text, double precision, double precision, integer) from public, anon;
revoke all on function public.admin_assign_delivery(uuid, uuid) from public, anon;
revoke all on function public.admin_unassign_delivery(uuid) from public, anon;
revoke all on function public.admin_reset_code_attempts(uuid) from public, anon;
revoke all on function public.admin_mark_delivered(uuid, text) from public, anon;
grant execute on function public.admin_save_warehouse(uuid, text, text, text, double precision, double precision, boolean, boolean) to authenticated;
grant execute on function public.rider_complete_delivery(uuid, text, double precision, double precision) to authenticated;
grant execute on function public.rider_complete_without_code(uuid, text, text, text, double precision, double precision) to authenticated;
grant execute on function public.admin_review_delivery(uuid) to authenticated;
grant execute on function public.admin_set_order_warehouse(uuid, uuid) to authenticated;
grant execute on function public.rider_available_orders() to authenticated;
grant execute on function public.rider_my_deliveries() to authenticated;
grant execute on function public.rider_pickup_point() to authenticated;
grant execute on function public.set_order_pin(text, double precision, double precision, integer) to authenticated;
grant execute on function public.admin_assign_delivery(uuid, uuid) to authenticated;
grant execute on function public.admin_unassign_delivery(uuid) to authenticated;
grant execute on function public.admin_reset_code_attempts(uuid) to authenticated;
grant execute on function public.admin_mark_delivered(uuid, text) to authenticated;
