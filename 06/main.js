import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Clockwork } from "./motion.js";
import { DaylightTransition } from "./lighting-transition.js";
import { createMaterials } from "./materials.js";
import { createOrrery } from "./orrery.js";
import { createStudio } from "./studio.js";
import { createPostProcessing } from "./post-processing.js";
import { createWinding } from "./winding.js";
import { createGlassSystem } from "./glass.js";
import { createSettings, createSettingsPanel } from "./settings.js";
import {
  prepareSurfaceTextures,
  disposeSurfaceTextures,
} from "./surface-materials.js";

export async function startExperiment() {
  const canvas = document.querySelector("canvas"),
    status = document.querySelector("#status");
  const abort = new AbortController(),
    signal = abort.signal;
  const reducedMotion = matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const cameraViews = {
    Instrument: { target: [0, 5.15, 0], position: [0, 7.5, 19.3] },
    "Three-quarter": { target: [0, 5.15, 0], position: [12, 7.5, 15] },
    Planets: { target: [0, 5.6, 0], position: [4.8, 7, 12] },
    Mechanism: { target: [0, 4.1, 0], position: [3.5, 5.4, 5.2] },
    Desk: { target: [0, 1.6, 0], position: [6, 3.4, 10.8] },
    Overhead: { target: [0, 3.5, 0], position: [8.5, 15.5, 10.5] },
    Reverse: { target: [0, 5.15, 0], position: [-10, 7, -16.5] },
    Side: { target: [0, 5.15, 0], position: [19.3, 6.2, 0] },
  };
  const cameraViewNames = Object.keys(cameraViews);
  const settings = createSettings(reducedMotion);
  let renderer, materials, model, studio, post, controls, winding, glass, gui;
  let frame = 0,
    stopped = false,
    dirty = true,
    lastTime = null,
    manual = false,
    settling = 32;
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(
      42,
      innerWidth / innerHeight,
      0.1,
      200,
    );
  const clock = new Clockwork();
  const daylightTransition = new DaylightTransition(settings.daylight);
  clock.speed = settings.speed;
  clock.paused = settings.pause;
  const changed = () => {
    dirty = true;
    settling = 32;
  };
  function stop(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    abort.abort();
    winding?.dispose();
    controls?.dispose();
    gui?.destroy();
    post?.dispose();
    glass?.dispose();
    model?.dispose();
    studio?.dispose();
    materials?.dispose();
    disposeSurfaceTextures();
    renderer?.dispose().catch((e) => console.warn("Renderer cleanup:", e));
    if (error) {
      status.hidden = false;
      status.textContent = `Stopped: ${error.message}`;
      console.error(error);
    }
  }
  try {
    if (!navigator.gpu) throw new Error("This experiment requires WebGPU.");
    renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
    renderer._getFallback = null;
    renderer.onDeviceLost = (info) =>
      stop(new Error(`Graphics device lost: ${info.message}`));
    renderer.onError = (info) =>
      stop(new Error(info.message || "Graphics error"));
    await renderer.init();
    if (!renderer.hasFeature("rg11b10ufloat-renderable"))
      throw new Error(
        "This GPU does not support the render-target format required by SSGI.",
      );
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.info.autoReset = false;
    renderer.setPixelRatio(2);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    prepareSurfaceTextures(renderer);
    materials = createMaterials();
    model = createOrrery(materials);
    scene.add(model.group);
    studio = createStudio(scene, renderer, model);
    glass = createGlassSystem();
    for (const { body } of model.planets)
      glass.attach(
        body,
        body.material.color,
        body.geometry.parameters.radius,
      );
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 6;
    controls.minPolarAngle = 0.28;
    controls.maxPolarAngle = 1.92;
    controls.autoRotateSpeed = 0.5;
    controls.zoomSpeed = 0.65;
    function setView(view = "Instrument") {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.update(0);
      settings.cameraView = view;
      const framing = cameraViews[view];
      controls.target.fromArray(framing.target);
      camera.position.fromArray(framing.position);
      controls.maxDistance = 19.8;
      controls.update(0);
      camera.updateMatrixWorld();
      controls.enableDamping = damping;
      const next =
        cameraViewNames[
          (cameraViewNames.indexOf(view) + 1) % cameraViewNames.length
        ];
      const cameraButton = document.querySelector("#camera-view");
      cameraButton.title = `Change view: ${view}. Next: ${next}.`;
      cameraButton.setAttribute("aria-label", cameraButton.title);
      post?.invalidate();
      changed();
    }
    function resetView() {
      setView("Instrument");
    }
    resetView();
    controls.addEventListener("change", changed);
    post = createPostProcessing(
      renderer,
      scene,
      camera,
      studio.caustics,
      studio.foliage.time,
    );
    function resize() {
      camera.aspect = innerWidth / innerHeight;
      const scale = Math.max(1, 0.92 / camera.aspect);
      camera.fov = THREE.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(42 / 2)) * scale),
      );
      camera.updateProjectionMatrix();
      // Widen the portrait lens instead of moving through the room's walls.
      scene.fog.near = 100;
      scene.fog.far = 200;
      controls.maxDistance = 19.8;
      renderer.setSize(innerWidth, innerHeight);
      changed();
    }
    resize();
    function pause(value = !settings.pause) {
      settings.pause = value;
      clock.paused = value;
      lastTime = null;
      changed();
    }
    function resetMechanism() {
      winding.cancel();
      clock.reset();
      studio.foliage.reset();
      post.invalidate();
      changed();
    }
    function reset() {
      resetMechanism();
      resetView();
    }
    function sync() {
      clock.speed = settings.speed;
      clock.paused = settings.pause;
      model.update(clock.clock);
      materials.metalRoughness.value = settings.roughness;
      materials.sunGlow.value = settings.sunGlow;
      studio.setLight(settings.daylight);
      studio.sunLight.intensity =
        settings.sunGlow * Math.PI * studio.sunLight.radius ** 2;
      studio.caustics.update(model, settings);
      glass.sync(settings, renderer.getPixelRatio());
      document.body.classList.toggle("night", settings.daylight < 0.35);
      renderer.toneMappingExposure = settings.exposure;
      post.configure(settings);
    }
    let shadowClock = NaN,
      shadowDaylight = NaN,
      shadowWind = NaN;
    function render() {
      renderer.info.reset();
      sync();
      studio.paperFoliage.update(renderer);
      if (shadowClock !== clock.clock)
        studio.sunLight.shadow.needsUpdate = true;
      if (
        shadowClock !== clock.clock ||
        shadowWind !== studio.foliage.time.value ||
        shadowDaylight !== settings.daylight
      ) {
        studio.key.shadow.needsUpdate = true;
        shadowClock = clock.clock;
        shadowWind = studio.foliage.time.value;
        shadowDaylight = settings.daylight;
      }
      post.render();
      studio.foliage.commit();
      dirty = false;
      settling = Math.max(0, settling - 1);
    }
    function advance(dt) {
      advanceLighting(dt);
      glass.advance(dt);
      winding.update();
      clock.advance(dt);
      if (!settings.pause) studio.foliage.advance(dt);
      changed();
    }
    winding = createWinding({
      canvas,
      camera,
      controls,
      orrery: model,
      clock,
      changed,
    });
    const ssgiButton = document.querySelector("#ssgi-toggle"),
      ssrButton = document.querySelector("#ssr-toggle"),
      compareButton = document.querySelector("#compare-toggle");
    const comparison = document.querySelector("#comparison");
    const dayButton = document.querySelector("#day-light"),
      nightButton = document.querySelector("#night-light");
    document.querySelector("#camera-view").addEventListener(
      "click",
      () => {
        const index =
          (cameraViewNames.indexOf(settings.cameraView) + 1) %
          cameraViewNames.length;
        setView(cameraViewNames[index]);
      },
      { signal },
    );
    function syncButtons() {
      ssgiButton.setAttribute("aria-pressed", String(settings.ssgi));
      ssrButton.setAttribute("aria-pressed", String(settings.ssr));
      compareButton.setAttribute("aria-pressed", String(settings.compare));
      comparison.hidden = !settings.compare;
      dayButton.setAttribute(
        "aria-pressed",
        String(daylightTransition.target === 1),
      );
      nightButton.setAttribute(
        "aria-pressed",
        String(daylightTransition.target === 0),
      );
    }
    function toggle(name) {
      settings[name] = !settings[name];
      syncButtons();
      changed();
    }
    ssgiButton.addEventListener("click", () => toggle("ssgi"), { signal });
    ssrButton.addEventListener("click", () => toggle("ssr"), { signal });
    compareButton.addEventListener("click", () => toggle("compare"), {
      signal,
    });
    function applyLighting() {
      settings.daylight = daylightTransition.value;
      settings.sunGlow = THREE.MathUtils.lerp(7, 3.2, settings.daylight);
      settings.planetGlow = (1 - settings.daylight) * 0.15;
      changed();
    }
    function advanceLighting(dt) {
      if (!daylightTransition.active) return;
      daylightTransition.advance(dt);
      applyLighting();
    }
    function setLighting(daylight) {
      daylightTransition.setTarget(daylight, reducedMotion);
      if (reducedMotion) applyLighting();
      syncButtons();
      changed();
    }
    dayButton.addEventListener("click", () => setLighting(1), { signal });
    nightButton.addEventListener("click", () => setLighting(0), { signal });
    gui = createSettingsPanel(settings, {
      changed,
      pause,
      resetMechanism,
      setDaylight(value) {
        daylightTransition.setTarget(value, true);
        applyLighting();
        syncButtons();
      },
    });
    window.addEventListener("resize", resize, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        lastTime = null;
        changed();
      },
      { signal },
    );
    window.addEventListener("pagehide", () => stop(), { signal });
    window.addEventListener(
      "keydown",
      (event) => {
        if (
          /INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)
        )
          return;
        if (event.code === "KeyR") resetView();
        if (event.code === "KeyG") toggle("ssgi");
        if (event.code === "KeyS") toggle("ssr");
        if (event.code === "KeyC") toggle("compare");
        if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
          event.preventDefault();
          clock.clock += (event.code === "ArrowRight" ? 1 : -1) * 0.25;
          clock.impulse = 0;
          changed();
        }
      },
      { signal },
    );
    window.orrery = {
      scene,
      camera,
      controls,
      renderer,
      settings,
      clock,
      model,
      post,
      studio,
      glass,
      winding,
      gui,
      daylightTransition,
      pause,
      reset,
      resetView,
      setView,
      advance,
      render,
      get manual() {
        return manual;
      },
      set manual(value) {
        manual = Boolean(value);
        lastTime = null;
        changed();
      },
      inspect() {
        return {
          clock: clock.clock,
          paused: clock.paused,
          dragging: clock.dragging,
          backend: renderer.backend.constructor.name,
          calls: renderer.info.render.drawCalls,
          triangles: renderer.info.render.triangles,
          geometries: renderer.info.memory.geometries,
          textures: renderer.info.memory.textures,
        };
      },
    };
    status.textContent = "Warming the light…";
    syncButtons();
    gui.hide();
    canvas.style.pointerEvents = "none";
    sync();
    await post.warmup();
    if (stopped) return;
    render();
    // GPU submission can return long before the first shader compilation is
    // complete. Start animation only once this frame is ready to display.
    await renderer.backend.device.queue.onSubmittedWorkDone();
    if (stopped) return;
    status.hidden = true;
    gui.show();
    canvas.style.pointerEvents = "";
    document.querySelector("#effect-controls").hidden = false;
    document.querySelector("#light-controls").hidden = false;
    function animate(now) {
      if (stopped) return;
      frame = requestAnimationFrame(animate);
      if (document.hidden || manual) {
        lastTime = null;
        return;
      }
      const dt =
        lastTime === null ? 0 : Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      advanceLighting(dt);
      if (glass.advance(dt)) changed();
      clock.speed = settings.speed;
      clock.paused = settings.pause;
      controls.autoRotate = settings.autoOrbit && !settings.pause;
      controls.update(dt);
      winding.update();
      const previousClock = clock.clock;
      clock.advance(dt);
      if (clock.clock !== previousClock) changed();
      if (!settings.pause && !clock.dragging) {
        studio.foliage.advance(dt);
        changed();
      }
      if (dirty || settling > 0)
        try {
          render();
        } catch (error) {
          stop(error);
        }
    }
    frame = requestAnimationFrame(animate);
  } catch (error) {
    stop(error);
    throw error;
  }
}
