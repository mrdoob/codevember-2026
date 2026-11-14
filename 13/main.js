import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { HedgeDrawingPipeline } from './hedge-pipeline.js';
import { createMaze } from './maze.js';
import { createMaterials } from './materials.js';
import { createHedges } from './hedges.js';
import { createJourney } from './journey.js';
import { createSnow } from './snow.js';
import { createLighting } from './lighting.js';
import { createSnowfall } from './snowfall.js';
import { createPostProcessing } from './post-processing.js';
import { createSettings, createSettingsPanel } from './settings.js';
import { createMusic } from './music.js';
import { createMinimap } from './minimap.js';

export async function startExperiment() {
  if (!navigator.gpu) throw new Error('This experiment needs a browser with WebGPU.');
  const canvas = document.querySelector('main canvas'), status = document.querySelector('#status');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  renderer._getFallback = null; await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const meshlets = new HedgeDrawingPipeline({ lodThreshold: 1.5, occlusionCulling: true });
  renderer.drawingPipeline = meshlets;
  renderer.lighting.dispose(); renderer.lighting = new ClusteredLighting(256, 32, 24, 32);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(.008, .015, .032);
  const camera = new THREE.PerspectiveCamera(53, 1, .08, 70);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const settings = createSettings(reduced.matches), maze = createMaze();
  const materials = createMaterials();
  let manual = false, disposed = false, dirty = true, last = null, time = 0;
  const music = createMusic(settings);
  const changed = () => { dirty = true; music.sync(); };
  const journey = createJourney(maze, camera, canvas, settings, changed);
  status.textContent = 'Growing the snowbound hedges…'; await new Promise(requestAnimationFrame);
  const hedges = createHedges(scene, maze, materials);
  status.textContent = 'Following the footprints…'; await new Promise(requestAnimationFrame);
  const snow = createSnow(scene, maze, journey, materials);
  const lighting = createLighting(scene, maze, journey);
  const snowfall = createSnowfall(scene, camera);
  const post = createPostProcessing(renderer, scene, camera, lighting);
  const abort = new AbortController(), events = { signal: abort.signal };
  const minimap = createMinimap(document.querySelector('#map'));
  function map() { minimap.setVisible(settings.map); changed(); }
  function resize() {
    camera.aspect = innerWidth / innerHeight; camera.fov = camera.aspect < .8 ? 64 : 53; camera.updateProjectionMatrix();
    const ratio = settings.resolution === -1 ? devicePixelRatio : settings.resolution || Math.min(devicePixelRatio, 1.25);
    renderer.setPixelRatio(ratio); renderer.setSize(innerWidth, innerHeight);
    meshlets.lodThreshold = 1.2 * ratio; changed();
  }
  function render() {
    renderer.toneMappingExposure = settings.exposure; meshlets.debug = settings.meshlets;
    lighting.update(settings); snowfall.update(time, settings.snowfall);
    post.atmosphere.time.value = time; post.atmosphere.density.value = settings.fog; post.atmosphere.lightStrength.value = settings.lights;
    post.glow.strength.value = settings.bloom;
    post.render(); minimap.draw(camera); dirty = false;
  }
  function advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('advance expects a finite, nonnegative timestep.');
    music.sync();
    if (!settings.paused) time += dt;
    const moved = journey.update(dt);
    if (!settings.paused || moved) changed();
  }
  function reset() { time = 0; journey.reset(); last = null; changed(); }
  function restartFlight() { settings.paused = false; reset(); }
  const gui = createSettingsPanel(settings, { changed, resize, map, restartFlight, sound: () => { music.sync(); if (settings.music) void music.unlock(); } });
  window.addEventListener('resize', resize, events);
  document.addEventListener('visibilitychange', () => { last = null; }, events);
  reduced.addEventListener('change', () => { settings.paused = reduced.matches; changed(); }, events);
  window.addEventListener('keydown', event => {
    if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.target.closest?.('[data-no-navigation]') && ['Space', 'Enter'].includes(event.code)) return;
    if (event.repeat) return;
    if (event.code === 'Space') { event.preventDefault(); settings.paused = !settings.paused; changed(); }
    if (event.code === 'KeyR') restartFlight();
    if (event.code === 'KeyH') document.body.classList.toggle('ui-hidden');
    if (event.code === 'KeyM') { settings.map = !settings.map; map(); }
  }, events);
  resize(); journey.update(0);
  window.labyrinth = {
    renderer, meshlets, scene, camera, maze, materials, hedges, snow, lighting, snowfall, journey, post, settings, gui, music,
    render, advance, reset, resize,
    get time() { return time; }, get manual() { return manual; }, set manual(value) { manual = value; last = null; },
    dispose() { disposed = true; renderer.setAnimationLoop(null); abort.abort(); void music.dispose(); journey.dispose(); gui.destroy(); post.dispose(); snow.dispose(); hedges.dispose(); lighting.dispose(); snowfall.dispose(); materials.dispose(); renderer.dispose(); },
  };
  renderer.onDeviceLost = info => { disposed = true; renderer.setAnimationLoop(null); void music.dispose(); status.hidden = false; status.textContent = `Graphics device lost: ${info.message}. Reload to start again.`; };
  status.textContent = 'Lighting the winter night…'; await new Promise(requestAnimationFrame);
  await post.compile(); render(); status.hidden = true;
  renderer.setAnimationLoop(timestamp => {
    if (disposed || manual || document.hidden) { last = null; return; }
    const dt = last === null ? 0 : Math.min((timestamp - last) / 1000, .05); last = timestamp;
    advance(dt);
    if (!settings.paused || dirty) render();
  });
}
