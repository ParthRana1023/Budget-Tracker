-- SaveFirst Phase 2 (2026-11-23): Web Push notifications. Re-runnable.
-- A device gets push only after its user taps "Turn on" in Settings › Notifications, which
-- saves its subscription here. The hourly send-notifications job reads these rows with the
-- service role and deletes any the push service reports gone (410/404).

-- ---------------------------------------------------------------- push preferences
-- Which kinds of push a user gets on their subscribed devices. Nothing is sent without a
-- subscription, so these can default on. Email preferences stay off by default.
alter table public.user_settings
  add column if not exists push_bills boolean not null default true,
  add column if not exists push_weekly boolean not null default true;

-- ---------------------------------------------------------------- subscriptions
-- One row per browser/device. The endpoint is unique: when a second account turns push on in
-- the same browser, the row moves to that account (see save_push_subscription).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 1 and 200),
  auth text not null check (char_length(auth) between 1 and 100),
  device_label text check (char_length(device_label) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
-- Users read and remove their own rows. No insert/update policy: saving goes through
-- save_push_subscription, so an endpoint can move between accounts safely.
drop policy if exists "Users can read their own push subscriptions" on public.push_subscriptions;
create policy "Users can read their own push subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);
drop policy if exists "Users can delete their own push subscriptions" on public.push_subscriptions;
create policy "Users can delete their own push subscriptions" on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or char_length(p_endpoint) > 1000 then
    raise exception 'This browser gave an invalid push address';
  end if;
  if coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' or char_length(p_p256dh) > 200 or char_length(p_auth) > 100 then
    raise exception 'This browser gave invalid push keys';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_label), ''), 120))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        device_label = excluded.device_label,
        created_at = now();
end;
$$;
revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- preferences save
-- Same as 20261121000000_account_v2, plus push_bills and push_weekly.
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
                              'push_bills', 'push_weekly',
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
  foreach v_key in array array['notify_due', 'notify_warn', 'notify_over', 'email_notifications', 'weekly_summary',
                               'push_bills', 'push_weekly', 'quiet_hours_on'] loop
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
         push_bills = coalesce((p_changes->>'push_bills')::boolean, push_bills),
         push_weekly = coalesce((p_changes->>'push_weekly')::boolean, push_weekly),
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
