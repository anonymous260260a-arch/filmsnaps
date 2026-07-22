# HEVC/x265 Playback — WebCodecs Pipeline Architecture

## Executive Summary

The Falix provider serves MKV files with HEVC (x265) encoding. Desktop browsers do not natively support HEVC in the `<video>` element. Audio (AAC) plays, video (HEVC) does not.

**Solution:** Build a custom player pipeline using the **WebCodecs API** (`VideoDecoder`) for HEVC playback, with a fallback to standard `<video>` for H.264 sources.

---

## Codec Detection & Source Selection

### Step 1: Sort sources by codec (DONE)

The `FalixPlayer` now sorts telegram entries so H.264 (x264/AVC) files come first. The default selection (index 0) will be H.264 if available — no special pipeline needed.

```typescript
const isH264 = (name: string) => !/x265|HEVC|hevc|10bit/i.test(name);
entries.sort((a, b) => {
  const aH264 = isH264(a.name) ? 0 : 1;
  const bH264 = isH264(b.name) ? 0 : 1;
  if (aH264 !== bH264) return aH264 - bH264;
  return 0;
});
```

### Step 2: Browser HEVC support check

Before attempting HEVC playback, detect if WebCodecs HEVC decoding is available:

```typescript
const checkHevcSupport = async (): Promise<boolean> => {
  if (!('VideoDecoder' in window)) return false;
  try {
    const result = await VideoDecoder.isConfigSupported({
      codec: 'hev1.1.6.L120.B0'
    });
    return result.supported;
  } catch {
    return false;
  }
};
```

If unsupported, show UI message: *"Your browser or OS does not support hardware HEVC decoding."*

### Supported Platforms

| Platform | HEVC WebCodecs |
|----------|---------------|
| macOS Chrome/Edge | ✅ Via VideoToolbox |
| Android Chrome/WebView | ✅ Via MediaCodec |
| Windows Chrome/Edge | ⚠️ Only with "HEVC Video Extensions" from MS Store |
| Linux Chrome | ❌ Not supported |
| Firefox (any) | ❌ No WebCodecs API |

---

## WebCodecs MKV Pipeline Architecture

### Overview

Since the source is an MKV container, we must demux the Matroska EBML format in JavaScript and extract encoded chunks. The pipeline:

```
fetch(videoUrl)
  → ReadableStream
  → MKV Demuxer (ebml-stream / matroska-demuxer)
    → HEVC video chunks → VideoDecoder → VideoFrame → <canvas>
    → AAC audio chunks → AudioDecoder / WebAudio → speakers
  → Audio/Video sync via timing comparison
```

### Pipeline Components

#### 1. Fetch & Stream

```typescript
const response = await fetch(videoUrl, { signal: abortController.signal });
const reader = response.body!.getReader();
```

#### 2. MKV Demuxer

Library: `ebml-stream` or `matroska-demuxer`. Must:
- Parse Matroska EBML headers (detect tracks, codecs, languages)
- Extract `TrackEntry` blocks (TrackType = 1 for video, TrackType = 2 for audio)
- Read `Language` tag from each audio track (for multi-audio switching — Hindi, Tamil, Telugu)
- Output separate byte streams per track

```typescript
demuxer.on('videoChunk', (chunk: EncodedVideoChunkInit) => {
  if (decoder.decodeQueueSize < 10) {
    decoder.decode(new EncodedVideoChunk({
      type: chunk.isKeyframe ? 'key' : 'delta',
      timestamp: chunk.timestamp,
      data: chunk.data
    }));
  }
});

demuxer.on('audioChunk', (chunk) => {
  // Feed to AudioDecoder or WebAudio
});
```

#### 3. VideoDecoder

```typescript
const decoder = new VideoDecoder({
  output: (frame: VideoFrame) => {
    const canvas = canvasRef.current!;
    canvas.width = frame.codedWidth;
    canvas.height = frame.codedHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close(); // MUST close to free GPU memory
  },
  error: (e) => console.error('VideoDecoder error:', e),
});

decoder.configure({ codec: 'hev1.1.6.L120.B0' });
```

#### 4. Audio Playback

Two approaches:
- **AudioDecoder**: Decode AAC to PCM, schedule via AudioContext (more reliable)
- **WebAudio decodeAudioData**: If using pre-demuxed audio, decode and schedule

For multi-audio (HIN/TAM/TEL tracks in MKV), the demuxer detects all audio TrackEntry blocks. The active track is selected by filtering chunks by `TrackNumber`:

```typescript
let selectedAudioTrack: number;

demuxer.on('audioChunk', (chunk) => {
  if (chunk.trackNumber !== selectedAudioTrack) return; // Skip if not selected
  // Feed to audio pipeline
});
```

#### 5. A/V Sync

Compare audio `currentTime` with decoded video frame timestamps:

```typescript
const sync = () => {
  const audioTime = audioContext.currentTime;
  requestAnimationFrame(() => {
    // decoder.decode() has already pushed frames via the output callback
    // Sync by checking frame.timestamp ≈ audioTime * 1_000_000
  });
};
```

#### 6. Controls (All Custom)

Since there is no `<video>` element, everything must be built from scratch:
- Play/pause
- Seek (flush decoder, seek in stream, restart demuxing from new position)
- Volume
- Timeline scrubber
- Fullscreen

---

## Component Architecture

### Decision Tree

```typescript
if (selectedEntry is H.264) {
  // Use standard <video> + video.js (existing code)
  renderStandardVideoPlayer();
} else {
  // HEVC — use WebCodecs pipeline
  if (await checkHevcSupport()) {
    renderWebCodecsPlayer();
  } else {
    showUnsupportedMessage();
  }
}
```

### Updated `FalixPlayer.tsx` Structure

```typescript
export function FalixPlayer(props) {
  // 1. Fetch API data, sort entries (H.264 first)
  // 2. Check if current entry is H.264 or HEVC
  // 3. If H.264: render existing video.js + <video> element
  // 4. If HEVC:
  //    a. Check HEVC support
  //    b. If supported: render <canvas> + WebCodecs pipeline
  //    c. If unsupported: show error message
  
  return (
    <>
      {isH264(currentEntry) ? (
        <StandardVideoPlayer ... />
      ) : hevcSupported ? (
        <WebCodecsPlayer videoUrl={videoUrl} ... />
      ) : (
        <UnsupportedCodecMessage />
      )}
      {/* Quality + Audio pills (shared) */}
    </>
  );
}
```

---

## Implementation Phases

### Phase 1: H.264 Fallback (DONE)
- [x] Sort telegram entries: H.264 before HEVC
- [x] video.js player works for H.264 sources
- [x] Quality selector pills work
- [x] Audio track switching (native `audioTracks` API, works with `<video>` element)

### Phase 2: WebCodecs Player (Next)
- [ ] Browser HEVC support detection (`checkHevcSupport()`)
- [ ] MKV EBML demuxer integration (parse headers, extract tracks)
- [ ] `VideoDecoder` integration (configure, decode, output to canvas)
- [ ] Audio pipeline (AudioDecoder or WebAudio)
- [ ] A/V sync logic
- [ ] Custom controls (play/pause, seek, volume, fullscreen)
- [ ] Multi-audio track switching (filter by TrackNumber)
- [ ] Codec detection → render standard `<video>` or WebCodecs `<canvas>`

### Phase 3: Polish
- [ ] Error handling and recovery
- [ ] Buffering/progress indicator
- [ ] Keyboard shortcuts
- [ ] Performance optimization (backpressure, frame dropping)
- [ ] Mobile responsive

---

## Engineering Estimate

**2-3 weeks** for a stable implementation. The MKV EBML demuxer and A/V sync are the hardest parts. Libraries like `ebml-stream` and `matroska-demuxer` exist but require significant integration work.

## Key Risks

1. **Windows HEVC support**: Requires MS Store "HEVC Video Extensions" — many users won't have it
2. **Linux/Firefox**: No HEVC support at all — ~15-20% of desktop users
3. **Canvas performance**: `drawImage` with 1080p frames at 60fps requires GPU compositing
4. **Memory**: `VideoFrame` objects must be closed promptly to avoid GPU memory exhaustion
5. **Seeking**: Complex — must flush decoder, reinitialize at new position
