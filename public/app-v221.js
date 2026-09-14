/* HTML to Video Studio V2.2.1
   Deterministic hard-lock encoder.
   - No silent fallback to the V2.1 MediaRecorder normalizer.
   - Tries VP9/VP8 with hardware, neutral and software acceleration preferences.
   - Emits exact per-frame timestamps through WebCodecs + webm-muxer.
   - Exposes diagnostics at window.__HV_ENCODER_DIAGNOSTICS and window.__HV_LAST_RENDER.
*/

(() => {
  const diagnostics = {
    version: '2.2.1',
    supported: null,
    attempts: [],
    selected: null,
    lastError: null
  };
  window.__HV_ENCODER_DIAGNOSTICS = diagnostics;

  function patchLabels() {
    document.title = 'HTML to Video — Studio V2.2.1';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.2.1 · Deterministic Hard-Lock';
    const note = document.getElementById('renderStatus');
    if (note && !isRendering) {
      note.textContent = 'V2.2.1 hard-locks WebCodecs: no silent MediaRecorder fallback. 60 FPS × 6 s must produce exactly 360 timed frames.';
    }
    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start deterministic hard-lock render';
    const capability = document.getElementById('capabilityLabel');
    const ready = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined' && !!window.WebMMuxer?.Muxer && !!window.WebMMuxer?.ArrayBufferTarget;
    diagnostics.supported = ready;
    if (capability) {
      capability.innerHTML = ready
        ? '<span class="dot"></span>V2.2.1 hard-lock encoder ready'
        : 'V2.2.1 deterministic encoder unavailable';
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
        reject(new Error('Could not decode captured video'));
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
        reject(new Error(`Video seek failed at ${safe.toFixed(4)}s`));
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

  function isCaptureBlack(video, rect, probe) {
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
    if (!isCaptureBlack(video, rect, probe)) return 0;

    // Never remove more than 100 ms. This is only capture-handshake cleanup,
    // not authored black-intro detection.
    const maxFrames = Math.min(6, Math.max(2, Math.ceil(fps * 0.1)));
    for (let i = 1; i <= maxFrames; i += 1) {
      const t = i / fps;
      await seekVideoExact(video, t);
      if (!isCaptureBlack(video, rect, probe)) return t;
    }
    return 0;
  }

  function configAttempts(width, height, fps) {
    const baseBitrate = Math.max(8_000_000, Math.min(24_000_000, Math.round(width * height * fps * 0.11)));
    const bitrates = [...new Set([baseBitrate, 16_000_000, 12_000_000, 8_000_000].map(v => Math.max(6_000_000, Math.min(24_000_000, v))))];
    const codecs = [
      { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9', label: 'VP9' },
      { codec: 'vp8', muxerCodec: 'V_VP8', label: 'VP8' }
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

  async function selectEncoderConfigHardLock(width, height, fps) {
    diagnostics.attempts = [];
    diagnostics.selected = null;

    for (const candidate of configAttempts(width, height, fps)) {
      const config = {
        codec: candidate.codec,
        width,
        height,
        bitrate: candidate.bitrate,
        framerate: fps,
        latencyMode: 'quality',
        hardwareAcceleration: candidate.hardwareAcceleration
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

        // isConfigSupported can occasionally say yes while configure still fails
        // on a concrete GPU/driver. Probe a real encoder before selecting it.
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
          muxerCodec: candidate.muxerCodec,
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
      .filter(a => a.supported || a.error)
      .slice(-6)
      .map(a => `${a.codec}/${a.acceleration}/${Math.round(a.bitrate / 1e6)}Mbps:${a.error || 'configure failed'}`)
      .join(' | ');
    throw new Error(`No working VP9/VP8 WebCodecs config for ${width}×${height}@${fps}. ${brief}`);
  }

  async function deterministicHardLockWebM(rawBlob, options) {
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
      const selected = await selectEncoderConfigHardLock(width, height, fps);

      const capability = document.getElementById('capabilityLabel');
      if (capability) {
        capability.innerHTML = `<span class="dot"></span>${selected.codec} · ${selected.acceleration}`;
      }
      setProgress(63, `${selected.codec} ${selected.acceleration} · building ${totalFrames} exact frames…`);

      const target = new WebMMuxer.ArrayBufferTarget();
      const muxer = new WebMMuxer.Muxer({
        target,
        video: {
          codec: selected.muxerCodec,
          width,
          height,
          frameRate: fps
        },
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
      if (!ctx) throw new Error('Canvas 2D renderer unavailable');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      for (let i = 0; i < totalFrames; i += 1) {
        if (encoderError) throw encoderError;

        const timestamp = Math.round(i * 1_000_000 / fps);
        const nextTimestamp = Math.round((i + 1) * 1_000_000 / fps);
        const frameDuration = nextTimestamp - timestamp;
        const sourceLogicalTime = i / fps;
        const sourceTime = Math.min(
          Math.max(0, (video.duration || duration) - 0.001),
          artifactOffset + sourceLogicalTime
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
            `Hard-lock frame ${i + 1}/${totalFrames} · ${selected.codec} · ${selected.acceleration}${artifactOffset ? ` · trimmed ${Math.round(artifactOffset * 1000)}ms` : ''}`
          );
          await sleep(0);
        }
      }

      await encoder.flush();
      if (encoderError) throw encoderError;
      encoder.close();
      muxer.finalize();

      if (!target.buffer?.byteLength) throw new Error('WebM muxer returned an empty deterministic file');
      if (chunksEmitted < totalFrames) {
        throw new Error(`Encoder emitted only ${chunksEmitted}/${totalFrames} chunks`);
      }

      const blob = new Blob([target.buffer], { type: 'video/webm' });
      window.__HV_LAST_RENDER = {
        version: '2.2.1',
        mode: 'deterministic-hard-lock',
        width,
        height,
        fps,
        duration,
        expectedFrames: totalFrames,
        encodedChunks: chunksEmitted,
        artifactOffsetMs: Math.round(artifactOffset * 1000),
        codec: selected.codec,
        acceleration: selected.acceleration,
        bitrate: selected.bitrate,
        bytes: blob.size
      };

      showToast(`V2.2.1 hard-lock OK · ${totalFrames}/${totalFrames} frames · ${selected.codec}`, 5200);
      return {
        blob,
        mime: 'video/webm',
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
    const ready =
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      !!window.WebMMuxer?.Muxer &&
      !!window.WebMMuxer?.ArrayBufferTarget;

    if (!ready) {
      const missing = [
        typeof VideoEncoder === 'undefined' ? 'VideoEncoder' : null,
        typeof VideoFrame === 'undefined' ? 'VideoFrame' : null,
        !window.WebMMuxer?.Muxer ? 'WebMMuxer.Muxer' : null,
        !window.WebMMuxer?.ArrayBufferTarget ? 'WebMMuxer.ArrayBufferTarget' : null
      ].filter(Boolean).join(', ');
      const error = new Error(`V2.2.1 hard-lock unavailable: missing ${missing}`);
      diagnostics.lastError = error.message;
      throw error;
    }

    try {
      diagnostics.lastError = null;
      setProgress(62, `V2.2.1 deterministic hard-lock · probing VP9/VP8 encoders…`);
      return await deterministicHardLockWebM(rawBlob, options);
    } catch (error) {
      diagnostics.lastError = error?.message || String(error);
      console.error('V2.2.1 deterministic hard-lock failed:', error, diagnostics);
      const capability = document.getElementById('capabilityLabel');
      if (capability) capability.textContent = 'V2.2.1 deterministic FAILED';
      showToast(`DETERMINISTIC FAILED: ${error?.message || error}`, 9000);
      throw error;
    }
  };

  // Make the diagnostic state easy to inspect without pasting a long script.
  window.hvDiagnostics = () => ({
    capabilities: {
      secureContext: window.isSecureContext,
      videoEncoder: typeof VideoEncoder !== 'undefined',
      videoFrame: typeof VideoFrame !== 'undefined',
      webmMuxer: !!window.WebMMuxer?.Muxer,
      webmTarget: !!window.WebMMuxer?.ArrayBufferTarget
    },
    encoder: window.__HV_ENCODER_DIAGNOSTICS,
    lastRender: window.__HV_LAST_RENDER || null
  });

  patchLabels();
})();
