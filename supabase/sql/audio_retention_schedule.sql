-- ─── Switch the daily audio sweep: cleanup-failed-audio → audio-retention ──
--
-- NOT applied automatically. Run the steps by hand in the Supabase SQL editor,
-- in order, AFTER deploying the audio-retention Edge Function (with the
-- secret RETENTION_DRY_RUN=true for its first run).

-- Step 1 — look at the existing job (note its schedule and command).
select jobid, jobname, schedule, command
from cron.job
where command like '%cleanup-failed-audio%';

-- Step 2 — dry run: call the new function once, right now, with the SAME
-- request the old job makes (same auth), pointed at audio-retention. The
-- JSON response and the function logs list every file it WOULD delete.
-- (pg_net is async: read the response with the second query a few seconds later.)
do $$
declare cmd text;
begin
  select replace(command, 'cleanup-failed-audio', 'audio-retention') into cmd
  from cron.job where command like '%cleanup-failed-audio%' limit 1;
  if cmd is null then
    raise exception 'No cleanup-failed-audio cron job found — schedule audio-retention by hand (see its index.ts header).';
  end if;
  execute cmd;
end $$;

select id, status_code, content::json
from net._http_response
order by created desc
limit 1;

-- Step 3 — only once the dry-run list looks right: switch the schedule.
-- Creates 'audio-retention-daily' with the old job's schedule and auth, then
-- removes the old job. Then remove the RETENTION_DRY_RUN secret (or set it to
-- false) so the next scheduled run really deletes.
do $$
declare j record;
begin
  select * into j from cron.job where command like '%cleanup-failed-audio%' limit 1;
  if j is null then
    raise exception 'No cleanup-failed-audio cron job found.';
  end if;
  perform cron.schedule('audio-retention-daily', j.schedule, replace(j.command, 'cleanup-failed-audio', 'audio-retention'));
  perform cron.unschedule(j.jobid);
end $$;

-- Step 4 — verify: exactly one audio job, pointing at audio-retention.
select jobid, jobname, schedule, command
from cron.job
where command like '%audio-retention%' or command like '%cleanup-failed-audio%';
