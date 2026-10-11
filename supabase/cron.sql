-- Apply after enabling Supabase Cron (pg_cron) in the project dashboard.
-- This calls the retention function once a day at 03:15 UTC.
select cron.schedule('noor-retention-daily', '15 3 * * *', 'select public.noor_prune_data();');
