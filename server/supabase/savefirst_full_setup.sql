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

-- ============================================================
-- 20261122000000_drop_undo_recurring_post.sql
-- ============================================================

-- Clean-up (2026-11-22): undo_recurring_post was replaced by deleting the entry directly
-- (the app's Undo); nothing calls it any more.
drop function if exists public.undo_recurring_post(uuid);

-- ============================================================
-- 20261123000000_push_notifications.sql
-- ============================================================

-- SaveFirst Phase 2 (2026-11-23): Web Push notifications. Re-runnable.
-- A device gets push only after its user taps "Turn on" in Settings › Notifications, which
-- saves its subscription here. The hourly send-notifications job reads these rows with the
-- service role and deletes any the push service reports gone (410/404).

-- ---------------------------------------------------------------- push preferences
-- Which kinds of push a user gets on their subscribed devices. Nothing is sent without a
-- subscription, so these can default on. Email preferences stay off by default.
alter table public.user_settings
  add column if not exists push_bills boolean not null default true,
  add column if not exists push_weekly boolean not null default true;

-- ---------------------------------------------------------------- subscriptions
-- One row per browser/device. The endpoint is unique: when a second account turns push on in
-- the same browser, the row moves to that account (see save_push_subscription).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  device_label text check (char_length(device_label) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
-- Users read and remove their own rows. No insert/update policy: saving goes through
-- save_push_subscription, so an endpoint can move between accounts safely.
drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000 then
    raise exception 'This browser gave an invalid push address';
  end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' or char_length(p_p256dh) > 200 or char_length(p_auth) > 100 then
    raise exception 'This browser gave invalid push keys';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_label), ''), 120))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        created_at = now();
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- preferences save
-- Same as 20261121000000_account_v2, plus push_bills and push_weekly.
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
                              'push_bills', 'push_weekly',
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
                               'push_bills', 'push_weekly', 'quiet_hours_on'] loop
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

-- ============================================================
-- 20261124000000_payment_methods.sql
-- ============================================================

-- SaveFirst Phase 3 (2026-11-24): how an expense was paid. Re-runnable.
-- A tag for tracking and reports only: safe-to-spend math never reads it. Null = not recorded.

alter table public.transactions
  add column if not exists payment_method text;
alter table public.recurring_items
  add column if not exists payment_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_payment_method_check') then
    alter table public.transactions add constraint transactions_payment_method_check
      check (payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_items_payment_method_check') then
    alter table public.recurring_items add constraint recurring_items_payment_method_check
      check (payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'other'));
  end if;
end;
$$;

-- ---------------------------------------------------------------- recurring default
-- An entry posted from a recurring item (external_id 'recurring:<item id>:<cycle>') takes the
-- item's default method unless one was given. Covers every posting path: the app's
-- record_entry_with_recurring and any older RPC that inserts recurring entries.
create or replace function public.default_payment_method()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.payment_method is null and new.external_id ~ '^recurring:[0-9a-f-]{36}:' then
    select r.payment_method into new.payment_method
      from recurring_items r
     where r.id = split_part(new.external_id, ':', 2)::uuid and r.user_id = new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_default_payment_method on public.transactions;
create trigger transactions_default_payment_method before insert on public.transactions
  for each row execute procedure public.default_payment_method();

-- ---------------------------------------------------------------- CSV import
-- Same as 20261121000000_account_v2, plus an optional payment_method per row (one of the five
-- keys, or null). Duplicate detection ignores it, as before.
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

-- ============================================================
-- 20261125000000_multicurrency.sql
-- ============================================================

-- SaveFirst Phase 4 (2026-11-25): base currency and foreign-currency amounts. Re-runnable.
--
-- Every `amount` / `monthly_limit` / `target_amount` stays in the user's base currency
-- (user_settings.currency), in its minor units, so all existing math is untouched. A foreign row
-- also keeps what was typed: original_amount (minor units of original_currency), the rate used
-- (base units per 1 foreign unit, fx_rate) and the cycle start that rate belongs to (fx_date).
-- Null original_currency = typed in the base currency. Rates come from the app's /api/rates
-- (Frankfurter, ECB) and are cached in fx_rates.

-- ---------------------------------------------------------------- currencies
-- The 30 currencies Frankfurter covers. Minor-unit digits match Intl in the app
-- (client/src/lib/money.mjs ZERO_DECIMAL; its unit test checks the two agree).
create or replace function public.currency_digits(p_currency text)
returns int
language sql
immutable
as $$ select case when p_currency in ('HUF', 'IDR', 'ISK', 'JPY', 'KRW') then 0 else 2 end $$;

create or replace function public.is_supported_currency(p_currency text)
returns boolean
language sql
immutable
as $$
  select p_currency in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS',
                        'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD',
                        'THB', 'TRY', 'USD', 'ZAR')
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_currency_check') then
    alter table public.user_settings add constraint user_settings_currency_check
      check (public.is_supported_currency(currency));
  end if;
end;
$$;

-- ---------------------------------------------------------------- rate cache
-- One rate per pair and cycle start, shared by everyone. Written only by the app's server
-- (service role); readable by signed-in users.
create table if not exists public.fx_rates (
  quote text not null check (public.is_supported_currency(quote)),
  base text not null check (public.is_supported_currency(base)),
  rate_date date not null,
  rate numeric(20, 10) not null check (rate > 0),
  ecb_date date,
  fetched_at timestamptz not null default now(),
  primary key (quote, base, rate_date)
);
alter table public.fx_rates enable row level security;
drop policy if exists "Signed-in users can read rates" on public.fx_rates;
create policy "Signed-in users can read rates" on public.fx_rates for select to authenticated using (true);

-- ---------------------------------------------------------------- original amounts
do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'recurring_items', 'categories', 'savings_goals'] loop
    execute format('alter table public.%I
      add column if not exists original_amount bigint check (original_amount > 0),
      add column if not exists original_currency text check (original_currency is null or public.is_supported_currency(original_currency)),
      add column if not exists fx_rate numeric(20, 10) check (fx_rate > 0),
      add column if not exists fx_date date', t);
    if not exists (select 1 from pg_constraint where conname = t || '_original_check') then
      execute format('alter table public.%I add constraint %I check (
        (original_currency is null and original_amount is null and fx_rate is null)
        or (original_currency is not null and original_amount is not null and fx_rate is not null))', t, t || '_original_check');
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- recurring defaults
-- Same as 20261124000000_payment_methods, plus: an entry posted from a foreign-currency item at
-- the item's (current) base amount also takes the item's original amount and rate.
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
    select r.payment_method, r.amount, r.original_amount, r.original_currency, r.fx_rate, r.fx_date into item
      from recurring_items r
     where r.id = split_part(new.external_id, ':', 2)::uuid and r.user_id = new.user_id;
    if found then
      if new.payment_method is null then new.payment_method := item.payment_method; end if;
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

-- ---------------------------------------------------------------- base currency
-- Changes only through set_base_currency, which keeps the numbers people typed and enforces
-- the lock. A direct update of user_settings.currency is refused.
create or replace function public.guard_base_currency()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency and coalesce(current_setting('savefirst.set_base_currency', true), '') <> 'on' then
    raise exception 'Change the base currency in Settings';
  end if;
  return new;
end;
$$;
drop trigger if exists user_settings_guard_currency on public.user_settings;
create trigger user_settings_guard_currency before update of currency on public.user_settings
  for each row execute procedure public.guard_base_currency();

-- Allowed until the first entry. Amounts keep their typed value: ₹95,000 becomes $95,000, and
-- between currencies with different decimals the minor units are rescaled (95,000 stays 95,000).
-- Foreign rows lose their rate date, so the app re-prices them for the new base.
create or replace function public.set_base_currency(p_currency text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old text;
  f numeric;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not is_supported_currency(p_currency) then raise exception 'Unsupported currency'; end if;
  select currency into v_old from user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;
  if v_old = p_currency then return; end if;
  if exists (select 1 from transactions where user_id = v_user) then
    raise exception 'The base currency is locked after your first entry';
  end if;

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

  -- Rows typed in the new base currency become plain; other foreign rows wait for a new rate.
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
  update user_settings set currency = p_currency, updated_at = now() where user_id = v_user;
  perform set_config('savefirst.set_base_currency', 'off', true);
end;
$$;
grant execute on function public.set_base_currency(text) to authenticated;

-- ---------------------------------------------------------------- data download
-- Same as 20261121000000_account_v2, with the real currency instead of 'INR'.
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

-- ============================================================
-- 20261126000000_base_currency_switch.sql
-- ============================================================

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

-- ============================================================
-- 20261127000000_card_tracker.sql
-- ============================================================
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

-- ============================================================
-- 20261128000000_sub_goals.sql
-- ============================================================
-- SaveFirst v4 (2026-11-28): sub-goals. Re-runnable.
--
-- A goal can have sub-goals, one level deep. A main goal's target is the sum of its sub-goals'
-- targets (and, for a goal set in a foreign currency, of their original amounts). Money goes
-- only into sub-goals: a main goal takes no contributions and no "already saved". A goal that
-- already holds money is split with split_goal, which moves that money into the sub-goal the user
-- picks. Sub-goals share the main goal's currency. Deleting a main goal deletes its sub-goals (and,
-- as for any goal, their contributions).

alter table public.savings_goals
  add column if not exists parent_id uuid references public.savings_goals(id) on delete cascade;
create index if not exists idx_savings_goals_parent on public.savings_goals(parent_id) where parent_id is not null;

-- ---------------------------------------------------------------- shape and sums
-- Before a goal row is written: checks a new or moved sub-goal, and keeps a main goal's target
-- equal to the sum of its sub-goals (whatever the update tried to set).
create or replace function public.goal_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
  v_sum bigint;
  v_orig bigint;
begin
  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if new.parent_id = new.id then raise exception 'A goal can''t be its own sub-goal'; end if;
    select * into p from savings_goals where id = new.parent_id;
    if not found or p.user_id <> new.user_id then raise exception 'Main goal not found'; end if;
    if p.parent_id is not null then raise exception 'Sub-goals can''t have sub-goals of their own'; end if;
    if tg_op = 'UPDATE' and exists (select 1 from savings_goals where parent_id = new.id) then
      raise exception 'A goal with sub-goals can''t become a sub-goal';
    end if;
    -- split_goal moves the money right after; anything else would leave it on the main goal.
    if coalesce(current_setting('savefirst.split_goal', true), '') <> 'on'
       and not exists (select 1 from savings_goals where parent_id = p.id)
       and (p.saved_before > 0 or exists (select 1 from goal_contributions where goal_id = p.id)) then
      raise exception 'This goal already holds money: choose which sub-goal it goes to';
    end if;
    -- shortcut: checked when a sub-goal is added or moved, not on later edits (a base switch
    -- re-prices main and sub-goals in one statement); the app fixes a sub-goal's currency.
    if new.original_currency is distinct from p.original_currency then
      raise exception 'A sub-goal uses its main goal''s currency (%)', coalesce(p.original_currency, 'the base currency');
    end if;
  end if;

  if tg_op = 'UPDATE' and exists (select 1 from savings_goals where parent_id = new.id) then
    if new.saved_before > 0 then raise exception 'Add money to a sub-goal instead'; end if;
    select sum(target_amount), sum(original_amount) into v_sum, v_orig from savings_goals where parent_id = new.id;
    new.target_amount := v_sum;
    if new.original_currency is not null then new.original_amount := coalesce(v_orig, new.original_amount); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists savings_goals_shape on public.savings_goals;
create trigger savings_goals_shape before insert or update on public.savings_goals
  for each row execute procedure public.goal_shape();

-- After a sub-goal changes: touch its main goal (old and new, if it moved), so goal_shape works the
-- sum out again. Row triggers fire at the end of the statement, so a base switch that re-prices
-- every goal in one update sums the already re-priced sub-goals.
create or replace function public.goal_parent_sum()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' and old.parent_id is not null then
    update savings_goals set updated_at = now() where id = old.parent_id;
  end if;
  if tg_op <> 'DELETE' and new.parent_id is not null
     and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    update savings_goals set updated_at = now() where id = new.parent_id;
  end if;
  return null;
end;
$$;
drop trigger if exists savings_goals_parent_sum on public.savings_goals;
create trigger savings_goals_parent_sum after insert or update of parent_id, target_amount, original_amount or delete
  on public.savings_goals
  for each row execute procedure public.goal_parent_sum();

-- ---------------------------------------------------------------- money only into sub-goals
-- Covers record_goal_contribution, allocate_windfall and direct inserts: the whole call fails, so
-- its savings transfer is rolled back too.
create or replace function public.contribution_to_leaf()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (select 1 from savings_goals where parent_id = new.goal_id) then
    raise exception 'Add money to a sub-goal instead';
  end if;
  return new;
end;
$$;
drop trigger if exists goal_contributions_leaf on public.goal_contributions;
create trigger goal_contributions_leaf before insert or update of goal_id on public.goal_contributions
  for each row execute procedure public.contribution_to_leaf();

-- ---------------------------------------------------------------- split_goal
-- Adds sub-goals to a goal, the first time or later. p_sub_goals: [{ name, target_amount,
-- target_date?, original_amount?, saved_before? }]: target_amount in the base currency as the app
-- works it out, original_amount (in the main goal's currency) when the main goal is set in a foreign
-- one; sub-goals take the main goal's currency and rate.
-- Money the goal already holds is shared out by the app (lib/goalSplit.mjs: equally, by target or as
-- the user chooses) and passed as an exact plan: saved_before per sub-goal, and p_contributions
-- [{ id, parts: [amount per sub-goal, in p_sub_goals order] }] for every contribution of the goal.
-- Nothing may be lost or made up: the saved_before shares add up to the goal's, and each
-- contribution's parts to its amount. A split contribution keeps its transfer and date, so each
-- sub-goal's pace stays true. Returns the new sub-goals' ids, in order.
drop function if exists public.split_goal(uuid, jsonb, int);
create or replace function public.split_goal(p_goal_id uuid, p_sub_goals jsonb, p_contributions jsonb default '[]')
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  p savings_goals;
  r jsonb;
  c record;
  n int;
  i int;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into p from savings_goals where id = p_goal_id and user_id = auth.uid() for update;
  if not found then raise exception 'Goal not found'; end if;
  if p.parent_id is not null then raise exception 'Sub-goals can''t have sub-goals of their own'; end if;
  if p_sub_goals is null or jsonb_typeof(p_sub_goals) <> 'array' or jsonb_array_length(p_sub_goals) = 0 then
    raise exception 'Add at least one sub-goal';
  end if;
  n := jsonb_array_length(p_sub_goals);

  -- The plan must move exactly what the goal holds: no money lost, none made up.
  if coalesce(jsonb_typeof(p_contributions), '') <> 'array'
     or exists (select 1 from jsonb_array_elements(p_sub_goals) e where coalesce((e->>'saved_before')::bigint, 0) < 0)
     or (select coalesce(sum((e->>'saved_before')::bigint), 0) from jsonb_array_elements(p_sub_goals) e) <> p.saved_before
     or (select count(*) from goal_contributions where goal_id = p.id) <> jsonb_array_length(p_contributions)
     or (select count(distinct e->>'id') from jsonb_array_elements(p_contributions) e) <> jsonb_array_length(p_contributions) then
    raise exception 'The money already saved doesn''t add up';
  end if;
  for r in select * from jsonb_array_elements(p_contributions) loop
    select * into c from goal_contributions where id = (r->>'id')::uuid and goal_id = p.id;
    if not found or coalesce(jsonb_typeof(r->'parts'), '') <> 'array' or jsonb_array_length(r->'parts') <> n
       or exists (select 1 from jsonb_array_elements_text(r->'parts') x where x::bigint < 0)
       or (select sum(x::bigint) from jsonb_array_elements_text(r->'parts') x) <> c.amount then
      raise exception 'The money already saved doesn''t add up';
    end if;
  end loop;

  -- Off the main goal first: once it has sub-goals, it can't hold "already saved".
  if p.saved_before > 0 then update savings_goals set saved_before = 0 where id = p.id; end if;

  perform set_config('savefirst.split_goal', 'on', true);
  for r in select * from jsonb_array_elements(p_sub_goals) loop
    if coalesce(btrim(r->>'name'), '') = '' then raise exception 'Every sub-goal needs a name'; end if;
    if coalesce((r->>'target_amount')::bigint, 0) <= 0
       or (p.original_currency is not null and coalesce((r->>'original_amount')::bigint, 0) <= 0) then
      raise exception 'Sub-goal targets must be more than zero';
    end if;
    insert into savings_goals (user_id, name, target_amount, target_date, parent_id, saved_before,
                               original_amount, original_currency, fx_rate, fx_date)
    values (auth.uid(), btrim(r->>'name'), (r->>'target_amount')::bigint, nullif(r->>'target_date', '')::date, p.id,
            coalesce((r->>'saved_before')::bigint, 0),
            case when p.original_currency is not null then (r->>'original_amount')::bigint end,
            p.original_currency, p.fx_rate, p.fx_date)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  perform set_config('savefirst.split_goal', 'off', true);

  -- Each contribution becomes one row per sub-goal that gets a part of it (same transfer and date).
  for r in select * from jsonb_array_elements(p_contributions) loop
    select * into c from goal_contributions where id = (r->>'id')::uuid;
    for i in 1..n loop
      if (r->'parts'->>(i - 1))::bigint > 0 then
        insert into goal_contributions (user_id, goal_id, transaction_id, amount, date, created_at)
        values (c.user_id, v_ids[i], c.transaction_id, (r->'parts'->>(i - 1))::bigint, c.date, c.created_at);
      end if;
    end loop;
    delete from goal_contributions where id = c.id;
  end loop;
  return v_ids;
end;
$$;
grant execute on function public.split_goal(uuid, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------- editing a split transfer
-- Same as the previous update_financial_transaction, except a savings transfer split across
-- sub-goals (several contribution rows) is re-shared in proportion, so its rows still add up to
-- the new amount.
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
  v_old bigint;
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
    select sum(amount) into v_old from public.goal_contributions
     where transaction_id = p_transaction_id and user_id = auth.uid();
    if v_old > 0 then
      -- In proportion, rounded down; what rounding leaves goes to the biggest part.
      update public.goal_contributions set amount = amount * p_amount / v_old, date = p_date
       where transaction_id = p_transaction_id and user_id = auth.uid();
      update public.goal_contributions
         set amount = amount + p_amount - (select sum(amount) from public.goal_contributions
                                            where transaction_id = p_transaction_id and user_id = auth.uid())
       where id = (select id from public.goal_contributions
                    where transaction_id = p_transaction_id and user_id = auth.uid()
                    order by amount desc, id limit 1);
    end if;
  elsif v_type = 'income' then
    update public.income_sources
       set amount = p_amount, received_date = p_date
     where transaction_id = p_transaction_id and user_id = auth.uid();
  end if;
end;
$$;

-- ============================================================
-- 20261129000000_onboarding_goal.sql
-- ============================================================
-- SaveFirst v4 (2026-11-29): an optional first goal in onboarding (step 3, after Savings). Re-runnable.
--
-- Same as complete_onboarding in 20261120000000_settings_v2, plus p_goal: { name, target,
-- target_date? }. Skipping the step sends null and creates no goal; a setup left half-way saves
-- nothing, because everything is saved by this one call on the last step.

drop function if exists public.complete_onboarding(bigint, smallint, smallint, jsonb, jsonb);
create or replace function public.complete_onboarding(
  p_take_home_pay bigint,
  p_pay_day smallint,
  p_savings_pct smallint,
  p_bills jsonb default '[]'::jsonb,
  p_categories jsonb default '[]'::jsonb,
  p_goal jsonb default null
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
  v_goal_name text := nullif(btrim(p_goal->>'name'), '');
  v_goal_target bigint;
  v_goal_date date;
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
  -- Optional first goal: { name, target, target_date? } (target in minor units of the base currency).
  if p_goal is not null then
    if jsonb_typeof(p_goal) <> 'object' or v_goal_name is null then raise exception 'Give the goal a name'; end if;
    begin
      v_goal_target := (p_goal->>'target')::bigint;
      v_goal_date := nullif(p_goal->>'target_date', '')::date;
    exception when others then
      raise exception 'Enter the goal''s target and month again';
    end;
    if v_goal_target is null or v_goal_target <= 0 then raise exception 'The goal''s target must be more than zero'; end if;
    if v_goal_date is not null and v_goal_date < (date_trunc('month', current_date) + interval '1 month')::date then
      raise exception 'Pick a target month after this one';
    end if;
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

  -- The first goal. Onboarding again updates the goal of that name instead of adding a second one
  -- (only a plain goal: not a sub-goal, and not one with sub-goals, whose target is their sum).
  if p_goal is not null then
    update public.savings_goals g
       set target_amount = v_goal_target, target_date = v_goal_date,
           original_amount = null, original_currency = null, fx_rate = null, fx_date = null, updated_at = now()
     where g.id = (select x.id from public.savings_goals x
                    where x.user_id = v_user and lower(x.name) = lower(v_goal_name) and x.parent_id is null
                      and not exists (select 1 from public.savings_goals s where s.parent_id = x.id)
                    order by x.created_at limit 1);
    if not found then
      insert into public.savings_goals (user_id, name, target_amount, target_date)
      values (v_user, v_goal_name, v_goal_target, v_goal_date);
    end if;
  end if;
end;
$$;
grant execute on function public.complete_onboarding(bigint, smallint, smallint, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================
-- 20261130000000_goal_tools.sql
-- ============================================================
-- SaveFirst v4 (2026-11-30): goal tools for handoff v4 §2 / §2b / §9. Re-runnable.
--
-- unsplit_goal: Undo for a split. The sub-goals' money goes back onto the main goal and the sub-goals
--   are removed, so the goal is as it was before split_goal.
-- delete_goal: deletes a goal (and its sub-goals and their contributions) and returns what it removed,
--   so the app can offer Undo. Past savings transfers stay in the ledger, as before.
-- restore_rows: puts a snapshot back (goals, then goal contributions), for that Undo.
--   shortcut: goals and contributions only; the ledger tools (Step 4) add transactions.

-- ---------------------------------------------------------------- unsplit_goal
-- p_target_amount / p_original_amount: the main goal's own target before the split (the app has it).
-- Each sub-goal's contributions are merged back per transfer and date, so a transfer split across
-- sub-goals becomes one contribution again.
create or replace function public.unsplit_goal(p_goal_id uuid, p_target_amount bigint, p_original_amount bigint default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p savings_goals;
  v_saved bigint;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into p from savings_goals where id = p_goal_id and user_id = auth.uid() for update;
  if not found then raise exception 'Goal not found'; end if;
  if not exists (select 1 from savings_goals where parent_id = p.id) then raise exception 'This goal has no sub-goals'; end if;
  if p_target_amount is null or p_target_amount <= 0
     or (p.original_currency is not null and coalesce(p_original_amount, 0) <= 0) then
    raise exception 'The goal''s target must be more than zero';
  end if;

  select coalesce(sum(saved_before), 0) into v_saved from savings_goals where parent_id = p.id;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select c.transaction_id, sum(c.amount) as amount, c.date, min(c.created_at) as created_at
      from goal_contributions c join savings_goals g on g.id = c.goal_id
     where g.parent_id = p.id
     group by c.transaction_id, c.date
  ) x;

  -- Sub-goals go first (their contributions with them): a goal with sub-goals takes no money.
  delete from savings_goals where parent_id = p.id;
  update savings_goals
     set saved_before = v_saved,
         target_amount = p_target_amount,
         original_amount = case when original_currency is not null then p_original_amount end
   where id = p.id;
  insert into goal_contributions (user_id, goal_id, transaction_id, amount, date, created_at)
  select p.user_id, p.id, (e->>'transaction_id')::uuid, (e->>'amount')::bigint, (e->>'date')::date, (e->>'created_at')::timestamptz
    from jsonb_array_elements(v_rows) e;
end;
$$;
grant execute on function public.unsplit_goal(uuid, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------- delete_goal
-- Returns { savings_goals: [...], goal_contributions: [...] }: every row it deletes, main goal first.
create or replace function public.delete_goal(p_goal_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from savings_goals where id = p_goal_id and user_id = auth.uid()) then
    raise exception 'Goal not found';
  end if;
  select jsonb_build_object(
    'savings_goals', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.parent_id is not null, g.created_at)
        from savings_goals g
       where g.user_id = auth.uid() and (g.id = p_goal_id or g.parent_id = p_goal_id)), '[]'::jsonb),
    'goal_contributions', coalesce((
      select jsonb_agg(to_jsonb(c))
        from goal_contributions c join savings_goals g on g.id = c.goal_id
       where c.user_id = auth.uid() and (g.id = p_goal_id or g.parent_id = p_goal_id)), '[]'::jsonb)
  ) into v;
  delete from savings_goals where id = p_goal_id and user_id = auth.uid();
  return v;
end;
$$;
grant execute on function public.delete_goal(uuid) to authenticated;

-- ---------------------------------------------------------------- restore_rows
-- Re-inserts a snapshot as it was (same ids and dates), always as the signed-in user. Goals without a
-- main goal in the snapshot go first, then sub-goals, then contributions, one row at a time so each
-- goal trigger sees the rows before it. All or nothing.
create or replace function public.restore_rows(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  e jsonb;
  v_me jsonb := jsonb_build_object('user_id', auth.uid());
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_rows) is distinct from 'object' then raise exception 'Nothing to restore'; end if;
  for e in
    select x from jsonb_array_elements(coalesce(p_rows->'savings_goals', '[]'::jsonb)) x
     order by x->>'parent_id' is not null
  loop
    insert into savings_goals select (jsonb_populate_record(null::savings_goals, e || v_me)).*;
  end loop;
  for e in select x from jsonb_array_elements(coalesce(p_rows->'goal_contributions', '[]'::jsonb)) x loop
    insert into goal_contributions select (jsonb_populate_record(null::goal_contributions, e || v_me)).*;
  end loop;
end;
$$;
grant execute on function public.restore_rows(jsonb) to authenticated;

commit;
