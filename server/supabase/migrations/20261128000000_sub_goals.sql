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
