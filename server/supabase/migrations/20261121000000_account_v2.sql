-- SaveFirst v2, part 2 (design handoff v2, 2026-11-21): notification preferences, sign-in
-- history, signed-in devices, "Download all my data" and CSV import. Amounts are paise.
-- Re-runnable. The email job's schedule (pg_cron + pg_net) lives in server/supabase/cron/,
-- because it needs the project's URL and key.

-- ---------------------------------------------------------------- notification preferences
-- Toggles for Notices on the Dashboard and (hidden in the app for now) email. Quiet hours are
-- local hours in `timezone`; no email goes out inside them.
alter table public.user_settings
  add column if not exists notify_due boolean not null default true,
  add column if not exists notify_warn boolean not null default true,
  add column if not exists notify_over boolean not null default true,
  add column if not exists email_notifications boolean not null default false,
  add column if not exists weekly_summary boolean not null default false,
  add column if not exists bill_reminder_days smallint not null default 3 check (bill_reminder_days in (1, 3, 7)),
  add column if not exists quiet_hours_on boolean not null default true,
  add column if not exists quiet_from smallint not null default 22 check (quiet_from between 0 and 23),
  add column if not exists quiet_to smallint not null default 8 check (quiet_to between 0 and 23),
  add column if not exists timezone text not null default 'Asia/Kolkata' check (char_length(timezone) <= 64);

-- Emails already sent, so an hourly job never sends the same one twice.
create table if not exists public.notification_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('bill', 'weekly')),
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);
alter table public.notification_log enable row level security;
-- No policies: only the email job (service role) reads and writes it.

-- ---------------------------------------------------------------- preferences save
-- Every preference that saves on its own (Settings, Account). Only the keys passed change.
create or replace function public.update_preferences(p_changes jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(p_changes->>'display_name'), '');
  v_key text;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then raise exception 'Nothing to save'; end if;
  if exists (select 1 from jsonb_object_keys(p_changes) k
              where k not in ('theme', 'display_name', 'avatar_url', 'number_format', 'week_start',
                              'notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary',
                              'bill_reminder_days', 'quiet_hours_on', 'quiet_from', 'quiet_to', 'timezone')) then
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
  foreach v_key in array array['notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary', 'quiet_hours_on'] loop
    if p_changes ? v_key and jsonb_typeof(p_changes->v_key) <> 'boolean' then raise exception 'Choose on or off'; end if;
  end loop;
  if p_changes ? 'bill_reminder_days' and coalesce(p_changes->>'bill_reminder_days', '') not in ('1', '3', '7') then
    raise exception 'Bill reminders are 1, 3 or 7 days before';
  end if;
  foreach v_key in array array['quiet_from', 'quiet_to'] loop
    if p_changes ? v_key and coalesce(p_changes->>v_key, '') !~ '^([0-9]|1[0-9]|2[0-3])$' then
      raise exception 'Quiet hours must be whole hours';
    end if;
  end loop;
  if p_changes ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p_changes->>'timezone') then
    raise exception 'Unknown time zone';
  end if;

  update public.user_settings
     set theme = case when p_changes ? 'theme' then p_changes->>'theme' else theme end,
         display_name = case when p_changes ? 'display_name' then v_name else display_name end,
         avatar_url = case when p_changes ? 'avatar_url' then nullif(p_changes->>'avatar_url', '') else avatar_url end,
         number_format = case when p_changes ? 'number_format' then p_changes->>'number_format' else number_format end,
         week_start = case when p_changes ? 'week_start' then (p_changes->>'week_start')::smallint else week_start end,
         notify_due = coalesce((p_changes->>'notify_due')::boolean, notify_due),
         notify_warn = coalesce((p_changes->>'notify_warn')::boolean, notify_warn),
         notify_over = coalesce((p_changes->>'notify_over')::boolean, notify_over),
         email_notifications = coalesce((p_changes->>'email_notifications')::boolean, email_notifications),
         weekly_summary = coalesce((p_changes->>'weekly_summary')::boolean, weekly_summary),
         bill_reminder_days = coalesce((p_changes->>'bill_reminder_days')::smallint, bill_reminder_days),
         quiet_hours_on = coalesce((p_changes->>'quiet_hours_on')::boolean, quiet_hours_on),
         quiet_from = coalesce((p_changes->>'quiet_from')::smallint, quiet_from),
         quiet_to = coalesce((p_changes->>'quiet_to')::smallint, quiet_to),
         timezone = coalesce(p_changes->>'timezone', timezone),
         updated_at = now()
   where user_id = v_user;
  if not found then raise exception 'Settings not found'; end if;
end;
$$;
grant execute on function public.update_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------- sign-in history
-- Written by the app's sign-in routes (service role), read by the user. City comes from the
-- host's geo header; no IP address is kept.
create table if not exists public.sign_in_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  method text not null check (method in ('password', 'google', 'code', 'link')),
  success boolean not null,
  user_agent text check (char_length(user_agent) <= 300),
  city text check (char_length(city) <= 80),
  session_id uuid
);
create index if not exists idx_sign_in_events_user on public.sign_in_events (user_id, created_at desc);
alter table public.sign_in_events enable row level security;
drop policy if exists "Users can read their own sign-in history" on public.sign_in_events;
create policy "Users can read their own sign-in history" on public.sign_in_events
  for select using (auth.uid() = user_id);

-- Records one attempt for the account with this email (unknown emails are ignored, so the
-- response never reveals whether an account exists). Keeps 90 days. Service role only.
create or replace function public.log_sign_in(
  p_email text,
  p_method text,
  p_success boolean,
  p_user_agent text default null,
  p_city text default null,
  p_session_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then return; end if;
  insert into public.sign_in_events (user_id, method, success, user_agent, city, session_id)
  values (v_user, p_method, p_success, left(p_user_agent, 300), left(p_city, 80), p_session_id);
  delete from public.sign_in_events where user_id = v_user and created_at < now() - interval '90 days';
end;
$$;
revoke execute on function public.log_sign_in(text, text, boolean, text, text, uuid) from public, anon, authenticated;
grant execute on function public.log_sign_in(text, text, boolean, text, text, uuid) to service_role;

-- ---------------------------------------------------------------- signed-in devices
-- The signed-in user's sessions, newest activity first, with the city of the sign-in that
-- started each one. `current` marks the session making the request.
create or replace function public.list_my_sessions()
returns table (id uuid, user_agent text, city text, created_at timestamptz, last_active timestamptz, current boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.user_agent,
         (select e.city from public.sign_in_events e where e.session_id = s.id and e.success
           order by e.created_at desc limit 1),
         s.created_at,
         greatest(s.created_at, s.updated_at, s.refreshed_at at time zone 'utc'),
         s.id = nullif(auth.jwt()->>'session_id', '')::uuid
    from auth.sessions s
   where s.user_id = auth.uid() and (s.not_after is null or s.not_after > now())
   order by 5 desc;
$$;
revoke execute on function public.list_my_sessions() from public, anon;
grant execute on function public.list_my_sessions() to authenticated;

-- Signs one other device out (its refresh tokens go with the session). Not the current one:
-- that is the Sign out button.
create or replace function public.revoke_my_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_session_id = nullif(auth.jwt()->>'session_id', '')::uuid then
    raise exception 'Use Sign out for this device';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = auth.uid();
  if not found then raise exception 'Device not found'; end if;
end;
$$;
revoke execute on function public.revoke_my_session(uuid) from public, anon;
grant execute on function public.revoke_my_session(uuid) to authenticated;

-- ---------------------------------------------------------------- download all my data
-- One JSON document with everything the account holds (Settings › Data).
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'amountsIn', 'paise',
    'currency', 'INR',
    'profile', (select jsonb_build_object('email', auth.jwt()->>'email', 'name', s.display_name,
                       'photo', s.avatar_url, 'memberSince', s.created_at)
                  from user_settings s where s.user_id = v_user),
    'plan', (select jsonb_build_object('salary', s.take_home_pay, 'payday', s.month_start_day,
                    'saveFirstPct', s.savings_pct)
               from user_settings s where s.user_id = v_user),
    'planHistory', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' - 'id' order by p.created_at)
                               from plan_changes p where p.user_id = v_user), '[]'),
    'preferences', (select to_jsonb(s) - 'user_id' - 'take_home_pay' - 'month_start_day' - 'savings_pct'
                              - 'display_name' - 'avatar_url'
                      from user_settings s where s.user_id = v_user),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.name)
                              from categories c where c.user_id = v_user), '[]'),
    'entries', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.date, t.created_at)
                           from transactions t where t.user_id = v_user), '[]'),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at)
                             from recurring_items r where r.user_id = v_user), '[]'),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id' order by g.created_at)
                         from savings_goals g where g.user_id = v_user), '[]'),
    'goalContributions', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.date)
                                     from goal_contributions c where c.user_id = v_user), '[]'),
    'incomeOnHold', coalesce((select jsonb_agg(to_jsonb(i) - 'user_id' order by i.created_at)
                                from income_sources i where i.user_id = v_user and i.status = 'expected'), '[]')
  );
end;
$$;
grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------- CSV import
-- Entries checked in the app's preview (lib/csvImport.mjs): [{date, type, category, amount, note}],
-- type expense or income, amount in paise, category a name (expenses only). All rows go in or
-- none do. Exact duplicates (same date, type, category, amount and note, already saved or
-- earlier in the file) are skipped. Returns {added, duplicates}.
create or replace function public.import_transactions(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r jsonb;
  v_date date;
  v_type text;
  v_amount bigint;
  v_note text;
  v_cat uuid;
  v_added int := 0;
  v_dupes int := 0;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import';
  end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 entries at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_type := r->>'type';
    if v_type is null or v_type not in ('expense', 'income') then
      raise exception 'Only expenses and income can be imported';
    end if;
    begin
      v_date := (r->>'date')::date;
      v_amount := (r->>'amount')::bigint;
    exception when others then
      raise exception 'Every entry needs a date and an amount';
    end;
    if v_date is null or v_amount is null or v_amount <= 0 then raise exception 'Every entry needs a date and an amount'; end if;
    v_note := nullif(left(btrim(r->>'note'), 500), '');
    v_cat := null;
    if v_type = 'expense' and nullif(btrim(r->>'category'), '') is not null then
      select id into v_cat from categories
       where user_id = v_user and lower(name) = lower(btrim(r->>'category'))
       order by is_active desc limit 1;
      if v_cat is null then raise exception 'No category called %', btrim(r->>'category'); end if;
    end if;

    if exists (select 1 from transactions t
                where t.user_id = v_user and t.date = v_date and t.type = v_type and t.amount = v_amount
                  and t.category_id is not distinct from v_cat and coalesce(t.note, '') = coalesce(v_note, '')) then
      v_dupes := v_dupes + 1;
    else
      insert into transactions (user_id, category_id, amount, type, date, note, source)
      values (v_user, v_cat, v_amount, v_type, v_date, v_note, 'import');
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'duplicates', v_dupes);
end;
$$;
grant execute on function public.import_transactions(jsonb) to authenticated;
