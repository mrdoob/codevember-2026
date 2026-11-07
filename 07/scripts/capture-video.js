import {
  FPS,
  SIZE,
  CYCLE_LENGTH,
  DURATION,
  TOTAL_FRAMES,
  WARMUP_FRAMES,
  SHOTS,
  frameAt,
} from "./capture-sequence.js";

const nextFrame = () => new Promise(requestAnimationFrame);
const captureOptions = {
  cycleLength: CYCLE_LENGTH,
  cameraTurn: { x: 0, y: 0 },
};
const png = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG capture failed")),
      "image/png",
    ),
  );

function compareFrames(a, b) {
  let sum = 0,
    maximum = 0,
    changedPixels = 0;
  for (let i = 0; i < a.length; i += 4) {
    let changed = false;
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a[i + c] - b[i + c]);
      sum += delta;
      maximum = Math.max(maximum, delta);
      changed ||= delta > 0;
    }
    if (changed) changedPixels++;
  }
  return { meanAbsolute: sum / ((a.length / 4) * 3), maximum, changedPixels };
}

// Like previous days, render fixed-time frames and copy the WebGPU canvas
// before presentation. Encoding speed never affects the animation timeline.
export function createCaptureSession({ renderSize = 1536 } = {}) {
  const app = window.hollow;
  if (!app || !document.querySelector("#status").hidden)
    throw new Error("Wait for the experiment to finish loading");
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error("Use a 1024 × 1024 viewport at device scale 1");
  if (!Number.isInteger(renderSize) || renderSize < SIZE)
    throw new Error("Render size must be an integer of at least 1024");
  const { camera, renderer, settings, journey, studio, gui } = app;
  const source = renderer.domElement;
  const header = document.querySelector("header"),
    panel = gui.domElement;
  const previous = {
    settings: { ...settings },
    journey: { ...journey },
    manual: app.manual,
    aspect: camera.aspect,
    fov: camera.fov,
    studioAspect: studio.aspect.value,
    pixelRatio: renderer.getPixelRatio(),
    width: source.width,
    height: source.height,
    headerStyle: header.style.cssText,
    panelStyle: panel.style.cssText,
    panelInert: panel.inert,
    panelClosed: panel.classList.contains("closed"),
    canvasStyle: source.style.cssText,
  };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const uiScale = Math.SQRT2;

  app.manual = true;
  journey.paused = true;
  Object.assign(settings, {
    speed: 1,
    orbit: true,
    reflections: true,
    depthOfField: true,
    resolution: renderSize / SIZE,
  });
  renderer.setPixelRatio(renderSize / SIZE);
  renderer.setSize(SIZE, SIZE, false);
  camera.aspect = studio.aspect.value = 1;
  camera.fov = 40;
  camera.updateProjectionMatrix();
  gui.close();
  panel.inert = true;
  source.style.pointerEvents = "none";
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
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save();
    text(header.querySelector("span"));
    text(header.querySelector("p"));
    const title = panel.querySelector(":scope > .title"),
      rect = title.getBoundingClientRect();
    ctx.fillStyle = getComputedStyle(panel).backgroundColor;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    text(title, "› SETTINGS", true);
    ctx.restore();
  }
  async function draw(frame) {
    if (
      innerWidth !== SIZE ||
      innerHeight !== SIZE ||
      source.width !== renderSize ||
      source.height !== renderSize
    )
      throw new Error("Canvas resized during capture");
    if (!document.querySelector("#status").hidden)
      throw new Error(document.querySelector("#status").textContent);
    await nextFrame();
    journey.seek(frameAt(frame).depth);
    app.render(captureOptions);
    snapshot();
  }
  async function warmBoundary(frame = 0) {
    for (let i = frame - WARMUP_FRAMES; i < frame; i++) await draw(i);
    await renderer.backend.device.queue.onSubmittedWorkDone();
  }
  const pixels = () => ctx.getImageData(0, 0, SIZE, SIZE).data;
  return {
    app,
    canvas,
    renderSize,
    draw,
    pixels,
    warmBoundary,
    async warmup() {
      // Compile all geometry/material combinations before saving frames.
      for (const shot of SHOTS) await draw(shot.startFrame + 75);
      await warmBoundary();
    },
    async verifyLoop() {
      await warmBoundary();
      await draw(0);
      const first = pixels();
      await warmBoundary(TOTAL_FRAMES);
      await draw(TOTAL_FRAMES);
      const result = compareFrames(first, pixels());
      if (result.meanAbsolute > 0.01)
        throw new Error(
          `Loop endpoint differs from frame zero: ${JSON.stringify(result)}`,
        );
      return result;
    },
    restore() {
      Object.assign(settings, previous.settings);
      Object.assign(journey, previous.journey);
      renderer.setPixelRatio(previous.pixelRatio);
      renderer.setSize(
        previous.width / previous.pixelRatio,
        previous.height / previous.pixelRatio,
        false,
      );
      camera.aspect = previous.aspect;
      camera.fov = previous.fov;
      camera.updateProjectionMatrix();
      studio.aspect.value = previous.studioAspect;
      header.style.cssText = previous.headerStyle;
      panel.style.cssText = previous.panelStyle;
      panel.inert = previous.panelInert;
      source.style.cssText = previous.canvasStyle;
      if (!previous.panelClosed) gui.open();
      for (const slot of app.shells.slots) slot.probeReady = false;
      app.manual = previous.manual;
      app.render();
    },
  };
}

export async function captureVideo({
  receiver = "http://localhost:8017",
  renderSize = 1536,
} = {}) {
  if (
    ["preparing", "capturing", "encoding"].includes(
      window.captureProgress?.status,
    )
  )
    throw new Error("A capture is already running");
  const session = createCaptureSession({ renderSize });
  const state = (window.captureProgress = {
    status: "preparing",
    frame: 0,
    totalFrames: TOTAL_FRAMES,
    started: performance.now(),
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  });
  const { app, canvas } = session;
  const device = app.renderer.backend.device;
  const post = async (path, body) => {
    const response = await fetch(receiver + path, { method: "POST", body });
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
    state.loopPreflight = await session.verifyLoop();
    await session.warmBoundary();
    await post(
      "/start",
      JSON.stringify({
        fps: FPS,
        totalFrames: TOTAL_FRAMES,
        width: SIZE,
        height: SIZE,
        renderSize,
        duration: DURATION,
        uiScale: Math.SQRT2,
        overlays: true,
        cursor: false,
        settings: { ...app.settings },
        shots: SHOTS,
        orbitDegrees: 360,
        warmupFrames: WARMUP_FRAMES,
        loop: "Periodic appearance seeds, edge hinges, orbit and camera sway; preceding frames initialize reflection and shadow history",
        endpointIncluded: false,
        crossfadeFrames: 0,
        method:
          "Fixed 30 Hz timeline, supersampled rendering, ordered lossless PNG frames with encoder backpressure",
      }),
    );
    started = true;
    state.status = "capturing";
    let first, second, previous, last;
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      if (state.cancelled) throw new Error("Capture cancelled");
      await session.draw(frame);
      if (frame === 0) first = session.pixels();
      if (frame === 1) second = session.pixels();
      if (frame === TOTAL_FRAMES - 2) previous = session.pixels();
      if (frame === TOTAL_FRAMES - 1) last = session.pixels();
      const receipt = await post(`/frame/${frame}`, await png(canvas));
      if (receipt.frame !== frame)
        throw new Error("Out-of-order frame receipt");
      state.frame = frame + 1;
      state.shape = frameAt(frame).shape;
    }
    // The endpoint is tested but omitted from the video, avoiding a held frame.
    await session.draw(TOTAL_FRAMES);
    const endpoint = compareFrames(first, session.pixels());
    if (endpoint.meanAbsolute > 0.01)
      throw new Error(`Loop validation failed: ${JSON.stringify(endpoint)}`);
    const validation = await device.popErrorScope();
    errorScope = false;
    if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = "encoding";
    state.result = await post(
      "/finish",
      JSON.stringify({
        elapsedSeconds: (performance.now() - state.started) / 1000,
        allShapes: SHOTS.map((shot) => shot.shape),
        loopSeam: {
          endpoint,
          closingStep: compareFrames(last, first),
          openingStep: compareFrames(first, second),
          previousStep: compareFrames(previous, last),
          lastSourceFrame: TOTAL_FRAMES - 1,
          firstSourceFrame: 0,
        },
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
    session.restore();
  }
}
