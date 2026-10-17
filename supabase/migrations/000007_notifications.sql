-- 000007: notifications (events), created only by the database itself.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('info', 'success', 'warning', 'critical')),
  title text not null,
  body text not null default '',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- People can read their own and mark them read. Nothing else, no inserts, no deletes.
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant select, insert, update, delete on public.notifications to service_role;

create or replace function public.notify_user(p_user uuid, p_kind text, p_severity text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, severity, title, body, link)
  values (p_user, p_kind, p_severity, p_title, coalesce(p_body, ''), p_link);
$$;

create or replace function public.notify_staff(p_kind text, p_severity text, p_title text, p_body text, p_link text, p_admins_only boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, severity, title, body, link)
  select id, p_kind, p_severity, p_title, coalesce(p_body, ''), p_link
  from public.profiles
  where role = 'admin' or (not p_admins_only and role = 'staff');
$$;

revoke all on function public.notify_user(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.notify_staff(text, text, text, text, text, boolean) from public, anon, authenticated;

-- New order: tell staff, and tell the customer it was saved.
create or replace function public.trg_order_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify_staff('order_new', 'warning', 'New order ' || new.code,
    new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/orders');
  perform public.notify_user(new.user_id, 'order_placed', 'info', 'Order ' || new.code || ' received',
    'Your order is saved. We will update you here as it moves along.', '/orders/' || new.code);
  return new;
end $$;
drop trigger if exists order_created_notify on public.orders;
create trigger order_created_notify after insert on public.orders
  for each row execute function public.trg_order_created();

-- Order status or payment status changed: tell the customer (and staff for payments).
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
    elsif new.fulfilment_status = 'cancelled' then
      perform public.notify_user(new.user_id, 'order_cancelled', 'critical', 'Order ' || new.code || ' cancelled',
        'This order was cancelled. Message us in the chat if you have questions.', '/orders/' || new.code);
    end if;
  end if;

  if new.payment_status is distinct from old.payment_status then
    if new.payment_status = 'paid' then
      perform public.notify_user(new.user_id, 'payment_paid', 'success', 'Payment received for ' || new.code,
        'Thank you! We have received your payment.', '/orders/' || new.code);
      perform public.notify_staff('payment_paid', 'success', 'Payment received: ' || new.code,
        new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/finance');
    elsif new.payment_status = 'failed' then
      perform public.notify_user(new.user_id, 'payment_failed', 'critical', 'Payment failed for ' || new.code,
        'Your payment did not go through.', '/orders/' || new.code);
      perform public.notify_staff('payment_failed', 'warning', 'Payment failed: ' || new.code,
        new.customer_name || ' · ' || to_char(new.total, 'FM999,999,999') || ' RWF', '/admin/orders');
    elsif new.payment_status = 'expired' then
      perform public.notify_user(new.user_id, 'payment_expired', 'warning', 'Payment window expired for ' || new.code,
        'The time to pay for this order ran out.', '/orders/' || new.code);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists order_updated_notify on public.orders;
create trigger order_updated_notify after update of fulfilment_status, payment_status on public.orders
  for each row
  when (old.fulfilment_status is distinct from new.fulfilment_status or old.payment_status is distinct from new.payment_status)
  execute function public.trg_order_updated();

-- Stock crossed a line: tell staff once, not on every change.
create or replace function public.trg_stock_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.archived_at is not null then return new; end if;
  if old.stock > 0 and new.stock <= 0 then
    perform public.notify_staff('stock_out', 'critical', 'Out of stock: ' || new.name,
      'None left. Restock it on the Live Inventory page.', '/admin/inventory');
  elsif old.stock > 5 and new.stock between 1 and 5 then
    perform public.notify_staff('stock_low', 'warning', 'Running low: ' || new.name,
      new.stock || ' left.', '/admin/inventory');
  end if;
  return new;
end $$;
drop trigger if exists stock_alert_notify on public.products;
create trigger stock_alert_notify after update of stock on public.products
  for each row execute function public.trg_stock_alert();

-- Role changed: tell the person it happened to.
create or replace function public.trg_role_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    perform public.notify_user(new.id, 'role_changed', 'info', 'Your role changed',
      'Your account role is now: ' || new.role || '.',
      case when new.role in ('staff', 'admin') then '/admin' else '/account' end);
  end if;
  return new;
end $$;
drop trigger if exists role_changed_notify on public.profiles;
create trigger role_changed_notify after update of role on public.profiles
  for each row when (old.role is distinct from new.role)
  execute function public.trg_role_changed();

-- Live delivery to the browser.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when others then
  raise notice 'could not add notifications to realtime: %', sqlerrm;
end $$;

-- Clean-up: read ones after 30 days, everything after 90.
do $$
begin
  perform cron.schedule('prune-notifications', '17 3 * * *',
    $q$delete from public.notifications where created_at < now() - interval '90 days' or (read_at is not null and read_at < now() - interval '30 days')$q$);
exception when others then
  raise notice 'could not schedule notification clean-up: %', sqlerrm;
end $$;
