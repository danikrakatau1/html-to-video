/* HTML to Video Studio V2.5
   Audio + Local Asset Pipeline.
   - Keeps V2.4 video-only deterministic paths untouched when no audio track is enabled.
   - Adds deterministic AAC audio muxing to MP4/H.264 exports.
   - Adds timeline audio controls (volume, start offset, loop, preview sync).
   - Adds local asset files and project-folder import with relative-asset rewriting.
*/

(() => {
  const VERSION = '2.5';
  const previousNormalize = normalizeToExactResolution;
  const previousCompose = composeDocument;

  const state = {
    version: VERSION,
    assets: new Map(),
    assetRecords: new Set(),
    project: null,
    audio: {
      file: null,
      name: null,
      buffer: null,
      previewUrl: null,
      enabled: true,
      volume: 0.9,
      startAt: 0,
      loop: true
    },
    lastAudioConfig: null,
    lastRender: null,
    lastError: null
  };
  window.__HV_V25_DIAGNOSTICS = state;

  const previewAudio = document.createElement('audio');
  previewAudio.id = 'hvV25PreviewAudio';
  previewAudio.preload = 'auto';
  previewAudio.hidden = true;
  document.body.appendChild(previewAudio);

  const textExtensions = new Set(['css', 'js', 'mjs', 'json', 'svg', 'txt', 'xml', 'html', 'htm']);

  function escRE(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function safeAttr(value) {
    return String(value).replace(/[&<>\"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function ext(name = '') {
    const clean = String(name).split(/[?#]/)[0];
    const index = clean.lastIndexOf('.');
    return index >= 0 ? clean.slice(index + 1).toLowerCase() : '';
  }

  function normalizePath(path = '') {
    return String(path)
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\//, '')
      .replace(/\/+/g, '/');
  }

  function aliasesForFile(file, projectRoot = '') {
    const aliases = new Set();
    const name = normalizePath(file.name);
    if (name) {
      aliases.add(name);
      aliases.add(`./${name}`);
    }

    const rawRelative = normalizePath(file.webkitRelativePath || '');
    if (rawRelative) {
      aliases.add(rawRelative);
      aliases.add(`./${rawRelative}`);
      const root = normalizePath(projectRoot);
      if (root && rawRelative.startsWith(`${root}/`)) {
        const relative = rawRelative.slice(root.length + 1);
        if (relative) {
          aliases.add(relative);
          aliases.add(`./${relative}`);
        }
      }
    }
    return [...aliases];
  }

  function readDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function ingestAsset(file, projectRoot = '') {
    const dataURL = await readDataURL(file);
    const extension = ext(file.name);
    const text = textExtensions.has(extension) ? await file.text() : null;
    const record = {
      name: file.name,
      type: file.type || '',
      bytes: file.size,
      extension,
      dataURL,
      text,
      aliases: aliasesForFile(file, projectRoot)
    };
    state.assetRecords.add(record);
    for (const alias of record.aliases) state.assets.set(normalizePath(alias), record);
    return record;
  }

  async function ingestAssets(files, { projectRoot = '' } = {}) {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return [];
    setAssetStatus(`Loading ${list.length} local asset${list.length === 1 ? '' : 's'}…`);
    const records = [];
    for (const file of list) {
      try {
        records.push(await ingestAsset(file, projectRoot));
      } catch (error) {
        console.warn('V2.5 asset import failed:', file?.name, error);
      }
    }
    updateAssetUI();
    renderPreview({ silent: true });
    showToast(`V2.5 loaded ${records.length} local asset${records.length === 1 ? '' : 's'}`, 3600);
    return records;
  }

  function replaceAssetReference(text, alias, replacement) {
    const escaped = escRE(alias);
    let out = text;

    // HTML resource attributes.
    out = out.replace(
      new RegExp(`((?:src|href|poster)\\s*=\\s*["'])${escaped}(["'])`, 'gi'),
      `$1${replacement}$2`
    );

    // CSS url(...) resources.
    out = out.replace(
      new RegExp(`url\\(\\s*(["']?)${escaped}\\1\\s*\\)`, 'gi'),
      `url("${replacement}")`
    );

    // Common JS/CSS quoted path use.
    out = out.replace(
      new RegExp(`(["'])${escaped}\\1`, 'g'),
      `$1${replacement}$1`
    );
    return out;
  }

  function inlineTextDependencies(documentText) {
    let out = documentText;
    for (const record of state.assetRecords) {
      if (!record.text) continue;
      for (const aliasRaw of record.aliases) {
        const alias = normalizePath(aliasRaw);
        const escaped = escRE(alias);
        if (record.extension === 'css') {
          const linkRE = new RegExp(`<link\\b[^>]*\\bhref\\s*=\\s*["']${escaped}["'][^>]*>`, 'gi');
          out = out.replace(linkRE, `<style data-hv-v25-asset="${safeAttr(record.name)}">${record.text}</style>`);
        } else if (record.extension === 'js' || record.extension === 'mjs') {
          const scriptRE = new RegExp(`<script\\b[^>]*\\bsrc\\s*=\\s*["']${escaped}["'][^>]*>\\s*<\\/script>`, 'gi');
          out = out.replace(scriptRE, `<script data-hv-v25-asset="${safeAttr(record.name)}">${record.text}<\\/script>`);
        }
      }
    }
    return out;
  }

  function applyLocalAssets(documentText) {
    let out = inlineTextDependencies(documentText);
    const pairs = [];
    for (const record of state.assetRecords) {
      for (const alias of record.aliases) pairs.push([normalizePath(alias), record.dataURL]);
    }
    // Longest aliases first so assets/foo.png wins before foo.png.
    pairs.sort((a, b) => b[0].length - a[0].length);
    for (const [alias, dataURL] of pairs) {
      if (!alias || !dataURL) continue;
      out = replaceAssetReference(out, alias, dataURL);
      out = replaceAssetReference(out, `./${alias}`, dataURL);
    }
    return out;
  }

  composeDocument = function() {
    return applyLocalAssets(previousCompose());
  };

  function setAssetStatus(message) {
    const info = document.getElementById('hvAssetInfo');
    if (info) info.textContent = message;
  }

  function updateAssetUI() {
    const info = document.getElementById('hvAssetInfo');
    if (!info) return;
    const count = state.assetRecords.size;
    info.textContent = state.project
      ? `${state.project.name} · ${count} assets`
      : `${count} local asset${count === 1 ? '' : 's'}`;
  }

  async function importProjectFolder(files) {
    const list = [...(files || [])].filter(Boolean);
    if (!list.length) return;
    const htmlFiles = list.filter(file => /\.html?$/i.test(file.name));
    const entry = htmlFiles.find(file => /^index\.html?$/i.test(file.name)) || htmlFiles[0];
    if (!entry) {
      showToast('Project folder needs an index.html or another .html file', 4200);
      return;
    }

    state.assets.clear();
    state.assetRecords.clear();

    const rawEntryPath = normalizePath(entry.webkitRelativePath || entry.name);
    const root = rawEntryPath.includes('/') ? rawEntryPath.split('/')[0] : '';
    const assets = list.filter(file => file !== entry);
    await ingestAssets(assets, { projectRoot: root });

    editors.html.value = await entry.text();
    editors.css.value = '';
    editors.js.value = '';
    state.project = {
      name: root || entry.name,
      entry: entry.name,
      files: list.length,
      assets: assets.length
    };
    setTab('html');
    updateAssetUI();
    renderPreview({ silent: true });
    showToast(`Project loaded · ${entry.name} + ${assets.length} assets`, 4400);
  }

  async function decodeAudioFile(file) {
    if (!file) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio API unavailable');
      const ctx = new AudioCtx();
      const bytes = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(bytes.slice(0));
      try { await ctx.close(); } catch (_) {}

      if (state.audio.previewUrl) URL.revokeObjectURL(state.audio.previewUrl);
      state.audio.file = file;
      state.audio.name = file.name;
      state.audio.buffer = decoded;
      state.audio.previewUrl = URL.createObjectURL(file);
      previewAudio.src = state.audio.previewUrl;
      previewAudio.loop = state.audio.loop;
      previewAudio.volume = state.audio.volume;

      // Also expose the selected soundtrack as a local asset by its filename.
      try { await ingestAsset(file); } catch (_) {}

      const format = document.getElementById('formatSelect');
      if (format && format.value !== 'mp4') {
        format.value = 'mp4';
        format.dispatchEvent(new Event('change', { bubbles: true }));
      }
      updateAudioUI();
      showToast(`Audio loaded · ${file.name} · ${decoded.duration.toFixed(1)}s`, 4200);
    } catch (error) {
      state.lastError = error?.message || String(error);
      console.error('V2.5 audio decode failed:', error);
      showToast(`Audio load failed: ${state.lastError}`, 5200);
    }
  }

  function wavTestToneFile() {
    const sampleRate = 48000;
    const duration = 8;
    const channels = 2;
    const frames = sampleRate * duration;
    const dataBytes = frames * channels * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const write = (offset, text) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
    write(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    write(36, 'data');
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < frames; i += 1) {
      const t = i / sampleRate;
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t);
      const env = Math.min(1, t * 4) * Math.min(1, (duration - t) * 3);
      const sample = (
        Math.sin(2 * Math.PI * 220 * t) * 0.20 +
        Math.sin(2 * Math.PI * 330 * t) * 0.12 +
        Math.sin(2 * Math.PI * 440 * t) * 0.08 * pulse
      ) * env;
      const pcm = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
      view.setInt16(offset, pcm, true); offset += 2;
      view.setInt16(offset, pcm, true); offset += 2;
    }
    return new File([buffer], 'v25-test-tone.wav', { type: 'audio/wav' });
  }

  function clearAudio() {
    previewAudio.pause();
    previewAudio.removeAttribute('src');
    if (state.audio.previewUrl) URL.revokeObjectURL(state.audio.previewUrl);
    state.audio.file = null;
    state.audio.name = null;
    state.audio.buffer = null;
    state.audio.previewUrl = null;
    updateAudioUI();
    showToast('Audio track cleared');
  }

  function audioControls() {
    return {
      enabled: !!document.getElementById('hvAudioEnabled')?.checked,
      volume: Math.max(0, Math.min(1, Number(document.getElementById('hvAudioVolume')?.value || 90) / 100)),
      startAt: Math.max(0, Number(document.getElementById('hvAudioStart')?.value || 0)),
      loop: !!document.getElementById('hvAudioLoop')?.checked
    };
  }

  function updateAudioStateFromUI() {
    const controls = audioControls();
    Object.assign(state.audio, controls);
    previewAudio.volume = controls.volume;
    previewAudio.loop = controls.loop;
    updateAudioUI();
  }

  function updateAudioUI() {
    const name = document.getElementById('hvAudioName');
    const meta = document.getElementById('hvAudioMeta');
    if (name) name.textContent = state.audio.name || 'No soundtrack';
    if (meta) {
      const duration = state.audio.buffer?.duration;
      meta.textContent = duration
        ? `${duration.toFixed(1)}s · ${state.audio.buffer.sampleRate} Hz · ${state.audio.buffer.numberOfChannels}ch`
        : 'MP4/AAC deterministic audio';
    }
  }

  function previewSourceTime(timelineSeconds) {
    const buffer = state.audio.buffer;
    if (!buffer) return null;
    const { startAt, loop } = audioControls();
    let value = timelineSeconds - startAt;
    if (value < 0) return null;
    if (loop && buffer.duration > 0) value %= buffer.duration;
    else if (value >= buffer.duration) return null;
    return Math.max(0, value);
  }

  function syncPreviewAudio() {
    if (!state.audio.buffer || !state.audio.previewUrl) return;
    const controls = audioControls();
    previewAudio.volume = controls.volume;
    previewAudio.loop = controls.loop;
    if (!controls.enabled) {
      previewAudio.pause();
      return;
    }

    const timeline = Number(scrub.value || 0) / 1000;
    const source = previewSourceTime(timeline);
    if (source == null) {
      previewAudio.pause();
      return;
    }
    if (Math.abs((previewAudio.currentTime || 0) - source) > 0.09) {
      try { previewAudio.currentTime = source; } catch (_) {}
    }
    if (isPlaying) previewAudio.play().catch(() => {});
    else previewAudio.pause();
  }

  const oldPlayTick = playTick;
  playTick = function(now) {
    oldPlayTick(now);
    syncPreviewAudio();
  };

  function ensureUI() {
    const bottom = document.querySelector('.bottom-panel');
    if (!bottom || document.getElementById('hvV25Panel')) return;

    const panel = document.createElement('div');
    panel.id = 'hvV25Panel';
    panel.className = 'hv-v25-panel';
    panel.innerHTML = `
      <div class="hv-v25-group hv-v25-assets">
        <div class="hv-v25-heading"><strong>Local Assets</strong><span id="hvAssetInfo">0 local assets</span></div>
        <div class="hv-v25-actions">
          <button class="btn" id="hvAddAssets">＋ Assets</button>
          <button class="btn" id="hvProjectFolder">▣ Project Folder</button>
          <span class="hv-v25-hint">images · fonts · CSS · JS · video · audio</span>
        </div>
      </div>
      <div class="hv-v25-group hv-v25-audio">
        <div class="hv-v25-heading"><strong>Soundtrack</strong><span id="hvAudioMeta">MP4/AAC deterministic audio</span></div>
        <div class="hv-v25-actions hv-v25-audio-controls">
          <button class="btn" id="hvAddAudio">♪ Add Audio</button>
          <button class="btn" id="hvTestTone">♫ Test Tone</button>
          <button class="btn" id="hvClearAudio">Clear</button>
          <span class="hv-v25-audio-name" id="hvAudioName">No soundtrack</span>
          <label><input type="checkbox" id="hvAudioEnabled" checked> Include</label>
          <label>Vol <input type="range" id="hvAudioVolume" min="0" max="100" value="90"></label>
          <label>Start <input class="control hv-v25-number" id="hvAudioStart" type="number" min="0" max="120" step="0.1" value="0">s</label>
          <label><input type="checkbox" id="hvAudioLoop" checked> Loop</label>
        </div>
      </div>`;
    bottom.parentNode.insertBefore(panel, bottom);

    const assetInput = document.createElement('input');
    assetInput.type = 'file';
    assetInput.multiple = true;
    assetInput.id = 'hvAssetInput';
    assetInput.hidden = true;
    document.body.appendChild(assetInput);

    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.multiple = true;
    folderInput.id = 'hvProjectFolderInput';
    folderInput.hidden = true;
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
    document.body.appendChild(folderInput);

    const audioInput = document.createElement('input');
    audioInput.type = 'file';
    audioInput.accept = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac';
    audioInput.id = 'hvAudioInput';
    audioInput.hidden = true;
    document.body.appendChild(audioInput);

    document.getElementById('hvAddAssets')?.addEventListener('click', () => assetInput.click());
    document.getElementById('hvProjectFolder')?.addEventListener('click', () => folderInput.click());
    document.getElementById('hvAddAudio')?.addEventListener('click', () => audioInput.click());
    document.getElementById('hvTestTone')?.addEventListener('click', () => decodeAudioFile(wavTestToneFile()));
    document.getElementById('hvClearAudio')?.addEventListener('click', clearAudio);

    assetInput.addEventListener('change', async () => {
      await ingestAssets(assetInput.files);
      assetInput.value = '';
    });
    folderInput.addEventListener('change', async () => {
      await importProjectFolder(folderInput.files);
      folderInput.value = '';
    });
    audioInput.addEventListener('change', async () => {
      await decodeAudioFile(audioInput.files?.[0]);
      audioInput.value = '';
    });

    ['hvAudioEnabled', 'hvAudioVolume', 'hvAudioStart', 'hvAudioLoop'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', () => {
        updateAudioStateFromUI();
        syncPreviewAudio();
      });
      document.getElementById(id)?.addEventListener('change', () => {
        updateAudioStateFromUI();
        syncPreviewAudio();
      });
    });

    document.getElementById('playBtn')?.addEventListener('click', () => setTimeout(syncPreviewAudio, 0));
    document.getElementById('restartBtn')?.addEventListener('click', () => {
      previewAudio.pause();
      try { previewAudio.currentTime = 0; } catch (_) {}
      setTimeout(syncPreviewAudio, 0);
    });
    scrub?.addEventListener('input', syncPreviewAudio);
    updateAudioUI();
  }

  function waitVideoReady(video) {
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        video.removeEventListener('loadeddata', ok);
        video.removeEventListener('canplay', ok);
        video.removeEventListener('error', bad);
      };
      const ok = () => { if (done) return; done = true; cleanup(); resolve(); };
      const bad = () => { if (done) return; done = true; cleanup(); reject(new Error('Could not decode raw capture for V2.5')); };
      video.addEventListener('loadeddata', ok, { once: true });
      video.addEventListener('canplay', ok, { once: true });
      video.addEventListener('error', bad, { once: true });
    });
  }

  async function seekVideoExact(video, time) {
    const duration = Number.isFinite(video.duration) ? video.duration : time + 0.05;
    const safe = Math.max(0, Math.min(time, Math.max(0, duration - 0.001)));
    if (Math.abs((video.currentTime || 0) - safe) < 0.00025 && video.readyState >= 2) return;
    await new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('seeked', ok);
        video.removeEventListener('error', bad);
      };
      const ok = () => { if (done) return; done = true; cleanup(); resolve(); };
      const bad = () => { if (done) return; done = true; cleanup(); reject(new Error(`V2.5 source seek failed at ${safe.toFixed(4)}s`)); };
      const timer = setTimeout(ok, 1600);
      video.addEventListener('seeked', ok, { once: true });
      video.addEventListener('error', bad, { once: true });
      video.currentTime = safe;
    });
  }

  function looksBlack(video, rect, probe) {
    const ctx = probe.getContext('2d', { alpha: false, willReadFrequently: true });
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, probe.width, probe.height);
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let energy = 0;
    let lit = 0;
    for (let i = 0; i < data.length; i += 4) {
      const y = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      energy += y;
      if (y > 8) lit += 1;
    }
    const pixels = data.length / 4;
    return energy / pixels < 2.4 && lit / pixels < 0.01;
  }

  async function detectBlackPrefix(video, rect, fps) {
    const probe = document.createElement('canvas');
    probe.width = 80;
    probe.height = 45;
    await seekVideoExact(video, 0);
    if (!looksBlack(video, rect, probe)) return 0;
    const maxFrames = Math.min(6, Math.max(2, Math.ceil(fps * 0.1)));
    for (let i = 1; i <= maxFrames; i += 1) {
      const t = i / fps;
      await seekVideoExact(video, t);
      if (!looksBlack(video, rect, probe)) return t;
    }
    return 0;
  }

  async function selectH264(width, height, fps) {
    const base = Math.max(8_000_000, Math.min(28_000_000, Math.round(width * height * fps * 0.12)));
    const codecs = ['avc1.64002A', 'avc1.4D402A', 'avc1.42E02A', 'avc1.640029', 'avc1.4D4029', 'avc1.42E029'];
    const accelerations = ['prefer-hardware', 'no-preference', 'prefer-software'];
    const bitrates = [...new Set([base, 20_000_000, 16_000_000, 12_000_000, 8_000_000])];
    const attempts = [];

    for (const codec of codecs) {
      for (const hardwareAcceleration of accelerations) {
        for (const bitrate of bitrates) {
          const config = { codec, width, height, bitrate, framerate: fps, latencyMode: 'quality', hardwareAcceleration, avc: { format: 'avc' } };
          try {
            const support = await VideoEncoder.isConfigSupported(config);
            attempts.push({ codec, hardwareAcceleration, bitrate, supported: !!support?.supported });
            if (!support?.supported) continue;
            const selected = { ...config, ...(support.config || {}) };
            let probeError = null;
            const probe = new VideoEncoder({ output: () => {}, error: error => { probeError = error; } });
            try {
              probe.configure(selected);
              await Promise.resolve();
              if (probeError) throw probeError;
              probe.close();
              return { config: selected, codec, hardwareAcceleration, bitrate: selected.bitrate || bitrate, attempts };
            } catch (_) {
              try { probe.close(); } catch (_) {}
            }
          } catch (error) {
            attempts.push({ codec, hardwareAcceleration, bitrate, error: error?.message || String(error) });
          }
        }
      }
    }
    throw new Error(`No working H.264 encoder for ${width}×${height}@${fps}`);
  }

  function requestedAudioBitrate() {
    const quality = document.getElementById('qualitySelect')?.value || 'high';
    return ({ draft: 128000, standard: 192000, high: 256000, master: 320000 })[quality] || 256000;
  }

  async function selectAac(sampleRate = 48000, numberOfChannels = 2) {
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
      throw new Error('WebCodecs AudioEncoder/AudioData is unavailable');
    }
    const candidates = [requestedAudioBitrate(), 256000, 192000, 160000, 128000];
    for (const bitrate of [...new Set(candidates)]) {
      const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate };
      try {
        const support = await AudioEncoder.isConfigSupported(config);
        if (!support?.supported) continue;
        const selected = { ...config, ...(support.config || {}) };
        let probeError = null;
        const probe = new AudioEncoder({ output: () => {}, error: error => { probeError = error; } });
        try {
          probe.configure(selected);
          await Promise.resolve();
          if (probeError) throw probeError;
          probe.close();
          state.lastAudioConfig = selected;
          return selected;
        } catch (_) {
          try { probe.close(); } catch (_) {}
        }
      } catch (_) {}
    }
    throw new Error('No working AAC-LC WebCodecs audio encoder');
  }

  function fillAudioBlock(target, startFrame, frameCount, sampleRate, source, controls) {
    const channels = 2;
    const sourceRate = source.sampleRate;
    const sourceDuration = source.duration;
    const sourceChannels = source.numberOfChannels;
    const sourceData = [];
    for (let ch = 0; ch < sourceChannels; ch += 1) sourceData.push(source.getChannelData(ch));

    for (let i = 0; i < frameCount; i += 1) {
      const timelineTime = (startFrame + i) / sampleRate;
      let sourceTime = timelineTime - controls.startAt;
      let left = 0;
      let right = 0;

      if (sourceTime >= 0 && sourceDuration > 0) {
        if (controls.loop) sourceTime %= sourceDuration;
        if (controls.loop || sourceTime < sourceDuration) {
          const pos = Math.max(0, Math.min(sourceRate * sourceDuration - 1, sourceTime * sourceRate));
          const i0 = Math.floor(pos);
          const i1 = Math.min(i0 + 1, sourceData[0].length - 1);
          const frac = pos - i0;
          const sampleAt = ch => {
            const data = sourceData[Math.min(ch, sourceChannels - 1)];
            return (data[i0] || 0) * (1 - frac) + (data[i1] || 0) * frac;
          };
          left = sampleAt(0) * controls.volume;
          right = sampleAt(sourceChannels > 1 ? 1 : 0) * controls.volume;
        }
      }
      target[i * channels] = left;
      target[i * channels + 1] = right;
    }
  }

  async function encodeAudioTrack(muxer, sourceBuffer, duration, controls, sampleRate = 48000) {
    const numberOfChannels = 2;
    const config = await selectAac(sampleRate, numberOfChannels);
    let encoderError = null;
    let chunks = 0;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        chunks += 1;
        muxer.addAudioChunk(chunk, meta);
      },
      error: error => { encoderError = error; }
    });
    encoder.configure(config);

    const totalFrames = Math.max(1, Math.round(duration * sampleRate));
    const blockSize = 1024;
    for (let start = 0; start < totalFrames; start += blockSize) {
      if (encoderError) throw encoderError;
      const count = Math.min(blockSize, totalFrames - start);
      const pcm = new Float32Array(count * numberOfChannels);
      fillAudioBlock(pcm, start, count, sampleRate, sourceBuffer, controls);
      const timestamp = Math.round(start * 1_000_000 / sampleRate);
      const audioData = new AudioData({
        format: 'f32',
        sampleRate,
        numberOfFrames: count,
        numberOfChannels,
        timestamp,
        data: pcm
      });
      encoder.encode(audioData);
      audioData.close();
      while (encoder.encodeQueueSize > 12) {
        if (encoderError) throw encoderError;
        await sleep(1);
      }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
    encoder.close();
    if (!chunks) throw new Error('AAC encoder emitted no audio chunks');
    return { chunks, config, sampleRate, numberOfChannels, samples: totalFrames };
  }

  async function deterministicMp4WithAudio(rawBlob, options) {
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
      const artifactOffset = await detectBlackPrefix(video, rect, fps);
      const selected = await selectH264(width, height, fps);
      const audioConfig = await selectAac(48000, 2);

      const target = new Mp4Muxer.ArrayBufferTarget();
      const muxer = new Mp4Muxer.Muxer({
        target,
        video: { codec: 'avc', width, height, frameRate: fps },
        audio: { codec: 'aac', sampleRate: audioConfig.sampleRate, numberOfChannels: audioConfig.numberOfChannels },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'strict'
      });

      let videoError = null;
      let videoChunks = 0;
      const encoder = new VideoEncoder({
        output: (chunk, meta) => { videoChunks += 1; muxer.addVideoChunk(chunk, meta); },
        error: error => { videoError = error; }
      });
      encoder.configure(selected.config);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (!ctx) throw new Error('Canvas 2D renderer unavailable for V2.5 MP4');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      setProgress(61, `V2.5 MP4 + AAC · building ${totalFrames} exact video frames…`);
      for (let i = 0; i < totalFrames; i += 1) {
        if (videoError) throw videoError;
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
        const frame = new VideoFrame(canvas, { timestamp, duration: frameDuration, alpha: 'discard' });
        encoder.encode(frame, { keyFrame: i === 0 || i % Math.max(1, fps * 2) === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 8) {
          if (videoError) throw videoError;
          await sleep(1);
        }
        if (i % Math.max(1, Math.round(fps / 4)) === 0 || i === totalFrames - 1) {
          setProgress(62 + ((i + 1) / totalFrames) * 25, `Video ${i + 1}/${totalFrames} · H.264 + AAC pending`);
          await sleep(0);
        }
      }
      await encoder.flush();
      if (videoError) throw videoError;
      encoder.close();
      if (videoChunks < totalFrames) throw new Error(`H.264 encoder emitted only ${videoChunks}/${totalFrames} chunks`);

      setProgress(88, `Encoding deterministic AAC soundtrack…`);
      const controls = audioControls();
      const audioMeta = await encodeAudioTrack(muxer, state.audio.buffer, duration, controls, audioConfig.sampleRate);
      setProgress(97, `Muxing MP4 · ${totalFrames} video frames + ${audioMeta.chunks} AAC chunks…`);
      muxer.finalize();

      if (!target.buffer?.byteLength) throw new Error('V2.5 MP4/AAC muxer returned an empty file');
      const blob = new Blob([target.buffer], { type: 'video/mp4' });
      const renderMeta = {
        version: VERSION,
        mode: 'deterministic-mp4-aac',
        container: 'mp4',
        videoCodec: selected.codec,
        videoAcceleration: selected.hardwareAcceleration,
        width,
        height,
        fps,
        duration,
        expectedFrames: totalFrames,
        encodedVideoChunks: videoChunks,
        artifactOffsetMs: Math.round(artifactOffset * 1000),
        audio: {
          codec: audioMeta.config.codec,
          bitrate: audioMeta.config.bitrate,
          sampleRate: audioMeta.sampleRate,
          channels: audioMeta.numberOfChannels,
          encodedChunks: audioMeta.chunks,
          timelineSamples: audioMeta.samples,
          file: state.audio.name,
          volume: controls.volume,
          startAt: controls.startAt,
          loop: controls.loop
        },
        assets: state.assetRecords.size,
        bytes: blob.size
      };
      state.lastRender = renderMeta;
      window.__HV_LAST_RENDER = renderMeta;
      showToast(`V2.5 MP4 + AAC OK · ${totalFrames}/${totalFrames} frames · audio synced`, 5600);
      return { blob, mime: 'video/mp4', frameCount: totalFrames, encodedChunks: videoChunks, audio: audioMeta };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(sourceURL);
    }
  }

  normalizeToExactResolution = async function(rawBlob, options) {
    const controls = audioControls();
    const useAudio = controls.enabled && !!state.audio.buffer;
    if (!useAudio) return previousNormalize(rawBlob, options);
    if (options.requested !== 'mp4') {
      throw new Error('V2.5 deterministic soundtrack muxing currently requires MP4 · H.264');
    }
    if (!window.Mp4Muxer?.Muxer || !window.Mp4Muxer?.ArrayBufferTarget) {
      throw new Error('MP4 muxer is unavailable for V2.5 audio export');
    }
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined') {
      throw new Error('WebCodecs AAC audio encoder is unavailable in this browser');
    }
    try {
      state.lastError = null;
      return await deterministicMp4WithAudio(rawBlob, options);
    } catch (error) {
      state.lastError = error?.message || String(error);
      console.error('V2.5 deterministic audio render failed:', error);
      throw error;
    }
  };

  function patchLabels() {
    document.title = 'HTML to Video — Studio V2.5';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.5 · Audio + Local Assets';
    const timeline = document.querySelector('.timeline-title span');
    if (timeline) timeline.textContent = 'V2.5 adds deterministic AAC soundtrack muxing plus local assets/project folders while keeping the V2.4 exact video clock.';
    const note = document.getElementById('renderStatus');
    if (note && !isRendering) note.textContent = 'V2.5: add a soundtrack, set volume/start/loop, import local assets or a project folder, then render exact-frame MP4 + AAC.';
    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start V2.5 deterministic render';
    const fine = document.querySelector('#captureModal .fineprint');
    if (fine) {
      fine.innerHTML = 'Requested output: <span id="modalFormat">MP4 · 1920×1080</span> · <span id="modalDuration">6 seconds</span> · <span id="modalQuality">High quality</span> · <span id="modalAudio">video only</span>. With a soundtrack enabled, V2.5 muxes deterministic AAC directly into MP4 while preserving cursor-free capture and exact duration × FPS video frames.';
    }
    const capability = document.getElementById('capabilityLabel');
    if (capability && typeof AudioEncoder !== 'undefined') {
      capability.innerHTML = '<span class="dot"></span>V2.5 video + AAC engine ready';
    }
  }

  renderBtn?.addEventListener('click', () => {
    previewAudio.pause();
    const controls = audioControls();
    if (controls.enabled && state.audio.buffer && formatSelect.value !== 'mp4') {
      formatSelect.value = 'mp4';
      formatSelect.dispatchEvent(new Event('change', { bubbles: true }));
      showToast('Soundtrack enabled → switched output to MP4/AAC', 3200);
    }
    requestAnimationFrame(() => {
      const label = document.getElementById('modalAudio');
      if (label) label.textContent = controls.enabled && state.audio.buffer
        ? `AAC · ${state.audio.name} · ${Math.round(controls.volume * 100)}%`
        : 'video only';
      const format = document.getElementById('modalFormat');
      if (format) format.textContent = `${formatSelect.value.toUpperCase()} · ${sizeSelect.value.replace('x', '×')}`;
    });
  });

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    state.assets.clear();
    state.assetRecords.clear();
    state.project = null;
    clearAudio();
    updateAssetUI();
  });

  window.hvV25Diagnostics = () => ({
    version: VERSION,
    assets: state.assetRecords.size,
    project: state.project,
    audio: {
      loaded: !!state.audio.buffer,
      name: state.audio.name,
      duration: state.audio.buffer?.duration || null,
      sampleRate: state.audio.buffer?.sampleRate || null,
      channels: state.audio.buffer?.numberOfChannels || null,
      ...audioControls()
    },
    lastAudioConfig: state.lastAudioConfig,
    lastRender: state.lastRender || window.__HV_LAST_RENDER || null,
    lastError: state.lastError
  });

  ensureUI();
  patchLabels();
})();
