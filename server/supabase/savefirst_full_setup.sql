-- SaveFirst: full database setup in one script (generated from migrations/).
-- Drops everything the app created in public, then builds it again from scratch, so it
-- can be run any number of times. Runs in one transaction: any error rolls everything back.
-- Leaves out 20261117000000_budget_plans.sql; the app no longer uses budget plans.
-- Keep in step with server/supabase/migrations: append each new migration before commit.

begin;

-- Start from scratch: drop every app table, view and function in public, and the signup
-- trigger. Objects owned by extensions are left alone. THIS DELETES ALL APP DATA.
drop trigger if exists on_auth_user_created on auth.users;
do $$
declare
  r record;
begin
  for r in
    select c.relname, c.relkind from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
       and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    if r.relkind in ('v', 'm') then
      execute format('drop %s view if exists public.%I cascade', case r.relkind when 'm' then 'materialized' else '' end, r.relname);
    else
      execute format('drop table if exists public.%I cascade', r.relname);
    end if;
  end loop;
  for r in
    select p.oid::regprocedure as sig from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('drop function if exists %s cascade', r.sig);
  end loop;
end $$;

-- ============================================================
-- 20261103000000_budget_tracker_schema.sql
-- ============================================================

-- Baseline schema. server/supabase/migrations is the only source of database changes.
create extension if not exists "uuid-ossp";

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR',
  month_start_day smallint not null default 1 check (month_start_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
create policy "Users can view their own settings" on public.user_settings for select using (auth.uid() = user_id);
create policy "Users can insert their own settings" on public.user_settings for insert with check (auth.uid() = user_id);
create policy "Users can update their own settings" on public.user_settings for update using (auth.uid() = user_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('fixed', 'flexible')),
  monthly_limit bigint not null default 0,
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.categories enable row level security;
create policy "Users can manage their own categories" on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('salary', 'variable', 'other')),
  status text not null default 'expected' check (status in ('expected', 'received')),
  amount bigint not null,
  expected_date date,
  received_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.income_sources enable row level security;
create policy "Users can manage their own income sources" on public.income_sources for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  amount bigint not null,
  type text not null check (type in ('expense', 'income', 'savings_transfer')),
  date date not null default current_date,
  note text,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_transactions_user_date on public.transactions(user_id, date);
create index idx_transactions_category on public.transactions(category_id);
create unique index idx_transactions_recurring_month on public.transactions (user_id, external_id) where external_id like 'recurring:%';
alter table public.transactions enable row level security;
create policy "Users can manage their own transactions" on public.transactions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount bigint not null,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.savings_goals enable row level security;
create policy "Users can manage their own savings goals" on public.savings_goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount bigint not null,
  date date not null default current_date,
  created_at timestamptz not null default now()
);
alter table public.goal_contributions enable row level security;
create policy "Users can manage their own goal contributions" on public.goal_contributions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  amount bigint not null check (amount > 0),
  type text not null check (type in ('expense', 'income')),
  category_id uuid references public.categories(id) on delete set null,
  day_of_month smallint not null check (day_of_month between 1 and 28),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.recurring_items enable row level security;
create policy "Users can manage their own recurring items" on public.recurring_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Canonical starter categories.
--
-- ensure_starter_categories(user) is the single source of truth for the 13
-- starter categories. It is idempotent and safe to run any number of times:
--   1. Renames the two legacy labels ("EMI & Loans", "Transport & Fuel") to the
--      canonical ones, but ONLY when the canonical label is not already in use
--      for that user (otherwise the user would end up with duplicates).
--   2. Inserts any starter category the user does not already have, matched on
--      name (case-insensitive) so a category the user re-typed is never
--      duplicated. Starter limits are 0 = "no limit set yet".
--
-- It is SECURITY INVOKER on purpose: when an authenticated user calls it, row
-- level security restricts it to their own rows. The signup trigger and the
-- backfill below run as the table owner, which is why they can seed any user.
create or replace function public.ensure_starter_categories(p_user_id uuid default auth.uid())
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_user_id is null then
    raise exception 'Not authenticated';
  end if;

  update public.categories c
     set name = 'EMI / Loans'
   where c.user_id = p_user_id and c.name = 'EMI & Loans' and c.type = 'fixed'
     and not exists (
       select 1 from public.categories x
        where x.user_id = p_user_id and lower(x.name) = 'emi / loans'
     );

  update public.categories c
     set name = 'Transport / Fuel'
   where c.user_id = p_user_id and c.name = 'Transport & Fuel' and c.type = 'flexible'
     and not exists (
       select 1 from public.categories x
        where x.user_id = p_user_id and lower(x.name) = 'transport / fuel'
     );

  insert into public.categories (user_id, name, type, monthly_limit)
  select p_user_id, s.name, s.type, 0
    from (values
      ('Rent / Housing', 'fixed'), ('Utilities & Bills', 'fixed'), ('EMI / Loans', 'fixed'),
      ('Insurance', 'fixed'), ('Subscriptions', 'fixed'),
      ('Groceries', 'flexible'), ('Food & Dining Out', 'flexible'), ('Transport / Fuel', 'flexible'),
      ('Shopping', 'flexible'), ('Entertainment', 'flexible'), ('Health', 'flexible'),
      ('Travel', 'flexible'), ('Miscellaneous', 'flexible')
    ) as s(name, type)
   where not exists (
     select 1 from public.categories c
      where c.user_id = p_user_id and lower(c.name) = lower(s.name)
   );

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- New users get the same starter set through the same function.
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

  insert into public.savings_goals (user_id, name, target_amount)
  values (new.id, 'Emergency Fund', 10000000);

  return new;
end;
$$;


create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Backfill every existing user (idempotent: a second run changes nothing).
select public.ensure_starter_categories(id) from auth.users;

create or replace function public.post_recurring_item(p_item_id uuid, p_date date default current_date)
returns void language plpgsql security invoker as $$
declare item public.recurring_items;
begin
  select * into item from public.recurring_items where id = p_item_id and user_id = auth.uid() and active;
  if not found then raise exception 'Recurring item not found'; end if;
  insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id)
  values (auth.uid(), item.category_id, item.amount, item.type, p_date, 'Recurring: ' || item.name, 'recurring', 'recurring:' || item.id || ':' || to_char(p_date, 'YYYY-MM'));
  if item.type = 'income' then
    insert into public.income_sources (user_id, name, type, status, amount, received_date)
    values (auth.uid(), item.name, 'salary', 'received', item.amount, p_date);
  end if;
end;
$$;

create or replace function public.record_received_income(p_name text, p_amount bigint, p_date date default current_date, p_type text default 'salary')
returns void language plpgsql security invoker as $$
begin
  insert into public.income_sources (user_id, name, type, status, amount, received_date)
  values (auth.uid(), p_name, p_type, 'received', p_amount, p_date);
  insert into public.transactions (user_id, amount, type, date, note, source)
  values (auth.uid(), p_amount, 'income', p_date, 'Income: ' || p_name, 'manual');
end;
$$;

create or replace function public.record_goal_contribution(p_goal_id uuid, p_amount bigint, p_date date, p_note text)
returns void language plpgsql security invoker as $$
declare v_tx uuid;
begin
  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_amount, 'savings_transfer', p_date, p_note, 'manual') returning id into v_tx;
  insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
  values(auth.uid(), p_goal_id, v_tx, p_amount, p_date);
end;
$$;

-- allocate_windfall hardening:
--   * validates amounts up front;
--   * only an income source that is still 'expected' can be allocated, so a
--     double submit / retry / second tab cannot double-count the windfall;
--   * stays atomic: any later failure (e.g. an unknown goal id) rolls back the
--     income status update, the savings transfer and the income transaction together.
create or replace function public.allocate_windfall(p_income_id uuid, p_goal_id uuid, p_savings bigint, p_total bigint, p_date date, p_note text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_tx uuid;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'Windfall total must be positive';
  end if;
  if p_savings is null or p_savings < 0 or p_savings > p_total then
    raise exception 'Savings allocation must be between 0 and the windfall total';
  end if;
  if p_savings > 0 and p_goal_id is null then
    raise exception 'A savings goal is required when allocating savings';
  end if;

  update public.income_sources set status = 'received', received_date = p_date
   where id = p_income_id and user_id = auth.uid() and status = 'expected';
  if not found then raise exception 'Income source not found or already received'; end if;

  if p_savings > 0 then
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_savings, 'savings_transfer', p_date, 'Windfall savings allocation', 'manual') returning id into v_tx;
    insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
    values(auth.uid(), p_goal_id, v_tx, p_savings, p_date);
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_total, 'income', p_date, p_note, 'manual');
end $$;

-- Recurring income/expenses v2: optional auto-record day, record-with-recurring,
-- automatic end-of-day recording, and undo.
--
-- Safe to run on a fresh database (after the baseline) and as an upgrade on top of
-- the previous recurring_items schema. Idempotent.

-- 1. Schema ---------------------------------------------------------------
-- day_of_month is now OPTIONAL: NULL = "suggest only, never auto-record".
alter table public.recurring_items alter column day_of_month drop not null;
alter table public.recurring_items drop constraint if exists recurring_items_day_of_month_check;
alter table public.recurring_items add constraint recurring_items_day_of_month_check
  check (day_of_month is null or day_of_month between 1 and 28);

-- First month the schedule is live. Auto-recording never goes back before it.
alter table public.recurring_items add column if not exists starts_on date not null default current_date;
-- Months the user undid ('YYYY-MM'). Remembered so an undone occurrence is not re-recorded.
alter table public.recurring_items add column if not exists undone_months text[] not null default '{}';
-- Income schedules keep the income type (salary / variable / other) the user chose.
alter table public.recurring_items add column if not exists income_type text not null default 'salary';
alter table public.recurring_items drop constraint if exists recurring_items_income_type_check;
alter table public.recurring_items add constraint recurring_items_income_type_check
  check (income_type in ('salary', 'variable', 'other'));

-- Links an income row to the recurring occurrence that created it, so undo removes both rows.
alter table public.income_sources add column if not exists external_id text;
create unique index if not exists idx_income_sources_external
  on public.income_sources (user_id, external_id) where external_id is not null;

-- 2. Post one occurrence (used by the automatic recorder) -------------------
-- Return type changes from void to the new transaction id, hence drop + create.
drop function if exists public.post_recurring_item(uuid, date);
create function public.post_recurring_item(p_item_id uuid, p_date date default current_date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.recurring_items;
  v_key text;
  v_tx uuid;
begin
  select * into item from public.recurring_items
   where id = p_item_id and user_id = auth.uid() and active;
  if not found then raise exception 'Recurring item not found'; end if;

  v_key := 'recurring:' || item.id || ':' || to_char(p_date, 'YYYY-MM');

  insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id)
  values (auth.uid(), case when item.type = 'expense' then item.category_id end, item.amount, item.type,
          p_date, 'Recurring: ' || item.name, 'recurring', v_key)
  returning id into v_tx;

  if item.type = 'income' then
    insert into public.income_sources (user_id, name, type, status, amount, received_date, external_id)
    values (auth.uid(), item.name, item.income_type, 'received', item.amount, p_date, v_key);
  end if;

  return v_tx;
end;
$$;

-- 3. Record an entry the user is typing in NOW, tied to a recurring item ----
-- Used by the expense / income pop-ups when the "recurring" box is ticked or a
-- recurring suggestion was picked. One atomic call: it creates (or updates) the
-- schedule AND records this month's transaction, so the automatic recorder does
-- not add a duplicate. The schedule itself is NOT counted anywhere.
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
  p_income_type text default 'salary'
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

  v_key := 'recurring:' || v_item || ':' || to_char(p_date, 'YYYY-MM');

  -- A second manual record for the same month hits the unique index (23505) and
  -- rolls the whole call back, including any schedule update above.
  insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id)
  values (auth.uid(), case when p_type = 'expense' then p_category_id end, p_amount, p_type, p_date,
          case when p_type = 'income' then 'Income: ' || v_name else nullif(btrim(p_note), '') end,
          'manual', v_key)
  returning id into v_tx;

  if p_type = 'income' then
    insert into public.income_sources (user_id, name, type, status, amount, received_date, external_id)
    values (auth.uid(), v_name, p_income_type, 'received', p_amount, p_date, v_key);
  end if;

  return v_tx;
end;
$$;

-- 4. Automatic recorder ------------------------------------------------------
-- Records every occurrence whose day has ENDED (occurrence date < today) and that
-- is not already recorded or undone. Each is dated on its scheduled day, not on
-- the day this runs. Returns what it recorded so the app can show an alert.
--   * only schedules with a day set are auto-recorded;
--   * catches up at most the last 3 months (this one and the 2 before) so a very
--     old start date can never flood the books;
--   * safe to call repeatedly or from two tabs at once.
create or replace function public.process_due_recurring(p_today date default current_date)
returns table (
  transaction_id uuid,
  item_id uuid,
  item_name text,
  item_type text,
  amount_paise bigint,
  occurred_on date
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.recurring_items;
  m date;
  occ date;
  v_month text;
  v_key text;
  v_tx uuid;
begin
  if p_today is null then
    raise exception 'Invalid date';
  end if;

  for item in
    select * from public.recurring_items r
     where r.user_id = auth.uid() and r.active and r.day_of_month is not null
     order by r.created_at, r.id
  loop
    m := greatest(date_trunc('month', item.starts_on)::date, (date_trunc('month', p_today) - interval '2 months')::date);

    while m <= date_trunc('month', p_today)::date loop
      occ := m + (item.day_of_month - 1);
      v_month := to_char(m, 'YYYY-MM');
      v_key := 'recurring:' || item.id || ':' || v_month;

      if occ < p_today
         and not (v_month = any (item.undone_months))
         and not exists (select 1 from public.transactions t where t.user_id = auth.uid() and t.external_id = v_key)
      then
        begin
          v_tx := public.post_recurring_item(item.id, occ);
          transaction_id := v_tx;
          item_id := item.id;
          item_name := item.name;
          item_type := item.type;
          amount_paise := item.amount;
          occurred_on := occ;
          return next;
        exception when unique_violation then
          null; -- another tab recorded it first: nothing to do
        end;
      end if;

      m := (m + interval '1 month')::date;
    end loop;
  end loop;
end;
$$;

-- 5. Undo an automatically recorded occurrence -------------------------------
-- Removes the transaction (and the income row for income) and remembers the month
-- so the recorder does not put it back. Only automatic ('recurring') records can be undone.
create or replace function public.undo_recurring_post(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  tx public.transactions;
  v_item uuid;
  v_month text;
begin
  select * into tx from public.transactions
   where id = p_transaction_id and user_id = auth.uid()
     and source = 'recurring' and external_id like 'recurring:%';
  if not found then raise exception 'Nothing to undo'; end if;

  v_item := split_part(tx.external_id, ':', 2)::uuid;
  v_month := split_part(tx.external_id, ':', 3);

  delete from public.transactions where id = tx.id;
  if tx.type = 'income' then
    delete from public.income_sources where user_id = auth.uid() and external_id = tx.external_id;
  end if;

  update public.recurring_items
     set undone_months = array_append(undone_months, v_month)
   where id = v_item and user_id = auth.uid() and not (v_month = any (undone_months));
end;
$$;


-- ============================================================
-- 20261108000000_financial_integrity.sql
-- ============================================================

-- Keep transaction history, income sources and savings contributions linked.
-- This migration is safe for existing databases; legacy rows are backfilled only
-- when there is exactly one unambiguous matching income source.
alter table public.income_sources
  add column if not exists transaction_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'income_sources_transaction_id_fkey'
      and conrelid = 'public.income_sources'::regclass
  ) then
    alter table public.income_sources
      add constraint income_sources_transaction_id_fkey
      foreign key (transaction_id) references public.transactions(id) on delete cascade;
  end if;
end $$;

create unique index if not exists idx_income_sources_transaction
  on public.income_sources(transaction_id) where transaction_id is not null;

-- A transfer transaction and its contribution are one financial event.
alter table public.goal_contributions
  drop constraint if exists goal_contributions_transaction_id_fkey;
alter table public.goal_contributions
  add constraint goal_contributions_transaction_id_fkey
  foreign key (transaction_id) references public.transactions(id) on delete cascade;

drop policy if exists "Users can manage their own goal contributions" on public.goal_contributions;
create policy "Users can manage their own goal contributions"
  on public.goal_contributions
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.savings_goals g
      where g.id = goal_id and g.user_id = auth.uid()
    )
  );

-- Link old recurring income rows, where the stable occurrence key is available.
update public.income_sources i
set transaction_id = t.id
from public.transactions t
where i.transaction_id is null
  and i.external_id is not null
  and t.user_id = i.user_id
  and t.external_id = i.external_id
  and t.type = 'income';

-- Backfill manual income only if the note/date/amount identifies one unique row.
with candidates as (
  select i.id as income_id, t.id as transaction_id
  from public.income_sources i
  join public.transactions t
    on t.user_id = i.user_id
   and t.type = 'income'
   and t.amount = i.amount
   and t.date = i.received_date
   and t.note = 'Income: ' || i.name
  where i.transaction_id is null
    and i.status = 'received'
),
unique_income_matches as (
  select income_id, transaction_id
  from candidates
  where income_id in (
    select income_id from candidates group by income_id having count(*) = 1
  )
  and transaction_id in (
    select transaction_id from candidates group by transaction_id having count(*) = 1
  )
)
update public.income_sources i
set transaction_id = m.transaction_id
from unique_income_matches m
where i.id = m.income_id;

-- Contributions must belong to a goal owned by the authenticated user.
create or replace function public.record_goal_contribution(
  p_goal_id uuid,
  p_amount bigint,
  p_date date default current_date,
  p_note text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Contribution must be positive'; end if;
  if not exists (
    select 1 from public.savings_goals
    where id = p_goal_id and user_id = auth.uid()
  ) then
    raise exception 'Savings goal not found';
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_amount, 'savings_transfer', coalesce(p_date, current_date), p_note, 'manual')
  returning id into v_tx;

  insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
  values(auth.uid(), p_goal_id, v_tx, p_amount, coalesce(p_date, current_date));
end;
$$;

-- Link each newly received income row to its transaction. The FK cascades a
-- transaction deletion to the corresponding income source.
create or replace function public.record_received_income(
  p_name text,
  p_amount bigint,
  p_date date default current_date,
  p_type text default 'salary'
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Income must be positive'; end if;
  if p_type not in ('salary', 'variable', 'other') then raise exception 'Invalid income type'; end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_amount, 'income', coalesce(p_date, current_date), 'Income: ' || p_name, 'manual')
  returning id into v_tx;

  insert into public.income_sources(user_id, name, type, status, amount, received_date, transaction_id)
  values(auth.uid(), p_name, p_type, 'received', p_amount, coalesce(p_date, current_date), v_tx);
end;
$$;

-- Keep the automatic recurring occurrence and its income source linked.
-- The previous migration declared this function as RETURNS void.
drop function if exists public.post_recurring_item(uuid, date);
create function public.post_recurring_item(p_item_id uuid, p_date date default current_date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  item public.recurring_items;
  v_key text;
  v_tx uuid;
begin
  select * into item from public.recurring_items
   where id = p_item_id and user_id = auth.uid() and active;
  if not found then raise exception 'Recurring item not found'; end if;

  v_key := 'recurring:' || item.id || ':' || to_char(p_date, 'YYYY-MM');
  insert into public.transactions(user_id, category_id, amount, type, date, note, source, external_id)
  values(auth.uid(), case when item.type = 'expense' then item.category_id end,
         item.amount, item.type, p_date, 'Recurring: ' || item.name, 'recurring', v_key)
  returning id into v_tx;

  if item.type = 'income' then
    insert into public.income_sources(user_id, name, type, status, amount, received_date, external_id, transaction_id)
    values(auth.uid(), item.name, item.income_type, 'received', item.amount, p_date, v_key, v_tx);
  end if;

  return v_tx;
end;
$$;

-- Associate windfall's income transaction with its source for future edits/deletes.
create or replace function public.allocate_windfall(
  p_income_id uuid,
  p_goal_id uuid,
  p_savings bigint,
  p_total bigint,
  p_date date,
  p_note text
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
  if p_total is null or p_total <= 0 or p_savings is null or p_savings < 0 or p_savings > p_total then
    raise exception 'Invalid windfall allocation';
  end if;

  update public.income_sources
     set status = 'received', received_date = p_date
   where id = p_income_id and user_id = auth.uid()
   returning type into v_income_type;
  if not found then raise exception 'Income source not found'; end if;

  if p_savings > 0 and p_goal_id is null then
    raise exception 'Select a savings goal for the savings allocation';
  end if;
  if p_savings > 0 and p_goal_id is not null then
    if not exists (select 1 from public.savings_goals where id = p_goal_id and user_id = auth.uid()) then
      raise exception 'Savings goal not found';
    end if;
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_savings, 'savings_transfer', p_date, 'Windfall savings allocation', 'manual')
    returning id into v_tx;
    insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
    values(auth.uid(), p_goal_id, v_tx, p_savings, p_date);
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_total, 'income', p_date, p_note, 'manual')
  returning id into v_tx;

  update public.income_sources
     set transaction_id = v_tx, amount = p_total
   where id = p_income_id and user_id = auth.uid();
end;
$$;


-- Edit the parent transaction and all linked financial records atomically.
create or replace function public.update_financial_transaction(
  p_transaction_id uuid,
  p_amount bigint,
  p_date date,
  p_category_id uuid,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and user_id = auth.uid()
  ) then
    raise exception 'Category not found';
  end if;

  update public.transactions
     set amount = p_amount,
         date = p_date,
         category_id = p_category_id,
         note = p_note
   where id = p_transaction_id and user_id = auth.uid()
   returning type into v_type;
  if not found then raise exception 'Transaction not found'; end if;

  if v_type = 'savings_transfer' then
    update public.goal_contributions
       set amount = p_amount, date = p_date
     where transaction_id = p_transaction_id and user_id = auth.uid();
  elsif v_type = 'income' then
    update public.income_sources
       set amount = p_amount, received_date = p_date
     where transaction_id = p_transaction_id and user_id = auth.uid();
  end if;
end;
$$;


-- Link income rows created by the "record with recurring" flow.
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
  p_income_type text default 'salary'
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

  v_key := 'recurring:' || v_item || ':' || to_char(p_date, 'YYYY-MM');

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

create or replace function public.undo_recurring_post(p_transaction_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  tx public.transactions;
  v_item uuid;
  v_month text;
begin
  select * into tx from public.transactions
   where id = p_transaction_id and user_id = auth.uid()
     and source in ('recurring', 'manual') and external_id like 'recurring:%';
  if not found then raise exception 'Nothing to undo'; end if;

  v_item := split_part(tx.external_id, ':', 2)::uuid;
  v_month := split_part(tx.external_id, ':', 3);

  delete from public.transactions where id = tx.id;
  -- The income_sources.transaction_id FK cascades the linked income source.
  delete from public.income_sources
   where user_id = auth.uid() and external_id = tx.external_id;

  update public.recurring_items
     set undone_months = array_append(undone_months, v_month)
   where id = v_item and user_id = auth.uid()
     and not (v_month = any (undone_months));
end;
$$;


-- ============================================================
-- 20261118000000_savefirst_redesign.sql
-- ============================================================

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

-- "Already saved" when a goal is created: an opening balance, not a transfer, so it never
-- touches this cycle's safe to spend. Progress = saved_before + contributions.
alter table public.savings_goals
  add column if not exists saved_before bigint not null default 0 check (saved_before >= 0);

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

-- ============================================================
-- 20261119000000_cycle_settings.sql
-- ============================================================

-- Pay-day cycle fixes and Settings backend (plan of 2026-11-19). One file, built up phase by phase.

-- ---------------------------------------------------------------- phase 1: recurring key per cycle
-- A recurring entry's unique key was 'recurring:<item>:<YYYY-MM of its date>'. With a pay day
-- other than the 1st, one cycle spans two calendar months, so the previous cycle's entry
-- recorded late and this cycle's entry could share a calendar month and clash on the unique
-- index. The app now passes p_cycle_key: the start date ('YYYY-MM-DD') of the cycle the
-- entry's date falls in (a date, not a month: after a pay-day change two cycles can start in
-- the same month). Null keeps the old calendar-month key.
drop function if exists public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text);
drop function if exists public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text, text);
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
  p_cycle_key text default null,
  p_counts_from date default null -- phase 3: early income counted toward the next cycle
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
  if p_counts_from is not null and p_type <> 'income' then
    raise exception 'Only income can count toward the next cycle';
  end if;
  if p_counts_from is not null and (p_counts_from <= p_date or p_counts_from > p_date + 5) then
    raise exception 'Income can only count toward a cycle that starts within 5 days';
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
  insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id, counts_from)
  values (auth.uid(), case when p_type = 'expense' then p_category_id end, p_amount, p_type, p_date,
          case when p_type = 'income' then 'Income: ' || v_name else nullif(btrim(p_note), '') end,
          'manual', v_key, p_counts_from)
  returning id into v_tx;

  if p_type = 'income' then
    insert into public.income_sources (user_id, name, type, status, amount, received_date, external_id, transaction_id)
    values (auth.uid(), v_name, p_income_type, 'received', p_amount, p_date, v_key, v_tx);
  end if;

  return v_tx;
end;
$$;

grant execute on function public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text, text, date) to authenticated;

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

-- ---------------------------------------------------------------- phase 3: early income
-- Salary that lands a few days before pay day (a weekend or holiday) can count toward the
-- cycle that starts on pay day. counts_from is that cycle's start date; the entry keeps its
-- real date. The app counts an entry in the cycle of coalesce(counts_from, date). Only income,
-- and only 1-5 days before the cycle starts (the app checks it is exactly a cycle start).
alter table public.transactions add column if not exists counts_from date;
alter table public.transactions drop constraint if exists transactions_counts_from_check;
alter table public.transactions add constraint transactions_counts_from_check
  check (counts_from is null or (type = 'income' and counts_from > date and counts_from <= date + 5));

-- record_entry_with_recurring takes p_counts_from (see phase 1 above).
drop function if exists public.record_received_income(text, bigint, date, text);
create or replace function public.record_received_income(
  p_name text,
  p_amount bigint,
  p_date date default current_date,
  p_type text default 'salary',
  p_counts_from date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Income must be positive'; end if;
  if p_type not in ('salary', 'variable', 'other') then raise exception 'Invalid income type'; end if;
  if p_counts_from is not null and (p_counts_from <= coalesce(p_date, current_date) or p_counts_from > coalesce(p_date, current_date) + 5) then
    raise exception 'Income can only count toward a cycle that starts within 5 days';
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source, counts_from)
  values(auth.uid(), p_amount, 'income', coalesce(p_date, current_date), 'Income: ' || p_name, 'manual', p_counts_from)
  returning id into v_tx;

  insert into public.income_sources(user_id, name, type, status, amount, received_date, transaction_id)
  values(auth.uid(), p_name, p_type, 'received', p_amount, coalesce(p_date, current_date), v_tx);
end;
$$;

grant execute on function public.record_received_income(text, bigint, date, text, date) to authenticated;

-- Editing an entry's date drops counts_from once it no longer fits.
create or replace function public.update_financial_transaction(
  p_transaction_id uuid,
  p_amount bigint,
  p_date date,
  p_category_id uuid,
  p_note text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive'; end if;
  if p_date is null then raise exception 'Date is required'; end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and user_id = auth.uid()
  ) then
    raise exception 'Category not found';
  end if;

  update public.transactions
     set amount = p_amount,
         date = p_date,
         category_id = p_category_id,
         note = p_note,
         -- keep 'counts toward next cycle' only while the new date is still 1-5 days before it
         counts_from = case when counts_from > p_date and counts_from <= p_date + 5 then counts_from end
   where id = p_transaction_id and user_id = auth.uid()
   returning type into v_type;
  if not found then raise exception 'Transaction not found'; end if;

  if v_type = 'savings_transfer' then
    update public.goal_contributions
       set amount = p_amount, date = p_date
     where transaction_id = p_transaction_id and user_id = auth.uid();
  elsif v_type = 'income' then
    update public.income_sources
       set amount = p_amount, received_date = p_date
     where transaction_id = p_transaction_id and user_id = auth.uid();
  end if;
end;
$$;

-- ---------------------------------------------------------------- phase 5: settings backend
-- Theme follows the user across devices. Null = not chosen yet (the app keeps its local choice).
alter table public.user_settings
  add column if not exists theme text check (theme is null or theme in ('dark', 'light', 'system'));

-- Settings screen save. Every argument is optional: null leaves that setting unchanged.
-- A new pay day starts at the next cycle: p_pay_day_from is that cycle's start date, which
-- the app works out from the pay-day schedule (client lib/settings.mjs nextCycleStart).
-- A pending change (not yet in force) is replaced; choosing the pay day already in force
-- cancels it.
create or replace function public.update_settings(
  p_take_home_pay bigint default null,
  p_savings_pct smallint default null,
  p_theme text default null,
  p_pay_day smallint default null,
  p_pay_day_from date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_current smallint;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_take_home_pay is not null and p_take_home_pay < 0 then raise exception 'Take-home pay must be zero or more'; end if;
  if p_savings_pct is not null and p_savings_pct not between 0 and 100 then raise exception 'Savings must be between 0 and 100 percent'; end if;
  if p_theme is not null and p_theme not in ('dark', 'light', 'system') then raise exception 'Theme must be dark, light or system'; end if;
  if p_pay_day is not null then
    if p_pay_day not between 1 and 28 and p_pay_day <> 31 then
      raise exception 'Pay day must be between 1 and 28, or 31 for the last day of the month';
    end if;
    -- current_date is UTC: allow a day either side of the user's own today.
    if p_pay_day_from is null or p_pay_day_from < current_date or p_pay_day_from > current_date + 62 then
      raise exception 'A new pay day starts at the next cycle';
    end if;
  end if;

  update public.user_settings
     set take_home_pay = coalesce(p_take_home_pay, take_home_pay),
         savings_pct = coalesce(p_savings_pct, savings_pct),
         theme = coalesce(p_theme, theme),
         updated_at = now()
   where user_id = v_user;
  if not found then raise exception 'Settings not found'; end if;

  if p_pay_day is not null then
    delete from public.pay_day_changes where user_id = v_user and effective_from >= p_pay_day_from;
    select coalesce(
      (select c.pay_day from public.pay_day_changes c
        where c.user_id = v_user and c.effective_from < p_pay_day_from
        order by c.effective_from desc limit 1),
      (select s.month_start_day from public.user_settings s where s.user_id = v_user))
      into v_current;
    if v_current <> p_pay_day then
      insert into public.pay_day_changes (user_id, pay_day, effective_from) values (v_user, p_pay_day, p_pay_day_from);
    end if;
  end if;
end;
$$;

grant execute on function public.update_settings(bigint, smallint, text, smallint, date) to authenticated;

-- Delete my account: removes the signed-in user; every table cascades from auth.users.
-- security definer so it may touch auth.users, but it only ever deletes auth.uid().
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ============================================================
-- 20261120000000_settings_v2.sql
-- ============================================================

-- SaveFirst v2 (design handoff v2, 2026-11-20): effective-dated plan changes for salary,
-- payday and save-first %, plan history, profile and display preferences.
-- Amounts are paise. Re-runnable.

-- ---------------------------------------------------------------- plan history
-- Every change to salary, payday or save-first %, kept for the Plan history list.
--   applies 'start' = the onboarding value; 'now' = from the start of the cycle it was made
--   in; 'next' = from the next cycle start. effective_from is that cycle start ('start' rows:
--   the day of onboarding). superseded_at is set when a newer change replaces this one before
--   or as it takes effect; superseded rows stay in the history but no longer apply.
-- The app works out each cycle's dates and plan from the rows that apply (lib/plan.mjs).
create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_settings(user_id) on delete cascade,
  field text not null check (field in ('salary', 'payday', 'save_pct')),
  from_value bigint,
  to_value bigint not null,
  applies text not null check (applies in ('start', 'now', 'next')),
  effective_from date not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plan_changes_value_check check (
    (field = 'salary' and to_value >= 0)
    or (field = 'payday' and (to_value between 1 and 28 or to_value = 31))
    or (field = 'save_pct' and to_value between 0 and 100))
);
create index if not exists idx_plan_changes_user on public.plan_changes (user_id, field, effective_from);
alter table public.plan_changes enable row level security;
drop policy if exists "Users can manage their own plan history" on public.plan_changes;
create policy "Users can manage their own plan history" on public.plan_changes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- pay_day_changes (next-cycle payday only) is folded into plan_changes.
do $$
begin
  if to_regclass('public.pay_day_changes') is not null then
    insert into public.plan_changes (user_id, field, to_value, applies, effective_from, created_at)
    select c.user_id, 'payday', c.pay_day, 'next', c.effective_from, c.created_at
      from public.pay_day_changes c
     where not exists (select 1 from public.plan_changes p
                        where p.user_id = c.user_id and p.field = 'payday' and p.effective_from = c.effective_from);
    drop table public.pay_day_changes;
  end if;
end $$;

-- Every account gets "Start" rows from its current values.
insert into public.plan_changes (user_id, field, to_value, applies, effective_from, created_at)
select s.user_id, f.field, f.value, 'start', s.created_at::date, s.created_at
  from public.user_settings s
 cross join lateral (values ('salary', s.take_home_pay), ('payday', s.month_start_day::bigint), ('save_pct', s.savings_pct::bigint)) as f(field, value)
 where f.value is not null
   and not exists (select 1 from public.plan_changes p where p.user_id = s.user_id and p.field = f.field and p.applies = 'start');

-- ---------------------------------------------------------------- profile and preferences
alter table public.user_settings
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  add column if not exists number_format text not null default 'indian'
    check (number_format in ('indian', 'international', 'european')),
  add column if not exists week_start smallint not null default 1 check (week_start in (0, 1)); -- 0 Sunday, 1 Monday

-- Profile photos: avatars/<user id>/<file>. Public read (unguessable paths), owner write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can remove their own avatar" on storage.objects;
create policy "Users can remove their own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- preferences save
-- Replaces update_settings (its payday part wrote pay_day_changes). p_changes holds only the
-- keys to change: theme, display_name, avatar_url, number_format, week_start. A key set to
-- null clears it where that is allowed (name, photo, theme).
drop function if exists public.update_settings(bigint, smallint, text, smallint, date);
create or replace function public.update_preferences(p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(p_changes->>'display_name'), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to save'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
              where k not in ('theme', 'display_name', 'avatar_url', 'number_format', 'week_start')) then
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

  update public.user_settings
     set theme = case when p_changes ? 'theme' then p_changes->>'theme' else theme end,
         display_name = case when p_changes ? 'display_name' then v_name else display_name end,
         avatar_url = case when p_changes ? 'avatar_url' then nullif(p_changes->>'avatar_url', '') else avatar_url end,
         number_format = case when p_changes ? 'number_format' then p_changes->>'number_format' else number_format end,
         week_start = case when p_changes ? 'week_start' then (p_changes->>'week_start')::smallint else week_start end,
         updated_at = now()
   where user_id = v_user;
  if not found then raise exception 'Settings not found'; end if;
end;
$$;
grant execute on function public.update_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------- plan save
-- "Apply from when?" in Settings: salary, payday and save-first % together. Null leaves a
-- field unchanged; a field equal to its current value is skipped. p_effective_from is the
-- current cycle start ('now') or the next cycle start ('next'), worked out by the app from
-- the pay-day schedule. A new change supersedes older changes to the same field that start
-- on or after it, so the newest decision wins. user_settings keeps the latest chosen values.
-- Rows written (and superseded) by one call share its statement timestamp: undo_plan_change
-- uses it to take the whole call back.
create or replace function public.update_plan(
  p_salary bigint default null,
  p_payday smallint default null,
  p_save_pct smallint default null,
  p_applies text default 'next',
  p_effective_from date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  s public.user_settings;
  f record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_applies is null or p_applies not in ('now', 'next') then raise exception 'Choose when the change applies'; end if;
  -- current_date is UTC: allow a day either side of the user's own today.
  if p_effective_from is null
     or (p_applies = 'next' and (p_effective_from < current_date or p_effective_from > current_date + 62))
     or (p_applies = 'now' and (p_effective_from > current_date + 1 or p_effective_from < current_date - 62)) then
    raise exception 'The change must start at this cycle or the next one';
  end if;
  if p_salary is not null and p_salary < 0 then raise exception 'Salary must be zero or more'; end if;
  if p_payday is not null and p_payday not between 1 and 28 and p_payday <> 31 then
    raise exception 'Pay day must be between 1 and 28, or 31 for the last day of the month';
  end if;
  if p_save_pct is not null and p_save_pct not between 0 and 100 then
    raise exception 'Savings must be between 0 and 100 percent';
  end if;

  select * into s from public.user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;

  for f in
    select * from (values
      ('salary', s.take_home_pay, p_salary),
      ('payday', s.month_start_day::bigint, p_payday::bigint),
      ('save_pct', s.savings_pct::bigint, p_save_pct::bigint)) as t(field, from_value, to_value)
     where t.to_value is not null and t.to_value is distinct from t.from_value
  loop
    update public.plan_changes
       set superseded_at = statement_timestamp()
     where user_id = v_user and field = f.field and applies <> 'start'
       and superseded_at is null and effective_from >= p_effective_from;
    insert into public.plan_changes (user_id, field, from_value, to_value, applies, effective_from, created_at)
    values (v_user, f.field, f.from_value, f.to_value, p_applies, p_effective_from, statement_timestamp());
  end loop;

  update public.user_settings
     set take_home_pay = coalesce(p_salary, take_home_pay),
         month_start_day = coalesce(p_payday, month_start_day),
         savings_pct = coalesce(p_save_pct, savings_pct),
         updated_at = now()
   where user_id = v_user;
end;
$$;
grant execute on function public.update_plan(bigint, smallint, smallint, text, date) to authenticated;

-- Undo in the "Plan updated" toast: takes back the latest update_plan call (its rows share one
-- statement timestamp), puts back the values it replaced and the pending changes it superseded.
-- Only within 15 minutes, so an old decision can't be undone by accident.
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
  select max(created_at) into v_at from public.plan_changes where user_id = v_user and applies <> 'start';
  if v_at is null or v_at < now() - interval '15 minutes' then raise exception 'Nothing to undo'; end if;

  for r in select field, from_value from public.plan_changes
            where user_id = v_user and created_at = v_at and applies <> 'start'
  loop
    update public.user_settings
       set take_home_pay = case when r.field = 'salary' then r.from_value else take_home_pay end,
           month_start_day = case when r.field = 'payday' then r.from_value::smallint else month_start_day end,
           savings_pct = case when r.field = 'save_pct' then r.from_value::smallint else savings_pct end,
           updated_at = now()
     where user_id = v_user;
  end loop;
  update public.plan_changes set superseded_at = null where user_id = v_user and superseded_at = v_at;
  delete from public.plan_changes where user_id = v_user and created_at = v_at and applies <> 'start';
end;
$$;
grant execute on function public.undo_plan_change() to authenticated;

-- ---------------------------------------------------------------- onboarding writes "Start" rows
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

  -- The plan starts over: history begins with the onboarding values ("Start" rows).
  delete from public.plan_changes where user_id = v_user;
  insert into public.plan_changes (user_id, field, to_value, applies, effective_from)
  select v_user, f.field, f.value, 'start', current_date
    from (values ('salary', p_take_home_pay), ('payday', coalesce(p_pay_day, 1)::bigint), ('save_pct', p_savings_pct::bigint)) as f(field, value)
   where f.value is not null;
end;
$$;

commit;

-- ============================================================
-- 20261121000000_account_v2.sql
-- ============================================================

-- SaveFirst v2, part 2 (design handoff v2, 2026-11-21): notification preferences, sign-in
-- history, signed-in devices, "Download all my data" and CSV import. Amounts are paise.
-- Re-runnable. The email job's schedule (pg_cron + pg_net) lives in server/supabase/cron/,
-- because it needs the project's URL and key.

-- ---------------------------------------------------------------- notification preferences
-- Toggles for Notices on the Dashboard and (hidden in the app for now) email. Quiet hours are
-- local hours in `timezone`; no email goes out inside them.
alter table public.user_settings
  add column if not exists notify_due boolean not null default true,
  add column if not exists notify_warn boolean not null default true,
  add column if not exists notify_over boolean not null default true,
  add column if not exists email_notifications boolean not null default false,
  add column if not exists weekly_summary boolean not null default false,
  add column if not exists bill_reminder_days smallint not null default 3 check (bill_reminder_days in (1, 3, 7)),
  add column if not exists quiet_hours_on boolean not null default true,
  add column if not exists quiet_from smallint not null default 22 check (quiet_from between 0 and 23),
  add column if not exists quiet_to smallint not null default 8 check (quiet_to between 0 and 23),
  add column if not exists timezone text not null default 'Asia/Kolkata' check (char_length(timezone) <= 64);

-- Emails already sent, so an hourly job never sends the same one twice.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bill', 'weekly')),
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.notification_log enable row level security;
-- No policies: only the email job (service role) reads and writes it.

-- ---------------------------------------------------------------- preferences save
-- Every preference that saves on its own (Settings, Account). Only the keys passed change.
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
  foreach v_key in array array['notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary', 'quiet_hours_on'] loop
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

-- ---------------------------------------------------------------- sign-in history
-- Written by the app's sign-in routes (service role), read by the user. City comes from the
-- host's geo header; no IP address is kept.
create table if not exists public.sign_in_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  method text not null check (method in ('password', 'google', 'code', 'link')),
  success boolean not null,
  user_agent text check (char_length(user_agent) <= 300),
  city text check (char_length(city) <= 80),
  session_id uuid
);
create index if not exists idx_sign_in_events_user on public.sign_in_events (user_id, created_at desc);
alter table public.sign_in_events enable row level security;
drop policy if exists "Users can read their own sign-in history" on public.sign_in_events;
create policy "Users can read their own sign-in history" on public.sign_in_events
  for select using (auth.uid() = user_id);

-- Records one attempt for the account with this email (unknown emails are ignored, so the
-- response never reveals whether an account exists). Keeps 90 days. Service role only.
create or replace function public.log_sign_in(
  p_email text,
  p_method text,
  p_success boolean,
  p_user_agent text default null,
  p_city text default null,
  p_session_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then return; end if;
  insert into public.sign_in_events (user_id, method, success, user_agent, city, session_id)
  values (v_user, p_method, p_success, left(p_user_agent, 300), left(p_city, 80), p_session_id);
  delete from public.sign_in_events where user_id = v_user and created_at < now() - interval '90 days';
end;
$$;
revoke execute on function public.log_sign_in(text, text, boolean, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_sign_in(text, text, boolean, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- signed-in devices
-- The signed-in user's sessions, newest activity first, with the city of the sign-in that
-- started each one. `current` marks the session making the request.
create or replace function public.list_my_sessions()
returns table (id uuid, user_agent text, city text, created_at timestamptz, last_active timestamptz, current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.user_agent,
         (select e.city from public.sign_in_events e where e.session_id = s.id and e.success
           order by e.created_at desc limit 1),
         s.created_at,
         greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc'),
         s.id = nullif(auth.jwt()->>'session_id', '')::uuid
    from auth.sessions s
   where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
   order by 5 desc;
$$;
revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

-- Signs one other device out (its refresh tokens go with the session). Not the current one:
-- that is the Sign out button.
create or replace function public.revoke_my_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_session_id = nullif(auth.jwt()->>'session_id', '')::uuid then
    raise exception 'Use Sign out for this device';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  if not found then raise exception 'Device not found'; end if;
end;
$$;
revoke execute on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- ---------------------------------------------------------------- download all my data
-- One JSON document with everything the account holds (Settings › Data).
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
    'amountsIn', 'paise',
    'currency', 'INR',
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
-- Entries checked in the app's preview (lib/csvImport.mjs): [{date, type, category, amount, note}],
-- type expense or income, amount in paise, category a name (expenses only). All rows go in or
-- none do. Exact duplicates (same date, type, category, amount and note, already saved or
-- earlier in the file) are skipped. Returns {added, duplicates}.
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
    if v_type is null or v_type not in ('expense', 'income') then
      raise exception 'Only expenses and income can be imported';
    end if;
    begin
      v_date := (r->>'date')::date;
      v_amount := (r->>'amount')::bigint;
    exception when others then
      raise exception 'Every entry needs a date and an amount';
    end;
    if v_date is null or v_amount is null or v_amount <= 0 then raise exception 'Every entry needs a date and an amount'; end if;
    v_note := nullif(left(btrim(r->>'note'), 500), '');
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
      insert into transactions (user_id, category_id, amount, type, date, note, source)
      values (v_user, v_cat, v_amount, v_type, v_date, v_note, 'import');
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'duplicates', v_dupes);
end;
$$;
grant execute on function public.import_transactions(jsonb) to authenticated;

commit;

