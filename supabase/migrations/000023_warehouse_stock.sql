-- 000023: warehouses with their own stock, and removing warehouses and orders (run it after 000022). Idempotent: safe to run twice.
--
--  A. Removing is a SOFT delete: a removed warehouse or order is hidden, never erased, so a screen can show everything later.
--     Analytics and Finance still count removed orders. A customer can remove a finished order from their own list; that never
--     removes it for the shop.
--  B. Each warehouse has its own stock. The totals your shop already reads (a product's stock, "in stock", sorting, analytics) stay
--     what they were: the sum over the OPEN warehouses. A cart is filled from ONE warehouse: the nearest open one that has everything.
--     If none has everything, it is filled from the best one and the missing items are requested as a TRANSFER from another warehouse;
--     such an order is "waiting for items" and is not offered to riders until staff mark the items received. A setting can instead
--     refuse such a cart.
--  C. Stock written the old way (one total) still works: it is applied to the default warehouse.

-- ============================================================ A. Removing (soft delete)
alter table public.warehouses add column if not exists archived_at timestamptz;
alter table public.orders
  add column if not exists archived_at timestamptz,
  add column if not exists hidden_by_customer_at timestamptz,
  add column if not exists stock_ready boolean not null default true;
create index if not exists orders_archived_idx on public.orders (archived_at) where archived_at is not null;

-- A customer no longer sees an order they removed from their own list. The shop always does.
drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using ((user_id = auth.uid() and hidden_by_customer_at is null) or public.is_staff());

create or replace function public.admin_archive_orders(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done int;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.orders set archived_at = now()
   where id = any (coalesce(p_ids, '{}')) and archived_at is null
     and fulfilment_status in ('delivered', 'cancelled')
     and refund_status is distinct from 'pending';     -- a refund still to be paid is never tidied away
  get diagnostics v_done = row_count;
  return jsonb_build_object('ok', true, 'archived', v_done, 'skipped', coalesce(cardinality(p_ids), 0) - v_done);
end $$;

create or replace function public.admin_restore_orders(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_done int;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.orders set archived_at = null where id = any (coalesce(p_ids, '{}')) and archived_at is not null;
  get diagnostics v_done = row_count;
  return jsonb_build_object('ok', true, 'restored', v_done);
end $$;

create or replace function public.hide_my_order(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_o from public.orders where code = upper(trim(p_code)) and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.fulfilment_status not in ('delivered', 'cancelled') then raise exception 'Only a finished order can be removed from your list.'; end if;
  if v_o.refund_status = 'pending' then raise exception 'Your refund is still on its way. You can remove this order once it is paid back.'; end if;
  perform set_config('app.order_system', 'on', true);
  update public.orders set hidden_by_customer_at = now() where id = v_o.id;
  return jsonb_build_object('ok', true);
end $$;

-- Warehouses: pick, save and choose among those that have not been removed.
create or replace function public.pick_warehouse(p_lat double precision, p_lng double precision) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.warehouses where active and archived_at is null and lat is not null and p_lat is not null and p_lng is not null order by public.distance_m(lat, lng, p_lat, p_lng) limit 1),
    (select id from public.warehouses where active and archived_at is null and is_default limit 1),
    (select id from public.warehouses where active and archived_at is null order by created_at limit 1)
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
  if not exists (select 1 from public.warehouses where active and archived_at is null) then raise exception 'At least one warehouse must stay active.'; end if;
  if coalesce(p_make_default, false) or not exists (select 1 from public.warehouses where is_default) then
    if not (select active from public.warehouses where id = v_id) then raise exception 'A closed warehouse cannot be the default.'; end if;
    update public.warehouses set is_default = false where is_default and id <> v_id;
    update public.warehouses set is_default = true where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.default_warehouse() returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.warehouses where is_default and active and archived_at is null limit 1),
    (select id from public.warehouses where active and archived_at is null order by created_at limit 1));
$$;

-- ============================================================ B. Stock in each warehouse
-- What is on the shelf and free to sell at each warehouse (the same meaning "stock" has always had: what is reserved or sold is not in it).
create table if not exists public.warehouse_stock (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  product_id text not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  qty int not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now()
);
create unique index if not exists warehouse_stock_key on public.warehouse_stock (warehouse_id, product_id, (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)));
create index if not exists warehouse_stock_product on public.warehouse_stock (product_id, variant_id);
alter table public.warehouse_stock enable row level security;
drop policy if exists warehouse_stock_select on public.warehouse_stock;
create policy warehouse_stock_select on public.warehouse_stock for select to authenticated using (public.is_staff());
-- No direct writes: they go through the functions below, which keep the totals right.

alter table public.stock_movements add column if not exists warehouse_id uuid references public.warehouses (id) on delete set null;

-- Which order's items are held at which warehouse (so they go back to the right place), and goods that must move between warehouses.
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders (id) on delete cascade,        -- null: staff moved stock for its own sake
  product_id text not null references public.products (id) on delete cascade,
  variant_id uuid references public.product_variants (id) on delete cascade,
  from_warehouse uuid not null references public.warehouses (id),
  to_warehouse uuid not null references public.warehouses (id),
  qty int not null check (qty > 0),
  status text not null default 'requested' check (status in ('requested', 'received', 'cancelled')),
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  received_by uuid references public.profiles (id) on delete set null,
  received_at timestamptz,
  check (from_warehouse <> to_warehouse)
);
create index if not exists stock_transfers_order on public.stock_transfers (order_id);
create index if not exists stock_transfers_open on public.stock_transfers (status) where status = 'requested';
create table if not exists public.order_stock (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null,
  variant_id uuid,
  warehouse_id uuid not null references public.warehouses (id),
  qty int not null check (qty > 0),
  transfer_id uuid references public.stock_transfers (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists order_stock_order on public.order_stock (order_id);
alter table public.stock_transfers enable row level security;
alter table public.order_stock enable row level security;
drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers for select to authenticated using (public.is_staff());
drop policy if exists order_stock_select on public.order_stock;
create policy order_stock_select on public.order_stock for select to authenticated using (public.is_staff());

alter table public.delivery_settings add column if not exists split_policy text not null default 'transfer' check (split_policy in ('transfer', 'decline'));

-- ---- the ledger keeps each product's (and option's) total right: the sum over the warehouses that are open
create or replace function public.refresh_stock_total(p_product text, p_variant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int;
begin
  select coalesce(sum(ws.qty), 0) into v_total
    from public.warehouse_stock ws join public.warehouses w on w.id = ws.warehouse_id
   where ws.product_id = p_product and ws.variant_id is not distinct from p_variant and w.active and w.archived_at is null;
  perform set_config('app.stock_sync', 'on', true);
  if p_variant is not null then
    update public.product_variants set stock = v_total where id = p_variant and stock is distinct from v_total;
  else
    update public.products set stock = v_total where id = p_product and stock is distinct from v_total
       and not exists (select 1 from public.product_variants where product_id = p_product);
  end if;
  perform set_config('app.stock_sync', 'off', true);
end $$;

create or replace function public.trg_ledger_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.warehouse_stock%rowtype;
begin
  if coalesce(current_setting('app.ledger_quiet', true), '') = 'on' then return null; end if;     -- the caller sets the total itself
  r := case when tg_op = 'DELETE' then old else new end;
  perform set_config('app.stock_wh', r.warehouse_id::text, true);
  perform public.refresh_stock_total(r.product_id, r.variant_id);
  perform set_config('app.stock_wh', '', true);
  return null;
end $$;
drop trigger if exists ledger_totals on public.warehouse_stock;
create trigger ledger_totals after insert or update of qty or delete on public.warehouse_stock for each row execute function public.trg_ledger_totals();

-- Opening or closing a warehouse changes what can be sold.
create or replace function public.trg_warehouse_totals() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (new.active is distinct from old.active) or (new.archived_at is distinct from old.archived_at) then
    for r in select distinct product_id, variant_id from public.warehouse_stock where warehouse_id = new.id loop
      perform public.refresh_stock_total(r.product_id, r.variant_id);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists warehouse_totals on public.warehouses;
create trigger warehouse_totals after update of active, archived_at on public.warehouses for each row execute function public.trg_warehouse_totals();

-- The log of stock changes also says which warehouse.
create or replace function public.log_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.skip_product_log', true), '') = 'on' then return new; end if;
  if new.stock is distinct from old.stock then
    insert into public.stock_movements (product_id, delta, stock_after, reason, changed_by, warehouse_id)
    values (new.id, new.stock - old.stock, new.stock, coalesce(nullif(current_setting('app.stock_reason', true), ''), 'Stock updated'), auth.uid(), nullif(current_setting('app.stock_wh', true), '')::uuid);
  end if;
  return new;
end $$;
create or replace function public.log_variant_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock is distinct from old.stock then
    insert into public.stock_movements (product_id, variant_id, variant_label, delta, stock_after, reason, changed_by, warehouse_id)
    values (new.product_id, new.id, concat_ws(' / ', new.option1, new.option2), new.stock - old.stock, new.stock,
            coalesce(nullif(current_setting('app.stock_reason', true), ''), 'Stock updated'), auth.uid(), nullif(current_setting('app.stock_wh', true), '')::uuid);
  end if;
  return new;
end $$;

-- ---- small helpers
create or replace function public.ledger_add(p_wh uuid, p_product text, p_variant uuid, p_delta int) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.warehouse_stock (warehouse_id, product_id, variant_id, qty) values (p_wh, p_product, p_variant, greatest(p_delta, 0))
  on conflict (warehouse_id, product_id, (coalesce(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)))
  do update set qty = warehouse_stock.qty + p_delta, updated_at = now();
end $$;

-- A product (or option) that has stock but no warehouse rows yet, gets them: all of it in the default warehouse.
create or replace function public.ensure_ledger(p_product text, p_variant uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_stock int; v_wh uuid;
begin
  if exists (select 1 from public.warehouse_stock where product_id = p_product and variant_id is not distinct from p_variant) then return; end if;
  if p_variant is not null then select stock into v_stock from public.product_variants where id = p_variant;
  else select stock into v_stock from public.products where id = p_product; end if;
  v_wh := public.default_warehouse();
  if coalesce(v_stock, 0) > 0 and v_wh is not null then
    insert into public.warehouse_stock (warehouse_id, product_id, variant_id, qty) values (v_wh, p_product, p_variant, v_stock) on conflict do nothing;
  end if;
end $$;

create or replace function public.trg_stock_insert_shim() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'product_variants' then
    delete from public.warehouse_stock where product_id = to_jsonb(new) ->> 'product_id' and variant_id is null;     -- a product with options is counted option by option
    perform public.ensure_ledger(to_jsonb(new) ->> 'product_id', new.id);
  else
    perform public.ensure_ledger(new.id, null);
  end if;
  return null;
end $$;
drop trigger if exists stock_insert_shim on public.products;
create trigger stock_insert_shim after insert on public.products for each row when (new.stock > 0) execute function public.trg_stock_insert_shim();
drop trigger if exists stock_insert_shim on public.product_variants;
create trigger stock_insert_shim after insert on public.product_variants for each row execute function public.trg_stock_insert_shim();

-- Stock written the old way, as one total, is applied to the warehouses: more goes to the default one, less comes from the default first.
create or replace function public.trg_stock_write_shim() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_delta int; v_need int; r record; v_take int; v_wh uuid; v_product text; v_variant uuid;
begin
  if coalesce(current_setting('app.stock_sync', true), '') = 'on' then return new; end if;
  if new.stock is not distinct from old.stock then return new; end if;
  if tg_table_name = 'products' then
    if exists (select 1 from public.product_variants where product_id = new.id) then return new; end if;   -- the total of its options
    v_product := new.id; v_variant := null;
  else
    v_product := to_jsonb(new) ->> 'product_id'; v_variant := new.id;
  end if;
  perform set_config('app.ledger_quiet', 'on', true);
  perform public.ensure_ledger(v_product, v_variant);
  v_delta := new.stock - old.stock;
  v_wh := public.default_warehouse();
  if v_delta > 0 then
    perform public.ledger_add(v_wh, v_product, v_variant, v_delta);
  else
    v_need := -v_delta;
    for r in select ws.id, ws.qty from public.warehouse_stock ws join public.warehouses w on w.id = ws.warehouse_id and w.active and w.archived_at is null
              where ws.product_id = v_product and ws.variant_id is not distinct from v_variant and ws.qty > 0
              order by (ws.warehouse_id = v_wh) desc, ws.qty desc for update of ws loop
      exit when v_need = 0;
      v_take := least(r.qty, v_need);
      update public.warehouse_stock set qty = qty - v_take, updated_at = now() where id = r.id;
      v_need := v_need - v_take;
    end loop;
  end if;
  perform set_config('app.ledger_quiet', 'off', true);
  select coalesce(sum(ws.qty), 0) into new.stock from public.warehouse_stock ws join public.warehouses w on w.id = ws.warehouse_id and w.active and w.archived_at is null
   where ws.product_id = v_product and ws.variant_id is not distinct from v_variant;      -- the total, from the warehouses (the change is logged after the update)
  perform set_config('app.stock_wh', v_wh::text, true);
  return new;
end $$;
drop trigger if exists stock_write_shim on public.products;
create trigger stock_write_shim before update of stock on public.products for each row execute function public.trg_stock_write_shim();
drop trigger if exists stock_write_shim on public.product_variants;
create trigger stock_write_shim before update of stock on public.product_variants for each row execute function public.trg_stock_write_shim();

-- Everything that is in stock today is in the default warehouse.
do $$
declare r record; v_wh uuid := public.default_warehouse();
begin
  if v_wh is null then return; end if;
  for r in select p.id as product_id, null::uuid as variant_id, p.stock from public.products p where p.stock > 0 and not exists (select 1 from public.product_variants v where v.product_id = p.id)
           union all select v.product_id, v.id, v.stock from public.product_variants v where v.stock > 0 loop
    if not exists (select 1 from public.warehouse_stock ws where ws.product_id = r.product_id and ws.variant_id is not distinct from r.variant_id) then
      insert into public.warehouse_stock (warehouse_id, product_id, variant_id, qty) values (v_wh, r.product_id, r.variant_id, r.stock);
    end if;
  end loop;
end $$;

-- ---- which warehouse fills a cart
create or replace function public.route_order(p_order uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_o public.orders%rowtype; v_policy text; v_n int; v_pick uuid; ln record;
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found then return null; end if;
  select coalesce(split_policy, 'transfer') into v_policy from public.delivery_settings where id = 1;
  for ln in select (x ->> 'product_id') as product_id, nullif(x ->> 'variant_id', '')::uuid as variant_id from jsonb_array_elements(p_lines) x loop
    perform public.ensure_ledger(ln.product_id, ln.variant_id);
  end loop;
  select count(*) into v_n from jsonb_array_elements(p_lines);
  with lines as (select (x ->> 'product_id') as product_id, nullif(x ->> 'variant_id', '')::uuid as variant_id, (x ->> 'qty')::int as qty from jsonb_array_elements(p_lines) x),
  cand as (
    select w.id, w.is_default, w.created_at,
           (select count(*) from lines l left join public.warehouse_stock ws on ws.warehouse_id = w.id and ws.product_id = l.product_id and ws.variant_id is not distinct from l.variant_id
             where coalesce(ws.qty, 0) >= l.qty) as covered,
           case when v_o.lat is not null and w.lat is not null then public.distance_m(w.lat, w.lng, v_o.lat, v_o.lng) end as dist
      from public.warehouses w where w.active and w.archived_at is null)
  select id into v_pick from cand
   where (covered = v_n or v_policy = 'transfer')
   order by (covered = v_n) desc, covered desc, dist nulls last, is_default desc, created_at limit 1;
  if v_pick is null then
    raise exception 'These items are in different warehouses and cannot be delivered together right now. Please order them separately.';
  end if;
  update public.orders set warehouse_id = v_pick, warehouse_auto = true where id = p_order;
  return v_pick;
end $$;

create or replace function public.route_order_from_items(p_order uuid) returns uuid
language sql security definer set search_path = public as $$
  select public.route_order(p_order, coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'variant_id', variant_id, 'qty', qty)) from public.order_items where order_id = p_order), '[]'::jsonb));
$$;

-- ---- taking stock for an order, and giving it back
create or replace function public.take_stock_for(p_order uuid, p_product text, p_variant uuid, p_qty int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_wh uuid; v_have int; v_need int := p_qty; v_take int; v_tid uuid; v_code text; r record; w record;
begin
  perform public.ensure_ledger(p_product, p_variant);
  select warehouse_id, code into v_wh, v_code from public.orders where id = p_order for update;
  if v_wh is null then v_wh := public.route_order_from_items(p_order); end if;
  select coalesce(sum(ws.qty), 0) into v_have from public.warehouse_stock ws join public.warehouses wh on wh.id = ws.warehouse_id and wh.active and wh.archived_at is null
   where ws.product_id = p_product and ws.variant_id is not distinct from p_variant;
  if v_have < p_qty then return false; end if;
  select lat, lng into w from public.warehouses where id = v_wh;
  for r in
    select ws.id, ws.warehouse_id, ws.qty from public.warehouse_stock ws join public.warehouses wh on wh.id = ws.warehouse_id and wh.active and wh.archived_at is null
     where ws.product_id = p_product and ws.variant_id is not distinct from p_variant and ws.qty > 0
     order by (ws.warehouse_id = v_wh) desc, case when w.lat is not null and wh.lat is not null then public.distance_m(w.lat, w.lng, wh.lat, wh.lng) end nulls last, ws.qty desc
       for update of ws
  loop
    exit when v_need = 0;
    v_take := least(r.qty, v_need);
    update public.warehouse_stock set qty = qty - v_take, updated_at = now() where id = r.id;
    v_need := v_need - v_take;
    v_tid := null;
    if r.warehouse_id <> v_wh then
      select id into v_tid from public.stock_transfers where order_id = p_order and product_id = p_product and variant_id is not distinct from p_variant
         and from_warehouse = r.warehouse_id and to_warehouse = v_wh and status = 'requested' for update;
      if v_tid is null then
        insert into public.stock_transfers (order_id, product_id, variant_id, from_warehouse, to_warehouse, qty, note)
        values (p_order, p_product, p_variant, r.warehouse_id, v_wh, v_take, 'For order ' || v_code) returning id into v_tid;
      else
        update public.stock_transfers set qty = qty + v_take where id = v_tid;
      end if;
      update public.orders set stock_ready = false where id = p_order and stock_ready;
    end if;
    insert into public.order_stock (order_id, product_id, variant_id, warehouse_id, qty, transfer_id) values (p_order, p_product, p_variant, r.warehouse_id, v_take, v_tid);
  end loop;
  return true;
end $$;

create or replace function public.give_stock_for(p_order uuid, p_product text, p_variant uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
declare v_need int := p_qty; v_take int; v_dest uuid; r record; v_wh uuid;
begin
  for r in
    select os.id, os.warehouse_id, os.qty, os.transfer_id, t.status as tstatus, t.to_warehouse
      from public.order_stock os left join public.stock_transfers t on t.id = os.transfer_id
     where os.order_id = p_order and os.product_id = p_product and os.variant_id is not distinct from p_variant
     order by os.created_at desc, os.id for update of os
  loop
    exit when v_need = 0;
    v_take := least(r.qty, v_need);
    -- goods that already arrived are at the warehouse they were sent to; goods still to be sent are still where they were
    v_dest := case when r.transfer_id is not null and r.tstatus = 'received' then r.to_warehouse else r.warehouse_id end;
    perform public.ledger_add(v_dest, p_product, p_variant, v_take);
    if v_take = r.qty then delete from public.order_stock where id = r.id; else update public.order_stock set qty = qty - v_take where id = r.id; end if;
    if r.transfer_id is not null and r.tstatus = 'requested' then
      update public.stock_transfers set qty = case when qty - v_take <= 0 then qty else qty - v_take end, status = case when qty - v_take <= 0 then 'cancelled' else status end where id = r.transfer_id;
    end if;
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then      -- an order from before warehouses, or one that was never allocated: back to its warehouse (or the default)
    select warehouse_id into v_wh from public.orders where id = p_order;
    perform public.ledger_add(coalesce((select id from public.warehouses where id = v_wh and active and archived_at is null), public.default_warehouse()), p_product, p_variant, v_need);
  end if;
  if not exists (select 1 from public.stock_transfers where order_id = p_order and status = 'requested') then
    update public.orders set stock_ready = true where id = p_order and not stock_ready;
  end if;
end $$;

-- The old two-argument forms still work (anything written before warehouses): they use the default warehouse.
create or replace function public.take_stock(p_product text, p_variant uuid, p_qty int) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_need int := p_qty; v_take int; r record; v_wh uuid := public.default_warehouse();
begin
  perform public.ensure_ledger(p_product, p_variant);
  if (select coalesce(sum(ws.qty), 0) from public.warehouse_stock ws join public.warehouses w on w.id = ws.warehouse_id and w.active and w.archived_at is null
       where ws.product_id = p_product and ws.variant_id is not distinct from p_variant) < p_qty then return false; end if;
  for r in select ws.id, ws.qty from public.warehouse_stock ws join public.warehouses w on w.id = ws.warehouse_id and w.active and w.archived_at is null
            where ws.product_id = p_product and ws.variant_id is not distinct from p_variant and ws.qty > 0 order by (ws.warehouse_id = v_wh) desc, ws.qty desc for update of ws loop
    exit when v_need = 0;
    v_take := least(r.qty, v_need);
    update public.warehouse_stock set qty = qty - v_take, updated_at = now() where id = r.id;
    v_need := v_need - v_take;
  end loop;
  return true;
end $$;
create or replace function public.give_stock(p_product text, p_variant uuid, p_qty int) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.ensure_ledger(p_product, p_variant);
  perform public.ledger_add(public.default_warehouse(), p_product, p_variant, p_qty);
end $$;

-- ---- an order that was reserved, paid, cancelled or expired now moves stock warehouse by warehouse
create or replace function public.create_checkout_order(
  p_user_id  uuid,
  p_items    jsonb,   -- [{"product_id": "slug", "variant_id": "uuid or null", "qty": 2}]
  p_customer jsonb,
  p_reserve  boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order_id   uuid;
  v_code       text;
  v_subtotal   int := 0;
  v_until      timestamptz;
  v_item       jsonb;
  v_lines      jsonb := '[]'::jsonb;
  v_product    public.products%rowtype;
  v_variant    public.product_variants%rowtype;
  v_cost       int;
  v_qty        int;
  v_item_id    uuid;
  v_price      int;
  v_label      text;
  v_image      text;
  v_variant_id uuid;
begin
  if p_user_id is null then
    raise exception 'Sign in required to checkout';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Cart is empty';
  end if;
  if coalesce(trim(p_customer ->> 'customer_name'), '') = ''
     or coalesce(trim(p_customer ->> 'phone'), '') = ''
     or coalesce(trim(p_customer ->> 'location'), '') = '' then
    raise exception 'Name, phone and location are required';
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item ->> 'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 100 then
      raise exception 'Invalid quantity for product %', v_item ->> 'product_id';
    end if;

    select * into v_product from public.products where id = v_item ->> 'product_id' for update;
    if not found or v_product.archived_at is not null then
      raise exception 'Product not available: %', v_item ->> 'product_id';
    end if;

    v_variant_id := null;
    v_label := null;
    v_price := v_product.price;
    v_image := coalesce(v_product.images[1], '');

    if exists (select 1 from public.product_variants where product_id = v_product.id) then
      if coalesce(v_item ->> 'variant_id', '') = '' then
        raise exception 'Please choose a size or color for %', v_product.name;
      end if;
      begin
        v_variant_id := (v_item ->> 'variant_id')::uuid;
      exception when others then
        raise exception 'That option is not valid for %', v_product.name;
      end;
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id for update;
      if not found then
        raise exception 'That option is not available for %', v_product.name;
      end if;
      v_label := concat_ws(' / ', v_variant.option1, v_variant.option2);
      if v_variant.stock < v_qty then
        raise exception 'Not enough stock for % (%)', v_product.name, v_label;
      end if;
      v_price := coalesce(v_variant.price, v_product.price);
      v_image := coalesce(nullif(v_variant.image, ''), v_image);
    else
      if v_product.stock < v_qty then
        raise exception 'Not enough stock for %', v_product.name;
      end if;
    end if;

    select cost into v_cost from public.product_costs where product_id = v_product.id;
    v_cost := coalesce(v_cost, 0);

    v_subtotal := v_subtotal + v_price * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'variant_id', v_variant_id,
      'variant_label', v_label,
      'name', v_product.name,
      'image', v_image,
      'price', v_price,
      'cost', v_cost,
      'qty', v_qty
    ));
  end loop;

  if p_reserve then
    v_until := now() + interval '15 minutes';
  end if;

  insert into public.orders (
    user_id, customer_name, phone, location, preferred_time, notes,
    subtotal, total, stock_reserved, reserved_until
  )
  values (
    p_user_id,
    trim(p_customer ->> 'customer_name'),
    trim(p_customer ->> 'phone'),
    trim(p_customer ->> 'location'),
    nullif(trim(coalesce(p_customer ->> 'preferred_time', '')), ''),
    nullif(trim(coalesce(p_customer ->> 'notes', '')), ''),
    v_subtotal, v_subtotal, coalesce(p_reserve, false), v_until
  )
  returning id, code into v_order_id, v_code;

  perform set_config('app.stock_reason', 'Reserved for order ' || v_code, true);
  perform public.route_order(v_order_id, v_lines);        -- which warehouse will fill this cart

  for v_item in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (order_id, product_id, variant_id, variant_label, name, image, price, qty)
    values (
      v_order_id,
      v_item ->> 'product_id',
      nullif(v_item ->> 'variant_id', '')::uuid,
      v_item ->> 'variant_label',
      v_item ->> 'name',
      v_item ->> 'image',
      (v_item ->> 'price')::int,
      (v_item ->> 'qty')::int
    )
    returning id into v_item_id;

    insert into public.order_item_costs (order_item_id, cost)
    values (v_item_id, (v_item ->> 'cost')::int);

    if coalesce(p_reserve, false) then
      if not public.take_stock_for(
        v_order_id,
        v_item ->> 'product_id',
        nullif(v_item ->> 'variant_id', '')::uuid,
        (v_item ->> 'qty')::int
      ) then
        raise exception 'Not enough stock for %', v_item ->> 'name';
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'code', v_code,
    'total', v_subtotal,
    'stock_reserved', coalesce(p_reserve, false),
    'reserved_until', v_until
  );
end $$;
create or replace function public.release_expired_reservations() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_order record;
  v_item  record;
  v_count int := 0;
begin
  for v_order in
    select id, code from public.orders
    where stock_reserved = true
      and payment_status = 'awaiting_payment'
      and reserved_until is not null
      and reserved_until < now()
    for update skip locked
  loop
    perform set_config('app.stock_reason', 'Reservation expired for order ' || v_order.code, true);
    for v_item in
      select product_id, variant_id, qty from public.order_items where order_id = v_order.id
    loop
      perform public.give_stock_for(v_order.id, v_item.product_id, v_item.variant_id, v_item.qty);
    end loop;

    update public.orders
    set stock_reserved = false,
        reserved_until = null,
        payment_status = 'expired',
        updated_at = now()
    where id = v_order.id;

    insert into public.payment_events (order_id, deposit_id, status, source, payload)
    select v_order.id, deposit_id, 'expired', 'recheck',
           jsonb_build_object('reason', 'reservation_expired')
    from public.orders where id = v_order.id;

    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
create or replace function public.release_order_reservation(p_order_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item  record;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or not v_order.stock_reserved then
    return;
  end if;

  perform set_config('app.stock_reason', p_reason, true);
  for v_item in
    select product_id, variant_id, qty from public.order_items where order_id = p_order_id
  loop
    perform public.give_stock_for(p_order_id, v_item.product_id, v_item.variant_id, v_item.qty);
  end loop;

  update public.orders set stock_reserved = false, reserved_until = null where id = p_order_id;
end $$;
create or replace function public.do_cancel_order(p_order_id uuid, p_by uuid, p_reason text, p_restock boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_refund boolean;
begin
  perform set_config('app.order_system', 'on', true);
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.fulfilment_status = 'cancelled' then raise exception 'This order is already cancelled.'; end if;
  if v_order.fulfilment_status = 'delivered' then raise exception 'A delivered order cannot be cancelled.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required.'; end if;

  v_refund := v_order.payment_status = 'paid';

  if v_order.stock_reserved then
    perform public.release_order_reservation(p_order_id, 'Order ' || v_order.code || ' cancelled');
  elsif v_refund and p_restock then
    perform set_config('app.stock_reason', 'Order ' || v_order.code || ' cancelled, items back in stock', true);
    for v_item in select product_id, variant_id, qty from public.order_items where order_id = p_order_id loop
      perform public.give_stock_for(p_order_id, v_item.product_id, v_item.variant_id, v_item.qty);
    end loop;
  end if;

  update public.orders set
    fulfilment_status = 'cancelled',
    cancel_reason = trim(p_reason),
    cancelled_at = now(),
    cancelled_by = p_by,
    refund_status = case when v_refund then 'pending' else 'none' end
  where id = p_order_id;

  return jsonb_build_object('code', v_order.code, 'needs_refund', v_refund, 'total', v_order.total);
end $$;
create or replace function public.apply_payment_result(
  p_order_id uuid,
  p_deposit_id text,
  p_status text,
  p_amount numeric,
  p_failure_code text,
  p_source text,
  p_payload jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_short boolean := false;
  v_result text := 'pending';
  v_new boolean := false;
  v_reason text;
begin
  if p_source not in ('create', 'callback', 'recheck') then
    raise exception 'Invalid source';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;

  if not exists (
    select 1 from public.payment_events
     where order_id = p_order_id and deposit_id = p_deposit_id and status = p_status
  ) then
    insert into public.payment_events (order_id, deposit_id, status, source, payload)
    values (
      p_order_id, p_deposit_id, p_status, p_source,
      coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('failure_code', p_failure_code)
    );
    v_new := true;
  end if;

  if p_status = 'COMPLETED' then
    if p_amount is distinct from v_order.total::numeric then
      perform public.notify_staff(
        'payment_mismatch', 'critical', 'Payment amount mismatch: ' || v_order.code,
        'Received ' || coalesce(p_amount::text, 'unknown') || ' RWF, expected ' || v_order.total || ' RWF. Check this payment.',
        '/admin/orders'
      );
      return jsonb_build_object('result', 'amount_mismatch', 'payment_status', v_order.payment_status);
    end if;

    if v_order.payment_status = 'paid' then
      if v_order.deposit_id is distinct from p_deposit_id then
        perform public.notify_staff(
          'payment_duplicate', 'critical', 'Duplicate payment: ' || v_order.code,
          'This order was already paid and a second payment arrived. A refund is needed.',
          '/admin/finance'
        );
        return jsonb_build_object('result', 'duplicate', 'payment_status', 'paid');
      end if;
      return jsonb_build_object('result', 'already_paid', 'payment_status', 'paid');
    end if;

    if v_order.payment_status <> 'awaiting_payment' then
      -- The window had ended and the stock was released. Try to take it again.
      perform set_config('app.stock_reason', 'Payment arrived after expiry for order ' || v_order.code, true);
      for v_item in select product_id, variant_id, qty from public.order_items where order_id = p_order_id loop
        if not public.take_stock_for(p_order_id, v_item.product_id, v_item.variant_id, v_item.qty) then
          v_short := true;
        end if;
      end loop;
    end if;

    update public.orders
       set payment_status = 'paid',
           paid_at = now(),
           deposit_id = p_deposit_id,
           stock_reserved = false,
           reserved_until = null
     where id = p_order_id;
    v_result := 'paid';

    if v_short then
      perform public.notify_staff(
        'payment_no_stock', 'critical', 'Paid, but stock is short: ' || v_order.code,
        'Payment arrived after the order expired and some items are no longer in stock. Check the order or refund.',
        '/admin/orders'
      );
    end if;
    if v_order.fulfilment_status = 'cancelled' then
      perform public.notify_staff(
        'payment_cancelled_order', 'critical', 'Payment on a cancelled order: ' || v_order.code,
        'The customer paid an order that was cancelled. A refund is needed.',
        '/admin/orders'
      );
    end if;

  elsif p_status in ('FAILED', 'REJECTED') then
    v_result := case when v_order.payment_status = 'paid' then 'ignored' else 'failed' end;

    -- Tell the customer about every failed attempt, once. The order stays open so they can try again.
    if v_new and v_order.payment_status = 'awaiting_payment' and v_order.fulfilment_status <> 'cancelled' then
      v_reason := case p_failure_code
        when 'PAYMENT_NOT_APPROVED' then 'The payment was not approved on your phone.'
        when 'INSUFFICIENT_BALANCE' then 'Your mobile money balance is too low for this payment.'
        when 'PAYER_LIMIT_REACHED' then 'You have reached a limit on your mobile money account.'
        when 'WALLET_LIMIT_REACHED' then 'You have reached a limit on your mobile money account.'
        when 'PAYER_NOT_FOUND' then 'We could not find a mobile money account for that number.'
        when 'INVALID_PHONE_NUMBER' then 'That phone number is not valid.'
        when 'PROVIDER_TEMPORARILY_UNAVAILABLE' then 'The provider is not available right now.'
        when 'NOT_FOUND' then 'The payment request did not go through.'
        else 'The payment could not be completed.'
      end;
      perform public.notify_user(
        v_order.user_id, 'payment_failed', 'critical',
        'Payment failed for ' || v_order.code,
        v_reason || ' Open the order to try again.',
        '/orders/' || v_order.code
      );
    end if;
  end if;

  return jsonb_build_object(
    'result', v_result,
    'payment_status', (select payment_status from public.orders where id = p_order_id)
  );
end $$;

-- ---- changing an order's warehouse moves its stock with it
create or replace function public.rehold_order(p_order uuid, p_target uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform 1 from public.orders where id = p_order for update;
  if not exists (select 1 from public.order_stock where order_id = p_order) then
    update public.orders set warehouse_id = p_target where id = p_order;
    return;
  end if;
  for r in select product_id, variant_id, sum(qty)::int as qty from public.order_stock where order_id = p_order group by product_id, variant_id loop
    perform public.give_stock_for(p_order, r.product_id, r.variant_id, r.qty);
  end loop;
  update public.orders set warehouse_id = p_target, stock_ready = true where id = p_order;
  for r in select product_id, variant_id, sum(qty)::int as qty from public.order_items where order_id = p_order group by product_id, variant_id loop
    if not public.take_stock_for(p_order, r.product_id, r.variant_id, r.qty) then raise exception 'There is not enough stock to fill this order from there.'; end if;
  end loop;
end $$;

-- When the customer's pin is known, an order that has not been collected goes to the nearest warehouse that can fill it.
create or replace function public.reroute_order(p_order uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_best uuid; v_cur_d int; v_best_d int; v_n int;
begin
  select * into v_o from public.orders where id = p_order for update;
  if not found or not v_o.warehouse_auto or v_o.fulfilment_status not in ('pending', 'confirmed') or exists (select 1 from public.deliveries where order_id = p_order) then return; end if;
  if not exists (select 1 from public.order_stock where order_id = p_order) then
    update public.orders set warehouse_id = public.pick_warehouse(v_o.lat, v_o.lng) where id = p_order and public.pick_warehouse(v_o.lat, v_o.lng) is not null;
    return;
  end if;
  if v_o.lat is null then return; end if;
  select count(*) into v_n from (select 1 from public.order_items where order_id = p_order group by product_id, variant_id) x;
  select w.id, public.distance_m(w.lat, w.lng, v_o.lat, v_o.lng) into v_best, v_best_d
    from public.warehouses w
   where w.active and w.archived_at is null and w.lat is not null and w.id <> v_o.warehouse_id
     and (select count(*) from (select oi.product_id, oi.variant_id, sum(oi.qty) as q from public.order_items oi where oi.order_id = p_order group by 1, 2) l
           left join public.warehouse_stock ws on ws.warehouse_id = w.id and ws.product_id = l.product_id and ws.variant_id is not distinct from l.variant_id
           where coalesce(ws.qty, 0) >= l.q) = v_n
   order by 2 limit 1;
  if v_best is null then return; end if;
  select public.distance_m(w.lat, w.lng, v_o.lat, v_o.lng) into v_cur_d from public.warehouses w where w.id = v_o.warehouse_id and w.lat is not null;
  if v_cur_d is null or v_best_d < v_cur_d or exists (select 1 from public.stock_transfers where order_id = p_order and status = 'requested') then
    perform public.rehold_order(p_order, v_best);
  end if;
exception when others then
  null;     -- never let tidying up the warehouse get in the way of saving the customer's location
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
  perform public.reroute_order(v_o.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_set_order_warehouse(p_order_id uuid, p_warehouse_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders%rowtype; v_d public.deliveries%rowtype; v_w public.warehouses%rowtype;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select * into v_w from public.warehouses where id = p_warehouse_id and active and archived_at is null;
  if not found then raise exception 'Pick an open warehouse.'; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if v_o.fulfilment_status not in ('pending', 'confirmed', 'out_for_delivery') then raise exception 'This order is finished.'; end if;
  select * into v_d from public.deliveries where order_id = p_order_id for update;
  if found and v_d.status in ('picked_up', 'delivered') then raise exception 'The rider has already collected it.'; end if;
  perform set_config('app.order_system', 'on', true);
  perform public.rehold_order(p_order_id, p_warehouse_id);
  update public.orders set warehouse_auto = false where id = p_order_id;
  perform public.log_delivery_event(p_order_id, v_d.id, 'warehouse_changed', jsonb_build_object('warehouse', v_w.name));
  if v_d.id is not null and v_d.status = 'assigned' then
    perform public.notify_user(v_d.rider_id, 'delivery_moved', 'warning', 'New place to collect ' || v_o.code, 'Collect it at ' || v_w.name || '.', '/rider');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---- staff: setting stock in a warehouse, opening stock for a new product, moving stock, receiving goods
create or replace function public.set_warehouse_stock(p_warehouse uuid, p_product text, p_variant uuid, p_qty int, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_old int; v_has boolean;
begin
  if not public.is_staff() then raise exception 'Only staff can change stock'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'A reason is required for stock changes'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Stock cannot be negative'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and archived_at is null) then raise exception 'Warehouse not found'; end if;
  if not exists (select 1 from public.products where id = p_product) then raise exception 'Product not found'; end if;
  select exists (select 1 from public.product_variants where product_id = p_product) into v_has;
  if v_has and p_variant is null then raise exception 'This product has sizes or colors. Set the stock of each option instead.'; end if;
  if p_variant is not null and not exists (select 1 from public.product_variants where id = p_variant and product_id = p_product) then raise exception 'Option not found'; end if;
  perform public.ensure_ledger(p_product, p_variant);
  select qty into v_old from public.warehouse_stock where warehouse_id = p_warehouse and product_id = p_product and variant_id is not distinct from p_variant for update;
  if coalesce(v_old, 0) = p_qty then return; end if;
  perform set_config('app.stock_reason', trim(p_reason), true);
  perform public.ledger_add(p_warehouse, p_product, p_variant, p_qty - coalesce(v_old, 0));
end $$;

create or replace function public.apply_initial_stock(p_product text, p_payload jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; x jsonb; v_variant uuid;
begin
  if not public.is_admin() then raise exception 'Only an admin can add products'; end if;
  for k, v in select * from jsonb_each(coalesce(p_payload -> 'stock', '{}'::jsonb)) loop
    if (v #>> '{}')::int > 0 then perform public.set_warehouse_stock(k::uuid, p_product, null, (v #>> '{}')::int, 'Opening stock'); end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_payload -> 'variants', '[]'::jsonb)) loop
    select id into v_variant from public.product_variants where product_id = p_product and coalesce(option1, '') = coalesce(x ->> 'option1', '') and coalesce(option2, '') = coalesce(x ->> 'option2', '');
    continue when v_variant is null;
    for k, v in select * from jsonb_each(coalesce(x -> 'stock', '{}'::jsonb)) loop
      if (v #>> '{}')::int > 0 then perform public.set_warehouse_stock(k::uuid, p_product, v_variant, (v #>> '{}')::int, 'Opening stock'); end if;
    end loop;
  end loop;
end $$;

create or replace function public.move_stock(p_product text, p_variant uuid, p_from uuid, p_to uuid, p_qty int, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_have int;
begin
  if not public.is_staff() then raise exception 'Only staff can move stock'; end if;
  if p_from = p_to then raise exception 'Choose two different warehouses.'; end if;
  if p_qty is null or p_qty < 1 then raise exception 'Choose how many to move.'; end if;
  if not exists (select 1 from public.warehouses where id = p_from and archived_at is null) or not exists (select 1 from public.warehouses where id = p_to and archived_at is null) then raise exception 'Warehouse not found'; end if;
  perform public.ensure_ledger(p_product, p_variant);
  select qty into v_have from public.warehouse_stock where warehouse_id = p_from and product_id = p_product and variant_id is not distinct from p_variant for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'That warehouse only has % of this.', coalesce(v_have, 0); end if;
  perform set_config('app.stock_reason', 'Moved between warehouses', true);
  perform public.ledger_add(p_from, p_product, p_variant, -p_qty);
  perform public.ledger_add(p_to, p_product, p_variant, p_qty);
  insert into public.stock_transfers (order_id, product_id, variant_id, from_warehouse, to_warehouse, qty, status, note, created_by, received_by, received_at)
  values (null, p_product, p_variant, p_from, p_to, p_qty, 'received', nullif(trim(coalesce(p_note, '')), ''), auth.uid(), auth.uid(), now());
end $$;

-- Staff say the goods an order was waiting for have arrived.
create or replace function public.receive_transfer(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t public.stock_transfers%rowtype; v_o public.orders%rowtype;
begin
  if not public.is_staff() then raise exception 'Only staff can receive goods'; end if;
  select * into t from public.stock_transfers where id = p_id for update;
  if not found then raise exception 'Transfer not found'; end if;
  if t.status <> 'requested' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.stock_transfers set status = 'received', received_at = now(), received_by = auth.uid() where id = p_id;
  if t.order_id is null then
    perform public.ledger_add(t.to_warehouse, t.product_id, t.variant_id, t.qty);
  else
    select * into v_o from public.orders where id = t.order_id for update;
    if not exists (select 1 from public.stock_transfers where order_id = t.order_id and status = 'requested') then
      perform set_config('app.order_system', 'on', true);
      update public.orders set stock_ready = true where id = t.order_id;
      if v_o.fulfilment_status = 'confirmed' and not exists (select 1 from public.deliveries where order_id = t.order_id) then
        if not public.dispatch_order(t.order_id) then perform public.broadcast_order_waiting(t.order_id); end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Staff are told when a PAID order is waiting for goods to move (not for an order that may still expire unpaid).
create or replace function public.trg_order_paid_waiting() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and not new.stock_ready then
    select coalesce(sum(qty), 0) into v_n from public.stock_transfers where order_id = new.id and status = 'requested';
    perform public.notify_staff('stock_transfer', 'warning', 'Items must move for ' || new.code, v_n || ' item' || case when v_n = 1 then ' is' else 's are' end || ' in another warehouse. Move them, then mark them received. The order waits until then.', '/admin/orders?q=' || new.code);
  end if;
  return null;
end $$;
drop trigger if exists order_paid_waiting on public.orders;
create trigger order_paid_waiting after update of payment_status on public.orders for each row execute function public.trg_order_paid_waiting();

-- An order whose goods are still on their way is not handed to a rider, by anyone.
create or replace function public.trg_delivery_needs_goods() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.orders where id = new.order_id and not stock_ready) then
    raise exception 'The items for this order are still moving to its warehouse.';
  end if;
  return new;
end $$;
drop trigger if exists delivery_needs_goods on public.deliveries;
create trigger delivery_needs_goods before insert on public.deliveries for each row execute function public.trg_delivery_needs_goods();

-- And it is not offered or listed either.
create or replace function public.dispatch_order(p_order_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_set public.delivery_settings%rowtype; v_o public.orders%rowtype; v_w public.warehouses%rowtype;
  v_rider uuid; v_dist int;
begin
  select * into v_set from public.delivery_settings where id = 1;
  if not found or not v_set.auto_assign then return false; end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found or v_o.fulfilment_status <> 'confirmed' or not v_o.stock_ready then return false; end if;
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
     where o.fulfilment_status = 'confirmed' and o.stock_ready
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
        where o.fulfilment_status = 'confirmed' and o.stock_ready
          and not exists (select 1 from public.deliveries d where d.order_id = o.id)
          and not exists (select 1 from public.delivery_offers f where f.order_id = o.id and f.status = 'open' and f.expires_at > now())
      ) s
  ), '[]'::jsonb);
end $$;
create or replace function public.trg_order_ready_notify_riders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status = 'confirmed' and new.stock_ready and old.fulfilment_status is distinct from 'confirmed' and not exists (select 1 from public.deliveries where order_id = new.id) then
    if public.dispatch_order(new.id) then return new; end if;
    perform public.broadcast_order_waiting(new.id);       -- (a no-op if dispatch_order already told everyone)
  end if;
  return new;
end $$;

-- ---- removing a warehouse (soft): only when nothing depends on it
create or replace function public.admin_delete_warehouse(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare w public.warehouses%rowtype; v_n int; v_items int;
begin
  if not public.is_admin() then raise exception 'Only an admin can remove a warehouse'; end if;
  select * into w from public.warehouses where id = p_id for update;
  if not found then raise exception 'Warehouse not found'; end if;
  if w.archived_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  if w.is_default then raise exception 'This is the default warehouse. Make another one the default first.'; end if;
  if not exists (select 1 from public.warehouses where active and archived_at is null and id <> p_id) then raise exception 'At least one warehouse must stay open.'; end if;
  select count(*) into v_n from public.orders where warehouse_id = p_id and fulfilment_status in ('pending', 'confirmed', 'out_for_delivery');
  if v_n > 0 then raise exception '%', v_n || case when v_n = 1 then ' order is' else ' orders are' end || ' still being filled from this warehouse. Finish or move them first.'; end if;
  select coalesce(sum(qty), 0) into v_items from public.warehouse_stock where warehouse_id = p_id;
  if v_items > 0 then raise exception 'It still holds % item%. Move its stock to another warehouse first.', v_items, case when v_items = 1 then '' else 's' end; end if;
  if exists (select 1 from public.stock_transfers where status = 'requested' and (from_warehouse = p_id or to_warehouse = p_id)) then raise exception 'Goods are still on their way to or from this warehouse.'; end if;
  update public.warehouses set archived_at = now(), active = false, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.admin_restore_warehouse(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only an admin can restore a warehouse'; end if;
  update public.warehouses set archived_at = null, updated_at = now() where id = p_id and archived_at is not null;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================ who may call what
revoke all on function public.ledger_add(uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.ensure_ledger(text, uuid) from public, anon, authenticated;
revoke all on function public.refresh_stock_total(text, uuid) from public, anon, authenticated;
revoke all on function public.route_order(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.route_order_from_items(uuid) from public, anon, authenticated;
revoke all on function public.take_stock_for(uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.give_stock_for(uuid, text, uuid, int) from public, anon, authenticated;
revoke all on function public.take_stock(text, uuid, int) from public, anon, authenticated;
revoke all on function public.give_stock(text, uuid, int) from public, anon, authenticated;
revoke all on function public.rehold_order(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reroute_order(uuid) from public, anon, authenticated;
revoke all on function public.default_warehouse() from public, anon, authenticated;
revoke all on function public.admin_archive_orders(uuid[]) from public, anon;
revoke all on function public.admin_restore_orders(uuid[]) from public, anon;
revoke all on function public.hide_my_order(text) from public, anon;
revoke all on function public.set_warehouse_stock(uuid, text, uuid, int, text) from public, anon;
revoke all on function public.apply_initial_stock(text, jsonb) from public, anon;
revoke all on function public.move_stock(text, uuid, uuid, uuid, int, text) from public, anon;
revoke all on function public.receive_transfer(uuid) from public, anon;
revoke all on function public.admin_delete_warehouse(uuid) from public, anon;
revoke all on function public.admin_restore_warehouse(uuid) from public, anon;
revoke all on function public.set_order_pin(text, double precision, double precision, integer) from public, anon;
revoke all on function public.admin_set_order_warehouse(uuid, uuid) from public, anon;
grant execute on function public.admin_archive_orders(uuid[]) to authenticated;
grant execute on function public.admin_restore_orders(uuid[]) to authenticated;
grant execute on function public.hide_my_order(text) to authenticated;
grant execute on function public.set_warehouse_stock(uuid, text, uuid, int, text) to authenticated;
grant execute on function public.apply_initial_stock(text, jsonb) to authenticated;
grant execute on function public.move_stock(text, uuid, uuid, uuid, int, text) to authenticated;
grant execute on function public.receive_transfer(uuid) to authenticated;
grant execute on function public.admin_delete_warehouse(uuid) to authenticated;
grant execute on function public.admin_restore_warehouse(uuid) to authenticated;
grant execute on function public.set_order_pin(text, double precision, double precision, integer) to authenticated;
grant execute on function public.admin_set_order_warehouse(uuid, uuid) to authenticated;
grant execute on function public.take_stock_for(uuid, text, uuid, int) to service_role;
grant execute on function public.give_stock_for(uuid, text, uuid, int) to service_role;
grant execute on function public.take_stock(text, uuid, int) to service_role;
grant execute on function public.give_stock(text, uuid, int) to service_role;
