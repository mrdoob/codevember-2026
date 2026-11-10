import { FPS, SIZE, DURATION, SHOTS, frameAt } from "./capture-sequence.js";

const nextFrame = () => new Promise(requestAnimationFrame);
const png = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG capture failed")),
      "image/png",
    ),
  );

export function createCaptureSession({ renderSize = 1536 } = {}) {
  const app = window.caustic;
  if (!app || !document.querySelector("#status").hidden)
    throw new Error("Wait for Caustic to load");
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error("Use a 1024 × 1024 viewport at device scale 1");
  if (!Number.isInteger(renderSize) || renderSize < SIZE)
    throw new Error("Render size must be an integer of at least 1024");
  const { camera, renderer, controls, gui, settings } = app;
  const source = renderer.domElement;
  const header = document.querySelector("header"),
    footer = document.querySelector("footer"),
    panel = gui.domElement;
  const previous = {
    settings: { ...settings },
    state: app.inspect(),
    manual: app.manual,
    ripples: app.optics.ripples.map((r) => r.value.clone()),
    position: camera.position.clone(),
    target: controls.target.clone(),
    quaternion: camera.quaternion.clone(),
    aspect: camera.aspect,
    fov: camera.fov,
    controlsEnabled: controls.enabled,
    autoRotate: controls.autoRotate,
    autoRotateSpeed: controls.autoRotateSpeed,
    damping: controls.enableDamping,
    pixelRatio: renderer.getPixelRatio(),
    width: source.width,
    height: source.height,
    headerHidden: header.hidden,
    panelHidden: panel.hidden,
    headerStyle: header.style.cssText,
    footerStyle: footer.style.cssText,
    panelStyle: panel.style.cssText,
    panelInert: panel.inert,
    panelClosed: gui._closed,
    canvasStyle: source.style.cssText,
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const uiScale = Math.SQRT2;
  let nextIndex = 0,
    currentShot = -1;

  app.manual = true;
  app.pause(false);
  Object.assign(settings, {
    speed: 1,
    autoOrbit: false,
    float: true,
    fish: true,
    resolution: renderSize / SIZE,
  });
  controls.enabled = controls.autoRotate = controls.enableDamping = false;
  controls.update(0);
  renderer.setPixelRatio(renderSize / SIZE);
  renderer.setSize(SIZE, SIZE, false);
  camera.aspect = 1;
  app.cameraViews.resize();
  app.post.invalidate();
  gui.close();
  header.hidden = panel.hidden = false;
  panel.inert = true;
  source.style.pointerEvents = "none";
  footer.style.visibility = "hidden";
  header.style.zoom = panel.style.zoom = uiScale;
  header.style.left = panel.style.right = `${28 / uiScale}px`;
  header.style.top = `${24 / uiScale}px`;
  panel.style.top = `${20 / uiScale}px`;

  function text(element, label = element.textContent.trim(), center = false) {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing =
      style.letterSpacing === "normal"
        ? "0px"
        : `${parseFloat(style.letterSpacing) * uiScale}px`;
    ctx.fillStyle = style.color;
    ctx.textAlign = center ? "center" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(
      label,
      center ? rect.x + rect.width / 2 : rect.x,
      rect.y + rect.height / 2,
    );
  }
  function snapshot() {
    // Copy immediately, before presentation clears the WebGPU canvas.
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save();
    text(header.querySelector("span"));
    text(header.querySelector("p"));
    text(panel.querySelector(":scope > .title"), "› SETTINGS", true);
    ctx.restore();
  }
  function selectShot(view) {
    if (view.index === currentShot) return false;
    app.marine.update(app.inspect().time, settings);
    app.setView(view.shot.name);
    currentShot = view.index;
    return true;
  }
  async function settle() {
    // Converge SSR at the cut without advancing the simulation or encoding
    // duplicate frames. Subsequent frames retain actual swimming motion.
    for (let i = 0; i < 16; i++) {
      await nextFrame();
      app.render();
    }
  }
  function reset() {
    app.reset();
    app.pause(false);
    nextIndex = 0;
    currentShot = -1;
  }
  async function preview(frame) {
    reset();
    // Replay clock/contact events at the output rate, without rendering.
    for (let i = 0; i < frame; i++) app.advance(1 / FPS);
    const view = frameAt(frame);
    selectShot(view);
    if (!app.cameraViews.following) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = -settings.orbitSpeed;
      controls.update((frame - view.shot.startFrame) / FPS);
      controls.autoRotate = false;
    }
    await settle();
    snapshot();
    return view;
  }
  return {
    app,
    canvas,
    renderSize,
    reset,
    preview,
    async warmup() {
      await preview(0);
      await renderer.backend.device.queue.onSubmittedWorkDone();
      reset();
    },
    async draw(frame) {
      if (frame !== nextIndex)
        throw new Error(`Expected frame ${nextIndex}; received ${frame}`);
      if (
        innerWidth !== SIZE ||
        innerHeight !== SIZE ||
        source.width !== renderSize ||
        source.height !== renderSize
      )
        throw new Error("Canvas resized during capture");
      if (frame > 0) app.advance(1 / FPS);
      const view = frameAt(frame);
      if (selectShot(view)) await settle();
      else if (!app.cameraViews.following) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = -settings.orbitSpeed;
        controls.update(1 / FPS);
        controls.autoRotate = false;
      }
      await nextFrame();
      app.render();
      snapshot();
      nextIndex++;
      return view;
    },
    async restore() {
      // Restore both clocks, then put back the original ripple packets.
      app.reset();
      app.pause(false);
      settings.speed = 1;
      const initialFloatTime = app.inspect().floatTime;
      const floatDelta = Math.max(
        0,
        previous.state.floatTime - initialFloatTime,
      );
      settings.float = true;
      app.advance(floatDelta);
      settings.float = false;
      app.advance(Math.max(0, previous.state.time - floatDelta));
      app.optics.ripples.forEach((r, i) => r.value.copy(previous.ripples[i]));
      Object.assign(settings, previous.settings);
      app.marine.update(previous.state.time, settings);
      app.setView(previous.state.viewName);
      app.pause(previous.state.paused);
      controls.enabled = previous.controlsEnabled;
      controls.autoRotate = previous.autoRotate;
      controls.autoRotateSpeed = previous.autoRotateSpeed;
      controls.enableDamping = previous.damping;
      renderer.setPixelRatio(previous.pixelRatio);
      renderer.setSize(
        previous.width / previous.pixelRatio,
        previous.height / previous.pixelRatio,
        false,
      );
      camera.aspect = previous.aspect;
      camera.fov = previous.fov;
      camera.position.copy(previous.position);
      camera.quaternion.copy(previous.quaternion);
      controls.target.copy(previous.target);
      camera.updateProjectionMatrix();
      header.hidden = previous.headerHidden;
      panel.hidden = previous.panelHidden;
      header.style.cssText = previous.headerStyle;
      footer.style.cssText = previous.footerStyle;
      panel.style.cssText = previous.panelStyle;
      panel.inert = previous.panelInert;
      source.style.cssText = previous.canvasStyle;
      gui.close(previous.panelClosed);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      app.room.sun.shadow.needsUpdate = true;
      app.post.invalidate();
      app.changed();
      await nextFrame();
      app.render();
      app.manual = previous.manual;
    },
  };
}

export async function captureVideo({
  receiver = "http://localhost:8021",
  renderSize = 1536,
  duration = DURATION,
} = {}) {
  if (
    ["preparing", "capturing", "encoding"].includes(
      window.captureProgress?.status,
    )
  )
    throw new Error("A capture is already running");
  const totalFrames = Math.round(duration * FPS);
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > DURATION ||
    Math.abs(totalFrames / FPS - duration) > 1e-8
  )
    throw new RangeError(
      "Duration must be within the sequence and use whole frames",
    );
  const session = createCaptureSession({ renderSize });
  const state = (window.captureProgress = {
    status: "preparing",
    frame: 0,
    totalFrames,
    started: performance.now(),
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  });
  const device = session.app.renderer.backend.device;
  const post = async (path, body) => {
    const response = await fetch(receiver + path, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(120000),
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error || `Capture receiver: ${response.status}`);
    return result;
  };
  let started = false,
    errorScope = false;
  try {
    device.pushErrorScope("validation");
    errorScope = true;
    await session.warmup();
    if (state.cancelled) throw new Error("Capture cancelled");
    await post(
      "/start",
      JSON.stringify({
        fps: FPS,
        totalFrames,
        width: SIZE,
        height: SIZE,
        renderSize,
        duration,
        uiScale: Math.SQRT2,
        overlays: "Title, description, and collapsed settings",
        cursor: false,
        audio: false,
        settings: { ...session.app.settings },
        shots: SHOTS.filter((shot) => shot.startFrame < totalFrames),
        crossfadeFrames: 0,
        simulation: "Continuous across hard cuts; reset once before frame zero",
        method:
          "Fixed 30 Hz timeline, supersampled rendering, ordered lossless PNG frames with encoder backpressure",
      }),
    );
    started = true;
    state.status = "capturing";
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error("Capture cancelled");
      const view = await session.draw(frame);
      const receipt = await post(`/frame/${frame}`, await png(session.canvas));
      if (receipt.frame !== frame)
        throw new Error("Out-of-order frame receipt");
      state.frame = frame + 1;
      state.shot = view.shot.name;
    }
    const validation = await device.popErrorScope();
    errorScope = false;
    if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = "encoding";
    state.result = await post(
      "/finish",
      JSON.stringify({
        elapsedSeconds: (performance.now() - state.started) / 1000,
      }),
    );
    state.status = "complete";
    return state.result;
  } catch (error) {
    state.status = state.cancelled ? "cancelled" : "failed";
    state.error = error.message;
    if (started) await post("/abort", "").catch(() => {});
    throw error;
  } finally {
    if (errorScope) await device.popErrorScope();
    await session.restore();
  }
}
