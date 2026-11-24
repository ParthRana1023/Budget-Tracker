-- Base currency and foreign amounts (migration 20261125000000_multicurrency).
begin;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'fx@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

update public.user_settings set take_home_pay = 9500000;
update public.categories set monthly_limit = 1000000 where name = 'Groceries';
insert into public.recurring_items (user_id, name, amount, type, day_of_month, original_amount, original_currency, fx_rate, fx_date)
values ('22222222-2222-2222-2222-222222222222', 'Netflix', 165000, 'expense', 5, 1999, 'USD', 82.5, '2026-10-01'),
       ('22222222-2222-2222-2222-222222222222', 'Spotify', 10000, 'expense', 9, 9900, 'JPY', 0.55, '2026-10-01');

-- ================================================================ guard
select throws_ok($$update public.user_settings set currency = 'USD'$$, 'P0001', 'Change the base currency in Settings',
  'the currency only changes through set_base_currency');
select throws_ok($$select public.set_base_currency('KWD')$$, 'P0001', 'Unsupported currency', 'only the 30 supported currencies');

-- ================================================================ switch INR -> JPY (2 -> 0 decimals)
select lives_ok($$select public.set_base_currency('JPY')$$, 'base currency changes before the first entry');
select is((select currency || ':' || take_home_pay from public.user_settings), 'JPY:95000',
  'salary keeps its typed value: 95,000 rupees becomes 95,000 yen');
select is((select monthly_limit from public.categories where name = 'Groceries'), 10000::bigint, 'limits rescale too');
select is((select amount || ':' || coalesce(original_currency, '-') from public.recurring_items where name = 'Spotify'), '9900:-',
  'an item typed in the new base becomes plain');
select is((select original_currency || ':' || coalesce(fx_date::text, 'none') from public.recurring_items where name = 'Netflix'),
  'USD:none', 'other foreign items wait for a rate in the new base');

-- ================================================================ consistency and recurring copy
select throws_ok($$insert into public.transactions (user_id, type, amount, date, original_currency)
                   values ('22222222-2222-2222-2222-222222222222', 'expense', 100, '2026-11-25', 'USD')$$,
  '23514', null, 'a foreign entry needs its original amount and rate');

update public.recurring_items set amount = 3000, fx_rate = 150, fx_date = '2026-11-25' where name = 'Netflix';
insert into public.transactions (user_id, type, amount, date, note, external_id)
select '22222222-2222-2222-2222-222222222222', 'expense', 3000, '2026-11-25', 'Netflix',
       'recurring:' || id || ':2026-11-25' from public.recurring_items where name = 'Netflix';
select is((select original_amount || ' ' || original_currency || ' @' || fx_rate::float8 from public.transactions where note = 'Netflix'),
  '1999 USD @150', 'a posted entry keeps the item''s original amount and rate');

-- ================================================================ after the first entry (20261126000000_base_currency_switch)
select throws_ok($$select public.set_base_currency('USD')$$, 'P0001', 'Choose when the new base currency starts',
  'after the first entry a change needs a start date');
select lives_ok($$select public.set_base_currency('JPY')$$, 'choosing the same currency is a no-op');

-- ================================================================ rate cache
select lives_ok($$select * from public.fx_rates$$, 'signed-in users read the rate cache');
select throws_ok($$insert into public.fx_rates (quote, base, rate_date, rate) values ('USD', 'INR', '2026-11-25', 1)$$,
  '42501', null, 'only the server writes rates');

select * from finish();
rollback;
