/* HTML to Video Studio V2.2
   Deterministic offline normalization using WebCodecs + webm-muxer.
   Keeps V2.1 capture/isolation flow, but replaces the final canvas MediaRecorder
   pass with exact-timestamp VideoFrame encoding when the browser supports it.
*/

(() => {
  const v21Normalize = normalizeToExactResolution;
  const v21ShowToast = showToast;

  function patchVersionLabels() {
    document.title = 'HTML to Video — Studio V2.2';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.2 · Deterministic Frame Clock';
    const note = document.getElementById('renderStatus');
    if (note && !isRendering) note.textContent = 'V2.2 uses exact WebCodecs timestamps for the final frame clock. 60 FPS = exactly 360 frames for 6 seconds.';
    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start deterministic browser render';
    const capability = document.getElementById('capabilityLabel');
    const ready = typeof VideoEncoder !== 'undefined' && !!window.WebMMuxer;
    if (capability && ready) capability.innerHTML = '<span class="dot"></span>V2.2 deterministic encoder ready';
  }

  showToast = function(message, ms = 2200) {
    v21ShowToast(String(message).replaceAll('V2.1', 'V2.2'), ms);
  };

  async function waitVideoReady(video) {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return;
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error('Could not decode captured video')); };
      const cleanup = () => {
        video.removeEventListener('loadeddata', ok);
        video.removeEventListener('error', bad);
      };
      video.addEventListener('loadeddata', ok, { once: true });
      video.addEventListener('error', bad, { once: true });
    });
  }

  async function seekVideo(video, time) {
    const safe = Math.max(0, Math.min(time, Math.max(0, (video.duration || time + 0.01) - 0.001)));
    if (Math.abs((video.currentTime || 0) - safe) < 0.0005 && video.readyState >= 2) return;
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
        reject(new Error('Video seek failed'));
      };
      const timer = setTimeout(finish, 1200);
      video.addEventListener('seeked', finish, { once: true });
      video.addEventListener('error', fail, { once: true });
      video.currentTime = safe;
    });
  }

  function makeSampleCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 36;
    return canvas;
  }

  function frameLooksLikeCaptureBlack(video, rect, canvas) {
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    let energy = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      const y = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      energy += y;
      if (y > 7) lit += 1;
    }
    const mean = energy / pixels;
    return mean < 2.2 && lit / pixels < 0.008;
  }

  async function detectCaptureArtifactOffset(video, rect, fps) {
    // Only remove a tiny all-black prefix caused by the capture/encoder handshake.
    // We intentionally cap this to ~67 ms so an authored black intro is preserved.
    const probe = makeSampleCanvas();
    await seekVideo(video, 0);
    if (!frameLooksLikeCaptureBlack(video, rect, probe)) return 0;

    const maxFrames = Math.min(4, Math.max(2, Math.ceil(fps * 0.067)));
    for (let i = 1; i <= maxFrames; i += 1) {
      const t = i / fps;
      await seekVideo(video, t);
      if (!frameLooksLikeCaptureBlack(video, rect, probe)) return t;
    }
    return 0;
  }

  async function selectEncoderConfig(width, height, fps, bitrate) {
    const candidates = [
      { codec: 'vp09.00.10.08', muxerCodec: 'V_VP9' },
      { codec: 'vp8', muxerCodec: 'V_VP8' }
    ];
    for (const candidate of candidates) {
      try {
        const config = {
          codec: candidate.codec,
          width,
          height,
          bitrate,
          framerate: fps,
          latencyMode: 'quality',
          hardwareAcceleration: 'prefer-hardware'
        };
        const result = await VideoEncoder.isConfigSupported(config);
        if (result?.supported) return { ...candidate, config: result.config || config };
      } catch (_) {}
    }
    return null;
  }

  async function deterministicWebM(rawBlob, options) {
    const { width, height, fps, isolated, geometry, duration } = options;
    const sourceURL = URL.createObjectURL(rawBlob);
    const video = document.createElement('video');
    video.src = sourceURL;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';

    try {
      await waitVideoReady(video);

      const rect = sourceRectForVideo(video, geometry, isolated, { width, height });
      const artifactOffset = await detectCaptureArtifactOffset(video, rect, fps);
      const totalFrames = Math.max(1, Math.round(duration * fps));
      const bitrate = Math.max(8_000_000, Math.min(28_000_000, Math.round(width * height * fps * 0.14)));
      const selected = await selectEncoderConfig(width, height, fps, bitrate);
      if (!selected) throw new Error('VP9/VP8 WebCodecs encoder is unavailable');

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
      const encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
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
        const logicalTime = i / fps;
        const sourceTime = Math.min(
          Math.max(0, (video.duration || duration) - 0.001),
          artifactOffset + logicalTime
        );

        await seekVideo(video, sourceTime);
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, width, height);

        const frame = new VideoFrame(canvas, {
          timestamp,
          duration: frameDuration,
          alpha: 'discard'
        });
        encoder.encode(frame, { keyFrame: i === 0 || i % Math.max(1, fps * 2) === 0 });
        frame.close();

        while (encoder.encodeQueueSize > 10) await sleep(1);
        if (i % Math.max(1, Math.round(fps / 2)) === 0 || i === totalFrames - 1) {
          const ratio = (i + 1) / totalFrames;
          setProgress(
            64 + ratio * 34,
            `Deterministic frame ${i + 1}/${totalFrames} · ${fps} FPS · ${width}×${height}${artifactOffset ? ` · trimmed ${Math.round(artifactOffset * 1000)}ms capture artifact` : ''}`
          );
          await sleep(0);
        }
      }

      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;
      muxer.finalize();

      if (!target.buffer?.byteLength) throw new Error('Deterministic WebM muxer returned an empty file');
      return {
        blob: new Blob([target.buffer], { type: 'video/webm' }),
        mime: 'video/webm',
        frameCount: totalFrames,
        artifactOffset
      };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(sourceURL);
    }
  }

  normalizeToExactResolution = async function(rawBlob, options) {
    const canDeterministic =
      typeof VideoEncoder !== 'undefined' &&
      typeof VideoFrame !== 'undefined' &&
      !!window.WebMMuxer?.Muxer &&
      !!window.WebMMuxer?.ArrayBufferTarget;

    // V2.2 deterministic path exports WebM. Keep the V2.1 normalizer as a
    // compatibility fallback for browsers without WebCodecs or the muxer.
    if (!canDeterministic) {
      showToast('Deterministic WebCodecs unavailable — using V2.1 compatibility encoder', 4200);
      return v21Normalize(rawBlob, options);
    }

    try {
      setProgress(63, `Building exact ${options.fps} FPS frame clock…`);
      return await deterministicWebM(rawBlob, options);
    } catch (error) {
      console.warn('V2.2 deterministic encoder failed, falling back to V2.1:', error);
      showToast(`V2.2 fallback: ${error?.message || error}`, 4600);
      return v21Normalize(rawBlob, options);
    }
  };

  const originalUpdateCapability = updateCapability;
  updateCapability = function() {
    originalUpdateCapability();
    const capability = document.getElementById('capabilityLabel');
    if (!capability) return;
    if (typeof VideoEncoder !== 'undefined' && window.WebMMuxer) {
      capability.innerHTML = '<span class="dot"></span>V2.2 deterministic encoder ready';
    }
  };

  patchVersionLabels();
  updateCapability();
})();
