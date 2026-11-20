-- Notifications, sign-in history, devices, data download and CSV import (migration 20261121000000_account_v2).
begin;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'account@example.com', '', now(), '{}'::jsonb, '{}'::jsonb),
       ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'other@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent)
values ('aaaaaaaa-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', now() - interval '2 days', now(), 'Chrome on macOS'),
       ('aaaaaaaa-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', now() - interval '5 days', now() - interval '1 day', 'Safari on iPhone'),
       ('aaaaaaaa-0000-0000-0000-000000000003', '66666666-6666-6666-6666-666666666666', now(), now(), 'Firefox');

-- ================================================================ sign-in history (service role)
set local role service_role;
select public.log_sign_in('Account@Example.com', 'password', true, 'Chrome on macOS', 'Mumbai', 'aaaaaaaa-0000-0000-0000-000000000001');
select public.log_sign_in('account@example.com', 'password', false, 'Unknown', 'Pune');
select public.log_sign_in('nobody@example.com', 'password', false);
reset role;
select is((select count(*)::int from public.sign_in_events), 2, 'attempts are logged for known emails only');

set local role authenticated;
select throws_ok($$select public.log_sign_in('account@example.com', 'password', true)$$, '42501', null,
  'signed-in users cannot write sign-in history');
select set_config('request.jwt.claims',
  '{"sub":"77777777-7777-7777-7777-777777777777","email":"account@example.com","session_id":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select string_agg(city || ':' || success, ',' order by created_at) from public.sign_in_events),
  'Mumbai:true,Pune:false', 'the user sees their own history, failed attempts too');

-- ================================================================ devices
select is((select string_agg(user_agent || ':' || coalesce(city, '-') || ':' || current, ',' order by last_active desc)
             from public.list_my_sessions()),
  'Chrome on macOS:Mumbai:true,Safari on iPhone:-:false', 'own sessions, newest first, with city and this device');
select throws_ok($$select public.revoke_my_session('aaaaaaaa-0000-0000-0000-000000000001')$$,
  'P0001', 'Use Sign out for this device', 'this device signs out with Sign out');
select throws_ok($$select public.revoke_my_session('aaaaaaaa-0000-0000-0000-000000000003')$$,
  'P0001', 'Device not found', 'someone else''s session is out of reach');
select lives_ok($$select public.revoke_my_session('aaaaaaaa-0000-0000-0000-000000000002')$$, 'another device signs out');
select is((select count(*)::int from public.list_my_sessions()), 1, 'and is gone from the list');

-- ================================================================ notification preferences
select is((select notify_due::text || notify_warn || notify_over || email_notifications || bill_reminder_days
                  || quiet_hours_on || quiet_from || '-' || quiet_to || timezone
             from public.user_settings),
  'truetruetruefalse3true22-8Asia/Kolkata', 'defaults: notices on, email off, 3 days, quiet 10 pm to 8 am');
select public.update_preferences('{"notify_warn": false, "bill_reminder_days": 7, "quiet_from": 23, "quiet_to": 6, "timezone": "Europe/London"}');
select is((select notify_warn::text || bill_reminder_days || quiet_from || '-' || quiet_to || timezone || notify_due
             from public.user_settings),
  'false723-6Europe/Londontrue', 'only the keys sent change');
select throws_ok($$select public.update_preferences('{"bill_reminder_days": 2}')$$, 'P0001',
  'Bill reminders are 1, 3 or 7 days before', 'lead time is 1, 3 or 7 days');
select throws_ok($$select public.update_preferences('{"quiet_from": 24}')$$, 'P0001',
  'Quiet hours must be whole hours', 'quiet hours are 0-23');
select throws_ok($$select public.update_preferences('{"notify_due": "yes"}')$$, 'P0001',
  'Choose on or off', 'switches are true or false');
select throws_ok($$select public.update_preferences('{"timezone": "Mars/Base"}')$$, 'P0001',
  'Unknown time zone', 'time zones are real ones');
select is((select count(*)::int from public.notification_log), 0, 'the email log is not readable by users');

-- ================================================================ CSV import
select is(public.import_transactions(jsonb_build_array(
    jsonb_build_object('date', '2026-11-02', 'type', 'expense', 'category', 'groceries', 'amount', 120000, 'note', 'DMart'),
    jsonb_build_object('date', '2026-11-02', 'type', 'expense', 'category', 'Groceries', 'amount', 120000, 'note', 'DMart'),
    jsonb_build_object('date', '2026-11-01', 'type', 'income', 'category', '', 'amount', 9000000, 'note', null))),
  '{"added": 2, "duplicates": 1}'::jsonb, 'entries go in; an exact duplicate in the file is skipped');
select is(public.import_transactions(jsonb_build_array(
    jsonb_build_object('date', '2026-11-02', 'type', 'expense', 'category', 'Groceries', 'amount', 120000, 'note', 'DMart'))),
  '{"added": 0, "duplicates": 1}'::jsonb, 'an entry already saved is skipped');
select is((select string_agg(source, ',') from public.transactions), 'import,import', 'imported entries are marked');
select throws_ok($$select public.import_transactions('[{"date":"2026-11-03","type":"expense","category":"Gym","amount":500}, {"date":"2026-11-03","type":"income","amount":500}]')$$,
  'P0001', 'No category called Gym', 'an unknown category stops the whole import');
select is((select count(*)::int from public.transactions where date = '2026-11-03'), 0, 'and nothing from it is saved');
select throws_ok($$select public.import_transactions('[{"date":"2026-11-03","type":"savings_transfer","amount":500}]')$$,
  'P0001', 'Only expenses and income can be imported', 'goal and reserve moves are not imported');

-- ================================================================ download all my data
select is((select jsonb_array_length(d->'entries') || ':' || (d->'profile'->>'email') || ':' || (d->>'amountsIn')
             from (select public.export_my_data() as d) x),
  '2:account@example.com:paise', 'everything in one document, with the email and units');

select * from finish();
rollback;
