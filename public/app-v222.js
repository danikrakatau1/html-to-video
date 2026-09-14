/* HTML to Video Studio V2.2.2
   Cursor-Free Capture Guard.
   The browser may ignore MediaStream cursor:'never' for tab capture. V2.2.2 therefore
   hard-locks the pointer before the raw MediaRecorder pass begins, so the OS cursor is
   hidden before any recorded frame can contain it.
*/

(() => {
  const VERSION = '2.2.2';
  const mediaDevices = navigator.mediaDevices;
  const originalGetDisplayMedia = mediaDevices?.getDisplayMedia?.bind(mediaDevices);
  const originalCleanupCapture = cleanupCapture;
  const originalNormalize = normalizeToExactResolution;

  const cursorDiagnostics = {
    version: VERSION,
    pointerLockSupported: 'pointerLockElement' in document && typeof document.documentElement.requestPointerLock === 'function',
    lockAcquired: false,
    lockLostDuringCapture: false,
    nativeCursorSetting: null,
    lastError: null
  };
  window.__HV_CURSOR_DIAGNOSTICS = cursorDiagnostics;

  let intentionalUnlock = false;
  let captureGuardActive = false;
  let gate = null;

  function patchLabels() {
    document.title = 'HTML to Video — Studio V2.2.2';
    const brandSub = document.querySelector('.brand-copy span');
    if (brandSub) brandSub.textContent = 'Studio V2.2.2 · Cursor-Free Hard-Lock';

    const note = document.getElementById('renderStatus');
    if (note && !isRendering) {
      note.textContent = 'V2.2.2 keeps the 360-frame deterministic encoder and hides the OS pointer with Pointer Lock before recording starts.';
    }

    const title = document.getElementById('captureTitle');
    if (title) title.textContent = 'Start cursor-free deterministic render';

    const fine = document.querySelector('#captureModal .fineprint');
    if (fine) {
      fine.innerHTML = 'Requested output: <span id="modalFormat">WEBM · 1920×1080</span> · <span id="modalDuration">6 seconds</span>. After Chrome shares This Tab, V2.2.2 pauses before recording and asks you to click <strong style="color:var(--text)">Lock cursor & continue</strong>. Recording does not start until Pointer Lock hides the OS cursor.';
    }
  }

  function ensureGate() {
    if (gate) return gate;
    gate = document.createElement('div');
    gate.className = 'hv-cursor-lock-gate';
    gate.innerHTML = `
      <div class="hv-cursor-lock-card" role="dialog" aria-modal="true" aria-labelledby="hvCursorTitle">
        <h3 id="hvCursorTitle">Hide cursor before recording</h3>
        <p>
          Chrome has already shared the tab, but recording has not started yet.
          Click the button below once. V2.2.2 will use Pointer Lock so the operating-system cursor cannot be composited into the captured frames.
        </p>
        <div class="hv-cursor-lock-status" id="hvCursorStatus">Ready to lock the cursor.</div>
        <div class="hv-cursor-lock-actions">
          <button class="btn btn-primary" id="hvCursorLockBtn">Lock cursor & continue</button>
        </div>
      </div>`;
    document.body.appendChild(gate);
    return gate;
  }

  function setGateStatus(message, mode = '') {
    const el = document.getElementById('hvCursorStatus');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('ok', 'error');
    if (mode) el.classList.add(mode);
  }

  function waitForPointerLock(timeout = 2500) {
    if (document.pointerLockElement) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        document.removeEventListener('pointerlockchange', onChange);
        document.removeEventListener('pointerlockerror', onError);
        clearTimeout(timer);
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      const fail = (error) => {
        if (done) return;
        done = true;
        cleanup();
        reject(error instanceof Error ? error : new Error('Pointer Lock was denied'));
      };
      const onChange = () => {
        if (document.pointerLockElement) finish();
      };
      const onError = () => fail(new Error('Pointer Lock request failed'));
      const timer = setTimeout(() => fail(new Error('Pointer Lock timed out')), timeout);
      document.addEventListener('pointerlockchange', onChange);
      document.addEventListener('pointerlockerror', onError, { once: true });
    });
  }

  async function acquirePointerLockOrThrow() {
    if (!cursorDiagnostics.pointerLockSupported) {
      throw new Error('Pointer Lock API is unavailable in this browser');
    }

    if (document.pointerLockElement) {
      cursorDiagnostics.lockAcquired = true;
      return;
    }

    const root = document.documentElement;
    let requestResult;
    try {
      // Use the widest-compatible form first. Some Chrome versions return a Promise,
      // older implementations signal success only through pointerlockchange.
      requestResult = root.requestPointerLock();
      if (requestResult?.then) await requestResult;
      await waitForPointerLock();
    } catch (error) {
      cursorDiagnostics.lastError = error?.message || String(error);
      throw error;
    }

    if (!document.pointerLockElement) {
      throw new Error('Cursor lock did not become active');
    }

    cursorDiagnostics.lockAcquired = true;
    document.body.classList.add('hv-pointer-locked');
  }

  function releasePointerLock() {
    intentionalUnlock = true;
    captureGuardActive = false;
    document.body.classList.remove('hv-pointer-locked');
    if (document.pointerLockElement && typeof document.exitPointerLock === 'function') {
      try { document.exitPointerLock(); } catch (_) {}
    } else {
      intentionalUnlock = false;
    }
  }

  async function cursorFreeGate(stream) {
    const overlay = ensureGate();
    const button = overlay.querySelector('#hvCursorLockBtn');
    overlay.classList.add('show');
    document.body.classList.add('hv-cursor-gate-open');
    setGateStatus('Ready to lock the cursor.');

    cursorDiagnostics.lockAcquired = false;
    cursorDiagnostics.lockLostDuringCapture = false;
    cursorDiagnostics.lastError = null;

    const track = stream.getVideoTracks()[0];
    cursorDiagnostics.nativeCursorSetting = track?.getSettings?.().cursor ?? null;

    await new Promise((resolve, reject) => {
      let busy = false;
      const ended = () => {
        cleanup();
        reject(new Error('Screen capture ended before cursor lock'));
      };
      const cleanup = () => {
        track?.removeEventListener('ended', ended);
        button?.removeEventListener('click', click);
      };
      const click = async () => {
        if (busy) return;
        busy = true;
        button.disabled = true;
        setGateStatus('Requesting Pointer Lock…');
        try {
          await acquirePointerLockOrThrow();
          captureGuardActive = true;
          setGateStatus('Cursor hidden. Recording will start now.', 'ok');
          await new Promise(r => setTimeout(r, 250));
          cleanup();
          resolve();
        } catch (error) {
          busy = false;
          button.disabled = false;
          setGateStatus(`${error?.message || error}. Click again after allowing Pointer Lock.`, 'error');
        }
      };
      track?.addEventListener('ended', ended, { once: true });
      button?.addEventListener('click', click);
    });

    overlay.classList.remove('show');
    document.body.classList.remove('hv-cursor-gate-open');
    return stream;
  }

  if (originalGetDisplayMedia && mediaDevices) {
    mediaDevices.getDisplayMedia = async function(constraints) {
      const stream = await originalGetDisplayMedia(constraints);
      try {
        return await cursorFreeGate(stream);
      } catch (error) {
        stream.getTracks().forEach(track => track.stop());
        throw error;
      }
    };
  }

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement) return;

    if (intentionalUnlock) {
      intentionalUnlock = false;
      return;
    }

    if (captureGuardActive && document.body.classList.contains('capture-mode')) {
      cursorDiagnostics.lockLostDuringCapture = true;
      cursorDiagnostics.lastError = 'Pointer Lock was released during capture';
      try {
        activeCaptureStream?.getTracks().forEach(track => track.stop());
      } catch (_) {}
      showToast('Cursor lock was released — render stopped to prevent a contaminated video.', 5200);
    }
  });

  cleanupCapture = function() {
    try {
      originalCleanupCapture();
    } finally {
      ensureGate().classList.remove('show');
      document.body.classList.remove('hv-cursor-gate-open');
      releasePointerLock();
    }
  };

  normalizeToExactResolution = async function(rawBlob, options) {
    if (cursorDiagnostics.lockLostDuringCapture) {
      throw new Error('Cursor-free hard-lock failed: Pointer Lock was released during capture');
    }
    const result = await originalNormalize(rawBlob, options);
    window.__HV_LAST_RENDER = {
      ...(window.__HV_LAST_RENDER || {}),
      cursorGuardVersion: VERSION,
      cursorFree: true,
      pointerLockUsed: cursorDiagnostics.lockAcquired,
      nativeCursorSetting: cursorDiagnostics.nativeCursorSetting
    };
    return result;
  };

  window.hvCursorDiagnostics = () => ({ ...cursorDiagnostics });

  patchLabels();
})();
