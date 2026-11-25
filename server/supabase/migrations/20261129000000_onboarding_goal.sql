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
