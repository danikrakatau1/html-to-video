# HTML to Video

Browser-based HTML/CSS/JavaScript animation studio deployed on Cloudflare Workers.

## Current checkpoint — Studio V2.5

V2.5 keeps the proven V2.4 cursor-free deterministic WebM/MP4 engine and adds a local soundtrack + asset pipeline.

### Current features

- HTML / CSS / JavaScript live preview
- direct standalone `.html` import and drag-and-drop
- local asset import for images, fonts, CSS, JavaScript, video and audio
- project-folder import (`index.html` + relative local assets)
- relative local asset rewriting to browser-safe in-memory data URLs
- external local CSS/JS inlining when imported as project assets
- soundtrack upload plus built-in V2.5 test tone
- timeline soundtrack preview sync
- soundtrack volume, timeline start offset, loop and include/exclude controls
- deterministic AAC-LC audio encoding for MP4
- exact-duration audio timeline generation at 48 kHz stereo
- MP4 mux containing deterministic H.264 video + AAC audio
- V2.4 video-only WebM/MP4 paths remain unchanged when no soundtrack is enabled
- 24 / 30 / 60 FPS targets
- landscape, TikTok/Reels/Shorts 9:16, square and lightweight social presets
- Draft / Standard / High / Master quality profiles
- exact `duration × FPS` final video-frame count
- pixel-perfect target dimensions
- cursor-free Pointer Lock capture guard
- tiny capture-handshake black-prefix cleanup
- hardware → neutral → software video encoder probing
- local browser rendering; project source and soundtrack are not uploaded to a render server

## V2.5 pipeline

```text
HTML / CSS / JS
or standalone HTML
or local project folder
      ↓
Local asset resolver
(images / fonts / CSS / JS / media)
      ↓
Sandboxed live preview
      ↓
Optional soundtrack
(volume / start / loop)
      ↓
Chrome: This Tab → Share
      ↓
Cursor-Free Gate
      ↓
Pixel-perfect raw capture
      ↓
Exact deterministic H.264 video frames
      +
Exact 48 kHz PCM soundtrack timeline
      ↓
WebCodecs
video → H.264 / AVC
audio → AAC-LC
      ↓
Fast-start MP4 mux
      ↓
MP4 with video + audio
```

## Audio behavior

When **Include** is enabled and a soundtrack is loaded, V2.5 automatically uses MP4/H.264 and adds AAC audio to the final file. The soundtrack is sampled against the same composition timeline rather than recorded from speakers or the screen-share audio path.

```text
Volume   → 0–100%
Start    → timeline second when soundtrack begins
Loop     → repeat soundtrack until composition duration ends
Include  → enable/disable soundtrack without deleting it
```

For a 6-second render, the audio timeline contains exactly `6 × 48000 = 288000` stereo sample frames before AAC encoding.

## Local assets and project folders

Use **+ Assets** to add local files referenced by the current HTML, or **Project Folder** to choose a whole local project directory. Project Folder prefers `index.html` and makes sibling relative assets available to the sandboxed preview without uploading them to a server.

V2.5 can resolve common HTML/CSS/JS references such as:

```text
./images/hero.png
assets/font.woff2
./styles/main.css
./scripts/app.js
video/intro.mp4
```

## Recommended first V2.5 validation

Use desktop Chrome:

```text
Resolution: 1080×1920 · TikTok / Reels / Shorts
FPS:        60
Format:     MP4 · H.264
Quality:    High
Duration:   6 seconds
Audio:      ♫ Test Tone
Volume:     90%
Start:      0.0 s
Loop:       ON
```

Press **Render video**, choose **This Tab**, press **Share**, then click **Lock cursor & continue**.

Expected target:

```text
Container     : MP4
Video         : H.264 / AVC
Audio         : AAC-LC
Resolution    : 1080×1920
Video frames  : 360 / 360
FPS           : deterministic 60
Audio rate    : 48 kHz stereo
Duration      : ~6.000 s
Black start   : none
Cursor        : absent
```

Diagnostics:

```js
hvDiagnostics()
hvCursorDiagnostics()
hvMp4Diagnostics()
hvV24Diagnostics()
hvV25Diagnostics()
```

## Current format note

V2.5 deterministic soundtrack muxing targets **MP4 + H.264 + AAC**. WebM remains available through the proven V2.4 video-only path. WebM/Opus soundtrack muxing can be added as a later parity step.

## Deployment

Cloudflare deploy command:

```bash
npx wrangler deploy
```

Static assets are served from `./public` through `wrangler.jsonc`.
