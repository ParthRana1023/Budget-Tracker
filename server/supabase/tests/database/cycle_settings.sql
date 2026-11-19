-- Pay-day cycle fixes and Settings backend (migration 20261119000000_cycle_settings).
begin;

select plan(18);

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
  null, true, 25::smallint, false, 'salary', '2026-10-25');
insert into ids values ('item', (select id from public.recurring_items where name = 'Rent'));

select lives_ok($$
  select public.record_entry_with_recurring('expense', 2800000, '2026-11-25',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11-25')
$$, 'two cycles that share a calendar month can each record the item');

select is(
  (select string_agg(external_id, ',' order by date) from public.transactions),
  'recurring:' || (select id from ids where k = 'item') || ':2026-10-25,recurring:' || (select id from ids where k = 'item') || ':2026-11-25',
  'each entry is keyed by its cycle''s start date');

select throws_ok($$
  select public.record_entry_with_recurring('expense', 2800000, '2026-12-01',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11-25')
$$, '23505', null, 'a second entry in the same cycle is still rejected');

select throws_ok($$
  select public.record_entry_with_recurring('expense', 100, '2026-11-25',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent',
    (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11')
$$, 'P0001', 'Invalid cycle', 'a month instead of a cycle start date is rejected');

-- ================================================================ phase 2: pay-day model
reset role;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'other@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);
insert into public.pay_day_changes (user_id, pay_day, effective_from)
values ('99999999-9999-9999-9999-999999999999', 15, '2027-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);

select lives_ok($$select public.complete_onboarding(null, 31::smallint, null)$$, 'onboarding accepts 31 (last day of the month)');
select is((select month_start_day from public.user_settings), 31::smallint, 'pay day 31 is saved');
select throws_ok($$select public.complete_onboarding(null, 30::smallint, null)$$, 'P0001',
  'Pay day must be between 1 and 28, or 31 for the last day of the month', 'pay day 30 rejected');

select lives_ok($$insert into public.pay_day_changes (user_id, pay_day, effective_from)
  values ('88888888-8888-8888-8888-888888888888', 25, '2026-12-31')$$, 'a user can record their own pay-day change');
select throws_ok($$insert into public.pay_day_changes (user_id, pay_day, effective_from)
  values ('88888888-8888-8888-8888-888888888888', 29, '2027-01-25')$$, '23514', null, 'pay day 29 is not a valid change');
select is((select count(*)::int from public.pay_day_changes), 1, 'another user''s pay-day changes are invisible');
select lives_ok($$update public.recurring_items set skip_month = '2026-11-25' where name = 'Rent'$$,
  'skip_month takes a cycle start date');

-- ================================================================ phase 3: early income
-- Pay day is 31 here (set above). Salary on 29 Jan, two days early, counts toward the cycle
-- starting 31 Jan; the entry keeps its real date.
select lives_ok($$select public.record_received_income('Salary', 9500000, '2027-01-29', 'salary', '2027-01-31')$$,
  'income can count toward a cycle starting within 5 days');
select is((select date::text || ' -> ' || counts_from::text from public.transactions where note = 'Income: Salary'),
  '2027-01-29 -> 2027-01-31', 'it keeps its real date and remembers the cycle it counts toward');
select throws_ok($$select public.record_received_income('Bonus', 100, '2027-01-25', 'other', '2027-01-31')$$,
  'P0001', 'Income can only count toward a cycle that starts within 5 days', 'six days early is too early');
select throws_ok($$select public.record_entry_with_recurring('expense', 100, '2027-01-29',
    (select id from public.categories where name = 'Rent / Housing'), 'Rent', (select id from ids where k = 'item'),
    false, null, false, 'salary', '2027-01-31', '2027-01-31')$$,
  'P0001', 'Only income can count toward the next cycle', 'expenses never count toward the next cycle');
select throws_ok($$insert into public.transactions (user_id, amount, type, date, counts_from)
  values ('88888888-8888-8888-8888-888888888888', 100, 'expense', '2027-01-29', '2027-01-31')$$,
  '23514', null, 'the table rejects counts_from on an expense too');
select public.update_financial_transaction((select id from public.transactions where note = 'Income: Salary'),
  9500000, '2027-01-10', null, 'Income: Salary');
select is((select counts_from from public.transactions where note = 'Income: Salary'), null::date,
  'moving the entry out of the 5-day window drops counts_from');
select hasnt_function('public', 'record_entry_with_recurring',
  array['text', 'bigint', 'date', 'uuid', 'text', 'uuid', 'boolean', 'smallint', 'boolean', 'text', 'text'],
  'the 11-argument version is gone (no ambiguous overloads)');

select * from finish();
rollback;
