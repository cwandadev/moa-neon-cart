-- 000015: two small fixes.
-- (1) A customer can cancel an unpaid order only when no payment attempt is still open. The "still open" window
--     was 90 seconds; a mobile money prompt can stay open longer, so it is now 3 minutes (fewer late approvals).
-- (2) "Remove from my list" failed with "couldn't update your list": order changes are guarded and must carry the
--     system flag, like the other order functions already do. This adds it.
begin;

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
    if v_status in ('SUBMITTED', 'ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION') and v_at > now() - interval '3 minutes' then
      raise exception 'A payment is in progress. Wait about 3 minutes, then try again.';
    end if;
  end if;
  perform public.do_cancel_order(v_order.id, auth.uid(), 'Cancelled by the customer', false);
end $$;

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
  -- Order changes are guarded: mark this one as a system-approved change (it only touches the hidden flag).
  perform set_config('app.order_system', 'on', true);
  update public.orders
     set hidden_by_customer = p_hidden
   where user_id = auth.uid()
     and code = any (p_codes)
     and (not p_hidden or fulfilment_status in ('cancelled', 'delivered'));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant execute on function public.cancel_my_unpaid_order(text) to authenticated, service_role;
grant execute on function public.hide_my_orders(text[], boolean) to authenticated;

commit;
