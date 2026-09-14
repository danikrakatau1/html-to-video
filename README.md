# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.2

V2.2 keeps the V2.1 pixel-perfect browser capture pipeline and replaces the final real-time canvas recorder with a deterministic WebCodecs frame clock when supported.

### Current features

- HTML / CSS / JavaScript live preview
- 24 / 30 / 60 FPS targets
- 1920×1080, 1080×1920, 1080×1080 and 1280×720 outputs
- exact selected pixel dimensions from the first final output frame
- capture-stream stabilization before recording
- best-effort Element Capture / Region Capture isolation
- cursor suppression during capture
- automatic full-tab stage crop fallback
- deterministic WebCodecs VP9/VP8 final encoder for WebM
- exact per-frame microsecond timestamps independent of display refresh rate
- exact frame count target: duration × FPS (for example 6 s × 60 FPS = 360 frames)
- small capture-handshake black-prefix detection capped to roughly 67 ms
- V2.1 MediaRecorder normalizer remains as compatibility fallback
- local browser rendering; source composition is not uploaded to a render server

## V2.2 render flow

```text
HTML / CSS / JS
      ↓
Sandboxed live preview
      ↓
Browser tab capture
      ↓
Wait for stable capture dimensions
      ↓
Element/Region capture or clean-stage crop fallback
      ↓
Raw browser capture
      ↓
Deterministic offline normalization
      ↓
seek source at exact frame times
      ↓
Canvas at exact target resolution
      ↓
VideoFrame(timestamp = frame / FPS)
      ↓
WebCodecs VP9 / VP8
      ↓
WebM muxer
      ↓
Download
```

## Why V2.2 exists

The V2.1 normalization pass successfully locked output resolution, but a 6-second 60 FPS test produced about 300 frames (~50 FPS) because canvas `captureStream(fps)` still depended on browser scheduling/display cadence.

V2.2 does not use monitor refresh cadence for the final file. Each final frame gets an explicit timestamp and duration. At 60 FPS the timeline is built at 16.666… ms intervals and a 6-second export targets exactly 360 frames.

## Zero-black-frame protection

The final encoder begins from an actual decoded source frame instead of starting a blank canvas recorder. V2.2 also probes only the first few frames for a tiny all-black capture-handshake artifact and can skip that prefix. The protection is intentionally capped to a very short window so authored black intros are not broadly trimmed.

## Codec note

The deterministic V2.2 path currently produces WebM with VP9 when available and VP8 as fallback. The UI may still accept an MP4 request, but deterministic export can fall back to WebM; browsers without the required WebCodecs/muxer support fall back to the V2.1 MediaRecorder normalization path.

V2.2 currently loads `webm-muxer` 5.1.2 in the browser for the experimental deterministic muxing path. The library is deprecated upstream in favor of Mediabunny, so migrating the mux layer is a future cleanup task rather than a blocker for this checkpoint.

## Recommended verification

Use desktop Chrome and select:

```text
Resolution: 1920×1080
FPS:        60
Format:     WebM
Duration:   6 seconds
```

Press **Render video**, choose **This Tab** in Chrome's sharing dialog, then press **Share**.

Expected final verification target:

```text
Resolution : 1920×1080 throughout
Duration   : ~6.000 s
Frames     : 360
FPS        : 60 timeline cadence
Frame 0    : composition frame, not capture-handshake black
Cursor     : absent
```

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
