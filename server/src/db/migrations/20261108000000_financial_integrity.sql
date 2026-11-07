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
