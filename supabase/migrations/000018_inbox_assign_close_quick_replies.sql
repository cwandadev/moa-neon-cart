-- 000018: Inbox. Chats can be assigned and closed, the one who has waited longest comes first, and replies can be saved.
-- Safe to run more than once.

-- 1. New columns on conversations ----------------------------------------------------------------
alter table public.conversations
  add column if not exists status text not null default 'open',
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists closed_at timestamptz,
  add column if not exists needs_reply boolean not null default false,
  add column if not exists waiting_since timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'conversations_status_check') then
    alter table public.conversations
      add constraint conversations_status_check check (status in ('open', 'closed'));
  end if;
end $$;

create index if not exists conversations_inbox_idx on public.conversations (status, needs_reply, waiting_since);
create index if not exists conversations_assigned_idx on public.conversations (assigned_to) where assigned_to is not null;

-- 2. Who is waiting, for the chats that exist today (only chats whose last message is from the customer) --
with last as (
  select distinct on (conversation_id) conversation_id, sender_role
  from public.messages
  where sender_role in ('client', 'staff')
  order by conversation_id, created_at desc
), last_staff as (
  select conversation_id, max(created_at) as at
  from public.messages
  where sender_role = 'staff'
  group by conversation_id
), first_unanswered as (
  select m.conversation_id, min(m.created_at) as at
  from public.messages m
  left join last_staff s on s.conversation_id = m.conversation_id
  where m.sender_role = 'client' and (s.at is null or m.created_at > s.at)
  group by m.conversation_id
)
update public.conversations c
set needs_reply = true, waiting_since = f.at
from last l
join first_unanswered f on f.conversation_id = l.conversation_id
where c.id = l.conversation_id
  and l.sender_role = 'client'
  and not c.needs_reply
  and c.waiting_since is null;

-- 3. A customer must not be able to change the status or the assignment of their own chat ------------
create or replace function public.chat_guard_staff_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.chat_system', true), '') = 'on' then
    return new;
  end if;
  if public.is_staff() then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.assigned_to is distinct from old.assigned_to
     or new.closed_at is distinct from old.closed_at
     or new.needs_reply is distinct from old.needs_reply
     or new.waiting_since is distinct from old.waiting_since then
    raise exception 'Only staff can change the status or the assignment of a chat';
  end if;
  return new;
end $$;

drop trigger if exists chat_guard_staff_columns_upd on public.conversations;
create trigger chat_guard_staff_columns_upd
  before update on public.conversations
  for each row execute function public.chat_guard_staff_columns();

-- 4. Every message keeps the chat up to date -------------------------------------------------------
--    customer writes: waiting (since the first unanswered message), and the chat is open again
--    staff replies:   nobody is waiting, the chat is open, and it belongs to the first person who answered
create or replace function public.chat_track_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.chat_system', 'on', true);
  if new.sender_role = 'client' then
    update public.conversations
       set needs_reply = true,
           waiting_since = case when needs_reply and waiting_since is not null then waiting_since else new.created_at end,
           status = 'open',
           closed_at = null
     where id = new.conversation_id;
  elsif new.sender_role = 'staff' then
    update public.conversations
       set needs_reply = false,
           waiting_since = null,
           assigned_to = coalesce(assigned_to, new.sender_id),
           status = 'open',
           closed_at = null
     where id = new.conversation_id;
  end if;
  perform set_config('app.chat_system', 'off', true);
  return new;
end $$;

drop trigger if exists chat_track_message_ins on public.messages;
create trigger chat_track_message_ins
  after insert on public.messages
  for each row execute function public.chat_track_message();

-- 5. Saved replies: staff can use them, admins manage them ------------------------------------------
create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 60),
  body text not null check (length(trim(body)) between 1 and 1000),
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.quick_replies enable row level security;

drop policy if exists quick_replies_select on public.quick_replies;
create policy quick_replies_select on public.quick_replies
  for select to authenticated using (public.is_staff());

drop policy if exists quick_replies_write on public.quick_replies;
create policy quick_replies_write on public.quick_replies
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.quick_replies from anon;
grant select, insert, update, delete on public.quick_replies to authenticated;

insert into public.quick_replies (title, body, position)
select v.title, v.body, v.position
from (values
  ('Greeting', 'Hello! Thanks for contacting MOA Mart. How can I help you today?', 1),
  ('Order received', 'Thank you for your order. We will confirm it as soon as your payment arrives, and we will keep you updated.', 2),
  ('Payment help', 'To pay, approve the request that appears on your phone (MTN MoMo or Airtel Money). It stays open for 15 minutes. If it fails, you can try again from My orders.', 3),
  ('Delivery', 'We deliver in Kigali. We confirm the delivery cost and time after you place your order, and we will call you if we need directions.', 4),
  ('Wrong or damaged item', 'We are sorry about that. Please send your order number and a photo of the item, and we will replace it or refund you.', 5),
  ('Anything else?', 'Is there anything else I can help you with? If not, I will close this chat. You can write to us again at any time.', 6)
) as v(title, body, position)
where not exists (select 1 from public.quick_replies);
