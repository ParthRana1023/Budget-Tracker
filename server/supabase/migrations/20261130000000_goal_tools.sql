-- SaveFirst v4 (2026-11-30): goal tools for handoff v4 §2 / §2b / §9. Re-runnable.
--
-- unsplit_goal: Undo for a split. The sub-goals' money goes back onto the main goal and the sub-goals
--   are removed, so the goal is as it was before split_goal.
-- delete_goal: deletes a goal (and its sub-goals and their contributions) and returns what it removed,
--   so the app can offer Undo. Past savings transfers stay in the ledger, as before.
-- restore_rows: puts a snapshot back (goals, then goal contributions), for that Undo.
--   shortcut: goals and contributions only; the ledger tools (Step 4) add transactions.

-- ---------------------------------------------------------------- unsplit_goal
-- p_target_amount / p_original_amount: the main goal's own target before the split (the app has it).
-- Each sub-goal's contributions are merged back per transfer and date, so a transfer split across
-- sub-goals becomes one contribution again.
create or replace function public.unsplit_goal(p_goal_id uuid, p_target_amount bigint, p_original_amount bigint default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p savings_goals;
  v_saved bigint;
  v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select * into p from savings_goals where id = p_goal_id and user_id = auth.uid() for update;
  if not found then raise exception 'Goal not found'; end if;
  if not exists (select 1 from savings_goals where parent_id = p.id) then raise exception 'This goal has no sub-goals'; end if;
  if p_target_amount is null or p_target_amount <= 0
     or (p.original_currency is not null and coalesce(p_original_amount, 0) <= 0) then
    raise exception 'The goal''s target must be more than zero';
  end if;

  select coalesce(sum(saved_before), 0) into v_saved from savings_goals where parent_id = p.id;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select c.transaction_id, sum(c.amount) as amount, c.date, min(c.created_at) as created_at
      from goal_contributions c join savings_goals g on g.id = c.goal_id
     where g.parent_id = p.id
     group by c.transaction_id, c.date
  ) x;

  -- Sub-goals go first (their contributions with them): a goal with sub-goals takes no money.
  delete from savings_goals where parent_id = p.id;
  update savings_goals
     set saved_before = v_saved,
         target_amount = p_target_amount,
         original_amount = case when original_currency is not null then p_original_amount end
   where id = p.id;
  insert into goal_contributions (user_id, goal_id, transaction_id, amount, date, created_at)
  select p.user_id, p.id, (e->>'transaction_id')::uuid, (e->>'amount')::bigint, (e->>'date')::date, (e->>'created_at')::timestamptz
    from jsonb_array_elements(v_rows) e;
end;
$$;
grant execute on function public.unsplit_goal(uuid, bigint, bigint) to authenticated;

-- ---------------------------------------------------------------- delete_goal
-- Returns { savings_goals: [...], goal_contributions: [...] }: every row it deletes, main goal first.
create or replace function public.delete_goal(p_goal_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if not exists (select 1 from savings_goals where id = p_goal_id and user_id = auth.uid()) then
    raise exception 'Goal not found';
  end if;
  select jsonb_build_object(
    'savings_goals', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.parent_id is not null, g.created_at)
        from savings_goals g
       where g.user_id = auth.uid() and (g.id = p_goal_id or g.parent_id = p_goal_id)), '[]'::jsonb),
    'goal_contributions', coalesce((
      select jsonb_agg(to_jsonb(c))
        from goal_contributions c join savings_goals g on g.id = c.goal_id
       where c.user_id = auth.uid() and (g.id = p_goal_id or g.parent_id = p_goal_id)), '[]'::jsonb)
  ) into v;
  delete from savings_goals where id = p_goal_id and user_id = auth.uid();
  return v;
end;
$$;
grant execute on function public.delete_goal(uuid) to authenticated;

-- ---------------------------------------------------------------- restore_rows
-- Re-inserts a snapshot as it was (same ids and dates), always as the signed-in user. Goals without a
-- main goal in the snapshot go first, then sub-goals, then contributions, one row at a time so each
-- goal trigger sees the rows before it. All or nothing.
create or replace function public.restore_rows(p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  e jsonb;
  v_me jsonb := jsonb_build_object('user_id', auth.uid());
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if jsonb_typeof(p_rows) is distinct from 'object' then raise exception 'Nothing to restore'; end if;
  for e in
    select x from jsonb_array_elements(coalesce(p_rows->'savings_goals', '[]'::jsonb)) x
     order by x->>'parent_id' is not null
  loop
    insert into savings_goals select (jsonb_populate_record(null::savings_goals, e || v_me)).*;
  end loop;
  for e in select x from jsonb_array_elements(coalesce(p_rows->'goal_contributions', '[]'::jsonb)) x loop
    insert into goal_contributions select (jsonb_populate_record(null::goal_contributions, e || v_me)).*;
  end loop;
end;
$$;
grant execute on function public.restore_rows(jsonb) to authenticated;
