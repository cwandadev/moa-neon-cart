-- Someone who works at the shop and also places an order (testing it, or buying something) used to get TWO notifications for every step of it:
-- the customer one ("Order MOA-4906 received") and the staff one ("New order MOA-4906"). That doubled their list and their popups.
--
-- A staff alert about an order is no longer sent to the person who placed that order: they already hear about it as the customer.
-- Everyone else on the team still gets it. The order is found from its number, which every staff alert about an order ends its title with
-- (New order MOA-1, Payment received: MOA-1, Payment failed: MOA-1, Refund completed: MOA-1, Refund failed: MOA-1).
-- Alerts with no order number in the title (stock, chats, deliveries without one) are unchanged.
--
-- Safe to run more than once. Run it in the Supabase SQL editor.

create or replace function public.notify_staff(p_kind text, p_severity text, p_title text, p_body text, p_link text, p_admins_only boolean default false)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, kind, severity, title, body, link)
  select p.id, p_kind, p_severity, p_title, coalesce(p_body, ''), p_link
  from public.profiles p
  where (p.role = 'admin' or (not p_admins_only and p.role = 'staff'))
    and not exists (
      select 1 from public.orders o
      where o.user_id = p.id
        and o.code = substring(p_title from '[A-Z][A-Z0-9]*-[0-9]+')
    );
$$;
