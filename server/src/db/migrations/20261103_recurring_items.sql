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
