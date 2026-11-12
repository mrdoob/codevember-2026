import {
  FPS,
  SIZE,
  DURATION,
  LOOP_BLEND_FRAMES,
  SEED,
  createDragSequence,
} from "./capture-sequence.js";
import { createCapturePointer } from "./capture-pointer.js";

const nextFrame = () => new Promise(requestAnimationFrame);
const png = (canvas) =>
  new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG capture failed")),
      "image/png",
    ),
  );

// Use a separate preview tab: the recording resets the physics sequence.
export function createCaptureSession({ renderSize = 1536 } = {}) {
  const app = window.rust;
  if (!app || !document.querySelector("#status").hidden)
    throw new Error("Wait for Rust to load");
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error("Use a 1024 × 1024 viewport at device scale 1");
  if (!Number.isInteger(renderSize) || renderSize < SIZE)
    throw new Error("Render size must be an integer of at least 1024");
  const { renderer, settings, gui } = app,
    source = renderer.domElement,
    header = document.querySelector("header"),
    panel = gui.domElement,
    previous = {
      settings: { ...settings },
      manual: app.manual,
      paused: app.paused,
      ratio: renderer.getPixelRatio(),
      width: source.width,
      height: source.height,
      headerStyle: header.style.cssText,
      panelStyle: panel.style.cssText,
      canvasStyle: source.style.cssText,
      panelInert: panel.inert,
      closed: gui._closed,
    };
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const uiScale = Math.SQRT2;
  const pointer = createCapturePointer(SIZE);
  let nextIndex = 0,
    sequence;

  app.manual = true;
  app.pause(false);
  Object.assign(settings, {
    auto: false,
    speed: 1,
    strength: 1,
    orbitSpeed: 2.5,
    resolution: renderSize / SIZE,
  });
  renderer.setPixelRatio(renderSize / SIZE);
  renderer.setSize(SIZE, SIZE, false);
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
    // Copy synchronously, before WebGPU presentation clears the source canvas.
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    ctx.save();
    text(header.querySelector("span"));
    text(panel.querySelector(":scope > .title"), "› SETTINGS", true);
    ctx.restore();
    pointer.draw(ctx, app.journey, app.camera);
  }
  function reset() {
    app.reset(SEED);
    app.pause(false);
    sequence = createDragSequence();
    pointer.clear();
    nextIndex = 0;
  }
  function advance() {
    sequence.update(app.journey);
    app.advance(1 / FPS);
  }
  reset();
  return {
    app,
    canvas,
    pointer,
    get events() {
      return sequence.events;
    },
    reset,
    async preview(frame) {
      reset();
      for (let i = 0; i < frame; i++) advance();
      await nextFrame();
      app.render();
      snapshot();
      return { frame, events: sequence.events, state: app.inspect() };
    },
    async warmup() {
      await nextFrame();
      app.render();
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
      if (frame > 0) advance();
      await nextFrame();
      app.render();
      snapshot();
      nextIndex++;
      return app.journey.current.index;
    },
    async restore() {
      app.journey.current.simulation.endDrag();
      Object.assign(settings, previous.settings);
      renderer.setPixelRatio(previous.ratio);
      renderer.setSize(
        previous.width / previous.ratio,
        previous.height / previous.ratio,
        false,
      );
      header.style.cssText = previous.headerStyle;
      panel.style.cssText = previous.panelStyle;
      source.style.cssText = previous.canvasStyle;
      panel.inert = previous.panelInert;
      gui.close(previous.closed);
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      app.pause(previous.paused);
      await nextFrame();
      app.render();
      app.manual = previous.manual;
    },
  };
}

export async function captureVideo({
  receiver = "http://localhost:8022",
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
        overlays: "Title, collapsed settings, and a circular drag indicator",
        cursor: false,
        dragIndicator:
          "One circle follows the drag target, fills while held, and expands on release",
        audio: false,
        seed: SEED,
        settings: { ...session.app.settings },
        loopBlendFrames: LOOP_BLEND_FRAMES,
        method:
          "Fixed 30 Hz timeline, physical grabbed-point drags, supersampled rendering, ordered lossless PNG frames with encoder backpressure",
      }),
    );
    started = true;
    state.status = "capturing";
    for (let frame = 0; frame < totalFrames; frame++) {
      if (state.cancelled) throw new Error("Capture cancelled");
      state.mine = await session.draw(frame);
      const receipt = await post(`/frame/${frame}`, await png(session.canvas));
      if (receipt.frame !== frame)
        throw new Error("Out-of-order frame receipt");
      state.frame = frame + 1;
    }
    const validation = await device.popErrorScope();
    errorScope = false;
    if (validation) throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = "encoding";
    state.result = await post(
      "/finish",
      JSON.stringify({
        elapsedSeconds: (performance.now() - state.started) / 1000,
        events: session.events,
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
