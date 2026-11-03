import { Frustum, Matrix4 } from 'three/webgpu';

// Day 01's fixed-step PNG capture and scaled DOM-text overlay, adapted for
// the moving shatter scene. Render High at 1536², then downsample to 1024².
export async function captureVideo({ duration = 60, receiver = 'http://localhost:8003' } = {}) {
  const s = window.shatter;
  const fps = 30, size = 1024, totalFrames = duration * fps;
  const quality = 1.5, uiScale = Math.SQRT2;
  if (!s) throw new Error('Wait for the scene to load');
  if (innerWidth !== size || innerHeight !== size || devicePixelRatio !== 1) throw new Error('Set viewport to 1024 × 1024 at device scale 1');
  if (!Number.isInteger(totalFrames) || totalFrames < 1 || totalFrames > 108000) throw new Error('Invalid duration');
  if (['preparing', 'capturing', 'encoding'].includes(window.captureProgress?.status)) throw new Error('Capture already running');
  const state = window.captureProgress = { status: 'preparing', frame: 0, totalFrames, started: performance.now(), cancelled: false };
  const renderer = s.renderer, source = renderer.domElement;
  const header = document.querySelector('header'), panel = document.querySelector('.lil-gui.root');
  const previous = { loop: renderer.getAnimationLoop(), pause: s.settings.pause, controls: s.controls.enabled,
    quality: s.settings.quality, headerStyle: header.style.cssText, panelStyle: panel.style.cssText,
    panelInert: panel.inert, panelClosed: panel.classList.contains('closed'),
    pixelRatio: renderer.getPixelRatio(), width: source.clientWidth, height: source.clientHeight,
    aspect: s.camera.aspect, fov: s.camera.fov };
  const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const post = async (path, body) => {
    const response = await fetch(receiver + path, { method: 'POST', body });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  let started = false;
  try {
    renderer.setAnimationLoop(null);
    s.pause(true); s.controls.enabled = false;
    s.settings.quality = quality;
    renderer.setPixelRatio(quality); renderer.setSize(size, size, false);
    s.camera.aspect = 1; s.camera.fov = 42; s.camera.updateProjectionMatrix();
    s.settings.auto = true; s.settings.cycle = true;
    panel.inert = true; panel.classList.add('closed');
    header.style.zoom = panel.style.zoom = uiScale;
    header.style.left = panel.style.right = `${28 / uiScale}px`;
    header.style.top = `${24 / uiScale}px`;
    const heading = header.querySelector('span').getBoundingClientRect();
    const titleHeight = panel.querySelector(':scope > .title').getBoundingClientRect().height;
    panel.style.top = `${(heading.y + (heading.height - titleHeight) / 2) / uiScale}px`;
    s.reset();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    function overlayText(element, text = element.textContent, center = false) {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
      ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : `${parseFloat(style.letterSpacing) * uiScale}px`;
      ctx.fillStyle = style.color; ctx.textAlign = center ? 'center' : 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(text, center ? rect.x + rect.width / 2 : rect.x, rect.y + rect.height / 2);
    }
    function drawOverlay() {
      ctx.save();
      overlayText(header.querySelector('span')); overlayText(header.querySelector('p'));
      const title = panel.querySelector(':scope > .title'), rect = title.getBoundingClientRect();
      ctx.fillStyle = getComputedStyle(title).backgroundColor;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      overlayText(title, '▸ SETTINGS', true);
      ctx.restore();
    }
    // Initialize temporal buffers without advancing the simulation.
    for (let i = 0; i < 16; i++) { await nextFrame(); s.render(); }
    s.camera.updateMatrixWorld();
    const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(
      s.camera.projectionMatrix, s.camera.matrixWorldInverse), s.camera.coordinateSystem);
    const visibleObjects = s.rendering.scenePass.scene.children.filter(object =>
      object.isMesh && !object.userData.isFloor && object.visible && frustum.intersectsObject(object)).length;
    if (s.simulation.time !== 0 || visibleObjects !== 0) throw new Error('Capture must begin from an empty scene');
    await post('/start', JSON.stringify({ fps, totalFrames, width: size, height: size,
      settings: { ...s.settings, pause: false }, renderPixelRatio: quality, renderSize: source.width,
      overlays: true, uiScale, initialVisibleObjects: visibleObjects,
      initialSimulationTime: s.simulation.time,
      method: 'Fixed simulation steps, sequential lossless PNG frames, encoder backpressure' }));
    started = true; state.status = 'capturing';
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error('Capture cancelled');
      await nextFrame(); // Advance Three's frame clock for SSR/temporal passes.
      if (source.width !== size * quality || source.height !== size * quality) throw new Error('Canvas resized during capture');
      if (frame > 0) s.advance(s.settings.speed / fps);
      s.render();
      ctx.drawImage(source, 0, 0, size, size); // Snapshot before presentation clears WebGPU's canvas.
      drawOverlay();
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error(`Could not capture frame ${frame}`);
      const receipt = await post(`/frame/${frame}`, blob);
      if (receipt.frame !== frame) throw new Error('Frame receipt out of order');
      state.frame = frame + 1;
    }
    state.status = 'encoding';
    state.result = await post('/finish', JSON.stringify({ simulationTime: s.simulation.time,
      drops: s.drops, elapsedSeconds: (performance.now() - state.started) / 1000 }));
    state.status = 'complete';
    return state.result;
  } catch (error) {
    state.status = state.cancelled ? 'cancelled' : 'failed'; state.error = error.message;
    if (started) await post('/abort', '').catch(() => {});
    throw error;
  } finally {
    renderer.setPixelRatio(previous.pixelRatio); renderer.setSize(previous.width, previous.height, false);
    s.settings.quality = previous.quality;
    header.style.cssText = previous.headerStyle; panel.style.cssText = previous.panelStyle;
    panel.inert = previous.panelInert; panel.classList.toggle('closed', previous.panelClosed);
    s.camera.aspect = previous.aspect; s.camera.fov = previous.fov; s.camera.updateProjectionMatrix();
    s.controls.enabled = previous.controls; s.pause(previous.pause);
    renderer.setAnimationLoop(previous.loop);
  }
}
