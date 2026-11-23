-- Payment method tag (migration 20261124000000_payment_methods).
begin;

select plan(9);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'methods@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

-- ================================================================ the tag itself
select lives_ok($$insert into public.transactions (user_id, type, amount, date, note, payment_method)
                  values ('33333333-3333-3333-3333-333333333333', 'expense', 25000, '2026-11-24', 'Chai', 'upi')$$,
  'an expense saves with a method');
select throws_ok($$insert into public.transactions (user_id, type, amount, date, note, payment_method)
                   values ('33333333-3333-3333-3333-333333333333', 'expense', 25000, '2026-11-24', 'Chai', 'paypal')$$,
  '23514', null, 'only the five methods are allowed');
select is((select count(*)::int from public.transactions where payment_method is null), 0,
  'nothing gets a method it wasn''t given');

-- ================================================================ recurring default
insert into ids select 'rent', public.record_entry_with_recurring(
  'expense', 2800000, '2026-10-25', (select id from public.categories where name = 'Rent / Housing'), 'Rent',
  null, true, 25::smallint, false, 'salary', '2026-10-25');
insert into ids values ('item', (select id from public.recurring_items where name = 'Rent'));
select is((select payment_method from public.transactions where id = (select id from ids where k = 'rent')), null,
  'an item without a default posts without a method');

update public.recurring_items set payment_method = 'debit_card' where id = (select id from ids where k = 'item');
insert into ids select 'nov', public.record_entry_with_recurring(
  'expense', 2800000, '2026-11-25', (select id from public.categories where name = 'Rent / Housing'), 'Rent',
  (select id from ids where k = 'item'), false, null, false, 'salary', '2026-11-25');
select is((select payment_method from public.transactions where id = (select id from ids where k = 'nov')), 'debit_card',
  'a posted entry takes the item''s default method');

insert into public.transactions (user_id, type, amount, date, note, external_id, payment_method)
values ('33333333-3333-3333-3333-333333333333', 'expense', 2800000, '2026-12-25', 'Rent',
        'recurring:' || (select id from ids where k = 'item') || ':2026-12-25', 'upi');
select is((select payment_method from public.transactions where date = '2026-12-25'), 'upi',
  'a method given on the entry wins over the default');

-- ================================================================ CSV import
select is(public.import_transactions('[
  {"date": "2026-11-20", "type": "expense", "amount": 50000, "note": "Fuel", "payment_method": "credit_card"},
  {"date": "2026-11-21", "type": "expense", "amount": 30000, "note": "Lunch"},
  {"date": "2026-11-22", "type": "income", "amount": 10000, "note": "Refund", "payment_method": "upi"}
]'::jsonb), '{"added": 3, "duplicates": 0}'::jsonb, 'import takes an optional method');
select is((select string_agg(note || ':' || coalesce(payment_method, '-'), ',' order by date)
             from public.transactions where source = 'import'),
  'Fuel:credit_card,Lunch:-,Refund:-', 'methods are kept for expenses only');
select throws_ok($$select public.import_transactions('[{"date": "2026-11-23", "type": "expense", "amount": 100, "payment_method": "cheque"}]')$$,
  'P0001', 'Unknown payment method cheque', 'an unknown method stops the import');

select * from finish();
rollback;
