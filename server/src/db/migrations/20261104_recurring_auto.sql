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
