-- Pay-day cycle fixes and Settings backend (migration 20261119000000_cycle_settings).
begin;

select plan(4);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'cycles@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);

-- ================================================================ phase 1: recurring key per cycle
-- Pay day 25: rent is due on the 25th. Last cycle's (25 Oct - 24 Nov) rent is recorded late on
-- 20 Nov, this cycle's on 25 Nov. Both dates are in November but they are different cycles.
insert into ids select 'rent', public.record_entry_with_recurring(
  'expense', 2800000, '2026-11-20', (select id from public.categories where name = 'Rent / Housing'), 'Rent',
  null, true, 25::smallint, false, 'salary', '2026-10');
insert into ids values ('item', (select id from public.recurring_items where name = 'Rent'));

select lives_ok($$
  select public.record_entry_with_recurring('expense', 2800000, '2026-11-25',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11')
$$, 'two cycles that share a calendar month can each record the item');

select is(
  (select string_agg(external_id, ',' order by date) from public.transactions),
  'recurring:' || (select id from ids where k = 'item') || ':2026-10,recurring:' || (select id from ids where k = 'item') || ':2026-11',
  'each entry is keyed by its cycle''s start month');

select throws_ok($$
  select public.record_entry_with_recurring('expense', 2800000, '2026-12-01',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11')
$$, '23505', null, 'a second entry in the same cycle is still rejected');

select throws_ok($$
  select public.record_entry_with_recurring('expense', 100, '2026-11-25',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-13')
$$, 'P0001', 'Invalid cycle', 'a malformed cycle key is rejected');

select * from finish();
rollback;
