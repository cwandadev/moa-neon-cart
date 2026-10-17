-- MOA Mart - 000006: security fixes on top of 000001. Run after 000005.

-- 1. Margins: move order item cost into an admin-only table.
CREATE TABLE IF NOT EXISTS public.order_item_costs (
  order_item_id uuid PRIMARY KEY REFERENCES public.order_items (id) ON DELETE CASCADE,
  cost int NOT NULL CHECK (cost >= 0)
);
ALTER TABLE public.order_item_costs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS order_item_costs_admin ON public.order_item_costs;
CREATE POLICY order_item_costs_admin ON public.order_item_costs FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());
REVOKE ALL ON public.order_item_costs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_item_costs TO authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'cost') THEN
    INSERT INTO public.order_item_costs (order_item_id, cost)
    SELECT id, cost FROM public.order_items ON CONFLICT DO NOTHING;
  END IF;
END
$$;

-- 2. Checkout: callable only by the server (service_role) with a verified user id.
DROP FUNCTION IF EXISTS public.create_checkout_order(jsonb, jsonb, boolean);

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_user_id  uuid,
  p_items    jsonb,
  p_customer jsonb,
  p_reserve  boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id uuid;
  v_code     text;
  v_subtotal int := 0;
  v_until    timestamptz;
  v_item     jsonb;
  v_lines    jsonb := '[]'::jsonb;
  v_product  public.products%ROWTYPE;
  v_cost     int;
  v_qty      int;
  v_item_id  uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in required to checkout';
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cart is empty';
  END IF;
  IF COALESCE(trim(p_customer ->> 'customer_name'), '') = ''
     OR COALESCE(trim(p_customer ->> 'phone'), '') = ''
     OR COALESCE(trim(p_customer ->> 'location'), '') = '' THEN
    RAISE EXCEPTION 'Name, phone and location are required';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'qty')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for product %', v_item ->> 'product_id';
    END IF;

    SELECT * INTO v_product FROM public.products
    WHERE id = v_item ->> 'product_id' FOR UPDATE;

    IF NOT FOUND OR v_product.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Product not available: %', v_item ->> 'product_id';
    END IF;
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Not enough stock for %', v_product.name;
    END IF;

    SELECT cost INTO v_cost FROM public.product_costs WHERE product_id = v_product.id;
    v_cost := COALESCE(v_cost, 0);

    v_subtotal := v_subtotal + v_product.price * v_qty;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'name', v_product.name,
      'image', COALESCE(v_product.images[1], ''),
      'price', v_product.price,
      'cost', v_cost,
      'qty', v_qty
    ));
  END LOOP;

  IF p_reserve THEN
    v_until := now() + interval '15 minutes';
  END IF;

  INSERT INTO public.orders (
    user_id, customer_name, phone, location, preferred_time, notes,
    subtotal, total, stock_reserved, reserved_until
  )
  VALUES (
    p_user_id,
    trim(p_customer ->> 'customer_name'),
    trim(p_customer ->> 'phone'),
    trim(p_customer ->> 'location'),
    NULLIF(trim(COALESCE(p_customer ->> 'preferred_time', '')), ''),
    NULLIF(trim(COALESCE(p_customer ->> 'notes', '')), ''),
    v_subtotal, v_subtotal, COALESCE(p_reserve, false), v_until
  )
  RETURNING id, code INTO v_order_id, v_code;

  PERFORM set_config('app.stock_reason', 'Reserved for order ' || v_code, true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.order_items (order_id, product_id, name, image, price, qty)
    VALUES (
      v_order_id,
      v_item ->> 'product_id',
      v_item ->> 'name',
      v_item ->> 'image',
      (v_item ->> 'price')::int,
      (v_item ->> 'qty')::int
    )
    RETURNING id INTO v_item_id;

    INSERT INTO public.order_item_costs (order_item_id, cost)
    VALUES (v_item_id, (v_item ->> 'cost')::int);

    IF COALESCE(p_reserve, false) THEN
      UPDATE public.products
      SET stock = stock - (v_item ->> 'qty')::int
      WHERE id = v_item ->> 'product_id';
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'code', v_code,
    'total', v_subtotal,
    'stock_reserved', COALESCE(p_reserve, false),
    'reserved_until', v_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_checkout_order(uuid, jsonb, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(uuid, jsonb, jsonb, boolean)
  TO service_role;

ALTER TABLE public.order_items DROP COLUMN IF EXISTS cost;

-- 3. One conversation per visitor; only staff can delete conversations.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_user_id_key') THEN
    ALTER TABLE public.conversations ADD CONSTRAINT conversations_user_id_key UNIQUE (user_id);
  END IF;
END
$$;

DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  TO authenticated USING (public.is_staff());

-- 4. Signed-in users can only change fulfilment_status on an order.
CREATE OR REPLACE FUNCTION public.protect_order_payment_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF (to_jsonb(NEW) - 'fulfilment_status' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'fulfilment_status' - 'updated_at') THEN
      RAISE EXCEPTION 'Only the fulfilment status can be changed from the admin console';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Messages must carry the sender's own id.
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      (sender_role = 'client' AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = conversation_id AND c.user_id = auth.uid()))
      OR (sender_role = 'staff' AND public.is_staff())
    )
  );
