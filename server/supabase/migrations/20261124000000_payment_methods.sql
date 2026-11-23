-- SaveFirst Phase 3 (2026-11-24): how an expense was paid. Re-runnable.
-- A tag for tracking and reports only: safe-to-spend math never reads it. Null = not recorded.

alter table public.transactions
  add column if not exists payment_method text;
alter table public.recurring_items
  add column if not exists payment_method text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_payment_method_check') then
    alter table public.transactions add constraint transactions_payment_method_check
      check (payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'recurring_items_payment_method_check') then
    alter table public.recurring_items add constraint recurring_items_payment_method_check
      check (payment_method in ('upi', 'debit_card', 'credit_card', 'cash', 'other'));
  end if;
end;
$$;

-- ---------------------------------------------------------------- recurring default
-- An entry posted from a recurring item (external_id 'recurring:<item id>:<cycle>') takes the
-- item's default method unless one was given. Covers every posting path: the app's
-- record_entry_with_recurring and any older RPC that inserts recurring entries.
create or replace function public.default_payment_method()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.payment_method is null and new.external_id ~ '^recurring:[0-9a-f-]{36}:' then
    select r.payment_method into new.payment_method
      from recurring_items r
     where r.id = split_part(new.external_id, ':', 2)::uuid and r.user_id = new.user_id;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_default_payment_method on public.transactions;
create trigger transactions_default_payment_method before insert on public.transactions
  for each row execute procedure public.default_payment_method();

-- ---------------------------------------------------------------- CSV import
-- Same as 20261121000000_account_v2, plus an optional payment_method per row (one of the five
-- keys, or null). Duplicate detection ignores it, as before.
create or replace function public.import_transactions(p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  r jsonb;
  v_date date;
  v_type text;
  v_amount bigint;
  v_note text;
  v_cat uuid;
  v_method text;
  v_added int := 0;
  v_dupes int := 0;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Nothing to import';
  end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'Import at most 5,000 entries at a time'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_type := r->>'type';
    if v_type is null or v_type not in ('expense', 'income') then
      raise exception 'Only expenses and income can be imported';
    end if;
    begin
      v_date := (r->>'date')::date;
      v_amount := (r->>'amount')::bigint;
    exception when others then
      raise exception 'Every entry needs a date and an amount';
    end;
    if v_date is null or v_amount is null or v_amount <= 0 then raise exception 'Every entry needs a date and an amount'; end if;
    v_note := nullif(left(btrim(r->>'note'), 500), '');
    v_method := case when v_type = 'expense' then nullif(btrim(r->>'payment_method'), '') end;
    if v_method is not null and v_method not in ('upi', 'debit_card', 'credit_card', 'cash', 'other') then
      raise exception 'Unknown payment method %', v_method;
    end if;
    v_cat := null;
    if v_type = 'expense' and nullif(btrim(r->>'category'), '') is not null then
      select id into v_cat from categories
       where user_id = v_user and lower(name) = lower(btrim(r->>'category'))
       order by is_active desc limit 1;
      if v_cat is null then raise exception 'No category called %', btrim(r->>'category'); end if;
    end if;

    if exists (select 1 from transactions t
                where t.user_id = v_user and t.date = v_date and t.type = v_type and t.amount = v_amount
                  and t.category_id is not distinct from v_cat and coalesce(t.note, '') = coalesce(v_note, '')) then
      v_dupes := v_dupes + 1;
    else
      insert into transactions (user_id, category_id, amount, type, date, note, source, payment_method)
      values (v_user, v_cat, v_amount, v_type, v_date, v_note, 'import', v_method);
      v_added := v_added + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'duplicates', v_dupes);
end;
$$;
grant execute on function public.import_transactions(jsonb) to authenticated;
