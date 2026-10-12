-- Delete expired demo conversations every 15 minutes.
create extension if not exists pg_cron;
select cron.schedule(
  'noor-demo-prune',
  '*/15 * * * *',
  'select public.noor_prune_demo_sessions();'
);
