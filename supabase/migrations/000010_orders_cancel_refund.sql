-- 000010: automatic order tracking, cancellation and refunds.

alter table public.orders
  add column if not exists cancel_reason text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists out_for_delivery_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists refund_status text not null default 'none';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_refund_status_check') then
    alter table public.orders add constraint orders_refund_status_check
      check (refund_status in ('none', 'pending', 'completed', 'failed'));
  end if;
end $$;

create table if not exists public.refunds (
  id uuid primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  deposit_id text not null,
  amount integer not null check (amount > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
  failure_code text,
  reason text not null default '',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists refunds_order_idx on public.refunds (order_id, created_at desc);
alter table public.refunds enable row level security;
drop policy if exists refunds_select on public.refunds;
create policy refunds_select on public.refunds for select to authenticated using (public.is_staff());
revoke all on public.refunds from anon, authenticated;
grant select on public.refunds to authenticated;
grant select, insert, update, delete on public.refunds to service_role;

-- People using the admin console can only change the delivery status, and cannot cancel or reopen directly.
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
  end if;
  return new;
end $$;

-- Automatic tracking rules.
create or replace function public.trg_order_progress() returns trigger
language plpgsql as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.fulfilment_status = 'pending' then
    new.fulfilment_status := 'confirmed';
  end if;
  if new.payment_status = 'expired' and old.payment_status is distinct from 'expired' and new.fulfilment_status = 'pending' then
    new.fulfilment_status := 'cancelled';
    new.cancel_reason := coalesce(new.cancel_reason, 'The time to pay ran out.');
  end if;
  if new.fulfilment_status is distinct from old.fulfilment_status then
    if new.fulfilment_status = 'out_for_delivery' then
      new.out_for_delivery_at := now();
    elsif new.fulfilment_status = 'delivered' then
      new.delivered_at := now();
    elsif new.fulfilment_status = 'cancelled' then
      new.cancelled_at := coalesce(new.cancelled_at, now());
    end if;
  end if;
  return new;
end $$;
drop trigger if exists zz_order_progress_upd on public.orders;
create trigger zz_order_progress_upd before update on public.orders
  for each row execute function public.trg_order_progress();

-- Cancel an order: give stock back, record why, and flag a refund if it was paid.
create or replace function public.do_cancel_order(p_order_id uuid, p_by uuid, p_reason text, p_restock boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
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
    for v_item in select product_id, qty from public.order_items where order_id = p_order_id loop
      update public.products set stock = stock + v_item.qty where id = v_item.product_id;
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

-- Record the outcome of a refund.
create or replace function public.apply_refund_result(p_refund_id uuid, p_status text, p_failure_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ref public.refunds%rowtype;
  v_order public.orders%rowtype;
begin
  perform set_config('app.order_system', 'on', true);
  select * into v_ref from public.refunds where id = p_refund_id for update;
  if not found then raise exception 'Refund not found'; end if;
  if v_ref.status <> 'PENDING' then return jsonb_build_object('result', 'already_final'); end if;
  select * into v_order from public.orders where id = v_ref.order_id for update;

  if p_status = 'COMPLETED' then
    update public.refunds set status = 'COMPLETED', failure_code = null, updated_at = now() where id = p_refund_id;
    update public.orders set refund_status = 'completed' where id = v_ref.order_id;
    perform public.notify_user(v_order.user_id, 'refund_done', 'success', 'Refund sent for ' || v_order.code,
      to_char(v_ref.amount, 'FM999,999,999') || ' RWF was returned to your mobile money account.', '/orders/' || v_order.code);
    perform public.notify_staff('refund_done', 'success', 'Refund completed: ' || v_order.code,
      to_char(v_ref.amount, 'FM999,999,999') || ' RWF', '/admin/orders');
    return jsonb_build_object('result', 'completed');
  elsif p_status in ('FAILED', 'REJECTED') then
    update public.refunds set status = 'FAILED', failure_code = p_failure_code, updated_at = now() where id = p_refund_id;
    update public.orders set refund_status = 'failed' where id = v_ref.order_id;
    perform public.notify_staff('refund_failed', 'critical', 'Refund failed: ' || v_order.code,
      coalesce(p_failure_code, 'Unknown reason') || '. Retry it from the Orders page, or refund by hand.', '/admin/orders');
    return jsonb_build_object('result', 'failed');
  end if;
  return jsonb_build_object('result', 'pending');
end $$;

-- Customer: "I received my order".
create or replace function public.confirm_order_received(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_order public.orders%rowtype;
begin
  perform set_config('app.order_system', 'on', true);
  select * into v_order from public.orders where code = upper(trim(p_code)) and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.fulfilment_status <> 'out_for_delivery' then raise exception 'This order is not out for delivery.'; end if;
  update public.orders set fulfilment_status = 'delivered' where id = v_order.id;
end $$;

-- Customer: cancel their own unpaid order.
create or replace function public.cancel_my_unpaid_order(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_status text;
  v_at timestamptz;
begin
  select * into v_order from public.orders where code = upper(trim(p_code)) and user_id = auth.uid() for update;
  if not found then raise exception 'Order not found'; end if;
  if v_order.payment_status <> 'awaiting_payment' or v_order.fulfilment_status <> 'pending' then
    raise exception 'Only an unpaid order can be cancelled here. Message us in the chat for anything else.';
  end if;
  if v_order.deposit_id is not null then
    select status, created_at into v_status, v_at from public.payment_events
      where order_id = v_order.id and deposit_id = v_order.deposit_id order by created_at desc limit 1;
    if v_status in ('SUBMITTED', 'ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION') and v_at > now() - interval '90 seconds' then
      raise exception 'A payment is in progress. Wait a minute, then try again.';
    end if;
  end if;
  perform public.do_cancel_order(v_order.id, auth.uid(), 'Cancelled by the customer', false);
end $$;

-- Automatic delivery 3 days after dispatch.
create or replace function public.auto_deliver_orders() returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  perform set_config('app.order_system', 'on', true);
  with d as (
    update public.orders set fulfilment_status = 'delivered'
     where fulfilment_status = 'out_for_delivery' and out_for_delivery_at < now() - interval '3 days'
    returning 1)
  select count(*) into v_count from d;
  return v_count;
end $$;

revoke all on function public.do_cancel_order(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.do_cancel_order(uuid, uuid, text, boolean) to service_role;
revoke all on function public.apply_refund_result(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_refund_result(uuid, text, text) to service_role;
revoke all on function public.auto_deliver_orders() from public, anon, authenticated;
grant execute on function public.auto_deliver_orders() to service_role;
revoke all on function public.confirm_order_received(text) from public, anon;
grant execute on function public.confirm_order_received(text) to authenticated, service_role;
revoke all on function public.cancel_my_unpaid_order(text) from public, anon;
grant execute on function public.cancel_my_unpaid_order(text) to authenticated, service_role;

-- Notifications: staff hear about an order when it is paid (or when payments are off), and cancellations show the reason.
create or replace function public.trg_order_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.stock_reserved then
    perform public.notify_staff('order_new', 'warning', 'New order ' || new.code,
      new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/orders');
  end if;
  perform public.notify_user(new.user_id, 'order_placed', 'info', 'Order ' || new.code || ' received',
    'Your order is saved. We will update you here as it moves along.', '/orders/' || new.code);
  return new;
end $$;

create or replace function public.trg_order_updated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fulfilment_status is distinct from old.fulfilment_status then
    if new.fulfilment_status = 'confirmed' then
      perform public.notify_user(new.user_id, 'order_confirmed', 'success', 'Order ' || new.code || ' confirmed',
        'We are getting your order ready.', '/orders/' || new.code);
    elsif new.fulfilment_status = 'out_for_delivery' then
      perform public.notify_user(new.user_id, 'order_shipping', 'info', 'Order ' || new.code || ' is on its way',
        'Your order is out for delivery.', '/orders/' || new.code);
    elsif new.fulfilment_status = 'delivered' then
      perform public.notify_user(new.user_id, 'order_delivered', 'success', 'Order ' || new.code || ' delivered',
        'Your order has been delivered. Thank you for shopping with MOA Mart.', '/orders/' || new.code);
    elsif new.fulfilment_status = 'cancelled' and new.payment_status <> 'expired' then
      perform public.notify_user(new.user_id, 'order_cancelled', 'critical', 'Order ' || new.code || ' cancelled',
        'This order was cancelled.' ||
        case when coalesce(new.cancel_reason, '') <> '' then ' Reason: ' || new.cancel_reason || '.' else '' end ||
        case when new.refund_status = 'pending' then ' Your payment will be refunded to your mobile money account.' else '' end,
        '/orders/' || new.code);
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' then
      perform public.notify_user(new.user_id, 'payment_paid', 'success', 'Payment received for ' || new.code,
        'Thank you! We have received your payment.', '/orders/' || new.code);
      perform public.notify_staff('payment_paid', 'success', 'Payment received: ' || new.code,
        new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/orders');
    elsif new.payment_status = 'failed' then
      perform public.notify_user(new.user_id, 'payment_failed', 'critical', 'Payment failed for ' || new.code,
        'Your payment did not go through.', '/orders/' || new.code);
      perform public.notify_staff('payment_failed', 'warning', 'Payment failed: ' || new.code,
        new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/orders');
    elsif new.payment_status = 'expired' then
      perform public.notify_user(new.user_id, 'payment_expired', 'warning', 'Payment window expired for ' || new.code,
        'The time to pay for this order ran out, so it was cancelled.', '/orders/' || new.code);
    end if;
  end if;
  return new;
end $$;

-- One-time clean-up: unpaid orders placed before online payments opened can never be paid.
alter table public.orders disable trigger order_updated_notify;
update public.orders
   set fulfilment_status = 'cancelled', cancel_reason = 'Placed before online payments opened', cancelled_at = now()
 where payment_status = 'awaiting_payment' and fulfilment_status = 'pending' and not stock_reserved;
alter table public.orders enable trigger order_updated_notify;

do $$
begin
  perform cron.schedule('auto-deliver-orders', '7 * * * *', $q$select public.auto_deliver_orders()$q$);
exception when others then
  raise notice 'could not schedule auto-delivery: %', sqlerrm;
end $$;
