-- 000013: let customers remove finished orders from their own list (hide, never delete: orders are sales records).
begin;

alter table public.orders add column if not exists hidden_by_customer boolean not null default false;

create index if not exists orders_user_visible_idx
  on public.orders (user_id, created_at desc) where not hidden_by_customer;

-- Hide (or bring back) the signed-in customer's own orders. Only finished orders can be hidden:
-- cancelled, expired or delivered. Active orders (to pay, preparing, on the way) always stay visible.
create or replace function public.hide_my_orders(p_codes text[], p_hidden boolean default true)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;
  update public.orders
     set hidden_by_customer = p_hidden
   where user_id = auth.uid()
     and code = any (p_codes)
     and (not p_hidden or fulfilment_status in ('cancelled', 'delivered'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.hide_my_orders(text[], boolean) from public;
grant execute on function public.hide_my_orders(text[], boolean) to authenticated;

commit;
