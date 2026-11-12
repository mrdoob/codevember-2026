import * as THREE from "three/webgpu";
import { createSettings, createSettingsPanel } from "./settings.js";
import { createMineDrag } from "./mine-drag.js";
import { bakeSurface, createCorrosion } from "./corrosion.js";
import { createAtmosphere } from "./atmosphere.js";
import { createBreakingChain } from "./breaking-chain.js";
import { MineJourney, cameraFov } from "./mine-journey.js";
import {
  buildSubmarineMine,
  createHardwareMaterials,
} from "./submarine-mine.js";
import { createMarineMaterials } from "./marine-life.js";
import { createMossMaterials } from "./moss.js";
import { createDebris } from "./debris.js";
import { createDust, createSparks } from "./dust.js";
import { createPostProcessing } from "./post-processing.js";

export async function startExperiment() {
  if (!navigator.gpu)
    throw new Error("This experiment needs a browser with WebGPU.");
  const canvas = document.querySelector("canvas");
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  renderer._getFallback = null;
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene(),
    dustScene = new THREE.Scene(),
    bubbleScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.018, 70);
  const surface = bakeSurface(renderer),
    corrosion = createCorrosion(surface),
    mineCorrosion = createCorrosion(surface, {
      reliefScale: 2.2,
      triplanar: true,
    }),
    atmosphere = createAtmosphere(renderer, scene);
  const post = createPostProcessing(
    renderer,
    scene,
    camera,
    dustScene,
    atmosphere,
    bubbleScene,
  );
  const dust = createDust(dustScene, post.dustDepth),
    sparks = createSparks(dustScene, post.dustDepth),
    debris = createDebris(scene);
  // Keep shader graphs alive across encounters. New geometry can use the
  // existing WebGPU pipelines, including per-object motion for the moss.
  const mineMaterials = {
    ...createHardwareMaterials(mineCorrosion.material),
    ...createMarineMaterials(post.dustDepth, atmosphere),
    ...createMossMaterials(),
  };
  const settings = createSettings();
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let paused = reduced.matches,
    pulling = false,
    manual = false,
    disposed = false;
  let last = null,
    frame = 0,
    dirty = true,
    settle = 3;
  const abort = new AbortController(),
    events = { signal: abort.signal };
  let journey;
  function* buildShot(shot) {
    shot.mineVisual = yield* buildSubmarineMine(
      shot.root,
      shot.simulation,
      mineCorrosion.material,
      shot.z,
      shot.index,
      mineMaterials,
      shot.particles,
    );
    yield;
    shot.visual = createBreakingChain(
      shot.root,
      shot.simulation,
      corrosion.material,
      shot.z,
      shot.index,
    );
    scene.add(shot.root);
    bubbleScene.add(shot.particles);
  }
  function prepareNext() {
    const shot = journey.prepareNext();
    if (shot.ready) return;
    const start = performance.now();
    do {
      const step = shot.builder.next();
      if (step.done) {
        shot.ready = true;
        shot.builder = null;
        break;
      }
    } while (performance.now() - start < 2);
    const elapsed = performance.now() - start;
    shot.preparation.cpuTime += elapsed;
    shot.preparation.maxSlice = Math.max(shot.preparation.maxSlice, elapsed);
    shot.preparation.slices++;
  }
  function makeJourney(seed) {
    return new MineJourney({
      seed,
      getAspect: () => innerWidth / innerHeight,
      onCreate(shot, preparing) {
        shot.root = new THREE.Group();
        shot.particles = new THREE.Group();
        shot.builder = buildShot(shot);
        shot.preparation = { cpuTime: 0, maxSlice: 0, slices: 0 };
        if (preparing) return false;
        while (!shot.builder.next().done) {}
        shot.builder = null;
      },
      onCrack(shot) {
        const p = shot.simulation.fracture.position;
        const point = new THREE.Vector3(p[0], p[1], p[2] + shot.z);
        dust.burst(point, 0.08);
      },
      onBreak(shot) {
        const p = shot.simulation.fracture.position;
        const point = new THREE.Vector3(p[0], p[1], p[2] + shot.z);
        debris.burst(
          point,
          shot.index * 3 + shot.simulation.fracture.order,
          1.6,
        );
        sparks.burst(point);
        dust.burst(
          point,
          shot.simulation.fractureMode === "shatter" ? 3.25 : 2.5,
        );
      },
      onRemove(shot) {
        shot.builder?.return();
        shot.builder = null;
        shot.visual?.dispose();
        shot.mineVisual?.dispose();
        // A reset can cancel a partially built assembly. Release any objects
        // that have not yet acquired an owner; materials are shared by all shots.
        for (const root of [shot.root, shot.particles]) {
          root.traverse((object) => {
            object.geometry?.dispose();
            if (object.isInstancedMesh) object.dispose();
          });
          root.removeFromParent();
        }
      },
      onAdvance(dt) {
        for (const shot of journey.shots)
          if (shot !== journey.next) shot.mineVisual.advance(dt);
        debris.update(dt);
        sparks.update(dt);
        dust.advance(dt);
      },
    });
  }
  journey = makeJourney();
  function changed() {
    dirty = true;
    settle = 3;
  }
  function pause(value = !paused) {
    paused = value;
    last = null;
    changed();
  }
  function setAuto(value = !settings.auto) {
    settings.auto = value;
    changed();
  }
  function setPull(value) {
    pulling = value;
    canvas.style.cursor = value ? "grabbing" : "grab";
    document.body.classList.toggle("pulling", value);
    if (value) {
      setAuto(false);
      pause(false);
    }
    changed();
  }
  function reset(seed) {
    drag.release();
    journey.dispose();
    debris.clear();
    sparks.clear();
    dust.clear();
    journey = makeJourney(seed);
    last = null;
    changed();
    sync();
  }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = cameraFov(camera.aspect);
    camera.updateProjectionMatrix();
    atmosphere.aspect.value = camera.aspect;
    const ratio =
      settings.resolution ||
      Math.min(
        devicePixelRatio,
        1.5,
        Math.sqrt(1_250_000 / (innerWidth * innerHeight)),
      );
    renderer.setPixelRatio(ratio);
    renderer.setSize(innerWidth, innerHeight);
    changed();
  }
  const gui = createSettingsPanel(settings, {
    onChange: changed,
    onResolutionChange: resize,
  });
  const stressMatrix = new THREE.Matrix4(),
    stressPosition = new THREE.Vector3();
  function sync() {
    const shot = journey.current,
      simulation = shot.simulation,
      pose = journey.cameraPose(camera.aspect);
    if (camera.fov !== pose.fov) {
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
    camera.position.set(pose.x, pose.y, pose.z);
    camera.lookAt(...pose.target);
    camera.updateMatrixWorld();
    drag.update();
    for (const shot of journey.shots) {
      if (!shot.ready || shot === journey.next) continue;
      shot.visual.update(!paused);
      shot.mineVisual.update(!paused);
    }
    corrosion.age.value = settings.rust;
    corrosion.relief.value = settings.relief;
    mineCorrosion.age.value = settings.rust;
    mineCorrosion.relief.value = settings.relief;
    renderer.toneMappingExposure = settings.exposure;
    scene.environmentIntensity = settings.environment;
    atmosphere.key.intensity = settings.keyLight;
    atmosphere.fractureLightStrength = settings.fractureLight;
    let fracture = simulation.fracture?.position;
    if (!fracture && shot.stressLink !== null) {
      // Follow the same interpolated pose as the visible intact link.
      shot.visual.meshes[0].getMatrixAt(shot.stressLink, stressMatrix);
      fracture = stressPosition.setFromMatrixPosition(stressMatrix).toArray();
    }
    atmosphere.update(
      journey.time,
      pose.lightTarget[2],
      journey.fractureAge,
      pose.lightTarget,
      fracture && [fracture[0], fracture[1], fracture[2] + shot.z],
      simulation.pendingFracture
        ? 1
        : simulation.controlled && !simulation.broken
          ? Math.min(1, simulation.load / simulation.strength)
          : 0,
      camera.position,
    );
    dust.clock.value = journey.time;
    dust.strength.value = settings.dust;
    dust.viewDistance = pose.distance - 0.9;
    post.fogBlur.value = settings.fogBlur;
    post.vignette.value = settings.vignette;
    post.saturation.value = settings.saturation;
    post.temperature.value = settings.temperature;
    post.tint.value = settings.tint;
    post.contrast.value = settings.contrast;
    post.lift.value = settings.lift;
    post.shadows.value.set(settings.shadows);
    post.strength.value = settings.occlusion;
    atmosphere.haze.value = settings.fog;
    atmosphere.fogStart.value = settings.fogStart;
  }
  function advance(dt) {
    if (paused || disposed) return;
    journey.advance(dt, {
      auto: settings.auto,
      pulling,
      speed: settings.speed,
      strength: settings.strength,
      orbitSpeed: reduced.matches ? 0 : settings.orbitSpeed,
    });
    if (drag.shot?.simulation.broken) drag.release();
    changed();
  }
  function render() {
    if (disposed) return;
    sync();
    dust.update(renderer, journey, camera);
    post.render();
    dirty = false;
  }
  const drag = createMineDrag({
    canvas,
    camera,
    getShot: () => journey.current,
    onStart: () => setPull(true),
    onEnd: () => setPull(false),
    signal: abort.signal,
  });
  window.addEventListener("resize", resize, events);
  window.addEventListener("blur", drag.release, events);
  document.addEventListener(
    "visibilitychange",
    () => {
      last = null;
      if (document.hidden) drag.release();
      changed();
    },
    events,
  );
  reduced.addEventListener(
    "change",
    (e) => {
      if (e.matches) pause(true);
    },
    events,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (
        e.target.matches("input,select,textarea,button") ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.code === "KeyH") document.body.classList.toggle("ui-hidden");
    },
    events,
  );
  function loop(now) {
    if (disposed) return;
    frame = requestAnimationFrame(loop);
    if (document.hidden || manual) {
      last = null;
      return;
    }
    const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    advance(dt);
    if (!paused || dirty || settle > 0) {
      render();
      settle--;
    }
    // Prepare below the frame during the long entrance/interaction, while its
    // physics world sleeps. The handoff itself just swaps the current shot.
    if (journey.current.simulation.time > 3) prepareNext();
  }
  resize();
  // With reduced motion, show a settled mine immediately so it can still be
  // picked up without needing the removed playback controls.
  if (paused)
    while (journey.current.simulation.phase !== "ready" && journey.time < 16)
      journey.advance(1 / 120, { orbitSpeed: 0 });
  pause(paused);
  setAuto(settings.auto);
  render();
  document.querySelector("#status").hidden = true;
  window.rust = {
    renderer,
    scene,
    camera,
    settings,
    corrosion,
    mineCorrosion,
    atmosphere,
    post,
    dust,
    sparks,
    debris,
    gui,
    get journey() {
      return journey;
    },
    get time() {
      return journey.time;
    },
    get paused() {
      return paused;
    },
    get pulling() {
      return pulling;
    },
    get manual() {
      return manual;
    },
    set manual(value) {
      manual = value;
      last = null;
      changed();
    },
    advance,
    render,
    pause,
    reset,
    setPull,
    setAuto,
    inspect() {
      return {
        backend: renderer.backend.constructor.name,
        revision: THREE.REVISION,
        paused,
        pulling,
        resolution: renderer.getPixelRatio(),
        debris: debris.count,
        ...journey.inspect(),
      };
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      drag.release();
      abort.abort();
      gui.destroy();
      journey.dispose();
      Object.values(mineMaterials).forEach((material) => material.dispose());
      debris.dispose();
      dust.dispose();
      sparks.dispose();
      post.dispose();
      atmosphere.dispose();
      corrosion.dispose();
      mineCorrosion.dispose();
      surface.dispose();
      renderer.dispose();
    },
  };
  frame = requestAnimationFrame(loop);
}
