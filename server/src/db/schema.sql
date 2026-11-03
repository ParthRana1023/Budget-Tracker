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
create or replace function public.handle_new_user()
returns trigger as $$
begin
  -- 1. Create default settings
  insert into public.user_settings (user_id, currency, month_start_day)
  values (new.id, 'INR', 1)
  on conflict (user_id) do nothing;

  -- 2. Seed starter categories
  -- Fixed categories
  insert into public.categories (user_id, name, type, monthly_limit) values
    (new.id, 'Rent / Housing', 'fixed', 0),
    (new.id, 'Utilities & Bills', 'fixed', 0),
    (new.id, 'EMI / Loans', 'fixed', 0),
    (new.id, 'Insurance', 'fixed', 0),
    (new.id, 'Subscriptions', 'fixed', 0);

  -- Flexible categories
  insert into public.categories (user_id, name, type, monthly_limit) values
    (new.id, 'Groceries', 'flexible', 0),
    (new.id, 'Food & Dining Out', 'flexible', 0),
    (new.id, 'Transport / Fuel', 'flexible', 0),
    (new.id, 'Shopping', 'flexible', 0),
    (new.id, 'Entertainment', 'flexible', 0),
    (new.id, 'Health', 'flexible', 0),
    (new.id, 'Travel', 'flexible', 0),
    (new.id, 'Miscellaneous', 'flexible', 0);

  -- 3. Default Emergency Fund goal
  insert into public.savings_goals (user_id, name, target_amount) values
    (new.id, 'Emergency Fund', 10000000); -- Default 1,00,000 INR

  return new;
end;
$$ language plpgsql security definer;

-- Trigger on user creation in auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

