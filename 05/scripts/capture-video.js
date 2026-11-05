import { ROCK_REACTION_DURATION } from '../rock-reaction.js';
import { smootherstep } from '../random.js';
import { SHOT_PLAN, MESHLET_INTERVAL, PRESS_PLAN, captureShotAt, setCaptureCamera, findCaptureTap } from './capture-shots.js';

const FPS = 30, SIZE = 1024, RENDER_SIZE = 1536;
const nextFrame = () => new Promise(requestAnimationFrame);

// Same ordered PNG-to-FFmpeg workflow as days 01–04. Five orbiting shots with
// real pointerdown events, click rings, and a short meshlet reveal; no cursor.
export async function captureVideo({ duration = 60, receiver = 'http://localhost:8006' } = {}) {
  const app = window.moss, totalFrames = Math.round(duration * FPS);
  if (!app) throw new Error('Wait for the experiment to load');
  if (!Number.isInteger(duration * FPS) || totalFrames < 1 || totalFrames > 108000)
    throw new Error('Duration must be a whole number of frames at 30 fps');
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error('Set viewport to 1024 × 1024 at device scale 1');
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status))
    throw new Error('Capture already running');
  const state = window.captureProgress = {
    status: 'preparing', frame: 0, totalFrames, presses: [], cameraFrames: [], started: performance.now(), cancelled: false,
    cancel() { this.cancelled = true; }
  };
  const { camera, controls, renderer, settings, garden, materials } = app, source = renderer.domElement;
  const header = document.querySelector('header'), panel = document.querySelector('.lil-gui.root'), uiScale = Math.SQRT2;
  const previous = {
    settings: { ...settings }, position: camera.position.clone(), target: controls.target.clone(), focus: app.focusPoint.clone(),
    time: materials.time.value, manual: app.manual, enabled: controls.enabled, autoRotate: controls.autoRotate,
    damping: controls.enableDamping, aspect: camera.aspect, fov: camera.fov, pixelRatio: renderer.getPixelRatio(),
    width: source.width, height: source.height, headerStyle: header.style.cssText, panelStyle: panel.style.cssText,
    panelInert: panel.inert, panelClosed: panel.classList.contains('closed'), pointerEvents: source.style.pointerEvents
  };
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  const presses = PRESS_PLAN.filter(press => press.time + ROCK_REACTION_DURATION < duration).map(press => ({ ...press }));
  const post = async (path, body) => {
    const response = await fetch(receiver + path, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  function cameraAt(time) {
    setCaptureCamera(app, time);
    // Flat debug colors need less exposure than the physically lit scene.
    settings.exposure = previous.settings.exposure * (settings.meshlets ? .48 : 1);
  }
  function dispatch(type, at) {
    const rect = source.getBoundingClientRect();
    source.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 71, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerdown' ? 1 : 0,
      clientX: rect.left + at.x / SIZE * rect.width, clientY: rect.top + at.y / SIZE * rect.height }));
  }
  function interact(time) {
    for (const press of presses) {
      const age = time - press.time;
      if (age < 0 || age > 1.7) continue;
      if (!press.fired) {
        const at = findCaptureTap(app, press, SIZE);
        press.at = at; dispatch('pointerdown', at); press.fired = true;
        state.presses.push({ time: press.time, rock: press.rock, x: at.x, y: at.y });
      }
      // Verify the reaction before releasing: a pointerup-only implementation fails.
      if (age >= .6 && !press.verified) {
        const displacement = garden.rocks[press.rock].reaction.offset.length();
        if (displacement < .001) throw new Error(`The rock did not react on pointerdown at ${press.time}s`);
        state.presses.find(entry => entry.time === press.time).displacementBeforeRelease = displacement;
        press.verified = true;
      }
      if (age >= .8 && !press.released) { dispatch('pointerup', press.at); press.released = true; }
    }
  }
  function overlayText(element, text = element.textContent, center = false) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing) * uiScale}px`;
    ctx.fillStyle = style.color; ctx.textAlign = center ? 'center' : 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, center ? rect.x + rect.width / 2 : rect.x, rect.y + rect.height / 2);
  }
  function snapshot(time) {
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save(); overlayText(header.querySelector('span')); overlayText(header.querySelector('p'));
    const title = panel.querySelector(':scope > .title'), rect = title.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(title).backgroundColor; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    overlayText(title, '▸ SETTINGS', true);
    for (const press of presses) {
      const age = time - press.time;
      if (!press.fired || age < 0 || age >= .8) continue;
      const progress = smootherstep(0, .8, age);
      ctx.globalAlpha = (1 - progress) * .9;
      ctx.strokeStyle = '#f2f2d5'; ctx.lineWidth = 1.5; ctx.shadowColor = '#0008'; ctx.shadowBlur = 3;
      ctx.beginPath(); ctx.arc(press.at.x, press.at.y, 7 + progress * 16, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  let started = false, errorScope = false;
  try {
    app.manual = true; controls.enabled = false; controls.autoRotate = false; controls.enableDamping = false;
    Object.assign(settings, { pause: true, autoOrbit: false, aperture: 33, meshlets: false });
    renderer.setPixelRatio(1); renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    camera.aspect = 1; camera.fov = 38; camera.updateProjectionMatrix();
    panel.inert = true; panel.classList.add('closed'); source.style.pointerEvents = 'none';
    header.style.zoom = panel.style.zoom = uiScale;
    header.style.left = panel.style.right = `${28 / uiScale}px`; header.style.top = `${24 / uiScale}px`;
    const heading = header.querySelector('span').getBoundingClientRect(), titleHeight = panel.querySelector(':scope > .title').getBoundingClientRect().height;
    panel.style.top = `${(heading.y + (heading.height - titleHeight) / 2) / uiScale}px`;
    renderer.backend.device.pushErrorScope('validation'); errorScope = true;
    // Compile both render modes and warm each framing before beginning the
    // chronological simulation. Seeking back to zero resets firefly pursuit.
    for (const time of [0, 22, 34, 45, 54]) {
      materials.time.value = time; garden.update(time); cameraAt(time);
      for (let i = 0; i < 3; i++) { await nextFrame(); app.render(); }
    }
    for (const rock of garden.rocks) rock.reaction.reset(0);
    materials.time.value = 0; cameraAt(0);
    for (let i = 0; i < 40; i++) { await nextFrame(); app.render(); }
    await post('/start', JSON.stringify({ fps: FPS, totalFrames, width: SIZE, height: SIZE, renderSize: RENDER_SIZE,
      uiScale, overlays: true, cursor: false, clickIndicators: true, meshletLabel: false, warmupFrames: 40, initialAnimationTime: 0,
      opening: 'Grounded stones rise with a stagger into hovering by six seconds',
      groundHeights: garden.rocks.map(rock => rock.layout.groundY),
      settings: { ...settings, pause: false }, pressPlan: presses, camera: { position: camera.position.toArray(), target: controls.target.toArray() },
      shots: SHOT_PLAN, meshletInterval: MESHLET_INTERVAL,
      orbitDegrees: SHOT_PLAN.reduce((sum, shot) => sum + (shot.end - shot.start) * shot.orbit, 0) * 180 / Math.PI,
      cameraMotion: 'Five orbiting shots with clean cuts: rising group, close-up, 30-degree downward interactions, 75-degree polar/meshlets, tighter normal macro',
      method: 'Fixed animation steps, sequential lossless PNG frames, encoder backpressure' }));
    started = true; state.status = 'capturing';
    let previousMode = '';
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error('Capture cancelled');
      if (source.width !== RENDER_SIZE || source.height !== RENDER_SIZE || innerWidth !== SIZE || innerHeight !== SIZE)
        throw new Error('Canvas resized during capture');
      const time = frame / FPS;
      await nextFrame(); materials.time.value = time; garden.update(materials.time.value); cameraAt(time); interact(time);
      const shot = captureShotAt(time), mode = `${shot.start}:${settings.meshlets}`;
      if (mode !== previousMode) {
        // Let view-dependent culling settle without advancing animation or
        // adding duplicate frames to the video at a cut or debug-mode switch.
        for (let i = 0; i < 3; i++) { app.render(); await nextFrame(); }
        previousMode = mode;
      }
      app.render();
      // Copy in the render task, before browser presentation clears the GPU canvas.
      snapshot(time);
      if (frame % FPS === 0 || frame === totalFrames - 1) {
        const delta = camera.position.clone().sub(controls.target);
        state.cameraFrames.push({ frame, shot: shot.name, meshlets: settings.meshlets,
          position: camera.position.toArray(), target: controls.target.toArray(),
          distance: delta.length(), elevation: Math.atan2(delta.y, Math.hypot(delta.x, delta.z)) * 180 / Math.PI,
          rockHeights: garden.rocks.map(rock => rock.pivot.position.y) });
      }
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG capture failed')), 'image/png'));
      const receipt = await post(`/frame/${frame}`, blob);
      if (receipt.frame !== frame) throw new Error('Frame receipt out of order');
      state.frame = frame + 1;
    }
    if (presses.some(press => !press.fired || !press.released || !press.verified)) throw new Error('Incomplete interaction schedule');
    const validation = await renderer.backend.device.popErrorScope(); errorScope = false;
    if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = 'encoding';
    state.result = await post('/finish', JSON.stringify({ presses: state.presses, cameraFrames: state.cameraFrames,
      animationTime: materials.time.value, elapsedSeconds: (performance.now() - state.started) / 1000 }));
    state.status = 'complete'; return state.result;
  } catch (error) {
    state.status = state.cancelled ? 'cancelled' : 'failed'; state.error = error.message;
    if (started) await post('/abort', '').catch(() => {});
    throw error;
  } finally {
    if (errorScope) await renderer.backend.device.popErrorScope();
    renderer.setPixelRatio(previous.pixelRatio); renderer.setSize(previous.width / previous.pixelRatio, previous.height / previous.pixelRatio, false);
    Object.assign(settings, previous.settings); controls.autoRotate = false; controls.update(0);
    camera.position.copy(previous.position); controls.target.copy(previous.target); controls.update(0);
    controls.enabled = previous.enabled; controls.autoRotate = previous.autoRotate; controls.enableDamping = previous.damping;
    camera.aspect = previous.aspect; camera.fov = previous.fov; camera.updateProjectionMatrix();
    for (const rock of garden.rocks) rock.reaction.reset(previous.time);
    materials.time.value = previous.time; app.focusPoint.copy(previous.focus);
    header.style.cssText = previous.headerStyle; panel.style.cssText = previous.panelStyle;
    panel.inert = previous.panelInert; panel.classList.toggle('closed', previous.panelClosed);
    source.style.pointerEvents = previous.pointerEvents; app.manual = previous.manual; app.render();
  }
}
