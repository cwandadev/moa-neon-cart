-- 000024: product reviews, and which stores a product ships from. Run it after 000023. Idempotent: safe to run twice.
--
--  Reviews are GENUINE by construction: only a customer whose order containing the product was DELIVERED can review it (one review per product,
--  editable, deletable by its author). Nobody is paid or rewarded for a review, and the invitation to rate goes to every buyer, whatever they thought.
--  Staff may hide a review ONLY for a policy reason (spam, abuse, personal information, not about the product, suspected fake), never for being
--  negative; the reviewer is told when it happens. The store can answer a review in public. Readers can mark a review helpful or report it.
--  Everything is read and written through functions: the tables are not open to the browser.
--  Also: product_stores() says which stores (warehouses, to a customer) a product ships from, without revealing quantities.

-- ============================================================ tables
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,          -- the delivered order that proves they received it
  rating smallint not null check (rating between 1 and 5),
  title text check (title is null or char_length(title) <= 80),
  body text not null check (char_length(body) between 10 and 2000),
  status text not null default 'published' check (status in ('published', 'hidden')),
  hidden_reason text check (hidden_reason is null or hidden_reason in ('spam', 'abusive', 'personal_info', 'not_about_product', 'suspected_fake')),
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_at timestamptz,
  helpful_count int not null default 0,
  reply text check (reply is null or char_length(reply) <= 1000),
  reply_by uuid references public.profiles (id) on delete set null,
  reply_at timestamptz,
  edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, user_id)
);
create index if not exists product_reviews_list_idx on public.product_reviews (product_id, status, created_at desc);
create index if not exists product_reviews_status_idx on public.product_reviews (status, created_at desc);

create table if not exists public.review_votes (
  review_id uuid not null references public.product_reviews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists public.review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.product_reviews (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('spam', 'abusive', 'personal_info', 'not_about_product', 'fake')),
  note text check (note is null or char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  created_at timestamptz not null default now(),
  unique (review_id, user_id)
);
create index if not exists review_reports_open_idx on public.review_reports (status) where status = 'open';

alter table public.products add column if not exists rating_avg numeric(3, 2) not null default 0;
alter table public.products add column if not exists rating_count int not null default 0;

-- No direct reads or writes from the browser. A person may read their own review row (to edit it); staff may read all.
alter table public.product_reviews enable row level security;
alter table public.review_votes enable row level security;
alter table public.review_reports enable row level security;
drop policy if exists product_reviews_select on public.product_reviews;
create policy product_reviews_select on public.product_reviews for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists review_votes_select on public.review_votes;
create policy review_votes_select on public.review_votes for select to authenticated using (user_id = auth.uid() or public.is_staff());
drop policy if exists review_reports_select on public.review_reports;
create policy review_reports_select on public.review_reports for select to authenticated using (public.is_staff());

-- ============================================================ keeping the totals right
create or replace function public.refresh_product_rating(p_product text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.products p
     set rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.product_reviews where product_id = p_product and status = 'published'), 0),
         rating_count = (select count(*) from public.product_reviews where product_id = p_product and status = 'published')
   where p.id = p_product;
end $$;

create or replace function public.trg_review_totals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_product_rating(case when tg_op = 'DELETE' then old.product_id else new.product_id end);
  return null;
end $$;
drop trigger if exists review_totals on public.product_reviews;
create trigger review_totals after insert or update of rating, status or delete on public.product_reviews for each row execute function public.trg_review_totals();

create or replace function public.trg_review_votes() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid := case when tg_op = 'DELETE' then old.review_id else new.review_id end;
begin
  update public.product_reviews set helpful_count = (select count(*) from public.review_votes where review_id = v_id) where id = v_id;
  return null;
end $$;
drop trigger if exists review_votes_count on public.review_votes;
create trigger review_votes_count after insert or delete on public.review_votes for each row execute function public.trg_review_votes();

-- ============================================================ helpers
-- "Aline U." : a first name and the first letter of the last, never an email or a full name.
create or replace function public.review_display_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(concat_ws(' ', nullif(trim(first_name), ''), case when nullif(trim(last_name), '') is not null then left(trim(last_name), 1) || '.' end)), ''), 'Customer')
    from public.profiles where id = p_user;
$$;

create or replace function public.review_json(r public.product_reviews, p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'rating', r.rating, 'title', r.title, 'body', r.body, 'name', public.review_display_name(r.user_id),
    'created_at', r.created_at, 'edited', r.edited_at is not null, 'helpful', r.helpful_count,
    'reply', r.reply, 'reply_at', r.reply_at, 'mine', (p_uid is not null and r.user_id = p_uid),
    'voted', (p_uid is not null and exists (select 1 from public.review_votes v where v.review_id = r.id and v.user_id = p_uid)));
$$;

-- ============================================================ shoppers: reading
create or replace function public.review_eligibility(p_product text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ok boolean; v_rev public.product_reviews%rowtype;
begin
  if v_uid is null then return jsonb_build_object('signed_in', false, 'can_review', false, 'has_reviewed', false, 'reason', 'not_signed_in'); end if;
  select exists (select 1 from public.orders o join public.order_items oi on oi.order_id = o.id
                  where o.user_id = v_uid and oi.product_id = p_product and o.fulfilment_status = 'delivered') into v_ok;
  select * into v_rev from public.product_reviews where product_id = p_product and user_id = v_uid;
  return jsonb_build_object('signed_in', true, 'can_review', v_ok or found, 'has_reviewed', found, 'review_id', v_rev.id,
                            'reason', case when v_ok or found then null else 'not_delivered' end,
                            'my_status', v_rev.status, 'my_hidden_reason', v_rev.hidden_reason);
end $$;

create or replace function public.product_review_summary(p_product text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'count', count(*)::int,
    'avg', coalesce(round(avg(rating)::numeric, 2), 0),
    'dist', jsonb_build_object('1', count(*) filter (where rating = 1), '2', count(*) filter (where rating = 2), '3', count(*) filter (where rating = 3),
                               '4', count(*) filter (where rating = 4), '5', count(*) filter (where rating = 5)))
    from public.product_reviews where product_id = p_product and status = 'published';
$$;

create or replace function public.product_reviews_list(p_product text, p_sort text default 'helpful', p_stars int default null, p_limit int default 5, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_total int; v_rows jsonb;
begin
  p_limit := least(greatest(coalesce(p_limit, 5), 1), 50);
  p_offset := greatest(coalesce(p_offset, 0), 0);
  select count(*) into v_total from public.product_reviews r where r.product_id = p_product and r.status = 'published' and (p_stars is null or r.rating = p_stars);
  select coalesce(jsonb_agg(public.review_json(r, v_uid) order by o.n), '[]'::jsonb) into v_rows from (
    select r2.id, row_number() over (
             order by (case when p_sort = 'highest' then r2.rating end) desc nulls last,
                      (case when p_sort = 'lowest' then r2.rating end) asc nulls last,
                      (case when p_sort = 'recent' then r2.created_at end) desc nulls last,
                      r2.helpful_count desc, r2.created_at desc, r2.id) as n
      from public.product_reviews r2 where r2.product_id = p_product and r2.status = 'published' and (p_stars is null or r2.rating = p_stars)
     order by n limit p_limit offset p_offset) o
    join public.product_reviews r on r.id = o.id;
  return jsonb_build_object('total', v_total, 'reviews', v_rows);
end $$;

-- The most helpful good review and the most helpful critical one (shoppers read the critical ones first).
create or replace function public.product_review_highlights(p_product text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_pos public.product_reviews%rowtype; v_neg public.product_reviews%rowtype; v_n int;
begin
  select count(*) into v_n from public.product_reviews where product_id = p_product and status = 'published';
  if v_n < 5 then return jsonb_build_object('positive', null, 'critical', null); end if;
  select * into v_pos from public.product_reviews where product_id = p_product and status = 'published' and rating >= 4 order by helpful_count desc, created_at desc limit 1;
  select * into v_neg from public.product_reviews where product_id = p_product and status = 'published' and rating <= 2 order by helpful_count desc, created_at desc limit 1;
  return jsonb_build_object('positive', case when v_pos.id is not null then public.review_json(v_pos, v_uid) end, 'critical', case when v_neg.id is not null then public.review_json(v_neg, v_uid) end);
end $$;

-- The person's own review, whatever its state (so a hidden one can say why).
create or replace function public.my_review(p_product text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when r.id is null then null else public.review_json(r, auth.uid()) || jsonb_build_object('status', r.status, 'hidden_reason', r.hidden_reason) end
    from (select 1) x left join public.product_reviews r on r.product_id = p_product and r.user_id = auth.uid();
$$;

-- ============================================================ shoppers: writing
create or replace function public.submit_review(p_product text, p_rating int, p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_title text := nullif(regexp_replace(trim(coalesce(p_title, '')), '\s+', ' ', 'g'), '');
  v_body text := regexp_replace(trim(coalesce(p_body, '')), '[ \t]+', ' ', 'g'); v_order uuid; v_old public.product_reviews%rowtype; v_id uuid; v_new boolean; v_name text;
begin
  if v_uid is null then raise exception 'Sign in to write a review.'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Choose a rating from 1 to 5 stars.'; end if;
  if char_length(v_body) < 10 then raise exception 'Please write at least a few words (10 characters or more).'; end if;
  if char_length(v_body) > 2000 then raise exception 'Please keep your review under 2000 characters.'; end if;
  if v_title is not null and char_length(v_title) > 80 then raise exception 'Please keep the title under 80 characters.'; end if;
  if v_body ~* '(https?://|www\.)' or coalesce(v_title, '') ~* '(https?://|www\.)' then raise exception 'Please do not put links in a review.'; end if;
  select o.id into v_order from public.orders o join public.order_items oi on oi.order_id = o.id
   where o.user_id = v_uid and oi.product_id = p_product and o.fulfilment_status = 'delivered' order by o.created_at desc limit 1;
  select * into v_old from public.product_reviews where product_id = p_product and user_id = v_uid;
  v_new := not found;
  if v_order is null and v_new then raise exception 'You can review this product once it has been delivered to you.'; end if;
  if v_new then
    insert into public.product_reviews (product_id, user_id, order_id, rating, title, body) values (p_product, v_uid, v_order, p_rating, v_title, v_body) returning id into v_id;
  else
    update public.product_reviews set rating = p_rating, title = v_title, body = v_body, edited_at = now(), updated_at = now() where id = v_old.id returning id into v_id;
  end if;
  if p_rating <= 2 and (v_new or v_old.rating > 2) then
    select name into v_name from public.products where id = p_product;
    perform public.notify_staff('review_low', 'warning', p_rating || '-star review: ' || coalesce(v_name, p_product), 'A customer was not happy. Read it and reply.', '/admin/reviews');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end $$;

create or replace function public.delete_my_review(p_product text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from public.product_reviews where product_id = p_product and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vote_review(p_review uuid, p_helpful boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.product_reviews%rowtype;
begin
  if v_uid is null then raise exception 'Sign in to vote.'; end if;
  select * into r from public.product_reviews where id = p_review and status = 'published';
  if not found then raise exception 'Review not found.'; end if;
  if r.user_id = v_uid then raise exception 'You cannot vote on your own review.'; end if;
  if p_helpful then insert into public.review_votes (review_id, user_id) values (p_review, v_uid) on conflict do nothing;
  else delete from public.review_votes where review_id = p_review and user_id = v_uid; end if;
  return jsonb_build_object('ok', true, 'voted', p_helpful, 'helpful', (select helpful_count from public.product_reviews where id = p_review));
end $$;

create or replace function public.report_review(p_review uuid, p_reason text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r public.product_reviews%rowtype; v_first boolean;
begin
  if v_uid is null then raise exception 'Sign in to report a review.'; end if;
  if p_reason is null or p_reason not in ('spam', 'abusive', 'personal_info', 'not_about_product', 'fake') then raise exception 'Choose why you are reporting it.'; end if;
  select * into r from public.product_reviews where id = p_review and status = 'published';
  if not found then raise exception 'Review not found.'; end if;
  if r.user_id = v_uid then raise exception 'This is your own review.'; end if;
  v_first := not exists (select 1 from public.review_reports where review_id = p_review and status = 'open');
  insert into public.review_reports (review_id, user_id, reason, note) values (p_review, v_uid, p_reason, nullif(trim(coalesce(p_note, '')), ''))
  on conflict (review_id, user_id) do update set reason = excluded.reason, note = excluded.note, status = 'open', created_at = now();
  if v_first then perform public.notify_staff('review_report', 'warning', 'A review was reported', 'Someone reported a review. Look at it and decide.', '/admin/reviews'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================ staff
create or replace function public.staff_reviews_list(p_filter text default 'needs_reply', p_limit int default 20, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_rows jsonb; v_counts jsonb;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  p_limit := least(greatest(coalesce(p_limit, 20), 1), 100); p_offset := greatest(coalesce(p_offset, 0), 0);
  select jsonb_build_object(
    'needs_reply', count(*) filter (where status = 'published' and reply is null),
    'low', count(*) filter (where status = 'published' and rating <= 2),
    'reported', count(*) filter (where exists (select 1 from public.review_reports rr where rr.review_id = product_reviews.id and rr.status = 'open')),
    'hidden', count(*) filter (where status = 'hidden'), 'all', count(*),
    'avg', coalesce(round(avg(rating) filter (where status = 'published')::numeric, 2), 0)) into v_counts from public.product_reviews;
  with f as (
    select r.* from public.product_reviews r
     where case coalesce(p_filter, 'all')
             when 'needs_reply' then r.status = 'published' and r.reply is null
             when 'low' then r.status = 'published' and r.rating <= 2
             when 'reported' then exists (select 1 from public.review_reports rr where rr.review_id = r.id and rr.status = 'open')
             when 'hidden' then r.status = 'hidden'
             else true end)
  select (select count(*) from f) into v_total;
  select coalesce(jsonb_agg(x order by x_n), '[]'::jsonb) into v_rows from (
    select row_number() over (order by r.created_at desc, r.id) as x_n,
           jsonb_build_object('id', r.id, 'product_id', r.product_id, 'product_name', p.name, 'rating', r.rating, 'title', r.title, 'body', r.body,
             'name', public.review_display_name(r.user_id), 'email', pr.email, 'created_at', r.created_at, 'edited', r.edited_at is not null, 'status', r.status,
             'hidden_reason', r.hidden_reason, 'helpful', r.helpful_count, 'reply', r.reply, 'reply_at', r.reply_at,
             'reports', coalesce((select jsonb_agg(jsonb_build_object('reason', rr.reason, 'note', rr.note, 'at', rr.created_at) order by rr.created_at) from public.review_reports rr where rr.review_id = r.id and rr.status = 'open'), '[]'::jsonb)) as x
      from public.product_reviews r join public.products p on p.id = r.product_id left join public.profiles pr on pr.id = r.user_id
     where case coalesce(p_filter, 'all')
             when 'needs_reply' then r.status = 'published' and r.reply is null
             when 'low' then r.status = 'published' and r.rating <= 2
             when 'reported' then exists (select 1 from public.review_reports rr where rr.review_id = r.id and rr.status = 'open')
             when 'hidden' then r.status = 'hidden'
             else true end
     order by r.created_at desc, r.id limit p_limit offset p_offset) s;
  return jsonb_build_object('total', v_total, 'counts', v_counts, 'reviews', v_rows);
end $$;

create or replace function public.reply_to_review(p_review uuid, p_text text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.product_reviews%rowtype; v_text text := nullif(trim(coalesce(p_text, '')), '');
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select * into r from public.product_reviews where id = p_review;
  if not found then raise exception 'Review not found.'; end if;
  if v_text is not null and char_length(v_text) > 1000 then raise exception 'Please keep the reply under 1000 characters.'; end if;
  if v_text is null then
    update public.product_reviews set reply = null, reply_by = null, reply_at = null where id = p_review;
  else
    update public.product_reviews set reply = v_text, reply_by = auth.uid(), reply_at = now() where id = p_review;
    if r.status = 'published' then perform public.notify_user(r.user_id, 'review_reply', 'info', 'The store replied to your review', left(v_text, 140), '/product/' || r.product_id || '#reviews'); end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Hiding needs one of the policy reasons. "It is negative" is not one of them. The reviewer is told, and can see why on the product page.
create or replace function public.moderate_review(p_review uuid, p_hide boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.product_reviews%rowtype; v_label text;
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  select * into r from public.product_reviews where id = p_review;
  if not found then raise exception 'Review not found.'; end if;
  if p_hide then
    if p_reason is null or p_reason not in ('spam', 'abusive', 'personal_info', 'not_about_product', 'suspected_fake') then
      raise exception 'Choose a reason. A review can be hidden for spam, abuse, personal information, not being about the product, or being fake. It cannot be hidden for being negative.';
    end if;
    update public.product_reviews set status = 'hidden', hidden_reason = p_reason, hidden_by = auth.uid(), hidden_at = now() where id = p_review;
    update public.review_reports set status = 'actioned' where review_id = p_review and status = 'open';
    v_label := case p_reason when 'spam' then 'it looked like spam' when 'abusive' then 'it contained abusive language' when 'personal_info' then 'it contained personal information'
                             when 'not_about_product' then 'it was not about the product' else 'we could not confirm it was a genuine review' end;
    perform public.notify_user(r.user_id, 'review_hidden', 'warning', 'Your review was removed from the product page', 'We removed it because ' || v_label || '. You can edit it and write it again.', '/product/' || r.product_id || '#reviews');
  else
    update public.product_reviews set status = 'published', hidden_reason = null, hidden_by = null, hidden_at = null where id = p_review;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.dismiss_review_reports(p_review uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Staff only'; end if;
  update public.review_reports set status = 'dismissed' where review_id = p_review and status = 'open';
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================ inviting EVERY buyer to rate, neutrally, once the order is delivered
create or replace function public.trg_order_delivered_invite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    perform public.notify_user(new.user_id, 'review_invite', 'info', 'How did it go?', 'Your order ' || new.code || ' was delivered. You can tell other shoppers what you think of what you received.', '/orders/' || new.code);
  end if;
  return null;
end $$;
drop trigger if exists order_delivered_invite on public.orders;
create trigger order_delivered_invite after update of fulfilment_status on public.orders for each row
  when (new.fulfilment_status = 'delivered' and old.fulfilment_status is distinct from 'delivered') execute function public.trg_order_delivered_invite();

-- ============================================================ which stores a product ships from (names only: never quantities or addresses)
create or replace function public.product_stores(p_product text, p_variant uuid default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) order by s.is_default desc, s.name), '[]'::jsonb)
    from (select w.id, w.name, w.is_default
            from public.warehouses w
           where w.active and w.archived_at is null
             and exists (select 1 from public.warehouse_stock ws
                          where ws.warehouse_id = w.id and ws.product_id = p_product and ws.qty > 0
                            and (p_variant is null or ws.variant_id = p_variant))) s;
$$;

-- ============================================================ who may call what
revoke all on function public.refresh_product_rating(text) from public, anon, authenticated;
revoke all on function public.review_display_name(uuid) from public, anon, authenticated;
revoke all on function public.review_json(public.product_reviews, uuid) from public, anon, authenticated;
revoke all on function public.submit_review(text, int, text, text) from public, anon;
revoke all on function public.delete_my_review(text) from public, anon;
revoke all on function public.vote_review(uuid, boolean) from public, anon;
revoke all on function public.report_review(uuid, text, text) from public, anon;
revoke all on function public.staff_reviews_list(text, int, int) from public, anon;
revoke all on function public.reply_to_review(uuid, text) from public, anon;
revoke all on function public.moderate_review(uuid, boolean, text) from public, anon;
revoke all on function public.dismiss_review_reports(uuid) from public, anon;
grant execute on function public.submit_review(text, int, text, text) to authenticated;
grant execute on function public.delete_my_review(text) to authenticated;
grant execute on function public.vote_review(uuid, boolean) to authenticated;
grant execute on function public.report_review(uuid, text, text) to authenticated;
grant execute on function public.staff_reviews_list(text, int, int) to authenticated;
grant execute on function public.reply_to_review(uuid, text) to authenticated;
grant execute on function public.moderate_review(uuid, boolean, text) to authenticated;
grant execute on function public.dismiss_review_reports(uuid) to authenticated;
grant execute on function public.review_eligibility(text) to anon, authenticated;
grant execute on function public.product_review_summary(text) to anon, authenticated;
grant execute on function public.product_reviews_list(text, text, int, int, int) to anon, authenticated;
grant execute on function public.product_review_highlights(text) to anon, authenticated;
grant execute on function public.my_review(text) to anon, authenticated;
grant execute on function public.product_stores(text, uuid) to anon, authenticated;
