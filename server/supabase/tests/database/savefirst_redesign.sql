-- SaveFirst redesign migration: onboarding, annual bills reserve, payee, skip month.
begin;

select plan(32);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('a0000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sf-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('b0000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sf-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

insert into public.income_sources (id, user_id, name, type, status, amount, expected_date) values
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'Bonus', 'variable', 'expected', 1000000, '2026-11-10'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'Probe', 'variable', 'expected', 1000000, '2026-11-10');

insert into public.savings_goals (user_id, name, target_amount)
values ('a0000000-0000-0000-0000-00000000000a', 'Emergency Fund', 10000000);

create temp table fixture as
select (select id from public.savings_goals where user_id = 'a0000000-0000-0000-0000-00000000000a' limit 1) as goal_a;
grant select on fixture to authenticated;

select is((select count(*)::int from public.savings_goals where user_id = 'b0000000-0000-0000-0000-00000000000b'), 0,
  'signing up no longer creates a starter savings goal');

-- ================================================================ onboarding
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a0000000-0000-0000-0000-00000000000a', true);

select lives_ok($$select public.complete_onboarding(
  9000000, 5::smallint, 20::smallint,
  '[{"name":"Rent","amount":2800000,"due_day":3},{"name":"Electricity","amount":250000,"due_day":null}]',
  '[{"name":"Groceries","limit":800000},{"name":"Dining out","limit":null}]')$$, 'onboarding saves');

select is((select take_home_pay || '|' || month_start_day || '|' || savings_pct || '|' || (onboarded_at is not null)
             from public.user_settings),
  '9000000|5|20|true', 'settings hold take-home pay, pay day, savings % and the onboarded time');
select is((select type || '|' || monthly_limit || '|' || due_day || '|' || is_active from public.categories where name = 'Rent'),
  'fixed|2800000|3|true', 'a bill becomes an active fixed category with its amount and due day');
select is((select due_day from public.categories where name = 'Electricity'), null::smallint, 'a bill without a due day keeps it empty');
select is((select type || '|' || monthly_limit || '|' || is_active from public.categories where name = 'Groceries'),
  'flexible|800000|true', 'a starter category with the same name is reused, with its limit');
select is((select monthly_limit from public.categories where name = 'Dining out'), 0::bigint, 'a blank limit is stored as 0 = no limit yet');
select is((select count(*)::int from public.categories where is_active), 4, 'only the chosen bills and categories are active');
select is((select is_active from public.categories where name = 'Miscellaneous'), false, 'starter categories not chosen are switched off, not deleted');
select is((select count(*)::int from public.categories where lower(name) = 'groceries'), 1, 'no duplicate category was created');

-- Running it again with nothing filled in (every step skipped) still works.
select lives_ok($$select public.complete_onboarding(null, null, null, '[]', '[]')$$, 'all steps skipped: still saves');
select is((select coalesce(take_home_pay::text, 'none') || '|' || month_start_day || '|' || coalesce(savings_pct::text, 'none') from public.user_settings),
  'none|1|none', 'skipped answers are empty and pay day falls back to the 1st');
select is((select count(*)::int from public.categories where is_active), 0, 'no bills or categories chosen: none active');
select is((select count(*)::int from public.categories where name = 'Rent'), 1, 'the earlier bill row is kept (switched off)');

select throws_ok($$select public.complete_onboarding(null, 29::smallint, null)$$, 'P0001', 'Pay day must be between 1 and 28', 'pay day 29 rejected');
select throws_ok($$select public.complete_onboarding(null, null, 101::smallint)$$, 'P0001', 'Savings must be between 0 and 100 percent', 'savings over 100% rejected');
select throws_ok($$select public.complete_onboarding(null, null, null, '[{"name":"Rent","amount":0}]')$$, 'P0001', 'Bill amounts must be greater than zero', 'a bill without an amount rejected');
select throws_ok($$select public.complete_onboarding(null, null, null, '[{"name":"Rent","amount":100,"due_day":31}]')$$, 'P0001', 'Due day must be between 1 and 28', 'due day 31 rejected');
select throws_ok($$select public.complete_onboarding(null, null, null, '[{"name":"Rent","amount":100}]', '[{"name":"rent"}]')$$, 'P0001', 'Each bill and category needs a different name', 'the same name twice rejected');
select throws_ok($$select public.complete_onboarding(null, null, null, '[{"name":"  ","amount":100}]')$$, 'P0001', 'Every bill and category needs a name', 'a blank name rejected');
select is((select count(*)::int from public.categories where is_active), 0, 'rejected calls changed nothing');

-- ================================================================ annual bills reserve
select public.allocate_windfall('a1000000-0000-0000-0000-000000000001', (select goal_a from fixture),
  300000, 1000000, '2026-11-12', 'Bonus', 200000);
select is((select amount || '|' || source from public.transactions where type = 'reserve_transfer'), '200000|windfall', 'the reserve part is its own reserve transfer, marked as windfall');
select is((select amount || '|' || source from public.transactions where type = 'savings_transfer'), '300000|windfall', 'the savings part goes to the goal, marked as windfall (not regular savings)');
select is((select amount from public.transactions where type = 'income'), 1000000::bigint, 'the full windfall is recorded as income');
select throws_ok($$select public.allocate_windfall('a1000000-0000-0000-0000-000000000002', (select goal_a from fixture), 600000, 1000000, '2026-11-12', 'Probe', 500000)$$,
  'P0001', 'Reserve allocation must be between 0 and what is left after savings', 'savings + reserve above the windfall rejected');
select throws_ok($$select public.allocate_windfall('a1000000-0000-0000-0000-000000000002', null, 0, 1000000, '2026-11-12', 'Probe', -1)$$,
  'P0001', 'Reserve allocation must be between 0 and what is left after savings', 'a negative reserve rejected');
select is((select status from public.income_sources where id = 'a1000000-0000-0000-0000-000000000002'), 'expected', 'rejected windfall stays on hold');

-- Paying a bill from the reserve, with a payee.
select lives_ok($$insert into public.transactions (user_id, amount, type, date, from_reserve, payee)
  values ('a0000000-0000-0000-0000-00000000000a', 150000, 'expense', '2026-11-13', true, 'LIC')$$, 'an expense can be paid from the reserve, with a payee');
select throws_ok($$insert into public.transactions (user_id, amount, type, date, from_reserve)
  values ('a0000000-0000-0000-0000-00000000000a', 150000, 'income', '2026-11-13', true)$$,
  '23514', null, 'only expenses can come from the reserve');

-- ================================================================ skip month
reset role;
insert into public.recurring_items (user_id, name, amount, type, day_of_month)
values ('a0000000-0000-0000-0000-00000000000a', 'Netflix', 64900, 'expense', 8);
set local role authenticated;
select lives_ok($$update public.recurring_items set skip_month = '2026-11' where name = 'Netflix'$$, 'Skip this month is stored as YYYY-MM');
select throws_ok($$update public.recurring_items set skip_month = '2026-13' where name = 'Netflix'$$, '23514', null, 'an invalid month is rejected');

-- ================================================================ isolation
select set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-00000000000b', true);
select is((select count(*)::int from public.transactions), 0, 'another user sees none of these rows');

select * from finish();
rollback;
