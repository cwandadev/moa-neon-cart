-- 000017: show the support agent's first name in the chat.
-- The name is saved on each staff reply by the database itself (from the agent's profile), so it cannot be faked from the browser,
-- and customers never need access to staff profiles. Older replies are filled in too.
begin;

alter table public.messages add column if not exists sender_name text;

create or replace function public.messages_set_sender_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender_role = 'staff' then
    -- A signed-in agent can only write as themselves.
    if auth.uid() is not null then
      new.sender_id := auth.uid();
    end if;
    select nullif(split_part(trim(coalesce(p.first_name, '')), ' ', 1), '')
      into new.sender_name
      from public.profiles p
     where p.id = new.sender_id;
  else
    new.sender_name := null;
  end if;
  return new;
end $$;

drop trigger if exists messages_sender_name on public.messages;
create trigger messages_sender_name
  before insert on public.messages
  for each row execute function public.messages_set_sender_name();

-- Older staff replies get the agent's current first name.
update public.messages m
   set sender_name = nullif(split_part(trim(coalesce(p.first_name, '')), ' ', 1), '')
  from public.profiles p
 where m.sender_role = 'staff' and m.sender_id = p.id and m.sender_name is null;

commit;
