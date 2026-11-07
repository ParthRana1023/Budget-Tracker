-- allocate_windfall hardening:
--   * validates amounts up front;
--   * only an income source that is still 'expected' can be allocated, so a
--     double submit / retry / second tab cannot double-count the windfall;
--   * stays atomic: any later failure (e.g. an unknown goal id) rolls back the
--     income status update, the savings transfer and the income transaction together.
create or replace function public.allocate_windfall(p_income_id uuid, p_goal_id uuid, p_savings bigint, p_total bigint, p_date date, p_note text)
returns void language plpgsql security invoker set search_path = public as $$
declare v_tx uuid;
begin
  if p_total is null or p_total <= 0 then
    raise exception 'Windfall total must be positive';
  end if;
  if p_savings is null or p_savings < 0 or p_savings > p_total then
    raise exception 'Savings allocation must be between 0 and the windfall total';
  end if;
  if p_savings > 0 and p_goal_id is null then
    raise exception 'A savings goal is required when allocating savings';
  end if;

  update public.income_sources set status = 'received', received_date = p_date
   where id = p_income_id and user_id = auth.uid() and status = 'expected';
  if not found then raise exception 'Income source not found or already received'; end if;

  if p_savings > 0 then
    insert into public.transactions(user_id, amount, type, date, note, source)
    values(auth.uid(), p_savings, 'savings_transfer', p_date, 'Windfall savings allocation', 'manual') returning id into v_tx;
    insert into public.goal_contributions(user_id, goal_id, transaction_id, amount, date)
    values(auth.uid(), p_goal_id, v_tx, p_savings, p_date);
  end if;

  insert into public.transactions(user_id, amount, type, date, note, source)
  values(auth.uid(), p_total, 'income', p_date, p_note, 'manual');
end $$;
