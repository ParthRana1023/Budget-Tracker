-- Recurring income / expenses: record-with-recurring. Items never record themselves
-- (design handoff): the automatic recorder is gone.
begin;

select plan(24);

-- ---------------------------------------------------------------- users
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@example.com', '', now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('66666666-6666-6666-6666-666666666666'::uuid), -- U6 record_entry_with_recurring
  ('77777777-7777-7777-7777-777777777777'::uuid)  -- U7 someone else's data
) as t(u);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- ---------------------------------------------------------------- fixtures (as table owner)
insert into public.recurring_items (id, user_id, name, amount, type, category_id, day_of_month, active, income_type, starts_on) values
  -- U7: belongs to someone else
  ('a7000000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Not yours', 999900, 'expense', (select id from public.categories where user_id='77777777-7777-7777-7777-777777777777' and name='Health'), 3, true, 'salary', '2026-11-01');


select hasnt_function('public', 'process_due_recurring', 'the automatic recorder no longer exists');

set local role authenticated;

-- ================================================================ U6: record an entry with a recurring schedule
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
insert into ids values ('health', (select id from public.categories where name = 'Health'));

insert into ids select 'gym_tx', public.record_entry_with_recurring('expense', 150000, '2026-11-03', (select id from ids where k = 'health'), 'Gym', null, true, 10::smallint);
select is((select name || '|' || amount || '|' || type || '|' || day_of_month || '|' || starts_on from public.recurring_items),
  'Gym|150000|expense|10|2026-11-03', 'ticking "recurring" creates the schedule with the entered values and the chosen day');
select is((select count(*)::int from public.transactions), 1, 'and records exactly one transaction: the entry itself');
select is((select source || ' ' || date::text || ' ' || external_id from public.transactions),
  'manual 2026-11-03 recurring:' || (select id from public.recurring_items) || ':2026-11', 'that transaction is the manual entry, carrying this month''s recurring key');

select public.record_entry_with_recurring('expense', 90000, '2026-11-04', (select id from ids where k = 'health'), null, null, true, null);
select is((select name from public.recurring_items where day_of_month is null), 'Health', 'with no note the schedule is named after the category');

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


-- ================================================================ isolation
reset role;
select is((select count(*)::int from public.transactions where user_id = '77777777-7777-7777-7777-777777777777'), 0, 'U7 (not signed in) has nothing recorded on their behalf');

select * from finish();
rollback;
