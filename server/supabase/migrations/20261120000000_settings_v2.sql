-- SaveFirst v2 (design handoff v2, 2026-11-20): effective-dated plan changes for salary,
-- payday and save-first %, plan history, profile and display preferences.
-- Amounts are paise. Re-runnable.

-- ---------------------------------------------------------------- plan history
-- Every change to salary, payday or save-first %, kept for the Plan history list.
--   applies 'start' = the onboarding value; 'now' = from the start of the cycle it was made
--   in; 'next' = from the next cycle start. effective_from is that cycle start ('start' rows:
--   the day of onboarding). superseded_at is set when a newer change replaces this one before
--   or as it takes effect; superseded rows stay in the history but no longer apply.
-- The app works out each cycle's dates and plan from the rows that apply (lib/plan.mjs).
create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_settings(user_id) on delete cascade,
  field text not null check (field in ('salary', 'payday', 'save_pct')),
  from_value bigint,
  to_value bigint not null,
  applies text not null check (applies in ('start', 'now', 'next')),
  effective_from date not null,
  superseded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint plan_changes_value_check check (
    (field = 'salary' and to_value >= 0)
    or (field = 'payday' and (to_value between 1 and 28 or to_value = 31))
    or (field = 'save_pct' and to_value between 0 and 100))
);
create index if not exists idx_plan_changes_user on public.plan_changes (user_id, field, effective_from);
alter table public.plan_changes enable row level security;
drop policy if exists "Users can manage their own plan history" on public.plan_changes;
create policy "Users can manage their own plan history" on public.plan_changes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- pay_day_changes (next-cycle payday only) is folded into plan_changes.
do $$
begin
  if to_regclass('public.pay_day_changes') is not null then
    insert into public.plan_changes (user_id, field, to_value, applies, effective_from, created_at)
    select c.user_id, 'payday', c.pay_day, 'next', c.effective_from, c.created_at
      from public.pay_day_changes c
     where not exists (select 1 from public.plan_changes p
                        where p.user_id = c.user_id and p.field = 'payday' and p.effective_from = c.effective_from);
    drop table public.pay_day_changes;
  end if;
end $$;

-- Every account gets "Start" rows from its current values.
insert into public.plan_changes (user_id, field, to_value, applies, effective_from, created_at)
select s.user_id, f.field, f.value, 'start', s.created_at::date, s.created_at
  from public.user_settings s
 cross join lateral (values ('salary', s.take_home_pay), ('payday', s.month_start_day::bigint), ('save_pct', s.savings_pct::bigint)) as f(field, value)
 where f.value is not null
   and not exists (select 1 from public.plan_changes p where p.user_id = s.user_id and p.field = f.field and p.applies = 'start');

-- ---------------------------------------------------------------- profile and preferences
alter table public.user_settings
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  add column if not exists avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  add column if not exists number_format text not null default 'indian'
    check (number_format in ('indian', 'international', 'european')),
  add column if not exists week_start smallint not null default 1 check (week_start in (0, 1)); -- 0 Sunday, 1 Monday

-- Profile photos: avatars/<user id>/<file>. Public read (unguessable paths), owner write.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can replace their own avatar" on storage.objects;
create policy "Users can replace their own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Users can remove their own avatar" on storage.objects;
create policy "Users can remove their own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- preferences save
-- Replaces update_settings (its payday part wrote pay_day_changes). p_changes holds only the
-- keys to change: theme, display_name, avatar_url, number_format, week_start. A key set to
-- null clears it where that is allowed (name, photo, theme).
drop function if exists public.update_settings(bigint, smallint, text, smallint, date);
create or replace function public.update_preferences(p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(p_changes->>'display_name'), '');
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to save'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
              where k not in ('theme', 'display_name', 'avatar_url', 'number_format', 'week_start')) then
    raise exception 'Unknown setting';
  end if;
  if p_changes ? 'theme' and p_changes->>'theme' is not null and p_changes->>'theme' not in ('dark', 'light', 'system') then
    raise exception 'Theme must be dark, light or system';
  end if;
  if char_length(v_name) > 80 then raise exception 'Name must be 80 characters or fewer'; end if;
  if p_changes ? 'number_format' and coalesce(p_changes->>'number_format', '') not in ('indian', 'international', 'european') then
    raise exception 'Number format must be indian, international or european';
  end if;
  if p_changes ? 'week_start' and coalesce(p_changes->>'week_start', '') not in ('0', '1') then
    raise exception 'Week start must be Sunday (0) or Monday (1)';
  end if;
  if char_length(p_changes->>'avatar_url') > 500 then raise exception 'Photo link is too long'; end if;

  update public.user_settings
     set theme = case when p_changes ? 'theme' then p_changes->>'theme' else theme end,
         display_name = case when p_changes ? 'display_name' then v_name else display_name end,
         avatar_url = case when p_changes ? 'avatar_url' then nullif(p_changes->>'avatar_url', '') else avatar_url end,
         number_format = case when p_changes ? 'number_format' then p_changes->>'number_format' else number_format end,
         week_start = case when p_changes ? 'week_start' then (p_changes->>'week_start')::smallint else week_start end,
         updated_at = now()
   where user_id = v_user;
  if not found then raise exception 'Settings not found'; end if;
end;
$$;
grant execute on function public.update_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------- plan save
-- "Apply from when?" in Settings: salary, payday and save-first % together. Null leaves a
-- field unchanged; a field equal to its current value is skipped. p_effective_from is the
-- current cycle start ('now') or the next cycle start ('next'), worked out by the app from
-- the pay-day schedule. A new change supersedes older changes to the same field that start
-- on or after it, so the newest decision wins. user_settings keeps the latest chosen values.
create or replace function public.update_plan(
  p_salary bigint default null,
  p_payday smallint default null,
  p_save_pct smallint default null,
  p_applies text default 'next',
  p_effective_from date default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  s public.user_settings;
  f record;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_applies is null or p_applies not in ('now', 'next') then raise exception 'Choose when the change applies'; end if;
  -- current_date is UTC: allow a day either side of the user's own today.
  if p_effective_from is null
     or (p_applies = 'next' and (p_effective_from < current_date or p_effective_from > current_date + 62))
     or (p_applies = 'now' and (p_effective_from > current_date + 1 or p_effective_from < current_date - 62)) then
    raise exception 'The change must start at this cycle or the next one';
  end if;
  if p_salary is not null and p_salary < 0 then raise exception 'Salary must be zero or more'; end if;
  if p_payday is not null and p_payday not between 1 and 28 and p_payday <> 31 then
    raise exception 'Pay day must be between 1 and 28, or 31 for the last day of the month';
  end if;
  if p_save_pct is not null and p_save_pct not between 0 and 100 then
    raise exception 'Savings must be between 0 and 100 percent';
  end if;

  select * into s from public.user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;

  for f in
    select * from (values
      ('salary', s.take_home_pay, p_salary),
      ('payday', s.month_start_day::bigint, p_payday::bigint),
      ('save_pct', s.savings_pct::bigint, p_save_pct::bigint)) as t(field, from_value, to_value)
     where t.to_value is not null and t.to_value is distinct from t.from_value
  loop
    update public.plan_changes
       set superseded_at = now()
     where user_id = v_user and field = f.field and applies <> 'start'
       and superseded_at is null and effective_from >= p_effective_from;
    insert into public.plan_changes (user_id, field, from_value, to_value, applies, effective_from)
    values (v_user, f.field, f.from_value, f.to_value, p_applies, p_effective_from);
  end loop;

  update public.user_settings
     set take_home_pay = coalesce(p_salary, take_home_pay),
         month_start_day = coalesce(p_payday, month_start_day),
         savings_pct = coalesce(p_save_pct, savings_pct),
         updated_at = now()
   where user_id = v_user;
end;
$$;
grant execute on function public.update_plan(bigint, smallint, smallint, text, date) to authenticated;

-- ---------------------------------------------------------------- onboarding writes "Start" rows
create or replace function public.complete_onboarding(
  p_take_home_pay bigint,
  p_pay_day smallint,
  p_savings_pct smallint,
  p_bills jsonb default '[]'::jsonb,
  p_categories jsonb default '[]'::jsonb
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
end;
$$;
