import { FPS, SIZE, DURATION, ORBIT_SPEED, cameraPose } from './capture-sequence.js';
import { CAMERA } from '../scene-constants.js';

const nextFrame = () => new Promise(requestAnimationFrame);
const png = canvas => new Promise((resolve, reject) => canvas.toBlob(
  blob => blob ? resolve(blob) : reject(new Error('PNG capture failed')), 'image/png',
));

// Run in a separate tab. A session resets the simulation and restores the
// opening camera afterward, along with the previous settings and interface.
export function createCaptureSession({ renderSize = 1536 } = {}) {
  const app = window.feather;
  if (!app || !document.querySelector('#status').hidden) throw new Error('Wait for Feather to load');
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error('Use a 1024 × 1024 viewport at device scale 1');
  if (!Number.isInteger(renderSize) || renderSize < SIZE)
    throw new Error('Render size must be an integer of at least 1024');
  const { renderer, settings, gui, camera, orbit } = app;
  const source = renderer.domElement, header = document.querySelector('header'), panel = gui.domElement;
  const previous = {
    settings: { ...settings }, manual: app.manual, enabled: orbit.controls.enabled,
    ratio: renderer.getPixelRatio(), width: source.width, height: source.height,
    headerStyle: header.style.cssText, panelStyle: panel.style.cssText,
    canvasStyle: source.style.cssText, panelInert: panel.inert, closed: gui._closed,
    uiHidden: document.body.classList.contains('ui-hidden'),
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const uiScale = Math.SQRT2;
  let nextIndex = 0, restored = false;

  app.manual = true;
  orbit.controls.enabled = false;
  Object.assign(settings, { autoOrbit: false, paused: false, speed: 1, focus: CAMERA.radius, resolution: renderSize / SIZE });
  renderer.setPixelRatio(renderSize / SIZE);
  renderer.setSize(SIZE, SIZE, false);
  gui.close();
  panel.inert = true;
  source.style.pointerEvents = 'none';
  document.body.classList.remove('ui-hidden');
  header.style.zoom = panel.style.zoom = uiScale;
  header.style.left = panel.style.right = `${28 / uiScale}px`;
  header.style.top = `${24 / uiScale}px`;
  panel.style.top = `${20 / uiScale}px`;

  function setCamera(seconds) {
    const pose = cameraPose(seconds);
    camera.position.fromArray(pose.position);
    orbit.controls.target.fromArray(pose.target);
    camera.lookAt(orbit.controls.target);
    camera.updateMatrixWorld();
    return pose;
  }
  function text(element, label = element.textContent.trim(), center = false) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing) * uiScale}px`;
    ctx.fillStyle = style.color;
    ctx.textAlign = center ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, center ? rect.x + rect.width / 2 : rect.x, rect.y + rect.height / 2);
  }
  function snapshot() {
    // Copy immediately after rendering, before WebGPU presentation clears it.
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save();
    text(header);
    text(panel.querySelector(':scope > .title'), '› SETTINGS', true);
    ctx.restore();
  }
  function reset() {
    app.reset();
    setCamera(0);
    app.field.update(0, settings);
    nextIndex = 0;
  }
  function advance(frame) {
    // Move before simulation so recycling uses the recorded camera view.
    setCamera(frame / FPS);
    app.advance(1 / FPS);
  }
  reset();
  return {
    app, canvas, reset,
    async preview(frame) {
      if (!Number.isInteger(frame) || frame < 0 || frame >= FPS * DURATION) throw new RangeError('Invalid preview frame');
      reset();
      for (let i = 1; i <= frame; i++) {
        advance(i);
        if (i % 120 === 0) await nextFrame();
      }
      await nextFrame(); app.render(); snapshot();
      return { frame, time: app.time, pose: cameraPose(frame / FPS) };
    },
    async warmup() {
      await nextFrame(); app.render();
      await renderer.backend.device.queue.onSubmittedWorkDone();
      reset();
    },
    async draw(frame) {
      if (frame !== nextIndex) throw new Error(`Expected frame ${nextIndex}; received ${frame}`);
      if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1 || source.width !== renderSize || source.height !== renderSize)
        throw new Error('Canvas resized during capture');
      if (frame > 0) advance(frame);
      await nextFrame(); app.render(); snapshot();
      nextIndex++;
    },
    async restore() {
      if (restored) return;
      restored = true;
      app.reset();
      Object.assign(settings, previous.settings);
      orbit.controls.enabled = previous.enabled;
      renderer.setPixelRatio(previous.ratio);
      renderer.setSize(previous.width / previous.ratio, previous.height / previous.ratio, false);
      header.style.cssText = previous.headerStyle;
      panel.style.cssText = previous.panelStyle;
      source.style.cssText = previous.canvasStyle;
      panel.inert = previous.panelInert;
      document.body.classList.toggle('ui-hidden', previous.uiHidden);
      gui.close(previous.closed);
      gui.controllersRecursive().forEach(c => c.updateDisplay());
      await nextFrame(); app.render();
      app.manual = previous.manual;
    },
  };
}

export async function captureVideo({ receiver = 'http://127.0.0.1:8023', renderSize = 1536, duration = DURATION } = {}) {
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status)) throw new Error('A capture is already running');
  const totalFrames = Math.round(duration * FPS);
  if (!Number.isFinite(duration) || duration <= 0 || duration > DURATION || Math.abs(totalFrames / FPS - duration) > 1e-8)
    throw new RangeError('Duration must be within the sequence and use whole frames');
  const session = createCaptureSession({ renderSize });
  const state = window.captureProgress = {
    status: 'preparing', frame: 0, totalFrames, started: performance.now(), cancelled: false,
    cancel() { this.cancelled = true; },
  };
  const device = session.app.renderer.backend.device;
  const post = async (path, body) => {
    const response = await fetch(receiver + path, { method: 'POST', body, signal: AbortSignal.timeout(120000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  let started = false, errorScope = false;
  try {
    device.pushErrorScope('validation'); errorScope = true;
    await session.warmup();
    if (state.cancelled) throw new Error('Capture cancelled');
    await post('/start', JSON.stringify({
      fps: FPS, totalFrames, width: SIZE, height: SIZE, renderSize, duration,
      uiScale: Math.SQRT2, overlays: 'Title and collapsed settings', cursor: false, audio: false,
      camera: { orbitDegreesPerSecond: ORBIT_SPEED, radius: CAMERA.radius, start: cameraPose(0), end: cameraPose(duration), descent: 'smoothstep' },
      settings: { ...session.app.settings },
      method: 'Fixed 30 Hz timeline, continuous descending orbit, supersampled rendering, ordered lossless PNG frames with encoder backpressure',
    }));
    started = true; state.status = 'capturing';
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error('Capture cancelled');
      await session.draw(frame);
      const receipt = await post(`/frame/${frame}`, await png(session.canvas));
      if (receipt.frame !== frame) throw new Error('Out-of-order frame receipt');
      state.frame = frame + 1;
    }
    const validation = await device.popErrorScope(); errorScope = false;
    if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = 'encoding';
    state.result = await post('/finish', JSON.stringify({ elapsedSeconds: (performance.now() - state.started) / 1000 }));
    state.status = 'complete';
    return state.result;
  } catch (error) {
    state.status = state.cancelled ? 'cancelled' : 'failed'; state.error = error.message;
    if (started) await post('/abort', '').catch(() => {});
    throw error;
  } finally {
    try { if (errorScope) await device.popErrorScope(); }
    finally { await session.restore(); }
  }
}
