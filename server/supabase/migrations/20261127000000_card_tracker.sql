-- SaveFirst v4 (2026-11-27): credit card tracker. Re-runnable.
--
-- Card spend still counts against safe to spend on the day it happens. The tracker only shows
-- what is owed on the card: this statement, next statement and the total. Paying the card bill
-- is a card_payment entry, a transfer like reserve_transfer: never spending, never in a
-- category, never touching safe to spend. One combined card for now.

-- ---------------------------------------------------------------- card_payment entries
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('expense', 'income', 'savings_transfer', 'reserve_transfer', 'card_payment'));
alter table public.transactions drop constraint if exists transactions_card_payment_check;
alter table public.transactions add constraint transactions_card_payment_check
  check (type <> 'card_payment' or (amount > 0 and category_id is null and payment_method is null));

-- ---------------------------------------------------------------- card settings
-- Statement and due days are days of the month (a short month uses its last day). Tracking
-- starts on card_tracking_since, so card entries from before it are not counted as owed;
-- card_opening_balance is what was owed on that day, in the base currency. Statement day, due
-- day and tracking date are set together, or none (tracker off). card_remind_days: push this
-- many days before the due day, null = no reminder.
alter table public.user_settings
  add column if not exists card_statement_day smallint check (card_statement_day between 1 and 31),
  add column if not exists card_due_day smallint check (card_due_day between 1 and 31),
  add column if not exists card_tracking_since date,
  add column if not exists card_opening_balance bigint not null default 0 check (card_opening_balance >= 0),
  add column if not exists card_remind_days smallint check (card_remind_days between 1 and 10);
alter table public.user_settings drop constraint if exists user_settings_card_check;
alter table public.user_settings add constraint user_settings_card_check
  check ((card_statement_day is null) = (card_due_day is null)
     and (card_statement_day is null) = (card_tracking_since is null)
     and (card_remind_days is null or card_statement_day is not null));

-- Settings › Credit card save. p_statement_day null turns the tracker off (clears everything).
-- The opening balance is in minor units of the base currency.
create or replace function public.set_card_tracker(
  p_statement_day smallint,
  p_due_day smallint default null,
  p_tracking_since date default null,
  p_opening_balance bigint default 0,
  p_remind_days smallint default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_statement_day is not null then
    if p_statement_day not between 1 and 31 then raise exception 'Statement day must be between 1 and 31'; end if;
    if p_due_day is null or p_due_day not between 1 and 31 then raise exception 'Due day must be between 1 and 31'; end if;
    if p_tracking_since is null then raise exception 'Choose the date to track card spend from'; end if;
    -- current_date is UTC: one day of slack for the user's own today.
    if p_tracking_since > current_date + 1 then raise exception 'Tracking can''t start in the future'; end if;
    if coalesce(p_opening_balance, 0) < 0 then raise exception 'Opening balance must be zero or more'; end if;
    if p_remind_days is not null and p_remind_days not between 1 and 10 then
      raise exception 'Reminders are 1 to 10 days before the due day';
    end if;
  end if;

  update public.user_settings
     set card_statement_day = p_statement_day,
         card_due_day = case when p_statement_day is not null then p_due_day end,
         card_tracking_since = case when p_statement_day is not null then p_tracking_since end,
         card_opening_balance = case when p_statement_day is not null then coalesce(p_opening_balance, 0) else 0 end,
         card_remind_days = case when p_statement_day is not null then p_remind_days end,
         updated_at = now()
   where user_id = auth.uid();
  if not found then raise exception 'Settings not found'; end if;
end;
$$;
grant execute on function public.set_card_tracker(smallint, smallint, date, bigint, smallint) to authenticated;

-- ---------------------------------------------------------------- CSV import
-- Same as 20261124000000_payment_methods, plus card_payment rows (a bank statement's card bill
-- line). A card payment has no category and no payment method.
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
-- Same as 20261126000000_base_currency_switch, plus the card opening balance, converted once
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

  -- Converted once: money already saved, income on hold, the card opening balance, the salary
  -- (with a history row).
  update savings_goals set saved_before = round(saved_before * f) where user_id = v_user;
  update income_sources set amount = greatest(1, round(amount * f)) where user_id = v_user and status = 'expected';
  update user_settings set card_opening_balance = round(card_opening_balance * f)
   where user_id = v_user and card_opening_balance > 0;
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
