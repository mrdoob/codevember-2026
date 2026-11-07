import {
  FPS,
  DURATION,
  SHOTS,
  createSequence,
  applyFrame,
  smootherstep,
} from "./capture-sequence.js";

const SIZE = 1024;
const nextFrame = () => new Promise(requestAnimationFrame);

// Kept outside the interactive application, like the captures for days 01–05.
// Native Clockwork and glass-highlight easing are sampled at exactly 30 Hz.
export function createCaptureSession({ renderSize = 1536 } = {}) {
  const app = window.orrery;
  if (!app || !document.querySelector("#status").hidden)
    throw new Error("Wait for the experiment to finish loading");
  if (innerWidth !== SIZE || innerHeight !== SIZE || devicePixelRatio !== 1)
    throw new Error("Use a 1024 × 1024 viewport at device scale 1");
  const { camera, controls, renderer, settings, clock, studio, model, gui } =
    app;
  const source = renderer.domElement;
  const elements = [
    document.querySelector("header"),
    gui.domElement,
    document.querySelector("#effect-controls"),
    document.querySelector("#light-controls"),
  ];
  const buttons = [...document.querySelectorAll(".effect-row button")];
  const previous = {
    settings: { ...settings },
    clock: { ...clock },
    manual: app.manual,
    position: camera.position.clone(),
    target: controls.target.clone(),
    aspect: camera.aspect,
    fov: camera.fov,
    enabled: controls.enabled,
    autoRotate: controls.autoRotate,
    damping: controls.enableDamping,
    pixelRatio: renderer.getPixelRatio(),
    width: source.width,
    height: source.height,
    time: studio.foliage.time.value,
    previousTime: studio.foliage.previousTime.value,
    styles: elements.map((e) => e.style.cssText),
    closed: gui.domElement.classList.contains("closed"),
    pressed: buttons.map((b) => b.getAttribute("aria-pressed")),
    highlights: model.planets.map((p) => ({
      dragged: p.body.userData.isDragged,
      hovered: p.body.userData.isHovered,
      value: p.body.userData.dragHighlight,
    })),
  };
  const sequence = createSequence();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const uiScale = Math.SQRT2;
  app.manual = true;
  app.winding.cancel();
  Object.assign(settings, {
    pause: true,
    autoOrbit: false,
    compare: false,
    ssgi: true,
    ssr: true,
    denoise: true,
    dof: true,
  });
  controls.enabled = controls.autoRotate = controls.enableDamping = false;
  renderer.setPixelRatio(renderSize / SIZE);
  renderer.setSize(SIZE, SIZE, false);
  camera.aspect = 1;
  camera.fov = 42;
  camera.updateProjectionMatrix();
  gui.close();
  elements.forEach((e) => (e.style.zoom = uiScale));
  elements[0].style.left = elements[2].style.left = `${28 / uiScale}px`;
  elements[1].style.right = elements[3].style.right = `${28 / uiScale}px`;
  elements[0].style.top = `${24 / uiScale}px`;
  elements[1].style.top = `${19 / uiScale}px`;
  elements[2].style.bottom = elements[3].style.bottom = `${23 / uiScale}px`;
  document
    .querySelector("#compare-toggle")
    .setAttribute("aria-pressed", "false");
  for (const id of ["ssgi-toggle", "ssr-toggle"])
    document.getElementById(id).setAttribute("aria-pressed", "true");
  app.post.invalidate();

  function text(element, label = element.textContent.trim(), center = false) {
    const rect = element.getBoundingClientRect(),
      style = getComputedStyle(element);
    ctx.save();
    ctx.font = `${style.fontWeight} ${parseFloat(style.fontSize) * uiScale}px ${style.fontFamily}`;
    ctx.letterSpacing =
      style.letterSpacing === "normal"
        ? "0px"
        : `${parseFloat(style.letterSpacing) * uiScale}px`;
    ctx.fillStyle = style.color;
    ctx.globalAlpha = Number(style.opacity);
    ctx.shadowColor = "#20190f99";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.textAlign = center ? "center" : "left";
    ctx.textBaseline = "middle";
    const x = center ? rect.x + rect.width / 2 : rect.x,
      y = rect.y + rect.height / 2;
    ctx.fillText(label, x, y);
    if (element.getAttribute("aria-pressed") === "true") {
      ctx.strokeStyle = style.color;
      ctx.lineWidth = 1;
      const width = ctx.measureText(label).width;
      const left = center ? x - width / 2 : x;
      ctx.beginPath();
      ctx.moveTo(left, y + 12);
      ctx.lineTo(left + width, y + 12);
      ctx.stroke();
    }
    ctx.restore();
  }
  function snapshot(frame) {
    ctx.drawImage(source, 0, 0, SIZE, SIZE);
    text(elements[0].querySelector("span"));
    text(elements[0].querySelector("p"));
    text(gui.domElement.querySelector(":scope > .title"), "› SETTINGS", true);
    for (const button of buttons)
      text(button, button.textContent.trim(), true);
    if (frame.turn) {
      const age = frame.time - frame.turn.start;
      if (age < 0.8) {
        const p = model.planets[frame.turn.planet].body
          .getWorldPosition(camera.position.clone())
          .project(camera);
        const progress = smootherstep(0, 0.8, age);
        ctx.save();
        ctx.globalAlpha = (1 - progress) * 0.8;
        ctx.strokeStyle = "#fff9ed";
        ctx.lineWidth = 1.5;
        ctx.shadowColor = "#20190f99";
        ctx.shadowBlur = 3;
        ctx.beginPath();
        ctx.arc(
          (p.x * 0.5 + 0.5) * SIZE,
          (-p.y * 0.5 + 0.5) * SIZE,
          9 + progress * 17,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
        ctx.restore();
      }
    }
  }
  let previousShaftMode, previousShot;
  async function draw(frame, settle = 0) {
    applyFrame(app, frame);
    if (previousShot !== undefined && frame.shot !== previousShot) {
      app.post.invalidate();
      settle = Math.max(settle, 32);
    }
    previousShot = frame.shot;
    const shaftMode = frame.daylight < 1;
    // Changing between Day and Night rebuilds the effect graph and resets its
    // temporal histories. Converge them off-camera before saving this frame.
    if (previousShaftMode !== undefined && shaftMode !== previousShaftMode)
      settle = Math.max(settle, 32);
    previousShaftMode = shaftMode;
    for (let i = 0; i < settle; i++) {
      await nextFrame();
      app.render();
    }
    await nextFrame();
    app.render();
    // Copy before presentation clears the WebGPU canvas. PNG encoding and the
    // receiver's ordered acknowledgements impose backpressure on every frame.
    snapshot(frame);
  }
  return {
    app,
    canvas,
    sequence,
    renderSize,
    draw,
    async warmup() {
      for (const time of [0, 14, 24, 35, 45, 56]) {
        app.post.invalidate();
        await draw(sequence.frames[Math.round(time * FPS)], 4);
      }
      // Establish moving temporal histories across the actual loop boundary.
      app.post.invalidate();
      for (const frame of sequence.frames.slice(-64)) await draw(frame);
      await renderer.backend.device.queue.onSubmittedWorkDone();
    },
    restore() {
      Object.assign(settings, previous.settings);
      Object.assign(clock, previous.clock);
      renderer.setPixelRatio(previous.pixelRatio);
      renderer.setSize(
        previous.width / previous.pixelRatio,
        previous.height / previous.pixelRatio,
        false,
      );
      camera.position.copy(previous.position);
      controls.target.copy(previous.target);
      controls.update(0);
      controls.enabled = previous.enabled;
      controls.autoRotate = previous.autoRotate;
      controls.enableDamping = previous.damping;
      camera.aspect = previous.aspect;
      camera.fov = previous.fov;
      camera.updateProjectionMatrix();
      studio.foliage.time.value = previous.time;
      studio.foliage.previousTime.value = previous.previousTime;
      model.planets.forEach((p, i) =>
        Object.assign(p.body.userData, {
          isDragged: previous.highlights[i].dragged,
          isHovered: previous.highlights[i].hovered,
          dragHighlight: previous.highlights[i].value,
        }),
      );
      elements.forEach((e, i) => (e.style.cssText = previous.styles[i]));
      if (!previous.closed) gui.open();
      buttons.forEach((b, i) => {
        if (previous.pressed[i] !== null)
          b.setAttribute("aria-pressed", previous.pressed[i]);
      });
      app.post.invalidate();
      app.manual = previous.manual;
      app.render();
    },
  };
}

export async function captureVideo({
  receiver = "http://localhost:8016",
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
    totalFrames: DURATION * FPS,
    started: performance.now(),
    cameraFrames: [],
    cancelled: false,
    cancel() {
      this.cancelled = true;
    },
  });
  const { app, sequence, canvas } = session;
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
    await post(
      "/start",
      JSON.stringify({
        fps: FPS,
        totalFrames: state.totalFrames,
        width: SIZE,
        height: SIZE,
        renderSize,
        duration: DURATION,
        uiScale: Math.SQRT2,
        overlays: true,
        cursor: false,
        clickIndicators: true,
        settings: { ...app.settings, pause: false },
        shots: SHOTS,
        turns: sequence.turns,
        orbitDegrees: 360,
        warmupFrames: 64,
        lightingSwitchSettlingFrames: 32,
        cameraCutSettlingFrames: 32,
        cameraCuts: SHOTS.slice(1).map((shot) => shot.start),
        cameraMotion:
          "Instant view changes with continuous orbit within each shot",
        loop: "Periodic camera, shared mechanical drive, wind, lighting and highlight states; last-to-first motion stays continuous",
        interaction:
          "Five authored turns through the native Clockwork easing; all carriers remain coupled",
        method:
          "Fixed simulation steps, supersampled rendering, ordered PNG frames and encoder backpressure",
      }),
    );
    started = true;
    state.status = "capturing";
    for (let index = 0; index < sequence.frames.length; index++) {
      if (state.cancelled) throw new Error("Capture cancelled");
      if (
        innerWidth !== SIZE ||
        innerHeight !== SIZE ||
        app.renderer.domElement.width !== renderSize
      )
        throw new Error("Canvas resized during capture");
      const frame = sequence.frames[index];
      await session.draw(frame);
      const blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error("PNG capture failed")),
          "image/png",
        ),
      );
      const receipt = await post(`/frame/${index}`, blob);
      if (receipt.frame !== index)
        throw new Error("Out-of-order frame receipt");
      state.frame = index + 1;
      if (index % FPS === 0 || index === sequence.frames.length - 1)
        state.cameraFrames.push({
          frame: index,
          ...frame,
          turn: frame.turn?.planet ?? null,
        });
    }
    const validation = await device.popErrorScope();
    errorScope = false;
    if (validation)
      throw new Error(`WebGPU validation: ${validation.message}`);
    state.status = "encoding";
    state.result = await post(
      "/finish",
      JSON.stringify({
        cameraFrames: state.cameraFrames,
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
    session.restore();
  }
}
