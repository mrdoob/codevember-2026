import * as THREE from 'three/webgpu';
import { createFeatherMaterial } from './feather-material.js';
import { createFeatherField } from './feather-field.js';
import { createLandscape } from './landscape.js';
import { createPostProcessing } from './post-processing.js';
import { createSettings, createSettingsPanel } from './settings.js';
import { createWheat } from './wheat.js';
import { createCameraOrbit } from './camera-orbit.js';
import { createFarm } from './farm.js';
import { WheatDrawingPipeline } from './wheat-pipeline.js';
import { CAMERA } from './scene-constants.js';

export async function startExperiment() {
  if (!navigator.gpu) throw new Error('This experiment needs a browser with WebGPU.');
  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer._getFallback = null;
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const meshlets = new WheatDrawingPipeline({ lodThreshold: .35, occlusionCulling: true });
  renderer.drawingPipeline = meshlets;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const settings = createSettings(reduced.matches);
  const landscape = createLandscape(scene);
  const fibers = createFeatherMaterial();
  const field = createFeatherField(scene, fibers.material, camera);
  const wheat = createWheat(scene, fibers);
  const farm = createFarm(scene, fibers);
  const post = createPostProcessing(renderer, scene, camera);
  const abort = new AbortController(), events = { signal: abort.signal };
  let manual = false, disposed = false, dirty = true, last = null;
  const orbit = createCameraOrbit(camera, canvas, changed, settings);
  function changed() { dirty = true; }
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.fov = camera.aspect < CAMERA.portraitAspect ? CAMERA.portraitFov : CAMERA.fov;
    camera.updateProjectionMatrix();
    field.setAspect(camera.aspect);
    field.update(0, settings);
    renderer.setPixelRatio(settings.resolution || devicePixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    changed();
  }
  function gust() {
    field.stir(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.8, .8, 0), 1.8);
    settings.paused = false;
    changed();
  }
  function reset() { field.reset(); orbit.reset(); field.update(0, settings); last = null; changed(); }
  function render() {
    renderer.toneMappingExposure = settings.exposure;
    fibers.time.value = field.time;
    fibers.breeze.value = settings.breeze;
    fibers.light.value = settings.sunlight;
    fibers.scattering.value = settings.scattering;
    wheat.sun.intensity = 3.2 * settings.sunlight;
    post.focus.value = settings.focus;
    post.aperture.value = settings.aperture * renderer.getPixelRatio();
    post.depthOfField.environmentBlur.value = settings.environmentBlur ? 1 : 0;
    post.glow.strength.value = settings.bloom;
    post.saturation.value = settings.saturation;
    post.render(); dirty = false;
  }
  function advance(dt) {
    // Bound each substep so an input impulse settles identically during capture
    // and interactive playback, including after a browser frame stall.
    let remaining = Math.max(0, Math.min(dt, 1));
    while (remaining > 1e-6) { const step = Math.min(remaining, 1 / 60); field.update(step, settings); remaining -= step; }
    changed();
  }
  const gui = createSettingsPanel(settings, { changed, resize, gust, reset });
  window.addEventListener('resize', resize, events);
  document.addEventListener('visibilitychange', () => { last = null; }, events);
  reduced.addEventListener('change', () => { settings.paused = reduced.matches; changed(); }, events);
  window.addEventListener('keydown', event => {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.code === 'Space') { event.preventDefault(); settings.paused = !settings.paused; changed(); }
    if (event.code === 'KeyR') reset();
    if (event.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    if (event.code === 'KeyG') gust();
  }, events);
  resize(); field.update(0, settings);
  document.querySelector('#status').textContent = 'Gathering the field…';
  await post.compile();
  window.feather = {
    renderer, meshlets, scene, camera, orbit, settings, field, fibers, landscape, wheat, farm, post, gui,
    render, advance, reset, gust, resize,
    get manual() { return manual; }, set manual(value) { manual = value; last = null; },
    get time() { return field.time; },
    dispose() {
      disposed = true; renderer.setAnimationLoop(null); abort.abort();
      orbit.dispose(); gui.destroy();
      // Release depth-layer copies before their shared source geometry.
      post.dispose(); field.dispose(); wheat.dispose(); farm.dispose();
      fibers.material.dispose(); renderer.dispose();
    },
  };
  render();
  document.querySelector('#status').hidden = true;
  renderer.setAnimationLoop(timestamp => {
    if (disposed || manual || document.hidden) { last = null; return; }
    const dt = last === null ? 0 : Math.min((timestamp - last) / 1000, .05);
    last = timestamp;
    orbit.update(dt);
    if (!settings.paused) advance(dt * settings.speed);
    if (!settings.paused || dirty) render();
  });
}
