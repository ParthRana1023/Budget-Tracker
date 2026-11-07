-- Recurring income / expenses: automatic end-of-day recording, record-with-recurring, undo.
begin;

select plan(59);

-- ---------------------------------------------------------------- users
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@example.com', '', now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('11111111-1111-1111-1111-111111111111'::uuid), -- U1 day boundary, income, manual-only, paused
  ('22222222-2222-2222-2222-222222222222'::uuid), -- U2 3-month catch-up cap
  ('33333333-3333-3333-3333-333333333333'::uuid), -- U3 manually-recorded and undone months
  ('44444444-4444-4444-4444-444444444444'::uuid), -- U4 year boundary
  ('55555555-5555-5555-5555-555555555555'::uuid), -- U5 undo
  ('66666666-6666-6666-6666-666666666666'::uuid), -- U6 record_entry_with_recurring
  ('77777777-7777-7777-7777-777777777777'::uuid)  -- U7 someone else's data
) as t(u);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- ---------------------------------------------------------------- fixtures (as table owner)
insert into public.recurring_items (id, user_id, name, amount, type, category_id, day_of_month, active, income_type, starts_on) values
  -- U1
  ('a1000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Rent',   2500000, 'expense', (select id from public.categories where user_id='11111111-1111-1111-1111-111111111111' and name='Rent / Housing'), 5,    true,  'salary', '2026-11-01'),
  ('a1000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Salary', 8000000, 'income',  null, 1,    true,  'salary', '2026-11-01'),
  ('a1000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Gym',     100000, 'expense', (select id from public.categories where user_id='11111111-1111-1111-1111-111111111111' and name='Health'), null, true,  'salary', '2026-11-01'),
  ('a1000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Paused',  50000, 'expense', (select id from public.categories where user_id='11111111-1111-1111-1111-111111111111' and name='Health'), 2,    false, 'salary', '2026-11-01'),
  -- U2: schedule started long ago
  ('a2000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Old rent', 2500000, 'expense', (select id from public.categories where user_id='22222222-2222-2222-2222-222222222222' and name='Rent / Housing'), 5, true, 'salary', '2026-01-01'),
  -- U3: October was entered by hand, September was undone
  ('a3000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'Covered', 2500000, 'expense', (select id from public.categories where user_id='33333333-3333-3333-3333-333333333333' and name='Rent / Housing'), 5, true, 'salary', '2026-10-20'),
  -- U4: year boundary
  ('a4000000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'EMI', 1200000, 'expense', (select id from public.categories where user_id='44444444-4444-4444-4444-444444444444' and name='EMI / Loans'), 28, true, 'salary', '2026-11-01'),
  -- U5: undo
  ('a5000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'Rent',   2500000, 'expense', (select id from public.categories where user_id='55555555-5555-5555-5555-555555555555' and name='Rent / Housing'), 5, true, 'salary', '2026-11-01'),
  ('a5000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555', 'Salary', 8000000, 'income', null, 1, true, 'salary', '2026-11-01'),
  -- U7: belongs to someone else
  ('a7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Not yours', 999900, 'expense', (select id from public.categories where user_id='77777777-7777-7777-7777-777777777777' and name='Health'), 3, true, 'salary', '2026-11-01');

-- U3: October occurrence entered by hand (carries the October key); September undone.
insert into public.transactions (user_id, category_id, amount, type, date, note, source, external_id)
values ('33333333-3333-3333-3333-333333333333',
        (select id from public.categories where user_id='33333333-3333-3333-3333-333333333333' and name='Rent / Housing'),
        2500000, 'expense', '2026-10-20', 'paid early', 'manual', 'recurring:a3000000-0000-0000-0000-000000000001:2026-10');
update public.recurring_items set undone_months = '{2026-09}', starts_on = '2026-09-01'
 where id = 'a3000000-0000-0000-0000-000000000001';

set local role authenticated;

-- ================================================================ U1: day boundary, income, manual-only, paused
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select is((select count(*)::int from public.process_due_recurring('2026-11-05')), 1,
  'U1 on the 5th: only the 1st-of-month salary is due; rent is not recorded until its own day has ended');
select is((select amount from public.transactions where note = 'Recurring: Salary'), 8000000::bigint, 'salary transaction has the scheduled amount');
select is((select date from public.transactions where note = 'Recurring: Salary'), '2026-11-01'::date, 'salary is dated on its scheduled day, not the day it ran');
select is((select source from public.transactions where note = 'Recurring: Salary'), 'recurring', 'automatic records are marked source = recurring');
select is((select status || ' ' || received_date::text || ' ' || type from public.income_sources where name = 'Salary'),
  'received 2026-11-01 salary', 'recurring income also creates a received income source on its scheduled day');
select is((select count(*)::int from public.transactions where note = 'Recurring: Rent'), 0, 'rent (day 5) is NOT counted on day 5 itself');

select is((select occurred_on from public.process_due_recurring('2026-11-06')), '2026-11-05'::date,
  'on the 6th rent (day 5) is recorded, dated the 5th');
select is((select count(*)::int from public.transactions where note = 'Recurring: Rent' and date = '2026-11-05' and category_id is not null),
  1, 'rent transaction has its category');
select is((select count(*)::int from public.process_due_recurring('2026-11-06')), 0, 'running again the same day records nothing (idempotent)');
select is((select count(*)::int from public.process_due_recurring('2026-11-20')), 0, 'running later in the month records nothing more');
select is((select count(*)::int from public.transactions where note in ('Recurring: Gym', 'Recurring: Paused')), 0,
  'a schedule with no day (suggest-only) and a paused schedule are never auto-recorded');
select is((select count(*)::int from public.process_due_recurring('2026-12-06')), 2, 'next month both the salary and the rent are recorded again');
select throws_ok($$select * from public.process_due_recurring(null)$$, 'P0001', 'Invalid date', 'a missing date is rejected');

-- ================================================================ U2: catch-up is capped at 3 months
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select is((select array_agg(occurred_on order by occurred_on) from public.process_due_recurring('2026-11-10')),
  array['2026-09-05', '2026-10-05', '2026-11-05']::date[],
  'a schedule that started in January catches up only the last 3 months, each on its own date');
select is((select count(*)::int from public.transactions), 3, 'exactly 3 transactions were created, none before September');

-- ================================================================ U3: manually recorded month and undone month are skipped
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
select is((select array_agg(occurred_on order by occurred_on) from public.process_due_recurring('2026-11-10')),
  array['2026-11-05']::date[],
  'September (undone) and October (already entered by hand) are skipped; only November is recorded');

-- ================================================================ U4: year boundary
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select is((select array_agg(occurred_on order by occurred_on) from public.process_due_recurring('2027-01-03')),
  array['2026-11-28', '2026-12-28']::date[],
  'across New Year: Nov and Dec are recorded, January 28th has not ended yet');

-- ================================================================ U5: undo
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
insert into ids select 'rent', transaction_id from public.process_due_recurring('2026-11-10') where item_name = 'Rent';
select is((select count(*)::int from public.transactions where source = 'recurring'), 2, 'U5: salary and rent were recorded automatically');
insert into ids select 'salary', id from public.transactions where note = 'Recurring: Salary';

select lives_ok($$select public.undo_recurring_post((select id from ids where k = 'rent'))$$, 'undoing an automatic expense works');
select is((select count(*)::int from public.transactions where note = 'Recurring: Rent'), 0, 'the undone transaction is gone');
select is((select undone_months from public.recurring_items where id = 'a5000000-0000-0000-0000-000000000001'), array['2026-11']::text[],
  'the undone month is remembered on the schedule');
select is((select count(*)::int from public.process_due_recurring('2026-11-10')), 0,
  'after an undo, the next app load does NOT record that occurrence again');

select lives_ok($$select public.undo_recurring_post((select id from ids where k = 'salary'))$$, 'undoing an automatic income works');
select is((select count(*)::int from public.transactions where note = 'Recurring: Salary'), 0, 'the income transaction is gone');
select is((select count(*)::int from public.income_sources where name = 'Salary'), 0, 'the paired income source is gone too (income is not left counted)');
select is((select count(*)::int from public.process_due_recurring('2026-11-30')), 0, 'undone income is not re-recorded either');
select is((select count(*)::int from public.process_due_recurring('2026-12-10')), 2, 'undo only affects that month: December is recorded normally');

select throws_ok($$select public.undo_recurring_post((select id from ids where k = 'rent'))$$, 'P0001', 'Nothing to undo', 'undoing twice is rejected');
select throws_ok($$select public.undo_recurring_post('00000000-0000-0000-0000-00000000dead')$$, 'P0001', 'Nothing to undo', 'undoing an unknown id is rejected');

-- ================================================================ U6: record an entry with a recurring schedule
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
insert into ids values ('health', (select id from public.categories where name = 'Health'));

insert into ids select 'gym_tx', public.record_entry_with_recurring('expense', 150000, '2026-11-03', (select id from ids where k = 'health'), 'Gym', null, true, 10::smallint);
select is((select name || '|' || amount || '|' || type || '|' || day_of_month || '|' || starts_on from public.recurring_items),
  'Gym|150000|expense|10|2026-11-03', 'ticking "recurring" creates the schedule with the entered values and the chosen day');
select is((select count(*)::int from public.transactions), 1, 'and records exactly one transaction: the entry itself');
select is((select source || ' ' || date::text || ' ' || external_id from public.transactions),
  'manual 2026-11-03 recurring:' || (select id from public.recurring_items) || ':2026-11', 'that transaction is the manual entry, carrying this month''s recurring key');
select is((select count(*)::int from public.process_due_recurring('2026-11-20')), 0,
  'the automatic recorder does not add a duplicate for the month that was entered by hand');
select is((select count(*)::int from public.transactions), 1, 'still one transaction after the recorder ran');

insert into ids select 'nodayitem', null where false; -- (placeholder keeps ids usable)
select public.record_entry_with_recurring('expense', 90000, '2026-11-04', (select id from ids where k = 'health'), null, null, true, null);
select is((select name from public.recurring_items where day_of_month is null), 'Health', 'with no note the schedule is named after the category');
select is((select count(*)::int from public.process_due_recurring('2026-12-01')), 0,
  'on 1 Dec nothing is recorded: the suggest-only schedules never are, November''s day-10 is covered by the hand entry, December''s 10th has not ended');
select is((select count(*)::int from public.process_due_recurring('2026-12-11')), 1,
  'on 11 Dec the day-10 schedule is recorded for December (the suggest-only ones still are not)');
delete from public.transactions where external_id like 'recurring:%:2026-12' and source = 'recurring'; -- keep later assertions on a clean December

select public.record_entry_with_recurring('income', 4500000, '2026-11-05', null, 'Freelance', null, true, null, false, 'variable');
select is((select type || '|' || coalesce(category_id::text, 'none') || '|' || income_type from public.recurring_items where name = 'Freelance'),
  'income|none|variable', 'income schedule has no category and keeps its income type');
select is((select t.note || '|' || t.amount from public.transactions t where t.type = 'income'), 'Income: Freelance|4500000', 'income entry is recorded');
select is((select type || ' ' || status from public.income_sources where name = 'Freelance'), 'variable received', 'with a matching received income source');
select is((select count(*)::int from public.income_sources where external_id is not null), 1, 'the income source is linked to its recurring key');

-- Using a suggestion next month records that month without touching the schedule.
select public.record_entry_with_recurring('expense', 175000, '2026-12-03', (select id from ids where k = 'health'), 'Gym', (select id from public.recurring_items where name = 'Gym'));
select is((select amount from public.recurring_items where name = 'Gym'), 150000::bigint, 'recording from a suggestion does not change the schedule unless asked');
select is((select count(*)::int from public.transactions where external_id like 'recurring:%:2026-12'), 1, 'the December occurrence is recorded with its own key');

-- Same month twice: rejected, and nothing (including a requested schedule update) sticks.
select throws_ok($$select public.record_entry_with_recurring('expense', 999900, '2026-12-20', (select id from ids where k = 'health'), 'Gym', (select id from public.recurring_items where name = 'Gym'), false, 12::smallint, true)$$,
  '23505', null, 'recording the same schedule twice in one month is rejected');
select is((select amount || '|' || day_of_month from public.recurring_items where name = 'Gym'), '150000|10',
  'the rejected call rolled back its schedule update too (atomic)');

-- Updating the schedule from a suggestion.
select public.record_entry_with_recurring('expense', 200000, '2027-01-04', (select id from ids where k = 'health'), 'Gym membership', (select id from public.recurring_items where name = 'Gym'), false, null, true);
select is((select name || '|' || amount || '|' || coalesce(day_of_month::text, 'none') from public.recurring_items where id = (select id from public.recurring_items where name = 'Gym membership')),
  'Gym membership|200000|none', 'with "update" the schedule takes the new name, amount and day (a cleared day = suggest-only)');

-- Validation: every failure leaves the books untouched.
create temp table before_counts as select (select count(*) from public.transactions) t, (select count(*) from public.recurring_items) r;
grant select on before_counts to authenticated;
select throws_ok($$select public.record_entry_with_recurring('expense', 0, '2026-11-03', (select id from ids where k = 'health'), 'x', null, true)$$, 'P0001', 'Amount must be greater than zero', 'amount 0 rejected');
select throws_ok($$select public.record_entry_with_recurring('expense', 100, '2026-11-03', (select id from ids where k = 'health'), 'x', null, true, 29::smallint)$$, 'P0001', 'Day of month must be between 1 and 28', 'day 29 rejected');
select throws_ok($$select public.record_entry_with_recurring('expense', 100, '2026-11-03', null, 'x', null, true)$$, 'P0001', 'Category not found', 'expense without a category rejected');
select throws_ok($$select public.record_entry_with_recurring('transfer', 100, '2026-11-03', null, 'x', null, true)$$, 'P0001', 'Type must be expense or income', 'unknown type rejected');
select throws_ok($$select public.record_entry_with_recurring('income', 100, '2026-11-03', null, '  ', null, true)$$, 'P0001', 'An income name is required', 'income without a name rejected');
select throws_ok($$select public.record_entry_with_recurring('expense', 100, '2026-11-03', (select id from ids where k = 'health'), 'x')$$, 'P0001', 'Nothing recurring to record', 'neither a schedule nor the recurring box: rejected');
select throws_ok($$select public.record_entry_with_recurring('income', 100, '2026-11-03', null, 'x', (select id from public.recurring_items where name = 'Gym membership'))$$, 'P0001', 'Recurring item is a different type', 'an expense schedule cannot record income');
select throws_ok($$select public.record_entry_with_recurring('expense', 100, '2026-11-03', (select id from ids where k = 'health'), 'x', 'a7000000-0000-0000-0000-000000000001')$$, 'P0001', 'Recurring item not found', 'another user''s schedule cannot be used');
select is((select (select count(*) from public.transactions) = t and (select count(*) from public.recurring_items) = r from before_counts), true, 'none of the rejected calls left any rows behind');

-- Manual records cannot be undone through the automatic-undo path.
select throws_ok($$select public.undo_recurring_post((select id from ids where k = 'gym_tx'))$$, 'P0001', 'Nothing to undo', 'only automatic records can be undone, never a manual entry');
select is((select count(*)::int from public.transactions where id = (select id from ids where k = 'gym_tx')), 1, 'the manual entry is still there');

-- ================================================================ isolation
select is((select count(*)::int from public.process_due_recurring('2026-11-10')), 0, 'U6 processing never touches another user''s schedules');
reset role;
select is((select count(*)::int from public.transactions where user_id = '77777777-7777-7777-7777-777777777777'), 0, 'U7 (not signed in) has nothing recorded on their behalf');

select * from finish();
rollback;
