/* HTML to Video Studio V2.3
   Deterministic MP4 / H.264 export.
   - Keeps V2.2.2 cursor-free capture and WebM hard-lock path untouched.
   - When MP4 is selected, rebuilds the final file at exact frame timestamps with
     WebCodecs H.264 + mp4-muxer.
   - No silent fallback to WebM for an MP4 request: unsupported H.264 fails visibly.
*/

(() => {
  const VERSION = '2.3';
  const originalNormalize = normalizeToExactResolution;

  const diagnostics = {
    version: VERSION,
    supported: null,
    attempts: [],
    selected: null,
    lastError: null,
    lastRender: null
  };
  window.__HV_MP4_DIAGNOSTICS = diagnostics;

  function patchLabels() {
    document.title = 'HTML to Video — Studio V2.3';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.3 · WebM + MP4 Hard-Lock';

    const note = document.getElementById('renderStatus');
    if (note && !isRendering) {
      note.textContent = 'V2.3 keeps exact WebM hard-lock and adds deterministic MP4/H.264 export with the same duration × FPS frame count.';
    }

    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start deterministic video render';

    const format = document.getElementById('formatSelect');
    if (format) {
      const mp4 = [...format.options].find(option => option.value === 'mp4');
      if (mp4) mp4.textContent = 'MP4 · H.264';
      const webm = [...format.options].find(option => option.value === 'webm');
      if (webm) webm.textContent = 'WebM · VP9/VP8';
    }

    const capability = document.getElementById('capabilityLabel');
    const ready =
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      !!window.Mp4Muxer?.Muxer &&
      !!window.Mp4Muxer?.ArrayBufferTarget;
    diagnostics.supported = ready;
    if (capability && ready) {
      capability.innerHTML = '<span class="dot"></span>V2.3 WebM + MP4 encoder ready';
    }

    const fine = document.querySelector('#captureModal .fineprint');
    if (fine) {
      fine.innerHTML = 'Requested output: <span id="modalFormat">WEBM · 1920×1080</span> · <span id="modalDuration">6 seconds</span>. WebM uses the proven VP9/VP8 deterministic hard-lock path. MP4 uses deterministic H.264/AVC WebCodecs + MP4 muxing. Both require the exact duration × FPS frame count and keep the cursor-free capture guard.';
    }
  }

  async function waitVideoReady(video) {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return;
    await new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        video.removeEventListener('loadeddata', onReady);
        video.removeEventListener('canplay', onReady);
        video.removeEventListener('error', onError);
      };
      const onReady = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('Could not decode captured video for MP4 pass'));
      };
      video.addEventListener('loadeddata', onReady, { once: true });
      video.addEventListener('canplay', onReady, { once: true });
      video.addEventListener('error', onError, { once: true });
    });
  }

  async function seekVideoExact(video, time) {
    const duration = Number.isFinite(video.duration) ? video.duration : time + 0.05;
    const safe = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));
    if (Math.abs((video.currentTime || 0) - safe) < 0.00025 && video.readyState >= 2) return;

    await new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', fail);
        resolve();
      };
      const fail = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        video.removeEventListener('seeked', finish);
        video.removeEventListener('error', fail);
        reject(new Error(`MP4 source seek failed at ${safe.toFixed(4)}s`));
      };
      const timer = setTimeout(finish, 1600);
      video.addEventListener('seeked', finish, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.currentTime = safe;
    });
  }

  function makeProbeCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 80;
    canvas.height = 45;
    return canvas;
  }

  function looksLikeHandshakeBlack(video, rect, probe) {
    const ctx = probe.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, probe.width, probe.height);
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let energy = 0;
    let lit = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const y = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      energy += y;
      if (y > 8) lit += 1;
    }
    return (energy / pixels) < 2.4 && (lit / pixels) < 0.01;
  }

  async function detectTinyBlackPrefix(video, rect, fps) {
    const probe = makeProbeCanvas();
    await seekVideoExact(video, 0);
    if (!looksLikeHandshakeBlack(video, rect, probe)) return 0;

    const maxFrames = Math.min(6, Math.max(2, Math.ceil(fps * 0.1)));
    for (let i = 1; i <= maxFrames; i += 1) {
      const t = i / fps;
      await seekVideoExact(video, t);
      if (!looksLikeHandshakeBlack(video, rect, probe)) return t;
    }
    return 0;
  }

  function h264Attempts(width, height, fps) {
    const baseBitrate = Math.max(8_000_000, Math.min(28_000_000, Math.round(width * height * fps * 0.12)));
    const bitrates = [...new Set([baseBitrate, 20_000_000, 16_000_000, 12_000_000, 8_000_000]
      .map(value => Math.max(6_000_000, Math.min(28_000_000, value))))];

    // Level 4.2 handles the 1080p60 preset. Lower-level profiles are retained as
    // compatibility probes for smaller presets / browser encoder quirks.
    const codecs = [
      { codec: 'avc1.64002A', label: 'H.264 High L4.2' },
      { codec: 'avc1.4D402A', label: 'H.264 Main L4.2' },
      { codec: 'avc1.42E02A', label: 'H.264 Baseline L4.2' },
      { codec: 'avc1.640029', label: 'H.264 High L4.1' },
      { codec: 'avc1.4D4029', label: 'H.264 Main L4.1' },
      { codec: 'avc1.42E029', label: 'H.264 Baseline L4.1' }
    ];
    const accelerations = ['prefer-hardware', 'no-preference', 'prefer-software'];
    const attempts = [];
    for (const candidate of codecs) {
      for (const hardwareAcceleration of accelerations) {
        for (const bitrate of bitrates) {
          attempts.push({ ...candidate, hardwareAcceleration, bitrate });
        }
      }
    }
    return attempts;
  }

  async function selectH264Config(width, height, fps) {
    diagnostics.attempts = [];
    diagnostics.selected = null;

    for (const candidate of h264Attempts(width, height, fps)) {
      const config = {
        codec: candidate.codec,
        width,
        height,
        bitrate: candidate.bitrate,
        framerate: fps,
        latencyMode: 'quality',
        hardwareAcceleration: candidate.hardwareAcceleration,
        avc: { format: 'avc' }
      };
      const record = {
        codec: candidate.label,
        codecString: candidate.codec,
        acceleration: candidate.hardwareAcceleration,
        bitrate: candidate.bitrate,
        supported: false,
        configureProbe: false,
        error: null
      };

      try {
        const support = await VideoEncoder.isConfigSupported(config);
        if (!support?.supported) {
          diagnostics.attempts.push(record);
          continue;
        }
        record.supported = true;
        const supportedConfig = { ...config, ...(support.config || {}) };

        let probeError = null;
        const probe = new VideoEncoder({
          output: () => {},
          error: error => { probeError = error; }
        });
        try {
          probe.configure(supportedConfig);
          await Promise.resolve();
          if (probeError) throw probeError;
          record.configureProbe = true;
          probe.close();
        } catch (error) {
          try { probe.close(); } catch (_) {}
          record.error = error?.message || String(error);
          diagnostics.attempts.push(record);
          continue;
        }

        diagnostics.attempts.push(record);
        diagnostics.selected = {
          codec: candidate.label,
          codecString: candidate.codec,
          acceleration: candidate.hardwareAcceleration,
          bitrate: candidate.bitrate,
          config: supportedConfig
        };
        return diagnostics.selected;
      } catch (error) {
        record.error = error?.message || String(error);
        diagnostics.attempts.push(record);
      }
    }

    const brief = diagnostics.attempts
      .filter(item => item.supported || item.error)
      .slice(-8)
      .map(item => `${item.codec}/${item.acceleration}/${Math.round(item.bitrate / 1e6)}Mbps:${item.error || 'configure failed'}`)
      .join(' | ');
    throw new Error(`No working H.264 WebCodecs encoder for ${width}×${height}@${fps}. ${brief}`);
  }

  async function deterministicMp4(rawBlob, options) {
    const { width, height, fps, isolated, geometry, duration } = options;
    const totalFrames = Math.max(1, Math.round(duration * fps));
    const sourceURL = URL.createObjectURL(rawBlob);
    const video = document.createElement('video');
    video.src = sourceURL;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    try {
      await waitVideoReady(video);
      const rect = sourceRectForVideo(video, geometry, isolated, { width, height });
      const artifactOffset = await detectTinyBlackPrefix(video, rect, fps);
      const selected = await selectH264Config(width, height, fps);

      const capability = document.getElementById('capabilityLabel');
      if (capability) {
        capability.innerHTML = `<span class="dot"></span>${selected.codec} · ${selected.acceleration}`;
      }
      setProgress(63, `${selected.codec} · building ${totalFrames} exact MP4 frames…`);

      const target = new Mp4Muxer.ArrayBufferTarget();
      const muxer = new Mp4Muxer.Muxer({
        target,
        video: {
          codec: 'avc',
          width,
          height,
          frameRate: fps
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'strict'
      });

      let encoderError = null;
      let chunksEmitted = 0;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => {
          chunksEmitted += 1;
          muxer.addVideoChunk(chunk, meta);
        },
        error: error => { encoderError = error; }
      });
      encoder.configure(selected.config);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx) throw new Error('Canvas 2D renderer unavailable for MP4 pass');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      for (let i = 0; i < totalFrames; i += 1) {
        if (encoderError) throw encoderError;

        const timestamp = Math.round(i * 1_000_000 / fps);
        const nextTimestamp = Math.round((i + 1) * 1_000_000 / fps);
        const frameDuration = nextTimestamp - timestamp;
        const sourceTime = Math.min(
          Math.max(0, (video.duration || duration) - 0.001),
          artifactOffset + (i / fps)
        );

        await seekVideoExact(video, sourceTime);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);

        const frame = new VideoFrame(canvas, {
          timestamp,
          duration: frameDuration,
          alpha: 'discard'
        });
        encoder.encode(frame, {
          keyFrame: i === 0 || i % Math.max(1, fps * 2) === 0
        });
        frame.close();

        while (encoder.encodeQueueSize > 8) {
          if (encoderError) throw encoderError;
          await sleep(1);
        }

        if (i % Math.max(1, Math.round(fps / 4)) === 0 || i === totalFrames - 1) {
          const ratio = (i + 1) / totalFrames;
          setProgress(
            64 + ratio * 34,
            `MP4 hard-lock frame ${i + 1}/${totalFrames} · ${selected.codec}${artifactOffset ? ` · trimmed ${Math.round(artifactOffset * 1000)}ms` : ''}`
          );
          await sleep(0);
        }
      }

      await encoder.flush();
      if (encoderError) throw encoderError;
      encoder.close();
      muxer.finalize();

      if (!target.buffer?.byteLength) throw new Error('MP4 muxer returned an empty file');
      if (chunksEmitted < totalFrames) {
        throw new Error(`H.264 encoder emitted only ${chunksEmitted}/${totalFrames} chunks`);
      }

      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      const cursor = window.__HV_CURSOR_DIAGNOSTICS || {};
      const renderMeta = {
        version: VERSION,
        mode: 'deterministic-mp4-hard-lock',
        container: 'mp4',
        codec: selected.codec,
        codecString: selected.codecString,
        acceleration: selected.acceleration,
        bitrate: selected.bitrate,
        width,
        height,
        fps,
        duration,
        expectedFrames: totalFrames,
        encodedChunks: chunksEmitted,
        artifactOffsetMs: Math.round(artifactOffset * 1000),
        cursorFree: !cursor.lockLostDuringCapture,
        pointerLockUsed: !!cursor.lockAcquired,
        bytes: blob.size
      };
      diagnostics.lastRender = renderMeta;
      window.__HV_LAST_RENDER = renderMeta;

      showToast(`V2.3 MP4 OK · ${totalFrames}/${totalFrames} frames · ${selected.codec}`, 5200);
      return {
        blob,
        mime: 'video/mp4',
        frameCount: totalFrames,
        encodedChunks: chunksEmitted,
        artifactOffset,
        hardLock: true,
        encoder: selected
      };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(sourceURL);
    }
  }

  normalizeToExactResolution = async function(rawBlob, options) {
    if (options.requested !== 'mp4') {
      return originalNormalize(rawBlob, options);
    }

    diagnostics.lastError = null;
    const cursor = window.__HV_CURSOR_DIAGNOSTICS;
    if (cursor?.lockLostDuringCapture) {
      const error = new Error('MP4 hard-lock aborted: Pointer Lock was released during capture');
      diagnostics.lastError = error.message;
      throw error;
    }

    const ready =
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      !!window.Mp4Muxer?.Muxer &&
      !!window.Mp4Muxer?.ArrayBufferTarget;

    if (!ready) {
      const missing = [
        typeof VideoEncoder === 'undefined' ? 'VideoEncoder' : null,
        typeof VideoFrame === 'undefined' ? 'VideoFrame' : null,
        !window.Mp4Muxer?.Muxer ? 'Mp4Muxer.Muxer' : null,
        !window.Mp4Muxer?.ArrayBufferTarget ? 'Mp4Muxer.ArrayBufferTarget' : null
      ].filter(Boolean).join(', ');
      const error = new Error(`V2.3 MP4 unavailable: missing ${missing}`);
      diagnostics.lastError = error.message;
      throw error;
    }

    try {
      setProgress(62, 'V2.3 deterministic MP4 · probing H.264 encoders…');
      return await deterministicMp4(rawBlob, options);
    } catch (error) {
      diagnostics.lastError = error?.message || String(error);
      console.error('V2.3 deterministic MP4 failed:', error, diagnostics);
      const capability = document.getElementById('capabilityLabel');
      if (capability) capability.textContent = 'V2.3 MP4 encoder failed';
      throw error;
    }
  };

  window.hvMp4Diagnostics = () => ({
    ...diagnostics,
    attempts: diagnostics.attempts.map(item => ({ ...item })),
    selected: diagnostics.selected ? { ...diagnostics.selected, config: { ...diagnostics.selected.config } } : null,
    lastRender: diagnostics.lastRender ? { ...diagnostics.lastRender } : null
  });

  patchLabels();
})();
