-- Legacy-category migration + starter-category function.
--
-- The migration (server/src/db/migrations/20261103_canonical_categories.sql) is
-- `select public.ensure_starter_categories(id) from auth.users;`, so running that
-- statement twice here is exactly "apply the migration, then apply it again".
begin;

select plan(17);

-- Four users. The signup trigger seeds each with the 13 canonical categories; we
-- then wipe that and rebuild the *pre-migration* ("legacy") state by hand.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', u || '@example.com', '', now(), '{}'::jsonb, '{}'::jsonb
from (values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),  -- A: ordinary legacy user
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid),  -- B: has BOTH legacy and canonical EMI labels
  ('cccccccc-cccc-cccc-cccc-cccccccccccc'::uuid),  -- C: re-typed "Groceries" as a fixed category
  ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid)   -- D: lower-case "groceries"
) as t(u);

delete from public.categories
 where user_id in ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','cccccccc-cccc-cccc-cccc-cccccccccccc','dddddddd-dddd-dddd-dddd-dddddddddddd');

insert into public.categories (id, user_id, name, type, monthly_limit) values
  ('a0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'EMI & Loans',     'fixed',    1500000),
  ('a0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Transport & Fuel', 'flexible',  500000),
  ('a0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Groceries',        'flexible', 1200000),
  ('a0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Gym',              'flexible',  200000),
  ('b0000000-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EMI & Loans',     'fixed',        111),
  ('b0000000-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'EMI / Loans',     'fixed',        222),
  ('c0000000-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Groceries',        'fixed',     777000),
  ('d0000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'groceries',        'flexible',  333000);

-- A transaction on a legacy category: the rename must keep it attached.
insert into public.transactions (id, user_id, category_id, amount, type, date, note)
values ('a1000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        'a0000000-0000-0000-0000-000000000001', 1500000, 'expense', '2026-11-01', 'EMI');

-- ===== Apply the migration (first time) =====
select public.ensure_starter_categories(id) from auth.users;

select is(
  (select count(*)::integer from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  14, 'A: 13 starter categories + 1 custom category');
select is(
  (select count(*)::integer from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name in ('EMI & Loans', 'Transport & Fuel')),
  0, 'A: legacy labels no longer exist');
select is(
  (select monthly_limit from public.categories where id = 'a0000000-0000-0000-0000-000000000001' and name = 'EMI / Loans'),
  1500000::bigint, 'A: renamed EMI category keeps its id and its custom limit');
select is(
  (select monthly_limit from public.categories where id = 'a0000000-0000-0000-0000-000000000002' and name = 'Transport / Fuel'),
  500000::bigint, 'A: renamed Transport category keeps its id and its custom limit');
select is(
  (select c.name from public.transactions t join public.categories c on c.id = t.category_id where t.id = 'a1000000-0000-0000-0000-000000000001'),
  'EMI / Loans', 'A: existing transaction stays attached to the renamed category');
select is(
  (select monthly_limit from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Groceries'),
  1200000::bigint, 'A: an existing canonical category keeps its custom limit');
select is(
  (select monthly_limit from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Gym'),
  200000::bigint, 'A: a custom category is untouched');
select is(
  (select monthly_limit from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Travel'),
  0::bigint, 'A: a missing starter category is backfilled with no limit set');

select is(
  (select count(*)::integer from public.categories where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and name in ('EMI & Loans', 'EMI / Loans')),
  2, 'B: legacy + canonical EMI rows both survive (no rename into a duplicate)');
select is(
  (select count(*)::integer from public.categories where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and name = 'EMI / Loans'),
  1, 'B: still exactly one canonical EMI row');
select is(
  (select array_agg(monthly_limit order by monthly_limit) from public.categories where user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' and name like 'EMI%'),
  array[111::bigint, 222::bigint], 'B: both EMI limits preserved');
select is(
  (select count(*)::integer from public.categories where user_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and lower(name) = 'groceries'),
  1, 'C: a starter name the user changed to another type is not duplicated');
select is(
  (select count(*)::integer from public.categories where user_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and lower(name) = 'groceries'),
  1, 'D: starter matching is case-insensitive');

-- ===== Apply it again: must change nothing =====
create temp table after_first_run as
  select user_id, id, name, type, monthly_limit from public.categories;

select public.ensure_starter_categories(id) from auth.users;

select is_empty(
  $$ (select * from after_first_run except select user_id, id, name, type, monthly_limit from public.categories)
     union all
     (select user_id, id, name, type, monthly_limit from public.categories except select * from after_first_run) $$,
  'second run of the migration changes no rows (idempotent)');

-- ===== Behaviour as a signed-in user (what the "Restore" button calls) =====
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

reset role;
delete from public.categories where user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and name = 'Travel';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select is(public.ensure_starter_categories(), 1, 'restore re-creates exactly the one deleted starter category');
select is(public.ensure_starter_categories(), 0, 'restore is a no-op when nothing is missing');

select throws_ok(
  $$select public.ensure_starter_categories('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')$$,
  '42501', null,
  'a signed-in user cannot seed categories for someone else');

reset role;
select * from finish();
rollback;
