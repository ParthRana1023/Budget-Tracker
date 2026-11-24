-- SaveFirst v3 (2026-11-26): the base currency can change after the first entry. Re-runnable.
--
-- With entries, a new base is saved as pending and switches at the next cycle start (like a
-- payday change), so a cycle never mixes two bases. Every entry records the base it was made in
-- (transactions.base_currency), so older cycles stay as recorded. At the switch,
-- apply_base_switch(rate) turns what was set in the old base (bills, category limits, goal
-- targets) into foreign rows priced at that cycle's rate, and converts the salary, money already
-- saved toward goals and income on hold once. Entries never change.

-- ---------------------------------------------------------------- pending switch
alter table public.user_settings
  add column if not exists currency_next text check (currency_next is null or public.is_supported_currency(currency_next)),
  add column if not exists currency_from date;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_currency_next_check') then
    alter table public.user_settings add constraint user_settings_currency_next_check
      check ((currency_next is null) = (currency_from is null));
  end if;
end;
$$;

-- ---------------------------------------------------------------- plan history: currency rows
alter table public.plan_changes
  add column if not exists from_text text,
  add column if not exists to_text text;
alter table public.plan_changes alter column to_value drop not null;
alter table public.plan_changes drop constraint if exists plan_changes_field_check;
alter table public.plan_changes add constraint plan_changes_field_check
  check (field in ('salary', 'payday', 'save_pct', 'currency'));
alter table public.plan_changes drop constraint if exists plan_changes_value_check;
alter table public.plan_changes add constraint plan_changes_value_check check (
  (field = 'salary' and to_value >= 0)
  or (field = 'payday' and (to_value between 1 and 28 or to_value = 31))
  or (field = 'save_pct' and to_value between 0 and 100)
  or (field = 'currency' and public.is_supported_currency(to_text) and from_text is not null));

-- ---------------------------------------------------------------- each entry's base
alter table public.transactions add column if not exists base_currency text;
update public.transactions t set base_currency = s.currency
  from public.user_settings s where s.user_id = t.user_id and t.base_currency is null;
alter table public.transactions alter column base_currency set not null;

-- The base in effect on the day an entry counts (counts_from for early income, else its date).
create or replace function public.stamp_base_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
begin
  select currency, currency_next, currency_from into s from user_settings where user_id = new.user_id;
  if not found then return new; end if;
  new.base_currency := case
    when s.currency_next is not null and coalesce(new.counts_from, new.date) >= s.currency_from then s.currency_next
    else s.currency end;
  return new;
end;
$$;
drop trigger if exists transactions_stamp_base_currency on public.transactions;
create trigger transactions_stamp_base_currency before insert or update of date, counts_from on public.transactions
  for each row execute procedure public.stamp_base_currency();

-- ---------------------------------------------------------------- choosing a new base
-- No entries: applies now, as before (amounts keep their typed value). With entries: saved as
-- pending from p_from (the next cycle start, worked out by the app); the current base again
-- cancels a pending switch; a new p_from moves it (a payday change moved the next cycle).
drop function if exists public.set_base_currency(text);
create or replace function public.set_base_currency(p_currency text, p_from date default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old text;
  v_next text;
  f numeric;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not is_supported_currency(p_currency) then raise exception 'Unsupported currency'; end if;
  select currency, currency_next into v_old, v_next from user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;

  if exists (select 1 from transactions where user_id = v_user) then
    if p_currency = v_old then
      -- Keep the current base: drop a pending switch and its history row.
      if v_next is not null then
        update user_settings set currency_next = null, currency_from = null, updated_at = now() where user_id = v_user;
        update plan_changes set superseded_at = now()
         where user_id = v_user and field = 'currency' and superseded_at is null and effective_from > current_date;
      end if;
      return;
    end if;
    if p_from is null then raise exception 'Choose when the new base currency starts'; end if;
    if p_from <= current_date or p_from > current_date + 62 then
      raise exception 'A new base currency starts with the next cycle';
    end if;
    update plan_changes set superseded_at = now()
     where user_id = v_user and field = 'currency' and superseded_at is null and effective_from > current_date;
    insert into plan_changes (user_id, field, from_text, to_text, applies, effective_from)
    values (v_user, 'currency', v_old, p_currency, 'next', p_from);
    update user_settings set currency_next = p_currency, currency_from = p_from, updated_at = now() where user_id = v_user;
    return;
  end if;

  if v_old = p_currency then return; end if;
  f := power(10::numeric, currency_digits(p_currency) - currency_digits(v_old));
  if f <> 1 then
    update user_settings set take_home_pay = round(take_home_pay * f) where user_id = v_user;
    update categories set monthly_limit = round(monthly_limit * f) where user_id = v_user;
    update income_sources set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update savings_goals set target_amount = greatest(1, round(target_amount * f)), saved_before = round(saved_before * f)
     where user_id = v_user;
    update goal_contributions set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update recurring_items set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update plan_changes set from_value = round(from_value * f), to_value = round(to_value * f)
     where user_id = v_user and field = 'salary';
  end if;
  update recurring_items set amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update categories set monthly_limit = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update savings_goals set target_amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update recurring_items set fx_date = null where user_id = v_user and original_currency is not null;
  update categories set fx_date = null where user_id = v_user and original_currency is not null;
  update savings_goals set fx_date = null where user_id = v_user and original_currency is not null;

  perform set_config('savefirst.set_base_currency', 'on', true);
  update user_settings set currency = p_currency, currency_next = null, currency_from = null, updated_at = now()
   where user_id = v_user;
  perform set_config('savefirst.set_base_currency', 'off', true);
end;
$$;
grant execute on function public.set_base_currency(text, date) to authenticated;

-- ---------------------------------------------------------------- the switch
-- Runs once the new cycle has started (the app calls it with that cycle's rate: units of the new
-- base for 1 of the old). Returns false when there's nothing to do (idempotent).
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

  -- Converted once: money already saved, income on hold, the salary (with a history row).
  update savings_goals set saved_before = round(saved_before * f) where user_id = v_user;
  update income_sources set amount = greatest(1, round(amount * f)) where user_id = v_user and status = 'expected';
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

-- ---------------------------------------------------------------- plan Undo
-- Same as settings_v2, but only plan edits (salary, payday, save first) are undone: a currency
-- row, and the salary row a base switch writes, carry from_text and are never "undone".
create or replace function public.undo_plan_change()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_at timestamptz;
  r record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  perform 1 from public.user_settings where user_id = v_user for update;
  select max(created_at) into v_at from public.plan_changes
   where user_id = v_user and applies <> 'start' and from_text is null;
  if v_at is null or v_at < now() - interval '15 minutes' then raise exception 'Nothing to undo'; end if;

  for r in select field, from_value from public.plan_changes
            where user_id = v_user and created_at = v_at and applies <> 'start' and from_text is null
  loop
    update public.user_settings
       set take_home_pay = case when r.field = 'salary' then r.from_value else take_home_pay end,
           month_start_day = case when r.field = 'payday' then r.from_value::smallint else month_start_day end,
           savings_pct = case when r.field = 'save_pct' then r.from_value::smallint else savings_pct end,
           updated_at = now()
     where user_id = v_user;
  end loop;
  update public.plan_changes set superseded_at = null
   where user_id = v_user and superseded_at = v_at and from_text is null;
  delete from public.plan_changes
   where user_id = v_user and created_at = v_at and applies <> 'start' and from_text is null;
end;
$$;
grant execute on function public.undo_plan_change() to authenticated;
