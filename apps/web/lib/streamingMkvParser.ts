/**
 * StreamingMkvParser — streaming Matroska (MKV) EBML parser for the browser.
 *
 * Reads from a ReadableStreamDefaultReader<Uint8Array> and emits
 * track metadata and decoded SimpleBlock elements via callbacks.
 * Handles chunk-boundary straddling via an internal ring buffer.
 *
 * Only parses the subset of EBML/Matroska needed for playback:
 *   EBML Header → Segment → Info → Tracks → Clusters
 *
 * No dependencies, ~350 lines.
 */

'use client';

// ── EBML element IDs (raw bytes including VINT marker bits) ─────────

const ELEM_EBML = 0x1A45DFA3;
const ELEM_SEGMENT = 0x18538067;
const ELEM_SEEK_HEAD = 0x114D9B74;
const ELEM_INFO = 0x1549A966;
const ELEM_TIMECODE_SCALE = 0x2AD7B1;
const ELEM_DURATION = 0x4489;
const ELEM_TRACKS = 0x1654AE6B;
const ELEM_TRACK_ENTRY = 0xAE;
const ELEM_TRACK_NUMBER = 0xD7;
const ELEM_TRACK_TYPE = 0x83;
const ELEM_CODEC_ID = 0x86;
const ELEM_CODEC_PRIVATE = 0x63A2;
const ELEM_LANGUAGE = 0x22B59C;
const ELEM_PIXEL_WIDTH = 0xB0;
const ELEM_PIXEL_HEIGHT = 0xBA;
const ELEM_CHANNELS = 0x9B;
const ELEM_SAMPLE_RATE = 0x9A;
const ELEM_CLUSTER = 0x1F43B675;
const ELEM_CLUSTER_TIMECODE = 0xE7;
const ELEM_SIMPLE_BLOCK = 0xA3;
const ELEM_BLOCK_GROUP = 0xA0;
const ELEM_BLOCK = 0xA1;
const ELEM_BLOCK_DURATION = 0xAB;
const ELEM_REFERENCE_BLOCK = 0xFB;

// ── Matroska Master Elements ───────────────────────────────────────
// These contain child elements rather than immediate data

const MASTER_ELEMENTS = new Set<number>([
  ELEM_EBML,
  ELEM_SEGMENT,
  ELEM_SEEK_HEAD,
  ELEM_INFO,
  ELEM_TRACKS,
  ELEM_TRACK_ENTRY,
  ELEM_CLUSTER,
  ELEM_BLOCK_GROUP,
]);

// ── Types ──────────────────────────────────────────────────────────

export interface TrackMeta {
  trackNumber: number;
  trackType: number;        // 1=video, 2=audio, 3=subtitle
  codecId: string;
  codecPrivate?: Uint8Array;
  language: string;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
}

export interface ParsedBlock {
  trackNumber: number;
  timecode: number;         // absolute timestamp in microseconds
  isKeyframe: boolean;
  data: Uint8Array;
}

// ── VINT helpers ───────────────────────────────────────────────────

/** Determine the VINT byte-length from the first byte's leading 1-bit. */
function getVintLength(firstByte: number): number {
  if (firstByte & 0x80) return 1;
  if (firstByte & 0x40) return 2;
  if (firstByte & 0x20) return 3;
  if (firstByte & 0x10) return 4;
  return 0; // invalid
}

/**
 * Read the raw EBML element ID from `bytes` at `offset`.
 * The ID includes the VINT marker bits (unlike data values).
 */
function readElementId(
  bytes: Uint8Array,
  offset: number,
): { id: number; length: number } | null {
  if (offset >= bytes.length) return null;
  const idLen = getVintLength(bytes[offset]);
  if (!idLen) return null;
  if (offset + idLen > bytes.length) return null;

  let id = 0;
  for (let i = 0; i < idLen; i++) {
    id = (id << 8) | bytes[offset + i];
  }
  return { id, length: idLen };
}

/**
 * Read a VINT data value (size or integer) from `bytes` at `offset`.
 * Excludes the VINT marker bits from the result.
 * Returns `value: -1` with `unknown: true` when all data bits are 1
 * (the EBML "unknown size" sentinel).
 */
function readVintValue(
  bytes: Uint8Array,
  offset: number,
): { value: number; length: number; unknown: boolean } | null {
  if (offset >= bytes.length) return null;
  const firstByte = bytes[offset];
  const vintLen = getVintLength(firstByte);
  if (!vintLen) return null;
  if (offset + vintLen > bytes.length) return null;

  // Mask to clear the VINT marker bits in the first byte
  const mask = 0xFF >> vintLen;
  let value = firstByte & mask;
  for (let i = 1; i < vintLen; i++) {
    value = (value << 8) | bytes[offset + i];
  }

  // Check for unknown-size sentinel (all data bits = 1)
  // Total data bits = (first byte has 8-vintLen data bits) + (vintLen-1 full bytes)
  const dataBits = (8 - vintLen) + 8 * (vintLen - 1);
  const maxValue = (1 << dataBits) - 1;
  if (value === maxValue) {
    return { value: -1, length: vintLen, unknown: true };
  }

  return { value, length: vintLen, unknown: false };
}

// ── Float / uint reading helpers ───────────────────────────────────

function readFloat(data: Uint8Array): number {
  if (data.length === 4) {
    return new DataView(data.buffer, data.byteOffset, 4).getFloat32(0, false);
  }
  if (data.length === 8) {
    return new DataView(data.buffer, data.byteOffset, 8).getFloat64(0, false);
  }
  return 0;
}

function readUint(data: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < data.length; i++) {
    value = value * 256 + data[i];
  }
  return value;
}

function readString(data: Uint8Array): string {
  return new TextDecoder().decode(data).replace(/\0+$/, '');
}

// ── SimpleBlock parser ─────────────────────────────────────────────

function parseSimpleBlock(
  data: Uint8Array,
  clusterTimecode: number,
  timecodeScale: number,
): ParsedBlock[] {
  if (data.length < 4) return [];

  let offset = 0;

  // Track Number (VINT)
  const trackResult = readVintValue(data, offset);
  if (!trackResult) return [];
  offset += trackResult.length;
  const trackNumber = trackResult.value;

  // Timecode (int16, signed, relative to cluster in ms)
  if (offset + 2 > data.length) return [];
  const relativeTimecode = new DataView(data.buffer, data.byteOffset + offset, 2).getInt16(0, false);
  offset += 2;

  // Flags
  if (offset >= data.length) return [];
  const flags = data[offset];
  offset++;
  const isKeyframe = !!(flags & 0x80);
  const lacing = flags & 0x06;

  // Calculate absolute timecode (microseconds)
  const absoluteMs = clusterTimecode + relativeTimecode; // cluster TC is in ms
  const absoluteUs = absoluteMs * 1000; // convert ms to µs for WebCodecs

  const blocks: ParsedBlock[] = [];

  if (lacing === 0) {
    // No lacing — entire remaining data is one frame
    if (offset >= data.length) return [];
    blocks.push({
      trackNumber,
      timecode: absoluteUs,
      isKeyframe,
      data: data.slice(offset),
    });
    return blocks;
  }

  // Laced frames — parse frame count and sizes
  if (offset >= data.length) return [];
  const frameCount = data[offset];
  offset++;

  if (frameCount === 0) return [];

  const frameSizes: number[] = [];

  if (lacing === 0x02) {
    // Fixed-size lacing: each frame = remaining / N
    const frameSize = Math.floor((data.length - offset) / frameCount);
    for (let i = 0; i < frameCount; i++) {
      frameSizes.push(frameSize);
    }
  } else if (lacing === 0x04) {
    // EBML lacing: read N-1 VINT sizes, last is remainder
    let sum = 0;
    for (let i = 0; i < frameCount - 1; i++) {
      const sz = readVintValue(data, offset);
      if (!sz) break;
      offset += sz.length;
      frameSizes.push(sz.value);
      sum += sz.value;
    }
    const remaining = data.length - offset;
    frameSizes.push(remaining - sum);
  } else if (lacing === 0x06) {
    // Xiph lacing: N-1 sizes encoded as FF...+final<FF, last is remainder
    let sum = 0;
    for (let i = 0; i < frameCount - 1; i++) {
      let size = 0;
      while (offset < data.length) {
        const byte = data[offset];
        offset++;
        size += byte;
        if (byte !== 0xFF) break;
      }
      frameSizes.push(size);
      sum += size;
    }
    const remaining = data.length - offset;
    frameSizes.push(remaining - sum);
  }

  // Emit all frames from this SimpleBlock
  for (const size of frameSizes) {
    if (offset + size > data.length) break;
    blocks.push({
      trackNumber,
      timecode: absoluteUs,
      isKeyframe,
      data: data.slice(offset, offset + size),
    });
    offset += size;
  }

  return blocks;
}

// ── StreamingMkvParser ──────────────────────────────────────────────

export class StreamingMkvParser {
  // Callbacks
  public onDuration?: (duration: number) => void;
  public onTrack?: (track: TrackMeta) => void;
  public onBlock?: (block: ParsedBlock) => void;
  public onError?: (error: Error) => void;
  public onDone?: () => void;

  // Internal state
  private buffer: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private timecodeScale = 1_000_000; // nanoseconds per tick (default 1ms)
  private duration = 0;
  private tracks = new Map<number, TrackMeta>();
  private clusterTimecode = 0;
  /** Context stack: bytes remaining in current master (-1 = unknown/until-stream-end) */
  private contextRemaining: number[] = [];
  /** Track entry being built (set while inside a TrackEntry master) */
  private pendingTrack: Partial<TrackMeta> | null = null;
  /** Set to true once the segment has started (we're past EBML header) */
  private inSegment = false;
  /** True once we've emitted metadata (tracks + duration) */
  private metadataEmitted = false;
  /** Set to true when at least one cluster has been entered */
  private inCluster = false;
  /** True if a cluster timecode has been read for the current cluster */
  private hasClusterTimecode = false;
  /** Track ignored during parsing to skip non-selected audio */
  private audioTrackDiscard: number | null = null;
  /** Aborted flag */
  private aborted = false;

  /**
   * Start parsing from a ReadableStream reader.
   * Resolves when the stream ends (not when playback is complete).
   */
  async parseStream(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (this.aborted) return;
        if (done) break;
        this.feedChunk(value);
        if (this.aborted) return;
      }
      this.onDone?.();
    } catch (e) {
      if (!this.aborted) {
        this.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  /** Abort parsing (call when unmounting) */
  abort(): void {
    this.aborted = true;
  }

  // ── Chunk processing ─────────────────────────────────────────────

  private feedChunk(chunk: Uint8Array): void {
    // Append chunk to buffer
    const newBuf = new Uint8Array(this.buffer.length + chunk.length);
    newBuf.set(this.buffer);
    newBuf.set(chunk, this.buffer.length);
    this.buffer = newBuf;

    this.parseLoop();
  }

  private parseLoop(): void {
    while (this.offset < this.buffer.length) {
      // Exhausted context stack — pop completed masters
      while (this.contextRemaining.length > 0) {
        const rem = this.contextRemaining[this.contextRemaining.length - 1];
        if (rem === 0) {
          // This master is done — pop it
          this.contextRemaining.pop();
          this.onMasterExit();
          continue;
        }
        break;
      }

      // Try to read the next element
      const header = this.peekElementHeader();
      if (!header) break; // need more data

      const { id, idLen, vintLen, dataSize, headerSize } = header;

      // Check if this element fits in the current context
      if (
        this.contextRemaining.length > 0 &&
        this.contextRemaining[this.contextRemaining.length - 1] >= 0
      ) {
        const remaining = this.contextRemaining[this.contextRemaining.length - 1];
        if (headerSize + dataSize > remaining) {
          // We've consumed all of the current master's data — pop and re-check
          this.contextRemaining.pop();
          this.onMasterExit();
          continue;
        }
      }

      // Check if the full element data is available in the buffer
      const elementEnd = this.offset + headerSize + (dataSize >= 0 ? dataSize : 0);
      if (elementEnd > this.buffer.length) {
        // Need more data
        if (dataSize < 0) {
          // Unknown size — for Segment or Cluster with unknown size,
          // we can't wait for the full element. Enter master mode.
          // This shouldn't happen in practice for well-formed MKVs.
          break;
        }
        break;
      }

      // At this point, we can fully consume this element
      const isMaster = MASTER_ELEMENTS.has(id);

      if (isMaster) {
        // Enter master element (e.g., Segment, Info, Tracks, Cluster)
        this.offset += headerSize;
        if (dataSize >= 0) {
          this.contextRemaining.push(dataSize);
        } else {
          this.contextRemaining.push(-1); // unknown size
        }
        this.onMasterEnter(id);
      } else {
        // Data element — read value
        const dataStart = this.offset + headerSize;
        const data = this.buffer.slice(dataStart, dataStart + dataSize);
        this.offset = dataStart + dataSize;

        // Deduct from parent context
        this.consumeFromContext(headerSize + dataSize);

        this.onDataElement(id, data);
      }
    }

    // Compact buffer — discard consumed bytes
    this.compactBuffer();
  }

  /** Try to read the next element's header metadata without consuming it. */
  private peekElementHeader(): {
    id: number;
    idLen: number;
    vintLen: number;
    dataSize: number;
    headerSize: number;
  } | null {
    const idResult = readElementId(this.buffer, this.offset);
    if (!idResult) return null;

    const sizeResult = readVintValue(this.buffer, this.offset + idResult.length);
    if (!sizeResult) return null;

    const dataSize = sizeResult.unknown ? -1 : sizeResult.value;

    // Sanity check: dataSize should not be astronomically large for non-master elements
    // (this prevents OOM from corrupt data)
    if (dataSize > 500_000_000 && !MASTER_ELEMENTS.has(idResult.id)) {
      this.onError?.(new Error(`Element 0x${idResult.id.toString(16)} has implausible dataSize ${dataSize}`));
      return null;
    }

    return {
      id: idResult.id,
      idLen: idResult.length,
      vintLen: sizeResult.length,
      dataSize,
      headerSize: idResult.length + sizeResult.length,
    };
  }

  /** Subtract `bytes` from the top of the context stack. */
  private consumeFromContext(bytes: number): void {
    for (let i = this.contextRemaining.length - 1; i >= 0; i--) {
      const rem = this.contextRemaining[i];
      if (rem >= 0) {
        this.contextRemaining[i] = rem - bytes;
        if (this.contextRemaining[i] < 0) this.contextRemaining[i] = 0;
      }
      break; // only the innermost non-unknown context
    }
  }

  /** Move unconsumed data to the front of the buffer. */
  private compactBuffer(): void {
    if (this.offset === 0) return;
    const remaining = this.buffer.length - this.offset;
    if (remaining > 0) {
      this.buffer = this.buffer.slice(this.offset);
    } else {
      this.buffer = new Uint8Array(0);
    }
    this.offset = 0;
  }

  // ── Element handlers ─────────────────────────────────────────────

  private onMasterEnter(id: number): void {
    switch (id) {
      case ELEM_EBML:
        // EBML header — nothing special needed
        break;
      case ELEM_SEGMENT:
        this.inSegment = true;
        break;
      case ELEM_SEEK_HEAD:
        // We skip seek head contents — nothing to do
        break;
      case ELEM_INFO:
        // Entering Info — will capture Duration and TimecodeScale
        break;
      case ELEM_TRACKS:
        // Entering Tracks — will capture TrackEntry children
        break;
      case ELEM_TRACK_ENTRY:
        this.pendingTrack = {};
        break;
      case ELEM_CLUSTER:
        this.inCluster = true;
        this.hasClusterTimecode = false;
        this.clusterTimecode = 0;
        break;
      case ELEM_BLOCK_GROUP:
        // BlockGroup — will read Block + BlockDuration inside
        break;
    }
  }

  private onMasterExit(): void {
    if (this.pendingTrack) {
      // Finished parsing a TrackEntry — emit it
      const track = this.pendingTrack;
      if (track.trackNumber !== undefined && track.trackType && track.codecId) {
        const meta: TrackMeta = {
          trackNumber: track.trackNumber,
          trackType: track.trackType,
          codecId: track.codecId,
          language: track.language || 'eng',
          codecPrivate: track.codecPrivate,
          width: track.width,
          height: track.height,
          channels: track.channels,
          sampleRate: track.sampleRate,
        };
        this.tracks.set(meta.trackNumber, meta);
        this.onTrack?.(meta);
      }
      this.pendingTrack = null;
    }
  }

  private onDataElement(id: number, data: Uint8Array): void {
    // If we're inside a TrackEntry, route to pending track
    if (this.pendingTrack) {
      this.handleTrackEntryData(id, data);
      return;
    }

    // Top-level data elements inside Segment: Duration, TimecodeScale
    if (this.inSegment && !this.inCluster) {
      switch (id) {
        case ELEM_DURATION:
          this.duration = readFloat(data) * (this.timecodeScale / 1_000_000_000);
          this.tryEmitMetadata();
          return;
        case ELEM_TIMECODE_SCALE:
          this.timecodeScale = readUint(data);
          return;
      }
    }

    // Inside Cluster
    if (this.inCluster) {
      switch (id) {
        case ELEM_CLUSTER_TIMECODE:
          this.clusterTimecode = readUint(data);
          this.hasClusterTimecode = true;
          return;
        case ELEM_SIMPLE_BLOCK:
          if (!this.hasClusterTimecode) return;
          this.emitSimpleBlocks(data);
          return;
      }
    }
  }

  private handleTrackEntryData(id: number, data: Uint8Array): void {
    const track = this.pendingTrack!;
    switch (id) {
      case ELEM_TRACK_NUMBER:
        track.trackNumber = readUint(data);
        break;
      case ELEM_TRACK_TYPE:
        track.trackType = readUint(data);
        break;
      case ELEM_CODEC_ID:
        track.codecId = readString(data);
        break;
      case ELEM_CODEC_PRIVATE:
        track.codecPrivate = data;
        break;
      case ELEM_LANGUAGE:
        track.language = readString(data);
        break;
      case ELEM_PIXEL_WIDTH:
        track.width = readUint(data);
        break;
      case ELEM_PIXEL_HEIGHT:
        track.height = readUint(data);
        break;
      case ELEM_CHANNELS:
        track.channels = readUint(data);
        break;
      case ELEM_SAMPLE_RATE:
        track.sampleRate = readFloat(data);
        break;
    }
  }

  // ── Emit metadata once we have both duration and at least one track ──

  private metadataEmittedFlag = false;

  private tryEmitMetadata(): void {
    // We don't need to emit anything special here; tracks are emitted
    // individually in onMasterExit, and duration is emitted onParse.
    // This method is kept for future use if needed.
  }

  // ── SimpleBlock → ParsedBlock emission ─────────────────────────

  private emitSimpleBlocks(data: Uint8Array): void {
    const blocks = parseSimpleBlock(data, this.clusterTimecode, this.timecodeScale);
    for (const block of blocks) {
      // Skip audio tracks that aren't the selected one (if selection is active)
      const track = this.tracks.get(block.trackNumber);
      if (track?.trackType === 2 && this.audioTrackDiscard !== null) {
        if (block.trackNumber === this.audioTrackDiscard) {
          // Don't emit — not selected
          continue;
        }
      }
      this.onBlock?.(block);
    }
  }

  // ── Public helpers ────────────────────────────────────────────────

  /** Get parsed track metadata for all tracks discovered so far. */
  getTracks(): Map<number, TrackMeta> {
    return this.tracks;
  }

  /** Get parsed duration in seconds (0 if not yet parsed). */
  getDuration(): number {
    return this.duration;
  }

  /** Set which audio track number to keep; others are discarded. null = keep all. */
  setSelectedAudioTrack(trackNumber: number | null): void {
    this.audioTrackDiscard = trackNumber;
  }
}

// ── Codec Mapping (Matroska → WebCodecs) ────────────────────────────

const VIDEO_CODEC_MAP: Record<string, string[]> = {
  'V_MPEGH/ISO/HEVC': [
    'hev1.1.6.L150.B0',   // Main, Level 5.0
    'hev1.1.6.L120.B0',   // Main, Level 4.0
    'hvc1.1.6.L150.B0',   // hvc1 brand
    'hev1.2.4.L150.B0',   // Main10, Level 5.0
    'hvc1.2.4.L150.B0',   // Main10, hvc1 brand
    'hev1.1.6.L93.B0',    // Main, Level 3.1
    'hev1.2.4.L120.B0',   // Main10, Level 4.0
  ],
  'V_MPEGH/ISO/HEVC/HDR': [
    'hev1.2.6.L150.B0',
    'hev1.2.6.L120.B0',
    'hvc1.2.6.L150.B0',
  ],
  'V_MPEGH/ISO/HEVC/HDR10': [
    'hev1.2.6.L150.B0',
    'hev1.2.6.L120.B0',
    'hvc1.2.6.L150.B0',
  ],
  'V_MPEG4/ISO/AVC': ['avc1.64001f'],
  'V_VP9': ['vp09.00.10.08'],
  'V_AV1': ['av01.0.00M.08'],
};

const DEFAULT_HEVC_CANDIDATES = VIDEO_CODEC_MAP['V_MPEGH/ISO/HEVC'];

/** Get WebCodecs codec string candidates for a Matroska video codec ID. */
export function getVideoCodecCandidates(codecId: string): string[] {
  return VIDEO_CODEC_MAP[codecId] || DEFAULT_HEVC_CANDIDATES;
}

/**
 * Check if this browser supports HEVC decoding via WebCodecs.
 * Uses multiple detection methods for broad compatibility:
 *   1. VideoDecoder.isConfigSupported() — WebCodecs native check
 *   2. MediaSource.isTypeSupported() — MSE-level codec check
 *   3. HTMLVideoElement.canPlayType() — legacy <video> element check
 * Returns true if ANY method reports support.
 */
export async function checkHevcSupport(): Promise<boolean> {
  if (typeof window === 'undefined') return false; // SSR guard
  const diag: string[] = [];

  // ── Method 1: WebCodecs VideoDecoder.isConfigSupported ──
  if (typeof VideoDecoder !== 'undefined') {
    for (const codec of DEFAULT_HEVC_CANDIDATES) {
      try {
        // Include width/height hints — some browser implementations
        // need them to validate the config against hardware capabilities
        const cfg: VideoDecoderConfig = { codec, codedWidth: 1920, codedHeight: 1080 };
        const result = await VideoDecoder.isConfigSupported(cfg);
        diag.push(`VD:${codec.split('.')[0]}..=${result.supported}`);
        if (result.supported) {
          console.log(`[HEVC] Supported via VideoDecoder: ${codec}`);
          return true;
        }
      } catch (e) {
        diag.push(`VD:${codec.split('.')[0]}..=ERR`);
      }
    }
  } else {
    diag.push('VD:unavailable');
  }

  // ── Method 2: MediaSource.isTypeSupported (MSE API) ──
  if (typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function') {
    for (const codec of ['hev1.1.6.L150.B0', 'hvc1.1.6.L150.B0', 'hev1.1.6.L120.B0', 'hvc1.1.6.L120.B0']) {
      try {
        const mime = `video/mp4;codecs="${codec}"`;
        const ok = MediaSource.isTypeSupported(mime);
        diag.push(`MS:${codec.split('.')[0]}..=${ok}`);
        if (ok) {
          console.log(`[HEVC] Supported via MediaSource: ${codec}`);
          return true;
        }
      } catch {
        diag.push(`MS:${codec.split('.')[0]}..=ERR`);
      }
    }
  } else {
    diag.push('MS:unavailable');
  }

  // ── Method 3: HTMLVideoElement.canPlayType (legacy) ──
  try {
    const v = document.createElement('video');
    for (const codec of ['hev1.1.6.L150.B0', 'hvc1.1.6.L150.B0', 'hev1.1.6.L120.B0', 'hvc1.1.6.L120.B0']) {
      const mime = `video/mp4;codecs="${codec}"`;
      const result = v.canPlayType(mime);
      diag.push(`CPT:${codec.split('.')[0]}..=${result}`);
      if (result === 'probably' || result === 'maybe') {
        console.log(`[HEVC] Supported via canPlayType: ${codec}`);
        return true;
      }
    }
  } catch {
    diag.push('CPT:ERR');
  }

  console.warn(`[HEVC] All detection methods returned false. Diagnostics:`, diag.join(', '));
  return false;
}

const AUDIO_CODEC_MAP: Record<string, string> = {
  'A_AAC': 'mp4a.40.2',
  'A_AAC/MPEG4/LC': 'mp4a.40.2',
  'A_AAC/MPEG4/LC/SBR': 'mp4a.40.2',
  'A_AAC/MPEG4/HE': 'mp4a.40.5',
  'A_AAC/MPEG4/HE/SBR': 'mp4a.40.5',
  'A_AC3': 'ac-3',
  'A_EAC3': 'ec-3',
  'A_OPUS': 'opus',
  'A_VORBIS': 'vorbis',
  'A_FLAC': 'flac',
  'A_PCM/INT/BIG': 'pcm-s16be',
  'A_PCM/INT/LIT': 'pcm-s16le',
};

export function mapAudioCodec(codecId: string): string {
  return AUDIO_CODEC_MAP[codecId] || 'mp4a.40.2';
}
