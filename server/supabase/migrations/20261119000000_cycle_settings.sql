-- Pay-day cycle fixes and Settings backend (plan of 2026-11-19). One file, built up phase by phase.

-- ---------------------------------------------------------------- phase 1: recurring key per cycle
-- A recurring entry's unique key was 'recurring:<item>:<YYYY-MM of its date>'. With a pay day
-- other than the 1st, one cycle spans two calendar months, so the previous cycle's entry
-- recorded late and this cycle's entry could share a calendar month and clash on the unique
-- index. The app now passes p_cycle_key: the 'YYYY-MM' of the start of the cycle the entry's
-- date falls in. Null keeps the old calendar-month key.
drop function if exists public.record_entry_with_recurring(text, bigint, date, uuid, text, uuid, boolean, smallint, boolean, text);
create function public.record_entry_with_recurring(
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
  if p_cycle_key is not null and p_cycle_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
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
