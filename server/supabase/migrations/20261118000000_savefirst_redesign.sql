-- SaveFirst redesign (design handoff): data the new screens need.
--   * Onboarding answers: take-home pay, savings %, pay day, fixed bills with due days,
--     flexible categories with optional limits, saved atomically by complete_onboarding().
--   * Annual bills reserve: windfalls can put money aside (type 'reserve_transfer'),
--     and expenses can be paid from it (from_reserve) without touching safe-to-spend.
--   * Payee on transactions (Reports "Top payees").
--   * Recurring items never record themselves any more: process_due_recurring() is
--     removed; a due item is added only when the user taps Record. skip_month holds
--     "Skip this month" ('YYYY-MM').
-- Amounts are paise (bigint), like the rest of the schema. Additive except the
-- dropped auto-record function.

-- ---------------------------------------------------------------- columns
alter table public.user_settings
  add column if not exists take_home_pay bigint check (take_home_pay is null or take_home_pay >= 0),
  add column if not exists savings_pct smallint check (savings_pct is null or savings_pct between 0 and 100),
  add column if not exists onboarded_at timestamptz;

-- Due day of a fixed bill (1-28, like recurring items). Null = no set day.
alter table public.categories
  add column if not exists due_day smallint check (due_day is null or due_day between 1 and 28);

alter table public.transactions
  add column if not exists payee text check (payee is null or char_length(payee) <= 120),
  add column if not exists from_reserve boolean not null default false;
alter table public.transactions drop constraint if exists transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('expense', 'income', 'savings_transfer', 'reserve_transfer'));
alter table public.transactions drop constraint if exists transactions_from_reserve_check;
alter table public.transactions add constraint transactions_from_reserve_check
  check (not from_reserve or type = 'expense');

alter table public.recurring_items
  add column if not exists skip_month text check (skip_month is null or skip_month ~ '^\d{4}-(0[1-9]|1[0-2])$');

-- ---------------------------------------------------------------- signup
-- New users still get settings and the starter categories, but no starter savings
-- goal: the dashboard shows what the user sets up in onboarding (design handoff).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_settings (user_id, currency, month_start_day)
  values (new.id, 'INR', 1)
  on conflict (user_id) do nothing;

  perform public.ensure_starter_categories(new.id);

  return new;
end;
$$;

-- ---------------------------------------------------------------- recurring: manual only
drop function if exists public.process_due_recurring(date);

-- ---------------------------------------------------------------- windfall with reserve
-- Split a received windfall: p_savings to a goal, p_reserve to the annual bills reserve,
-- the rest stays in safe to spend. Both parts are marked source = 'windfall' so the
-- app keeps them apart from the regular monthly savings target. Also restores the baseline's checks that the
-- financial_integrity rewrite lost: only an EXPECTED income can be allocated (no double
-- counting on a second submit) and the specific error messages.
drop function if exists public.allocate_windfall(uuid, uuid, bigint, bigint, date, text);
create or replace function public.allocate_windfall(
  p_income_id uuid,
  p_goal_id uuid,
  p_savings bigint,
  p_total bigint,
  p_date date,
  p_note text,
  p_reserve bigint default 0
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx uuid;
  v_income_type text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_total is null or p_total <= 0 then
    raise exception 'Windfall total must be positive';
  end if;
  if p_savings is null or p_savings < 0 or p_savings > p_total then
    raise exception 'Savings allocation must be between 0 and the windfall total';
  end if;
  if p_reserve is null or p_reserve < 0 or p_savings + p_reserve > p_total then
    raise exception 'Reserve allocation must be between 0 and what is left after savings';
  end if;
  if p_savings > 0 and p_goal_id is null then
    raise exception 'A savings goal is required when allocating savings';
  end if;

  update public.income_sources
     set status = 'received', received_date = p_date
   where id = p_income_id and user_id = auth.uid() and status = 'expected'
   returning type into v_income_type;
  if not found then raise exception 'Income source not found or already received'; end if;

  if p_savings > 0 then
    if not exists (select 1 from public.savings_goals where id = p_goal_id and user_id = auth.uid()) then
      raise exception 'Savings goal not found';
    end if;
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_savings, 'savings_transfer', p_date, 'Windfall savings allocation', 'windfall')
    returning id into v_tx;
    insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
    values(auth.uid(), p_goal_id, v_tx, p_savings, p_date);
  end if;

  if p_reserve > 0 then
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_reserve, 'reserve_transfer', p_date, 'Annual & irregular bills reserve', 'windfall');
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_total, 'income', p_date, p_note, 'manual')
  returning id into v_tx;

  update public.income_sources
     set transaction_id = v_tx, amount = p_total
   where id = p_income_id and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------- onboarding
-- Saves the five onboarding steps in one go. Every step is optional ("nothing blocks"):
--   p_take_home_pay / p_savings_pct: null = "Add later"; p_pay_day: null = day 1.
--   p_bills:      [{ "name": text, "amount": paise > 0, "due_day": 1-28 | null }] -> active fixed categories
--   p_categories: [{ "name": text, "limit": paise >= 0 | null }]                  -> active flexible categories
-- Every other category of the user is switched off (kept, so nothing is lost); names
-- match existing categories case-insensitively. Safe to run again.
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
  if p_pay_day is not null and p_pay_day not between 1 and 28 then raise exception 'Pay day must be between 1 and 28'; end if;
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

grant execute on function public.allocate_windfall(uuid, uuid, bigint, bigint, date, text, bigint) to authenticated;
grant execute on function public.complete_onboarding(bigint, smallint, smallint, jsonb, jsonb) to authenticated;
