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
// Every deletion is logged: path, reason, and row id (or 'orphan').
// Dry run — report what WOULD be deleted, delete nothing — when the request
// body has {"dryRun": true} OR the RETENTION_DRY_RUN secret is 'true'. In a dry
// run only, {"retentionDaysOverride": <int>} replaces the 30-day windows, to
// preview what a rule would catch; real runs ignore it.
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

export interface RetentionVerdict {
  action: 'keep' | 'delete';
  reason: string;
  /** When 'keep' is time-limited: the moment the audio becomes deletable. */
  deleteAtMs?: number;
}

/** Days for a time-based rule — the dry-run override (if any) replaces them. */
const days = (normal: number, override?: number) =>
  override !== undefined && Number.isInteger(override) && override >= 0 ? override : normal;

function timed(label: string, anchorMs: number, retentionDays: number, nowMs: number): RetentionVerdict {
  const deleteAtMs = anchorMs + retentionDays * DAY_MS;
  return nowMs >= deleteAtMs
    ? { action: 'delete', reason: `${label}: no new uploads for ${retentionDays} days`, deleteAtMs }
    : { action: 'keep', reason: `${label}: within the ${retentionDays}-day retention window`, deleteAtMs };
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
    return timed('orphan (no recordings row)', p.lastUploadMs, days(ORPHAN_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'processing') return { action: 'keep', reason: "row is 'processing'" };
  if (p.rowStatus === 'error' || p.rowStatus === 'interrupted') {
    return timed(`row is '${p.rowStatus}'`, p.lastUploadMs, days(FAILED_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  if (p.rowStatus === 'completed') {
    if (!p.hasUnclearParts) return { action: 'delete', reason: 'completed with no unclear/failed parts' };
    return timed('completed with unclear parts', p.lastUploadMs, days(KEPT_AUDIO_RETENTION_DAYS, o), p.nowMs);
  }
  return { action: 'keep', reason: `row is '${p.rowStatus}'` };
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
  if (p.rowStatus === 'completed') return { action: 'delete', reason: 'completed: archive should have been deleted on success' };
  if (p.rowStatus === 'error') {
    return timed("legacy archive of an 'error' row", p.createdMs, days(LEGACY_ERROR_AUDIO_RETENTION_DAYS, p.retentionDaysOverride), p.nowMs);
  }
  return { action: 'keep', reason: `row is '${p.rowStatus}'` };
}

/** A temporary <user>/chunks/* upload piece: deleted once older than 24 h. */
export function staleChunkRetention(p: { uploadedMs: number; nowMs: number }): RetentionVerdict {
  const deleteAtMs = p.uploadedMs + STALE_CHUNK_HOURS * 60 * 60 * 1000;
  return p.nowMs >= deleteAtMs
    ? { action: 'delete', reason: 'stale_chunk', deleteAtMs }
    : { action: 'keep', reason: 'chunk still fresh', deleteAtMs };
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
const PAGE = 1000;
const REMOVE_BATCH = 100;

interface Deletion {
  path: string;
  reason: string;
  row: string; // recordings row id, or 'orphan'
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

/** Every entry directly under `prefix` (files have an id; folders don't). */
async function listAll(supabase: SupabaseClient, prefix: string) {
  const out: Array<{ name: string; id: string | null; updated_at?: string; created_at?: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, { limit: PAGE, offset });
    if (error) throw new Error(`list ${prefix || '/'} failed: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function removePaths(supabase: SupabaseClient, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error(`storage remove failed: ${error.message}`);
  }
}

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
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const now = Date.now();
  const tag = dryRun ? '[audio-retention][DRY RUN]' : '[audio-retention]';
  const deletions: Deletion[] = [];
  const log = (d: Deletion) => {
    deletions.push(d);
    console.log(`${tag} ${dryRun ? 'would delete' : 'delete'} ${d.path} — ${d.reason} — row ${d.row}`);
  };

  try {
    // ── 1. Legacy single-file archives ──────────────────────────────────────
    const { data: legacyRows, error: legacyErr } = await supabase
      .from('recordings')
      .select('id, audioPath, status, created_at')
      .not('audioPath', 'is', null);
    if (legacyErr) throw new Error(`legacy query failed: ${legacyErr.message}`);
    const legacyDeleted: string[] = [];
    const legacyPaths: string[] = [];
    for (const r of legacyRows ?? []) {
      const verdict = legacyArchiveRetention({ rowStatus: r.status, createdMs: Date.parse(r.created_at), nowMs: now, retentionDaysOverride });
      if (verdict.action !== 'delete') continue;
      log({ path: r.audioPath, reason: `legacy archive: ${verdict.reason}`, row: r.id });
      legacyDeleted.push(r.id);
      legacyPaths.push(r.audioPath);
    }
    if (!dryRun && legacyPaths.length > 0) {
      await removePaths(supabase, legacyPaths);
      const { error } = await supabase.from('recordings').update({ audioPath: null }).in('id', legacyDeleted);
      if (error) throw new Error(`audioPath nulling failed: ${error.message}`);
    }

    // ── 2 & 3. Per user: segmented recordings, then stale temporary chunks ──
    let foldersSeen = 0;
    let foldersKept = 0;
    let staleChunks = 0;
    for (const userDir of await listAll(supabase, '')) {
      if (userDir.id) continue; // a file at the root, not a user folder
      const uid = userDir.name;

      // 3. <user>/chunks/* — temporary 25 s upload pieces, normally deleted
      //    right after transcription; anything older than 24 h is stale.
      const chunkFiles = (await listAll(supabase, `${uid}/chunks`)).filter((f) => f.id);
      const stalePaths: string[] = [];
      for (const f of chunkFiles) {
        const uploadedMs = Date.parse(f.updated_at || f.created_at || '');
        if (!Number.isFinite(uploadedMs)) continue;
        if (staleChunkRetention({ uploadedMs, nowMs: now }).action !== 'delete') continue;
        const path = `${uid}/chunks/${f.name}`;
        log({ path, reason: 'stale_chunk', row: 'orphan' });
        stalePaths.push(path);
      }
      staleChunks += stalePaths.length;
      if (!dryRun && stalePaths.length > 0) await removePaths(supabase, stalePaths);

      // 2. <user>/recordings/<recoveryId>/
      const recFolders = (await listAll(supabase, `${uid}/recordings`)).filter((e) => !e.id);
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
        if (error) throw new Error(`row query failed: ${error.message}`);
        for (const r of data ?? []) rows.set(r.recoveryId, { id: r.id, status: r.status, transcript: r.transcript });
      }

      for (const folder of recFolders) {
        foldersSeen++;
        const prefix = `${uid}/recordings/${folder.name}`;
        const files = (await listAll(supabase, prefix)).filter((f) => f.id);
        if (files.length === 0) continue;
        const times = files.map((f) => Date.parse(f.updated_at || f.created_at || '')).filter(Number.isFinite);
        const lastUploadMs = times.length ? Math.max(...times) : now;
        const row = rows.get(folder.name) ?? null;
        const verdict = segmentedAudioRetention({
          rowStatus: row ? row.status : null,
          hasUnclearParts: !!row?.transcript?.includes(UNCLEAR_MARKER),
          lastUploadMs,
          nowMs: now,
          retentionDaysOverride,
        });
        if (verdict.action !== 'delete') { foldersKept++; continue; }
        const paths = files.map((f) => `${prefix}/${f.name}`);
        for (const path of paths) log({ path, reason: `segmented: ${verdict.reason}`, row: row ? row.id : 'orphan' });
        if (!dryRun) await removePaths(supabase, paths);
      }
    }

    const summary = {
      dryRun,
      retentionDaysOverride: retentionDaysOverride ?? null,
      deletedCount: deletions.length,
      legacyArchives: legacyPaths.length,
      staleChunks,
      segmentedFoldersSeen: foldersSeen,
      segmentedFoldersKept: foldersKept,
      deletions,
    };
    console.log(`${tag} done: ${deletions.length} file(s) ${dryRun ? 'would be' : ''} deleted`);
    return jsonResponse(summary);
  } catch (err) {
    console.error(`${tag} failed:`, (err as Error).message);
    return jsonResponse({ error: (err as Error).message, dryRun, deletionsSoFar: deletions }, 500);
  }
});
