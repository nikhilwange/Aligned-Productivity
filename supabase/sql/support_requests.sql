-- Help & Support requests (in-app support form).
-- Written only by the Vercel route api/support/submit.ts with the service key,
-- which also enforces the 5-requests-per-day limit. RLS is on with NO policies,
-- so the browser can't read, insert, update or delete anything here.
-- Run once in Supabase Dashboard → SQL Editor.

create table public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  email       text not null,
  plan_tier   text not null,
  topic       text not null check (topic in ('recording','transcription_notes','payment_plan','account','other')),
  message     text not null check (char_length(message) between 1 and 2000),
  platform    text,          -- web / desktop / ios
  app_version text,
  status      text not null default 'open' check (status in ('open','closed')),
  email_sent  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index support_requests_user_created_idx
  on public.support_requests (user_id, created_at desc);

alter table public.support_requests enable row level security;
-- No policies on purpose: the browser can do nothing with this table.
-- The server route uses the service key, which is allowed to insert.
