-- MOA Mart — 000004: profile email for the account/admin views.
-- Run order: 4 (after 000001; independent of 000002/000003).
-- Idempotent: safe to re-run.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

-- Backfill existing profiles from auth.users (no-op when profiles are empty).
DO $$
BEGIN
  UPDATE public.profiles p
  SET email = u.email
  FROM auth.users u
  WHERE u.id = p.id
    AND u.email IS NOT NULL
    AND p.email IS DISTINCT FROM u.email;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'profile email backfill skipped: %', SQLERRM;
END
$$;

-- New signups (email, Google, Facebook, anonymous) get the email captured.
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

  INSERT INTO public.profiles (id, first_name, last_name, email)
  VALUES (NEW.id, v_first, v_last, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Keep profiles.email in sync when the auth email changes (e.g. recovery flow).
CREATE OR REPLACE FUNCTION public.sync_profile_email() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_email_upd ON auth.users;
CREATE TRIGGER sync_profile_email_upd
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_profile_email();
