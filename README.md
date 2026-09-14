# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.3

V2.3 keeps the V2.2.2 cursor-free deterministic WebM pipeline and adds deterministic MP4/H.264 export.

### Current features

- HTML / CSS / JavaScript live preview
- 24 / 30 / 60 FPS targets
- 1920×1080, 1080×1920, 1080×1080 and 1280×720 outputs
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

## V2.3 render flow

```text
HTML / CSS / JS
      ↓
Sandboxed live preview
      ↓
Chrome: This Tab → Share
      ↓
Cursor-Free Gate
      ↓
Pointer Lock / OS cursor hidden
      ↓
Raw local capture
      ↓
Pixel-perfect crop
      ↓
Selected final encoder
      ├── WebM → VP9 / VP8
      └── MP4  → H.264 / AVC
      ↓
Exact WebCodecs timestamps
      ↓
360 frames for 6 s @ 60 FPS
      ↓
WebM or fast-start MP4 mux
      ↓
Download
```

## Recommended MP4 validation

Use desktop Chrome and select:

```text
Resolution: 1920×1080
FPS:        60
Format:     MP4 · H.264
Duration:   6 seconds
```

Press **Render video**, choose **This Tab**, press **Share**, then click **Lock cursor & continue**. Do not press Escape until raw capture finishes.

Expected target:

```text
Container   : MP4
Codec       : H.264 / AVC
Resolution  : 1920×1080 throughout
Frames      : 360 / 360
FPS         : 60 deterministic cadence
Black start : none
Cursor      : absent
```

Diagnostics are available in DevTools:

```js
hvDiagnostics()
hvCursorDiagnostics()
hvMp4Diagnostics()
```

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
