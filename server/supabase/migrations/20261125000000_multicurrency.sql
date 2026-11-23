-- SaveFirst Phase 4 (2026-11-25): base currency and foreign-currency amounts. Re-runnable.
--
-- Every `amount` / `monthly_limit` / `target_amount` stays in the user's base currency
-- (user_settings.currency), in its minor units, so all existing math is untouched. A foreign row
-- also keeps what was typed: original_amount (minor units of original_currency), the rate used
-- (base units per 1 foreign unit, fx_rate) and the cycle start that rate belongs to (fx_date).
-- Null original_currency = typed in the base currency. Rates come from the app's /api/rates
-- (Frankfurter, ECB) and are cached in fx_rates.

-- ---------------------------------------------------------------- currencies
-- The 30 currencies Frankfurter covers. Minor-unit digits match Intl in the app
-- (client/src/lib/money.mjs ZERO_DECIMAL; its unit test checks the two agree).
create or replace function public.currency_digits(p_currency text)
returns int
language sql
immutable
as $$ select case when p_currency in ('HUF', 'IDR', 'ISK', 'JPY', 'KRW') then 0 else 2 end $$;

create or replace function public.is_supported_currency(p_currency text)
returns boolean
language sql
immutable
as $$
  select p_currency in ('AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'EUR', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS',
                        'INR', 'ISK', 'JPY', 'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD',
                        'THB', 'TRY', 'USD', 'ZAR')
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_currency_check') then
    alter table public.user_settings add constraint user_settings_currency_check
      check (public.is_supported_currency(currency));
  end if;
end;
$$;

-- ---------------------------------------------------------------- rate cache
-- One rate per pair and cycle start, shared by everyone. Written only by the app's server
-- (service role); readable by signed-in users.
create table if not exists public.fx_rates (
  quote text not null check (public.is_supported_currency(quote)),
  base text not null check (public.is_supported_currency(base)),
  rate_date date not null,
  rate numeric(20, 10) not null check (rate > 0),
  ecb_date date,
  fetched_at timestamptz not null default now(),
  primary key (quote, base, rate_date)
);
alter table public.fx_rates enable row level security;
drop policy if exists "Signed-in users can read rates" on public.fx_rates;
create policy "Signed-in users can read rates" on public.fx_rates for select to authenticated using (true);

-- ---------------------------------------------------------------- original amounts
do $$
declare
  t text;
begin
  foreach t in array array['transactions', 'recurring_items', 'categories', 'savings_goals'] loop
    execute format('alter table public.%I
      add column if not exists original_amount bigint check (original_amount > 0),
      add column if not exists original_currency text check (original_currency is null or public.is_supported_currency(original_currency)),
      add column if not exists fx_rate numeric(20, 10) check (fx_rate > 0),
      add column if not exists fx_date date', t);
    if not exists (select 1 from pg_constraint where conname = t || '_original_check') then
      execute format('alter table public.%I add constraint %I check (
        (original_currency is null and original_amount is null and fx_rate is null)
        or (original_currency is not null and original_amount is not null and fx_rate is not null))', t, t || '_original_check');
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- recurring defaults
-- Same as 20261124000000_payment_methods, plus: an entry posted from a foreign-currency item at
-- the item's (current) base amount also takes the item's original amount and rate.
create or replace function public.default_payment_method()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  item record;
begin
  if new.external_id ~ '^recurring:[0-9a-f-]{36}:' then
    select r.payment_method, r.amount, r.original_amount, r.original_currency, r.fx_rate, r.fx_date into item
      from recurring_items r
     where r.id = split_part(new.external_id, ':', 2)::uuid and r.user_id = new.user_id;
    if found then
      if new.payment_method is null then new.payment_method := item.payment_method; end if;
      if new.original_currency is null and item.original_currency is not null and new.amount = item.amount then
        new.original_amount := item.original_amount;
        new.original_currency := item.original_currency;
        new.fx_rate := item.fx_rate;
        new.fx_date := item.fx_date;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- base currency
-- Changes only through set_base_currency, which keeps the numbers people typed and enforces
-- the lock. A direct update of user_settings.currency is refused.
create or replace function public.guard_base_currency()
returns trigger
language plpgsql
as $$
begin
  if new.currency is distinct from old.currency and coalesce(current_setting('savefirst.set_base_currency', true), '') <> 'on' then
    raise exception 'Change the base currency in Settings';
  end if;
  return new;
end;
$$;
drop trigger if exists user_settings_guard_currency on public.user_settings;
create trigger user_settings_guard_currency before update of currency on public.user_settings
  for each row execute procedure public.guard_base_currency();

-- Allowed until the first entry. Amounts keep their typed value: ₹95,000 becomes $95,000, and
-- between currencies with different decimals the minor units are rescaled (95,000 stays 95,000).
-- Foreign rows lose their rate date, so the app re-prices them for the new base.
create or replace function public.set_base_currency(p_currency text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old text;
  f numeric;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if not is_supported_currency(p_currency) then raise exception 'Unsupported currency'; end if;
  select currency into v_old from user_settings where user_id = v_user for update;
  if not found then raise exception 'Settings not found'; end if;
  if v_old = p_currency then return; end if;
  if exists (select 1 from transactions where user_id = v_user) then
    raise exception 'The base currency is locked after your first entry';
  end if;

  f := power(10::numeric, currency_digits(p_currency) - currency_digits(v_old));
  if f <> 1 then
    update user_settings set take_home_pay = round(take_home_pay * f) where user_id = v_user;
    update categories set monthly_limit = round(monthly_limit * f) where user_id = v_user;
    update income_sources set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update savings_goals set target_amount = greatest(1, round(target_amount * f)), saved_before = round(saved_before * f)
     where user_id = v_user;
    update goal_contributions set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update recurring_items set amount = greatest(1, round(amount * f)) where user_id = v_user;
    update plan_changes set from_value = round(from_value * f), to_value = round(to_value * f)
     where user_id = v_user and field = 'salary';
  end if;

  -- Rows typed in the new base currency become plain; other foreign rows wait for a new rate.
  update recurring_items set amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update categories set monthly_limit = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update savings_goals set target_amount = original_amount, original_amount = null, original_currency = null, fx_rate = null, fx_date = null
   where user_id = v_user and original_currency = p_currency;
  update recurring_items set fx_date = null where user_id = v_user and original_currency is not null;
  update categories set fx_date = null where user_id = v_user and original_currency is not null;
  update savings_goals set fx_date = null where user_id = v_user and original_currency is not null;

  perform set_config('savefirst.set_base_currency', 'on', true);
  update user_settings set currency = p_currency, updated_at = now() where user_id = v_user;
  perform set_config('savefirst.set_base_currency', 'off', true);
end;
$$;
grant execute on function public.set_base_currency(text) to authenticated;

-- ---------------------------------------------------------------- data download
-- Same as 20261121000000_account_v2, with the real currency instead of 'INR'.
create or replace function public.export_my_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  return jsonb_build_object(
    'exportedAt', now(),
    'amountsIn', 'minor units', -- of `currency`: paise for INR, cents for USD, whole yen for JPY
    'currency', (select s.currency from user_settings s where s.user_id = v_user),
    'profile', (select jsonb_build_object('email', auth.jwt()->>'email', 'name', s.display_name,
                       'photo', s.avatar_url, 'memberSince', s.created_at)
                  from user_settings s where s.user_id = v_user),
    'plan', (select jsonb_build_object('salary', s.take_home_pay, 'payday', s.month_start_day,
                    'saveFirstPct', s.savings_pct)
               from user_settings s where s.user_id = v_user),
    'planHistory', coalesce((select jsonb_agg(to_jsonb(p) - 'user_id' - 'id' order by p.created_at)
                               from plan_changes p where p.user_id = v_user), '[]'),
    'preferences', (select to_jsonb(s) - 'user_id' - 'take_home_pay' - 'month_start_day' - 'savings_pct'
                              - 'display_name' - 'avatar_url'
                      from user_settings s where s.user_id = v_user),
    'categories', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.name)
                              from categories c where c.user_id = v_user), '[]'),
    'entries', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.date, t.created_at)
                           from transactions t where t.user_id = v_user), '[]'),
    'recurring', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' order by r.created_at)
                             from recurring_items r where r.user_id = v_user), '[]'),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id' order by g.created_at)
                         from savings_goals g where g.user_id = v_user), '[]'),
    'goalContributions', coalesce((select jsonb_agg(to_jsonb(c) - 'user_id' order by c.date)
                                     from goal_contributions c where c.user_id = v_user), '[]'),
    'incomeOnHold', coalesce((select jsonb_agg(to_jsonb(i) - 'user_id' order by i.created_at)
                                from income_sources i where i.user_id = v_user and i.status = 'expected'), '[]')
  );
end;
$$;
grant execute on function public.export_my_data() to authenticated;
