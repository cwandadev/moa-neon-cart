-- 000011: product variants (sizes, colors) with their own stock, price and photo.
-- Safe to run once. It is wrapped in a transaction, so if anything fails, nothing is applied.
begin;

-- ============ Tables and columns ============

alter table public.products
  add column if not exists option1_name text,   -- for example 'Size'
  add column if not exists option2_name text;   -- for example 'Color'

create table if not exists public.product_variants (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  sku        text unique,
  option1    text,                               -- value of option 1, for example 'M'
  option2    text,                               -- value of option 2, for example 'Black'
  price      integer check (price is null or price > 0),   -- null = use the product price
  stock      integer not null default 0 check (stock >= 0),
  image      text,                               -- optional photo for this variant
  swatch     text,                               -- optional color for the swatch, for example '#111111'
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  check (option1 is not null or option2 is null)
);
create unique index if not exists product_variants_combo_idx
  on public.product_variants (product_id, coalesce(option1, ''), coalesce(option2, ''));
create index if not exists product_variants_product_idx
  on public.product_variants (product_id, position);

alter table public.order_items
  add column if not exists variant_id uuid references public.product_variants (id) on delete set null,
  add column if not exists variant_label text;

alter table public.stock_movements
  add column if not exists variant_id uuid references public.product_variants (id) on delete set null,
  add column if not exists variant_label text;

-- ============ Security ============

alter table public.product_variants enable row level security;

drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants for select
  using (exists (
    select 1 from public.products p
    where p.id = product_id and (p.archived_at is null or public.is_staff())
  ));

drop policy if exists product_variants_admin_write on public.product_variants;
create policy product_variants_admin_write on public.product_variants for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on public.product_variants from anon, authenticated;
grant select on public.product_variants to anon, authenticated;
grant insert, update, delete on public.product_variants to authenticated;
grant select, insert, update, delete on public.product_variants to service_role;

-- ============ Stock helpers (used by checkout, expiry, payments and cancellation) ============

create or replace function public.take_stock(p_product text, p_variant uuid, p_qty int)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_variant is not null then
    update public.product_variants set stock = stock - p_qty where id = p_variant and stock >= p_qty;
  else
    update public.products set stock = stock - p_qty where id = p_product and stock >= p_qty;
  end if;
  return found;
end $$;

create or replace function public.give_stock(p_product text, p_variant uuid, p_qty int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_variant is not null then
    update public.product_variants set stock = stock + p_qty where id = p_variant;
  else
    update public.products set stock = stock + p_qty where id = p_product;
  end if;
end $$;

revoke all on function public.take_stock(text, uuid, int) from public, anon, authenticated;
revoke all on function public.give_stock(text, uuid, int) from public, anon, authenticated;
grant execute on function public.take_stock(text, uuid, int) to service_role;
grant execute on function public.give_stock(text, uuid, int) to service_role;

-- A product with variants shows the total of its variants as its stock.
create or replace function public.sync_product_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_product text := coalesce(new.product_id, old.product_id);
  v_total int;
begin
  if exists (select 1 from public.product_variants where product_id = v_product) then
    select coalesce(sum(stock), 0) into v_total from public.product_variants where product_id = v_product;
    perform set_config('app.skip_product_log', 'on', true);
    update public.products set stock = v_total where id = v_product and stock is distinct from v_total;
    perform set_config('app.skip_product_log', 'off', true);
  end if;
  return null;
end $$;

drop trigger if exists sync_product_stock_trg on public.product_variants;
create trigger sync_product_stock_trg
  after insert or update of stock or delete on public.product_variants
  for each row execute function public.sync_product_stock();

-- The product-level log skips changes that come from variants (the variant log records those).
create or replace function public.log_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.skip_product_log', true), '') = 'on' then
    return new;
  end if;
  if new.stock is distinct from old.stock then
    insert into public.stock_movements (product_id, delta, stock_after, reason, changed_by)
    values (
      new.id,
      new.stock - old.stock,
      new.stock,
      coalesce(nullif(current_setting('app.stock_reason', true), ''), 'Stock updated'),
      auth.uid()
    );
  end if;
  return new;
end $$;

create or replace function public.log_variant_stock_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stock is distinct from old.stock then
    insert into public.stock_movements (product_id, variant_id, variant_label, delta, stock_after, reason, changed_by)
    values (
      new.product_id,
      new.id,
      concat_ws(' / ', new.option1, new.option2),
      new.stock - old.stock,
      new.stock,
      coalesce(nullif(current_setting('app.stock_reason', true), ''), 'Stock updated'),
      auth.uid()
    );
  end if;
  return new;
end $$;

drop trigger if exists log_variant_stock_change_trg on public.product_variants;
create trigger log_variant_stock_change_trg
  after update of stock on public.product_variants
  for each row execute function public.log_variant_stock_change();

-- Staff hear when one size or color sells out.
create or replace function public.trg_variant_stock_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_archived timestamptz;
begin
  if old.stock > 0 and new.stock <= 0 then
    select name, archived_at into v_name, v_archived from public.products where id = new.product_id;
    if v_archived is null then
      perform public.notify_staff(
        'variant_out', 'warning',
        'Sold out: ' || coalesce(v_name, 'Product') || ' (' || concat_ws(' / ', new.option1, new.option2) || ')',
        'None left in this option. Restock it on the Live Inventory page.',
        '/admin/inventory'
      );
    end if;
  end if;
  return new;
end $$;

drop trigger if exists variant_stock_alert_trg on public.product_variants;
create trigger variant_stock_alert_trg
  after update of stock on public.product_variants
  for each row execute function public.trg_variant_stock_alert();

-- ============ Staff stock changes ============

create or replace function public.set_variant_stock(p_variant_id uuid, p_new_stock int, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old int;
begin
  if not public.is_staff() then
    raise exception 'Only staff can change stock';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for stock changes';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;
  select stock into v_old from public.product_variants where id = p_variant_id for update;
  if not found then
    raise exception 'Option not found';
  end if;
  if v_old = p_new_stock then
    return;
  end if;
  perform set_config('app.stock_reason', trim(p_reason), true);
  update public.product_variants set stock = p_new_stock where id = p_variant_id;
end $$;

revoke all on function public.set_variant_stock(uuid, int, text) from public, anon;
grant execute on function public.set_variant_stock(uuid, int, text) to authenticated, service_role;

create or replace function public.set_product_stock(p_product_id text, p_new_stock int, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old int;
begin
  if not public.is_staff() then
    raise exception 'Only staff can change stock';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required for stock changes';
  end if;
  if p_new_stock is null or p_new_stock < 0 then
    raise exception 'Stock cannot be negative';
  end if;
  if exists (select 1 from public.product_variants where product_id = p_product_id) then
    raise exception 'This product has sizes or colors. Change the stock of each option instead.';
  end if;
  select stock into v_old from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_old = p_new_stock then
    return;
  end if;
  perform set_config('app.stock_reason', trim(p_reason), true);
  update public.products set stock = p_new_stock where id = p_product_id;
end $$;

-- ============ Checkout: server re-prices from the chosen option ============

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
      if not public.take_stock(
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

-- ============ Reservations, payments and cancellation understand variants ============

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
      perform public.give_stock(v_item.product_id, v_item.variant_id, v_item.qty);
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
    perform public.give_stock(v_item.product_id, v_item.variant_id, v_item.qty);
  end loop;

  update public.orders set stock_reserved = false, reserved_until = null where id = p_order_id;
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
        if not public.take_stock(v_item.product_id, v_item.variant_id, v_item.qty) then
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
  end if;

  return jsonb_build_object(
    'result', v_result,
    'payment_status', (select payment_status from public.orders where id = p_order_id)
  );
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
      perform public.give_stock(v_item.product_id, v_item.variant_id, v_item.qty);
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

-- ============ Live updates for the product page and admin stock ============
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'product_variants') then
    alter publication supabase_realtime add table public.product_variants;
  end if;
exception when others then
  raise notice 'could not add product_variants to realtime: %', sqlerrm;
end $$;

commit;
