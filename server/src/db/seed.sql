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

  -- Starter categories (same 13 as new signups; limits start unset). Safe to re-run.
  perform public.ensure_starter_categories(v_user_id);

  -- Starter Savings Goals
  insert into public.savings_goals (user_id, name, target_amount) values
    (v_user_id, 'Emergency Fund', 15000000), -- 1,50,000 INR
    (v_user_id, 'Vacation', 5000000) -- 50,000 INR
  on conflict do nothing;
END $$;

