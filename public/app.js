const $ = (id) => document.getElementById(id);

const defaults = {
  html: `<main class="scene">
  <div class="orb orb-a"></div>
  <div class="orb orb-b"></div>
  <div class="grid"></div>
  <div class="content">
    <div class="eyebrow">HTML → VIDEO</div>
    <h1>Motion graphics<br>from web code.</h1>
    <p>CSS · JavaScript · GSAP · Canvas · WebGL</p>
    <button>Browser-render experiment</button>
  </div>
</main>`,
  css: `*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Inter,Arial,sans-serif;background:#05070b;color:white}.scene{position:relative;width:100vw;height:100vh;display:grid;place-items:center;overflow:hidden;background:radial-gradient(circle at 28% 38%,#402075 0,transparent 34%),radial-gradient(circle at 82% 60%,#075363 0,transparent 38%),#05070b}.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:64px 64px;mask-image:linear-gradient(to bottom,transparent,#000 25%,#000 75%,transparent)}.orb{position:absolute;width:48vw;aspect-ratio:1;border-radius:50%;filter:blur(60px);opacity:.24;animation:float 5s ease-in-out infinite alternate}.orb-a{left:-12%;top:-20%;background:#8b5cf6}.orb-b{right:-16%;bottom:-24%;background:#22d3ee;animation-delay:-2s}.content{position:relative;z-index:2;text-align:center;padding:7vw;animation:intro 1.1s cubic-bezier(.2,.75,.2,1) both}.eyebrow{display:inline-flex;padding:10px 18px;border:1px solid rgba(255,255,255,.18);border-radius:999px;font-size:clamp(12px,1vw,18px);letter-spacing:.18em;color:#d6d8e2;background:rgba(255,255,255,.035);backdrop-filter:blur(10px)}h1{font-size:clamp(48px,6.8vw,132px);line-height:.92;letter-spacing:-.055em;margin:34px 0 26px}p{font-size:clamp(16px,1.5vw,28px);color:#aeb7c8;margin:0 0 34px}button{padding:16px 24px;border-radius:15px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:white;font-size:clamp(14px,1vw,18px)}@keyframes intro{from{opacity:0;transform:translateY(42px) scale(.98);filter:blur(10px)}to{opacity:1;transform:none;filter:none}}@keyframes float{from{transform:translate3d(-3%,-3%,0) scale(.96)}to{transform:translate3d(7%,6%,0) scale(1.08)}}`,
  js: `const button = document.querySelector('button');
button.animate([
  { transform: 'translateY(0)', boxShadow: '0 0 0 rgba(139,92,246,0)' },
  { transform: 'translateY(-6px)', boxShadow: '0 18px 55px rgba(139,92,246,.28)' },
  { transform: 'translateY(0)', boxShadow: '0 0 0 rgba(139,92,246,0)' }
], { duration: 2400, iterations: Infinity, easing: 'ease-in-out' });`
};

const editors = { html: $('htmlEditor'), css: $('cssEditor'), js: $('jsEditor') };
const frame = $('previewFrame');
const viewport = $('viewportWrap');
const sizeSelect = $('sizeSelect');
const fpsSelect = $('fpsSelect');
const formatSelect = $('formatSelect');
const durationInput = $('durationInput');
const resolutionLabel = $('resolutionLabel');
const previewStatus = $('previewStatus');
const lineInfo = $('lineInfo');
const scrub = $('scrub');
const timeNow = $('timeNow');
const timeEnd = $('timeEnd');
const progressBar = $('progressBar');
const renderStatus = $('renderStatus');
const renderBtn = $('renderBtn');
const downloadBtn = $('downloadBtn');
const toast = $('toast');
const modal = $('captureModal');
const capabilityLabel = $('capabilityLabel');
const captureBadge = $('captureBadge');

let autoTimer = null;
let playRAF = null;
let playStartedAt = 0;
let pausedAt = 0;
let isPlaying = false;
let downloadURL = null;
let lastExt = 'webm';
let activeRecorder = null;
let activeCaptureStream = null;

function seconds() {
  return Math.max(1, Math.min(120, Number(durationInput.value) || 6));
}

function formatTime(value) {
  const s = Math.max(0, Number(value) || 0);
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${String(m).padStart(2, '0')}:${sec}`;
}

function bridgeScript() {
  return `<script>
  (() => {
    const animations = () => document.getAnimations ? document.getAnimations({subtree:true}) : [];
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || msg.__hv !== true) return;
      if (msg.type === 'pause') animations().forEach(a => { try { a.pause(); } catch (_) {} });
      if (msg.type === 'play') animations().forEach(a => { try { a.play(); } catch (_) {} });
      if (msg.type === 'seek') animations().forEach(a => { try { a.pause(); a.currentTime = Math.max(0, msg.ms || 0); } catch (_) {} });
    });
    parent.postMessage({__hv:true,type:'ready'}, '*');
  })();
  <\/script>`;
}

function composeDocument() {
  const html = editors.html.value;
  const css = editors.css.value;
  const js = editors.js.value;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${html}<script>try { ${js} } catch (error) { console.error(error); }<\/script>${bridgeScript()}</body></html>`;
}

function renderPreview({silent = false} = {}) {
  previewStatus.textContent = 'Rendering…';
  frame.srcdoc = composeDocument();
  if (!silent) showToast('Preview refreshed');
}

function schedulePreview() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => renderPreview({silent:true}), 420);
}

function waitForFrameLoad(timeout = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve(); };
    const timer = setTimeout(finish, timeout);
    frame.addEventListener('load', finish, {once:true});
  });
}

function postToPreview(type, extra = {}) {
  try { frame.contentWindow?.postMessage({__hv:true,type,...extra}, '*'); } catch (_) {}
}

function setTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === name));
  Object.entries(editors).forEach(([key, el]) => el.classList.toggle('active', key === name));
  lineInfo.textContent = name.toUpperCase();
  editors[name].focus();
}

function updateAspect() {
  const [w,h] = sizeSelect.value.split('x').map(Number);
  viewport.style.aspectRatio = `${w}/${h}`;
  document.documentElement.style.setProperty('--ratio', String(w / h));
  const ratio = w === h ? '1:1' : w > h ? '16:9' : '9:16';
  resolutionLabel.textContent = `${w} × ${h} · ${ratio}`;
}

function updateDurationUI() {
  const d = seconds();
  durationInput.value = d;
  scrub.max = String(d * 1000);
  timeEnd.textContent = formatTime(d);
  if (Number(scrub.value) > d * 1000) scrub.value = String(d * 1000);
}

function showToast(message, ms = 2200) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), ms);
}

function updateCapability() {
  const secure = window.isSecureContext;
  const canCapture = !!navigator.mediaDevices?.getDisplayMedia;
  const canRecord = typeof MediaRecorder !== 'undefined';
  if (secure && canCapture && canRecord) {
    capabilityLabel.innerHTML = '<span class="dot"></span>Browser recorder ready';
    renderBtn.disabled = false;
  } else {
    capabilityLabel.textContent = 'Browser recorder unavailable';
    renderBtn.disabled = true;
  }
}

function resetTimeline() {
  cancelAnimationFrame(playRAF);
  isPlaying = false;
  pausedAt = 0;
  scrub.value = '0';
  timeNow.textContent = '00:00.0';
  $('playBtn').textContent = '▶ Play';
}

function playTick(now) {
  if (!isPlaying) return;
  const elapsed = pausedAt + (now - playStartedAt);
  const max = seconds() * 1000;
  const value = Math.min(elapsed, max);
  scrub.value = String(value);
  timeNow.textContent = formatTime(value / 1000);
  if (value >= max) {
    isPlaying = false;
    $('playBtn').textContent = '▶ Play';
    return;
  }
  playRAF = requestAnimationFrame(playTick);
}

function togglePlay() {
  if (isPlaying) {
    pausedAt += performance.now() - playStartedAt;
    isPlaying = false;
    cancelAnimationFrame(playRAF);
    postToPreview('pause');
    $('playBtn').textContent = '▶ Play';
    return;
  }
  if (pausedAt >= seconds() * 1000 - 20) restartPlayback();
  postToPreview('play');
  isPlaying = true;
  playStartedAt = performance.now();
  $('playBtn').textContent = '⏸ Pause';
  playRAF = requestAnimationFrame(playTick);
}

async function restartPlayback() {
  resetTimeline();
  renderPreview({silent:true});
  await waitForFrameLoad();
}

function pickMime(requested) {
  const candidates = requested === 'mp4'
    ? ['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
    : ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm','video/mp4;codecs=avc1.42E01E','video/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function cleanupCapture() {
  document.body.classList.remove('capture-mode');
  captureBadge.classList.remove('show');
  activeCaptureStream?.getTracks().forEach(track => track.stop());
  activeCaptureStream = null;
  activeRecorder = null;
}

function setProgress(percent, message) {
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  renderStatus.textContent = message;
}

async function cropToStage(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track) return false;
  try {
    if (window.CropTarget?.fromElement && typeof track.cropTo === 'function') {
      const target = await CropTarget.fromElement(viewport);
      await track.cropTo(target);
      return true;
    }
  } catch (error) {
    console.warn('Region crop unavailable:', error);
  }
  return false;
}

function recorderStopped(recorder, chunks, mime) {
  return new Promise(resolve => {
    recorder.addEventListener('stop', () => {
      const blob = new Blob(chunks, {type: mime || chunks[0]?.type || 'video/webm'});
      resolve(blob);
    }, {once:true});
  });
}

async function renderBrowserVideo() {
  modal.classList.remove('show');
  downloadBtn.classList.remove('show');
  if (downloadURL) { URL.revokeObjectURL(downloadURL); downloadURL = null; }

  const d = seconds();
  const fps = Number(fpsSelect.value) || 30;
  const requested = formatSelect.value;
  const mime = pickMime(requested);
  if (!mime) {
    showToast('No supported MediaRecorder video codec found', 3600);
    return;
  }

  const actualExt = mime.includes('mp4') ? 'mp4' : 'webm';
  lastExt = actualExt;
  if (requested !== actualExt) showToast(`${requested.toUpperCase()} unsupported here — falling back to ${actualExt.toUpperCase()}`, 4200);

  try {
    setProgress(2, 'Preparing capture…');
    document.body.classList.add('capture-mode');
    await new Promise(r => setTimeout(r, 180));

    activeCaptureStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude'
    });

    const cropped = await cropToStage(activeCaptureStream);
    const track = activeCaptureStream.getVideoTracks()[0];
    const settings = track?.getSettings?.() || {};
    setProgress(6, cropped ? 'Stage region capture active' : 'Full-tab fallback active');

    const chunks = [];
    const bitrate = fps >= 60 ? 14_000_000 : 9_000_000;
    const recorder = new MediaRecorder(activeCaptureStream, { mimeType: mime, videoBitsPerSecond: bitrate });
    activeRecorder = recorder;
    recorder.addEventListener('dataavailable', event => { if (event.data?.size) chunks.push(event.data); });

    renderPreview({silent:true});
    await waitForFrameLoad();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    recorder.start(250);
    captureBadge.classList.add('show');
    const stopped = recorderStopped(recorder, chunks, mime);
    const started = performance.now();

    await new Promise(resolve => {
      const tick = () => {
        const elapsed = (performance.now() - started) / 1000;
        const pct = 8 + Math.min(1, elapsed / d) * 86;
        setProgress(pct, `Recording ${Math.min(elapsed,d).toFixed(1)}s / ${d.toFixed(1)}s · ${fps} FPS target`);
        if (elapsed >= d || recorder.state === 'inactive') return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    if (recorder.state !== 'inactive') recorder.stop();
    const blob = await stopped;
    cleanupCapture();

    if (!blob.size) throw new Error('Recorder returned an empty file');
    downloadURL = URL.createObjectURL(blob);
    downloadBtn.href = downloadURL;
    downloadBtn.download = `html-to-video-${Date.now()}.${actualExt}`;
    downloadBtn.classList.add('show');
    setProgress(100, `Ready · ${(blob.size / 1024 / 1024).toFixed(1)} MB${settings.width ? ` · capture ${settings.width}×${settings.height}` : ''}`);
    showToast(`Render complete — ${actualExt.toUpperCase()} ready`, 3500);
  } catch (error) {
    console.error(error);
    cleanupCapture();
    setProgress(0, 'Render cancelled / failed');
    const message = error?.name === 'NotAllowedError' ? 'Capture cancelled. Choose “This Tab” and Share to render.' : `Render failed: ${error?.message || error}`;
    showToast(message, 5000);
  }
}

function openCaptureModal() {
  $('modalFormat').textContent = formatSelect.value.toUpperCase();
  $('modalDuration').textContent = `${seconds()} seconds`;
  modal.classList.add('show');
}

function loadDefaults() {
  Object.entries(defaults).forEach(([key,value]) => editors[key].value = value);
  durationInput.value = '6';
  sizeSelect.value = '1920x1080';
  fpsSelect.value = '60';
  formatSelect.value = 'webm';
  updateAspect();
  updateDurationUI();
  resetTimeline();
  renderPreview({silent:true});
}

document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
Object.values(editors).forEach(editor => editor.addEventListener('input', schedulePreview));

$('runBtn').addEventListener('click', () => renderPreview());
$('refreshBtn').addEventListener('click', () => renderPreview());
$('resetBtn').addEventListener('click', () => { loadDefaults(); showToast('Studio reset to V2 demo'); });
$('playBtn').addEventListener('click', togglePlay);
$('restartBtn').addEventListener('click', async () => { await restartPlayback(); showToast('Timeline restarted'); });
renderBtn.addEventListener('click', openCaptureModal);
$('modalCancel').addEventListener('click', () => modal.classList.remove('show'));
$('modalStart').addEventListener('click', renderBrowserVideo);
modal.addEventListener('click', event => { if (event.target === modal) modal.classList.remove('show'); });

sizeSelect.addEventListener('change', updateAspect);
durationInput.addEventListener('change', updateDurationUI);
fpsSelect.addEventListener('change', () => showToast(`${fpsSelect.value} FPS target selected`));
formatSelect.addEventListener('change', () => showToast(`${formatSelect.value.toUpperCase()} requested`));

scrub.addEventListener('input', () => {
  const ms = Number(scrub.value) || 0;
  pausedAt = ms;
  isPlaying = false;
  cancelAnimationFrame(playRAF);
  $('playBtn').textContent = '▶ Play';
  timeNow.textContent = formatTime(ms / 1000);
  postToPreview('seek', {ms});
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    renderPreview();
  }
  if (event.key === 'Escape' && modal.classList.contains('show')) modal.classList.remove('show');
  if (event.key === 'Tab' && document.activeElement?.classList.contains('editor')) {
    event.preventDefault();
    const el = document.activeElement;
    const start = el.selectionStart, end = el.selectionEnd;
    el.value = el.value.slice(0,start) + '  ' + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + 2;
    schedulePreview();
  }
});

window.addEventListener('message', event => {
  if (event.data?.__hv === true && event.data?.type === 'ready') previewStatus.textContent = 'Live';
});

window.addEventListener('beforeunload', () => {
  if (downloadURL) URL.revokeObjectURL(downloadURL);
  activeCaptureStream?.getTracks().forEach(track => track.stop());
});

updateCapability();
loadDefaults();