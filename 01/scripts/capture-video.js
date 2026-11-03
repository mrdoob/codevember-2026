import * as THREE from 'three';

// One simulation update, one render, one lossless PNG, one acknowledged write.
// No requestAnimationFrame, MediaRecorder, or wall-clock simulation deltas.
export async function captureVideo({ duration = 60, receiver = 'http://localhost:8001' } = {}) {
  const f = window.fold;
  const fps = 30, totalFrames = duration * fps;
  if (!Number.isInteger(totalFrames) || totalFrames < 1 || totalFrames > 108000) {
    throw new Error('Duration must be 1–108000 whole frames at 30 fps');
  }
  if (!f?.stop || !f?.start) throw new Error('Wait for the experiment to finish loading');
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status)) {
    throw new Error('A capture is already running');
  }
  const source = f.renderer.domElement;
  if (source.width !== 1024 || source.height !== 1024 || innerWidth !== 1024 || innerHeight !== 1024) {
    throw new Error('Set the viewport to 1024 × 1024 and Rendering → Resolution to Medium first');
  }
  const dragDurationFrames = 24; // 0.8 seconds per pull, including each direction change.
  const dragPlans = [
    { region: 'falling section', falling: true, at: [512, 300], path: [[-180, 0], [180, -35], [-120, 15]] },
    { region: 'right fold', at: [730, 600], delta: [180, -170] },
    { region: 'falling section', falling: true, at: [512, 380], path: [[190, 0], [-180, 25], [110, -20]] },
    { region: 'lower left fold', at: [300, 850], delta: [240, -70] },
    { region: 'lower right fold', at: [770, 800], delta: [-60, -280] },
  ].map((plan, i) => ({ ...plan, startFrame: (i + 1) * 10 * fps,
    durationFrames: dragDurationFrames * (plan.path?.length ?? 1) }));
  const scheduledDrags = dragPlans.filter(plan => plan.startFrame + plan.durationFrames < totalFrames);
  const dragStartFrames = scheduledDrags.map(plan => plan.startFrame);
  const uiScale = Math.SQRT2;
  const state = window.captureProgress = {
    status: 'preparing', frame: 0, totalFrames, drags: [], cancelled: false,
    cancel() { this.cancelled = true; }
  };
  const header = document.querySelector('header');
  const panel = document.querySelector('.lil-gui.root');
  const previous = {
    pause: f.settings.pause, headerStyle: header.style.cssText,
    panelStyle: panel.style.cssText, panelInert: panel.inert, pointerEvents: source.style.pointerEvents
  };
  let receiverStarted = false;
  async function post(path, body) {
    const response = await fetch(receiver + path, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  }

  try {
    f.stop();
    f.settings.pause = true;
    // Scale only the recording page's UI; keep the live experiment unchanged.
    panel.inert = true;
    source.style.pointerEvents = 'none';
    header.style.zoom = panel.style.zoom = uiScale;
    // Preserve the original screen-space anchors while enlarging the UI.
    header.style.left = header.style.right = panel.style.right = `${28 / uiScale}px`;
    header.style.top = `${24 / uiScale}px`;
    const heading = document.querySelector('header div > span').getBoundingClientRect();
    const titleHeight = panel.querySelector(':scope > .title').getBoundingClientRect().height;
    panel.style.top = `${(heading.y + (heading.height - titleHeight) / 2) / uiScale}px`;
    f.reset();
    const sim = f.sheet.simulation;
    await post('/start', JSON.stringify({
      fps, totalFrames, uiScale, dragStartFrames, dragDurationFrames, dragPlans,
      retainedLength: (sim.retainedRows - 1) * sim.spacing,
      warmupFrames: 0, initialSimulationTime: sim.time,
      depthHalfExtent: sim.depthHalfExtent, settings: { ...f.settings },
      method: 'Fixed simulation steps; sequential lossless PNG frames; encoder backpressure'
    }));
    receiverStarted = true;
    f.sheet.update(0, f.settings);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d', { alpha: false });
    const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const point = new THREE.Vector3();
    let grab;
    function beginDrag(frame) {
      const plan = scheduledDrags.find(plan => plan.startFrame === frame);
      f.sheet.mesh.updateMatrixWorld();
      f.sheet.geometry.computeBoundingSphere();
      f.sheet.geometry.computeBoundingBox();
      // Search nearest the chosen region, while keeping the five grab points
      // spatially distinct and avoiding a previously grabbed material patch.
      const candidates = [plan.at];
      // Project the actual hanging strip so a narrow, moving inlet is still
      // selectable. Raycast afterward to ensure the patch is visible.
      const hangingRows = Math.min(sim.activeRows - 1, Math.floor(sim.height * .65 / sim.spacing));
      if (plan.falling) for (let row = 3; row <= hangingRows; row++) for (let col = 0; col < sim.stride; col++) {
        point.fromArray(sim.positions, (row * sim.stride + col) * 3).project(f.camera);
        const x = (point.x + 1) * 512, y = (1 - point.y) * 512;
        if (x > 48 && x < 976 && y > 160 && y < 700) candidates.push([x, y]);
      }
      for (let y = 224; y <= 928; y += 64) for (let x = 96; x <= 928; x += 64) candidates.push([x, y]);
      candidates.sort((a, b) => Math.hypot(a[0] - plan.at[0], a[1] - plan.at[1]) - Math.hypot(b[0] - plan.at[0], b[1] - plan.at[1]));
      for (const [x, y] of candidates) {
        if (!plan.falling && state.drags.some(drag => Math.hypot(x - drag.from[0], y - drag.from[1]) < 120)) continue;
        ray.setFromCamera(pointer.set(x / 512 - 1, 1 - y / 512), f.camera);
        const hit = ray.intersectObject(f.sheet.mesh, false).find(h => h.uv && h.point.y > .5);
        if (!hit) continue;
        const row = Math.round((1 - hit.uv.y) * (sim.activeRows - 1));
        if (plan.falling ? row < 3 || row > hangingRows || hit.point.y < sim.height * .45 : row < 15) continue;
        const column = Math.round(hit.uv.x * sim.columns);
        const birth = sim.birth[row];
        if (state.drags.some(drag => Math.abs(birth - drag.birth) < .8 && Math.abs(column - drag.column) < 3)) continue;
        const index = row * sim.stride + column;
        if (!sim.beginGrab(index)) continue;
        const path = [[x, y], ...(plan.path ?? [plan.delta]).map(([dx, dy]) => [
          THREE.MathUtils.clamp(x + dx, 48, 976), THREE.MathUtils.clamp(y + dy, 160, 960)
        ])];
        grab = {
          startFrame: frame, durationFrames: plan.durationFrames, path,
          plane: new THREE.Plane().setFromNormalAndCoplanarPoint(f.camera.getWorldDirection(new THREE.Vector3()), hit.point),
          offset: new THREE.Vector3().fromArray(sim.positions, index * 3).sub(hit.point),
        };
        state.drags.push({ startFrame: frame, durationFrames: plan.durationFrames, region: plan.region,
          from: [x, y], to: path.at(-1), path, row, height: hit.point.y, birth, column });
        return;
      }
      throw new Error('Could not grab a visible cloth patch');
    }

    // Keep the experiment's title and collapsed UI in the export.
    function overlayText(element, text = element.textContent, center = false) {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
      ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing) * uiScale}px`;
      ctx.fillStyle = style.color;
      ctx.textAlign = center ? 'center' : 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, center ? rect.x + rect.width / 2 : rect.x, rect.y + rect.height / 2);
    }
    function drawOverlay() {
      ctx.save();
      ctx.globalCompositeOperation = 'color-burn';
      overlayText(document.querySelector('header div > span'));
      overlayText(document.querySelector('.instructions'));
      const title = document.querySelector('.lil-gui.root > .title');
      const rect = title.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(title).backgroundColor;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayText(title, '▸ SETTINGS', true);
      ctx.restore();
    }

    state.status = 'capturing';
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error('Capture cancelled');
      if (source.width !== 1024 || source.height !== 1024 || innerWidth !== 1024 || innerHeight !== 1024) {
        throw new Error('Viewport changed during capture; keep it at 1024 × 1024');
      }
      if (dragStartFrames.includes(frame)) beginDrag(frame);
      let cursor;
      if (grab && frame < grab.startFrame + grab.durationFrames) {
        const progress = (frame - grab.startFrame) / (grab.durationFrames - 1) * (grab.path.length - 1);
        const leg = Math.min(Math.floor(progress), grab.path.length - 2);
        const u = progress - leg;
        const ease = u * u * (3 - 2 * u);
        const from = grab.path[leg], to = grab.path[leg + 1];
        cursor = { x: THREE.MathUtils.lerp(from[0], to[0], ease), y: THREE.MathUtils.lerp(from[1], to[1], ease) };
        ray.setFromCamera(pointer.set(cursor.x / 512 - 1, 1 - cursor.y / 512), f.camera);
        if (!ray.ray.intersectPlane(grab.plane, point)) throw new Error('Drag ray missed plane');
        sim.moveGrab(point.add(grab.offset).toArray());
      }
      if (grab && frame === grab.startFrame + grab.durationFrames) {
        sim.endGrab();
        state.drags.at(-1).releaseFrame = frame;
        grab = null;
      }
      // Capture the initial state at t=0, then advance exactly 1/30 s per frame.
      if (frame > 0) f.sheet.update(1 / fps, f.settings);
      f.pipeline.render();
      // Snapshot the GPU canvas in the same task, before presentation clears it.
      ctx.drawImage(source, 0, 0);
      drawOverlay();
      if (cursor) {
        ctx.save(); ctx.strokeStyle = 'white'; ctx.lineWidth = 2;
        ctx.shadowColor = '#0008'; ctx.shadowBlur = 2;
        ctx.beginPath(); ctx.arc(cursor.x, cursor.y, 8, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(`Frame ${frame} could not be captured`);
      const receipt = await post(`/frame/${frame}`, blob);
      if (receipt.frame !== frame) throw new Error(`Incorrect acknowledgement for frame ${frame}`);
      state.frame = frame + 1;
    }
    state.status = 'encoding';
    if (state.drags.length !== dragStartFrames.length || state.drags.some((drag, i) => drag.startFrame !== dragStartFrames[i] || drag.releaseFrame !== drag.startFrame + drag.durationFrames)) {
      throw new Error('Drag schedule was not completed');
    }
    state.result = await post('/finish', JSON.stringify({ drags: state.drags, simulationTime: sim.time }));
    state.status = 'complete';
    return state.result;
  } catch (error) {
    state.status = state.cancelled ? 'cancelled' : 'failed';
    state.error = error.message;
    throw error;
  } finally {
    if (receiverStarted && state.status !== 'complete') {
      await post('/abort', '').catch(() => {});
    }
    f.drag.cancel();
    f.settings.pause = previous.pause;
    header.style.cssText = previous.headerStyle;
    panel.style.cssText = previous.panelStyle;
    panel.inert = previous.panelInert;
    source.style.pointerEvents = previous.pointerEvents;
    f.start();
  }
}
