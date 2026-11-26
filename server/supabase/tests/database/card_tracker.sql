-- Credit cards (migration 20261127000000_card_tracker, rewritten for handoff v4).
begin;

select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'cards@example.com', '', now(), '{}'::jsonb, '{}'::jsonb),
       ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'other-cards@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
-- The other user's card, to try to borrow.
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
insert into ids select 'theirs', id from (
  insert into public.credit_cards (name, statement_day, due_day) values ('Theirs', 1, 18) returning id) c;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
select is((select count(*)::int from public.credit_cards), 0, 'another user''s cards are not visible');

-- ================================================================ one card
insert into ids select 'hdfc', id from (
  insert into public.credit_cards (name, statement_day, due_day, opening_balance)
  values ('HDFC Regalia', 20, 5, 1250000) returning id) c;
select throws_ok($$insert into public.credit_cards (name, statement_day, due_day) values ('hdfc regalia', 1, 1)$$,
  '23505', null, 'card names are unique, ignoring case');
select throws_ok($$insert into public.credit_cards (name, statement_day, due_day) values ('Bad day', 30, 1)$$,
  '23514', null, 'days are 1-28 or 31');

insert into public.transactions (user_id, type, amount, date, note, payment_method)
values ('44444444-4444-4444-4444-444444444444', 'expense', 50000, '2026-11-10', 'Dinner', 'credit_card'),
       ('44444444-4444-4444-4444-444444444444', 'expense', 20000, '2026-11-11', 'Chai', 'upi');
select is((select card_id from public.transactions where note = 'Dinner'), (select id from ids where k = 'hdfc'),
  'with one card, card spend gets it');
select is((select card_id from public.transactions where note = 'Chai'), null, 'other spend gets no card');

insert into public.transactions (user_id, type, amount, date, note)
values ('44444444-4444-4444-4444-444444444444', 'card_payment', 50000, '2026-11-30', 'Paid from savings');
select is((select card_id from public.transactions where type = 'card_payment'), (select id from ids where k = 'hdfc'),
  'with one card, a card payment gets it');
select throws_ok($$insert into public.transactions (user_id, type, amount, date, category_id)
                   values ('44444444-4444-4444-4444-444444444444', 'card_payment', 100, '2026-11-30',
                           (select id from public.categories where name = 'Groceries'))$$,
  '23514', null, 'a card payment has no category');

update public.transactions set payment_method = 'upi' where note = 'Dinner';
select is((select card_id from public.transactions where note = 'Dinner'), null, 'switched to UPI, the card is dropped');
update public.transactions set payment_method = 'credit_card' where note = 'Dinner';

select throws_ok($$insert into public.transactions (user_id, type, amount, date, payment_method, card_id)
                   values ('44444444-4444-4444-4444-444444444444', 'expense', 100, '2026-11-12', 'credit_card',
                           (select id from ids where k = 'theirs'))$$,
  'P0001', 'Unknown card', 'another user''s card is refused');

-- ================================================================ two cards
insert into ids select 'axis', id from (
  insert into public.credit_cards (name, statement_day, due_day) values ('Axis Ace', 1, 18) returning id) c;
select throws_ok($$insert into public.transactions (user_id, type, amount, date)
                   values ('44444444-4444-4444-4444-444444444444', 'card_payment', 100, '2026-11-30')$$,
  'P0001', 'Choose which card this bill was for', 'with two cards, a card payment must name one');
insert into public.transactions (user_id, type, amount, date, note, payment_method)
values ('44444444-4444-4444-4444-444444444444', 'expense', 30000, '2026-11-12', 'Fuel', 'credit_card');
select is((select card_id from public.transactions where note = 'Fuel'), null,
  'with two cards, card spend without a card is left untagged');

-- A recurring bill on Axis: its posted entry takes the item's card.
insert into ids select 'gym', id from (
  insert into public.recurring_items (user_id, name, amount, type, day_of_month, payment_method, card_id)
  values ('44444444-4444-4444-4444-444444444444', 'Gym', 150000, 'expense', 10, 'credit_card', (select id from ids where k = 'axis'))
  returning id) r;
insert into public.transactions (user_id, type, amount, date, note, external_id)
values ('44444444-4444-4444-4444-444444444444', 'expense', 150000, '2026-11-10', 'Gym',
        'recurring:' || (select id from ids where k = 'gym') || ':2026-11-10');
select is((select payment_method || ':' || (card_id = (select id from ids where k = 'axis'))
             from public.transactions where note = 'Gym'), 'credit_card:true',
  'a posted recurring entry takes the item''s method and card');

-- ================================================================ archive
update public.credit_cards set archived_at = now() where id = (select id from ids where k = 'axis');
select lives_ok($$insert into public.credit_cards (name, statement_day, due_day) values ('Axis Ace', 5, 25)$$,
  'an archived card''s name can be used again');
select is((select count(*)::int from public.transactions where card_id = (select id from ids where k = 'axis')), 1,
  'an archived card keeps its history');
delete from public.credit_cards where id = (select id from ids where k = 'hdfc');
select is((select count(*)::int from public.credit_cards where id = (select id from ids where k = 'hdfc')), 1,
  'cards can''t be deleted, only archived');

-- ================================================================ settings and download
select public.update_preferences('{"push_cards": false}');
select is((select push_cards from public.user_settings), false, 'Card bills push can be turned off');
select is(jsonb_array_length(public.export_my_data()->'cards'), 3, 'the download includes the cards');

select * from finish();
rollback;
