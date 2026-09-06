// ─── Client-side audio splitter ──────────────────────────────────────────────
//
// Cuts an uploaded audio file into self-contained segments so a long upload can
// go through the SAME segmented pipeline as a live recording (per-segment
// upload, per-segment transcription, stitched into one transcript). Without
// this, a manual upload takes the monolithic Phase 1 path: one whole-file PUT
// to Storage — which is how a 813 MB / 3.5h MP3 came back `413 EntityTooLarge`
// — and one transcription call over the entire file.
//
// The central constraint: you cannot naively byte-slice compressed audio. A cut
// at an arbitrary offset produces garbage, because the decoder needs to start
// at a frame boundary. Two formats let us do this honestly without re-encoding:
//
//   MP3  — a bare sequence of self-contained frames, each with a 4-byte header
//          carrying its own bitrate/sample rate. Find frame boundaries, cut
//          there, and every piece is a valid MP3. No decode, no re-encode.
//   WAV  — uncompressed and fixed-rate, so a cut is byte arithmetic plus a
//          fresh 44-byte header per piece.
//
// Everything else (m4a/mp4/aac, webm, ogg) interleaves and indexes samples in a
// container header and cannot be cut without real remuxing. Those return null
// and the caller falls back to the existing whole-file path, which is fine for
// the smaller files that path can already handle.
//
// MEMORY: this never loads the file. It scans in windows to find cut OFFSETS,
// then uses File.slice(), which returns a lazy view rather than a copy. Peak
// usage is one window (4 MB) regardless of whether the file is 8 MB or 800 MB.

export interface AudioSegment {
  index: number;
  blob: Blob;
  durationMs: number;
  ext: string;
}

export type SplittableFormat = 'mp3' | 'wav';

/** Window size for the frame scan. Large enough that reads aren't chatty. */
const SCAN_WINDOW = 4 * 1024 * 1024;

/** Matches SEGMENT_DURATION_MS in segmentRecorder.ts — keep them aligned. */
export const DEFAULT_SEGMENT_SECONDS = 300;

// ─── Format detection ────────────────────────────────────────────────────────

/**
 * What we can split, judged by extension and MIME. Returns null for formats
 * that need remuxing, so the caller can fall back rather than corrupt audio.
 */
export function splittableFormat(file: File): SplittableFormat | null {
  const name = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (name.endsWith('.mp3') || mime === 'audio/mpeg' || mime === 'audio/mp3') return 'mp3';
  if (name.endsWith('.wav') || mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  return null;
}

// ─── MP3 frame parsing ───────────────────────────────────────────────────────
// Header layout (4 bytes, big-endian bit order):
//   AAAAAAAA AAABBCCD EEEEFFGH IIJJKLMM
//   A = frame sync (11 bits, all set)   B = MPEG version   C = layer
//   E = bitrate index                   F = sample rate    G = padding

// Bitrate tables in kbps, indexed by the header's 4-bit bitrate field.
// Index 0 is "free" and 15 is invalid; both are treated as a bad header.
const BITRATES_V1_L1 = [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0];
const BITRATES_V1_L2 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0];
const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L1 = [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0];
const BITRATES_V2_L23 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000],  // MPEG 2.5
};

interface Mp3Frame {
  length: number;     // bytes, including this header
  durationMs: number;
}

/** Decode an MP3 frame header, or null if these 4 bytes aren't one. */
function parseMp3Frame(b0: number, b1: number, b2: number, b3: number): Mp3Frame | null {
  // Sync: 11 set bits.
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionId = (b1 >> 3) & 0x03; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
  const layerId = (b1 >> 1) & 0x03;   // 3 = Layer I, 2 = Layer II, 1 = Layer III, 0 = reserved
  if (versionId === 1 || layerId === 0) return null;

  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  if (bitrateIdx === 0 || bitrateIdx === 15 || sampleIdx === 3) return null;

  const sampleRate = SAMPLE_RATES[versionId]?.[sampleIdx];
  if (!sampleRate) return null;

  const isV1 = versionId === 3;
  let table: number[];
  if (layerId === 3) table = isV1 ? BITRATES_V1_L1 : BITRATES_V2_L1;
  else if (layerId === 2) table = isV1 ? BITRATES_V1_L2 : BITRATES_V2_L23;
  else table = isV1 ? BITRATES_V1_L3 : BITRATES_V2_L23;

  const bitrate = table[bitrateIdx] * 1000;
  if (!bitrate) return null;

  // Samples per frame, which fixes both the byte length and the duration.
  let samples: number;
  if (layerId === 3) samples = 384;                       // Layer I
  else if (layerId === 2) samples = 1152;                 // Layer II
  else samples = isV1 ? 1152 : 576;                       // Layer III

  const length = layerId === 3
    ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
    : Math.floor((samples / 8 * bitrate) / sampleRate) + padding;

  if (length < 4) return null;
  return { length, durationMs: (samples / sampleRate) * 1000 };
}

/**
 * Byte offset of the first frame, skipping an ID3v2 tag if present. Its size is
 * stored as four "syncsafe" bytes (7 bits each) at offset 6.
 */
function id3v2Size(head: Uint8Array): number {
  if (head.length < 10) return 0;
  if (head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0; // "ID3"
  const size = ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) |
               ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
  const footer = (head[5] & 0x10) ? 10 : 0;
  return 10 + size + footer;
}

// ─── MP3 splitting ───────────────────────────────────────────────────────────

interface Cut { start: number; end: number; durationMs: number }

async function scanMp3Cuts(
  file: File,
  targetMs: number,
  onProgress?: (fraction: number) => void,
): Promise<Cut[]> {
  const size = file.size;
  const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  let pos = id3v2Size(head);

  const cuts: Cut[] = [];
  let segStart = pos;
  let segMs = 0;

  // Sliding window over the file so we never hold more than SCAN_WINDOW.
  let win = new Uint8Array(0);
  let winStart = 0;
  const ensure = async (at: number, need: number) => {
    if (at >= winStart && at + need <= winStart + win.length) return;
    winStart = at;
    win = new Uint8Array(await file.slice(at, Math.min(at + SCAN_WINDOW, size)).arrayBuffer());
  };

  let lastProgress = 0;
  let resyncs = 0;

  while (pos + 4 <= size) {
    await ensure(pos, 4);
    const o = pos - winStart;
    if (o + 4 > win.length) break; // ran off the end of a short final window

    const frame = parseMp3Frame(win[o], win[o + 1], win[o + 2], win[o + 3]);

    if (!frame) {
      // Not a frame header — most often an ID3/Xing blob or padding between
      // frames. Step a byte and resync rather than giving up on the file.
      pos++;
      if (++resyncs > 4 * 1024 * 1024) throw new Error('Not a readable MP3 (no frame headers found).');
      continue;
    }

    // Cut BEFORE this frame once the current segment is long enough, so every
    // segment begins exactly on a frame boundary.
    if (segMs >= targetMs && pos > segStart) {
      cuts.push({ start: segStart, end: pos, durationMs: segMs });
      segStart = pos;
      segMs = 0;
    }

    segMs += frame.durationMs;
    pos += frame.length;

    if (onProgress) {
      const f = pos / size;
      if (f - lastProgress > 0.02) { lastProgress = f; onProgress(Math.min(1, f)); }
    }
  }

  if (segStart < size && segMs > 0) {
    cuts.push({ start: segStart, end: size, durationMs: segMs });
  }
  return cuts;
}

// ─── WAV splitting ───────────────────────────────────────────────────────────

/**
 * Build a 44-byte canonical WAV header for a PCM chunk of `dataLen` bytes.
 * Returns the raw ArrayBuffer rather than a view, so it drops straight into a
 * Blob (a Uint8Array over ArrayBufferLike isn't a valid BlobPart).
 */
function wavHeader(dataLen: number, channels: number, sampleRate: number, bitsPerSample: number): ArrayBuffer {
  const buf = new ArrayBuffer(44);
  const v = new DataView(buf);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const ascii = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };

  ascii(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);              // PCM fmt chunk size
  v.setUint16(20, 1, true);               // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitsPerSample, true);
  ascii(36, 'data');
  v.setUint32(40, dataLen, true);
  return buf;
}

async function splitWav(file: File, targetMs: number): Promise<AudioSegment[]> {
  // Walk the RIFF chunk list to find `fmt ` and `data`. Chunk order isn't
  // guaranteed and some encoders insert LIST/fact chunks before the audio.
  const head = new Uint8Array(await file.slice(0, Math.min(4096, file.size)).arrayBuffer());
  const dv = new DataView(head.buffer);
  const tag = (o: number) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a readable WAV file.');

  let channels = 0, sampleRate = 0, bitsPerSample = 0;
  let dataStart = 0, dataLen = 0;
  let p = 12;
  while (p + 8 <= head.length) {
    const id = tag(p);
    const len = dv.getUint32(p + 4, true);
    if (id === 'fmt ') {
      channels = dv.getUint16(p + 10, true);
      sampleRate = dv.getUint32(p + 12, true);
      bitsPerSample = dv.getUint16(p + 22, true);
    } else if (id === 'data') {
      dataStart = p + 8;
      // A streamed WAV can carry a bogus length; trust the real file size.
      dataLen = Math.min(len, file.size - dataStart);
      break;
    }
    p += 8 + len + (len % 2); // chunks are word-aligned
  }
  if (!channels || !sampleRate || !bitsPerSample || !dataStart) {
    throw new Error('Unsupported WAV layout (missing fmt or data chunk).');
  }

  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  // Round the segment size down to a whole sample frame so cuts never land
  // mid-sample (which would swap channels for the rest of the segment).
  const bytesPerSegment = Math.max(blockAlign, Math.floor((byteRate * targetMs) / 1000 / blockAlign) * blockAlign);

  const segments: AudioSegment[] = [];
  let off = 0;
  let index = 0;
  while (off < dataLen) {
    const len = Math.min(bytesPerSegment, dataLen - off);
    const body = file.slice(dataStart + off, dataStart + off + len);
    segments.push({
      index: index++,
      blob: new Blob([wavHeader(len, channels, sampleRate, bitsPerSample), body], { type: 'audio/wav' }),
      durationMs: (len / byteRate) * 1000,
      ext: 'wav',
    });
    off += len;
  }
  return segments;
}

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Split `file` into self-contained segments of roughly `targetSeconds`.
 *
 * Returns null when the format needs remuxing to cut safely — the caller should
 * fall back to uploading the file whole rather than producing broken audio.
 * Throws only when the file claims a splittable format but is malformed.
 */
export async function splitAudioFile(
  file: File,
  targetSeconds: number = DEFAULT_SEGMENT_SECONDS,
  onProgress?: (fraction: number) => void,
): Promise<AudioSegment[] | null> {
  const format = splittableFormat(file);
  if (!format) return null;

  const targetMs = targetSeconds * 1000;

  if (format === 'wav') {
    const segs = await splitWav(file, targetMs);
    onProgress?.(1);
    return segs;
  }

  const cuts = await scanMp3Cuts(file, targetMs, onProgress);
  if (cuts.length === 0) throw new Error('Not a readable MP3 (no audio frames found).');
  onProgress?.(1);

  return cuts.map((c, i) => ({
    index: i,
    // File.slice is a lazy view — no copy, so this stays flat in memory even
    // for a multi-hundred-megabyte upload.
    blob: file.slice(c.start, c.end, 'audio/mpeg'),
    durationMs: c.durationMs,
    ext: 'mp3',
  }));
}
