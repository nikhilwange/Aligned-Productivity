// Generates supabase/functions/audio-retention/index.standalone.ts — the
// single-file version for pasting into the Supabase dashboard — by inlining
// the shared retention rules (supabase/functions/_shared/audioRetention.ts)
// in place of their import. tests/segmentCleanup.test.mts fails if the
// standalone file ever drifts from the shared rules.
//
//   npm run edge:standalone
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fn = join(root, 'supabase/functions/audio-retention');
const shared = readFileSync(join(root, 'supabase/functions/_shared/audioRetention.ts'), 'utf8').replace(/\r\n/g, '\n');
const index = readFileSync(join(fn, 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

export function sharedBlock(src) {
  const m = /\/\/ BEGIN SHARED AUDIO RETENTION RULES\n[\s\S]*?\/\/ END SHARED AUDIO RETENTION RULES\n/.exec(src);
  if (!m) throw new Error('shared retention markers not found');
  return m[0];
}

const importBlock = /\/\/ @inline-shared-rules\n[\s\S]*?\/\/ @end-inline-shared-rules\n/;
if (!importBlock.test(index)) throw new Error('@inline-shared-rules markers not found in index.ts');

const header =
  '// ⚠️ GENERATED from index.ts + ../_shared/audioRetention.ts by\n' +
  '// scripts/build-edge-standalone.mjs (npm run edge:standalone). Do not edit;\n' +
  '// paste this whole file into the Supabase dashboard as the audio-retention function.\n\n';
const out = header + index.replace(importBlock, () => sharedBlock(shared));
writeFileSync(join(fn, 'index.standalone.ts'), out);
console.log('wrote supabase/functions/audio-retention/index.standalone.ts');
