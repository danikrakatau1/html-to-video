# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.2.1

V2.2.1 keeps the V2.1 pixel-perfect browser capture pipeline and hard-locks the final deterministic encoder.

### What changed in V2.2.1

- no silent fallback to the V2.1 MediaRecorder normalizer when deterministic encoding fails
- exact WebCodecs timestamps for every final output frame
- 60 FPS × 6 seconds must equal exactly 360 timed frames
- probes VP9 then VP8 across `prefer-hardware`, `no-preference`, and `prefer-software`
- retries multiple bitrate levels when a GPU/driver rejects a configuration
- performs a real `VideoEncoder.configure()` probe after `isConfigSupported()`
- exposes diagnostics in `window.__HV_ENCODER_DIAGNOSTICS`, `window.__HV_LAST_RENDER`, and `hvDiagnostics()`
- deterministic failures are surfaced visibly instead of returning a misleading fallback file
- tiny capture-handshake black-prefix cleanup is still capped to about 100 ms

## V2.2.1 render flow

```text
HTML / CSS / JS
      ↓
Sandboxed live preview
      ↓
Browser tab capture
      ↓
Stable pixel-perfect stage capture
      ↓
Raw local capture
      ↓
VP9 / VP8 encoder probe
 hardware → neutral → software
      ↓
Exact WebCodecs frame timestamps
      ↓
WebM mux
      ↓
Deterministic final video
```

## Recommended validation test

Use desktop Chrome and select:

```text
Resolution: 1920×1080
FPS:        60
Format:     WebM
Duration:   6 seconds
```

Press **Render video**, choose **This Tab** in Chrome's sharing dialog, then press **Share**.

A successful hard-lock render should complete the final stage as:

```text
Hard-lock frame 360/360
```

After the render, `hvDiagnostics()` in DevTools shows which codec and acceleration mode were selected plus final render metadata.

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
