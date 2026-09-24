// ─── audio-retention: daily audio sweep (replaces cleanup-failed-audio) ─────
//
// Applies the SHARED retention rules (../_shared/audioRetention.ts — the same
// rules the client's cleanup policy uses) to everything in the
// 'audio-recordings' bucket:
//
//   1. Legacy single-file archives (recordings.audioPath):
//        completed → delete; error → delete after 30 days; processing → never.
//   2. Segmented recordings (<user>/recordings/<recoveryId>/seg-*):
//        row processing / interrupted / error → never
//        row completed, transcript has no unclear parts → delete
//        row completed with unclear parts → delete 30 days after the last upload
//        no row at all (orphan) → delete 30 days after the last upload
//
// Every deletion is logged: path, reason, and row id (or 'orphan').
// RETENTION_DRY_RUN=true → report what WOULD be deleted, delete nothing.
//
// Invoked daily by pg_cron via pg_net with a service-role JWT; verify_jwt=true
// at the gateway, and the handler re-checks the role claim.
//
// Dashboard deploys use index.standalone.ts (this file with the shared rules
// inlined; regenerate with `npm run edge:standalone`).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
// @inline-shared-rules
import { segmentedAudioRetention, legacyArchiveRetention, UNCLEAR_MARKER } from '../_shared/audioRetention.ts';
// @end-inline-shared-rules

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
  const dryRun = Deno.env.get('RETENTION_DRY_RUN') === 'true';
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
      const verdict = legacyArchiveRetention({ rowStatus: r.status, createdMs: Date.parse(r.created_at), nowMs: now });
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

    // ── 2. Segmented recordings: <user>/recordings/<recoveryId>/ ─────────────
    let foldersSeen = 0;
    let foldersKept = 0;
    for (const userDir of await listAll(supabase, '')) {
      if (userDir.id) continue; // a file at the root, not a user folder
      const uid = userDir.name;
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
        });
        if (verdict.action !== 'delete') { foldersKept++; continue; }
        const paths = files.map((f) => `${prefix}/${f.name}`);
        for (const path of paths) log({ path, reason: `segmented: ${verdict.reason}`, row: row ? row.id : 'orphan' });
        if (!dryRun) await removePaths(supabase, paths);
      }
    }

    const summary = {
      dryRun,
      deletedCount: deletions.length,
      legacyArchives: legacyPaths.length,
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
