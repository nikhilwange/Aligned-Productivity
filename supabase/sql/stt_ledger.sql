-- ─── STT ledger: append-only record of every Sarvam request ─────────────────
--
-- Written by the Vercel proxy (api/sarvam/transcribe.ts) with the service-role
-- key: one row per Sarvam call (ok / error) and one per call the proxy refused
-- (rejected). It is the server-side source of truth for how much audio was
-- actually sent to Sarvam, independent of whether a session was ever saved.
--
-- NOT applied automatically. Run it by hand in the Supabase SQL editor.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).

create table if not exists public.stt_ledger (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  user_id       uuid not null,
  recovery_id   text,            -- base recoveryId, without the ":segN" suffix
  segment_index int,
  audio_seconds numeric(10,2),
  bytes         int,
  status        text not null check (status in ('ok', 'error', 'rejected')),
  http_status   int,
  reject_reason text,            -- session_ceiling | monthly_limit | stt_disabled | missing_recovery_id
  provider      text not null default 'sarvam',
  path          text             -- 'inline' | 'storage'
);
-- Deliberately NO foreign keys: ledger rows must survive session/user deletion.

create index if not exists stt_ledger_user_created_idx on public.stt_ledger (user_id, created_at);
create index if not exists stt_ledger_recovery_idx     on public.stt_ledger (recovery_id);

-- ─── Privileges ─────────────────────────────────────────────────────────────
-- Clients can only ever READ their own rows. Only the service role writes
-- (it bypasses RLS and is granted explicitly below).
revoke all on table public.stt_ledger from anon, authenticated;
revoke all on sequence public.stt_ledger_id_seq from anon, authenticated;
grant select on table public.stt_ledger to authenticated;

grant select, insert on table public.stt_ledger to service_role;
grant usage, select on sequence public.stt_ledger_id_seq to service_role;

alter table public.stt_ledger enable row level security;

-- Users may read their own rows. No insert/update/delete policies.
drop policy if exists "stt_ledger_select_own" on public.stt_ledger;
create policy "stt_ledger_select_own" on public.stt_ledger
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- ─── Aggregates used by the proxy guard ─────────────────────────────────────
-- SECURITY INVOKER: they run with the caller's rights, so RLS applies. The
-- proxy calls them as service_role (sees all rows); a signed-in user calling
-- them directly would only ever sum their own rows. Empty search_path, so every
-- object is schema-qualified (pg_catalog is always searched implicitly).

-- Seconds of audio successfully transcribed for one recording (all segments).
create or replace function public.stt_seconds_for_recovery(p_recovery_id text)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(l.audio_seconds), 0)
  from public.stt_ledger as l
  where l.recovery_id = p_recovery_id
    and l.status = 'ok';
$$;

-- Seconds of audio successfully transcribed for a user in a calendar month,
-- with month boundaries in Asia/Kolkata.
create or replace function public.stt_seconds_for_user_month(p_user_id uuid, p_year int, p_month int)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(l.audio_seconds), 0)
  from public.stt_ledger as l
  where l.user_id = p_user_id
    and l.status = 'ok'
    and l.created_at >= pg_catalog.make_timestamptz(p_year, p_month, 1, 0, 0, 0, 'Asia/Kolkata')
    and l.created_at <  pg_catalog.make_timestamptz(
                          case when p_month = 12 then p_year + 1 else p_year end,
                          case when p_month = 12 then 1 else p_month + 1 end,
                          1, 0, 0, 0, 'Asia/Kolkata');
$$;

-- Only the proxy needs these.
revoke execute on function public.stt_seconds_for_recovery(text) from public, anon, authenticated;
revoke execute on function public.stt_seconds_for_user_month(uuid, int, int) from public, anon, authenticated;
grant  execute on function public.stt_seconds_for_recovery(text) to service_role;
grant  execute on function public.stt_seconds_for_user_month(uuid, int, int) to service_role;
