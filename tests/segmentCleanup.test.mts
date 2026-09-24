// Hard rule: Storage segments are never deleted for a recording whose row is
// 'processing', 'interrupted' or 'error' (or unknown). They go only after a
// completion with no unclear/failed parts, or an explicit user-confirmed
// Discard/Delete. Run: npm test
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
  const calls = { deleted: [] as string[], manifestsCleared: 0, transcriptsCleared: 0, chunkCaches: 0, warnings: [] as string[] };
  const deps: SegmentStoreDeps = {
    deleteAudioPaths: async (paths) => { calls.deleted.push(...paths); },
    clearManifest: async () => { calls.manifestsCleared++; },
    clearTranscripts: async () => { calls.transcriptsCleared++; },
    clearChunkCache: () => { calls.chunkCaches++; },
    warn: (m) => { calls.warnings.push(m); },
  };
  return { deps, calls };
}

const AUTOMATIC_REASONS = ['completed_clean', 'retranscribed_clean', 'completed_leftover', 'seven_day_cleanup'] as const;
const PROTECTED_STATUSES = ['processing', 'interrupted', 'error', null, undefined];

test('automatic cleanup never deletes anything for processing / interrupted / error / unknown rows', async () => {
  for (const reason of AUTOMATIC_REASONS) {
    for (const rowStatus of PROTECTED_STATUSES) {
      for (const hasProblems of [false, true]) {
        const { deps, calls } = fakeStore();
        const deletion: SegmentDeletion = { kind: 'automatic', reason, rowStatus, hasProblems };
        const deleted = await deleteRecordingSegments(deps, manifest.sessionId, manifest, deletion);
        const label = `${reason} / ${String(rowStatus)} / problems=${hasProblems}`;
        assert.equal(deleted, false, label);
        assert.deepEqual(calls.deleted, [], `no Storage delete: ${label}`);
        assert.equal(calls.manifestsCleared, 0, `local copy kept too: ${label}`);
        assert.equal(calls.transcriptsCleared, 0, `results kept: ${label}`);
        assert.match(calls.warnings[0] ?? '', /REFUSED/, `refusal logged: ${label}`);
      }
    }
  }
});

test('automatic cleanup keeps a completed recording that still has unclear/failed parts', async () => {
  for (const reason of AUTOMATIC_REASONS) {
    const { deps, calls } = fakeStore();
    const deleted = await deleteRecordingSegments(deps, manifest.sessionId, manifest,
      { kind: 'automatic', reason, rowStatus: 'completed', hasProblems: true });
    assert.equal(deleted, false, reason);
    assert.deepEqual(calls.deleted, [], reason);
  }
});

test('automatic cleanup deletes a completed recording with no problems — every path, including replaced ones', async () => {
  const { deps, calls } = fakeStore();
  const deleted = await deleteRecordingSegments(deps, manifest.sessionId, manifest,
    { kind: 'automatic', reason: 'completed_clean', rowStatus: 'completed', hasProblems: false });
  assert.equal(deleted, true);
  assert.deepEqual(calls.deleted.sort(), [
    'u/recordings/r/seg-0000.webm',
    'u/recordings/r/seg-0001-r1.webm',
    'u/recordings/r/seg-0001.webm',
  ]);
  assert.equal(calls.manifestsCleared, 1);
  assert.equal(calls.transcriptsCleared, 1);
});

test('a user-confirmed Discard / Delete always deletes', async () => {
  for (const action of ['discard_recording', 'delete_session', 'discard_leftover'] as const) {
    const { deps, calls } = fakeStore();
    assert.equal(await deleteRecordingSegments(deps, manifest.sessionId, manifest, { kind: 'user_confirmed', action }), true, action);
    assert.equal(calls.deleted.length, 3, action);
  }
});

test('policy table', () => {
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'seven_day_cleanup', rowStatus: 'error', hasProblems: false }).allowed, false);
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'seven_day_cleanup', rowStatus: 'interrupted', hasProblems: false }).allowed, false);
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'completed_leftover', rowStatus: 'processing', hasProblems: false }).allowed, false);
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'seven_day_cleanup', rowStatus: null, hasProblems: false }).allowed, false);
  assert.equal(mayDeleteSegments({ kind: 'automatic', reason: 'completed_clean', rowStatus: 'completed', hasProblems: false }).allowed, true);
});

// No bypass: segment audio may only be deleted through the policy. Every
// direct deleteAudioPaths( call in the app is on this allow-list, and none of
// them may be in the segment code.
test('no code deletes Storage audio outside the known, reviewed call sites', () => {
  const root = join(import.meta.dirname, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', 'out', 'release', '.git', 'tests', 'supabase', 'ios', 'api'].includes(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);
  const allowed: Record<string, string> = {
    'services/storageService.ts': 'the definition',
    'services/segmentCleanupPolicy.ts': 'the policy chokepoint (deps.deleteAudioPaths)',
    'services/sarvamService.ts': 'transient chunks/ upload files only',
    'App.tsx': 'single-file audioPath archives (not segments)',
  };
  const offenders: string[] = [];
  for (const f of files) {
    const rel = f.slice(root.length + 1).replace(/\\/g, '/');
    const src = readFileSync(f, 'utf8');
    if (/deleteAudioPaths\s*\(/.test(src) && !(rel in allowed)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `direct deleteAudioPaths( outside the policy: ${offenders.join(', ')}`);
  // The segment recorder hands deleteAudioPaths to the policy but never calls it.
  const seg = readFileSync(join(root, 'services/segmentRecorder.ts'), 'utf8');
  assert.doesNotMatch(seg, /deleteAudioPaths\s*\(/, 'segmentRecorder.ts must not delete Storage audio directly');
});
