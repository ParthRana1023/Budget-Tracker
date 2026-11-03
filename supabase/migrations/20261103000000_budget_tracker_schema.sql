-- Local Supabase baseline. Keep in sync with server/src/db/schema.sql and
-- the follow-up migrations in server/src/db/migrations.
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

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.user_settings (user_id, currency, month_start_day)
  values (new.id, 'INR', 1) on conflict (user_id) do nothing;
  insert into public.categories (user_id, name, type, monthly_limit) values
    (new.id, 'Rent / Housing', 'fixed', 0),
    (new.id, 'Utilities & Bills', 'fixed', 0),
    (new.id, 'EMI / Loans', 'fixed', 0),
    (new.id, 'Insurance', 'fixed', 0),
    (new.id, 'Subscriptions', 'fixed', 0),
    (new.id, 'Groceries', 'flexible', 0),
    (new.id, 'Food & Dining Out', 'flexible', 0),
    (new.id, 'Transport / Fuel', 'flexible', 0),
    (new.id, 'Shopping', 'flexible', 0),
    (new.id, 'Entertainment', 'flexible', 0),
    (new.id, 'Health', 'flexible', 0),
    (new.id, 'Travel', 'flexible', 0),
    (new.id, 'Miscellaneous', 'flexible', 0);
  insert into public.savings_goals (user_id, name, target_amount)
  values (new.id, 'Emergency Fund', 10000000);
  return new;
end;
$$ language plpgsql security definer;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Canonicalize exact historical starter labels without changing limits or custom labels.
update public.categories set name = 'EMI / Loans' where name = 'EMI & Loans' and type = 'fixed';
update public.categories set name = 'Transport / Fuel' where name = 'Transport & Fuel' and type = 'flexible';
insert into public.categories (user_id, name, type, monthly_limit)
select u.id, starter.name, starter.type, 0
from auth.users u
cross join (values
  ('Rent / Housing', 'fixed'), ('Utilities & Bills', 'fixed'), ('EMI / Loans', 'fixed'), ('Insurance', 'fixed'), ('Subscriptions', 'fixed'),
  ('Groceries', 'flexible'), ('Food & Dining Out', 'flexible'), ('Transport / Fuel', 'flexible'), ('Shopping', 'flexible'), ('Entertainment', 'flexible'), ('Health', 'flexible'), ('Travel', 'flexible'), ('Miscellaneous', 'flexible')
) as starter(name, type)
where not exists (select 1 from public.categories c where c.user_id = u.id and c.name = starter.name and c.type = starter.type);

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

create or replace function public.allocate_windfall(p_income_id uuid, p_goal_id uuid, p_savings bigint, p_total bigint, p_date date, p_note text)
returns void language plpgsql security invoker as $$
declare v_tx uuid;
begin
  update public.income_sources set status = 'received', received_date = p_date where id = p_income_id and user_id = auth.uid();
  if not found then raise exception 'Income source not found'; end if;
  if p_savings > 0 and p_goal_id is not null then
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_savings, 'savings_transfer', p_date, 'Windfall savings allocation', 'manual') returning id into v_tx;
    insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
    values(auth.uid(), p_goal_id, v_tx, p_savings, p_date);
  end if;
  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_total, 'income', p_date, p_note, 'manual');
end;
$$;
