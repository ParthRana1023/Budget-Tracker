-- Push subscriptions and push preferences (migration 20261123000000_push_notifications).
begin;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'push-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb),
       ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'push-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

select is((select push_bills and push_weekly and not email_notifications and not weekly_summary
             from public.user_settings where user_id = '55555555-5555-5555-5555-555555555555'),
  true, 'push kinds default on (needs a device), email defaults off');

-- ================================================================ user A turns push on
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select lives_ok($$select public.save_push_subscription('https://push.example.com/shared', 'pk', 'au', 'Chrome on Android')$$,
  'a user saves this device''s subscription');
select lives_ok($$select public.save_push_subscription('https://push.example.com/shared', 'pk2', 'au2', 'Chrome on Android')$$,
  'saving again refreshes the keys');
select is((select p256dh || ':' || device_label from public.push_subscriptions), 'pk2:Chrome on Android',
  'one row per endpoint, with the latest keys');
select throws_ok($$select public.save_push_subscription('http://push.example.com/x', 'pk', 'au')$$, 'P0001',
  'This browser gave an invalid push address', 'only https push addresses');
select throws_ok($$select public.save_push_subscription('https://push.example.com/x', '', 'au')$$, 'P0001',
  'This browser gave invalid push keys', 'keys are required');
select throws_ok($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
                   values ('55555555-5555-5555-5555-555555555555', 'https://push.example.com/direct', 'pk', 'au')$$,
  '42501', null, 'no direct inserts: saving goes through the function');
select lives_ok($$select public.update_preferences('{"push_weekly": false}')$$, 'push kinds save like other preferences');
select throws_ok($$select public.update_preferences('{"push_bills": "yes"}')$$, 'P0001', 'Choose on or off',
  'push kinds are on or off');

-- ================================================================ user B, same browser
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select public.save_push_subscription('https://push.example.com/shared', 'pk3', 'au3', 'Chrome on Android');
select is((select count(*)::int from public.push_subscriptions), 1, 'the device now belongs to the account that turned push on');

select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
select is((select count(*)::int from public.push_subscriptions), 0, 'the earlier account no longer sees it');
delete from public.push_subscriptions where endpoint = 'https://push.example.com/shared';

select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
select is((select count(*)::int from public.push_subscriptions), 1, 'another user''s delete does not touch it');
delete from public.push_subscriptions where endpoint = 'https://push.example.com/shared';
select is((select count(*)::int from public.push_subscriptions), 0, 'the owner turns push off on this device');

select * from finish();
rollback;
