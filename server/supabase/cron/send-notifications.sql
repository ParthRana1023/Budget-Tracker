-- Hourly schedule for the email job (Edge Function send-notifications). Run once in the
-- Supabase SQL editor AFTER deploying the function, with your values in place of the
-- <PLACEHOLDERS>. Not a migration: it holds your project URL and a secret.
--
--   <PROJECT_REF>  the project's ref (Settings > General), as in https://<PROJECT_REF>.supabase.co
--   <CRON_SECRET>  any long random string; set the same value as the function's CRON_SECRET secret

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- The secret lives in Vault, not in the job's text.
select vault.create_secret('<CRON_SECRET>', 'send_notifications_cron_secret');

select cron.unschedule('send-notifications') where exists (select 1 from cron.job where jobname = 'send-notifications');
select cron.schedule(
  'send-notifications',
  '5 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'send_notifications_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
