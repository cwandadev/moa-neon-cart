-- 000008: online payments (PawaPay). No new table: uses orders and payment_events.

create or replace function public.start_payment(
  p_order_id uuid,
  p_user_id uuid,
  p_deposit_id text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_last_status text;
  v_last_at timestamptz;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.user_id is distinct from p_user_id then
    raise exception 'Order not found';
  end if;
  if v_order.payment_status <> 'awaiting_payment' then
    raise exception 'This order can no longer be paid.';
  end if;
  if v_order.fulfilment_status = 'cancelled' then
    raise exception 'This order was cancelled.';
  end if;
  if not v_order.stock_reserved then
    raise exception 'This order was placed before online payments opened and cannot be paid online.';
  end if;
  if v_order.reserved_until is null or v_order.reserved_until < now() then
    raise exception 'The payment window for this order has ended. Please place a new order.';
  end if;
  if p_provider not in ('MTN_MOMO_RWA', 'AIRTEL_RWA') then
    raise exception 'Invalid provider.';
  end if;

  -- One payment in progress at a time, so a customer cannot be charged twice by accident.
  if v_order.deposit_id is not null then
    select status, created_at into v_last_status, v_last_at
      from public.payment_events
     where order_id = p_order_id and deposit_id = v_order.deposit_id
     order by created_at desc
     limit 1;
    if v_last_status in ('SUBMITTED', 'ACCEPTED', 'PROCESSING', 'IN_RECONCILIATION')
       and v_last_at > now() - interval '90 seconds' then
      raise exception 'A payment is already in progress. Approve it on your phone, or wait a minute and try again.';
    end if;
  end if;

  update public.orders
     set deposit_id = p_deposit_id,
         payment_method = p_provider,
         reserved_until = greatest(reserved_until, now() + interval '10 minutes')
   where id = p_order_id;

  insert into public.payment_events (order_id, deposit_id, status, source, payload)
  values (p_order_id, p_deposit_id, 'SUBMITTED', 'create', jsonb_build_object('provider', p_provider));

  return jsonb_build_object('order_id', v_order.id, 'code', v_order.code, 'total', v_order.total);
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

  -- Audit trail: one row per distinct status of a deposit, so polling and repeated callbacks do not pile up.
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
      for v_item in select product_id, qty from public.order_items where order_id = p_order_id loop
        update public.products set stock = stock - v_item.qty
         where id = v_item.product_id and stock >= v_item.qty;
        if not found then
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
    -- Keep the order and its stock so the customer can try again until the window ends.
    v_result := case when v_order.payment_status = 'paid' then 'ignored' else 'failed' end;
  end if;

  return jsonb_build_object(
    'result', v_result,
    'payment_status', (select payment_status from public.orders where id = p_order_id)
  );
end $$;

revoke all on function public.start_payment(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_payment(uuid, uuid, text, text) to service_role;
revoke all on function public.apply_payment_result(uuid, text, text, numeric, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment_result(uuid, text, text, numeric, text, text, jsonb) to service_role;
