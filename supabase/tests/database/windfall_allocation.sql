-- allocate_windfall: atomic success and failure behaviour.
begin;

select plan(26);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'windfall-a@example.com', '', now(), '{}'::jsonb, '{}'::jsonb),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'windfall-b@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

-- The signup trigger created an "Emergency Fund" goal for each user.
create temp table fixture as
select
  (select id from public.savings_goals where user_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee') as goal_a;
grant select on fixture to authenticated;

insert into public.income_sources (id, user_id, name, type, status, amount, expected_date) values
  ('e1000000-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Bonus',        'variable', 'expected', 1000000, '2026-11-10'),
  ('e1000000-0000-0000-0000-000000000002', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Spot award',   'variable', 'expected',  400000, '2026-11-10'),
  ('e1000000-0000-0000-0000-000000000003', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Probe: bad goal',     'variable', 'expected', 500000, '2026-11-10'),
  ('e1000000-0000-0000-0000-000000000004', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Probe: validation',   'variable', 'expected', 500000, '2026-11-10'),
  ('f1000000-0000-0000-0000-000000000001', 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'Other user bonus',    'variable', 'expected', 900000, '2026-11-10');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', true);

-- ===== Success: split between savings and income =====
select public.allocate_windfall(
  'e1000000-0000-0000-0000-000000000001', (select goal_a from fixture),
  500000, 1000000, '2026-11-03', 'Received Variable Pay: Bonus');

select is((select status from public.income_sources where id = 'e1000000-0000-0000-0000-000000000001'),
  'received', 'success: income source is marked received');
select is((select received_date from public.income_sources where id = 'e1000000-0000-0000-0000-000000000001'),
  '2026-11-03'::date, 'success: received date is recorded');
select is((select amount from public.transactions where type = 'savings_transfer' and date = '2026-11-03'),
  500000::bigint, 'success: one savings transfer for the allocated amount');
select is((select amount from public.transactions where type = 'income' and note = 'Received Variable Pay: Bonus'),
  1000000::bigint, 'success: one income transaction for the full windfall');
select is((select gc.amount from public.goal_contributions gc join public.transactions t on t.id = gc.transaction_id where t.type = 'savings_transfer'),
  500000::bigint, 'success: goal contribution is linked to the savings transfer');
select is((select count(*)::integer from public.transactions), 2, 'success: exactly two transactions were created');

-- ===== Success: nothing allocated to savings, no goal needed =====
select public.allocate_windfall(
  'e1000000-0000-0000-0000-000000000002', null, 0, 400000, '2026-11-03', 'Received Variable Pay: Spot award');

select is((select status from public.income_sources where id = 'e1000000-0000-0000-0000-000000000002'),
  'received', 'zero-savings: income source is marked received');
select is((select count(*)::integer from public.transactions where type = 'savings_transfer'),
  1, 'zero-savings: no savings transfer is created');
select is((select count(*)::integer from public.goal_contributions),
  1, 'zero-savings: no goal contribution is created');
select is((select count(*)::integer from public.transactions where type = 'income'),
  2, 'zero-savings: the income transaction is created');

-- ===== Failure: unknown goal fails AFTER the income update and savings insert =====
-- The foreign key on goal_contributions is the last write that can fail, so this
-- proves the earlier writes in the same call are rolled back too.
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000003', '99999999-9999-9999-9999-999999999999', 100000, 500000, '2026-11-03', 'probe')$$,
  '23503', null, 'failure: an unknown goal id is rejected');
select is((select status from public.income_sources where id = 'e1000000-0000-0000-0000-000000000003'),
  'expected', 'failure: the income source is NOT left marked received');
select is((select received_date from public.income_sources where id = 'e1000000-0000-0000-0000-000000000003'),
  null, 'failure: no received date was written');
select is((select count(*)::integer from public.transactions), 3,
  'failure: no partial savings transfer or income transaction was left behind');
select is((select count(*)::integer from public.goal_contributions), 1,
  'failure: no partial goal contribution was left behind');

-- ===== Failure: double submit must not double-count =====
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000001', (select goal_a from fixture), 500000, 1000000, '2026-11-03', 'Received Variable Pay: Bonus')$$,
  'P0001', 'Income source not found or already received',
  'failure: allocating an already-received windfall is rejected');
select is((select count(*)::integer from public.transactions), 3,
  'failure: the rejected second submit created no extra transactions');

-- ===== Failure: unknown or someone else's income source =====
select throws_ok(
  $$select public.allocate_windfall('00000000-0000-0000-0000-00000000dead', (select goal_a from fixture), 0, 100, '2026-11-03', 'x')$$,
  'P0001', 'Income source not found or already received',
  'failure: unknown income source id is rejected');
select throws_ok(
  $$select public.allocate_windfall('f1000000-0000-0000-0000-000000000001', (select goal_a from fixture), 0, 900000, '2026-11-03', 'x')$$,
  'P0001', 'Income source not found or already received',
  'failure: another user''s income source is rejected');

-- ===== Failure: amount validation =====
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000004', (select goal_a from fixture), 0, 0, '2026-11-03', 'x')$$,
  'P0001', 'Windfall total must be positive', 'failure: zero total is rejected');
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000004', (select goal_a from fixture), -1, 500000, '2026-11-03', 'x')$$,
  'P0001', 'Savings allocation must be between 0 and the windfall total', 'failure: negative savings is rejected');
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000004', (select goal_a from fixture), 600000, 500000, '2026-11-03', 'x')$$,
  'P0001', 'Savings allocation must be between 0 and the windfall total', 'failure: savings above the total is rejected');
select throws_ok(
  $$select public.allocate_windfall('e1000000-0000-0000-0000-000000000004', null, 100000, 500000, '2026-11-03', 'x')$$,
  'P0001', 'A savings goal is required when allocating savings', 'failure: savings without a goal is rejected');

select is((select status from public.income_sources where id = 'e1000000-0000-0000-0000-000000000004'),
  'expected', 'validation failures leave the income source untouched');
select is((select count(*)::integer from public.transactions), 3,
  'validation failures create no transactions');

reset role;
select is((select status from public.income_sources where id = 'f1000000-0000-0000-0000-000000000001'),
  'expected', 'the other user''s income source was never modified');

select * from finish();
rollback;
