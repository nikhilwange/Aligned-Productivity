// ⚠️ GENERATED from index.ts + ../_shared/audioRetention.ts by
// scripts/build-edge-standalone.mjs (npm run edge:standalone). Do not edit;
// paste this whole file into the Supabase dashboard as the audio-retention function.

// ─── audio-retention: daily audio sweep (replaces cleanup-failed-audio) ─────
//
// Applies the SHARED retention rules (../_shared/audioRetention.ts — the same
// rules the client's cleanup policy uses) to everything in the
// 'audio-recordings' bucket:
//
//   1. Legacy single-file archives (recordings.audioPath):
//        completed → delete; error → delete after 30 days; processing → never.
//   2. Segmented recordings (<user>/recordings/<recoveryId>/seg-*):
//        row processing → never
//        row completed, transcript has no unclear parts → delete
//        row completed with unclear parts → delete 30 days after the last upload
//        row error / interrupted → delete 30 days after the last upload
//        no row at all (orphan) → delete 30 days after the last upload
//   3. Temporary upload pieces (<user>/chunks/*) older than 24 h → delete ('stale_chunk').
//
// Every deletion is logged: path, reason, and row id (or 'orphan'). The
// response + a log line summarise counts and MB by reason; the full path list
// is returned only in dry runs.
//
// Dry run — report what WOULD be deleted, delete nothing — when the request
// body has {"dryRun": true} OR the RETENTION_DRY_RUN secret is 'true'. In a dry
// run only, {"retentionDaysOverride": <int>} replaces the 30-day windows, to
// preview what a rule would catch; real runs ignore it.
//
// Robustness:
//   - every Storage list() pages through ALL results (until an empty page)
//   - deletes go in batches of ≤100 paths; a failed batch is logged and
//     skipped, never fatal (its files are simply picked up again next run)
//   - at most MAX_DELETES_PER_RUN files per run, and no new work is started
//     after TIME_BUDGET_MS; the daily schedule finishes any remainder
//
// Invoked daily by pg_cron: public.trigger_audio_retention() posts here with
// the Vault secret 'cleanup_function_token' as the Bearer token (see
// supabase/sql/audio_retention_schedule.sql). Auth is exactly the old
// cleanup-failed-audio's: the gateway verifies the JWT signature
// (Verify JWT = ON), and the handler requires its role claim to be
// 'service_role'.
//
// Dashboard deploys use index.standalone.ts (this file with the shared rules
// inlined; regenerate with `npm run edge:standalone`).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
// BEGIN SHARED AUDIO RETENTION RULES
export const KEPT_AUDIO_RETENTION_DAYS = 30; // completed session with unclear/failed parts
export const FAILED_AUDIO_RETENTION_DAYS = 30; // session in 'error' / 'interrupted'
export const ORPHAN_AUDIO_RETENTION_DAYS = 30; // segments with no recordings row
export const RETENTION_WARNING_DAYS = 7; // banner countdown starts this many days before deletion
export const LEGACY_ERROR_AUDIO_RETENTION_DAYS = 30; // single-file audioPath archive of an 'error' row
export const STALE_CHUNK_HOURS = 24; // temporary <user>/chunks/* upload pieces

/**
 * The placeholder the transcript contains wherever audio couldn't be
 * transcribed — both 'unclear' chunks and wholly 'failed' segments write it.
 * The server sweep detects "has unclear parts" by this marker alone.
 */
export const UNCLEAR_MARKER = '[…audio unclear…]';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Stable category of a verdict — what the sweep's summary counts by. */
export type RetentionCode =
  | 'keep'
  | 'completed_clean' // completed, nothing to retry — should have gone on success
  | 'kept_audio_expired' // completed with unclear parts, retry window over
  | 'error_expired' // error / interrupted, retry window over
  | 'orphan' // no recordings row, retention window over
  | 'legacy_archive' // single-file audioPath archive
  | 'stale_chunk'; // temporary <user>/chunks/* piece older than 24 h

export interface RetentionVerdict {
  action: 'keep' | 'delete';
  code: RetentionCode;
  reason: string;
  /** When 'keep' is time-limited: the moment the audio becomes deletable. */
  deleteAtMs?: number;
}

/** Days for a time-based rule — the dry-run override (if any) replaces them. */
const days = (normal: number, override?: number) =>
  override !== undefined && Number.isInteger(override) && override >= 0 ? override : normal;

function timed(code: RetentionCode, label: string, anchorMs: number, retentionDays: number, nowMs: number): RetentionVerdict {
  const deleteAtMs = anchorMs + retentionDays * DAY_MS;
  return nowMs >= deleteAtMs
    ? { action: 'delete', code, reason: `${label}: no new uploads for ${retentionDays} days`, deleteAtMs }
    : { action: 'keep', code: 'keep', reason: `${label}: within the ${retentionDays}-day retention window`, deleteAtMs };
}

/**
 * A segmented recording's Storage folder (recordings/<recoveryId>/).
 *   rowStatus          the recordings row's status; null = no row (orphan)
 *   hasUnclearParts    the row's transcript contains UNCLEAR_MARKER
 *   lastUploadMs       newest object time in the folder (the retention anchor)
 * Rules:
 *   processing                          → keep, always
 *   completed, no unclear parts         → delete (a retry isn't needed)
 *   completed with unclear parts        → delete 30 days after the last upload
 *   error / interrupted                 → delete 30 days after the last upload
 *   no row (orphan)                     → delete 30 days after the last upload
 *   any other status                    → keep
 * retentionDaysOverride (dry runs only) replaces the 30 days.
 */
export function segmentedAudioRetention(p: {
  rowStatus: string | null;
  hasUnclearParts: boolean;
  lastUploadMs: number;
  nowMs: number;
  retentionDaysOverride?: number;
}): RetentionVerdict {
  const o = p.retentionDaysOverride;
  if (p.rowStatus === null) {
    return timed('orphan', 'orphan (no recordings row)', p.lastUploadMs, days(ORPHAN_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'processing') return { action: 'keep', code: 'keep', reason: "row is 'processing'" };
  if (p.rowStatus === 'error' || p.rowStatus === 'interrupted') {
    return timed('error_expired', `row is '${p.rowStatus}'`, p.lastUploadMs, days(FAILED_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'completed') {
    if (!p.hasUnclearParts) return { action: 'delete', code: 'completed_clean', reason: 'completed with no unclear/failed parts' };
    return timed('kept_audio_expired', 'completed with unclear parts', p.lastUploadMs, days(KEPT_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  return { action: 'keep', code: 'keep', reason: `row is '${p.rowStatus}'` };
}

/**
 * A legacy single-file archive (recordings.audioPath).
 *   processing → keep; completed → delete (should have gone on success);
 *   error → delete 30 days after the row was created; anything else → keep.
 */
export function legacyArchiveRetention(p: {
  rowStatus: string;
  createdMs: number;
  nowMs: number;
  retentionDaysOverride?: number;
}): RetentionVerdict {
  if (p.rowStatus === 'completed') return { action: 'delete', code: 'legacy_archive', reason: 'completed: archive should have been deleted on success' };
  if (p.rowStatus === 'error') {
    return timed('legacy_archive', "legacy archive of an 'error' row", p.createdMs, days(LEGACY_ERROR_AUDIO_RETENTION_DAYS, p.retentionDaysOverride), p.nowMs);
  }
  return { action: 'keep', code: 'keep', reason: `row is '${p.rowStatus}'` };
}

/** A temporary <user>/chunks/* upload piece: deleted once older than 24 h. */
export function staleChunkRetention(p: { uploadedMs: number; nowMs: number }): RetentionVerdict {
  const deleteAtMs = p.uploadedMs + STALE_CHUNK_HOURS * 60 * 60 * 1000;
  return p.nowMs >= deleteAtMs
    ? { action: 'delete', code: 'stale_chunk', reason: 'stale_chunk', deleteAtMs }
    : { action: 'keep', code: 'keep', reason: 'chunk still fresh', deleteAtMs };
}

/** Whole days until deletion, when inside the warning window; otherwise null. */
export function retentionWarningDaysLeft(deleteAtMs: number | undefined, nowMs: number): number | null {
  if (deleteAtMs === undefined) return null;
  const msLeft = deleteAtMs - nowMs;
  if (msLeft > RETENTION_WARNING_DAYS * DAY_MS) return null;
  return Math.max(0, Math.ceil(msLeft / DAY_MS));
}
// END SHARED AUDIO RETENTION RULES

const BUCKET = 'audio-recordings';
const LIST_PAGE = 100; // Storage's default page size; we page until an empty page regardless
const REMOVE_BATCH = 100;
const MAX_DELETES_PER_RUN = 2000;
// Edge Function wall-clock limit is 150 s (free) / 400 s (paid). Stop
// starting new list/delete work after this; the next daily run continues.
const TIME_BUDGET_MS = 100_000;

interface StorageEntry {
  name: string;
  id: string | null; // null for folders
  updated_at?: string;
  created_at?: string;
  metadata?: { size?: number } | null;
}

interface PlannedDeletion {
  path: string;
  code: Exclude<RetentionCode, 'keep'>;
  reason: string;
  row: string; // recordings row id, or 'orphan'
  bytes: number;
  legacyRowId?: string; // set for legacy archives: null its audioPath once deleted
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function decodeJwtRole(authHeader: string | null): string | null {
  try {
    const token = authHeader?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    const json = JSON.parse(new TextDecoder().decode(bytes)) as { role?: string };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

const mb = (bytes: number) => Math.round((bytes / (1024 * 1024)) * 10) / 10;
const sizeOf = (e: StorageEntry) => Number(e.metadata?.size ?? 0) || 0;
const timeOf = (e: StorageEntry) => Date.parse(e.updated_at || e.created_at || '');

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (decodeJwtRole(req.headers.get('Authorization')) !== 'service_role') {
    return jsonResponse({ error: 'service_role JWT required' }, 403);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  // Body is optional (the old cron call sent none): { dryRun?, retentionDaysOverride? }.
  let body: { dryRun?: unknown; retentionDaysOverride?: unknown } = {};
  try { body = (await req.json()) ?? {}; } catch { /* no / non-JSON body */ }
  const dryRun = body.dryRun === true || Deno.env.get('RETENTION_DRY_RUN') === 'true';
  const rawOverride = body.retentionDaysOverride;
  const retentionDaysOverride =
    dryRun && typeof rawOverride === 'number' && Number.isInteger(rawOverride) && rawOverride >= 0 ? rawOverride : undefined;
  if (rawOverride !== undefined && retentionDaysOverride === undefined) {
    console.warn('[audio-retention] retentionDaysOverride ignored (real run, or not a non-negative integer)');
  }

  const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const startedAt = Date.now();
  const now = startedAt;
  const tag = dryRun ? '[audio-retention][DRY RUN]' : '[audio-retention]';
  const outOfTime = () => Date.now() - startedAt > TIME_BUDGET_MS;

  const planned: PlannedDeletion[] = [];
  const problems: string[] = []; // non-fatal list / delete / update failures
  let capped = false; // hit MAX_DELETES_PER_RUN or the time budget
  const plan = (d: PlannedDeletion): boolean => {
    if (planned.length >= MAX_DELETES_PER_RUN) { capped = true; return false; }
    planned.push(d);
    return true;
  };

  /** Every entry directly under `prefix`, all pages. A failure is logged and yields what was read. */
  async function listAll(prefix: string): Promise<StorageEntry[]> {
    const out: StorageEntry[] = [];
    for (let offset = 0; offset < 1_000_000; ) {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .list(prefix, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) {
        problems.push(`list ${prefix || '/'} at offset ${offset}: ${error.message}`);
        console.error(`${tag} list ${prefix || '/'} failed at offset ${offset}:`, error.message);
        break;
      }
      if (!data || data.length === 0) break;
      out.push(...(data as StorageEntry[]));
      offset += data.length;
    }
    return out;
  }

  try {
    // ── 1. Legacy single-file archives ──────────────────────────────────────
    const { data: legacyRows, error: legacyErr } = await supabase
      .from('recordings')
      .select('id, audioPath, status, created_at')
      .not('audioPath', 'is', null);
    if (legacyErr) {
      problems.push(`legacy query: ${legacyErr.message}`);
    } else {
      const due = (legacyRows ?? [])
        .map((r) => ({ r, v: legacyArchiveRetention({ rowStatus: r.status, createdMs: Date.parse(r.created_at), nowMs: now, retentionDaysOverride }) }))
        .filter((x) => x.v.action === 'delete');
      // Sizes: list each archive's folder once.
      const byDir = new Map<string, typeof due>();
      for (const x of due) {
        const dir = x.r.audioPath.split('/').slice(0, -1).join('/');
        byDir.set(dir, [...(byDir.get(dir) ?? []), x]);
      }
      for (const [dir, items] of byDir) {
        if (outOfTime()) { capped = true; break; }
        const sizes = new Map((await listAll(dir)).map((e) => [e.name, sizeOf(e)]));
        for (const { r, v } of items) {
          if (!plan({
            path: r.audioPath, code: 'legacy_archive', reason: v.reason, row: r.id,
            bytes: sizes.get(r.audioPath.split('/').pop()!) ?? 0, legacyRowId: r.id,
          })) break;
        }
        if (capped) break;
      }
    }

    // ── 2 & 3. Per user: stale temporary chunks, then segmented recordings ──
    let foldersSeen = 0;
    let foldersKept = 0;
    users: for (const userDir of await listAll('')) {
      if (userDir.id) continue; // a file at the root, not a user folder
      if (capped || outOfTime()) { capped = true; break; }
      const uid = userDir.name;

      // 3. <user>/chunks/* — temporary 25 s upload pieces, normally deleted
      //    right after transcription; anything older than 24 h is stale.
      for (const f of await listAll(`${uid}/chunks`)) {
        if (!f.id) continue;
        const uploadedMs = timeOf(f);
        if (!Number.isFinite(uploadedMs)) continue;
        const v = staleChunkRetention({ uploadedMs, nowMs: now });
        if (v.action !== 'delete') continue;
        if (!plan({ path: `${uid}/chunks/${f.name}`, code: 'stale_chunk', reason: v.reason, row: 'orphan', bytes: sizeOf(f) })) break users;
      }

      // 2. <user>/recordings/<recoveryId>/
      const recFolders = (await listAll(`${uid}/recordings`)).filter((e) => !e.id);
      if (recFolders.length === 0) continue;

      // Rows for these recordings (this user only).
      const ids = recFolders.map((f) => f.name);
      const rows = new Map<string, { id: string; status: string; transcript: string | null }>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await supabase
          .from('recordings')
          .select('id, status, recoveryId, user_id, transcript:analysis->>transcript')
          .eq('user_id', uid)
          .in('recoveryId', ids.slice(i, i + 200));
        if (error) {
          // Without the rows we can't tell orphans from live recordings: skip this user entirely.
          problems.push(`row query for user ${uid}: ${error.message}`);
          continue users;
        }
        for (const r of data ?? []) rows.set(r.recoveryId, { id: r.id, status: r.status, transcript: r.transcript });
      }

      for (const folder of recFolders) {
        if (outOfTime()) { capped = true; break users; }
        foldersSeen++;
        const prefix = `${uid}/recordings/${folder.name}`;
        const files = (await listAll(prefix)).filter((f) => f.id);
        if (files.length === 0) continue;
        const times = files.map(timeOf).filter(Number.isFinite);
        const lastUploadMs = times.length ? Math.max(...times) : now;
        const row = rows.get(folder.name) ?? null;
        const v = segmentedAudioRetention({
          rowStatus: row ? row.status : null,
          hasUnclearParts: !!row?.transcript?.includes(UNCLEAR_MARKER),
          lastUploadMs,
          nowMs: now,
          retentionDaysOverride,
        });
        if (v.action !== 'delete' || v.code === 'keep') { foldersKept++; continue; }
        for (const f of files) {
          if (!plan({ path: `${prefix}/${f.name}`, code: v.code, reason: v.reason, row: row ? row.id : 'orphan', bytes: sizeOf(f) })) break users;
        }
      }
    }

    // ── Delete (or, in a dry run, just report) ─────────────────────────────
    const failed = new Set<string>();
    let failedBatches = 0;
    if (!dryRun) {
      for (let i = 0; i < planned.length; i += REMOVE_BATCH) {
        if (outOfTime()) {
          capped = true;
          planned.slice(i).forEach((d) => failed.add(d.path)); // not attempted this run
          problems.push(`time budget reached — ${planned.length - i} planned file(s) left for the next run`);
          break;
        }
        const batch = planned.slice(i, i + REMOVE_BATCH);
        const { error } = await supabase.storage.from(BUCKET).remove(batch.map((d) => d.path));
        if (error) {
          failedBatches++;
          batch.forEach((d) => failed.add(d.path));
          problems.push(`remove batch ${i / REMOVE_BATCH + 1} (${batch.length} files): ${error.message}`);
          console.error(`${tag} remove batch ${i / REMOVE_BATCH + 1} failed — skipped:`, error.message);
        }
      }
      // Legacy rows: null audioPath only where the archive really went.
      const legacyDone = planned.filter((d) => d.legacyRowId && !failed.has(d.path)).map((d) => d.legacyRowId!);
      for (let i = 0; i < legacyDone.length; i += 200) {
        const { error } = await supabase.from('recordings').update({ audioPath: null }).in('id', legacyDone.slice(i, i + 200));
        if (error) problems.push(`audioPath nulling: ${error.message}`);
      }
    }

    // ── Log + summary ─────────────────────────────────────────────────────
    const done = planned.filter((d) => !failed.has(d.path));
    for (const d of done) {
      console.log(`${tag} ${dryRun ? 'would delete' : 'deleted'} ${d.path} — ${d.code}: ${d.reason} — row ${d.row}`);
    }
    const byReason: Record<string, { files: number; mb: number }> = {};
    let totalBytes = 0;
    for (const d of done) {
      const b = (byReason[d.code] ??= { files: 0, mb: 0 });
      b.files++;
      b.mb += d.bytes;
      totalBytes += d.bytes;
    }
    for (const k of Object.keys(byReason)) byReason[k].mb = mb(byReason[k].mb);

    const summary = {
      dryRun,
      retentionDaysOverride: retentionDaysOverride ?? null,
      [dryRun ? 'wouldDelete' : 'deleted']: { files: done.length, mb: mb(totalBytes) },
      byReason,
      failedBatches,
      failedFiles: dryRun ? 0 : failed.size,
      capped,
      maxDeletesPerRun: MAX_DELETES_PER_RUN,
      segmentedFoldersSeen: foldersSeen,
      segmentedFoldersKept: foldersKept,
      elapsedMs: Date.now() - startedAt,
      problems,
      ...(dryRun ? { paths: done.map(({ path, code, row, bytes }) => ({ path, code, row, bytes })) } : {}),
    };
    console.log(`${tag} summary: ${JSON.stringify({ ...summary, paths: undefined })}`);
    return jsonResponse(summary);
  } catch (err) {
    console.error(`${tag} failed:`, (err as Error).message);
    return jsonResponse({ error: (err as Error).message, dryRun, plannedSoFar: planned.length, problems }, 500);
  }
});
