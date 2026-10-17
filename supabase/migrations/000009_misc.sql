-- 000009: saved delivery address, last-admin guard, honest product text.
alter table public.profiles add column if not exists default_location text;

-- The database itself refuses to leave the shop without an admin.
create or replace function public.guard_last_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin'
       and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
      raise exception 'The last admin cannot be removed';
    end if;
    return old;
  end if;
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'The last admin cannot be demoted';
  end if;
  return new;
end $$;

drop trigger if exists guard_last_admin_upd on public.profiles;
create trigger guard_last_admin_upd before update of role on public.profiles
  for each row execute function public.guard_last_admin();

drop trigger if exists guard_last_admin_del on public.profiles;
create trigger guard_last_admin_del before delete on public.profiles
  for each row execute function public.guard_last_admin();

-- Remove promises nobody has confirmed (returns, replacement, cash on delivery).
update public.products set
  highlights = array(
    select h from unnest(highlights) h
    where h not ilike '%free returns%' and h not ilike '%cash on delivery%' and h not ilike '%replacement%'
  )
where exists (select 1 from unnest(highlights) h
              where h ilike '%free returns%' or h ilike '%cash on delivery%' or h ilike '%replacement%');

-- Plain, honest text for products that still carry the seeded template copy.
update public.products p set
  blurb = p.name || ' from our ' || c.name || ' collection.',
  description = p.name || ' is part of the MOA Mart ' || lower(c.name) || ' collection. Message us in the chat if you would like to know more about this item before you order.',
  shipping = 'Delivery details are confirmed with you after you place your order.',
  care = 'Check the product label for care instructions, or ask us in the chat.',
  specs = (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(p.specs) e where e->>'label' in ('SKU', 'Category')),
  reference_links = '[]'::jsonb
from public.categories c
where c.id = p.category_id
  and p.description like '% is part of the MOA Mart curated%';
