/* HTML to Video Studio V2.4
   Quality presets + social presets + standalone HTML import.
   Keeps the V2.3 deterministic WebM/MP4 pipelines intact and layers:
   - Draft / Standard / High / Master encoder quality profiles
   - quality-aware raw capture and WebCodecs bitrate targets
   - named 16:9 / 9:16 / square social presets
   - direct .html import with full-document preview support
*/

(() => {
  const VERSION = '2.4';

  const QUALITY = {
    draft:    { label: 'Draft',    encoderMultiplier: 0.55, rawMultiplier: 0.75, note: 'Fast preview' },
    standard: { label: 'Standard', encoderMultiplier: 1.00, rawMultiplier: 1.00, note: 'Balanced' },
    high:     { label: 'High',     encoderMultiplier: 1.75, rawMultiplier: 1.35, note: 'Premium export' },
    master:   { label: 'Master',   encoderMultiplier: 2.75, rawMultiplier: 1.75, note: 'Maximum detail' }
  };

  const diagnostics = {
    version: VERSION,
    quality: 'high',
    importedFile: null,
    fullDocumentMode: false,
    lastEncoderBitrate: null,
    lastRawBitrate: null,
    patches: {
      videoEncoderSupport: false,
      videoEncoderConfigure: false,
      mediaRecorder: false
    }
  };
  window.__HV_V24_DIAGNOSTICS = diagnostics;
  window.__HV_QUALITY = 'high';

  const originalComposeDocument = composeDocument;

  function currentQualityKey() {
    const select = document.getElementById('qualitySelect');
    const key = select?.value || window.__HV_QUALITY || 'high';
    return QUALITY[key] ? key : 'high';
  }

  function qualityProfile() {
    const key = currentQualityKey();
    diagnostics.quality = key;
    window.__HV_QUALITY = key;
    return QUALITY[key];
  }

  function clampBitrate(value, min = 2_000_000, max = 80_000_000) {
    return Math.round(Math.max(min, Math.min(max, Number(value) || min)));
  }

  function qualityAdjustedConfig(config, marker = true) {
    if (!config || !Number.isFinite(config.bitrate)) return { ...(config || {}) };
    if (config.__hvQualityApplied) return { ...config };
    const profile = qualityProfile();
    const adjusted = {
      ...config,
      bitrate: clampBitrate(config.bitrate * profile.encoderMultiplier)
    };
    if (marker) adjusted.__hvQualityApplied = true;
    diagnostics.lastEncoderBitrate = adjusted.bitrate;
    return adjusted;
  }

  function cleanConfig(config) {
    const copy = { ...config };
    delete copy.__hvQualityApplied;
    return copy;
  }

  function patchVideoEncoderQuality() {
    if (typeof VideoEncoder === 'undefined') return;

    try {
      const originalSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder);
      VideoEncoder.isConfigSupported = async function(config) {
        const adjusted = qualityAdjustedConfig(config, false);
        const result = await originalSupport(adjusted);
        if (!result) return result;
        const browserConfig = result.config || adjusted;
        return {
          ...result,
          config: {
            ...browserConfig,
            bitrate: adjusted.bitrate,
            __hvQualityApplied: true
          }
        };
      };
      diagnostics.patches.videoEncoderSupport = true;
    } catch (error) {
      console.warn('V2.4 could not patch VideoEncoder.isConfigSupported:', error);
    }

    try {
      const originalConfigure = VideoEncoder.prototype.configure;
      VideoEncoder.prototype.configure = function(config) {
        const adjusted = config?.__hvQualityApplied ? { ...config } : qualityAdjustedConfig(config, true);
        diagnostics.lastEncoderBitrate = adjusted?.bitrate ?? diagnostics.lastEncoderBitrate;
        return originalConfigure.call(this, cleanConfig(adjusted));
      };
      diagnostics.patches.videoEncoderConfigure = true;
    } catch (error) {
      console.warn('V2.4 could not patch VideoEncoder.configure:', error);
    }
  }

  function patchRawCaptureQuality() {
    if (typeof MediaRecorder === 'undefined') return;
    try {
      const NativeMediaRecorder = MediaRecorder;
      const Wrapped = new Proxy(NativeMediaRecorder, {
        construct(target, args, newTarget) {
          const [stream, options = {}] = args;
          const profile = qualityProfile();
          const patchedOptions = { ...options };
          if (Number.isFinite(options.videoBitsPerSecond)) {
            patchedOptions.videoBitsPerSecond = clampBitrate(
              options.videoBitsPerSecond * profile.rawMultiplier,
              4_000_000,
              50_000_000
            );
            diagnostics.lastRawBitrate = patchedOptions.videoBitsPerSecond;
          }
          return Reflect.construct(target, [stream, patchedOptions], newTarget);
        }
      });
      window.MediaRecorder = Wrapped;
      diagnostics.patches.mediaRecorder = true;
    } catch (error) {
      console.warn('V2.4 could not patch MediaRecorder quality:', error);
    }
  }

  function fullDocumentCompose() {
    const html = editors.html.value;
    const css = editors.css.value;
    const js = editors.js.value;
    const looksFull = /<!doctype\s+html/i.test(html) || /<html(?:\s|>)/i.test(html);

    diagnostics.fullDocumentMode = looksFull;
    if (!looksFull) return originalComposeDocument();

    const styleBlock = css.trim() ? `<style data-hv-v24-user-css>${css}</style>` : '';
    const jsBlock = js.trim()
      ? `<script data-hv-v24-user-js>try { ${js} } catch (error) { console.error(error); }<\\/script>`
      : '';
    const bridge = bridgeScript();

    let out = html;
    if (styleBlock) {
      out = /<\/head>/i.test(out)
        ? out.replace(/<\/head>/i, `${styleBlock}</head>`)
        : `${styleBlock}${out}`;
    }

    const tail = `${jsBlock}${bridge}`;
    out = /<\/body>/i.test(out)
      ? out.replace(/<\/body>/i, `${tail}</body>`)
      : `${out}${tail}`;

    return out;
  }

  composeDocument = fullDocumentCompose;

  function addSocialPresets() {
    const select = document.getElementById('sizeSelect');
    if (!select) return;

    const labels = {
      '1920x1080': '1920×1080 · YouTube / Landscape 16:9',
      '1080x1920': '1080×1920 · TikTok / Reels / Shorts 9:16',
      '1080x1080': '1080×1080 · Square 1:1',
      '1280x720': '1280×720 · HD Landscape 16:9'
    };
    [...select.options].forEach(option => {
      if (labels[option.value]) option.textContent = labels[option.value];
    });

    if (![...select.options].some(option => option.value === '720x1280')) {
      const option = document.createElement('option');
      option.value = '720x1280';
      option.textContent = '720×1280 · Social Draft 9:16';
      select.appendChild(option);
    }
  }

  function ensureQualityUI() {
    const controls = document.querySelector('.preview-side .controls');
    if (!controls) return null;

    let select = document.getElementById('qualitySelect');
    if (!select) {
      select = document.createElement('select');
      select.className = 'control hv-quality-select';
      select.id = 'qualitySelect';
      select.setAttribute('aria-label', 'Quality preset');
      select.innerHTML = `
        <option value="draft">Draft</option>
        <option value="standard">Standard</option>
        <option value="high" selected>High</option>
        <option value="master">Master</option>`;
      const format = document.getElementById('formatSelect');
      format?.insertAdjacentElement('afterend', select);
    }

    let badge = document.getElementById('qualityInfo');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'qualityInfo';
      badge.className = 'pill hv-quality-info';
      controls.insertAdjacentElement('afterend', badge);
    }

    const update = () => {
      const key = currentQualityKey();
      window.__HV_QUALITY = key;
      diagnostics.quality = key;
      const profile = QUALITY[key];
      const [width, height] = document.getElementById('sizeSelect').value.split('x').map(Number);
      const fps = Number(document.getElementById('fpsSelect').value) || 30;
      const base = Math.max(6_000_000, Math.min(28_000_000, Math.round(width * height * fps * 0.12)));
      const estimate = clampBitrate(base * profile.encoderMultiplier);
      badge.textContent = `${profile.label} · ~${(estimate / 1e6).toFixed(0)} Mbps target · ${profile.note}`;
    };

    select.addEventListener('change', () => {
      update();
      showToast(`${qualityProfile().label} quality selected`);
    });
    document.getElementById('sizeSelect')?.addEventListener('change', update);
    document.getElementById('fpsSelect')?.addEventListener('change', update);
    document.getElementById('formatSelect')?.addEventListener('change', update);
    update();
    return select;
  }

  function importStandaloneHtml(file) {
    if (!file) return;
    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      showToast('Choose a .html file', 3200);
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast('Could not read the HTML file', 3600);
    reader.onload = () => {
      const text = String(reader.result || '');
      if (!text.trim()) {
        showToast('The HTML file is empty', 3200);
        return;
      }
      editors.html.value = text;
      editors.css.value = '';
      editors.js.value = '';
      diagnostics.importedFile = {
        name: file.name,
        bytes: file.size,
        importedAt: new Date().toISOString()
      };
      diagnostics.fullDocumentMode = true;
      setTab('html');
      renderPreview({ silent: true });
      showToast(`Imported ${file.name} · full-document mode`, 4200);
      const source = document.getElementById('importInfo');
      if (source) source.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB`;
    };
    reader.readAsText(file);
  }

  function ensureImportUI() {
    const actions = document.querySelector('.top-actions');
    if (!actions) return;

    let input = document.getElementById('htmlFileInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.accept = '.html,.htm,text/html';
      input.id = 'htmlFileInput';
      input.hidden = true;
      document.body.appendChild(input);
    }

    let button = document.getElementById('importHtmlBtn');
    if (!button) {
      button = document.createElement('button');
      button.className = 'btn';
      button.id = 'importHtmlBtn';
      button.textContent = '↑ Import HTML';
      const reset = document.getElementById('resetBtn');
      actions.insertBefore(button, reset || null);
    }

    let info = document.getElementById('importInfo');
    if (!info) {
      info = document.createElement('span');
      info.id = 'importInfo';
      info.className = 'pill hv-import-info';
      info.textContent = 'Drop .html anywhere';
      actions.insertBefore(info, button);
    }

    button.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      importStandaloneHtml(input.files?.[0]);
      input.value = '';
    });

    const dragOn = event => {
      if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
      event.preventDefault();
      document.body.classList.add('hv-file-drag');
    };
    window.addEventListener('dragenter', dragOn);
    window.addEventListener('dragover', dragOn);
    window.addEventListener('dragleave', event => {
      if (event.relatedTarget == null) document.body.classList.remove('hv-file-drag');
    });
    window.addEventListener('drop', event => {
      event.preventDefault();
      document.body.classList.remove('hv-file-drag');
      importStandaloneHtml(event.dataTransfer?.files?.[0]);
    });
  }

  function patchLabels() {
    document.title = 'HTML to Video — Studio V2.4';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.4 · Quality + Social + HTML Import';

    const timeline = document.querySelector('.timeline-title span');
    if (timeline) timeline.textContent = 'V2.4 keeps exact deterministic WebM/MP4 and adds quality profiles, social presets, and standalone HTML import.';

    const note = document.getElementById('renderStatus');
    if (note && !isRendering) {
      note.textContent = 'V2.4: choose Draft / Standard / High / Master quality, render landscape or vertical social video, or import a standalone .html file directly.';
    }

    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start V2.4 deterministic render';

    const fine = document.querySelector('#captureModal .fineprint');
    if (fine) {
      fine.innerHTML = 'Requested output: <span id="modalFormat">WEBM · 1920×1080</span> · <span id="modalDuration">6 seconds</span> · <span id="modalQuality">High quality</span>. V2.4 keeps the cursor-free guard and exact duration × FPS frame clock for both WebM and H.264/MP4.';
    }
  }

  const renderButton = document.getElementById('renderBtn');
  renderButton?.addEventListener('click', () => {
    requestAnimationFrame(() => {
      const modalQuality = document.getElementById('modalQuality');
      if (modalQuality) modalQuality.textContent = `${qualityProfile().label} quality`;
    });
  });

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    diagnostics.importedFile = null;
    diagnostics.fullDocumentMode = false;
    const info = document.getElementById('importInfo');
    if (info) info.textContent = 'Drop .html anywhere';
  });

  window.hvV24Diagnostics = () => ({
    ...diagnostics,
    qualityProfile: { ...qualityProfile() },
    lastRender: window.__HV_LAST_RENDER || null
  });

  patchVideoEncoderQuality();
  patchRawCaptureQuality();
  addSocialPresets();
  ensureQualityUI();
  ensureImportUI();
  patchLabels();
})();
