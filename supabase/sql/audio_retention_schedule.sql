-- ─── Daily audio sweep: cleanup-failed-audio → audio-retention ─────────────
--
-- NOT applied automatically. Run each step by hand in the Supabase SQL
-- editor, in order. Prerequisite: the audio-retention Edge Function is
-- deployed (dashboard, Verify JWT = ON; paste
-- supabase/functions/audio-retention/index.standalone.ts).
--
-- Live setup this replaces:
--   cron job 'cleanup-failed-recording-audio', '0 3 * * *',
--   SELECT public.trigger_cleanup_failed_audio();
--   → SECURITY DEFINER function reading Vault secret 'cleanup_function_token'
--     and posting to /functions/v1/cleanup-failed-audio.


-- ── Step 1 — create public.trigger_audio_retention(dry_run) ─────────────────
-- A copy of trigger_cleanup_failed_audio: same Vault token, same search_path,
-- SECURITY DEFINER, 30 s timeout — but posting to /functions/v1/audio-retention
-- with body {"dryRun": <dry_run>}. The project URL is taken from the existing
-- function's definition, so nothing needs to be pasted by hand.
do $outer$
declare
  base_url text;
begin
  base_url := substring(
    pg_get_functiondef('public.trigger_cleanup_failed_audio()'::regprocedure)
    from '(https?://[^''"[:space:]]+)/functions/v1/cleanup-failed-audio'
  );
  if base_url is null then
    raise exception 'Could not find the …/functions/v1/cleanup-failed-audio URL in public.trigger_cleanup_failed_audio().';
  end if;

  execute format($create$
    create or replace function public.trigger_audio_retention(dry_run boolean default false)
    returns bigint
    language plpgsql
    security definer
    set search_path = public, net, vault
    as $fn$
    declare
      token text;
      request_id bigint;
    begin
      select decrypted_secret into token
      from vault.decrypted_secrets
      where name = 'cleanup_function_token';
      if token is null then
        raise exception 'Vault secret cleanup_function_token not found';
      end if;

      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || token
        ),
        body := jsonb_build_object('dryRun', dry_run),
        timeout_milliseconds := 30000
      ) into request_id;

      return request_id;
    end
    $fn$;
  $create$, base_url || '/functions/v1/audio-retention');
end
$outer$;

revoke execute on function public.trigger_audio_retention(boolean) from public, anon, authenticated;

-- Check: the new function exists and posts to …/functions/v1/audio-retention.
select pg_get_functiondef('public.trigger_audio_retention(boolean)'::regprocedure);


-- ── Step 2 — dry run (deletes nothing) ─────────────────────────────────────
-- 2a. Fire it; note the returned request id.
select public.trigger_audio_retention(true) as request_id;

-- 2b. ~10–30 s later, read the response. Replace <request_id> with 2a's value.
--     content.deletions lists every file it WOULD delete: path, reason, row id
--     or 'orphan'. The same lines are in the function's logs.
select id, status_code, timed_out, error_msg, content::jsonb
from net._http_response
where id = <request_id>;

-- 2c. Optional: preview what a shorter window would catch today (dry run only;
--     real runs ignore the override). Here: 1 day instead of 30. Read the
--     response as in 2b.
select net.http_post(
  url := substring(
    pg_get_functiondef('public.trigger_audio_retention(boolean)'::regprocedure)
    from '(https?://[^''"[:space:]]+/functions/v1/audio-retention)'
  ),
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || s.decrypted_secret
  ),
  body := jsonb_build_object('dryRun', true, 'retentionDaysOverride', 1),
  timeout_milliseconds := 30000
) as request_id
from vault.decrypted_secrets s
where s.name = 'cleanup_function_token';


-- ── Step 3 — switch the schedule ────────────────────────────────────────────
-- ⚠️ Run ONLY after fix/stt-cost-leak is merged and deployed to production.
select cron.schedule(
  'audio-retention-daily',
  '0 3 * * *',
  'SELECT public.trigger_audio_retention();'
);
select cron.unschedule('cleanup-failed-recording-audio');


-- ── Step 4 — verify ─────────────────────────────────────────────────────────
-- Expect exactly one audio job: 'audio-retention-daily', '0 3 * * *',
-- SELECT public.trigger_audio_retention(); — and no 'cleanup-failed-recording-audio'.
select jobid, jobname, schedule, command, active
from cron.job
order by jobid;


-- ── Step 5 — later: remove the old function (separate, when you're ready) ──
-- After audio-retention-daily has run cleanly for a few days:
--
-- drop function if exists public.trigger_cleanup_failed_audio();
--
-- …and delete the cleanup-failed-audio Edge Function in the dashboard.
