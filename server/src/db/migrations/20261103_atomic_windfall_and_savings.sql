create or replace function public.record_goal_contribution(p_goal_id uuid, p_amount bigint, p_date date, p_note text)
returns void language plpgsql security invoker as $$ declare v_tx uuid; begin
  insert into public.transactions(user_id,amount,type,date,note,source) values(auth.uid(),p_amount,'savings_transfer',p_date,p_note,'manual') returning id into v_tx;
  insert into public.goal_contributions(user_id,goal_id,transaction_id,amount,date) values(auth.uid(),p_goal_id,v_tx,p_amount,p_date);
end $$;

create or replace function public.allocate_windfall(p_income_id uuid, p_goal_id uuid, p_savings bigint, p_total bigint, p_date date, p_note text)
returns void language plpgsql security invoker as $$ declare v_tx uuid; begin
  update public.income_sources set status='received',received_date=p_date where id=p_income_id and user_id=auth.uid();
  if not found then raise exception 'Income source not found'; end if;
  if p_savings > 0 and p_goal_id is not null then
    insert into public.transactions(user_id,amount,type,date,note,source) values(auth.uid(),p_savings,'savings_transfer',p_date,'Windfall savings allocation','manual') returning id into v_tx;
    insert into public.goal_contributions(user_id,goal_id,transaction_id,amount,date) values(auth.uid(),p_goal_id,v_tx,p_savings,p_date);
  end if;
  insert into public.transactions(user_id,amount,type,date,note,source) values(auth.uid(),p_total,'income',p_date,p_note,'manual');
end $$;
