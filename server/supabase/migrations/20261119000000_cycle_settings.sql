-- Pay-day cycle fixes and Settings backend (plan of 2026-11-19). One file, built up phase by phase.

-- ---------------------------------------------------------------- phase 1: recurring key per cycle
-- A recurring entry's unique key was 'recurring:<item>:<YYYY-MM of its date>'. With a pay day
-- other than the 1st, one cycle spans two calendar months, so the previous cycle's entry
-- recorded late and this cycle's entry could share a calendar month and clash on the unique
-- index. The app now passes p_cycle_key: the start date ('YYYY-MM-DD') of the cycle the
-- entry's date falls in (a date, not a month: after a pay-day change two cycles can start in
-- the same month). Null keeps the old calendar-month key.
drop function if exists public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text);
create or replace function public.record_entry_with_recurring(
  p_type text,
  p_amount bigint,
  p_date date,
  p_category_id uuid,
  p_note text,
  p_item_id uuid default null,
  p_make_recurring boolean default false,
  p_day smallint default null,
  p_update_item boolean default false,
  p_income_type text default 'salary',
  p_cycle_key text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.recurring_items;
  v_item uuid;
  v_name text := nullif(btrim(p_note), '');
  v_cat_name text;
  v_key text;
  v_tx uuid;
begin
  if p_type is null or p_type not in ('expense', 'income') then
    raise exception 'Type must be expense or income';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;
  if p_date is null then
    raise exception 'A date is required';
  end if;
  if p_day is not null and (p_day < 1 or p_day > 28) then
    raise exception 'Day of month must be between 1 and 28';
  end if;
  if p_income_type is null or p_income_type not in ('salary', 'variable', 'other') then
    raise exception 'Invalid income type';
  end if;
  if p_item_id is null and not coalesce(p_make_recurring, false) then
    raise exception 'Nothing recurring to record';
  end if;
  if p_cycle_key is not null and p_cycle_key !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$' then
    raise exception 'Invalid cycle';
  end if;

  if p_type = 'expense' then
    select c.name into v_cat_name from public.categories c where c.id = p_category_id;
    if v_cat_name is null then raise exception 'Category not found'; end if;
    v_name := coalesce(v_name, v_cat_name);
  elsif v_name is null then
    raise exception 'An income name is required';
  end if;

  if p_item_id is null then
    insert into public.recurring_items (user_id, name, amount, type, category_id, day_of_month, income_type, starts_on)
    values (auth.uid(), v_name, p_amount, p_type, case when p_type = 'expense' then p_category_id end,
            p_day, p_income_type, p_date)
    returning id into v_item;
  else
    select * into item from public.recurring_items where id = p_item_id and user_id = auth.uid();
    if not found then raise exception 'Recurring item not found'; end if;
    if item.type <> p_type then raise exception 'Recurring item is a different type'; end if;
    v_item := item.id;

    if coalesce(p_update_item, false) then
      update public.recurring_items
         set name = v_name,
             amount = p_amount,
             category_id = case when p_type = 'expense' then p_category_id end,
             day_of_month = p_day,
             income_type = case when p_type = 'income' then p_income_type else income_type end
       where id = v_item;
    end if;
  end if;

  v_key := 'recurring:' || v_item || ':' || coalesce(p_cycle_key, to_char(p_date, 'YYYY-MM'));

  -- A second manual record for the same month hits the unique index (23505) and
  -- rolls the whole call back, including any schedule update above.
  insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id)
  values (auth.uid(), case when p_type = 'expense' then p_category_id end, p_amount, p_type, p_date,
          case when p_type = 'income' then 'Income: ' || v_name else nullif(btrim(p_note), '') end,
          'manual', v_key)
  returning id into v_tx;

  if p_type = 'income' then
    insert into public.income_sources (user_id, name, type, status, amount, received_date, external_id, transaction_id)
    values (auth.uid(), v_name, p_income_type, 'received', p_amount, p_date, v_key, v_tx);
  end if;

  return v_tx;
end;
$$;

grant execute on function public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------- phase 2: pay-day model
-- Pay day is 1-28, or 31 = the last day of every month (30 Nov, 28/29 Feb, ...).
alter table public.user_settings drop constraint if exists user_settings_month_start_day_check;
alter table public.user_settings add constraint user_settings_month_start_day_check
  check (month_start_day between 1 and 28 or month_start_day = 31);

-- "Skip this month" now holds the skipped cycle's start date (see p_cycle_key above).
alter table public.recurring_items drop constraint if exists recurring_items_skip_month_check;
-- Existing skips ('YYYY-MM', the cycle's start month) become that cycle's start date: the
-- month plus the user's pay day (capped at the month's last day). Rows already converted
-- are left alone, so this can run again.
update public.recurring_items r
   set skip_month = to_char(least(to_date(r.skip_month || '-01', 'YYYY-MM-DD') + (s.month_start_day - 1),
                                  (to_date(r.skip_month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date),
                            'YYYY-MM-DD')
  from public.user_settings s
 where s.user_id = r.user_id and r.skip_month ~ '^\d{4}-(0[1-9]|1[0-2])$';
alter table public.recurring_items add constraint recurring_items_skip_month_check
  check (skip_month is null or skip_month ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$');

-- Pay-day history. user_settings.month_start_day is the pay day from onboarding; each row
-- here changes it from effective_from (a cycle start: the next pay date under the old pay
-- day), so past cycles keep their dates. References user_settings so the app can embed it
-- in the settings query. The app works the cycles out from this (client lib/periods.mjs).
create table if not exists public.pay_day_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_settings(user_id) on delete cascade,
  pay_day smallint not null check (pay_day between 1 and 28 or pay_day = 31),
  effective_from date not null,
  created_at timestamptz not null default now(),
  unique (user_id, effective_from)
);
alter table public.pay_day_changes enable row level security;
drop policy if exists "Users can manage their own pay day changes" on public.pay_day_changes;
create policy "Users can manage their own pay day changes" on public.pay_day_changes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Onboarding accepts pay day 31 (last day of the month).
create or replace function public.complete_onboarding(
  p_take_home_pay bigint,
  p_pay_day smallint,
  p_savings_pct smallint,
  p_bills jsonb default '[]'::jsonb,
  p_categories jsonb default '[]'::jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rows jsonb;
  r record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_take_home_pay is not null and p_take_home_pay < 0 then raise exception 'Take-home pay must be zero or more'; end if;
  if p_pay_day is not null and p_pay_day not between 1 and 28 and p_pay_day <> 31 then
    raise exception 'Pay day must be between 1 and 28, or 31 for the last day of the month';
  end if;
  if p_savings_pct is not null and p_savings_pct not between 0 and 100 then raise exception 'Savings must be between 0 and 100 percent'; end if;
  if jsonb_typeof(coalesce(p_bills, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_categories, '[]'::jsonb)) <> 'array' then
    raise exception 'Bills and categories must be lists';
  end if;

  -- One list of { name, type, amount, due_day } for both steps.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_rows from (
    select btrim(e->>'name') as name, 'fixed' as type, (e->>'amount')::bigint as amount, (e->>'due_day')::smallint as due_day
      from jsonb_array_elements(coalesce(p_bills, '[]'::jsonb)) e
    union all
    select btrim(e->>'name'), 'flexible', coalesce((e->>'limit')::bigint, 0), null::smallint
      from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) e
  ) x;

  if exists (select 1 from jsonb_to_recordset(v_rows) as t(name text) where coalesce(t.name, '') = '') then
    raise exception 'Every bill and category needs a name';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) as t(type text, amount bigint) where t.type = 'fixed' and (t.amount is null or t.amount <= 0)) then
    raise exception 'Bill amounts must be greater than zero';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) as t(type text, amount bigint) where t.type = 'flexible' and t.amount < 0) then
    raise exception 'Category limits must be zero or more';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) as t(due_day smallint) where t.due_day not between 1 and 28) then
    raise exception 'Due day must be between 1 and 28';
  end if;
  if exists (select 1 from jsonb_to_recordset(v_rows) as t(name text) group by lower(t.name) having count(*) > 1) then
    raise exception 'Each bill and category needs a different name';
  end if;

  insert into public.user_settings (user_id, take_home_pay, month_start_day, savings_pct, onboarded_at)
  values (v_user, p_take_home_pay, coalesce(p_pay_day, 1), p_savings_pct, now())
  on conflict (user_id) do update
    set take_home_pay = excluded.take_home_pay,
        month_start_day = excluded.month_start_day,
        savings_pct = excluded.savings_pct,
        onboarded_at = excluded.onboarded_at,
        updated_at = now();

  update public.categories set is_active = false, updated_at = now() where user_id = v_user;

  for r in select * from jsonb_to_recordset(v_rows) as t(name text, type text, amount bigint, due_day smallint) loop
    update public.categories
       set name = r.name, type = r.type, monthly_limit = r.amount, due_day = r.due_day,
           is_active = true, updated_at = now()
     where id = (select c.id from public.categories c
                  where c.user_id = v_user and lower(c.name) = lower(r.name)
                  order by c.created_at limit 1);
    if not found then
      insert into public.categories (user_id, name, type, monthly_limit, due_day)
      values (v_user, r.name, r.type, r.amount, r.due_day);
    end if;
  end loop;
end;
$$;
