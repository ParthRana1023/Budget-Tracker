-- Budget plans: prepare a future budget cycle without touching current limits,
-- transactions or received income.
--
-- Why new tables: categories.monthly_limit holds only the live limit, and nothing
-- stores expected income or planned savings, so a future cycle cannot be planned
-- without overwriting today's budget. Additive only: no existing table changes.
-- Amounts are paise (bigint), like the rest of the schema.

create table if not exists public.budget_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cycle_start date not null,
  expected_regular_income bigint not null default 0 check (expected_regular_income >= 0),
  -- Shown separately; never counted as income until it is actually received.
  expected_variable_income bigint not null default 0 check (expected_variable_income >= 0),
  planned_savings bigint not null default 0 check (planned_savings >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cycle_start) -- also serves lookups by user_id
);
alter table public.budget_plans enable row level security;
drop policy if exists "Users can manage their own budget plans" on public.budget_plans;
create policy "Users can manage their own budget plans"
  on public.budget_plans
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.budget_plan_categories (
  plan_id uuid not null references public.budget_plans(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_limit bigint not null default 0 check (planned_limit >= 0),
  primary key (plan_id, category_id)
);
create index if not exists idx_budget_plan_categories_category on public.budget_plan_categories(category_id);
create index if not exists idx_budget_plan_categories_user on public.budget_plan_categories(user_id);
alter table public.budget_plan_categories enable row level security;
drop policy if exists "Users can manage their own budget plan categories" on public.budget_plan_categories;
create policy "Users can manage their own budget plan categories"
  on public.budget_plan_categories
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.budget_plans p where p.id = plan_id and p.user_id = auth.uid())
    and exists (select 1 from public.categories c where c.id = category_id and c.user_id = auth.uid())
  );

-- Save (insert or replace) the plan for one cycle and its category limits in one step.
-- p_limits: [{"category_id": "<uuid>", "planned_limit": <paise>}, ...]
create or replace function public.save_budget_plan(
  p_cycle_start date,
  p_expected_regular_income bigint,
  p_expected_variable_income bigint,
  p_planned_savings bigint,
  p_limits jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_plan uuid;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_cycle_start is null then raise exception 'Cycle start is required'; end if;
  if coalesce(p_expected_regular_income, -1) < 0
     or coalesce(p_expected_variable_income, -1) < 0
     or coalesce(p_planned_savings, -1) < 0 then
    raise exception 'Planned amounts must be zero or more';
  end if;
  if jsonb_typeof(coalesce(p_limits, '[]'::jsonb)) <> 'array' then
    raise exception 'Category limits must be a list';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_limits, '[]'::jsonb)) e
    where (e->>'planned_limit') is null or (e->>'planned_limit')::bigint < 0
  ) then
    raise exception 'Category limits must be zero or more';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_limits, '[]'::jsonb)) e
    where not exists (
      select 1 from public.categories c
      where c.id = (e->>'category_id')::uuid and c.user_id = auth.uid()
    )
  ) then
    raise exception 'Category not found';
  end if;

  insert into public.budget_plans(user_id, cycle_start, expected_regular_income, expected_variable_income, planned_savings)
  values (auth.uid(), p_cycle_start, p_expected_regular_income, p_expected_variable_income, p_planned_savings)
  on conflict (user_id, cycle_start) do update
    set expected_regular_income = excluded.expected_regular_income,
        expected_variable_income = excluded.expected_variable_income,
        planned_savings = excluded.planned_savings,
        updated_at = now()
  returning id into v_plan;

  delete from public.budget_plan_categories where plan_id = v_plan;
  insert into public.budget_plan_categories(plan_id, category_id, user_id, planned_limit)
  select v_plan, (e->>'category_id')::uuid, auth.uid(), (e->>'planned_limit')::bigint
  from jsonb_array_elements(coalesce(p_limits, '[]'::jsonb)) e;

  return v_plan;
end;
$$;

-- Copy a plan's category limits into the live categories.monthly_limit.
-- Only runs when the user explicitly applies a plan. Returns the number of categories updated.
create or replace function public.apply_budget_plan(p_plan_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from public.budget_plans where id = p_plan_id and user_id = auth.uid()) then
    raise exception 'Budget plan not found';
  end if;

  update public.categories c
     set monthly_limit = pc.planned_limit,
         updated_at = now()
    from public.budget_plan_categories pc
   where pc.plan_id = p_plan_id
     and pc.category_id = c.id
     and c.user_id = auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.save_budget_plan(date, bigint, bigint, bigint, jsonb) to authenticated;
grant execute on function public.apply_budget_plan(uuid) to authenticated;
