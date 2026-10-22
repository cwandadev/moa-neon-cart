-- 000019: Analytics. The database counts, in Kigali time, so the numbers are exact (a browser would stop at 1,000 rows).
-- Staff see counts, stock and chat figures. Money (revenue, cost, profit) is for admins only: for staff those fields are null.
-- Safe to run more than once.

-- A day always means a day in Kigali, whatever the viewer's phone says.
create or replace function public.analytics_today()
returns date
language sql
stable
as $$ select (now() at time zone 'Africa/Kigali')::date $$;

-- ------------------------------------------------------------------------------------------------
-- Sales: revenue, orders, when people order, status, payment method, funnel, top products, categories
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_sales(p_from date, p_to date, p_grain text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_lf timestamp := p_from::timestamp;
  v_lt timestamp := (p_to + 1)::timestamp;
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_series jsonb; v_totals jsonb; v_status jsonb; v_methods jsonb; v_weekday jsonb; v_hour jsonb; v_funnel jsonb; v_top jsonb; v_cats jsonb;
begin
  if not public.is_staff() then raise exception 'Only staff can see analytics'; end if;
  if p_grain not in ('hour', 'day', 'week', 'month') then raise exception 'Unknown grouping %', p_grain; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  if p_to - p_from > 800 then raise exception 'Please choose at most 800 days'; end if;

  create temporary table if not exists _o (id uuid, ts timestamp, total int, paid boolean, status text, method text) on commit drop;
  truncate _o;
  insert into _o
    select id, created_at at time zone 'Africa/Kigali', total,
           (payment_status = 'paid' and fulfilment_status <> 'cancelled'), fulfilment_status, coalesce(nullif(payment_method, ''), 'unknown')
    from public.orders where created_at >= v_from and created_at < v_to;

  select coalesce(jsonb_agg(jsonb_build_object(
           't', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'),
           'orders', coalesce(s.n, 0),
           'revenue', case when v_admin then coalesce(s.rev, 0) end) order by b.t), '[]'::jsonb)
    into v_series
  from (select generate_series(date_trunc(p_grain, v_lf), date_trunc(p_grain, v_lt - interval '1 second'), ('1 ' || p_grain)::interval) as t) b
  left join (select date_trunc(p_grain, ts) t, count(*) n, sum(total) filter (where paid) rev from _o group by 1) s on s.t = b.t;

  select jsonb_build_object(
    'orders', count(*),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'paid_orders', count(*) filter (where paid),
    'revenue', case when v_admin then coalesce(sum(total) filter (where paid), 0) end,
    'avg_order', case when v_admin then coalesce(round((avg(total) filter (where paid))::numeric), 0) end,
    'units', coalesce((select sum(oi.qty) from public.order_items oi join _o on _o.id = oi.order_id and _o.paid), 0))
    into v_totals from _o;

  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'n', n) order by n desc), '[]'::jsonb) into v_status
    from (select status, count(*) n from _o group by status) x;

  select coalesce(jsonb_agg(jsonb_build_object('key', method, 'n', n, 'revenue', case when v_admin then rev end) order by n desc), '[]'::jsonb) into v_methods
    from (select method, count(*) n, sum(total) rev from _o where paid group by method) x;

  select jsonb_agg(coalesce(n, 0) order by d) into v_weekday
    from generate_series(1, 7) d left join (select extract(isodow from ts)::int dow, count(*) n from _o where status <> 'cancelled' group by 1) x on x.dow = d;

  select jsonb_agg(coalesce(n, 0) order by h) into v_hour
    from generate_series(0, 23) h left join (select extract(hour from ts)::int hr, count(*) n from _o where status <> 'cancelled' group by 1) x on x.hr = h;

  select jsonb_build_object(
    'placed', count(*),
    'paid', count(*) filter (where p.payment_status = 'paid'),
    'delivered', count(*) filter (where status = 'delivered'))
    into v_funnel from _o join public.orders p on p.id = _o.id;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'units', units, 'revenue', case when v_admin then rev end)), '[]'::jsonb) into v_top
    from (select oi.name, sum(oi.qty)::int units, sum(oi.price * oi.qty) rev
          from public.order_items oi join _o on _o.id = oi.order_id and _o.paid
          group by oi.product_id, oi.name order by sum(oi.qty) desc, oi.name limit 8) x;

  with cat as (
    select coalesce(c.name, 'Other') name, sum(oi.qty)::int units, sum(oi.price * oi.qty) rev
    from public.order_items oi join _o on _o.id = oi.order_id and _o.paid
    left join public.products p on p.id = oi.product_id left join public.categories c on c.id = p.category_id
    group by 1), ranked as (select *, row_number() over (order by case when v_admin then rev else units end desc) rn from cat)
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'units', units, 'revenue', case when v_admin then rev end) order by rn), '[]'::jsonb) into v_cats
    from (select name, units, rev, rn from ranked where rn <= 5
          union all select 'Other', sum(units)::int, sum(rev), 6 from ranked where rn > 5 having count(*) > 0) y;

  return jsonb_build_object('series', v_series, 'totals', v_totals, 'status', v_status, 'methods', v_methods,
    'by_weekday', v_weekday, 'by_hour', v_hour, 'funnel', v_funnel, 'top_products', v_top, 'by_category', v_cats);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Products: top sellers, slow movers, best options, saved but not bought
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_products(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_top jsonb; v_slow jsonb; v_opts jsonb; v_saved jsonb; v_totals jsonb;
begin
  if not public.is_staff() then raise exception 'Only staff can see analytics'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  create temporary table if not exists _l (product_id text, name text, label text, qty int, price int) on commit drop;
  truncate _l;
  insert into _l
    select oi.product_id, oi.name, oi.variant_label, oi.qty, oi.price
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.created_at >= v_from and o.created_at < v_to and o.payment_status = 'paid' and o.fulfilment_status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'units', units, 'revenue', case when v_admin then rev end)), '[]'::jsonb) into v_top
    from (select name, sum(qty)::int units, sum(price * qty) rev from _l group by product_id, name order by sum(qty) desc, name limit 10) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'stock', stock)), '[]'::jsonb) into v_slow
    from (select p.name, p.stock from public.products p
          where p.archived_at is null and p.stock > 0 and not exists (select 1 from _l where _l.product_id = p.id)
          order by p.stock desc, p.name limit 8) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', label, 'units', units)), '[]'::jsonb) into v_opts
    from (select label, sum(qty)::int units from _l where label is not null group by label order by sum(qty) desc, label limit 8) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'saved', saved, 'units', units)), '[]'::jsonb) into v_saved
    from (select p.name, count(w.*)::int saved, coalesce((select sum(qty) from _l where _l.product_id = p.id), 0)::int units
          from public.wishlist_items w join public.products p on p.id = w.product_id where p.archived_at is null
          group by p.id, p.name order by count(w.*) desc, p.name limit 8) x;

  select jsonb_build_object(
    'units', coalesce(sum(qty), 0),
    'products_sold', count(distinct product_id),
    'active_products', (select count(*) from public.products where archived_at is null))
    into v_totals from _l;

  return jsonb_build_object('top', v_top, 'slow', v_slow, 'options', v_opts, 'saved', v_saved, 'totals', v_totals);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Inventory: the stock today, what will run out, what moved
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_inventory(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_snap jsonb; v_risk jsonb; v_lost jsonb; v_moves jsonb;
begin
  if not public.is_staff() then raise exception 'Only staff can see analytics'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  create temporary table if not exists _u30 (product_id text, units int) on commit drop;
  truncate _u30;
  insert into _u30
    select oi.product_id, sum(oi.qty)::int
    from public.order_items oi join public.orders o on o.id = oi.order_id
    where o.created_at >= now() - interval '30 days' and o.payment_status = 'paid' and o.fulfilment_status <> 'cancelled'
    group by oi.product_id;

  select jsonb_build_object(
    'active', count(*),
    'out', count(*) filter (where stock <= 0),
    'low', count(*) filter (where stock > 0 and stock <= 5),
    'healthy', count(*) filter (where stock > 5),
    'value_cost', case when v_admin then coalesce(sum(stock::bigint * coalesce(pc.cost, 0)), 0) end,
    'value_retail', case when v_admin then coalesce(sum(stock::bigint * price), 0) end)
    into v_snap from public.products p left join public.product_costs pc on pc.product_id = p.id where p.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'stock', stock, 'days_left', days) order by days), '[]'::jsonb) into v_risk
    from (select p.name, p.stock, round((p.stock / (u.units / 30.0))::numeric, 1) days
          from public.products p join _u30 u on u.product_id = p.id
          where p.archived_at is null and p.stock > 0 and (p.stock / (u.units / 30.0)) <= 21
          order by (p.stock / (u.units / 30.0)), p.name limit 8) x;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'units', units) order by units desc), '[]'::jsonb) into v_lost
    from (select p.name, u.units from public.products p join _u30 u on u.product_id = p.id
          where p.archived_at is null and p.stock <= 0 order by u.units desc, p.name limit 8) x;

  select jsonb_build_object(
    'sold', coalesce(sum(-delta) filter (where delta < 0 and reason ilike 'Reserved for order%'), 0),
    'returned', coalesce(sum(delta) filter (where delta > 0 and (reason ilike '%released%' or reason ilike '%cancel%' or reason ilike '%returned%')), 0),
    'added', coalesce(sum(delta) filter (where delta > 0 and not (reason ilike '%released%' or reason ilike '%cancel%' or reason ilike '%returned%')), 0),
    'removed', coalesce(sum(-delta) filter (where delta < 0 and reason not ilike 'Reserved for order%'), 0))
    into v_moves from public.stock_movements where created_at >= v_from and created_at < v_to;

  return jsonb_build_object('snapshot', v_snap, 'at_risk', v_risk, 'lost_sales', v_lost, 'movements', v_moves);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Customers: new, returning, best
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_customers(p_from date, p_to date, p_grain text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_lf timestamp := p_from::timestamp;
  v_lt timestamp := (p_to + 1)::timestamp;
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_series jsonb; v_totals jsonb; v_top jsonb; v_split jsonb;
begin
  if not public.is_staff() then raise exception 'Only staff can see analytics'; end if;
  if p_grain not in ('hour', 'day', 'week', 'month') then raise exception 'Unknown grouping %', p_grain; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('t', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'), 'new', coalesce(s.n, 0)) order by b.t), '[]'::jsonb) into v_series
  from (select generate_series(date_trunc(p_grain, v_lf), date_trunc(p_grain, v_lt - interval '1 second'), ('1 ' || p_grain)::interval) as t) b
  left join (select date_trunc(p_grain, created_at at time zone 'Africa/Kigali') t, count(*) n from public.profiles
             where role = 'customer' and created_at >= v_from and created_at < v_to group by 1) s on s.t = b.t;

  create temporary table if not exists _b (user_id uuid, orders int, spent bigint, returning_buyer boolean) on commit drop;
  truncate _b;
  insert into _b
    select o.user_id, count(*)::int, sum(o.total),
           exists (select 1 from public.orders e where e.user_id = o.user_id and e.created_at < v_from and e.payment_status = 'paid' and e.fulfilment_status <> 'cancelled')
    from public.orders o
    where o.created_at >= v_from and o.created_at < v_to and o.payment_status = 'paid' and o.fulfilment_status <> 'cancelled'
    group by o.user_id;

  select jsonb_build_object(
    'new', (select count(*) from public.profiles where role = 'customer' and created_at >= v_from and created_at < v_to),
    'total', (select count(*) from public.profiles where role = 'customer'),
    'buyers', count(*),
    'returning', count(*) filter (where returning_buyer),
    'orders_per_buyer', coalesce(round(avg(orders)::numeric, 2), 0))
    into v_totals from _b;

  select jsonb_build_array(
    jsonb_build_object('key', 'new', 'n', count(*) filter (where not returning_buyer)),
    jsonb_build_object('key', 'returning', 'n', count(*) filter (where returning_buyer))) into v_split from _b;

  if v_admin then
    select coalesce(jsonb_agg(jsonb_build_object('name', name, 'orders', orders, 'spent', spent)), '[]'::jsonb) into v_top
      from (select trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')) as name, b.orders, b.spent
            from _b b left join public.profiles p on p.id = b.user_id order by b.spent desc limit 8) x;
  else
    v_top := null;
  end if;

  return jsonb_build_object('series', v_series, 'totals', v_totals, 'split', v_split, 'top', v_top);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Support: chats, reply times, busy hours, waiting now
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_support(p_from date, p_to date, p_grain text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lf timestamp := p_from::timestamp;
  v_lt timestamp := (p_to + 1)::timestamp;
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_series jsonb; v_hour jsonb; v_resp jsonb; v_now jsonb; v_staff jsonb; v_totals jsonb;
begin
  if not public.is_staff() then raise exception 'Only staff can see analytics'; end if;
  if p_grain not in ('hour', 'day', 'week', 'month') then raise exception 'Unknown grouping %', p_grain; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('t', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'), 'chats', coalesce(s.n, 0)) order by b.t), '[]'::jsonb) into v_series
  from (select generate_series(date_trunc(p_grain, v_lf), date_trunc(p_grain, v_lt - interval '1 second'), ('1 ' || p_grain)::interval) as t) b
  left join (select date_trunc(p_grain, created_at at time zone 'Africa/Kigali') t, count(*) n from public.conversations
             where created_at >= v_from and created_at < v_to group by 1) s on s.t = b.t;

  select jsonb_agg(coalesce(n, 0) order by h) into v_hour
    from generate_series(0, 23) h
    left join (select extract(hour from m.created_at at time zone 'Africa/Kigali')::int hr, count(*) n from public.messages m
               where m.sender_role = 'client' and m.created_at >= v_from and m.created_at < v_to group by 1) x on x.hr = h;

  create temporary table if not exists _c (id uuid, first_client timestamptz, first_staff timestamptz) on commit drop;
  truncate _c;
  insert into _c
    select c.id,
           (select min(created_at) from public.messages where conversation_id = c.id and sender_role = 'client'),
           (select min(created_at) from public.messages where conversation_id = c.id and sender_role = 'staff')
    from public.conversations c where c.created_at >= v_from and c.created_at < v_to;

  select jsonb_build_object(
    'median_min', round((percentile_cont(0.5) within group (order by extract(epoch from first_staff - first_client) / 60.0) filter (where first_staff >= first_client))::numeric, 1),
    'p90_min', round((percentile_cont(0.9) within group (order by extract(epoch from first_staff - first_client) / 60.0) filter (where first_staff >= first_client))::numeric, 1),
    'answered', count(*) filter (where first_staff is not null),
    'unanswered', count(*) filter (where first_staff is null and first_client is not null))
    into v_resp from _c;

  select jsonb_build_object(
    'waiting', count(*) filter (where needs_reply and status = 'open'),
    'oldest_min', coalesce(round((extract(epoch from now() - min(waiting_since) filter (where needs_reply and status = 'open')) / 60.0)::numeric), 0))
    into v_now from public.conversations;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'chats', n) order by n desc), '[]'::jsonb) into v_staff
    from (select coalesce(nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''), 'Unassigned') name, count(*)::int n
          from public.conversations c left join public.profiles p on p.id = c.assigned_to
          where c.created_at >= v_from and c.created_at < v_to group by 1) x;

  select jsonb_build_object('chats', count(*), 'closed', count(*) filter (where status = 'closed')) into v_totals
    from public.conversations where created_at >= v_from and created_at < v_to;

  return jsonb_build_object('series', v_series, 'by_hour', v_hour, 'response', v_resp, 'now', v_now, 'by_staff', v_staff, 'totals', v_totals);
end $$;

-- ------------------------------------------------------------------------------------------------
-- Finance (admins only): revenue, cost, profit
-- ------------------------------------------------------------------------------------------------
create or replace function public.analytics_finance(p_from date, p_to date, p_grain text default 'day')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lf timestamp := p_from::timestamp;
  v_lt timestamp := (p_to + 1)::timestamp;
  v_from timestamptz := p_from::timestamp at time zone 'Africa/Kigali';
  v_to timestamptz := (p_to + 1)::timestamp at time zone 'Africa/Kigali';
  v_series jsonb; v_totals jsonb; v_cats jsonb; v_methods jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can see finance analytics'; end if;
  if p_grain not in ('hour', 'day', 'week', 'month') then raise exception 'Unknown grouping %', p_grain; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;

  create temporary table if not exists _f (ts timestamp, method text, cat text, revenue bigint, cost bigint) on commit drop;
  truncate _f;
  insert into _f
    select o.created_at at time zone 'Africa/Kigali', coalesce(nullif(o.payment_method, ''), 'unknown'), coalesce(c.name, 'Other'),
           oi.price::bigint * oi.qty, coalesce(oic.cost, 0)::bigint * oi.qty
    from public.order_items oi join public.orders o on o.id = oi.order_id
    left join public.order_item_costs oic on oic.order_item_id = oi.id
    left join public.products p on p.id = oi.product_id left join public.categories c on c.id = p.category_id
    where o.created_at >= v_from and o.created_at < v_to and o.payment_status = 'paid' and o.fulfilment_status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('t', to_char(b.t, 'YYYY-MM-DD"T"HH24:MI'), 'revenue', coalesce(s.rev, 0), 'cost', coalesce(s.cost, 0), 'profit', coalesce(s.rev, 0) - coalesce(s.cost, 0)) order by b.t), '[]'::jsonb) into v_series
  from (select generate_series(date_trunc(p_grain, v_lf), date_trunc(p_grain, v_lt - interval '1 second'), ('1 ' || p_grain)::interval) as t) b
  left join (select date_trunc(p_grain, ts) t, sum(revenue) rev, sum(cost) cost from _f group by 1) s on s.t = b.t;

  select jsonb_build_object(
    'revenue', coalesce(sum(revenue), 0), 'cost', coalesce(sum(cost), 0), 'profit', coalesce(sum(revenue - cost), 0),
    'margin_pct', case when coalesce(sum(revenue), 0) = 0 then 0 else round((100.0 * sum(revenue - cost) / sum(revenue))::numeric, 1) end,
    'refunded', (select coalesce(sum(total), 0) from public.orders where created_at >= v_from and created_at < v_to and refund_status = 'refunded'))
    into v_totals from _f;

  select coalesce(jsonb_agg(jsonb_build_object('name', cat, 'revenue', rev, 'profit', rev - cost, 'margin_pct', case when rev = 0 then 0 else round((100.0 * (rev - cost) / rev)::numeric, 1) end) order by rev desc), '[]'::jsonb) into v_cats
    from (select cat, sum(revenue) rev, sum(cost) cost from _f group by cat) x;

  select coalesce(jsonb_agg(jsonb_build_object('key', method, 'revenue', rev) order by rev desc), '[]'::jsonb) into v_methods
    from (select method, sum(revenue) rev from _f group by method) x;

  return jsonb_build_object('series', v_series, 'totals', v_totals, 'by_category', v_cats, 'by_method', v_methods);
end $$;

-- Only signed-in people may call them (and each one checks the role itself).
do $$
declare f text;
begin
  foreach f in array array[
    'analytics_today()', 'analytics_sales(date, date, text)', 'analytics_products(date, date)', 'analytics_inventory(date, date)',
    'analytics_customers(date, date, text)', 'analytics_support(date, date, text)', 'analytics_finance(date, date, text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
