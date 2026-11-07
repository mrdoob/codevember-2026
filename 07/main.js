import * as THREE from "three/webgpu";
import { createStudio } from "./studio.js";
import { createShells } from "./shells.js";
import {
  Journey,
  SHAPES,
  SHAPE_OFFSET,
  mod,
  OPEN_START,
  SPLIT_TIME,
} from "./journey.js";
import {
  CAMERA_DISTANCE,
  cameraAngles,
  cameraDirection,
  orbitYaw,
} from "./camera-motion.js";
import { createDepthOfField } from "./depth-of-field.js";
import { createSettings, createSettingsPanel } from "./settings.js";

export async function startExperiment() {
  if (!navigator.gpu)
    throw new Error("This experiment needs a browser with WebGPU.");
  const canvas = document.querySelector("canvas"),
    status = document.querySelector("#status");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = createSettings(devicePixelRatio);
  const journey = new Journey();
  journey.paused = reducedMotion;
  if (reducedMotion) journey.seek(0.3);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 90);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer._getFallback = null;
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.transmitted = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.setPixelRatio(settings.resolution);
  const studio = createStudio(scene, renderer);
  const shells = createShells(studio.environment.texture, scene.backgroundNode);
  scene.add(shells.group);
  const depthOfField = createDepthOfField(renderer, scene, camera);
  const abort = new AbortController(),
    eventOptions = { signal: abort.signal };
  let manual = false,
    stopped = false,
    frame = 0,
    lastTime = null,
    dirty = true;
  let targetDepth = null,
    pointer = null;
  const turn = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const cameraTarget = new THREE.Vector3();

  function resize() {
    const width = innerWidth,
      height = innerHeight;
    camera.aspect = width / height;
    // Preserve the sculpture's width in portrait without moving the camera.
    camera.fov = THREE.MathUtils.radToDeg(
      2 *
        Math.atan(
          Math.tan(THREE.MathUtils.degToRad(20)) *
            Math.max(1, 0.85 / camera.aspect),
        ),
    );
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(settings.resolution);
    renderer.setSize(width, height);
    studio.aspect.value = camera.aspect;
    dirty = true;
  }
  function pause(value = !journey.paused) {
    journey.paused = value;
    targetDepth = null;
    lastTime = null;
    dirty = true;
  }
  function next() {
    // Reduced motion advances directly to a readable still; otherwise travel
    // through the same animation, preserving the current scale and velocity.
    if (reducedMotion) journey.seek(journey.index + 1.3);
    else targetDepth = journey.index + 1;
    dirty = true;
  }
  function reset() {
    journey.seek(reducedMotion ? 0.3 : 0);
    turn.targetX = turn.targetY = 0;
    targetDepth = null;
    lastTime = null;
    dirty = true;
  }
  function sync() {
    shells.update(journey, settings, turn.y);
    const angles = cameraAngles(
      settings.orbit ? journey.depth : 0,
      settings.cameraMotion,
    );
    cameraDirection(
      journey.depth,
      turn.y,
      settings.orbit,
      camera.position,
    ).multiplyScalar(CAMERA_DISTANCE);
    // Small pitch/yaw sway; the camera stays upright in the clear corridor.
    const pitch = angles.pitch + turn.x,
      yaw = angles.lookYaw;
    cameraTarget
      .set(
        -Math.sin(yaw),
        Math.sin(pitch) * Math.cos(yaw),
        -Math.cos(pitch) * Math.cos(yaw),
      )
      .applyAxisAngle(
        camera.up,
        orbitYaw(journey.depth, turn.y, settings.orbit),
      )
      .add(camera.position);
    camera.lookAt(cameraTarget);
    shells.updateCameraRange(camera);
    renderer.toneMappingExposure = settings.exposure;
  }
  function render() {
    if (stopped) return;
    sync();
    shells.reflect(renderer, scene, journey, settings.reflections);
    studio.shadow.shadow.needsUpdate = true;
    const current = shells.slots.find(
      (slot) => slot.active && slot.id === journey.index,
    );
    const child = shells.slots.find(
      (slot) => slot.active && slot.id === journey.index + 1,
    );
    const front = (slot) =>
      slot.state.scale * slot.solid.geometry.boundingSphere.radius * 0.45;
    const focusDistance =
      CAMERA_DISTANCE -
      THREE.MathUtils.lerp(
        front(current),
        front(child),
        THREE.MathUtils.smoothstep(
          journey.phase,
          OPEN_START + 0.01,
          OPEN_START + SPLIT_TIME,
        ),
      );
    depthOfField.render(settings, focusDistance);
    dirty = false;
  }
  function advance(dt) {
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Time step must be finite and nonnegative.");
    journey.speed = settings.speed;
    if (targetDepth !== null) {
      const remaining = targetDepth - journey.depth;
      journey.seek(
        Math.min(
          targetDepth,
          journey.depth + dt * Math.max(0.16, Math.min(0.65, remaining * 2)),
        ),
      );
      if (targetDepth - journey.depth < 0.001) {
        journey.seek(targetDepth);
        targetDepth = null;
      }
    } else journey.advance(dt);
    const ease = 1 - Math.exp(-dt * 9);
    turn.x += (turn.targetX - turn.x) * ease;
    turn.y += (turn.targetY - turn.y) * ease;
    dirty = true;
  }
  function stop(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    abort.abort();
    gui.destroy();
    depthOfField.dispose();
    shells.dispose();
    studio.dispose();
    renderer
      .dispose()
      .catch((error) => console.warn("Renderer cleanup:", error));
    if (error) {
      status.hidden = false;
      status.textContent = `Stopped: ${error.message}`;
      console.error(error);
    }
  }
  const gui = createSettingsPanel(
    settings,
    { pause: () => pause(), next, reset },
    {
      changed: () => {
        dirty = true;
      },
      resize,
      refreshReflections: () => {
        for (const slot of shells.slots) slot.probeReady = false;
      },
    },
  );
  renderer.onDeviceLost = (info) =>
    stop(new Error(`Graphics device lost: ${info.message}`));
  renderer.onError = (info) =>
    stop(new Error(info.message || "Graphics error"));

  canvas.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || pointer) return;
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: turn.targetX,
        startY: turn.targetY,
      };
      canvas.setPointerCapture(event.pointerId);
    },
    eventOptions,
  );
  canvas.addEventListener(
    "pointermove",
    (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      turn.targetX = THREE.MathUtils.clamp(
        pointer.startX + (event.clientY - pointer.y) * 0.003,
        -0.1,
        0.1,
      );
      turn.targetY = THREE.MathUtils.clamp(
        pointer.startY + (event.clientX - pointer.x) * 0.003,
        -0.65,
        0.65,
      );
      dirty = true;
    },
    eventOptions,
  );
  const release = () => {
    pointer = null;
  };
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    canvas.addEventListener(event, release, eventOptions);
  window.addEventListener("blur", release, eventOptions);
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        event.target.closest("input, select, textarea, button") ||
        event.repeat
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        pause();
      }
      if (event.code === "ArrowRight") {
        event.preventDefault();
        next();
      }
      if (event.code === "KeyR") reset();
    },
    eventOptions,
  );
  window.addEventListener("resize", resize, eventOptions);
  document.addEventListener(
    "visibilitychange",
    () => {
      lastTime = null;
      release();
    },
    eventOptions,
  );
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) stop();
    },
    eventOptions,
  );

  function tick(now) {
    frame = requestAnimationFrame(tick);
    if (document.hidden || manual || stopped) {
      lastTime = null;
      return;
    }
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const turning =
      Math.abs(turn.x - turn.targetX) + Math.abs(turn.y - turn.targetY) >
      0.00001;
    if (!journey.paused || targetDepth !== null || turning) advance(dt);
    if (dirty) {
      try {
        render();
      } catch (error) {
        stop(error);
      }
    }
  }
  window.hollow = {
    scene,
    renderer,
    camera,
    shells,
    studio,
    depthOfField,
    settings,
    journey,
    gui,
    pause,
    next,
    reset,
    advance,
    render,
    seek(depth) {
      journey.seek(depth);
      targetDepth = null;
      dirty = true;
      render();
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
        depth: journey.depth,
        index: journey.index,
        phase: journey.phase,
        paused: journey.paused,
        shape: SHAPES[mod(journey.index + SHAPE_OFFSET, SHAPES.length)],
        camera: camera.position.toArray(),
        slots: shells.slots.map((slot) => ({
          id: slot.id,
          visible: slot.root.visible,
          scale: slot.root.scale.x,
          color: slot.lining.color.getHexString(),
        })),
        renderCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      };
    },
  };
  resize();
  pause(journey.paused);
  try {
    await renderer.compileAsync(scene, camera);
    render();
  } catch (error) {
    stop(error);
    throw error;
  }
  status.hidden = true;
  frame = requestAnimationFrame(tick);
}
