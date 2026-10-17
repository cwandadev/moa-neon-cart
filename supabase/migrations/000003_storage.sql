-- MOA Mart — 000003: Storage bucket for product images.
-- Run order: 3 of 3 (after 000001_schema.sql and 000002_seed_catalog.sql).
-- Idempotent: safe to re-run.

-- Public bucket: storefront displays images without a session.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Anyone can read product images.
DROP POLICY IF EXISTS "product-images public read" ON storage.objects;
CREATE POLICY "product-images public read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'product-images');

-- Only admins may upload/replace/delete images (RLS-backed, not just UI).
DROP POLICY IF EXISTS "product-images admin insert" ON storage.objects;
CREATE POLICY "product-images admin insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "product-images admin update" ON storage.objects;
CREATE POLICY "product-images admin update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'product-images' AND public.is_admin());

DROP POLICY IF EXISTS "product-images admin delete" ON storage.objects;
CREATE POLICY "product-images admin delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images' AND public.is_admin());
