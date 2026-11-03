update public.categories set name = 'EMI / Loans' where name = 'EMI & Loans' and type = 'fixed';
update public.categories set name = 'Transport / Fuel' where name = 'Transport & Fuel' and type = 'flexible';

insert into public.categories (user_id, name, type, monthly_limit)
select u.id, starter.name, starter.type, 0
from auth.users u
cross join (values
  ('Rent / Housing', 'fixed'), ('Utilities & Bills', 'fixed'), ('EMI / Loans', 'fixed'), ('Insurance', 'fixed'), ('Subscriptions', 'fixed'),
  ('Groceries', 'flexible'), ('Food & Dining Out', 'flexible'), ('Transport / Fuel', 'flexible'), ('Shopping', 'flexible'), ('Entertainment', 'flexible'), ('Health', 'flexible'), ('Travel', 'flexible'), ('Miscellaneous', 'flexible')
) as starter(name, type)
where not exists (select 1 from public.categories c where c.user_id = u.id and c.name = starter.name and c.type = starter.type);
