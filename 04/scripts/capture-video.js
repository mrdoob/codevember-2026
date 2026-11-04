import { Vector3 } from 'three/webgpu';
import { SPACING, STEP } from '../rope-config.js';
import { createHumanPlan, sampleHumanGesture } from './human-gestures.js';

const FPS = 30,
  SIZE = 1024,
  RENDER_SIZE = 1536;
const nextFrame = () => new Promise(requestAnimationFrame);
const smooth = x => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};

// The camera keeps orbiting while each held strand is lifted, swung, and released.
export const DRAG_PLAN = [
  { at: 10, region: 'falling', strand: 0, duration: 3.2, amplitude: 1.05, lift: 0.3, frequency: 1.4, direction: 1 },
  { at: 20, region: 'floor', strand: 2, duration: 4, amplitude: 1.2, lift: 1.65, frequency: 1.25, direction: -1 },
  { at: 30, region: 'falling', strand: 4, duration: 3.6, amplitude: 1.2, lift: 0.35, frequency: 1.55, direction: -1 },
  { at: 40, region: 'floor', strand: 1, duration: 4.2, amplitude: 1.3, lift: 1.85, frequency: 1.4, direction: 1 },
  { at: 50, region: 'floor', strand: 3, duration: 4.5, amplitude: 1.35, lift: 2.1, frequency: 1.3, direction: -1 }
];

async function beginGesture(app, plan, frame, history) {
  const sim = app.simulation,
    renderer = app.renderer;
  // Read back once per gesture to find a visible strand in the requested region.
  const positions = new Float32Array(await renderer.getArrayBufferAsync(sim.a.value));
  const clock = new Float32Array(await renderer.getArrayBufferAsync(sim.state.value));
  const live = Math.round(clock[4]),
    candidates = [],
    point = new Vector3();
  app.camera.updateMatrixWorld();
  const inRegion = y => (plan.region === 'falling' ? y > 1.6 && y < 2.9 : y < 0.65);
  const used = history.slice(-2).map(item => item.strand);
  for (let strand = 0; strand < sim.strands; strand++)
    for (let n = 8; n < live - 5; n += 2) {
      const index = strand * sim.count + n,
        j = index * 4,
        y = positions[j + 1];
      if (!inRegion(y)) continue;
      point.fromArray(positions, j).project(app.camera);
      const x = (point.x * 0.5 + 0.5) * SIZE,
        screenY = (-point.y * 0.5 + 0.5) * SIZE;
      if (point.z < 0 || point.z > 1 || x < 110 || x > SIZE - 110 || screenY < 180 || screenY > SIZE - 120) continue;
      const height = Math.abs(y - (plan.pickHeight ?? (plan.region === 'falling' ? 2.1 : 0)));
      const score =
        (strand === plan.strand ? 0 : 2) +
        (used.includes(strand) ? 0.5 : 0) +
        Math.abs(x - SIZE * (plan.focusX ?? 0.5)) / SIZE +
        height +
        point.z * 0.05;
      candidates.push({ x, y: screenY, score });
    }
  candidates.sort((a, b) => a.score - b.score);
  // Use the normal GPU picker to ensure the chosen material is visible.
  for (const candidate of candidates.slice(0, 120)) {
    const hit = await sim.pick(candidate.x, candidate.y, app.camera, SIZE, SIZE);
    if (!hit || !inRegion(hit.position[1])) continue;
    if (!sim.beginGrab(hit.index, hit.position, hit.travel)) continue;
    const origin = new Vector3().fromArray(hit.position);
    const right = new Vector3().setFromMatrixColumn(app.camera.matrixWorld, 0);
    right.y = 0;
    right.normalize();
    const depth = new Vector3().setFromMatrixColumn(app.camera.matrixWorld, 2);
    depth.y = 0;
    depth.normalize();
    const record = {
      startFrame: frame,
      startSeconds: frame / FPS,
      region: plan.region,
      kind: plan.kind ?? 'shake',
      durationFrames: Math.round(plan.duration * FPS),
      strand: Math.floor(hit.index / sim.count),
      index: hit.index,
      travel: hit.travel,
      from: hit.position,
      screen: [candidate.x, candidate.y],
      peakTargetDisplacement: 0
    };
    history.push(record);
    // Prefer throwing back into the picture when a strand sits near an edge.
    const direction =
      plan.path && (candidate.x > SIZE * 0.64 || candidate.x < SIZE * 0.36)
        ? (candidate.x > SIZE * 0.5 ? -1 : 1) / plan.direction
        : 1;
    return { plan, record, origin, right, depth, direction, target: origin.clone() };
  }
  throw new Error(`No visible ${plan.region} yarn found at ${plan.at}s`);
}

function moveGesture(sim, grab, frame) {
  const { plan, record, origin, right, depth, target } = grab;
  const t = Math.max(0, (frame - record.startFrame) / FPS);
  if (plan.path) {
    const [x, y, z] = sampleHumanGesture(plan, t);
    target
      .copy(origin)
      .addScaledVector(right, x * grab.direction)
      .addScaledVector(depth, z);
    const center = (plan.centerPull ?? 0) * smooth(Math.min(1, t / 0.65));
    target.x -= origin.x * center;
    target.z -= origin.z * center;
    target.y = Math.max(0.12, origin.y + y);
    sim.moveGrab(target.toArray());
    record.peakTargetDisplacement = Math.max(record.peakTargetDisplacement, target.distanceTo(origin));
    return;
  }
  const ramp = smooth(t / 0.55),
    fade = 1 - 0.25 * smooth((t - plan.duration + 0.55) / 0.55);
  const amplitude = plan.amplitude * ramp * fade;
  const cycle = t * Math.PI * 2 * plan.frequency;
  const sweep = plan.direction * 0.7 * smooth(t / plan.duration);
  const horizontal = amplitude * Math.sin(cycle) + sweep;
  const forward = amplitude * 0.38 * Math.sin(cycle * 0.5) + 0.25 * ramp;
  target.copy(origin).addScaledVector(right, horizontal).addScaledVector(depth, forward);
  // Bring floor loops toward the center as they rise, then throw them across it.
  if (plan.region === 'floor') {
    target.x -= origin.x * 0.45 * ramp;
    target.z -= origin.z * 0.45 * ramp;
  }
  target.y = Math.max(0.12, origin.y + plan.lift * ramp + 0.22 * ramp * Math.sin(cycle * 0.75));
  sim.moveGrab(target.toArray());
  record.peakTargetDisplacement = Math.max(record.peakTargetDisplacement, target.distanceTo(origin));
}

export async function captureVideo({
  duration = 60,
  receiver = 'http://localhost:8005',
  interaction = 'regular',
  seed = 20261104
} = {}) {
  const app = window.tangle,
    totalFrames = Math.round(duration * FPS);
  if (!app?.simulation.isGPU) throw new Error('Wait for the WebGPU experiment to load');
  if (!Number.isInteger(duration * FPS) || totalFrames < 1 || totalFrames > 108000)
    throw new Error('Duration must be a whole number of frames at 30 fps');
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error('Set viewport to 1024 × 1024 at device scale 1');
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status))
    throw new Error('Capture already running');
  if (!['regular', 'human'].includes(interaction)) throw new Error('Unknown interaction style');
  const plans = (interaction === 'human' ? createHumanPlan(duration, seed) : DRAG_PLAN).filter(
    plan => plan.at + plan.duration < duration
  );
  const state = (window.captureProgress = {
    status: 'preparing',
    frame: 0,
    totalFrames,
    drags: [],
    started: performance.now(),
    cancelled: false
  });
  state.cancel = () => {
    state.cancelled = true;
  };
  const renderer = app.renderer,
    source = renderer.domElement,
    camera = app.camera,
    controls = app.controls;
  const header = document.querySelector('header'),
    panel = document.querySelector('.lil-gui.root'),
    uiScale = Math.SQRT2;
  const previous = {
    settings: { ...app.settings },
    manual: app.manual,
    camera: camera.position.clone(),
    target: controls.target.clone(),
    enabled: controls.enabled,
    autoRotate: controls.autoRotate,
    damping: controls.enableDamping,
    aspect: camera.aspect,
    fov: camera.fov,
    pixelRatio: renderer.getPixelRatio(),
    width: source.width,
    height: source.height,
    headerStyle: header.style.cssText,
    panelStyle: panel.style.cssText,
    panelInert: panel.inert,
    panelClosed: panel.classList.contains('closed'),
    pointerEvents: source.style.pointerEvents
  };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const post = async (path, body) => {
    const response = await fetch(receiver + path, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  function overlayText(element, text = element.textContent, center = false) {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing) * uiScale}px`;
    ctx.fillStyle = style.color;
    ctx.textAlign = center ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, center ? rect.x + rect.width / 2 : rect.x, rect.y + rect.height / 2);
  }
  function snapshot(grab) {
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save();
    overlayText(header.querySelector('span'));
    overlayText(header.querySelector('p'));
    const title = panel.querySelector(':scope > .title'),
      rect = title.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(title).backgroundColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    overlayText(title, '▸ SETTINGS', true);
    if (grab) {
      const p = grab.target.clone().project(camera),
        x = (p.x * 0.5 + 0.5) * SIZE,
        y = (-p.y * 0.5 + 0.5) * SIZE;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#0008';
      ctx.shadowBlur = 2;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  let started = false,
    grab = null;
  try {
    app.drag.end();
    app.manual = true;
    app.pause(true);
    controls.enabled = false;
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update(0);
    controls.reset();
    Object.assign(app.settings, { autoOrbit: true, speed: 1, pause: true });
    renderer.setPixelRatio(1);
    renderer.setSize(RENDER_SIZE, RENDER_SIZE, false);
    camera.aspect = 1;
    camera.fov = 38;
    camera.updateProjectionMatrix();
    panel.inert = true;
    panel.classList.add('closed');
    source.style.pointerEvents = 'none';
    header.style.zoom = panel.style.zoom = uiScale;
    header.style.left = panel.style.right = `${28 / uiScale}px`;
    header.style.top = `${24 / uiScale}px`;
    const heading = header.querySelector('span').getBoundingClientRect(),
      titleHeight = panel.querySelector(':scope > .title').getBoundingClientRect().height;
    panel.style.top = `${(heading.y + (heading.height - titleHeight) / 2) / uiScale}px`;
    app.reset();
    const initial = await app.simulation.inspect();
    if (initial.minY < 1 || initial.time !== 0) throw new Error('Capture must start with an empty floor');
    controls.autoRotate = true;
    await post(
      '/start',
      JSON.stringify({
        fps: FPS,
        totalFrames,
        width: SIZE,
        height: SIZE,
        renderSize: RENDER_SIZE,
        uiScale,
        overlays: true,
        settings: { ...app.settings, pause: false },
        warmupFrames: 0,
        initial,
        interaction,
        seed,
        dragPlan: plans,
        camera: {
          position: camera.position.toArray(),
          target: controls.target.toArray(),
          autoRotateSpeed: controls.autoRotateSpeed
        },
        orbitDegrees: duration * 6 * controls.autoRotateSpeed,
        method: 'Fixed simulation steps, sequential lossless PNG frames, encoder backpressure, GPU-picked rope gestures'
      })
    );
    started = true;
    state.status = 'capturing';
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error('Capture cancelled');
      if (source.width !== RENDER_SIZE || source.height !== RENDER_SIZE || innerWidth !== SIZE || innerHeight !== SIZE)
        throw new Error('Canvas resized during capture');
      await nextFrame();
      if (frame > 0) controls.update(1 / FPS);
      const plan = plans.find(item => Math.round(item.at * FPS) === frame);
      if (plan) grab = await beginGesture(app, plan, frame, state.drags);
      if (grab && frame === grab.record.startFrame + grab.record.durationFrames) {
        app.simulation.endGrab();
        grab.record.releaseFrame = frame;
        const data = new Float32Array(await renderer.getArrayBufferAsync(app.simulation.a.value));
        const clock = new Float32Array(await renderer.getArrayBufferAsync(app.simulation.state.value));
        const index = grab.record.index + Math.round((clock[2] - grab.record.travel) / SPACING);
        grab.record.releasedPosition = Array.from(data.slice(index * 4, index * 4 + 3));
        grab.record.materialDisplacement = new Vector3()
          .fromArray(grab.record.releasedPosition)
          .distanceTo(grab.origin);
        const velocity = new Float32Array(await renderer.getArrayBufferAsync(app.simulation.velocity.value));
        grab.record.releaseVelocity = Array.from(velocity.slice(index * 4, index * 4 + 3));
        grab.record.releaseSpeed = Math.hypot(...grab.record.releaseVelocity);
        grab.record.releaseTrackingError = new Vector3()
          .fromArray(grab.record.releasedPosition)
          .distanceTo(grab.target);
        grab = null;
      }
      if (frame > 0 && grab?.plan.path) {
        // Move the hand at the physics rate. Holding a new target through four
        // substeps would stop the grabbed particle before a fast throw releases.
        const steps = Math.round(1 / FPS / STEP);
        for (let step = 1; step <= steps; step++) {
          moveGesture(app.simulation, grab, frame - 1 + step / steps);
          app.advance(STEP);
        }
      } else {
        if (grab) moveGesture(app.simulation, grab, frame);
        if (frame > 0) app.advance(1 / FPS);
      }
      if (Math.abs(app.simulation.time - frame / FPS) > 1e-6) throw new Error('Scene changed during capture');
      app.render();
      // Copy in the render task, before browser presentation clears the GPU canvas.
      snapshot(grab);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(value => (value ? resolve(value) : reject(new Error('PNG capture failed'))), 'image/png')
      );
      const receipt = await post(`/frame/${frame}`, blob);
      if (receipt.frame !== frame) throw new Error('Frame receipt out of order');
      state.frame = frame + 1;
    }
    if (
      state.drags.length !== plans.length ||
      state.drags.some(item => item.releaseFrame !== item.startFrame + item.durationFrames)
    )
      throw new Error('Drag schedule was not completed');
    const final = await app.simulation.inspect();
    if (!final.finite) throw new Error('Simulation became unstable');
    state.status = 'encoding';
    state.result = await post(
      '/finish',
      JSON.stringify({
        drags: state.drags,
        final,
        simulationTime: app.simulation.time,
        elapsedSeconds: (performance.now() - state.started) / 1000
      })
    );
    state.status = 'complete';
    return state.result;
  } catch (error) {
    state.status = state.cancelled ? 'cancelled' : 'failed';
    state.error = error.message;
    if (started) await post('/abort', '').catch(() => {});
    throw error;
  } finally {
    app.simulation.endGrab();
    renderer.setPixelRatio(previous.pixelRatio);
    renderer.setSize(previous.width / previous.pixelRatio, previous.height / previous.pixelRatio, false);
    Object.assign(app.settings, previous.settings);
    controls.autoRotate = false;
    controls.update(0);
    camera.position.copy(previous.camera);
    controls.target.copy(previous.target);
    controls.update(0);
    controls.enableDamping = previous.damping;
    controls.enabled = previous.enabled;
    controls.autoRotate = previous.autoRotate;
    camera.aspect = previous.aspect;
    camera.fov = previous.fov;
    camera.updateProjectionMatrix();
    header.style.cssText = previous.headerStyle;
    panel.style.cssText = previous.panelStyle;
    panel.inert = previous.panelInert;
    panel.classList.toggle('closed', previous.panelClosed);
    source.style.pointerEvents = previous.pointerEvents;
    app.manual = previous.manual;
    app.pause(previous.settings.pause);
    app.render();
  }
}
