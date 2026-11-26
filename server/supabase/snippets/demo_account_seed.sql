-- SaveFirst: demo data for ONE test account. Run in the Supabase SQL editor.
--
-- Needs the database built from savefirst_full_setup.sql (through 20261127000000_card_tracker).
-- Set v_email below to the test account's email; the account must already exist (sign up first).
--
-- THIS DELETES ALL APP DATA OF THAT ACCOUNT (entries, bills, categories, goals, income, plan
-- history) and fills it again. Sign-in history, push subscriptions and the login stay.
-- Other accounts are not touched. Re-runnable; dates are relative to today, payday is the 1st.
--
-- What it covers: onboarding, plan history (save % raised last cycle), fixed bills and
-- recurring items with payment methods, a foreign-currency (USD) subscription and purchase,
-- salary over three cycles, a windfall split to a goal and the reserve, a reserve-paid bill,
-- income on hold, goals with and without a target date and one in USD, a credit card with an
-- opening balance and card bill payments.

begin;

do $$
declare
  v_email text := 'parth.rana1100@gmail.com';   -- <<< your test account
  v_user uuid;
  c0 date := date_trunc('month', current_date)::date;   -- this cycle's start
  cs date;                                              -- cycle start in the loop
  k int;
  usd numeric := 92.68;                                 -- INR per 1 USD for the demo
  v_rent uuid; v_net uuid; v_phone uuid; v_elec uuid;
  v_groc uuid; v_dine uuid; v_trans uuid; v_shop uuid; v_ent uuid; v_health uuid;
  r_salary uuid; r_rent uuid; r_net uuid; r_phone uuid; r_elec uuid; r_netflix uuid; r_gym uuid;
  g_emerg uuid; g_goa uuid; g_laptop uuid;
  v_bonus uuid;
  e record;
begin
  select id into v_user from auth.users where lower(email) = lower(v_email);
  if v_user is null then raise exception 'No account with email %', v_email; end if;

  -- Act as that user, so the app's own functions (auth.uid()) can be used.
  perform set_config('request.jwt.claim.sub', v_user::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- ---------------------------------------------------------------- wipe
  delete from public.goal_contributions where user_id = v_user;
  delete from public.income_sources where user_id = v_user;
  delete from public.transactions where user_id = v_user;
  delete from public.savings_goals where user_id = v_user;
  delete from public.recurring_items where user_id = v_user;
  delete from public.credit_cards where user_id = v_user;
  delete from public.categories where user_id = v_user;
  delete from public.plan_changes where user_id = v_user;
  delete from public.notification_log where user_id = v_user;

  -- Base currency back to INR (the guard only allows it through this flag).
  perform set_config('savefirst.set_base_currency', 'on', true);
  update public.user_settings set currency = 'INR', currency_next = null, currency_from = null where user_id = v_user;
  perform set_config('savefirst.set_base_currency', 'off', true);

  -- ---------------------------------------------------------------- onboarding
  perform public.complete_onboarding(
    8500000, 1::smallint, 15::smallint,
    '[{"name":"Rent","amount":2500000,"due_day":3},
      {"name":"Internet","amount":99900,"due_day":5},
      {"name":"Phone","amount":49900,"due_day":7},
      {"name":"Electricity","amount":200000,"due_day":20}]'::jsonb,
    '[{"name":"Groceries","limit":900000},{"name":"Dining out","limit":400000},
      {"name":"Transport","limit":300000},{"name":"Shopping","limit":500000},
      {"name":"Entertainment","limit":250000},{"name":"Health","limit":null}]'::jsonb);

  select id into v_rent from categories where user_id = v_user and name = 'Rent';
  select id into v_net from categories where user_id = v_user and name = 'Internet';
  select id into v_phone from categories where user_id = v_user and name = 'Phone';
  select id into v_elec from categories where user_id = v_user and name = 'Electricity';
  select id into v_groc from categories where user_id = v_user and name = 'Groceries';
  select id into v_dine from categories where user_id = v_user and name = 'Dining out';
  select id into v_trans from categories where user_id = v_user and name = 'Transport';
  select id into v_shop from categories where user_id = v_user and name = 'Shopping';
  select id into v_ent from categories where user_id = v_user and name = 'Entertainment';
  select id into v_health from categories where user_id = v_user and name = 'Health';

  -- Plan history: started three cycles ago at 15%, raised to 20% from last cycle.
  update public.plan_changes set effective_from = c0 - interval '2 months', created_at = now() - interval '2 months'
   where user_id = v_user;
  insert into public.plan_changes (user_id, field, from_value, to_value, applies, effective_from, created_at)
  values (v_user, 'save_pct', 15, 20, 'next', c0 - interval '1 month', now() - interval '40 days');

  -- Settings: 20% now, preferences.
  update public.user_settings
     set savings_pct = 20, onboarded_at = now() - interval '2 months', display_name = 'Demo',
         theme = 'system', number_format = 'indian', bill_reminder_days = 3, updated_at = now()
   where user_id = v_user;
  -- One credit card (statement 20th, due 5th, opening ₹12,500). With one card, every
  -- credit-card entry and card payment below is tagged with it (set_entry_card).
  insert into public.credit_cards (user_id, name, statement_day, due_day, opening_balance, created_at)
  values (v_user, 'HDFC Regalia', 20, 5, 1250000, now() - interval '2 months');

  -- ---------------------------------------------------------------- recurring
  insert into recurring_items (user_id, name, amount, type, income_type, day_of_month, starts_on)
  values (v_user, 'Salary', 8500000, 'income', 'salary', 1, c0 - interval '2 months') returning id into r_salary;
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on)
  values (v_user, 'Rent', 2500000, 'expense', v_rent, 3, 'upi', c0 - interval '2 months') returning id into r_rent;
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on)
  values (v_user, 'Internet', 99900, 'expense', v_net, 5, 'credit_card', c0 - interval '2 months') returning id into r_net;
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on)
  values (v_user, 'Phone', 49900, 'expense', v_phone, 7, 'debit_card', c0 - interval '2 months') returning id into r_phone;
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on)
  values (v_user, 'Electricity', 200000, 'expense', v_elec, 20, 'upi', c0 - interval '2 months') returning id into r_elec;
  -- Foreign subscription: $15.49 a month on the credit card.
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on,
                               original_amount, original_currency, fx_rate, fx_date)
  values (v_user, 'Netflix', round(1549 * usd), 'expense', v_ent, 12, 'credit_card', c0 - interval '2 months',
          1549, 'USD', usd, c0) returning id into r_netflix;
  insert into recurring_items (user_id, name, amount, type, category_id, day_of_month, payment_method, starts_on)
  values (v_user, 'Gym', 150000, 'expense', v_health, 10, 'credit_card', c0 - interval '2 months') returning id into r_gym;

  -- ---------------------------------------------------------------- goals
  -- No target date, with money saved before SaveFirst.
  insert into savings_goals (user_id, name, target_amount, target_date, saved_before, created_at)
  values (v_user, 'Emergency fund', 30000000, null, 5000000, now() - interval '2 months') returning id into g_emerg;
  insert into savings_goals (user_id, name, target_amount, target_date, created_at)
  values (v_user, 'Goa trip', 6000000, c0 + interval '6 months', now() - interval '2 months') returning id into g_goa;
  -- Target in USD: $1,500.
  insert into savings_goals (user_id, name, target_amount, target_date, original_amount, original_currency, fx_rate, fx_date, created_at)
  values (v_user, 'New laptop', round(150000 * usd), c0 + interval '10 months', 150000, 'USD', usd, c0, now() - interval '2 months')
  returning id into g_laptop;

  -- ---------------------------------------------------------------- three cycles of entries
  for k in reverse 2..0 loop
    cs := (c0 - make_interval(months => k))::date;

    perform post_recurring_item(r_salary, cs);
    perform post_recurring_item(r_rent, cs + 2) where cs + 2 <= current_date;
    perform post_recurring_item(r_net, cs + 4) where cs + 4 <= current_date;
    perform post_recurring_item(r_phone, cs + 6) where cs + 6 <= current_date;
    perform post_recurring_item(r_gym, cs + 9) where cs + 9 <= current_date;
    perform post_recurring_item(r_netflix, cs + 11) where cs + 11 <= current_date;
    perform post_recurring_item(r_elec, cs + 19) where cs + 19 <= current_date;

    -- Save first: goal contributions early in the cycle.
    if cs + 1 <= current_date then
      perform record_goal_contribution(g_emerg, 1000000, cs + 1, 'Monthly save');
      perform record_goal_contribution(g_goa, 500000, cs + 1, 'Monthly save');
      perform record_goal_contribution(g_laptop, 200000, cs + 1, 'Monthly save');
    end if;

    -- Everyday spending, every payment method (and one left unset).
    for e in
      select * from (values
        (1,  'groc',  184000, 'upi',         'BigBasket'),
        (2,  'trans',  35000, 'upi',         'Uber'),
        (4,  'dine',   86000, 'credit_card', 'Toit'),
        (5,  'groc',   42000, 'cash',        'Local market'),
        (7,  'shop',  249900, 'credit_card', 'Myntra'),
        (8,  'trans', 120000, 'debit_card',  'Shell'),
        (10, 'ent',    60000, 'credit_card', 'BookMyShow'),
        (12, 'groc',  231000, 'debit_card',  'DMart'),
        (13, 'dine',   54000, 'upi',         'Swiggy'),
        (15, 'health', 78000, 'credit_card', 'Apollo Pharmacy'),
        (17, 'shop',   99900, 'other',       'Gift card'),
        (18, 'trans',  28000, null,          'Metro'),
        (21, 'dine',  132000, 'credit_card', 'Olive'),
        (23, 'groc',  165000, 'upi',         'Zepto'),
        (25, 'ent',    45000, 'cash',        'Bowling'),
        (27, 'trans',  95000, 'credit_card', 'Indian Oil')
      ) as x(d, cat, amt, method, payee)
    loop
      continue when cs + e.d > current_date;
      insert into transactions (user_id, category_id, amount, type, date, note, source, payment_method, payee)
      values (v_user,
              case e.cat when 'groc' then v_groc when 'dine' then v_dine when 'trans' then v_trans
                         when 'shop' then v_shop when 'ent' then v_ent else v_health end,
              e.amt + k * 1300, 'expense', cs + e.d, null, 'manual', e.method, e.payee);
    end loop;
  end loop;

  -- Foreign purchase this cycle: $42 on the credit card.
  insert into transactions (user_id, category_id, amount, type, date, note, source, payment_method, payee,
                            original_amount, original_currency, fx_rate, fx_date)
  values (v_user, v_shop, round(4200 * usd), 'expense', greatest(c0, current_date - 1), 'Headphones', 'manual',
          'credit_card', 'Amazon US', 4200, 'USD', usd, c0);

  -- Windfall last cycle: ₹40,000 bonus, ₹20,000 to Goa trip, ₹10,000 to the reserve.
  insert into income_sources (user_id, name, type, status, amount, expected_date)
  values (v_user, 'Diwali bonus', 'variable', 'expected', 4000000, c0 - interval '1 month' + interval '14 days')
  returning id into v_bonus;
  perform allocate_windfall(v_bonus, g_goa, 2000000, 4000000, (c0 - interval '1 month' + interval '14 days')::date,
                            'Income: Diwali bonus', 1000000);
  -- A bill paid from the reserve (doesn't touch safe to spend).
  insert into transactions (user_id, category_id, amount, type, date, note, source, payment_method, payee, from_reserve)
  values (v_user, v_health, 850000, 'expense', (c0 - interval '1 month' + interval '21 days')::date,
          'Annual health insurance', 'manual', 'debit_card', 'Star Health', true);

  -- Income on hold: freelance payment expected in a few days.
  insert into income_sources (user_id, name, type, status, amount, expected_date)
  values (v_user, 'Freelance design', 'variable', 'expected', 1500000, current_date + 5);

  -- Card bills paid on the 5th (statement of the 20th before).
  insert into transactions (user_id, amount, type, date, note, source)
  select v_user, amt, 'card_payment', d, 'Card bill', 'manual'
    from (values (1800000, (c0 - interval '1 month' + interval '4 days')::date),
                 (1650000, (c0 + 4))) as p(amt, d)
   where p.d <= current_date;
end;
$$;

commit;
