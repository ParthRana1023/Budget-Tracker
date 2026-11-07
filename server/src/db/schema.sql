-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. USER SETTINGS TABLE
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'INR',
  month_start_day smallint not null default 1 check (month_start_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "Users can view their own settings"
  on public.user_settings for select
  using (auth.uid() = user_id);

create policy "Users can insert their own settings"
  on public.user_settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own settings"
  on public.user_settings for update
  using (auth.uid() = user_id);

-- 2. CATEGORIES TABLE
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('fixed', 'flexible')),
  monthly_limit bigint not null default 0, -- stored in minor units (paise)
  icon text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.categories enable row level security;

create policy "Users can manage their own categories"
  on public.categories for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 3. INCOME SOURCES TABLE
create table if not exists public.income_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('salary', 'variable', 'other')),
  status text not null default 'expected' check (status in ('expected', 'received')),
  amount bigint not null, -- stored in paise
  expected_date date,
  received_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.income_sources enable row level security;

create policy "Users can manage their own income sources"
  on public.income_sources for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 4. TRANSACTIONS TABLE
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  amount bigint not null, -- stored in paise
  type text not null check (type in ('expense', 'income', 'savings_transfer')),
  date date not null default current_date,
  note text,
  source text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Index for fast period filtering by user and date
create index if not exists idx_transactions_user_date on public.transactions(user_id, date);
create index if not exists idx_transactions_category on public.transactions(category_id);

alter table public.transactions enable row level security;

create policy "Users can manage their own transactions"
  on public.transactions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 5. SAVINGS GOALS TABLE
create table if not exists public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  target_amount bigint not null, -- stored in paise
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.savings_goals enable row level security;

create policy "Users can manage their own savings goals"
  on public.savings_goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 6. GOAL CONTRIBUTIONS TABLE
create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal_id uuid not null references public.savings_goals(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  amount bigint not null, -- stored in paise
  date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.goal_contributions enable row level security;

create policy "Users can manage their own goal contributions"
  on public.goal_contributions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 7. RECURRING ITEMS TABLE
create table if not exists public.recurring_items (
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
create unique index if not exists idx_transactions_recurring_month on public.transactions (user_id, external_id) where external_id like 'recurring:%';

-- AUTOMATIC SEED FUNCTION FOR NEW USERS
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


-- Trigger on user creation in auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

