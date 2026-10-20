-- 000016: (1) "Cancel this order" works for every unpaid order, including one whose last payment attempt failed.
--             The orders page shows both "awaiting payment" and "failed payment" as To pay, but the cancel function only
--             accepted "awaiting payment", so those orders answered "Only an unpaid order can be cancelled here".
--         (2) Cancel several unpaid orders at once (selection mode). Each order is checked on its own: the ones that
--             cannot be cancelled (a payment is in progress, already paid...) are skipped with the reason.
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
  if v_order.payment_status not in ('awaiting_payment', 'failed') or v_order.fulfilment_status <> 'pending' then
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

create or replace function public.cancel_my_unpaid_orders(p_codes text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_done integer := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce(array_length(p_codes, 1), 0) = 0 then
    return jsonb_build_object('cancelled', 0, 'skipped', v_skipped);
  end if;
  if array_length(p_codes, 1) > 50 then raise exception 'Select 50 orders or fewer at a time.'; end if;
  foreach v_code in array p_codes loop
    begin
      perform public.cancel_my_unpaid_order(v_code);
      v_done := v_done + 1;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object('code', v_code, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('cancelled', v_done, 'skipped', v_skipped);
end $$;

revoke all on function public.cancel_my_unpaid_orders(text[]) from public, anon;
grant execute on function public.cancel_my_unpaid_order(text) to authenticated, service_role;
grant execute on function public.cancel_my_unpaid_orders(text[]) to authenticated;

commit;
