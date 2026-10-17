-- MOA Mart — 000001: core schema, functions, triggers, RLS.
-- Run order: 1 of 3 (then 000002_seed_catalog.sql, then 000003_storage.sql).
-- Idempotent: safe to re-run after a partial failure.

-- ============ Extensions ============
-- pg_cron powers the 15-minute payment-reservation expiry sweep.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron unavailable, will retry on re-run: %', SQLERRM;
END
$$;

-- ============ Tables ============

CREATE TABLE IF NOT EXISTS public.profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name  text NOT NULL DEFAULT '',
  phone      text,
  role       text NOT NULL DEFAULT 'customer'
             CHECK (role IN ('customer', 'staff', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.categories (
  id         text PRIMARY KEY,          -- slug, e.g. 'home-tools'
  name       text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.products (
  id              text PRIMARY KEY,     -- slug, keeps existing URLs stable
  name            text NOT NULL,
  category_id     text NOT NULL REFERENCES public.categories (id),
  price           int  NOT NULL CHECK (price > 0),          -- whole RWF
  old_price       int  CHECK (old_price IS NULL OR old_price > price),
  sku             text NOT NULL UNIQUE,
  stock           int  NOT NULL DEFAULT 0 CHECK (stock >= 0),
  images          text[] NOT NULL DEFAULT '{}',
  blurb           text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  specs           jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{label,value}]
  highlights      text[] NOT NULL DEFAULT '{}',
  care            text NOT NULL DEFAULT '',
  shipping        text NOT NULL DEFAULT '',
  reference_links jsonb NOT NULL DEFAULT '[]'::jsonb,       -- [{label,url}]
  tags            text[] NOT NULL DEFAULT '{}',
  rating          numeric(2,1) NOT NULL DEFAULT 4.5
                  CHECK (rating >= 0 AND rating <= 5),
  reviews         int NOT NULL DEFAULT 0 CHECK (reviews >= 0),
  video_preview   boolean NOT NULL DEFAULT false,
  archived_at     timestamptz,          -- products are archived, never deleted
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_category_idx  ON public.products (category_id);
CREATE INDEX IF NOT EXISTS products_archived_idx  ON public.products (archived_at);
CREATE INDEX IF NOT EXISTS products_created_idx   ON public.products (created_at DESC);

-- Cost lives in an admin-only table, away from storefront-facing products.
CREATE TABLE IF NOT EXISTS public.product_costs (
  product_id text PRIMARY KEY REFERENCES public.products (id) ON DELETE CASCADE,
  cost       int NOT NULL CHECK (cost >= 0),
  updated_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every stock change is recorded with who changed it and why.
CREATE TABLE IF NOT EXISTS public.stock_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id text NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  delta      int  NOT NULL,
  stock_after int NOT NULL CHECK (stock_after >= 0),
  reason     text NOT NULL CHECK (length(trim(reason)) > 0),
  changed_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL, -- NULL = system (checkout/expiry)
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_product_idx
  ON public.stock_movements (product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wishlist_items (
  user_id    uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- Orders: payment_status is machine-driven (awaiting_payment → paid/failed/expired),
-- fulfilment_status is staff-set (pending → confirmed → out_for_delivery → delivered/cancelled).
CREATE TABLE IF NOT EXISTS public.orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             text NOT NULL UNIQUE,            -- e.g. 'MOA-4830'
  user_id          uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  customer_name    text NOT NULL,
  phone            text NOT NULL,
  location         text NOT NULL,
  preferred_time   text,
  notes            text,
  subtotal         int NOT NULL CHECK (subtotal >= 0),
  total            int NOT NULL CHECK (total >= 0),
  currency         text NOT NULL DEFAULT 'RWF' CHECK (currency = 'RWF'),
  payment_status   text NOT NULL DEFAULT 'awaiting_payment'
                   CHECK (payment_status IN ('awaiting_payment', 'paid', 'failed', 'expired')),
  fulfilment_status text NOT NULL DEFAULT 'pending'
                   CHECK (fulfilment_status IN ('pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled')),
  deposit_id       text,                              -- PawaPay depositId
  payment_method   text CHECK (payment_method IS NULL OR payment_method IN ('MTN_MOMO_RWA', 'AIRTEL_RWA')),
  stock_reserved   boolean NOT NULL DEFAULT false,    -- true only while payments are enabled
  reserved_until   timestamptz,                       -- now() + 15 min when reserved
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx     ON public.orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_payment_idx  ON public.orders (payment_status)
  WHERE payment_status = 'awaiting_payment' AND stock_reserved;

CREATE TABLE IF NOT EXISTS public.order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES public.products (id),   -- archived, never deleted
  name       text NOT NULL,        -- snapshot at purchase time
  image      text NOT NULL DEFAULT '',
  price      int  NOT NULL CHECK (price >= 0),  -- snapshot unit price, whole RWF
  cost       int  NOT NULL CHECK (cost >= 0),   -- snapshot unit cost (admin-only column)
  qty        int  NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);

-- Append-only audit of PawaPay callbacks and status re-checks.
CREATE TABLE IF NOT EXISTS public.payment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders (id) ON DELETE CASCADE,
  deposit_id  text,
  status      text NOT NULL,
  source      text NOT NULL CHECK (source IN ('callback', 'recheck', 'create')),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON public.payment_events (order_id, created_at DESC);

-- One message shape for storefront chat and admin inbox.
-- sender_role: 'client' (shopper), 'staff' (agent), 'system' (automated notices).
CREATE TABLE IF NOT EXISTS public.conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE, -- guests = anon session
  guest_name  text NOT NULL DEFAULT 'Guest',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON public.conversations (user_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations (id) ON DELETE CASCADE,
  sender_role     text NOT NULL CHECK (sender_role IN ('client', 'staff', 'system')),
  sender_id       uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  body            text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),  -- 1000-char cap
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conversation_idx ON public.messages (conversation_id, created_at);

-- ============ Helper functions (SECURITY DEFINER avoids RLS recursion) ============

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_staff() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('staff', 'admin')
  );
$$;

-- ============ Profile lifecycle ============

-- Auto-create a profile for every auth.users row (email, Google, Facebook, anon).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_first text := '';
  v_last  text := '';
BEGIN
  v_first := COALESCE(
    NEW.raw_user_meta_data ->> 'first_name',
    NEW.raw_user_meta_data ->> 'firstName',
    NEW.raw_user_meta_data ->> 'given_name',
    ''
  );
  v_last := COALESCE(
    NEW.raw_user_meta_data ->> 'last_name',
    NEW.raw_user_meta_data ->> 'lastName',
    NEW.raw_user_meta_data ->> 'family_name',
    ''
  );
  -- Social providers often only send a full name.
  IF v_first = '' AND COALESCE(NEW.raw_user_meta_data ->> 'full_name', '') <> '' THEN
    v_first := split_part(NEW.raw_user_meta_data ->> 'full_name', ' ', 1);
    v_last  := substr(
      NEW.raw_user_meta_data ->> 'full_name',
      length(split_part(NEW.raw_user_meta_data ->> 'full_name', ' ', 1)) + 2
    );
  END IF;

  INSERT INTO public.profiles (id, first_name, last_name)
  VALUES (NEW.id, v_first, v_last)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Roles can be changed ONLY by an admin (enforced in the database, not just the UI).
-- Non-JWT contexts (SQL editor bootstrap, service role) are allowed: there is no
-- authenticated end user to protect against in those contexts.
CREATE OR REPLACE FUNCTION public.protect_profile_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role <> 'customer' AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
      RAISE EXCEPTION 'Only admins can assign roles';
    END IF;
  ELSIF NEW.role IS DISTINCT FROM OLD.role
        AND auth.uid() IS NOT NULL AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only admins can change roles';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_role_ins ON public.profiles;
CREATE TRIGGER protect_profile_role_ins BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();
DROP TRIGGER IF EXISTS protect_profile_role_upd ON public.profiles;
CREATE TRIGGER protect_profile_role_upd BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_role();

-- ============ Orders: sequential human-friendly codes ============

CREATE SEQUENCE IF NOT EXISTS public.order_code_seq START 4800;
ALTER TABLE public.orders
  ALTER COLUMN code SET DEFAULT ('MOA-' || nextval('public.order_code_seq'));

-- ============ Stock: every change recorded with who and why ============
-- A trigger on products.stock is the single enforcement point (see
-- log_stock_change below), so even direct admin edits cannot skip the audit.
-- Callers pass the reason via the transaction-local app.stock_reason GUC.

CREATE OR REPLACE FUNCTION public.set_product_stock(
  p_product_id text,
  p_new_stock  int,
  p_reason     text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old int;
BEGIN
  IF NOT public.is_staff() THEN
    RAISE EXCEPTION 'Only staff can change stock';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required for stock changes';
  END IF;
  IF p_new_stock IS NULL OR p_new_stock < 0 THEN
    RAISE EXCEPTION 'Stock cannot be negative';
  END IF;

  SELECT stock INTO v_old FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found';
  END IF;
  IF v_old = p_new_stock THEN
    RETURN;
  END IF;

  PERFORM set_config('app.stock_reason', trim(p_reason), true);
  UPDATE public.products SET stock = p_new_stock WHERE id = p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_product_stock(text, int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_stock(text, int, text) TO authenticated, service_role;

-- Single audit point: any stock delta on products is logged with who + why.
CREATE OR REPLACE FUNCTION public.log_stock_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stock IS DISTINCT FROM OLD.stock THEN
    INSERT INTO public.stock_movements (product_id, delta, stock_after, reason, changed_by)
    VALUES (
      NEW.id,
      NEW.stock - OLD.stock,
      NEW.stock,
      COALESCE(NULLIF(current_setting('app.stock_reason', true), ''), 'Stock updated'),
      auth.uid()   -- NULL for system changes (checkout, expiry)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS log_stock_change_upd ON public.products;
CREATE TRIGGER log_stock_change_upd AFTER UPDATE OF stock ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.log_stock_change();


-- ============ Reservations: 15-minute expiry released by pg_cron ============
-- Only orders created while payments are enabled hold a reservation
-- (stock_reserved = true). While payments are disabled nothing is reserved,
-- so this job is a no-op for those orders.

CREATE OR REPLACE FUNCTION public.release_expired_reservations() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order record;
  v_item  record;
  v_count int := 0;
BEGIN
  FOR v_order IN
    SELECT id, code FROM public.orders
    WHERE stock_reserved = true
      AND payment_status = 'awaiting_payment'
      AND reserved_until IS NOT NULL
      AND reserved_until < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config(
      'app.stock_reason',
      'Reservation expired for order ' || v_order.code,
      true
    );
    FOR v_item IN
      SELECT product_id, qty FROM public.order_items WHERE order_id = v_order.id
    LOOP
      UPDATE public.products SET stock = stock + v_item.qty WHERE id = v_item.product_id;
      -- stock_movements row is written by the log_stock_change trigger
    END LOOP;

    UPDATE public.orders
    SET stock_reserved = false,
        reserved_until = NULL,
        payment_status = 'expired',
        updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.payment_events (order_id, deposit_id, status, source, payload)
    SELECT v_order.id, deposit_id, 'expired', 'recheck',
           jsonb_build_object('reason', 'reservation_expired')
    FROM public.orders WHERE id = v_order.id;

    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.release_expired_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_reservations() TO service_role;

-- Sweep every minute (created in this migration so behaviour ships with the schema).
DO $$
BEGIN
  PERFORM cron.schedule(
    'release-expired-reservations',
    '* * * * *',
    'SELECT public.release_expired_reservations()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule reservation sweep (pg_cron missing?): %', SQLERRM;
END
$$;

-- ============ Chat: DB-enforced rate limit per conversation ============
-- Max 10 messages per minute per conversation (length is capped by the
-- messages.body CHECK constraint at 1000 chars). Enforced in the database
-- so the UI cannot be bypassed.

CREATE OR REPLACE FUNCTION public.enforce_message_rate_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recent int;
BEGIN
  SELECT count(*) INTO v_recent
  FROM public.messages
  WHERE conversation_id = NEW.conversation_id
    AND created_at > now() - interval '1 minute';

  IF v_recent >= 10 THEN
    RAISE EXCEPTION 'Rate limit: max 10 messages per minute per conversation'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_message_rate_limit_ins ON public.messages;
CREATE TRIGGER enforce_message_rate_limit_ins BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_message_rate_limit();

-- Keep conversation activity fresh for the admin inbox ordering.
CREATE OR REPLACE FUNCTION public.touch_conversation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations
  SET last_active_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_conversation_on_message ON public.messages;
CREATE TRIGGER touch_conversation_on_message AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation();

-- Welcome message the moment a conversation opens (system sender; clients
-- cannot insert 'system' rows via RLS — only SECURITY DEFINER triggers can).
CREATE OR REPLACE FUNCTION public.on_conversation_created() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.messages (conversation_id, sender_role, body)
  VALUES (
    NEW.id,
    'system',
    'Hi! Welcome to MOA Mart. How can we help you today?'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_conversation_created_ins ON public.conversations;
CREATE TRIGGER on_conversation_created_ins AFTER INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.on_conversation_created();

-- Auto-acknowledgment after the client's first message (mirrors the old demo
-- behaviour, but as one real system row instead of a fake staff reply).
CREATE OR REPLACE FUNCTION public.on_first_client_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.sender_role = 'client' AND NOT EXISTS (
    SELECT 1 FROM public.messages
    WHERE conversation_id = NEW.conversation_id
      AND sender_role = 'client'
      AND id <> NEW.id
  ) THEN
    INSERT INTO public.messages (conversation_id, sender_role, body)
    VALUES (
      NEW.conversation_id,
      'system',
      'Thanks for reaching out! A MOA Mart agent is picking this up now.'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_first_client_message_ins ON public.messages;
CREATE TRIGGER on_first_client_message_ins AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.on_first_client_message();

-- Orders keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS touch_order_upd ON public.orders;
CREATE TRIGGER touch_order_upd BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_order();

-- ============ Checkout: server re-prices, validates, optionally reserves ============
-- Called by the create-checkout Edge Function with the caller's JWT forwarded
-- (auth.uid() must be a real session — anon sessions included).
-- p_reserve is true ONLY while the PawaPay token is configured: with payments
-- disabled stock is validated but never reserved (approved behaviour).

CREATE OR REPLACE FUNCTION public.create_checkout_order(
  p_items    jsonb,   -- [{"product_id": "slug", "qty": 2}]
  p_customer jsonb,   -- {"customer_name","phone","location","preferred_time","notes"}
  p_reserve  boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_order_id  uuid;
  v_code      text;
  v_subtotal  int  := 0;
  v_until     timestamptz;
  v_item      jsonb;
  v_lines     jsonb := '[]'::jsonb;
  v_product   public.products%ROWTYPE;
  v_cost      int;
  v_qty       int;
BEGIN
  IF v_uid IS NULL THEN
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

  -- Pass 1: re-price from the DB (client prices are ignored) and validate
  -- stock while holding row locks. No order row exists yet, so the
  -- payment-protection trigger never sees the total being written later.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_qty := (v_item ->> 'qty')::int;
    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 100 THEN
      RAISE EXCEPTION 'Invalid quantity for product %', v_item ->> 'product_id';
    END IF;

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_item ->> 'product_id'
    FOR UPDATE;

    IF NOT FOUND OR v_product.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'Product not available: %', v_item ->> 'product_id';
    END IF;
    IF v_product.stock < v_qty THEN
      RAISE EXCEPTION 'Not enough stock for %', v_product.name;
    END IF;

    SELECT cost INTO v_cost
    FROM public.product_costs WHERE product_id = v_product.id;
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

  -- Pass 2: create the order with final totals in one shot.
  INSERT INTO public.orders (
    user_id, customer_name, phone, location, preferred_time, notes,
    subtotal, total, stock_reserved, reserved_until
  )
  VALUES (
    v_uid,
    trim(p_customer ->> 'customer_name'),
    trim(p_customer ->> 'phone'),
    trim(p_customer ->> 'location'),
    NULLIF(trim(COALESCE(p_customer ->> 'preferred_time', '')), ''),
    NULLIF(trim(COALESCE(p_customer ->> 'notes', '')), ''),
    v_subtotal, v_subtotal, COALESCE(p_reserve, false), v_until
  )
  RETURNING id, code INTO v_order_id, v_code;

  PERFORM set_config('app.stock_reason', 'Reserved for order ' || v_code, true);

  -- Pass 3: snapshot line items and, only while payments are enabled,
  -- decrement stock (the log_stock_change trigger records each movement).
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_lines)
  LOOP
    INSERT INTO public.order_items (order_id, product_id, name, image, price, cost, qty)
    VALUES (
      v_order_id,
      v_item ->> 'product_id',
      v_item ->> 'name',
      v_item ->> 'image',
      (v_item ->> 'price')::int,
      (v_item ->> 'cost')::int,
      (v_item ->> 'qty')::int
    );

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

REVOKE ALL ON FUNCTION public.create_checkout_order(jsonb, jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(jsonb, jsonb, boolean)
  TO authenticated, service_role;

-- Release a reservation when a payment definitively fails (callback path).
CREATE OR REPLACE FUNCTION public.release_order_reservation(
  p_order_id uuid,
  p_reason   text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item  record;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR NOT v_order.stock_reserved THEN
    RETURN;
  END IF;

  PERFORM set_config('app.stock_reason', p_reason, true);
  FOR v_item IN
    SELECT product_id, qty FROM public.order_items WHERE order_id = p_order_id
  LOOP
    UPDATE public.products SET stock = stock + v_item.qty WHERE id = v_item.product_id;
  END LOOP;

  UPDATE public.orders
  SET stock_reserved = false, reserved_until = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.release_order_reservation(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_reservation(uuid, text)
  TO service_role;

-- ============ Row Level Security — enabled on EVERY table ============

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages        ENABLE ROW LEVEL SECURITY;

-- profiles -----------------------------------------------------------
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT
  USING (id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());
-- role changes additionally guarded by the protect_profile_role trigger;
-- insert happens via handle_new_user (SECURITY DEFINER, table owner).

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles FOR DELETE
  USING (public.is_admin());

-- categories ---------------------------------------------------------
DROP POLICY IF EXISTS categories_select ON public.categories;
CREATE POLICY categories_select ON public.categories FOR SELECT
  USING (true);

DROP POLICY IF EXISTS categories_write ON public.categories;
CREATE POLICY categories_write ON public.categories FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- products -----------------------------------------------------------
-- Storefront sees published rows; staff also see archived ones.
-- No DELETE policy at all: products are archived, never hard-deleted.
DROP POLICY IF EXISTS products_select ON public.products;
CREATE POLICY products_select ON public.products FOR SELECT
  USING (archived_at IS NULL OR public.is_staff());

DROP POLICY IF EXISTS products_insert ON public.products;
CREATE POLICY products_insert ON public.products FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS products_update ON public.products;
CREATE POLICY products_update ON public.products FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- product_costs (admin-only) ----------------------------------------
DROP POLICY IF EXISTS product_costs_admin ON public.product_costs;
CREATE POLICY product_costs_admin ON public.product_costs FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- stock_movements (append-only audit; staff read) --------------------
DROP POLICY IF EXISTS stock_movements_select ON public.stock_movements;
CREATE POLICY stock_movements_select ON public.stock_movements FOR SELECT
  TO authenticated
  USING (public.is_staff());
-- no INSERT/UPDATE/DELETE policies: rows come from the log_stock_change
-- trigger (SECURITY DEFINER) only.

-- wishlist_items ------------------------------------------------------
DROP POLICY IF EXISTS wishlist_own ON public.wishlist_items;
CREATE POLICY wishlist_own ON public.wishlist_items FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- orders --------------------------------------------------------------
DROP POLICY IF EXISTS orders_select ON public.orders;
CREATE POLICY orders_select ON public.orders FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_staff());
-- INSERT happens only inside create_checkout_order (SECURITY DEFINER).

DROP POLICY IF EXISTS orders_update ON public.orders;
CREATE POLICY orders_update ON public.orders FOR UPDATE
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
-- payment_status changes are additionally guarded below;
-- service_role (callback Edge Function) bypasses RLS entirely.
-- No DELETE policy: orders are never deleted.

-- order_items ---------------------------------------------------------
DROP POLICY IF EXISTS order_items_select ON public.order_items;
CREATE POLICY order_items_select ON public.order_items FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND (o.user_id = auth.uid() OR public.is_staff())
  ));

-- payment_events (append-only; staff read) ---------------------------
DROP POLICY IF EXISTS payment_events_select ON public.payment_events;
CREATE POLICY payment_events_select ON public.payment_events FOR SELECT
  TO authenticated
  USING (public.is_staff() OR EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.id = order_id AND o.user_id = auth.uid()
  ));

-- conversations -------------------------------------------------------
DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS conversations_update ON public.conversations;
CREATE POLICY conversations_update ON public.conversations FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_staff())
  WITH CHECK (user_id = auth.uid() OR public.is_staff());

DROP POLICY IF EXISTS conversations_delete ON public.conversations;
CREATE POLICY conversations_delete ON public.conversations FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_staff());

-- messages ------------------------------------------------------------
-- One shape, immutable log: no UPDATE/DELETE policies for anyone.
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = conversation_id AND (c.user_id = auth.uid() OR public.is_staff())
  ));

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (sender_role = 'client'
      AND EXISTS (
        SELECT 1 FROM public.conversations c
        WHERE c.id = conversation_id AND c.user_id = auth.uid()
      ))
    OR
    (public.is_staff() AND sender_role = 'staff')
  );
-- system messages are inserted by SECURITY DEFINER triggers only.

-- ============ payment_status is machine-managed only ============
-- Only contexts WITHOUT an end-user JWT (service_role callback Edge Function,
-- pg_cron sweep, SQL editor) may change payment fields. Staff update
-- fulfilment_status through the orders_update policy; an authenticated user
-- touching payment_status raises.

CREATE OR REPLACE FUNCTION public.protect_order_payment_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.deposit_id IS DISTINCT FROM OLD.deposit_id
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.subtotal IS DISTINCT FROM OLD.subtotal
       OR NEW.stock_reserved IS DISTINCT FROM OLD.stock_reserved
       OR NEW.reserved_until IS DISTINCT FROM OLD.reserved_until THEN
      RAISE EXCEPTION 'Payment fields can only be changed by the payment server';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_order_payment_status_upd ON public.orders;
CREATE TRIGGER protect_order_payment_status_upd BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_payment_status();

-- ============ Realtime (admin inbox, live inventory, orders) ============
-- Messages/products/orders stream into the admin console and storefront chat.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['messages', 'conversations', 'products', 'orders']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not add tables to supabase_realtime (will retry on re-run): %', SQLERRM;
END
$$;

-- UPDATE/DELETE events need the full old row; INSERT-only would work but
-- admin screens react to stock/status updates too.
ALTER TABLE public.messages    REPLICA IDENTITY FULL;
ALTER TABLE public.products    REPLICA IDENTITY FULL;
ALTER TABLE public.orders      REPLICA IDENTITY FULL;

-- ============ Grants (RLS does the actual filtering) ============
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON public.categories, public.products TO anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

-- The blanket grant above must NOT cover privileged functions: revoke them
-- from everyone except service_role (which the Edge Functions use).
REVOKE ALL ON FUNCTION public.release_order_reservation(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_expired_reservations()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_order_reservation(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_reservations() TO service_role;

-- Stock and checkout need an authenticated session (checked inside), never anon.
REVOKE ALL ON FUNCTION public.set_product_stock(text, int, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_checkout_order(jsonb, jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_product_stock(text, int, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_checkout_order(jsonb, jsonb, boolean) TO authenticated, service_role;








