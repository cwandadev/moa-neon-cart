-- 000020: delivery by riders.
--  * New role "rider". Riders see only the deliveries they took, through functions (never the tables).
--  * A rider takes a paid order, picks it up at the shop, and at the customer's door enters the 4-digit code the customer reads out and
--    takes a photo. Only then is the order "delivered". The customer can no longer mark it delivered, and staff can no longer set
--    "out for delivery" or "delivered" by hand (they assign a rider, or use "Mark delivered" with a written reason).
--  * Customers can share a map pin with their order (coordinates), so the rider can navigate.
--  * Every step is written to an append-only log.
-- Idempotent: safe to run twice. Run it in the Supabase SQL editor BEFORE installing the app update.

-- ============ The rider role ============
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.profiles'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.profiles drop constraint %I', c.conname);
  end loop;
  alter table public.profiles add constraint profiles_role_check check (role in ('customer', 'staff', 'admin', 'rider'));
end $$;

create or replace function public.is_rider() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'rider');
$$;

-- ============ The customer's map pin ============
alter table public.orders
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists pin_accuracy_m integer,
  add column if not exists pin_set_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_pin_range_check') then
    alter table public.orders add constraint orders_pin_range_check
      check ((lat is null and lng is null) or (lat between -90 and 90 and lng between -180 and 180));
  end if;
end $$;

-- ============ Settings: where riders collect orders, and the limits ============
create table if not exists public.delivery_settings (
  id int primary key default 1 check (id = 1),
  pickup_name text not null default 'MOA Mart',
  pickup_address text not null default '',
  pickup_phone text not null default '',
  pickup_lat double precision,
  pickup_lng double precision,
  max_active_per_rider int not null default 3 check (max_active_per_rider between 1 and 20),
  proof_radius_m int not null default 300 check (proof_radius_m between 50 and 5000),
  updated_at timestamptz not null default now(),
  check ((pickup_lat is null and pickup_lng is null) or (pickup_lat between -90 and 90 and pickup_lng between -180 and 180))
);
insert into public.delivery_settings (id) values (1) on conflict (id) do nothing;
alter table public.delivery_settings enable row level security;
drop policy if exists delivery_settings_select on public.delivery_settings;
create policy delivery_settings_select on public.delivery_settings for select to authenticated
  using (public.is_staff() or public.is_rider());
drop policy if exists delivery_settings_update on public.delivery_settings;
create policy delivery_settings_update on public.delivery_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ============ Deliveries (one per order) and their log ============
create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders (id) on delete cascade,
  rider_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'assigned' check (status in ('assigned', 'picked_up', 'delivered', 'failed')),
  code text not null check (code ~ '^[0-9]{4}$'),
  code_attempts int not null default 0,
  assigned_by uuid references public.profiles (id) on delete set null,   -- empty when the rider took it themselves
  assigned_at timestamptz not null default now(),
  picked_up_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failed_reason text,
  failed_note text,
  failed_photo_path text,
  proof_path text,
  proof_lat double precision,
  proof_lng double precision,
  proof_distance_m integer,
  proof_flag text check (proof_flag in ('far_from_pin', 'no_location', 'no_pin')),
  override_reason text,
  override_by uuid references public.profiles (id) on delete set null,
  stuck_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deliveries_rider_idx on public.deliveries (rider_id, status);
alter table public.deliveries enable row level security;
drop policy if exists deliveries_staff_select on public.deliveries;
create policy deliveries_staff_select on public.deliveries for select to authenticated using (public.is_staff());
-- No insert, update or delete policy for anyone: every change goes through the functions below.

create table if not exists public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  delivery_id uuid,
  actor_id uuid references public.profiles (id) on delete set null,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists delivery_events_order_idx on public.delivery_events (order_id, created_at);
alter table public.delivery_events enable row level security;
drop policy if exists delivery_events_staff_select on public.delivery_events;
create policy delivery_events_staff_select on public.delivery_events for select to authenticated using (public.is_staff());

create or replace function public.touch_delivery() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists touch_delivery_upd on public.deliveries;
create trigger touch_delivery_upd before update on public.deliveries for each row execute function public.touch_delivery();

-- ============ Small helpers ============
create or replace function public.distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns integer language sql immutable as $$
  select round(2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ))))::int;
$$;

create or replace function public.log_delivery_event(p_order uuid, p_delivery uuid, p_event text, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.delivery_events (order_id, delivery_id, actor_id, event, detail) values (p_order, p_delivery, auth.uid(), p_event, coalesce(p_detail, '{}'::jsonb));
$$;

create or replace function public.new_delivery_code() returns text
language sql volatile as $$ select (1000 + floor(random() * 9000))::int::text; $$;

-- ============ The guard on order status ============
-- Same rules as before, plus: nobody can set "out for delivery" or "delivered" by hand any more. Those come from the delivery functions below
-- (which switch the guard off for their own update) or from "Mark delivered" with a reason.
create or replace function public.protect_order_payment_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and coalesce(current_setting('app.order_system', true), '') <> 'on' then
    if (to_jsonb(new) - 'fulfilment_status' - 'updated_at') is distinct from (to_jsonb(old) - 'fulfilment_status' - 'updated_at') then
      raise exception 'Only the delivery status can be changed from the admin console';
    end if;
    if new.fulfilment_status = 'cancelled' and old.fulfilment_status <> 'cancelled' then
      raise exception 'Use Cancel order, so stock and refunds are handled';
    end if;
    if old.fulfilment_status = 'cancelled' and new.fulfilment_status <> 'cancelled' then
      raise exception 'A cancelled order cannot be reopened';
    end if;
    if new.fulfilment_status is distinct from old.fulfilment_status and new.fulfilment_status in ('out_for_delivery', 'delivered') then
      raise exception 'Assign a rider instead. Delivered needs the rider''s code and photo, or Mark delivered with a reason.';
    end if;
  end if;
  return new;
end $$;

-- ============ Rider: see and take orders ============
create or replace function public.rider_pickup_point() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_rider() or public.is_staff() then
    (select jsonb_build_object('name', pickup_name, 'address', pickup_address, 'phone', pickup_phone, 'lat', pickup_lat, 'lng', pickup_lng)
       from public.delivery_settings where id = 1)
  end;
$$;

-- Paid orders nobody has taken yet. A rider sees only what is needed to decide: the code, how many items, how long it has waited and
-- roughly how far it is. The address is shown only after the rider takes the order.
create or replace function public.rider_available_orders() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_set public.delivery_settings%rowtype;
begin
  if not (public.is_rider() or public.is_staff()) then raise exception 'Riders only'; end if;
  select * into v_set from public.delivery_settings where id = 1;
  return coalesce((
    select jsonb_agg(x order by x->>'ready_since')
      from (
        select jsonb_build_object(
          'order_id', o.id,
          'code', o.code,
          'items', coalesce((select sum(i.qty) from public.order_items i where i.order_id = o.id), 0),
          'ready_since', coalesce(o.paid_at, o.updated_at),
          'distance_km', case when o.lat is not null and v_set.pickup_lat is not null
            then round(public.distance_m(v_set.pickup_lat, v_set.pickup_lng, o.lat, o.lng) / 1000.0, 1) end
        ) as x
        from public.orders o
        where o.fulfilment_status = 'confirmed'
          and not exists (select 1 from public.deliveries d where d.order_id = o.id)
      ) s
  ), '[]'::jsonb);
end $$;

create or replace function public.rider_accept_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_set public.delivery_settings%rowtype;
  v_active int;
  v_id uuid;
begin
  if not public.is_rider() then raise exception 'Only riders can take deliveries'; end if;
  select * into v_set from public.delivery_settings where id = 1;
  select count(*) into v_active from public.deliveries where rider_id = auth.uid() and status in ('assigned', 'picked_up');
  if v_active >= v_set.max_active_per_rider then
    raise exception 'You already have % deliveries. Finish one first.', v_active;
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if exists (select 1 from public.deliveries where order_id = p_order_id) then raise exception 'Another rider just took this order.'; end if;
  if v_order.fulfilment_status <> 'confirmed' then raise exception 'This order is not ready for a rider.'; end if;
  insert into public.deliveries (order_id, rider_id, code) values (p_order_id, auth.uid(), public.new_delivery_code()) returning id into v_id;
  perform public.log_delivery_event(p_order_id, v_id, 'taken', jsonb_build_object('rider', auth.uid()));
  return jsonb_build_object('ok', true);
end $$;

-- The rider's own deliveries: active ones, and today's finished ones. Never the code, never prices.
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
          'failed_reason', d.failed_reason, 'attempts_left', greatest(0, 5 - d.code_attempts),
          'customer_name', o.customer_name, 'phone', o.phone, 'location', o.location,
          'preferred_time', o.preferred_time, 'notes', o.notes, 'lat', o.lat, 'lng', o.lng,
          'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'variant_label', i.variant_label, 'image', i.image, 'qty', i.qty)) from public.order_items i where i.order_id = o.id), '[]'::jsonb),
          'sort_at', coalesce(d.delivered_at, d.failed_at, d.picked_up_at, d.assigned_at)
        ) as x
        from public.deliveries d join public.orders o on o.id = d.order_id
        where d.rider_id = auth.uid()
          and (d.status in ('assigned', 'picked_up') or coalesce(d.delivered_at, d.failed_at) >= v_today)
      ) s
  ), '[]'::jsonb);
end $$;

-- Give an order back before collecting it.
create or replace function public.rider_release_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status <> 'assigned' then raise exception 'You can only give an order back before you collect it.'; end if;
  perform public.log_delivery_event(p_order_id, v_d.id, 'released', '{}'::jsonb);
  delete from public.deliveries where id = v_d.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rider_mark_picked_up(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_status text;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  select fulfilment_status into v_status from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status <> 'assigned' then raise exception 'This order was already collected.'; end if;
  if v_status <> 'confirmed' then raise exception 'This order was cancelled or changed. Check with the office.'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.deliveries set status = 'picked_up', picked_up_at = now() where id = v_d.id;
  update public.orders set fulfilment_status = 'out_for_delivery' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'picked_up', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- The moment of delivery: the customer reads the code, the rider enters it and takes a photo.
-- A wrong code is an answer, not an error, so the attempt is kept.
create or replace function public.rider_complete_delivery(
  p_order_id uuid, p_code text, p_proof_path text, p_lat double precision default null, p_lng double precision default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_d public.deliveries%rowtype;
  v_o public.orders%rowtype;
  v_set public.delivery_settings%rowtype;
  v_dist int;
  v_flag text;
  v_made timestamptz;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status = 'delivered' then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_d.status <> 'picked_up' then raise exception 'Collect the order first.'; end if;
  if v_o.fulfilment_status <> 'out_for_delivery' then raise exception 'This order was cancelled or changed. Check with the office.'; end if;
  if v_d.code_attempts >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'attempts_left', 0);
  end if;
  if coalesce(trim(p_code), '') <> v_d.code then
    update public.deliveries set code_attempts = code_attempts + 1 where id = v_d.id;
    perform public.log_delivery_event(p_order_id, v_d.id, 'code_wrong', jsonb_build_object('attempt', v_d.code_attempts + 1));
    return jsonb_build_object('ok', false, 'reason', case when v_d.code_attempts + 1 >= 5 then 'locked' else 'wrong_code' end,
                              'attempts_left', greatest(0, 5 - (v_d.code_attempts + 1)));
  end if;

  -- The photo must be one this rider just uploaded for this order.
  select created_at into v_made from storage.objects
    where bucket_id = 'delivery-proofs' and name = p_proof_path and owner = auth.uid()
      and split_part(name, '/', 1) = p_order_id::text;
  if p_proof_path is null or v_made is null or v_made < v_d.picked_up_at or v_made < now() - interval '30 minutes' then
    return jsonb_build_object('ok', false, 'reason', 'photo_missing');
  end if;

  select * into v_set from public.delivery_settings where id = 1;
  if v_o.lat is null then v_flag := 'no_pin';
  elsif p_lat is null or p_lng is null then v_flag := 'no_location';
  else
    v_dist := public.distance_m(v_o.lat, v_o.lng, p_lat, p_lng);
    if v_dist > v_set.proof_radius_m then v_flag := 'far_from_pin'; end if;
  end if;

  perform set_config('app.order_system', 'on', true);
  update public.deliveries set status = 'delivered', delivered_at = now(), proof_path = p_proof_path, proof_lat = p_lat, proof_lng = p_lng,
         proof_distance_m = v_dist, proof_flag = v_flag where id = v_d.id;
  update public.orders set fulfilment_status = 'delivered' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'delivered', jsonb_build_object('flag', v_flag, 'distance_m', v_dist));
  if v_flag = 'far_from_pin' then
    perform public.notify_staff('delivery_flag', 'warning', 'Check delivery ' || v_o.code,
      'The rider was about ' || v_dist || ' m from the customer''s pin when delivering.', '/admin/orders?q=' || v_o.code);
  end if;
  return jsonb_build_object('ok', true, 'flag', v_flag);
end $$;

-- The customer could not be reached, the address was wrong, and so on.
create or replace function public.rider_report_failed(p_order_id uuid, p_reason text, p_note text default null, p_photo_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_code text;
begin
  if not public.is_rider() then raise exception 'Riders only'; end if;
  if p_reason not in ('no_answer', 'wrong_address', 'refused', 'other') then raise exception 'Pick a reason.'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id and rider_id = auth.uid() for update;
  if not found then raise exception 'This is not your delivery.'; end if;
  if v_d.status <> 'picked_up' then raise exception 'Only an order you have collected can be reported.'; end if;
  update public.deliveries set status = 'failed', failed_at = now(), failed_reason = p_reason, failed_note = nullif(trim(coalesce(p_note, '')), ''),
         failed_photo_path = p_photo_path where id = v_d.id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'failed', jsonb_build_object('reason', p_reason, 'note', p_note));
  select code into v_code from public.orders where id = p_order_id;
  perform public.notify_staff('delivery_failed', 'critical', 'Delivery failed: ' || v_code,
    case p_reason when 'no_answer' then 'The customer did not answer.' when 'wrong_address' then 'The address was wrong or unclear.'
      when 'refused' then 'The customer refused the order.' else 'The rider could not deliver.' end ||
      case when nullif(trim(coalesce(p_note, '')), '') is not null then ' ' || trim(p_note) else '' end,
    '/admin/orders?q=' || v_code);
  return jsonb_build_object('ok', true);
end $$;

-- ============ Customer: see the code, share a pin ============
create or replace function public.my_order_delivery(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_p public.profiles%rowtype;
begin
  select * into v_o from public.orders where code = upper(trim(p_code)) and user_id = auth.uid();
  if not found then return null; end if;
  select * into v_d from public.deliveries where order_id = v_o.id;
  if not found then return jsonb_build_object('has_rider', false, 'pin', v_o.lat is not null); end if;
  select * into v_p from public.profiles where id = v_d.rider_id;
  return jsonb_build_object(
    'has_rider', true, 'status', v_d.status, 'pin', v_o.lat is not null,
    'rider_first_name', v_p.first_name, 'rider_phone', v_p.phone,
    'code', case when v_d.status = 'picked_up' and v_o.fulfilment_status = 'out_for_delivery' then v_d.code end,
    'delivered_at', v_d.delivered_at);
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
  update public.orders set lat = p_lat, lng = p_lng, pin_accuracy_m = greatest(0, least(coalesce(p_accuracy, 0), 100000)), pin_set_at = now() where id = v_o.id;
  return jsonb_build_object('ok', true);
end $$;

-- ============ Staff: assign, reset, mark delivered with a reason ============
create or replace function public.admin_assign_delivery(p_order_id uuid, p_rider uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_code text; v_id uuid;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  if not exists (select 1 from public.profiles where id = p_rider and role = 'rider') then raise exception 'That person is not a rider.'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if found then
    if v_d.status in ('delivered') then raise exception 'This order was already delivered.'; end if;
    if v_d.status = 'picked_up' then raise exception 'The rider has already collected it. Wait for the result, or ask them to report it.'; end if;
    perform set_config('app.order_system', 'on', true);
    update public.deliveries set rider_id = p_rider, status = 'assigned', assigned_by = auth.uid(), assigned_at = now(), code = public.new_delivery_code(),
           code_attempts = 0, picked_up_at = null, failed_at = null, failed_reason = null, failed_note = null, failed_photo_path = null where id = v_d.id;
    if v_o.fulfilment_status = 'out_for_delivery' then update public.orders set fulfilment_status = 'confirmed' where id = p_order_id; end if;
    v_id := v_d.id;
    perform public.log_delivery_event(p_order_id, v_id, 'reassigned', jsonb_build_object('rider', p_rider));
  else
    if v_o.fulfilment_status <> 'confirmed' then raise exception 'Only a confirmed order can be given to a rider.'; end if;
    insert into public.deliveries (order_id, rider_id, code, assigned_by) values (p_order_id, p_rider, public.new_delivery_code(), auth.uid()) returning id into v_id;
    perform public.log_delivery_event(p_order_id, v_id, 'assigned', jsonb_build_object('rider', p_rider));
  end if;
  perform public.notify_user(p_rider, 'delivery_assigned', 'info', 'New delivery ' || v_o.code, 'An order was assigned to you. Open the rider app.', '/rider');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_unassign_delivery(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype; v_status text;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select fulfilment_status into v_status from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if not found then raise exception 'This order has no rider.'; end if;
  if v_d.status = 'delivered' then raise exception 'This order was already delivered.'; end if;
  if v_d.status = 'picked_up' then raise exception 'The rider has already collected it. Wait for the result, or ask them to report it.'; end if;
  perform public.log_delivery_event(p_order_id, v_d.id, 'unassigned', '{}'::jsonb);
  perform set_config('app.order_system', 'on', true);
  if v_status = 'out_for_delivery' then update public.orders set fulfilment_status = 'confirmed' where id = p_order_id; end if;
  delete from public.deliveries where id = v_d.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_code_attempts(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_d public.deliveries%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  perform 1 from public.orders where id = p_order_id for update;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if not found then raise exception 'This order has no rider.'; end if;
  update public.deliveries set code_attempts = 0 where id = v_d.id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'code_reset', '{}'::jsonb);
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
    update public.deliveries set status = 'delivered', delivered_at = now(), override_reason = v_reason, override_by = auth.uid() where id = v_d.id;
  end if;
  update public.orders set fulfilment_status = 'delivered' where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'override_delivered', jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;

-- ============ Cancelling an order closes its delivery ============
create or replace function public.trg_order_cancel_closes_delivery() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status = 'cancelled' and old.fulfilment_status is distinct from 'cancelled' then
    update public.deliveries set status = 'failed', failed_at = now(), failed_reason = 'cancelled'
     where order_id = new.id and status in ('assigned', 'picked_up');
  end if;
  return new;
end $$;
drop trigger if exists order_cancel_closes_delivery on public.orders;
create trigger order_cancel_closes_delivery after update of fulfilment_status on public.orders
  for each row execute function public.trg_order_cancel_closes_delivery();

-- ============ The customer can no longer mark an order delivered, and nothing is "delivered" by waiting ============
-- Only orders that have no rider at all (sent out before this update) keep the old way.
create or replace function public.confirm_order_received(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  perform set_config('app.order_system', 'on', true);
  select * into v_order from public.orders where code = upper(trim(p_code)) and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if exists (select 1 from public.deliveries where order_id = v_order.id) then raise exception 'Your rider will confirm the delivery with your code.'; end if;
  if v_order.fulfilment_status <> 'out_for_delivery' then raise exception 'This order is not out for delivery.'; end if;
  update public.orders set fulfilment_status = 'delivered' where id = v_order.id;
end $$;

create or replace function public.auto_deliver_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  perform set_config('app.order_system', 'on', true);
  with d as (
    update public.orders o set fulfilment_status = 'delivered'
     where o.fulfilment_status = 'out_for_delivery' and o.out_for_delivery_at < now() - interval '3 days'
       and not exists (select 1 from public.deliveries x where x.order_id = o.id)
    returning 1)
  select count(*) into v_count from d;
  return v_count;
end $$;

-- ============ A delivery that takes too long tells staff, once ============
create or replace function public.flag_stuck_deliveries() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; v_count integer := 0;
begin
  for r in
    select d.id, o.code from public.deliveries d join public.orders o on o.id = d.order_id
     where d.status in ('assigned', 'picked_up') and d.stuck_notified_at is null
       and coalesce(d.picked_up_at, d.assigned_at) < now() - interval '24 hours'
  loop
    perform public.notify_staff('delivery_stuck', 'warning', 'Delivery taking long: ' || r.code, 'This order has not been delivered after more than a day.', '/admin/orders?q=' || r.code);
    update public.deliveries set stuck_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

do $$
begin
  perform cron.schedule('flag-stuck-deliveries', '23 * * * *', $q$select public.flag_stuck_deliveries()$q$);
exception when others then
  raise notice 'could not schedule the stuck-delivery check: %', sqlerrm;
end $$;

-- ============ Photos of the handover (private) ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('delivery-proofs', 'delivery-proofs', false, 3145728, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types, public = false;

-- Riders cannot read the deliveries table, so the upload rule asks this small function instead.
create or replace function public.rider_can_upload_proof(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_rider() and exists (
    select 1 from public.deliveries d where d.rider_id = auth.uid() and d.order_id::text = p_folder and d.status in ('assigned', 'picked_up')
  );
$$;
revoke all on function public.rider_can_upload_proof(text) from public, anon;
grant execute on function public.rider_can_upload_proof(text) to authenticated;

drop policy if exists "delivery-proofs rider insert" on storage.objects;
create policy "delivery-proofs rider insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'delivery-proofs' and public.rider_can_upload_proof((storage.foldername(name))[1]));
drop policy if exists "delivery-proofs read" on storage.objects;
create policy "delivery-proofs read" on storage.objects for select to authenticated
  using (bucket_id = 'delivery-proofs' and (public.is_staff() or owner = auth.uid()));
-- No update and no delete: a proof photo cannot be replaced or removed by the rider.

-- ============ Who may call what ============
revoke all on function public.rider_pickup_point() from public, anon;
revoke all on function public.rider_available_orders() from public, anon;
revoke all on function public.rider_accept_order(uuid) from public, anon;
revoke all on function public.rider_my_deliveries() from public, anon;
revoke all on function public.rider_release_order(uuid) from public, anon;
revoke all on function public.rider_mark_picked_up(uuid) from public, anon;
revoke all on function public.rider_complete_delivery(uuid, text, text, double precision, double precision) from public, anon;
revoke all on function public.rider_report_failed(uuid, text, text, text) from public, anon;
revoke all on function public.my_order_delivery(text) from public, anon;
revoke all on function public.set_order_pin(text, double precision, double precision, integer) from public, anon;
revoke all on function public.admin_assign_delivery(uuid, uuid) from public, anon;
revoke all on function public.admin_unassign_delivery(uuid) from public, anon;
revoke all on function public.admin_reset_code_attempts(uuid) from public, anon;
revoke all on function public.admin_mark_delivered(uuid, text) from public, anon;
revoke all on function public.log_delivery_event(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.flag_stuck_deliveries() from public, anon, authenticated;
revoke all on function public.auto_deliver_orders() from public, anon, authenticated;
revoke all on function public.new_delivery_code() from public, anon, authenticated;
grant execute on function public.rider_pickup_point() to authenticated;
grant execute on function public.rider_available_orders() to authenticated;
grant execute on function public.rider_accept_order(uuid) to authenticated;
grant execute on function public.rider_my_deliveries() to authenticated;
grant execute on function public.rider_release_order(uuid) to authenticated;
grant execute on function public.rider_mark_picked_up(uuid) to authenticated;
grant execute on function public.rider_complete_delivery(uuid, text, text, double precision, double precision) to authenticated;
grant execute on function public.rider_report_failed(uuid, text, text, text) to authenticated;
grant execute on function public.my_order_delivery(text) to authenticated;
grant execute on function public.set_order_pin(text, double precision, double precision, integer) to authenticated;
grant execute on function public.admin_assign_delivery(uuid, uuid) to authenticated;
grant execute on function public.admin_unassign_delivery(uuid) to authenticated;
grant execute on function public.admin_reset_code_attempts(uuid) to authenticated;
grant execute on function public.admin_mark_delivered(uuid, text) to authenticated;
grant execute on function public.auto_deliver_orders() to service_role;
grant execute on function public.flag_stuck_deliveries() to service_role;
