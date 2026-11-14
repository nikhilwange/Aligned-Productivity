-- ─── Allow the Lite and Plus tiers in subscriptions.plan_tier ──────────────
--
-- The original check only allowed 'free' | 'pro' | 'max', so the Razorpay
-- webhook's update to 'lite' / 'plus' would be rejected and a paying user
-- would stay on Free. Existing rows are unaffected.
--
-- Applied by hand in the Supabase SQL editor (2026-11-14). Not re-runnable
-- as-is if the constraint has already been replaced — check first with:
--   select pg_get_constraintdef(oid) from pg_constraint
--   where conname = 'subscriptions_plan_tier_check';

begin;
alter table public.subscriptions drop constraint subscriptions_plan_tier_check;
alter table public.subscriptions add constraint subscriptions_plan_tier_check
  check (plan_tier in ('free', 'lite', 'plus', 'pro', 'max'));
commit;
