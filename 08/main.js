import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createStudio } from "./studio.js";
import { createPostProcessing } from "./post-processing.js";
import { createParticles } from "./particles.js";
import { createTubeField } from "./tube-field.js";
import { createAirflow } from "./airflow.js";
import { createSculpture, FLOAT_HEIGHT } from "./sculpture.js";
import {
  CAMERA_MAX_DISTANCE,
  CAMERA_MIN_Y,
  CAMERA_MAX_Y,
} from "./room-layout.js";
import { createSettings, createSettingsPanel } from "./settings.js";
import {
  poseMotion,
  poseRotation,
  POSE_LOOP_SECONDS,
  BLINK_PER_RADIAN,
} from "./pose-motion.js";
import { COLOR_MODES } from "./neon-pattern.js";
import {
  CAMERA_OFFSET,
  TARGET_OFFSET,
  CAMERA_ROLL,
  CAMERA_VIEWS,
  framing,
} from "./camera-framing.js";

export async function startExperiment() {
  if (!navigator.gpu)
    throw new Error("This experiment needs a browser with WebGPU.");
  const canvas = document.querySelector("canvas");
  const status = document.querySelector("#status");
  const pauseButton = document.querySelector("#pause");
  const viewButton = document.querySelector("#change-view");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const settings = createSettings(devicePixelRatio);
  const scene = new THREE.Scene();
  const neonScene = new THREE.Scene();
  const particleScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 70);
  camera.position.fromArray(CAMERA_OFFSET);
  camera.position.y += FLOAT_HEIGHT;
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer._getFallback = null;
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);
  renderer.toneMappingExposure = settings.exposure;
  const studio = createStudio(scene, settings);
  const sculpture = createSculpture(settings);
  neonScene.add(sculpture.group);
  studio.setLights(sculpture.lights);
  const post = createPostProcessing(
    renderer,
    scene,
    neonScene,
    particleScene,
    camera,
  );
  const field = createTubeField(sculpture.lights);
  const air = createAirflow();
  const particles = createParticles(
    particleScene,
    field,
    air,
    post.particleViewZ,
    settings,
  );
  const abort = new AbortController();
  const eventOptions = { signal: abort.signal };
  let controls, gui;
  let time = 0,
    lightTime = 0,
    blinkTime = 0,
    paused = reducedMotion.matches,
    manual = false,
    disposed = false;
  let previousTravel = 0,
    blinkMode = settings.motion;
  let lastTime = null,
    dirty = true,
    frame = 0;
  let viewIndex = 0,
    viewTransition = null;
  const turn = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function changed() {
    dirty = true;
  }
  function resize() {
    cancelViewTransition();
    const width = innerWidth,
      height = innerHeight;
    camera.aspect = width / height;
    const composition = framing(camera.aspect);
    camera.fov = composition.fov;
    if (controls) {
      camera.position.x += composition.x - controls.target.x;
      controls.target.x = composition.x;
    }
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(settings.resolution);
    renderer.setSize(width, height);
    dirty = true;
  }
  function updatePauseLabel() {
    pauseButton.textContent = paused ? "PLAY" : "PAUSE";
    pauseButton.setAttribute(
      "aria-label",
      paused ? "Play animation" : "Pause animation",
    );
  }
  function pause(value = !paused) {
    paused = value;
    if (controls)
      controls.autoRotate = settings.autoOrbit && !paused && !viewTransition;
    lastTime = null;
    updatePauseLabel();
    dirty = true;
  }
  function reset() {
    cancelViewTransition();
    viewIndex = 0;
    time = lightTime = blinkTime = 0;
    previousTravel = 0;
    blinkMode = settings.motion;
    particles.reset();
    air.reset();
    turn.x = turn.y = turn.targetX = turn.targetY = 0;
    controls.autoRotate = false;
    controls.reset();
    controls.autoRotate = settings.autoOrbit && !paused;
    resize();
    lastTime = null;
    dirty = true;
  }
  function quarterTurn() {
    turn.targetX += Math.PI / 2;
    if (reducedMotion.matches) turn.x = turn.targetX;
    dirty = true;
  }
  function cancelViewTransition() {
    viewTransition = null;
    if (controls) controls.enableDamping = !reducedMotion.matches;
  }
  function changeView() {
    viewIndex = (viewIndex + 1) % CAMERA_VIEWS.length;
    const x = framing(camera.aspect).x;
    const position = new THREE.Vector3(...CAMERA_VIEWS[viewIndex]);
    position.x += x - TARGET_OFFSET[0];
    position.y += FLOAT_HEIGHT;
    const target = new THREE.Vector3(x, FLOAT_HEIGHT + TARGET_OFFSET[1], 0);
    controls.autoRotate = false;
    controls.enableDamping = false;
    controls.update(0);
    if (reducedMotion.matches) {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update(0);
      cancelViewTransition();
    } else {
      viewTransition = {
        from: camera.position.clone(),
        to: position,
        fromTarget: controls.target.clone(),
        toTarget: target,
        elapsed: 0,
      };
    }
    dirty = true;
  }
  function updateView(dt) {
    const move = viewTransition;
    move.elapsed += dt;
    const progress = Math.min(1, move.elapsed / 1.1);
    const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
    camera.position.lerpVectors(move.from, move.to, eased);
    controls.target.lerpVectors(move.fromTarget, move.toTarget, eased);
    controls.update(0);
    dirty = true;
    if (progress === 1) cancelViewTransition();
  }
  function seek(seconds) {
    if (!Number.isFinite(seconds)) throw new RangeError("Time must be finite.");
    time =
      ((seconds % POSE_LOOP_SECONDS) + POSE_LOOP_SECONDS) % POSE_LOOP_SECONDS;
    lightTime = seconds;
    const pose = poseMotion(time, settings.motion);
    previousTravel = pose.travel;
    blinkMode = settings.motion;
    blinkTime =
      (Math.floor(seconds / POSE_LOOP_SECONDS) * pose.totalTravel +
        pose.travel) *
      BLINK_PER_RADIAN;
    particles.reset();
    air.reset();
    dirty = true;
  }
  function advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Time step must be finite and nonnegative.");
    if (!paused) {
      time = (time + dt * settings.speed) % POSE_LOOP_SECONDS;
      lightTime += dt;
    }
    dirty = true;
  }
  function render() {
    if (disposed) return;
    const pose = poseMotion(time, settings.motion);
    if (blinkMode === settings.motion) {
      const travel = pose.travel - previousTravel;
      blinkTime +=
        (travel < 0 ? travel + pose.totalTravel : travel) * BLINK_PER_RADIAN;
    }
    previousTravel = pose.travel;
    blinkMode = settings.motion;
    sculpture.update(
      poseRotation(pose, settings.motion, turn.x, turn.y),
      blinkTime,
    );
    camera.position.y = THREE.MathUtils.clamp(
      camera.position.y,
      CAMERA_MIN_Y,
      CAMERA_MAX_Y,
    );
    camera.lookAt(controls.target);
    camera.rotateZ(CAMERA_ROLL);
    sculpture.group.updateMatrixWorld(true);
    // Both blinking and ceiling shadows follow accumulated angular travel,
    // so they ease with the sculpture and retain their last state at rest.
    studio.update(blinkTime / BLINK_PER_RADIAN);
    if (settings.particles) field.update(renderer);
    air.update(lightTime, settings, renderer);
    particles.update(lightTime, settings, renderer);
    renderer.toneMappingExposure = settings.exposure;
    post.render(settings);
    dirty = false;
  }

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = !reducedMotion.matches;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 6;
  controls.maxDistance = CAMERA_MAX_DISTANCE;
  controls.minPolarAngle = Math.PI * 0.4;
  controls.maxPolarAngle = Math.PI * 0.62;
  controls.minAzimuthAngle = -Infinity;
  controls.maxAzimuthAngle = Infinity;
  controls.autoRotate = settings.autoOrbit && !paused;
  controls.autoRotateSpeed = settings.orbitSpeed;
  controls.target.fromArray(TARGET_OFFSET);
  controls.target.y += FLOAT_HEIGHT;
  controls.update(0);
  controls.saveState();
  controls.addEventListener("change", changed);
  controls.addEventListener("start", cancelViewTransition);
  gui = createSettingsPanel(settings, {
    pause,
    reset,
    turn: quarterTurn,
    resize,
    changed,
  });

  pauseButton.addEventListener("click", () => pause(), eventOptions);
  viewButton.addEventListener("click", changeView, eventOptions);
  addEventListener("resize", resize, eventOptions);
  addEventListener(
    "keydown",
    (event) => {
      const target = event.target;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target.closest?.(
          'input, select, textarea, button, [role="button"], [contenteditable="true"]',
        )
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        pause();
      }
      if (event.code === "KeyR") reset();
      if (event.code === "ArrowRight") {
        event.preventDefault();
        quarterTurn();
      }
      if (event.code === "KeyC") {
        settings.color =
          COLOR_MODES[
            (COLOR_MODES.indexOf(settings.color) + 1) % COLOR_MODES.length
          ];
        gui
          .controllersRecursive()
          .forEach((controller) => controller.updateDisplay());
        dirty = true;
      }
    },
    eventOptions,
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      lastTime = null;
    },
    eventOptions,
  );
  reducedMotion.addEventListener(
    "change",
    () => {
      if (reducedMotion.matches) {
        if (viewTransition) updateView(1.1);
        pause(true);
      }
      controls.enableDamping = !reducedMotion.matches && !viewTransition;
    },
    eventOptions,
  );

  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (manual || document.hidden) {
      lastTime = null;
      return;
    }
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    controls.autoRotate = settings.autoOrbit && !paused && !viewTransition;
    controls.autoRotateSpeed = settings.orbitSpeed;
    if (viewTransition) updateView(dt);
    else controls.update(dt);
    const easing = 1 - Math.exp(-dt * 9);
    if (
      Math.abs(turn.targetX - turn.x) + Math.abs(turn.targetY - turn.y) >
      0.00001
    ) {
      turn.x = THREE.MathUtils.lerp(turn.x, turn.targetX, easing);
      turn.y = THREE.MathUtils.lerp(turn.y, turn.targetY, easing);
      dirty = true;
    }
    if (!paused) advance(dt);
    if (dirty) render();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    abort.abort();
    controls.dispose();
    gui.destroy();
    post.dispose();
    particles.dispose();
    field.dispose();
    air.dispose();
    sculpture.dispose();
    studio.dispose();
    renderer.dispose();
  }
  addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) dispose();
    },
    eventOptions,
  );
  resize();
  updatePauseLabel();
  render();
  status.hidden = true;
  window.tesseract = {
    scene,
    neonScene,
    particleScene,
    renderer,
    camera,
    controls,
    settings,
    sculpture,
    studio,
    particles,
    field,
    air,
    post,
    gui,
    turn,
    pause,
    reset,
    seek,
    advance,
    render,
    dispose,
    quarterTurn,
    changeView,
    get time() {
      return time;
    },
    get lightTime() {
      return lightTime;
    },
    get paused() {
      return paused;
    },
    get manual() {
      return manual;
    },
    set manual(value) {
      manual = Boolean(value);
      lastTime = null;
      dirty = true;
    },
    inspect() {
      return {
        time,
        lightTime,
        blinkTime,
        paused,
        manual,
        viewIndex,
        mode: settings.motion,
        color: settings.color,
        pose: poseMotion(time, settings.motion),
        hypercubes: 1,
        vertices: 16,
        edges: 32,
        tubeLights: sculpture.lights.length,
        particles: particles.mesh.visible ? particles.count : 0,
        calls: renderer.info.render.calls,
        resolution: renderer.getPixelRatio(),
      };
    },
  };
  frame = requestAnimationFrame(animate);
}
