-- 000012: tell the customer when a payment attempt fails (the order stays open for another try).
-- Replaces apply_payment_result with the same logic plus one notification per failed attempt.
begin;

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

commit;
