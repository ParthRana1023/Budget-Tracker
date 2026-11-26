-- SaveFirst v4 (2026-11-27): credit card tracker, one or more cards. Re-runnable.
--
-- Card spend still counts against safe to spend on the day it happens. The tracker only shows
-- what is owed on each card (lib/cards.mjs). Marking a bill paid is a card_payment entry, a
-- transfer like reserve_transfer: never spending, never in a category, never touching safe to
-- spend. Removing a card archives it: its entries stay in history but it's no longer tracked.
-- (Rewritten 2026-11-26 for handoff v4: the earlier single-card user_settings columns and
-- set_card_tracker are dropped below, for databases that ran the first version.)

-- ---------------------------------------------------------------- cards
-- Statement and due days are days of the month: 1-28, or 31 for the month's last day.
-- opening_balance: owed before the user started logging, in minor units of the base currency.
-- No delete policy: the app archives a card (archived_at) so its history keeps pointing at it.
create table if not exists public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (name = btrim(name) and char_length(name) between 1 and 40),
  statement_day smallint not null check (statement_day between 1 and 28 or statement_day = 31),
  due_day smallint not null check (due_day between 1 and 28 or due_day = 31),
  opening_balance bigint not null default 0 check (opening_balance >= 0),
  reminders boolean not null default true,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
-- Names are unique among a user's cards in use (an archived name can be used again).
create unique index if not exists credit_cards_user_name_key
  on public.credit_cards (user_id, lower(name)) where archived_at is null;
alter table public.credit_cards enable row level security;
drop policy if exists "Users can view their own cards" on public.credit_cards;
create policy "Users can view their own cards" on public.credit_cards for select using (auth.uid() = user_id);
drop policy if exists "Users can add their own cards" on public.credit_cards;
create policy "Users can add their own cards" on public.credit_cards for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update their own cards" on public.credit_cards;
create policy "Users can update their own cards" on public.credit_cards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------- card on entries
alter table public.transactions add column if not exists card_id uuid references public.credit_cards(id);
alter table public.recurring_items add column if not exists card_id uuid references public.credit_cards(id);
create index if not exists idx_transactions_card on public.transactions (card_id) where card_id is not null;

-- ---------------------------------------------------------------- earlier single-card version
-- A database that ran the first version keeps its data: the single card in user_settings becomes
-- a "Credit card" row, and its card spend (from card_tracking_since) and card payments are tagged
-- with it. The old columns are read only while they exist, so a re-run skips that part. Any card
-- payment still without a card (no tracker was set) gets a "Credit card" on the 1st / 18th, to
-- edit later, so the card_payment check below always holds.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'user_settings' and column_name = 'card_statement_day') then
    insert into public.credit_cards (user_id, name, statement_day, due_day, opening_balance, reminders)
    select s.user_id, 'Credit card',
           case when s.card_statement_day > 28 then 31 else s.card_statement_day end,
           case when s.card_due_day > 28 then 31 else s.card_due_day end,
           s.card_opening_balance, s.card_remind_days is not null
      from public.user_settings s
     where s.card_statement_day is not null
       and not exists (select 1 from public.credit_cards c where c.user_id = s.user_id);
    update public.transactions t
       set card_id = c.id
      from public.credit_cards c, public.user_settings s
     where c.user_id = t.user_id and s.user_id = t.user_id and c.archived_at is null and t.card_id is null
       and s.card_tracking_since is not null
       and (t.type = 'card_payment'
            or (t.type = 'expense' and t.payment_method = 'credit_card' and t.date >= s.card_tracking_since));
  end if;
end;
$$;
insert into public.credit_cards (user_id, name, statement_day, due_day)
select distinct t.user_id, 'Credit card', 1::smallint, 18::smallint
  from public.transactions t
 where t.type = 'card_payment' and t.card_id is null
   and not exists (select 1 from public.credit_cards c where c.user_id = t.user_id and c.archived_at is null);
update public.transactions t
   set card_id = (select c.id from public.credit_cards c
                   where c.user_id = t.user_id and c.archived_at is null
                   order by c.created_at limit 1)
 where t.type = 'card_payment' and t.card_id is null;

alter table public.user_settings drop constraint if exists user_settings_card_check;
alter table public.user_settings
  drop column if exists card_statement_day,
  drop column if exists card_due_day,
  drop column if exists card_tracking_since,
  drop column if exists card_opening_balance,
  drop column if exists card_remind_days;
drop function if exists public.set_card_tracker(smallint, smallint, date, bigint, smallint);

alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('expense', 'income', 'savings_transfer', 'reserve_transfer', 'card_payment'));
alter table public.transactions drop constraint if exists transactions_card_payment_check;
alter table public.transactions add constraint transactions_card_payment_check
  check (type <> 'card_payment' or (amount > 0 and category_id is null and payment_method is null and card_id is not null));
-- A card only on credit-card spend and card payments.
alter table public.transactions drop constraint if exists transactions_card_check;
alter table public.transactions add constraint transactions_card_check
  check (card_id is null or type = 'card_payment' or (type = 'expense' and payment_method = 'credit_card'));
alter table public.recurring_items drop constraint if exists recurring_items_card_check;
alter table public.recurring_items add constraint recurring_items_card_check
  check (card_id is null or (type = 'expense' and payment_method = 'credit_card'));

-- Picks the card when none is given and the user has exactly one in use (Log expense hides
-- "Which card" then; imports and posted recurring items get it too). Drops the card when an
-- entry stops being credit-card spend. Refuses another user's card, and a card payment with no
-- card. Named so it runs after transactions_default_payment_method (BEFORE triggers run in name
-- order), which fills a posted recurring entry's method and card first.
create or replace function public.set_entry_card()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_only uuid;
begin
  if new.type = 'card_payment' or (new.type = 'expense' and new.payment_method = 'credit_card') then
    if new.card_id is null then
      select min(c.id::text)::uuid into v_only from credit_cards c
       where c.user_id = new.user_id and c.archived_at is null
      having count(*) = 1;
      new.card_id := v_only;
    elsif not exists (select 1 from credit_cards c where c.id = new.card_id and c.user_id = new.user_id) then
      raise exception 'Unknown card';
    end if;
    if new.type = 'card_payment' and new.card_id is null then
      raise exception 'Choose which card this bill was for';
    end if;
  else
    new.card_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_set_card on public.transactions;
create trigger transactions_set_card before insert or update of type, payment_method, card_id on public.transactions
  for each row execute procedure public.set_entry_card();
drop trigger if exists recurring_items_set_card on public.recurring_items;
create trigger recurring_items_set_card before insert or update of type, payment_method, card_id on public.recurring_items
  for each row execute procedure public.set_entry_card();

-- Same as 20261125000000_multicurrency, plus: a posted recurring entry also takes the item's card.
create or replace function public.default_payment_method()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item record;
begin
  if new.external_id ~ '^recurring:[0-9a-f-]{36}:' then
    select r.payment_method, r.card_id, r.amount, r.original_amount, r.original_currency, r.fx_rate, r.fx_date into item
      from recurring_items r
     where r.id = split_part(new.external_id, ':', 2)::uuid and r.user_id = new.user_id;
    if found then
      if new.payment_method is null then new.payment_method := item.payment_method; end if;
      if new.card_id is null and new.payment_method is not distinct from item.payment_method then
        new.card_id := item.card_id;
      end if;
      if new.original_currency is null and item.original_currency is not null and new.amount = item.amount then
        new.original_amount := item.original_amount;
        new.original_currency := item.original_currency;
        new.fx_rate := item.fx_rate;
        new.fx_date := item.fx_date;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- card bill push
-- Settings › Notifications › Card bills (push only): 3 days before and on each card's due day.
alter table public.user_settings add column if not exists push_cards boolean not null default true;

-- Same as 20261123000000_push_notifications, plus push_cards.
create or replace function public.update_preferences(p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(p_changes->>'display_name'), '');
  v_key text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to save'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
              where k not in ('theme', 'display_name', 'avatar_url', 'number_format', 'week_start',
                              'notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary',
                              'push_bills', 'push_weekly', 'push_cards',
                              'bill_reminder_days', 'quiet_hours_on', 'quiet_from', 'quiet_to', 'timezone')) then
    raise exception 'Unknown setting';
  end if;
  if p_changes ? 'theme' and p_changes->>'theme' is not null and p_changes->>'theme' not in ('dark', 'light', 'system') then
    raise exception 'Theme must be dark, light or system';
  end if;
  if char_length(v_name) > 80 then raise exception 'Name must be 80 characters or fewer'; end if;
  if p_changes ? 'number_format' and coalesce(p_changes->>'number_format', '') not in ('indian', 'international', 'european') then
    raise exception 'Number format must be indian, international or european';
  end if;
  if p_changes ? 'week_start' and coalesce(p_changes->>'week_start', '') not in ('0', '1') then
    raise exception 'Week start must be Sunday (0) or Monday (1)';
  end if;
  if char_length(p_changes->>'avatar_url') > 500 then raise exception 'Photo link is too long'; end if;
  foreach v_key in array array['notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary',
                               'push_bills', 'push_weekly', 'push_cards', 'quiet_hours_on'] loop
    if p_changes ? v_key and jsonb_typeof(p_changes->v_key) <> 'boolean' then raise exception 'Choose on or off'; end if;
  end loop;
  if p_changes ? 'bill_reminder_days' and coalesce(p_changes->>'bill_reminder_days', '') not in ('1', '3', '7') then
    raise exception 'Bill reminders are 1, 3 or 7 days before';
  end if;
  foreach v_key in array array['quiet_from', 'quiet_to'] loop
    if p_changes ? v_key and coalesce(p_changes->>v_key, '') !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception 'Quiet hours must be whole hours';
    end if;
  end loop;
  if p_changes ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p_changes->>'timezone') then
    raise exception 'Unknown time zone';
  end if;

  update public.user_settings
     set theme = case when p_changes ? 'theme' then p_changes->>'theme' else theme end,
         display_name = case when p_changes ? 'display_name' then v_name else display_name end,
         avatar_url = case when p_changes ? 'avatar_url' then nullif(p_changes->>'avatar_url', '') else avatar_url end,
         number_format = case when p_changes ? 'number_format' then p_changes->>'number_format' else number_format end,
         week_start = case when p_changes ? 'week_start' then (p_changes->>'week_start')::smallint else week_start end,
         notify_due = coalesce((p_changes->>'notify_due')::boolean, notify_due),
         notify_warn = coalesce((p_changes->>'notify_warn')::boolean, notify_warn),
         notify_over = coalesce((p_changes->>'notify_over')::boolean, notify_over),
         email_notifications = coalesce((p_changes->>'email_notifications')::boolean, email_notifications),
         weekly_summary = coalesce((p_changes->>'weekly_summary')::boolean, weekly_summary),
         push_bills = coalesce((p_changes->>'push_bills')::boolean, push_bills),
         push_weekly = coalesce((p_changes->>'push_weekly')::boolean, push_weekly),
         push_cards = coalesce((p_changes->>'push_cards')::boolean, push_cards),
         bill_reminder_days = coalesce((p_changes->>'bill_reminder_days')::smallint, bill_reminder_days),
         quiet_hours_on = coalesce((p_changes->>'quiet_hours_on')::boolean, quiet_hours_on),
         quiet_from = coalesce((p_changes->>'quiet_from')::smallint, quiet_from),
         quiet_to = coalesce((p_changes->>'quiet_to')::smallint, quiet_to),
         timezone = coalesce(p_changes->>'timezone', timezone),
         updated_at = now()
   where user_id = v_user;
  if not found then raise exception 'Settings not found'; end if;
end;
$$;
grant execute on function public.update_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------- data download
-- Same as 20261125000000_multicurrency, plus the cards (entries already carry card_id).
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'amountsIn', 'minor units', -- of `currency`: paise for INR, cents for USD, whole yen for JPY
    'currency', (select s.currency from user_settings s where s.user_id = v_user),
    'profile', (select jsonb_build_object('email', auth.jwt()->>'email', 'name', s.display_name,
                       'photo', s.avatar_url, 'memberSince', s.created_at)
                  from user_settings s where s.user_id = v_user),
    'plan', (select jsonb_build_object('salary', s.take_home_pay, 'payday', s.month_start_day,
                    'saveFirstPct', s.savings_pct)
               from user_settings s where s.user_id = v_user),
    'planHistory', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' - 'id' order by p.created_at)
                               from plan_changes p where p.user_id = v_user), '[]'),
    'preferences', (select to_jsonb(s) - 'user_id' - 'take_home_pay' - 'month_start_day' - 'savings_pct'
                              - 'display_name' - 'avatar_url'
                      from user_settings s where s.user_id = v_user),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.name)
                              from categories c where c.user_id = v_user), '[]'),
    'cards', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.created_at)
                         from credit_cards c where c.user_id = v_user), '[]'),
    'entries', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.date, t.created_at)
                           from transactions t where t.user_id = v_user), '[]'),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at)
                             from recurring_items r where r.user_id = v_user), '[]'),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id' order by g.created_at)
                         from savings_goals g where g.user_id = v_user), '[]'),
    'goalContributions', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.date)
                                     from goal_contributions c where c.user_id = v_user), '[]'),
    'incomeOnHold', coalesce((select jsonb_agg(to_jsonb(i) - 'user_id' order by i.created_at)
                                from income_sources i where i.user_id = v_user and i.status = 'expected'), '[]')
  );
end;
$$;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------- CSV import
-- Same as 20261124000000_payment_methods, plus card_payment rows (a bank statement's card bill
-- line). A card payment has no category and no payment method; set_entry_card gives it (and
-- card spend) the user's card when there is only one, and refuses a card payment otherwise.
create or replace function public.import_transactions(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r jsonb;
  v_date date;
  v_type text;
  v_amount bigint;
  v_note text;
  v_cat uuid;
  v_method text;
  v_added int := 0;
  v_dupes int := 0;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import';
  end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 entries at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_type := r->>'type';
    if v_type is null or v_type not in ('expense', 'income', 'card_payment') then
      raise exception 'Only expenses, income and card payments can be imported';
    end if;
    begin
      v_date := (r->>'date')::date;
      v_amount := (r->>'amount')::bigint;
    exception when others then
      raise exception 'Every entry needs a date and an amount';
    end;
    if v_date is null or v_amount is null or v_amount <= 0 then raise exception 'Every entry needs a date and an amount'; end if;
    v_note := nullif(left(btrim(r->>'note'), 500), '');
    v_method := case when v_type = 'expense' then nullif(btrim(r->>'payment_method'), '') end;
    if v_method is not null and v_method not in ('upi', 'debit_card', 'credit_card', 'cash', 'other') then
      raise exception 'Unknown payment method %', v_method;
    end if;
    v_cat := null;
    if v_type = 'expense' and nullif(btrim(r->>'category'), '') is not null then
      select id into v_cat from categories
       where user_id = v_user and lower(name) = lower(btrim(r->>'category'))
       order by is_active desc limit 1;
      if v_cat is null then raise exception 'No category called %', btrim(r->>'category'); end if;
    end if;

    if exists (select 1 from transactions t
                where t.user_id = v_user and t.date = v_date and t.type = v_type and t.amount = v_amount
                  and t.category_id is not distinct from v_cat and coalesce(t.note, '') = coalesce(v_note, '')) then
      v_dupes := v_dupes + 1;
    else
      insert into transactions (user_id, category_id, amount, type, date, note, source, payment_method)
      values (v_user, v_cat, v_amount, v_type, v_date, v_note, 'import', v_method);
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'duplicates', v_dupes);
end;
$$;
grant execute on function public.import_transactions(jsonb) to authenticated;

-- ---------------------------------------------------------------- base switch
-- Same as 20261126000000_base_currency_switch, plus each card's opening balance, converted once
-- like money already saved. Card entries keep their own base_currency, as every entry does.
create or replace function public.apply_base_switch(p_rate numeric)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  s record;
  f numeric;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  select currency, currency_next, currency_from, take_home_pay into s from user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;
  if s.currency_next is null then return false; end if;
  -- One day of slack: the app follows the user's local date, the database UTC.
  if s.currency_from > current_date + 1 then raise exception 'The new base currency starts on %', s.currency_from; end if;
  if p_rate is null or p_rate <= 0 then raise exception 'Enter the exchange rate'; end if;

  -- old minor units -> new minor units at the rate
  f := p_rate * power(10::numeric, currency_digits(s.currency_next) - currency_digits(s.currency));

  -- Set in the old base: now foreign rows in it, priced for this cycle. (0 = "no limit" stays 0.)
  update recurring_items set original_amount = amount, original_currency = s.currency, fx_rate = p_rate,
         fx_date = s.currency_from, amount = greatest(1, round(amount * f))
   where user_id = v_user and original_currency is null;
  update categories set original_amount = monthly_limit, original_currency = s.currency, fx_rate = p_rate,
         fx_date = s.currency_from, monthly_limit = round(monthly_limit * f)
   where user_id = v_user and original_currency is null and monthly_limit > 0;
  update savings_goals set original_amount = target_amount, original_currency = s.currency, fx_rate = p_rate,
         fx_date = s.currency_from, target_amount = greatest(1, round(target_amount * f))
   where user_id = v_user and original_currency is null;
  -- Set in the new base: plain again.
  update recurring_items set amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = s.currency_next;
  update categories set monthly_limit = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = s.currency_next;
  update savings_goals set target_amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = s.currency_next;
  -- In a third currency: re-priced against the new base on the next Dashboard load.
  update recurring_items set fx_date = null
   where user_id = v_user and original_currency is not null and original_currency not in (s.currency, s.currency_next);
  update categories set fx_date = null
   where user_id = v_user and original_currency is not null and original_currency not in (s.currency, s.currency_next);
  update savings_goals set fx_date = null
   where user_id = v_user and original_currency is not null and original_currency not in (s.currency, s.currency_next);

  -- Converted once: money already saved, income on hold, card opening balances, the salary
  -- (with a history row).
  update savings_goals set saved_before = round(saved_before * f) where user_id = v_user;
  update income_sources set amount = greatest(1, round(amount * f)) where user_id = v_user and status = 'expected';
  update credit_cards set opening_balance = round(opening_balance * f)
   where user_id = v_user and opening_balance > 0;
  if s.take_home_pay is not null then
    update user_settings set take_home_pay = round(take_home_pay * f) where user_id = v_user;
    update plan_changes set superseded_at = now()
     where user_id = v_user and field = 'salary' and applies <> 'start' and superseded_at is null
       and effective_from >= s.currency_from;
    insert into plan_changes (user_id, field, from_value, to_value, from_text, to_text, applies, effective_from)
    values (v_user, 'salary', s.take_home_pay, round(s.take_home_pay * f), s.currency, s.currency_next, 'now', s.currency_from);
  end if;

  perform set_config('savefirst.set_base_currency', 'on', true);
  update user_settings set currency = s.currency_next, currency_next = null, currency_from = null, updated_at = now()
   where user_id = v_user;
  perform set_config('savefirst.set_base_currency', 'off', true);
  return true;
end;
$$;
grant execute on function public.apply_base_switch(numeric) to authenticated;
