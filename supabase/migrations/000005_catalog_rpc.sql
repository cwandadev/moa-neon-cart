-- MOA Mart — 000005: server-side catalog query (filter, sort, search, paging).
-- Run order: 5 (after 000001; independent of 000002–000004).
-- Idempotent: safe to re-run.
--
-- SECURITY DEFINER so popularity can be computed from wishlist_items /
-- order_items regardless of the caller's role; only published (non-archived)
-- products are returned and product_costs is a separate admin-only table,
-- so nothing sensitive leaks. Sorting:
--   smart      = wishlist count * 1.6 + order qty * 3 (real engagement)
--   new        = newest first
--   price-asc / price-desc / rating

CREATE OR REPLACE FUNCTION public.catalog_products(
  p_search     text    DEFAULT NULL,
  p_categories text[]  DEFAULT NULL,   -- category names, e.g. '{"Clothing"}'
  p_min_price  int     DEFAULT NULL,
  p_max_price  int     DEFAULT NULL,
  p_in_stock   boolean DEFAULT false,
  p_min_rating numeric DEFAULT NULL,
  p_sort       text    DEFAULT 'smart',
  p_limit      int     DEFAULT 12,
  p_offset     int     DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH base AS (
    SELECT
      p.*,
      c.name AS category_name,
      (SELECT count(*) FROM wishlist_items w WHERE w.product_id = p.id) AS wishlist_count,
      (SELECT COALESCE(sum(oi.qty), 0) FROM order_items oi WHERE oi.product_id = p.id) AS order_count
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.archived_at IS NULL
      AND (p_search IS NULL OR p_search = ''
           OR p.name ILIKE '%' || p_search || '%'
           OR c.name ILIKE '%' || p_search || '%'
           OR array_to_string(p.tags, ' ') ILIKE '%' || p_search || '%')
      AND (p_categories IS NULL OR cardinality(p_categories) = 0
           OR c.name = ANY (p_categories))
      AND (p_min_price IS NULL OR p.price >= p_min_price)
      AND (p_max_price IS NULL OR p.price <= p_max_price)
      AND (NOT COALESCE(p_in_stock, false) OR p.stock > 0)
      AND (p_min_rating IS NULL OR p.rating >= p_min_rating)
  ),
  page AS (
    SELECT *
    FROM base
    ORDER BY
      CASE p_sort
        WHEN 'price-asc'  THEN price::numeric
        WHEN 'price-desc' THEN -price::numeric
        WHEN 'rating'     THEN -rating::numeric
        WHEN 'new'        THEN -(extract(epoch FROM created_at))::numeric
        ELSE -(wishlist_count::numeric * 1.6 + order_count::numeric * 3)
      END ASC,
      created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 12), 1), 100)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM base),
    'items', COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(x) ORDER BY
          CASE p_sort
            WHEN 'price-asc'  THEN x.price::numeric
            WHEN 'price-desc' THEN -x.price::numeric
            WHEN 'rating'     THEN -x.rating::numeric
            WHEN 'new'        THEN -(extract(epoch FROM x.created_at))::numeric
            ELSE -(x.wishlist_count::numeric * 1.6 + x.order_count::numeric * 3)
          END ASC,
          x.created_at DESC
        )
        FROM page x
      ),
      '[]'::jsonb
    )
  )
$$;

-- Storefront (anon) and signed-in users both call it.
REVOKE ALL ON FUNCTION public.catalog_products(text, text[], int, int, boolean, numeric, text, int, int)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_products(text, text[], int, int, boolean, numeric, text, int, int)
  TO anon, authenticated, service_role;
