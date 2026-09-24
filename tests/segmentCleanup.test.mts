// Audio cleanup & retention. Run: npm test
//
// Hard rule: Storage segments are never deleted for a recording whose row is
// 'processing', 'interrupted' or 'error'. Automatic deletion follows the ONE
// shared retention definition (supabase/functions/_shared/audioRetention.ts),
// used by both the client policy and the server's audio-retention sweep;
// a user-confirmed Discard/Delete always deletes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  deleteRecordingSegments,
  mayDeleteSegments,
  type SegmentDeletion,
  type SegmentStoreDeps,
} from '../services/segmentCleanupPolicy.ts';
import {
  segmentedAudioRetention,
  legacyArchiveRetention,
  retentionWarningDaysLeft,
  KEPT_AUDIO_RETENTION_DAYS,
  ORPHAN_AUDIO_RETENTION_DAYS,
  RETENTION_WARNING_DAYS,
} from '../supabase/functions/_shared/audioRetention.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-15T12:00:00Z');
const root = join(import.meta.dirname, '..');

const manifest = {
  sessionId: 'rec-1790233285383-a1b2c3',
  source: 'in-person',
  startedAt: 0,
  mimeType: 'audio/webm',
  updatedAt: 0,
  segments: [
    { index: 0, ext: 'webm', uploaded: true, durationMs: 300_000, storagePath: 'u/recordings/r/seg-0000.webm' },
    { index: 1, ext: 'webm', uploaded: true, durationMs: 60_000, storagePath: 'u/recordings/r/seg-0001-r1.webm',
      previousStoragePaths: ['u/recordings/r/seg-0001.webm'] },
  ],
};

function fakeStore() {
  const calls = { deleted: [] as string[], manifestsCleared: 0, transcriptsCleared: 0, warnings: [] as string[] };
  const deps: SegmentStoreDeps = {
    deleteAudioPaths: async (paths) => { calls.deleted.push(...paths); },
    clearManifest: async () => { calls.manifestsCleared++; },
    clearTranscripts: async () => { calls.transcriptsCleared++; },
    clearChunkCache: () => {},
    warn: (m) => { calls.warnings.push(m); },
  };
  return { deps, calls };
}

const AUTOMATIC_REASONS = ['completed_clean', 'retranscribed_clean', 'completed_leftover', 'retention_sweep'] as const;

// ─── Hard rule ───────────────────────────────────────────────────────────────

test('automatic cleanup never deletes for processing / interrupted / error rows — however old', async () => {
  for (const reason of AUTOMATIC_REASONS) {
    for (const rowStatus of ['processing', 'interrupted', 'error']) {
      for (const hasProblems of [false, true]) {
        for (const age of [0, 29, 31, 365]) {
          const { deps, calls } = fakeStore();
          const deletion: SegmentDeletion = {
            kind: 'automatic', reason, rowStatus, hasProblems, lastUploadMs: NOW - age * DAY, nowMs: NOW,
          };
          const label = `${reason} / ${rowStatus} / problems=${hasProblems} / ${age}d`;
          assert.equal(await deleteRecordingSegments(deps, manifest.sessionId, manifest, deletion), false, label);
          assert.deepEqual(calls.deleted, [], `no Storage delete: ${label}`);
          assert.equal(calls.manifestsCleared, 0, `local copy kept too: ${label}`);
          assert.match(calls.warnings[0] ?? '', /REFUSED/, `refusal logged: ${label}`);
        }
      }
    }
  }
});

test('the client never deletes an orphan (no row) — that is the server sweep\'s job', async () => {
  for (const rowStatus of [null, undefined]) {
    for (const age of [0, 31, 365]) {
      const { deps, calls } = fakeStore();
      const ok = await deleteRecordingSegments(deps, manifest.sessionId, manifest,
        { kind: 'automatic', reason: 'retention_sweep', rowStatus, hasProblems: false, lastUploadMs: NOW - age * DAY, nowMs: NOW });
      assert.equal(ok, false);
      assert.deepEqual(calls.deleted, []);
    }
  }
});

test('completed with unclear parts: kept until day 30 after the last upload, deletable after', async () => {
  const at = (age: number) => mayDeleteSegments({
    kind: 'automatic', reason: 'retention_sweep', rowStatus: 'completed', hasProblems: true, lastUploadMs: NOW - age * DAY, nowMs: NOW,
  }).allowed;
  assert.equal(at(0), false);
  assert.equal(at(29), false);
  assert.equal(at(KEPT_AUDIO_RETENTION_DAYS), true);
  assert.equal(at(31), true);
  // Unknown anchor = treated as uploaded just now → kept.
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'retention_sweep', rowStatus: 'completed', hasProblems: true }).allowed, false);
});

test('completed with no problems: deleted — every path, including ones a header repair replaced', async () => {
  const { deps, calls } = fakeStore();
  const ok = await deleteRecordingSegments(deps, manifest.sessionId, manifest,
    { kind: 'automatic', reason: 'completed_clean', rowStatus: 'completed', hasProblems: false });
  assert.equal(ok, true);
  assert.deepEqual(calls.deleted.sort(), [
    'u/recordings/r/seg-0000.webm', 'u/recordings/r/seg-0001-r1.webm', 'u/recordings/r/seg-0001.webm',
  ]);
  assert.equal(calls.manifestsCleared, 1);
});

test('user-confirmed Discard / Delete always deletes', async () => {
  for (const action of ['discard_recording', 'delete_session', 'discard_leftover'] as const) {
    const { deps, calls } = fakeStore();
    assert.equal(await deleteRecordingSegments(deps, manifest.sessionId, manifest, { kind: 'user_confirmed', action }), true);
    assert.equal(calls.deleted.length, 3, action);
  }
});

test('local_only (server already deleted Storage) clears the local copy but never touches Storage', async () => {
  const { deps, calls } = fakeStore();
  assert.equal(await deleteRecordingSegments(deps, manifest.sessionId, manifest, { kind: 'local_only', reason: 'storage_already_deleted' }), true);
  assert.deepEqual(calls.deleted, []);
  assert.equal(calls.manifestsCleared, 1);
});

// ─── Shared retention rules (what the server sweep applies) ──────────────────

test('shared rules: segmented recordings', () => {
  const v = (rowStatus: string | null, hasUnclearParts: boolean, ageDays: number) =>
    segmentedAudioRetention({ rowStatus, hasUnclearParts, lastUploadMs: NOW - ageDays * DAY, nowMs: NOW }).action;
  for (const s of ['processing', 'interrupted', 'error']) {
    assert.equal(v(s, false, 3650), 'keep', `${s} is never deleted`);
    assert.equal(v(s, true, 3650), 'keep', `${s} is never deleted`);
  }
  assert.equal(v('completed', false, 0), 'delete');
  assert.equal(v('completed', true, KEPT_AUDIO_RETENTION_DAYS - 1), 'keep');
  assert.equal(v('completed', true, KEPT_AUDIO_RETENTION_DAYS), 'delete');
  assert.equal(v(null, false, ORPHAN_AUDIO_RETENTION_DAYS - 1), 'keep');
  assert.equal(v(null, false, ORPHAN_AUDIO_RETENTION_DAYS), 'delete');
});

test('shared rules: legacy single-file archives', () => {
  const v = (rowStatus: string, ageDays: number) =>
    legacyArchiveRetention({ rowStatus, createdMs: NOW - ageDays * DAY, nowMs: NOW }).action;
  assert.equal(v('processing', 3650), 'keep');
  assert.equal(v('error', 7), 'keep', 'error archives now kept 30 days (was 7)');
  assert.equal(v('error', 29), 'keep');
  assert.equal(v('error', 30), 'delete');
  assert.equal(v('completed', 0), 'delete');
});

test('shared rules: the banner countdown starts on day 23', () => {
  const deleteAt = (ageDays: number) => segmentedAudioRetention({
    rowStatus: 'completed', hasUnclearParts: true, lastUploadMs: NOW - ageDays * DAY, nowMs: NOW,
  }).deleteAtMs;
  assert.equal(retentionWarningDaysLeft(deleteAt(22), NOW), null, 'no warning on day 22');
  assert.equal(retentionWarningDaysLeft(deleteAt(KEPT_AUDIO_RETENTION_DAYS - RETENTION_WARNING_DAYS), NOW), 7, 'day 23: 7 days left');
  assert.equal(retentionWarningDaysLeft(deleteAt(29), NOW), 1);
});

// ─── The rules can't drift between client and server ────────────────────────

test('the dashboard-deployable edge function carries the shared rules verbatim', () => {
  const block = (src: string) => {
    const m = /\/\/ BEGIN SHARED AUDIO RETENTION RULES\n[\s\S]*?\/\/ END SHARED AUDIO RETENTION RULES\n/.exec(src.replace(/\r\n/g, '\n'));
    assert.ok(m, 'markers present');
    return m![0];
  };
  const shared = readFileSync(join(root, 'supabase/functions/_shared/audioRetention.ts'), 'utf8');
  const standalone = readFileSync(join(root, 'supabase/functions/audio-retention/index.standalone.ts'), 'utf8');
  assert.equal(block(standalone), block(shared), 'run `npm run edge:standalone` to regenerate');
  const client = readFileSync(join(root, 'services/segmentCleanupPolicy.ts'), 'utf8');
  assert.match(client, /from '\.\.\/supabase\/functions\/_shared\/audioRetention\.ts'/, 'client policy imports the shared rules');
});

// ─── No bypass ───────────────────────────────────────────────────────────────

test('no client code deletes Storage audio outside the known, reviewed call sites', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', 'out', 'release', '.git', 'tests', 'supabase', 'ios', 'api', 'scripts'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  const allowed = new Set([
    'services/storageService.ts', // the definition
    'services/segmentCleanupPolicy.ts', // the chokepoint (deps.deleteAudioPaths)
    'services/sarvamService.ts', // transient chunks/ upload files only
    'App.tsx', // single-file audioPath archives (not segments)
  ]);
  const offenders = files
    .map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))
    .filter((rel) => /deleteAudioPaths\s*\(/.test(readFileSync(join(root, rel), 'utf8')) && !allowed.has(rel));
  assert.deepEqual(offenders, [], `direct deleteAudioPaths( outside the policy: ${offenders.join(', ')}`);
  assert.doesNotMatch(readFileSync(join(root, 'services/segmentRecorder.ts'), 'utf8'), /deleteAudioPaths\s*\(/);
});
