import * as THREE from 'three/webgpu';
import { attribute, color, normalWorldGeometry, positionWorld, mix, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { sampleSculpture, PRIMITIVES } from './sculpture.js';
import { GPUMelt } from './gpu-melt.js';
import { createStudioLighting } from './studio-lighting.js';
import { WaxNodeMaterial, applyWaxFinish } from './wax-material.js';
import { createPostProcessing } from './post-processing.js';
import { drawingSize, simulationStep } from './runtime.js';
import { HEAT_RADIUS, HEAT_DURATION, heatSourceHeight } from './heat-source.js';
import { createFireParticle } from './fire-particle.js';

const DEFAULT_GRADE = Object.freeze({ temperature: 0, tint: 1, saturation: 1, contrast: 1.25 });
const DEFAULT_EXPOSURE = .9;

export async function startExperiment() {
  const status = document.querySelector('#status'), canvas = document.querySelector('canvas');
  let renderer, melt, gui, controls, device, scene, postProcessing;
  let stopped = false, animation = 0, watchdog = 0;
  const abort = new AbortController();
  const listen = (target, name, callback) => target.addEventListener(name, callback, { signal: abort.signal });
  function stop(error) {
    if (stopped) return;
    stopped = true; cancelAnimationFrame(animation); clearTimeout(watchdog); abort.abort();
    controls?.dispose(); gui?.destroy();
    status.hidden = false; status.textContent = error ? `Stopped: ${error.message}` : 'Experiment stopped. Reload to start again.';
    if (error) console.error(error);
    postProcessing?.dispose(); melt?.dispose(); scene?.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
    renderer?.dispose().catch(error => console.warn('Renderer cleanup:', error)); device?.destroy();
  }
  try {
    if (!navigator.gpu) throw new Error('This experiment requires WebGPU.');
    let seed = sampleSculpture();
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('A WebGPU adapter is not available.');
    const timing = new URLSearchParams(location.search).has('profile') && adapter.features.has('timestamp-query');
    const features = timing ? ['timestamp-query'] : [];
    device = await adapter.requestDevice({ requiredFeatures: features });
    renderer = new THREE.WebGPURenderer({ canvas, device, antialias: false, alpha: false, trackTimestamp: timing });
    // r187 otherwise attempts WebGL after initialization failure. Fail once.
    renderer._getFallback = null;
    renderer.onDeviceLost = info => stop(new Error(`WebGPU device lost: ${info.message}`));
    renderer.onError = info => stop(new Error(info.message || 'WebGPU rendering error'));
    await renderer.init(); if (stopped) return;
    listen(window, 'pagehide', () => stop());
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = DEFAULT_EXPOSURE; renderer.setPixelRatio(1);
    renderer.info.autoReset = false;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    const settings = {
      shape: seed.shape,
      heat: 1, heatRadius: HEAT_RADIUS, heatDuration: HEAT_DURATION,
      fireBrightness: 10, showHeatSource: true,
      viscosity: .75, tension: 1, speed: 1, pause: false,
      roughness: .58, diffuseRoughness: .65, clearcoat: .04,
      scattering: 1.5, scatterDistance: .5,
      shadowSoftness: .12, shadowAO: .55,
      exposure: DEFAULT_EXPOSURE, ...DEFAULT_GRADE,
      autoOrbit: true, quality: 1
    };
    scene = new THREE.Scene(); scene.background = new THREE.Color('#c9bdbe'); scene.fog = new THREE.Fog('#c9bdbe', 18, 40);
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .1, 60);
    const distance = Math.max(8.2, 5.4 / camera.aspect);
    camera.position.set(distance * .18, 3.3, distance);
    controls = new OrbitControls(camera, canvas);
    controls.target.set(0, 1.4, 0); controls.enableDamping = true; controls.enablePan = false;
    controls.autoRotate = settings.autoOrbit; controls.autoRotateSpeed = .7;
    controls.minDistance = 5; controls.maxDistance = 24; controls.maxPolarAngle = Math.PI * .48; controls.update(0);
    const studio = createStudioLighting(scene, settings.shadowSoftness, settings.shadowAO);
    const material = new WaxNodeMaterial({ vertexColors: true, roughness: settings.roughness, diffuseRoughness: settings.diffuseRoughness, clearcoat: settings.clearcoat, clearcoatRoughness: .3, ior: 1.44, specularIntensity: .8 });
    const scattering = uniform(settings.scattering), scatterDistance = uniform(settings.scatterDistance);
    material.thicknessColorNode = attribute('color','vec3').mul(color('#ffe5cb'));
    material.thicknessAttenuationNode = scattering;
    material.scatterDistanceNode = scatterDistance;
    material.aoNode = studio.shadowAO;
    material.shadowSide = THREE.FrontSide;
    melt = new GPUMelt(seed, material); scene.add(melt.mesh);
    material.fireSphereNode = melt.fireSphere;
    const fireLight = new THREE.PointLight('#ffb05e', settings.fireBrightness);
    fireLight.userData.waxThicknessIndex = 2; fireLight.userData.waxFire = true;
    scene.add(fireLight);
    const fireGlow = uniform(settings.fireBrightness);
    const fireParticle = createFireParticle(fireGlow); scene.add(fireParticle);
    const fieldSample = melt.sampleSurface(positionWorld, normalWorldGeometry);
    const { roughness: waxRoughness, diffuseRoughness: waxDiffuseRoughness } = applyWaxFinish(material, fieldSample, settings.roughness, settings.diffuseRoughness);
    // The floor and wax share the same PCSS shadow, including contact detail.
    const floorMaterial = new THREE.MeshBasicNodeMaterial();
    const floorColor = mix(color('#ccb0c1'), color('#a8c7cf'), positionWorld.x.mul(.065).add(.5).clamp());
    floorMaterial.colorNode = floorColor.mul(studio.keyShadow.mul(.45).add(studio.shadowAO.mul(.55)));
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), floorMaterial);
    floor.rotation.x = -Math.PI / 2; floor.position.y = -.07; floor.receiveShadow = true; scene.add(floor);
    postProcessing = createPostProcessing(renderer, scene, camera, settings);
    function drawScene() {
      fireLight.position.y = heatSourceHeight(melt.top, melt.time, settings.heatRadius, settings.heatDuration);
      fireLight.intensity = settings.fireBrightness * settings.heat;
      fireGlow.value = fireLight.intensity;
      fireParticle.visible = settings.showHeatSource && settings.heat > 0;
      fireParticle.position.copy(fireLight.position);
      fireParticle.quaternion.copy(camera.quaternion);
      postProcessing.render();
    }

    let changed = true, gpuPending = false, lastFrame = null, manual = false, resetPending = false, pendingShape = null;
    let stats = { time: 0, liquid: 0, particles: seed.groups.length, triangles: 0 };
    const metrics = { cpuMs: 0, gpuComputeMs: null, gpuRenderMs: null, fps: 0, frames: 0 };
    let inspecting = false, lastInspection = 0, measureStart = performance.now(), measuredFrames = 0;
    let clickOrigin = null;
    const releasePointer = () => { clickOrigin = null; };
    listen(canvas, 'pointerdown', event => {
      if (event.button === 0) clickOrigin = { x: event.clientX, y: event.clientY };
    });
    listen(window, 'pointermove', event => {
      if (clickOrigin && Math.hypot(event.clientX-clickOrigin.x, event.clientY-clickOrigin.y) > 5) releasePointer();
    });
    listen(window, 'pointerup', event => {
      const changeShape = clickOrigin && event.target === canvas;
      releasePointer();
      if (changeShape) nextShape();
    });
    listen(window, 'pointercancel', releasePointer); listen(window, 'blur', releasePointer);
    listen(document, 'visibilitychange', () => { releasePointer(); lastFrame = null; });
    function reset() { releasePointer(); resetPending = true; changed = true; lastFrame = null; }
    function selectShape(shape, rotation, thermalSeed) {
      if (!PRIMITIVES.includes(shape)) throw new Error('Unknown primitive: '+shape);
      settings.shape = shape; pendingShape = { shape, rotation, thermalSeed }; reset();
    }
    function nextShape() { selectShape(PRIMITIVES[(PRIMITIVES.indexOf(settings.shape)+1)%PRIMITIVES.length]); }
    function pause(value = !settings.pause) { settings.pause = value; lastFrame = null; }
    listen(window, 'keydown', event => {
      if (event.code === 'Escape') { stop(); return; }
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); pause(); }
      if (event.code === 'KeyR') reset();
      if (event.code === 'Enter' || event.code === 'ArrowRight') nextShape();
    });
    gui = new GUI({ title: 'Settings', width: 244 });
    const motion = gui.addFolder('Melt');
    motion.add(settings, 'shape', PRIMITIVES).name('Primitive').listen().onChange(selectShape);
    motion.add(settings, 'heat', 0, 2, .05).name('Fire strength').onChange(() => { changed = true; });
    motion.add(settings, 'heatRadius', .25, 2.5, .05).name('Fire radius').onChange(() => { changed = true; });
    motion.add(settings, 'heatDuration', 1, 12, .25).name('Descent seconds').onChange(() => { changed = true; });
    motion.add(settings, 'fireBrightness', 0, 25, .25).name('Fire brightness').onChange(() => { changed = true; });
    motion.add(settings, 'showHeatSource').name('Show heat source').onChange(() => { changed = true; });
    motion.add(settings, 'viscosity', .1, 1, .01).name('Viscosity');
    motion.add(settings, 'tension', 0, 3, .05).name('Cohesion');
    motion.add(settings, 'speed', .25, 1, .05).name('Time scale');
    motion.add(settings, 'pause').name('Pause').listen().onChange(pause);
    motion.add({ reset }, 'reset').name('Reset sculpture');
    const appearance = gui.addFolder('Appearance');
    appearance.add(settings, 'autoOrbit').name('Auto orbit').onChange(value => { controls.autoRotate = value; changed = true; });
    appearance.add(settings, 'roughness', .15, .85, .01).onChange(v => { material.roughness = v; waxRoughness.value = v; changed = true; });
    appearance.add(settings, 'diffuseRoughness', 0, 1, .01).name('Diffuse roughness').onChange(v => { material.diffuseRoughness = v; waxDiffuseRoughness.value = v; changed = true; });
    appearance.add(settings, 'clearcoat', 0, 1, .01).onChange(v => { material.clearcoat = v; changed = true; });
    appearance.add(settings, 'scattering', 0, 1.5, .01).name('Subsurface scattering').onChange(v => { scattering.value=v; changed=true; });
    appearance.add(settings, 'scatterDistance', .1, 1.2, .01).name('Scatter distance').onChange(v => { scatterDistance.value=v; changed=true; });
    appearance.add(settings, 'shadowSoftness', 0, .3, .005).name('PCSS softness').onChange(value => { studio.shadowSoftness.value = value; changed = true; });
    appearance.add(settings, 'shadowAO', 0, 1, .05).name('Shadow AO').onChange(value => { studio.shadowAOStrength.value = value; changed = true; });
    appearance.add(settings, 'quality', { '50%': .5, '75%': .75, Native: 1 }).name('Resolution').onChange(resize);
    const grading = gui.addFolder('Color grading');
    grading.add(settings, 'exposure', .5, 1.8, .01).name('Exposure').listen().onChange(v => { renderer.toneMappingExposure = v; changed = true; });
    for (const [name, label, min, max] of [
      ['temperature', 'Temperature', -1, 1], ['tint', 'Tint', -1, 1],
      ['saturation', 'Saturation', 0, 2], ['contrast', 'Contrast', .5, 1.5]
    ]) {
      grading.add(settings, name, min, max, .01).name(label).listen().onChange(v => { postProcessing.grading[name].value = v; changed = true; });
    }
    grading.add({ reset() {
      for (const [name, value] of Object.entries(DEFAULT_GRADE)) {
        settings[name] = value; postProcessing.grading[name].value = value;
      }
      settings.exposure = DEFAULT_EXPOSURE; renderer.toneMappingExposure = DEFAULT_EXPOSURE; changed = true;
    } }, 'reset').name('Reset grade');
    gui.close();
    function resize() {
      camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
      const size = drawingSize(innerWidth, innerHeight, settings.quality, window.devicePixelRatio || 1);
      renderer.setSize(size.width, size.height, false); changed = true;
    }
    listen(window, 'resize', resize); resize(); controls.addEventListener('change', () => { changed = true; });
    async function inspect() {
      if (stopped || inspecting) return stats;
      inspecting = true;
      try {
        stats = await melt.inspect(renderer);
        if (stats.overflow) throw new Error('Surface exceeded its triangle budget.');
        if (timing) {
          await renderer.resolveTimestampsAsync('compute'); await renderer.resolveTimestampsAsync('render');
          metrics.gpuComputeMs = renderer.info.compute.timestamp; metrics.gpuRenderMs = renderer.info.render.timestamp;
        }
      } catch (error) { if (!stopped) stop(error); }
      finally { inspecting = false; }
      return stats;
    }
    async function render(dt = 0, onRendered) {
      if (stopped || gpuPending) return;
      gpuPending = true;
      const start = performance.now();
      try {
        watchdog = setTimeout(() => stop(new Error('Graphics did not respond; rendering has stopped.')), 5000);
        renderer.info.reset();
        if (pendingShape) {
          seed = sampleSculpture(pendingShape.shape, pendingShape.thermalSeed, pendingShape.rotation);
          melt.setSeed(seed);
          pendingShape = null;
        }
        if (resetPending) {
          resetPending = false;
          melt.reset(renderer, settings);
          stats = { ...stats, time: 0, liquid: 0 };
        } else {
          melt.advance(renderer, dt, settings);
        }
        controls.update(0); changed = false; drawScene();
        // Capture may copy the canvas here, before browser presentation clears it.
        onRendered?.();
        metrics.cpuMs = performance.now() - start;
        metrics.frames++; measuredFrames++;
        await device.queue.onSubmittedWorkDone();
      } catch (error) { stop(error); }
      finally { clearTimeout(watchdog); gpuPending = false; }
      if (stopped) return;
      // Present the floor-contact frame, then start a fresh, randomly oriented
      // sculpture on the next frame. Manual validation keeps its selected shape.
      if (!manual && !settings.pause && melt.time + 1e-9 >= settings.heatDuration) nextShape();
      const now = performance.now();
      if (now - measureStart >= 1000) { metrics.fps = measuredFrames * 1000 / (now - measureStart); measuredFrames = 0; measureStart = now; }
      if (now - lastInspection >= 1000) { lastInspection = now; inspect(); }
    }
    function frame(now) {
      if (stopped) return;
      animation = requestAnimationFrame(frame);
      if (document.hidden || manual) { lastFrame = null; return; }
      if (gpuPending) return;
      const elapsed = lastFrame === null ? 0 : simulationStep((now - lastFrame) / 1000).elapsed;
      // Orbit once per displayed frame using wall time, independently of the
      // simulation speed. Paused/manual previews keep their camera stationary.
      controls.update(settings.pause ? 0 : elapsed);
      const dt = settings.pause ? 0 : elapsed * settings.speed;
      lastFrame = settings.pause ? null : now;
      if (changed || dt > 0) render(dt).catch(stop);
    }
    watchdog = setTimeout(() => stop(new Error('Graphics initialization timed out.')), 10000);
    melt.reset(renderer, settings);
    await postProcessing.scenePass.compileAsync(renderer);
    await device.queue.onSubmittedWorkDone(); clearTimeout(watchdog);
    if (stopped) return;
    status.hidden = true;
    await render();
    if (!stopped) animation = requestAnimationFrame(frame);
    window.melt = {
      settings, get seed() { return seed; }, surface: melt, gpu: melt, renderer, camera, controls, scene, material, stop, selectShape, nextShape,
      scattering, scatterDistance, diffuseRoughness: waxDiffuseRoughness, postProcessing, studio, fireParticle, fireLight, drawScene,
      get stats() { return { ...stats, time: melt.time }; },
      get performance() { return { ...metrics, triangles: stats.triangles }; },
      pause, reset, render, inspect,
      async advance(dt, onRendered) {
        manual = true; while (!stopped && gpuPending) await new Promise(resolve => setTimeout(resolve, 10));
        if (stopped) throw new Error('Experiment stopped');
        await render(simulationStep(dt).elapsed, onRendered); return { ...stats, time: melt.time };
      },
      resume() { manual = false; pause(false); measureStart = performance.now(); measuredFrames = 0; }
    };
  } catch (error) { stop(error); }
}
