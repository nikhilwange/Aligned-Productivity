// Privacy-promise enforcement.
//
// Sweeps two classes of audio archives the app should no longer be holding:
//   1. status='completed' with a non-null audioPath — orphans from
//      delete-on-success that failed at the client.
//   2. status='error' with audioPath older than 7 days — failed sessions
//      whose retry window has expired.
//
// Invoked daily by pg_cron via pg_net (see migration
// cleanup_failed_recording_audio_v2_edge_fn). verify_jwt=true at the gateway
// means we don't need extra auth inside — pg_cron sends a Supabase
// service-role JWT which the gateway validates before this handler runs.
//
// As a defence-in-depth check we still confirm the JWT's role claim is
// 'service_role' so a leaked user JWT can't trigger us.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const FAILED_RETENTION_DAYS = 7;
const BUCKET = 'audio-recordings';

interface RecordingRow {
  id: string;
  audioPath: string;
  status: 'completed' | 'error' | 'processing';
  created_at: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const role = decodeJwtRole(req.headers.get('Authorization'));
  if (role !== 'service_role') {
    return jsonResponse({ error: 'service_role JWT required' }, 403);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cutoffIso = new Date(Date.now() - FAILED_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: orphans, error: queryErr } = await supabase
    .from('recordings')
    .select('id, audioPath, status, created_at')
    .not('audioPath', 'is', null)
    .or(`status.eq.completed,and(status.eq.error,created_at.lt.${cutoffIso})`);

  if (queryErr) {
    return jsonResponse({ error: `query failed: ${queryErr.message}` }, 500);
  }

  const rows = (orphans ?? []) as RecordingRow[];
  if (rows.length === 0) {
    return jsonResponse({ deleted: 0, paths: [] });
  }

  const paths = rows.map((r) => r.audioPath);
  const { data: removed, error: removeErr } = await supabase.storage.from(BUCKET).remove(paths);
  if (removeErr) {
    return jsonResponse({ error: `storage remove failed: ${removeErr.message}` }, 500);
  }

  const { error: updateErr } = await supabase
    .from('recordings')
    .update({ audioPath: null })
    .in('id', rows.map((r) => r.id));
  if (updateErr) {
    return jsonResponse(
      {
        error: `audioPath nulling failed: ${updateErr.message}`,
        paths_removed_from_storage: paths,
      },
      500,
    );
  }

  console.log(
    `[cleanup-failed-audio] removed ${paths.length} archive(s):`,
    rows.map((r) => ({ id: r.id, status: r.status, path: r.audioPath })),
  );

  return jsonResponse({
    deleted: paths.length,
    storage_response_count: removed?.length ?? 0,
    paths,
  });
});
