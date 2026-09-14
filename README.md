# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.2.2

V2.2.2 keeps the V2.2.1 pixel-perfect deterministic encoder and adds a cursor-free capture guard.

### What changed in V2.2.2

- keeps the exact deterministic WebCodecs frame clock from V2.2.1
- keeps the exact `duration × FPS` output-frame requirement (6 s × 60 FPS = 360 frames)
- intercepts the browser share flow before raw recording begins
- after Chrome shares **This Tab**, recording pauses until Pointer Lock is activated
- Pointer Lock hides the operating-system cursor before the first recorded frame
- CSS cursor suppression remains as a second protection layer
- if Pointer Lock is released during capture, the render is stopped instead of silently returning a cursor-contaminated file
- exposes cursor diagnostics through `window.__HV_CURSOR_DIAGNOSTICS` and `hvCursorDiagnostics()`
- keeps VP9/VP8 hardware → neutral → software encoder probing
- keeps pixel-perfect target dimensions and tiny capture-handshake black-prefix cleanup

## V2.2.2 render flow

```text
HTML / CSS / JS
      ↓
Sandboxed live preview
      ↓
Chrome: choose This Tab → Share
      ↓
Cursor-Free Gate
      ↓
Click “Lock cursor & continue”
      ↓
Pointer Lock active / OS cursor hidden
      ↓
Raw local capture
      ↓
Pixel-perfect source crop
      ↓
VP9 / VP8 encoder probe
 hardware → neutral → software
      ↓
Exact WebCodecs timestamps
      ↓
360 frames for 6 s @ 60 FPS
      ↓
WebM mux
      ↓
Cursor-free deterministic final video
```

## Recommended validation test

Use desktop Chrome and select:

```text
Resolution: 1920×1080
FPS:        60
Format:     WebM
Duration:   6 seconds
```

Press **Render video**, choose **This Tab** in Chrome's sharing dialog, then press **Share**. When the V2.2.2 gate appears, click **Lock cursor & continue** once. Do not press Escape until the raw capture finishes.

Expected final verification target:

```text
Resolution : 1920×1080 throughout
Frames     : 360 / 360
FPS        : 60 deterministic cadence
Black start: none
Cursor     : absent
```

Diagnostics are available in DevTools with:

```js
hvDiagnostics()
hvCursorDiagnostics()
```

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
