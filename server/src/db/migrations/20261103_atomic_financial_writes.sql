create or replace function public.record_received_income(p_name text, p_amount bigint, p_date date default current_date, p_type text default 'salary')
returns void language plpgsql security invoker as $$
begin
  insert into public.income_sources (user_id, name, type, status, amount, received_date) values (auth.uid(), p_name, p_type, 'received', p_amount, p_date);
  insert into public.transactions (user_id, amount, type, date, note, source) values (auth.uid(), p_amount, 'income', p_date, 'Income: ' || p_name, 'manual');
end $$;

create or replace function public.record_goal_contribution(p_goal_id uuid, p_amount bigint, p_date date default current_date, p_note text default null)
returns void language plpgsql security invoker as $$
declare tx_id uuid;
begin
  insert into public.transactions (user_id, amount, type, date, note, source) values (auth.uid(), p_amount, 'savings_transfer', p_date, p_note, 'manual') returning id into tx_id;
  insert into public.goal_contributions (user_id, goal_id, transaction_id, amount, date) values (auth.uid(), p_goal_id, tx_id, p_amount, p_date);
end $$;
