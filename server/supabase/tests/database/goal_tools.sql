-- Goal tools (migration 20261130000000_goal_tools): split, Undo the split, delete and Undo the delete.
begin;

select plan(12);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
values ('66666666-6666-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'goals@example.com', '', now(), '{}'::jsonb, '{}'::jsonb);

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

-- Holiday: 100.00 already saved plus a 50.00 transfer.
insert into ids select 'g', id from (
  insert into public.savings_goals (user_id, name, target_amount, saved_before)
  values ('66666666-6666-6666-6666-666666666666', 'Holiday', 60000, 10000) returning id) g;
select public.record_goal_contribution((select id from ids where k = 'g'), 5000, current_date, 'Holiday');

create temp view held as
  select coalesce((select sum(saved_before) from public.savings_goals), 0)
       + coalesce((select sum(amount) from public.goal_contributions), 0) as total;

-- ================================================================ split, equally
select lives_ok(format($$select public.split_goal(%L,
  '[{"name":"Flights","target_amount":40000,"saved_before":5000},{"name":"Hotel","target_amount":30000,"saved_before":5000}]',
  jsonb_build_array(jsonb_build_object('id', %L, 'parts', '[2500,2500]'::jsonb)))$$,
  (select id from ids where k = 'g'), (select id from public.goal_contributions limit 1)), 'split_goal runs');
select is((select total from held), 15000::numeric, 'the sub-goals hold what the goal held before the split');
select is((select saved_before from public.savings_goals where name = 'Holiday'), 0::bigint, 'the main goal holds nothing');
select is((select target_amount from public.savings_goals where name = 'Holiday'), 70000::bigint,
  'the main goal''s target is the sum of its sub-goals');

-- ================================================================ Undo the split
select lives_ok(format($$select public.unsplit_goal(%L, 60000)$$, (select id from ids where k = 'g')), 'unsplit_goal runs');
select is((select count(*)::int from public.savings_goals), 1, 'the sub-goals are gone');
select is((select (saved_before, target_amount)::text from public.savings_goals), '(10000,60000)',
  'the goal has its own saved amount and target back');
select is((select (count(*), sum(amount))::text from public.goal_contributions), '(1,5000)',
  'the split transfer is one contribution again');

-- ================================================================ delete, and Undo the delete
select public.split_goal((select id from ids where k = 'g'),
  '[{"name":"Flights","target_amount":40000,"saved_before":10000}]',
  jsonb_build_array(jsonb_build_object('id', (select id from public.goal_contributions limit 1), 'parts', '[5000]'::jsonb)));
create temp table snap as select public.delete_goal((select id from ids where k = 'g')) as rows;
select is((select count(*)::int from public.savings_goals), 0, 'deleting a main goal deletes its sub-goals');
select is((select count(*)::int from public.transactions where type = 'savings_transfer'), 1,
  'the savings transfer stays in the ledger');
select lives_ok($$select public.restore_rows((select rows from snap))$$, 'restore_rows runs');
select is((select (count(*), (select total from held))::text from public.savings_goals), '(2,15000)',
  'Undo brings back the goal, its sub-goal and its money');

select * from finish();
rollback;
