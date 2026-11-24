-- Base currency switch after entries (migration 20261126000000_base_currency_switch).
begin;

select plan(25);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'switch@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

-- ₹1,00,000 pay, ₹10,000 groceries, ₹28,000 rent, a $9.99 subscription, a ₹50,000 goal with
-- ₹1,000 already saved, ₹5,000 on hold, and one entry: the base is locked to a pending switch now.
update public.user_settings set take_home_pay = 10000000;
update public.categories set monthly_limit = 1000000 where name = 'Groceries';
insert into public.recurring_items (user_id, name, amount, type, day_of_month)
values ('33333333-3333-3333-3333-333333333333', 'Rent', 2800000, 'expense', 3);
insert into public.recurring_items (user_id, name, amount, type, day_of_month, original_amount, original_currency, fx_rate, fx_date)
values ('33333333-3333-3333-3333-333333333333', 'Cloud', 82917, 'expense', 18, 999, 'USD', 83, current_date);
insert into public.savings_goals (user_id, name, target_amount, saved_before)
values ('33333333-3333-3333-3333-333333333333', 'Trip', 5000000, 100000);
insert into public.income_sources (user_id, name, type, status, amount, expected_date)
values ('33333333-3333-3333-3333-333333333333', 'Bonus', 'variable', 'expected', 500000, current_date + 20);
insert into public.transactions (user_id, type, amount, date, note)
values ('33333333-3333-3333-3333-333333333333', 'expense', 50000, current_date, 'Before');
select is((select base_currency from public.transactions where note = 'Before'), 'INR', 'an entry records its base');

-- ================================================================ scheduling
select throws_ok($$select public.set_base_currency('USD')$$, 'P0001', 'Choose when the new base currency starts',
  'with entries, a new base needs its start date');
select throws_ok($$select public.set_base_currency('USD', current_date)$$, 'P0001',
  'A new base currency starts with the next cycle', 'not from today');
select lives_ok($$select public.set_base_currency('USD', current_date + 3)$$, 'saved as pending for the next cycle');
select is((select currency || '>' || currency_next || '@' || (currency_from - current_date) from public.user_settings),
  'INR>USD@3', 'this cycle stays in INR; USD from the next cycle start');
select is((select count(*)::int from public.plan_changes where field = 'currency' and superseded_at is null), 1,
  'the change is in plan history');
select throws_ok($$update public.user_settings set currency = 'USD'$$, 'P0001', 'Change the base currency in Settings',
  'the base itself still only changes through the functions');

-- Keep INR cancels it; choosing again schedules it again.
select lives_ok($$select public.set_base_currency('INR')$$, 'keeping the current base cancels the switch');
select is((select coalesce(currency_next, '-') from public.user_settings), '-', 'nothing pending');
select is((select count(*)::int from public.plan_changes where field = 'currency' and superseded_at is null), 0,
  'and its history row is set aside');
select lives_ok($$select public.set_base_currency('USD', current_date + 3)$$, 'scheduled again');

-- ================================================================ entries while pending
insert into public.transactions (user_id, type, amount, date, note)
values ('33333333-3333-3333-3333-333333333333', 'expense', 20000, current_date, 'Still INR');
insert into public.transactions (user_id, type, amount, date, note, counts_from)
values ('33333333-3333-3333-3333-333333333333', 'income', 1500, current_date, 'Early pay', current_date + 3);
select is((select string_agg(note || ':' || base_currency, ',' order by note) from public.transactions where note <> 'Before'),
  'Early pay:USD,Still INR:INR', 'entries count in the base of their cycle (early income in the new one)');

-- ================================================================ the switch
select throws_ok($$select public.apply_base_switch(0.012)$$, 'P0001', null, 'not before the new cycle starts');
reset role;
update public.user_settings set currency_from = current_date where user_id = '33333333-3333-3333-3333-333333333333';
set local role authenticated;
select throws_ok($$select public.apply_base_switch(0)$$, 'P0001', 'Enter the exchange rate', 'needs a rate');
select is(public.apply_base_switch(0.012), true, 'switches at 1 INR = 0.012 USD');

select is((select currency || ':' || coalesce(currency_next, '-') || ':' || take_home_pay from public.user_settings),
  'USD:-:120000', 'the salary is converted once: ₹1,00,000 -> $1,200.00');
select is((select amount || ' ' || original_amount || ' ' || original_currency from public.recurring_items where name = 'Rent'),
  '33600 2800000 INR', 'a bill set in INR becomes a converted item: $336.00, ₹28,000 underneath');
select is((select amount || ' ' || coalesce(original_currency, '-') from public.recurring_items where name = 'Cloud'),
  '999 -', 'a bill set in USD is plain now');
select is((select monthly_limit || ' ' || original_currency from public.categories where name = 'Groceries'),
  '12000 INR', 'a limit set in INR is converted, with the INR limit kept');
select is((select count(*)::int from public.categories where monthly_limit = 0 and original_currency is not null), 0,
  '"no limit" stays no limit');
select is((select target_amount || ' ' || original_currency || ' ' || saved_before from public.savings_goals where name = 'Trip'),
  '60000 INR 1200', 'a goal target floats from INR; money already saved is converted once');
select is((select amount from public.income_sources where name = 'Bonus'), 6000::bigint, 'income on hold is converted');
select is((select string_agg(amount || ':' || base_currency, ',' order by note) from public.transactions),
  '50000:INR,1500:USD,20000:INR', 'entries never change');
select is(public.apply_base_switch(0.012), false, 'a second call does nothing');
select throws_ok($$select public.undo_plan_change()$$, 'P0001', 'Nothing to undo',
  'plan Undo never undoes the switch or its salary conversion');

select * from finish();
rollback;
