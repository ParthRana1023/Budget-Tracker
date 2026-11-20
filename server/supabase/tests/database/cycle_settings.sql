-- Pay-day cycle fixes and Settings backend (migration 20261119000000_cycle_settings).
begin;

select plan(34);

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
insert into public.plan_changes (user_id, field, to_value, applies, effective_from)
values ('99999999-9999-9999-9999-999999999999', 'payday', 15, 'next', '2027-01-01');
set local role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', true);

select lives_ok($$select public.complete_onboarding(null, 31::smallint, null)$$, 'onboarding accepts 31 (last day of the month)');
select is((select month_start_day from public.user_settings), 31::smallint, 'pay day 31 is saved');
select throws_ok($$select public.complete_onboarding(null, 30::smallint, null)$$, 'P0001',
  'Pay day must be between 1 and 28, or 31 for the last day of the month', 'pay day 30 rejected');
select is((select string_agg(field || '=' || to_value || ':' || applies, ',' order by field) from public.plan_changes),
  'payday=31:start', 'onboarding starts the plan history with the values it saved');

select lives_ok($$insert into public.plan_changes (user_id, field, to_value, applies, effective_from)
  values ('88888888-8888-8888-8888-888888888888', 'payday', 25, 'next', '2026-12-31')$$, 'a user can record their own plan change');
select throws_ok($$insert into public.plan_changes (user_id, field, to_value, applies, effective_from)
  values ('88888888-8888-8888-8888-888888888888', 'payday', 29, 'next', '2027-01-25')$$, '23514', null, 'pay day 29 is not a valid change');
select is((select count(*)::int from public.plan_changes), 2, 'another user''s plan history is invisible');
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

-- ================================================================ phase 5: settings backend
-- (v2) Preferences and the plan save replace update_settings and pay_day_changes.
select hasnt_table('public', 'pay_day_changes', 'pay_day_changes is folded into plan_changes');
select hasnt_function('public', 'update_settings', 'update_settings is replaced by update_preferences and update_plan');

select public.update_preferences('{"theme": "system", "number_format": "european", "week_start": 0}');
select is((select theme || '|' || number_format || '|' || week_start from public.user_settings), 'system|european|0',
  'theme, number format and week start are saved to the account');
select public.update_preferences('{"display_name": "  Priya  "}');
select is((select display_name || '|' || theme from public.user_settings), 'Priya|system', 'only the keys passed change');
select throws_ok($$select public.update_preferences('{"theme": "blue"}')$$, 'P0001', 'Theme must be dark, light or system', 'unknown theme rejected');
select throws_ok($$select public.update_preferences('{"currency": "usd"}')$$, 'P0001', 'Unknown setting', 'unknown keys rejected');

-- Plan: save-first % applies to this cycle; payday (31) changes from the next cycle start.
select public.update_plan(p_save_pct => 30::smallint, p_applies => 'now', p_effective_from => current_date);
select is((select savings_pct || '|' || string_agg(field || ':' || coalesce(from_value::text, '-') || '>' || to_value || ':' || applies, ',')
             from public.user_settings, public.plan_changes where field = 'save_pct' group by savings_pct),
  '30|save_pct:->30:now', 'a change for this cycle is saved and recorded in the history');
select public.update_plan(p_payday => 15::smallint, p_effective_from => current_date + 10);
select is((select string_agg(to_value || '@' || (effective_from - current_date), ',') from public.plan_changes
            where field = 'payday' and applies <> 'start' and superseded_at is null),
  '15@10', 'a new pay day starts at the next cycle and supersedes a later pending change');
select public.update_plan(p_payday => 20::smallint, p_effective_from => current_date + 10);
select is((select string_agg(to_value::text, ',' order by created_at) filter (where superseded_at is null) || ' of '
                || count(*) from public.plan_changes where field = 'payday' and applies <> 'start'),
  '20 of 3', 'changing it again replaces the pending change; every change stays in the history');
select throws_ok($$select public.update_plan(p_payday => 10::smallint, p_effective_from => current_date - 5)$$,
  'P0001', 'The change must start at this cycle or the next one', 'a next-cycle start in the past is rejected');
select throws_ok($$select public.update_plan(p_salary => 100, p_applies => 'later', p_effective_from => current_date)$$,
  'P0001', 'Choose when the change applies', 'only now or next');

-- Delete my account.
select public.delete_my_account();
reset role;
select is((select count(*)::int from auth.users where id = '88888888-8888-8888-8888-888888888888'), 0, 'the account is deleted');
select is((select count(*)::int from public.transactions where user_id = '88888888-8888-8888-8888-888888888888')
        + (select count(*)::int from public.user_settings where user_id = '88888888-8888-8888-8888-888888888888')
        + (select count(*)::int from public.recurring_items where user_id = '88888888-8888-8888-8888-888888888888'), 0,
  'and all of its data with it');
select is((select count(*)::int from auth.users where id = '99999999-9999-9999-9999-999999999999'), 1, 'other accounts are untouched');
set local role anon;
select throws_ok($$select public.delete_my_account()$$, '42501', null, 'signed-out visitors cannot call it');

select * from finish();
rollback;
