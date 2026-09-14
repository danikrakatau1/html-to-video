# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.1

V2.1 adds a pixel-perfect browser capture pipeline:

- HTML / CSS / JavaScript live preview
- 24 / 30 / 60 FPS targets
- 1920×1080, 1080×1920, 1080×1080 and 1280×720 outputs
- WebM plus best-effort MP4 when the browser exposes an MP4 MediaRecorder codec
- capture-stream stabilization before recording
- best-effort Element Capture / Region Capture isolation
- cursor suppression during capture
- automatic full-tab stage crop fallback
- second canvas normalization pass that encodes the final file at the exact selected pixel dimensions from the first output frame
- local browser rendering; source composition is not uploaded to a render server

## V2.1 render flow

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
Raw MediaRecorder pass
      ↓
Canvas normalization at exact target width × height
      ↓
Final MediaRecorder output
      ↓
Download WebM / supported MP4
```

## Recommended first test

Use desktop Chrome and select:

```text
Resolution: 1920×1080
FPS:        60
Format:     WebM
Duration:   6 seconds
```

Press **Render video**, choose **This Tab** in Chrome's sharing dialog, then press **Share**. V2.1 first records the composition and then performs a second normalization pass, so a 6-second video takes roughly longer than 6 seconds to finish.

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.