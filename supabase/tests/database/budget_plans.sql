begin;

select plan(10);

-- Two users; each gets the starter categories from the signup trigger.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data
) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'plan-owner@example.com', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'plan-other@example.com', '', now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);

select lives_ok(
  $$select public.save_budget_plan('2026-12-01', 9000000, 1000000, 2000000,
    jsonb_build_array(jsonb_build_object(
      'category_id', (select id from public.categories where name = 'Shopping'),
      'planned_limit', 700000)))$$,
  'a user can save a plan for a future cycle'
);

-- Saving the same cycle again replaces it instead of duplicating it.
select public.save_budget_plan('2026-12-01', 9500000, 0, 2500000,
  jsonb_build_array(jsonb_build_object(
    'category_id', (select id from public.categories where name = 'Groceries'),
    'planned_limit', 1200000)));
select is(
  (select count(*)::integer from public.budget_plans where cycle_start = '2026-12-01'),
  1,
  'one plan per cycle: saving again replaces the plan'
);
select is(
  (select array_agg(c.name) from public.budget_plan_categories pc join public.categories c on c.id = pc.category_id),
  array['Groceries'],
  'saving again replaces the category limits'
);
select is(
  (select monthly_limit from public.categories where name = 'Groceries'),
  0::bigint,
  'saving a plan does not change live category limits'
);

select throws_ok(
  $$select public.save_budget_plan('2027-01-01', -1, 0, 0, '[]'::jsonb)$$,
  'P0001', 'Planned amounts must be zero or more',
  'negative planned amounts are rejected'
);

-- Applying copies the plan limits into the live categories.
select is(
  public.apply_budget_plan((select id from public.budget_plans where cycle_start = '2026-12-01')),
  1,
  'applying a plan updates its categories'
);
select is(
  (select monthly_limit from public.categories where name = 'Groceries'),
  1200000::bigint,
  'the applied limit is now the live limit'
);

-- Remember user A's ids, then act as user B.
select set_config('test.plan_a', (select id::text from public.budget_plans where cycle_start = '2026-12-01'), true);
select set_config('test.shopping_a', (select id::text from public.categories where name = 'Shopping'), true);
select set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);

select is(
  (select count(*)::integer from public.budget_plans),
  0,
  'RLS hides other users'' plans'
);
select throws_ok(
  $$select public.apply_budget_plan(current_setting('test.plan_a')::uuid)$$,
  'P0001', 'Budget plan not found',
  'a user cannot apply another user''s plan'
);
select throws_ok(
  $$select public.save_budget_plan('2026-12-01', 0, 0, 0,
    jsonb_build_array(jsonb_build_object('category_id', current_setting('test.shopping_a'), 'planned_limit', 1)))$$,
  'P0001', 'Category not found',
  'a plan cannot reference another user''s category'
);

reset role;
select * from finish();
rollback;
