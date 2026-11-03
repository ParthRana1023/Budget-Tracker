-- Starter categories seed helper for an existing user id
-- Usage: Replace '<USER_UUID>' with your authenticated Supabase user id.

DO $$
DECLARE
  v_user_id uuid := '<USER_UUID>'::uuid;
BEGIN
  -- Insert user settings
  insert into public.user_settings (user_id, currency, month_start_day)
  values (v_user_id, 'INR', 1)
  on conflict (user_id) do nothing;

  -- Fixed categories
  insert into public.categories (user_id, name, type, monthly_limit) values
    (v_user_id, 'Rent / Housing', 'fixed', 2500000), -- 25,000 INR
    (v_user_id, 'Utilities & Bills', 'fixed', 500000), -- 5,000 INR
    (v_user_id, 'EMI / Loans', 'fixed', 1500000), -- 15,000 INR
    (v_user_id, 'Insurance', 'fixed', 300000), -- 3,000 INR
    (v_user_id, 'Subscriptions', 'fixed', 150000) -- 1,500 INR
  on conflict do nothing;

  -- Flexible categories
  insert into public.categories (user_id, name, type, monthly_limit) values
    (v_user_id, 'Groceries', 'flexible', 1200000), -- 12,000 INR
    (v_user_id, 'Food & Dining Out', 'flexible', 800000), -- 8,000 INR
    (v_user_id, 'Transport / Fuel', 'flexible', 500000), -- 5,000 INR
    (v_user_id, 'Shopping', 'flexible', 600000), -- 6,000 INR
    (v_user_id, 'Entertainment', 'flexible', 400000), -- 4,000 INR
    (v_user_id, 'Health', 'flexible', 300000), -- 3,000 INR
    (v_user_id, 'Travel', 'flexible', 500000), -- 5,000 INR
    (v_user_id, 'Miscellaneous', 'flexible', 200000) -- 2,000 INR
  on conflict do nothing;

  -- Starter Savings Goals
  insert into public.savings_goals (user_id, name, target_amount) values
    (v_user_id, 'Emergency Fund', 15000000), -- 1,50,000 INR
    (v_user_id, 'Vacation', 5000000) -- 50,000 INR
  on conflict do nothing;
END $$;

