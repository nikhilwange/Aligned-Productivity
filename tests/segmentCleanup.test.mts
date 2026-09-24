// Audio cleanup & retention. Run: npm test
//
// Hard rule: the CLIENT never auto-deletes Storage segments for a recording
// whose row is not completed; processing rows are never deleted by anyone.
// Automatic deletion follows the ONE shared retention definition
// (supabase/functions/_shared/audioRetention.ts),
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
  staleChunkRetention,
  retentionWarningDaysLeft,
  KEPT_AUDIO_RETENTION_DAYS,
  FAILED_AUDIO_RETENTION_DAYS,
  ORPHAN_AUDIO_RETENTION_DAYS,
  RETENTION_WARNING_DAYS,
  UNCLEAR_MARKER,
} from '../supabase/functions/_shared/audioRetention.ts';
import { buildSegmentedTranscript, FAILED_SEGMENT_TEXT, type SegmentPiece } from '../services/transcriptAssembly.ts';

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
  assert.equal(v('processing', false, 3650), 'keep', 'processing is never deleted');
  assert.equal(v('processing', true, 3650), 'keep', 'processing is never deleted');
  for (const s of ['error', 'interrupted']) {
    assert.equal(v(s, false, FAILED_AUDIO_RETENTION_DAYS - 1), 'keep', `${s}: kept for 30 days`);
    assert.equal(v(s, true, FAILED_AUDIO_RETENTION_DAYS - 1), 'keep', `${s}: kept for 30 days`);
    assert.equal(v(s, false, FAILED_AUDIO_RETENTION_DAYS), 'delete', `${s}: server may delete after 30 days`);
  }
  assert.equal(v('some-future-status', false, 3650), 'keep', 'unknown statuses are kept');
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

test('shared rules: every delete verdict carries the reason code the sweep summarises by', () => {
  const seg = (rowStatus: string | null, hasUnclearParts: boolean, ageDays: number) =>
    segmentedAudioRetention({ rowStatus, hasUnclearParts, lastUploadMs: NOW - ageDays * DAY, nowMs: NOW }).code;
  assert.equal(seg('completed', false, 0), 'completed_clean');
  assert.equal(seg('completed', true, 31), 'kept_audio_expired');
  assert.equal(seg('error', false, 31), 'error_expired');
  assert.equal(seg('interrupted', false, 31), 'error_expired');
  assert.equal(seg(null, false, 31), 'orphan');
  assert.equal(seg('processing', false, 3650), 'keep');
  assert.equal(seg('completed', true, 1), 'keep');
  assert.equal(legacyArchiveRetention({ rowStatus: 'completed', createdMs: NOW, nowMs: NOW }).code, 'legacy_archive');
  assert.equal(legacyArchiveRetention({ rowStatus: 'error', createdMs: NOW - 31 * DAY, nowMs: NOW }).code, 'legacy_archive');
  assert.equal(staleChunkRetention({ uploadedMs: NOW - 25 * 3600_000, nowMs: NOW }).code, 'stale_chunk');
});

test('shared rules: stale temporary chunks go after 24 h', () => {
  const v = (ageHours: number) => staleChunkRetention({ uploadedMs: NOW - ageHours * 3600_000, nowMs: NOW });
  assert.equal(v(23).action, 'keep');
  assert.equal(v(24).action, 'delete');
  assert.equal(v(24).reason, 'stale_chunk');
});

test('shared rules: the dry-run override replaces the 30-day windows (processing still never)', () => {
  const o = (rowStatus: string | null, ageDays: number, retentionDaysOverride?: number) =>
    segmentedAudioRetention({ rowStatus, hasUnclearParts: true, lastUploadMs: NOW - ageDays * DAY, nowMs: NOW, retentionDaysOverride }).action;
  assert.equal(o(null, 2), 'keep');
  assert.equal(o(null, 2, 1), 'delete', 'orphan rule with a 1-day override');
  assert.equal(o('error', 2, 1), 'delete');
  assert.equal(o('completed', 2, 1), 'delete');
  assert.equal(o('processing', 3650, 0), 'keep');
  assert.equal(o(null, 2, -5), 'keep', 'invalid override ignored');
});

test('shared rules: the banner countdown starts on day 23', () => {
  const deleteAt = (ageDays: number) => segmentedAudioRetention({
    rowStatus: 'completed', hasUnclearParts: true, lastUploadMs: NOW - ageDays * DAY, nowMs: NOW,
  }).deleteAtMs;
  assert.equal(retentionWarningDaysLeft(deleteAt(22), NOW), null, 'no warning on day 22');
  assert.equal(retentionWarningDaysLeft(deleteAt(KEPT_AUDIO_RETENTION_DAYS - RETENTION_WARNING_DAYS), NOW), 7, 'day 23: 7 days left');
  assert.equal(retentionWarningDaysLeft(deleteAt(29), NOW), 1);
  // Same countdown for failed / interrupted sessions.
  const failedDeleteAt = segmentedAudioRetention({ rowStatus: 'error', hasUnclearParts: false, lastUploadMs: NOW - 23 * DAY, nowMs: NOW }).deleteAtMs;
  assert.equal(retentionWarningDaysLeft(failedDeleteAt, NOW), 7);
});

// ─── Decision 4: a failed segment always leaves the marker in the transcript ─

test('failed segments write the unclear marker into the saved transcript — so the server sees them', () => {
  const seg = (index: number, min = 5) => ({ index, ext: 'webm', uploaded: true, durationMs: min * 60_000 });
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const check = (label: string, pieces: SegmentPiece[]) => {
    const built = buildSegmentedTranscript(pieces, 0);
    assert.ok(built.transcript.includes(UNCLEAR_MARKER), `${label}: transcript carries the marker`);
    assert.equal(
      segmentedAudioRetention({ rowStatus: 'completed', hasUnclearParts: built.transcript.includes(UNCLEAR_MARKER), lastUploadMs: NOW, nowMs: NOW }).action,
      'keep',
      `${label}: the server keeps its audio for a retry`,
    );
    assert.ok(built.problems > 0, `${label}: counted as a problem`);
  };
  check('failed in the middle', [
    { seg: seg(0), text: words(200), status: 'ok' },
    { seg: seg(1), text: FAILED_SEGMENT_TEXT, status: 'failed' },
    { seg: seg(2), text: words(200), status: 'ok' },
  ]);
  check('failed at the end (never trimmed)', [
    { seg: seg(0), text: words(200), status: 'ok' },
    { seg: seg(1), text: FAILED_SEGMENT_TEXT, status: 'failed' },
  ]);
  check('failed with empty stored text still writes the marker', [
    { seg: seg(0), text: words(200), status: 'ok' },
    { seg: seg(1), text: '', status: 'failed' },
  ]);
  check('unclear at the end (never trimmed)', [
    { seg: seg(0), text: words(200), status: 'ok' },
    { seg: seg(1), text: `hello ${UNCLEAR_MARKER} there`, status: 'unclear' },
  ]);
  assert.equal(FAILED_SEGMENT_TEXT, UNCLEAR_MARKER);
});

test('client and server use the ONE marker', () => {
  const sarvam = readFileSync(join(root, 'services/sarvamService.ts'), 'utf8');
  assert.match(sarvam, /export const UNCLEAR_PLACEHOLDER = UNCLEAR_MARKER;/);
  const edge = readFileSync(join(root, 'supabase/functions/audio-retention/index.ts'), 'utf8');
  assert.match(edge, /UNCLEAR_MARKER/);
});

test('trim: only trailing ok segments with no/sparse speech are dropped', () => {
  const seg = (index: number, min = 5) => ({ index, ext: 'webm', uploaded: true, durationMs: min * 60_000 });
  const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const kept = (pieces: SegmentPiece[]) => pieces.length - buildSegmentedTranscript(pieces, 0).trimmedCount;
  assert.equal(kept([{ seg: seg(0), text: words(200), status: 'ok' }, { seg: seg(1), text: '', status: 'ok' }]), 1);
  assert.equal(kept([{ seg: seg(0), text: words(200), status: 'ok' }, { seg: seg(1), text: words(10), status: 'ok' }]), 1);
  assert.equal(kept([{ seg: seg(0), text: words(200), status: 'ok' }, { seg: seg(1, 1), text: words(5), status: 'ok' }]), 2, 'short real ending kept');
  assert.equal(kept([{ seg: seg(0), text: words(200), status: 'ok' }, { seg: seg(1), text: null, status: 'skipped' }]), 2);
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
