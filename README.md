# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.4

V2.4 keeps the proven cursor-free deterministic WebM/MP4 engine and adds quality controls, named social-video presets, and direct standalone HTML import.

### Current features

- HTML / CSS / JavaScript live preview
- direct `.html` / `.htm` file import and drag-and-drop
- full-document preview mode for imported standalone HTML files
- 24 / 30 / 60 FPS targets
- 1920×1080 landscape, 1080×1920 TikTok/Reels/Shorts, 1080×1080 square, 1280×720 HD, and 720×1280 social-draft presets
- Draft / Standard / High / Master quality profiles
- quality-aware raw capture bitrate and final WebCodecs bitrate targets
- exact `duration × FPS` final frame count
- pixel-perfect target dimensions
- cursor-free Pointer Lock capture guard
- tiny capture-handshake black-prefix cleanup
- deterministic WebM export with VP9/VP8
- deterministic MP4 export with H.264/AVC
- hardware → neutral → software encoder probing
- MP4 fast-start layout for better playback/streaming compatibility
- no silent WebM fallback when an MP4 hard-lock request fails
- local browser rendering; composition source is not uploaded to a render server

## V2.4 render flow

```text
HTML / CSS / JS
or imported standalone .html
      ↓
Sandboxed live preview
      ↓
Choose format / resolution / FPS / quality
      ↓
Chrome: This Tab → Share
      ↓
Cursor-Free Gate
      ↓
Pointer Lock / OS cursor hidden
      ↓
Quality-aware raw local capture
      ↓
Pixel-perfect crop
      ↓
Selected final encoder
      ├── WebM → VP9 / VP8
      └── MP4  → H.264 / AVC
      ↓
Quality-aware WebCodecs bitrate
      ↓
Exact deterministic timestamps
      ↓
WebM or fast-start MP4 mux
      ↓
Download
```

## Quality profiles

```text
Draft    → fast previews / lower bitrate
Standard → balanced export
High     → premium default
Master   → highest target bitrate / maximum detail
```

The quality layer scales both the raw browser-capture bitrate and the final WebCodecs target bitrate while keeping the deterministic frame clock unchanged.

## Social presets

```text
1920×1080 → YouTube / landscape 16:9
1080×1920 → TikTok / Reels / Shorts 9:16
1080×1080 → square 1:1
1280×720  → HD landscape
720×1280  → lightweight social draft 9:16
```

## HTML import

Press **Import HTML** or drag a `.html` file anywhere onto the Studio. V2.4 detects a full HTML document and renders it directly inside the isolated preview while still injecting the Studio animation-control bridge.

For the most reliable result, imported HTML should be self-contained or reference remote assets with normal web URLs. Local relative assets that only exist beside the original file are not automatically uploaded with the HTML file.

## Recommended V2.4 validation

Use desktop Chrome and test:

```text
Resolution: 1080×1920 · TikTok / Reels / Shorts
FPS:        60
Format:     MP4 · H.264
Quality:    High
Duration:   6 seconds
```

Press **Render video**, choose **This Tab**, press **Share**, then click **Lock cursor & continue**. Do not press Escape until raw capture finishes.

Expected target for a 6-second 60 FPS render:

```text
Frames      : 360 / 360
FPS         : deterministic 60
Resolution  : exact selected preset
Black start : none
Cursor      : absent
Container   : selected WebM or MP4
```

Diagnostics are available in DevTools:

```js
hvDiagnostics()
hvCursorDiagnostics()
hvMp4Diagnostics()
hvV24Diagnostics()
```

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
