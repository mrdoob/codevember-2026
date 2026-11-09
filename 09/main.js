import * as THREE from "three/webgpu";
import { NodeUpdateType, emissive, mrt, output, pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";
import {
  createFineSandSimulation,
  FINE_GRAIN_COUNT,
  GRAIN_COUNTS,
} from "./physics/fine-sand.js";
import { MODES, modeFrequency } from "./modes.js";
import { createSpeaker } from "./speaker.js";
import { createStudio } from "./studio.js";
import { createAudio } from "./audio.js";
import { attachGPUKernel } from "./physics/gpu-kernel.js";
import { restoreSnapshot } from "./physics/snapshot.js";
import { createWaveView } from "./wave-view.js";
import { COLOR_GRADING_DEFAULTS, createColorGrading } from "./color-grading.js";

const DEFAULT_MODE = 2,
  DEFAULT_FREQUENCY = 223.2;
const FREQUENCY_ORDER = MODES.map((_, i) => i).sort(
  (a, b) => modeFrequency(a) - modeFrequency(b),
);

export async function startExperiment() {
  if (!navigator.gpu)
    throw new Error("This experiment needs a browser with WebGPU.");
  const canvas = document.querySelector("canvas"),
    status = document.querySelector("#status");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const settings = {
    auto: true,
    mode: DEFAULT_MODE,
    drive: 0.12,
    frequency: DEFAULT_FREQUENCY,
    speed: 1,
    friction: 0.32,
    restitution: 0.35,
    grains: false,
    grainCount: FINE_GRAIN_COUNT,
    roughness: 0.88,
    orbit: !reducedMotion,
    orbitSpeed: 0.4,
    ...COLOR_GRADING_DEFAULTS,
    resolution: Math.min(devicePixelRatio, 1.5),
    volume: 0.55,
    view: "wave",
    waveHeight: 100,
    waveLight: 2,
    waveBloom: 0.32,
    filmStirring: 1,
  };
  let simulation = createFineSandSimulation();
  try {
    const response = await fetch(
      new URL("./physics/initial-state-fine.bin", import.meta.url),
    );
    if (!response.ok)
      throw new Error("Initial state unavailable; starting from loose sand.");
    restoreSnapshot(simulation, await response.arrayBuffer());
  } catch (error) {
    console.warn(error.message);
  }
  // The checkpoint supplies the sand and membrane state, not the startup tune.
  simulation.mode = DEFAULT_MODE;
  simulation.frequency = DEFAULT_FREQUENCY;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 180);
  camera.position.set(0, 7, -13);
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer._getFallback = null;
  await renderer.init();
  let gpu = await attachGPUKernel(simulation, renderer);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = settings.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const studio = createStudio(scene, renderer);
  const speaker = createSpeaker(simulation);
  speaker.foil.aoNode = studio.contactAO;
  speaker.sand.material.aoNode = studio.contactAO;
  scene.add(speaker.group);
  const waveView = await createWaveView(simulation, renderer);
  waveView.material.envMap = studio.environment.texture;
  status.textContent = "Stirring the film…";
  await waveView.prewarm(settings);
  speaker.group.add(waveView.mesh);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.35, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 2;
  controls.maxDistance = 23;
  controls.minPolarAngle = 0.12;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.update();
  const orbitAxis = new THREE.Vector3(0, 1, 0);
  const audio = createAudio();
  const abort = new AbortController(),
    eventOptions = { signal: abort.signal };
  const scenePass = pass(scene, camera, { samples: 4 });
  // Explicit renders used by inspection/capture must see the latest field,
  // including when more than one is requested in a browser animation frame.
  scenePass.updateBeforeType = NodeUpdateType.RENDER;
  const beauty = scenePass.getTextureNode();
  // Only the luminous wave surface contributes to bloom. Sand view retains
  // its original single scene pass, without the extra attachment or blurs.
  const wavePass = pass(scene, camera, { samples: 4 });
  wavePass.updateBeforeType = NodeUpdateType.RENDER;
  wavePass.setMRT(mrt({ output, emissive }));
  const glow = bloom(
    wavePass.getTextureNode("emissive"),
    settings.waveBloom,
    0.35,
    1.1,
  );
  glow.updateBeforeType = NodeUpdateType.RENDER;
  const colorGrading = createColorGrading(renderer, settings);
  function createPipeline(input) {
    const pipeline = new THREE.RenderPipeline(
      renderer,
      colorGrading.apply(input),
    );
    pipeline.outputColorTransform = false;
    return pipeline;
  }
  const pipeline = createPipeline(beauty.rgb);
  const wavePipeline = createPipeline(
    wavePass.getTextureNode().rgb.add(glow.rgb),
  );
  let paused = reducedMotion,
    stopped = false,
    manual = false,
    lastTime = null,
    frame;
  let dirty = true,
    changingDensity = false;
  let viewBlend = 1,
    viewVelocity = 0,
    viewTarget = 1;
  let particleBlend = settings.grains ? 1 : 0,
    particleVelocity = 0,
    particleTarget = particleBlend;
  let frequencyTarget = null,
    frequencyVelocity = 0;
  const frequencyElement = document.querySelector("#frequency");
  const frequencySlider = document.querySelector("#frequency-slider");
  const frequencyMarks = document.querySelector("#frequency-marks"),
    frequencyStops = document.querySelector("#frequency-stops");
  const marks = FREQUENCY_ORDER.map((index) => {
    const frequency = modeFrequency(index),
      mark = document.createElement("span"),
      option = document.createElement("option");
    mark.style.left = `${((frequency - 40) / 260) * 100}%`;
    mark.dataset.frequency = frequency;
    option.value = frequency.toFixed(1);
    option.label = `${MODES[index].name} · ${frequency.toFixed(1)} Hz`;
    frequencyMarks.append(mark);
    frequencyStops.append(option);
    return { frequency, mark };
  });
  function updateFrequencyReadout(frequency) {
    const label = frequency.toFixed(1);
    if (frequencyElement.textContent !== label)
      frequencyElement.textContent = label;
    if (Number(frequencySlider.value) !== Number(label))
      frequencySlider.value = label;
    frequencySlider.setAttribute("aria-valuetext", `${label} Hz`);
    frequencySlider.style.setProperty(
      "--frequency-progress",
      `${((frequency - 40) / 260) * 100}%`,
    );
    for (const { frequency: stop, mark } of marks)
      mark.classList.toggle("active", Math.abs(frequency - stop) < 0.051);
  }
  const soundButton = document.querySelector("#sound");
  const waveButton = document.querySelector("#wave");
  const particlesButton = document.querySelector("#particles");
  function updateLayerControls() {
    const wave = settings.view === "wave",
      particles = settings.grains;
    waveButton.setAttribute("aria-pressed", String(wave));
    particlesButton.setAttribute("aria-pressed", String(particles));
    const subject = wave
      ? "A steady wave shape with flowing soap-film iridescence"
      : "A vibrating charcoal speaker membrane";
    canvas.setAttribute(
      "aria-label",
      `${subject}${particles ? " with white sand" : ""}. Drag to orbit, scroll to zoom. Space pauses. Left and right arrows change resonance. R resets particles and fluid. S toggles sound.`,
    );
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    dirty = true;
  }
  function setView(value, { immediate = false } = {}) {
    settings.view = value;
    const wave = value === "wave";
    viewTarget = wave ? 1 : 0;
    if (immediate || reducedMotion) {
      viewBlend = viewTarget;
      viewVelocity = 0;
    }
    updateLayerControls();
  }
  function setParticles(value, { immediate = false } = {}) {
    settings.grains = Boolean(value);
    particleTarget = settings.grains ? 1 : 0;
    if (immediate || reducedMotion) {
      particleBlend = particleTarget;
      particleVelocity = 0;
    }
    updateLayerControls();
  }
  function advanceView(dt) {
    if (viewBlend === viewTarget && viewVelocity === 0) return;
    // Exact critically damped spring: reversals remain smooth mid-transition.
    const omega = 9,
      offset = viewBlend - viewTarget,
      step = (viewVelocity + omega * offset) * dt,
      decay = Math.exp(-omega * dt);
    viewBlend = viewTarget + (offset + step) * decay;
    viewVelocity = (viewVelocity - omega * step) * decay;
    if (
      Math.abs(viewBlend - viewTarget) < 0.0005 &&
      Math.abs(viewVelocity) < 0.005
    ) {
      viewBlend = viewTarget;
      viewVelocity = 0;
    }
    dirty = true;
  }
  function advanceParticles(dt) {
    if (particleBlend === particleTarget && particleVelocity === 0) return;
    const omega = 9,
      offset = particleBlend - particleTarget,
      step = (particleVelocity + omega * offset) * dt,
      decay = Math.exp(-omega * dt);
    particleBlend = particleTarget + (offset + step) * decay;
    particleVelocity = (particleVelocity - omega * step) * decay;
    if (
      Math.abs(particleBlend - particleTarget) < 0.0005 &&
      Math.abs(particleVelocity) < 0.005
    ) {
      particleBlend = particleTarget;
      particleVelocity = 0;
    }
    dirty = true;
  }

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    const frameHeight = Math.max(2.85, 4.15 / camera.aspect);
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(frameHeight / 15));
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(settings.resolution);
    renderer.setSize(innerWidth, innerHeight);
    dirty = true;
  }
  function syncAudio() {
    const playing = !paused && !document.hidden && !manual;
    audio.update(playing, settings.volume, settings.speed);
    gpu.onAudio =
      playing && audio.enabled
        ? (samples, rate) => audio.enqueue(samples, rate)
        : null;
  }
  function pause(value = !paused) {
    paused = value;
    lastTime = null;
    dirty = true;
    syncAudio();
  }
  function selectMode(index) {
    if (index === -1) {
      frequencyTarget = null;
      frequencyVelocity = 0;
      simulation.mode = -1;
      settings.mode = -1;
      settings.auto = false;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      dirty = true;
      return;
    }
    simulation.mode = index;
    simulation.nextAt = simulation.time + 120;
    frequencyTarget = modeFrequency(index);
    if (reducedMotion) {
      settings.frequency = simulation.frequency = frequencyTarget;
      frequencyTarget = null;
      frequencyVelocity = 0;
    }
    frequencyControl.updateDisplay();
    settings.mode = index;
    modeControl.updateDisplay();
    dirty = true;
  }
  function advanceFrequency(dt) {
    if (frequencyTarget === null) return;
    const omega = 6,
      offset = settings.frequency - frequencyTarget;
    const step = (frequencyVelocity + omega * offset) * dt,
      decay = Math.exp(-omega * dt);
    settings.frequency = frequencyTarget + (offset + step) * decay;
    frequencyVelocity = (frequencyVelocity - omega * step) * decay;
    if (
      Math.abs(settings.frequency - frequencyTarget) < 0.005 &&
      Math.abs(frequencyVelocity) < 0.03
    ) {
      settings.frequency = frequencyTarget;
      frequencyTarget = null;
      frequencyVelocity = 0;
    }
    simulation.frequency = settings.frequency;
    frequencyControl.updateDisplay();
    dirty = true;
  }
  function stepResonance(direction) {
    const current = frequencyTarget ?? settings.frequency;
    const order =
      direction > 0 ? FREQUENCY_ORDER : [...FREQUENCY_ORDER].reverse();
    selectMode(
      order.find((i) => (modeFrequency(i) - current) * direction > 0.051) ??
        order[0],
    );
  }
  function next() {
    stepResonance(1);
  }
  function previous() {
    stepResonance(-1);
  }
  function reset() {
    simulation.scatter();
    waveView.film.reset();
    dirty = true;
    lastTime = null;
  }
  async function setGrainCount(count) {
    count = Number(count);
    if (!GRAIN_COUNTS.includes(count))
      throw new RangeError("Unknown sand density.");
    if (changingDensity || count === simulation.grainCount) return;
    changingDensity = true;
    const wasManual = manual;
    manual = true;
    lastTime = null;
    syncAudio();
    grainCountControl.disable();
    status.hidden = false;
    status.textContent = `Preparing ${count.toLocaleString()} grains…`;
    let replacement;
    try {
      await gpu.readback();
      replacement = createFineSandSimulation(count);
      for (const key of [
        "ticks",
        "time",
        "phase",
        "mode",
        "nextAt",
        "accumulator",
        "auto",
        "drive",
        "speed",
        "friction",
        "restitution",
        "rollingFriction",
      ])
        replacement[key] = simulation[key];
      replacement.frequency = simulation.frequency;
      replacement.modal.q.set(simulation.modal.q);
      replacement.modal.v.set(simulation.modal.v);
      const replacementGPU = await attachGPUKernel(replacement, renderer);
      replacement.scatter();
      await replacementGPU.idle();
      if (stopped) {
        replacement.dispose();
        return;
      }
      const previous = simulation;
      speaker.setSimulation(replacement);
      waveView.setSimulation(replacement);
      simulation = replacement;
      gpu = replacementGPU;
      settings.grainCount = count;
      previous.dispose();
      status.hidden = true;
      dirty = true;
    } catch (error) {
      replacement?.dispose?.();
      settings.grainCount = simulation.grainCount;
      if (!stopped) {
        status.hidden = false;
        status.textContent = error.message;
        console.error(error);
      }
    } finally {
      changingDensity = false;
      manual = wasManual;
      lastTime = null;
      if (!stopped) {
        grainCountControl.enable().updateDisplay();
        syncAudio();
      }
    }
  }
  async function toggleSound() {
    try {
      const enabled = await audio.enable(!audio.enabled);
      if (stopped) return;
      soundButton.setAttribute("aria-pressed", String(enabled));
      syncAudio();
    } catch (error) {
      status.hidden = false;
      status.textContent = error.message;
      console.error(error);
    }
  }
  function syncParameters() {
    // UI automation owns preset changes so automatic and clicked changes
    // use the same glide. The underlying reference solver keeps its API.
    simulation.auto = false;
    simulation.drive = settings.drive;
    simulation.frequency = settings.frequency;
    simulation.speed = settings.speed;
    simulation.friction = settings.friction;
    simulation.restitution = settings.restitution;
  }
  function advance(dt) {
    if (dt > 0 && settings.auto && simulation.time >= simulation.nextAt) next();
    advanceFrequency(dt);
    syncParameters();
    simulation.advance(dt);
    dirty = true;
  }
  function render() {
    if (stopped) return;
    speaker.update(settings, particleBlend);
    waveView.update(settings, viewBlend);
    colorGrading.update(settings);
    glow.strength.value = settings.waveBloom;
    (viewBlend > 0.001 ? wavePipeline : pipeline).render();
    updateFrequencyReadout(simulation.frequency);
    dirty = false;
  }
  const actions = { pause: () => pause(), reset };
  const gui = new GUI({ title: "Settings", width: 240 });
  const layers = {
    get wave() {
      return settings.view === "wave";
    },
    set wave(value) {
      setView(value ? "wave" : "sand");
    },
  };
  gui.add(layers, "wave").name("Wave");
  const resonances = {
    "Free tuning": -1,
    ...Object.fromEntries(FREQUENCY_ORDER.map((i) => [MODES[i].name, i])),
  };
  const modeControl = gui
    .add(settings, "mode", resonances)
    .name("Frequency preset")
    .onChange((value) => selectMode(Number(value)));
  gui.add(settings, "auto").name("Cycle resonances");
  const frequencyControl = gui
    .add(settings, "frequency", 40, 300, 0.1)
    .name("Drive frequency · Hz")
    .onChange(() => {
      frequencyTarget = null;
      frequencyVelocity = 0;
      settings.auto = false;
      settings.mode = MODES.findIndex(
        (_, i) => Math.abs(modeFrequency(i) - settings.frequency) < 0.051,
      );
      simulation.mode = settings.mode;
      simulation.nextAt = simulation.time + 120;
      gui.controllersRecursive().forEach((c) => c.updateDisplay());
      updateFrequencyReadout(settings.frequency);
    });
  gui.add(settings, "drive", 0, 0.15, 0.001).name("Drive force · N");
  gui
    .add(settings, "speed", {
      "2× speed": 2,
      "Real time": 1,
      "¼ speed": 0.25,
      "¹⁄₁₀ speed": 0.1,
    })
    .name("Playback");
  const waves = gui.addFolder("Wave appearance");
  waves.add(settings, "waveHeight", 5, 180, 1).name("Height magnification");
  waves.add(settings, "waveLight", 0.2, 2, 0.01).name("Film lighting");
  waves.add(settings, "filmStirring", 0, 3, 0.05).name("Film stirring");
  waves.add(settings, "waveBloom", 0, 0.7, 0.01).name("Glow");
  waves.close();
  const surface = gui.addFolder("Surface");
  surface.add(settings, "grains").name("Particles").onChange(setParticles);
  const grainCountControl = surface
    .add(
      settings,
      "grainCount",
      Object.fromEntries(
        GRAIN_COUNTS.map((n) => [n.toLocaleString("en-US"), n]),
      ),
    )
    .name("Grains")
    .onChange(setGrainCount);
  grainCountControl.domElement.title =
    "Changing the count scatters the sand. Total sand mass stays the same.";
  surface.add(settings, "friction", 0, 0.8, 0.01).name("Contact friction");
  surface.add(settings, "restitution", 0, 0.8, 0.01).name("Restitution");
  surface.add(settings, "roughness", 0.45, 1, 0.01).name("Roughness");
  surface.close();
  const grading = gui.addFolder("Color grading");
  grading.add(settings, "exposure", 0.25, 2, 0.01).name("Exposure");
  grading.add(settings, "contrast", 0.5, 2, 0.01).name("Contrast");
  grading.add(settings, "saturation", 0, 2, 0.01).name("Saturation");
  grading.add(settings, "warmth", -1, 1, 0.01).name("Warmth");
  grading.add(settings, "tint", -1, 1, 0.01).name("Tint");
  grading.add(settings, "shadows", -1, 1, 0.01).name("Shadows");
  grading.add(settings, "highlights", -1, 1, 0.01).name("Highlights");
  grading.add(settings, "vignette", 0, 0.8, 0.01).name("Vignette");
  grading
    .add(
      {
        reset() {
          Object.assign(settings, COLOR_GRADING_DEFAULTS);
          grading.controllers.forEach((c) => c.updateDisplay());
          dirty = true;
        },
      },
      "reset",
    )
    .name("Reset grading");
  grading.close();
  const view = gui.addFolder("Camera & rendering");
  view.add(settings, "orbit").name("Auto orbit");
  view.add(settings, "orbitSpeed", 0.05, 0.6, 0.01).name("Orbit speed");
  view
    .add(settings, "resolution", { "1×": 1, "1.5×": 1.5, "2×": 2 })
    .name("Resolution")
    .onChange(resize);
  view.close();
  gui.add(settings, "volume", 0, 1, 0.01).name("Sound volume");
  gui.add(actions, "pause").name("Play / pause");
  gui.add(actions, "reset").name("Reset particles & fluid");
  gui.onChange(() => {
    syncParameters();
    simulation.updateHeight();
    dirty = true;
    syncAudio();
  });
  gui.close();
  controls.addEventListener("change", () => {
    dirty = true;
  });
  document.querySelector("#next").addEventListener("click", next, eventOptions);
  document
    .querySelector("#previous")
    .addEventListener("click", previous, eventOptions);
  document
    .querySelector("#reset")
    .addEventListener("click", reset, eventOptions);
  waveButton.addEventListener(
    "click",
    () => setView(settings.view === "wave" ? "sand" : "wave"),
    eventOptions,
  );
  particlesButton.addEventListener(
    "click",
    () => setParticles(!settings.grains),
    eventOptions,
  );
  soundButton.addEventListener("click", toggleSound, eventOptions);
  frequencySlider.addEventListener(
    "input",
    () => frequencyControl.setValue(Number(frequencySlider.value)),
    eventOptions,
  );
  window.addEventListener("resize", resize, eventOptions);
  window.addEventListener(
    "keydown",
    (event) => {
      if (
        /INPUT|SELECT|TEXTAREA|BUTTON/.test(event.target.tagName) ||
        event.target.isContentEditable
      )
        return;
      if (event.code === "Space") {
        event.preventDefault();
        pause();
      }
      if (event.repeat) return;
      if (event.code === "ArrowRight") {
        event.preventDefault();
        next();
      }
      if (event.code === "ArrowLeft") {
        event.preventDefault();
        previous();
      }
      if (event.code === "KeyR") reset();
      if (event.code === "KeyS") toggleSound();
    },
    eventOptions,
  );
  document.addEventListener(
    "visibilitychange",
    () => {
      lastTime = null;
      syncAudio();
    },
    eventOptions,
  );

  function stop(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frame);
    abort.abort();
    controls.dispose();
    gui.destroy();
    audio.dispose();
    pipeline.dispose();
    wavePipeline.dispose();
    glow.dispose();
    scenePass.dispose();
    wavePass.dispose();
    speaker.group.remove(waveView.mesh);
    waveView.dispose();
    speaker.dispose();
    studio.dispose();
    simulation.dispose();
    renderer
      .dispose()
      .catch((error) => console.warn("Renderer cleanup:", error));
    if (error) {
      status.hidden = false;
      status.textContent = `Stopped: ${error.message}`;
      console.error(error);
    }
  }
  renderer.onDeviceLost = (info) =>
    stop(new Error(`Graphics device lost: ${info.message}`));
  renderer.onError = (info) =>
    stop(new Error(info.message || "Graphics error"));
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) stop();
    },
    eventOptions,
  );
  setView(settings.view, { immediate: true });
  resize();
  render();
  status.hidden = true;
  window.membrane = {
    get simulation() {
      return simulation;
    },
    settings,
    scene,
    camera,
    renderer,
    controls,
    speaker,
    studio,
    audio,
    gui,
    waveView,
    pause,
    next,
    previous,
    scatter: reset,
    reset,
    advance,
    render,
    stop,
    setGrainCount,
    setView,
    setParticles,
    get viewBlend() {
      return viewBlend;
    },
    get particleBlend() {
      return particleBlend;
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
      syncAudio();
    },
    get stopped() {
      return stopped;
    },
  };
  function animate(now) {
    if (stopped) return;
    frame = requestAnimationFrame(animate);
    if (manual || document.hidden) {
      lastTime = null;
      return;
    }
    // Allow one batch ahead so a slow frame does not permanently reduce the
    // cadence. Bound the queue to keep controls responsive under GPU load.
    if (gpu.queuedBatches >= 2 && !paused) return;
    const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    // OrbitControls suspends its own auto-rotation during a drag. Apply our
    // positive-Y orbit separately so it stays additive to camera gestures.
    if (settings.orbit && !paused && dt > 0) {
      camera.position
        .sub(controls.target)
        .applyAxisAngle(orbitAxis, ((dt * Math.PI) / 30) * settings.orbitSpeed)
        .add(controls.target);
      dirty = true;
    }
    controls.update(dt);
    advanceView(dt);
    advanceParticles(dt);
    if (!paused) advance(dt);
    else advanceFrequency(dt);
    syncAudio();
    if (dirty) render();
  }
  frame = requestAnimationFrame(animate);
}
