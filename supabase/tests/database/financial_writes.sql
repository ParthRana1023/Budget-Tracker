begin;

select plan(11);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'local-finance-test@example.com', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb
);

select is(
  (select count(*)::integer from public.categories where user_id = '11111111-1111-1111-1111-111111111111'),
  13,
  'new users receive all 13 canonical starter categories'
);
select is(
  (select array_agg(type || ':' || name order by type, name) from public.categories where user_id = '11111111-1111-1111-1111-111111111111'),
  array[
    'fixed:EMI / Loans', 'fixed:Insurance', 'fixed:Rent / Housing', 'fixed:Subscriptions', 'fixed:Utilities & Bills',
    'flexible:Entertainment', 'flexible:Food & Dining Out', 'flexible:Groceries', 'flexible:Health', 'flexible:Miscellaneous',
    'flexible:Shopping', 'flexible:Transport / Fuel', 'flexible:Travel'
  ],
  'starter category labels and types are canonical'
);

insert into public.recurring_items (id, user_id, name, amount, type, category_id, day_of_month)
values (
  '22222222-2222-2222-2222-222222222222',
  '11111111-1111-1111-1111-111111111111',
  'Monthly internet', 99900, 'expense',
  (select id from public.categories where user_id = '11111111-1111-1111-1111-111111111111' and name = 'Utilities & Bills'),
  1
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

select public.post_recurring_item('22222222-2222-2222-2222-222222222222', '2026-11-01');
select is(
  (select count(*)::integer from public.transactions where external_id = 'recurring:22222222-2222-2222-2222-222222222222:2026-11'),
  1,
  'posting a recurring item creates exactly one transaction'
);

select throws_ok(
  $$select public.post_recurring_item('22222222-2222-2222-2222-222222222222', '2026-11-01')$$,
  '23505', null,
  'the recurring posting uniqueness index rejects a duplicate month'
);
select is(
  (select count(*)::integer from public.transactions where external_id = 'recurring:22222222-2222-2222-2222-222222222222:2026-11'),
  1,
  'a duplicate recurring posting leaves the original single transaction intact'
);

update public.recurring_items set active = false where id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$select public.post_recurring_item('22222222-2222-2222-2222-222222222222', '2026-12-01')$$,
  'P0001', 'Recurring item not found',
  'inactive schedules cannot be posted'
);
select is(
  (select count(*)::integer from public.transactions where external_id = 'recurring:22222222-2222-2222-2222-222222222222:2026-12'),
  0,
  'an inactive schedule creates no financial record'
);

select public.record_received_income('Freelance work', 250000, '2026-11-02', 'variable');
select is(
  (select count(*)::integer from public.income_sources where name = 'Freelance work' and status = 'received'),
  1,
  'receiving income creates the income source record'
);
select is(
  (select count(*)::integer from public.transactions where note = 'Income: Freelance work'),
  1,
  'receiving income creates its matching transaction'
);

select throws_ok(
  $$select public.record_goal_contribution('33333333-3333-3333-3333-333333333333', 10000, '2026-11-02', 'should roll back')$$,
  '23503', null,
  'a contribution with a missing goal fails'
);
select is(
  (select count(*)::integer from public.transactions where note = 'should roll back'),
  0,
  'a failed contribution leaves no partial savings transaction'
);

reset role;
select * from finish();
rollback;
