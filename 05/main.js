import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { MossDrawingPipeline } from './moss-pipeline.js';
import { createMaterials } from './materials.js';
import { createGarden } from './garden.js';
import { createHabitat } from './habitat.js';
import { createPostProcessing } from './post-processing.js';
import { createFireflies, FIREFLY_COUNT } from './fireflies.js';
import { createBackgroundLight } from './background-light.js';
import { groundHeight } from './woodland.js';
import { cameraLiftProgress } from './floating-rocks.js';
import { createSettings, createSettingsPanel } from './settings.js';

export async function startExperiment() {
  const startup = window.mossStartup = { modulesMs: performance.now() };
  let phaseStarted = performance.now();
  const finishPhase = name => {
    const now = performance.now();
    startup[name] = now - phaseStarted;
    phaseStarted = now;
  };
  const canvas = document.querySelector('canvas'), status = document.querySelector('#status');
  const progress = message => { status.textContent = message; };
  const abort = new AbortController();
  const listen = (object, name, fn) => object.addEventListener(name, fn, { signal: abort.signal });
  const settings = createSettings(matchMedia('(prefers-reduced-motion: reduce)').matches);
  let renderer, garden, habitat, materials, post, controls, gui, meshlets, fireflies, backgroundLight;
  let stopped = false, animation = 0, dirty = true, lastTime = null, manual = false, focusTimer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, .015, 120);
  const focusPoint = new THREE.Vector3(0, 2.2, 0);
  const metrics = { frames: 0, fps: 0 };
  const changed = () => { dirty = true; };
  function stop(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(animation);
    clearTimeout(focusTimer);
    abort.abort();
    controls?.dispose(); gui?.destroy(); post?.dispose();
    garden?.dispose(); habitat?.dispose(); fireflies?.dispose(); backgroundLight?.dispose(); materials?.dispose();
    renderer?.dispose().catch(error => console.warn('Renderer cleanup:', error));
    if (error) { status.hidden = false; status.textContent = `Stopped: ${error.message}`; console.error(error); }
  }
  try {
    if (!navigator.gpu) throw new Error('This experiment needs a browser with WebGPU enabled.');
    renderer = new THREE.WebGPURenderer({ canvas, antialias: false, forceWebGL: false });
    renderer.onDeviceLost = info => stop(new Error(`Graphics device lost: ${info.message}`));
    await renderer.init();
    finishPhase('deviceMs');
    if (!renderer.backend.isWebGPUBackend) throw new Error('A WebGPU adapter is required for the meshlet experiment.');
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    meshlets = new MossDrawingPipeline({ lodThreshold: settings.lod, shadowLodThreshold: 3, occlusionCulling: true });
    renderer.drawingPipeline = meshlets;
    materials = createMaterials(settings);
    garden = await createGarden(materials, progress);
    finishPhase('gardenMs');
    garden.setSporophytes(settings.sporophytes);
    scene.add(garden.group);
    progress('Growing woodland and gathering light…');
    habitat = await createHabitat(scene, renderer, materials, settings);
    finishPhase('habitatMs');
    // The static environment capture needs no clusters. Install the light grid
    // before compiling the live scene, with room for every firefly in one cell.
    renderer.lighting.dispose();
    renderer.lighting = new ClusteredLighting(FIREFLY_COUNT + 1, 32, 24, FIREFLY_COUNT + 1);
    fireflies = createFireflies(garden.rocks.map(rock => rock.layout),
      (index, out) => out.copy(garden.rocks[index].reaction.offset));
    scene.add(fireflies.group);
    backgroundLight = createBackgroundLight();
    scene.add(backgroundLight.light);
    controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.minDistance = .28;
    controls.maxDistance = 10;
    controls.maxPolarAngle = Math.PI * .8;
    controls.minPolarAngle = .08;
    controls.autoRotateSpeed = -.8;
    controls.zoomSpeed = .65;
    let responsiveScale = Math.max(1, .95 / camera.aspect);
    const heroLayout = garden.rocks[0].layout;
    const openingOffset = () => -(heroLayout.center[1] - heroLayout.groundY) * (1 - cameraLiftProgress(materials.time.value));
    let cameraLiftOffset = openingOffset();
    function followOpening() {
      const offset = openingOffset(), delta = offset - cameraLiftOffset;
      camera.position.y += delta; controls.target.y += delta; focusPoint.y += delta;
      cameraLiftOffset = offset;
    }
    function resetView() {
      clearTimeout(focusTimer);
      document.querySelector('#focus-mark').hidden = true;
      const damping = controls.enableDamping;
      controls.enableDamping = false; controls.autoRotate = false; controls.update();
      controls.target.set(0, 2.2, 0);
      camera.position.set(1.2, 3.45, 5).sub(controls.target).multiplyScalar(responsiveScale).add(controls.target);
      cameraLiftOffset = openingOffset();
      controls.target.y += cameraLiftOffset; camera.position.y += cameraLiftOffset;
      focusPoint.copy(controls.target);
      controls.update(); controls.enableDamping = damping;
      changed();
    }
    resetView();
    controls.addEventListener('change', changed);
    post = createPostProcessing(renderer, scene, camera, settings, garden.group, fireflies);
    function rebuildPostProcessing() {
      post.dispose();
      post = createPostProcessing(renderer, scene, camera, settings, garden.group, fireflies);
      if (window.moss?.scene === scene) window.moss.post = post;
      changed();
    }
    function setMSAA(value) {
      settings.msaa = Boolean(value);
      if (post.scenePass.options.samples === (settings.msaa ? 4 : 0)) return;
      // Depth sampling shaders differ for multisampled textures.
      rebuildPostProcessing();
    }
    function setAmbientOcclusion(value) {
      settings.ambientOcclusion = Boolean(value);
      if (Boolean(post.occlusion) === settings.ambientOcclusion) return;
      rebuildPostProcessing();
    }
    function resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      const nextScale = Math.max(1, .95 / camera.aspect);
      camera.position.sub(controls.target).multiplyScalar(nextScale / responsiveScale).add(controls.target);
      responsiveScale = nextScale;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1) * settings.quality);
      renderer.setSize(innerWidth, innerHeight);
      changed();
    }
    resize();
    function updateSun() {
      habitat.updateLighting();
      changed();
    }
    function updateEnvironment() { habitat.refreshEnvironment(); changed(); }
    updateSun();
    function sync() {
      materials.wetness.value = settings.wetness;
      materials.wind.value = settings.breeze;
      materials.moss.translucencyNode.value = settings.translucency;
      renderer.toneMappingExposure = settings.exposure;
      post.enabled.value = settings.depthOfField ? 1 : 0;
      post.depthRange.value = settings.depthRange;
      post.aperture.value = settings.aperture;
      post.saturation.value = settings.saturation;
      post.grading.strength.value = settings.gradeStrength;
      post.grading.contrast.value = settings.gradeContrast;
      post.grading.shadows.value = settings.gradeShadows;
      post.grading.highlights.value = settings.gradeHighlights;
      garden.update(materials.time.value);
      fireflies.update(materials.time.value, settings.fireflies, settings.fireflyBrightness, settings.fireflyLighting);
      backgroundLight.update(materials.time.value, settings.backgroundLight, settings.backgroundLightBrightness);
      // Measure the actual nearby rock, not the orbit target: scrolling or
      // panning close to a side colony must also request the detailed leaves.
      const macroDetail = THREE.MathUtils.smoothstep(garden.distanceToSurface(camera.position), .55, 2.3);
      meshlets.lodThreshold = settings.lod * THREE.MathUtils.lerp(.18, 1, macroDetail);
      meshlets.debug = settings.meshlets;
    }
    function pause(value = !settings.pause) { settings.pause = value; lastTime = null; changed(); }
    function advance(dt) {
      if (!Number.isFinite(dt) || dt < 0) throw new Error('advance expects a finite, nonnegative time step.');
      materials.time.value += Math.min(.1, dt);
      changed();
    }
    function keepCameraOutside() {
      const moved = garden.keepCameraOutside(camera.position);
      const floor = groundHeight(camera.position.x, camera.position.z) + .25;
      if (camera.position.y < floor) {
        camera.position.y = floor;
        camera.lookAt(controls.target);
      } else if (moved) camera.lookAt(controls.target);
    }
    function render() { sync(); keepCameraOutside(); post.render(); dirty = false; metrics.frames++; }
    const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
    const focusSurfaces = [...garden.focusSurfaces, ...habitat.woodland.focusSurfaces];
    const hitMatrix = new THREE.Matrix4(), instanceMatrix = new THREE.Matrix4();
    const hitNormalMatrix = new THREE.Matrix3(), hitNormal = new THREE.Vector3();
    function pickSurface(x, y) {
      const rect = canvas.getBoundingClientRect();
      pointer.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObjects(focusSurfaces.filter(object => object.visible), false)[0];
    }
    function nudgeAt(x, y) {
      const hit = pickSurface(x, y);
      if (!hit || !garden.nudge(hit.object, hit.point, raycaster.ray.direction, materials.time.value)) return false;
      changed();
      return true;
    }
    function focusAt(x, y) {
      const hit = pickSurface(x, y);
      // Keep exploration around the subject, even after panning or zooming.
      // Distant woodland and empty sky are a quick way back to the main view.
      if (!hit || hit.point.distanceTo(garden.rocks[0].pivot.position) > controls.maxDistance) return false;
      hitMatrix.copy(hit.object.matrixWorld);
      if (hit.instanceId !== undefined) {
        hit.object.getMatrixAt(hit.instanceId, instanceMatrix);
        hitMatrix.multiply(instanceMatrix);
      }
      hitNormalMatrix.getNormalMatrix(hitMatrix);
      hitNormal.copy(hit.face.normal).applyMatrix3(hitNormalMatrix).normalize();
      focusPoint.copy(hit.point).addScaledVector(hitNormal, hit.object.userData.isMossBed ? .055 : .01);
      const mark = document.querySelector('#focus-mark');
      mark.style.left = `${x}px`; mark.style.top = `${y}px`; mark.hidden = false;
      clearTimeout(focusTimer); focusTimer = setTimeout(() => { mark.hidden = true; }, 650);
      changed();
      return true;
    }
    // React as soon as the primary pointer touches a rock. OrbitControls still
    // handles the same gesture, so dragging remains available after the press.
    listen(canvas, 'pointerdown', event => {
      if (event.isPrimary && event.button === 0) nudgeAt(event.clientX, event.clientY);
    });
    listen(canvas, 'dblclick', event => {
      if (focusAt(event.clientX, event.clientY)) {
        camera.position.lerp(focusPoint, .45);
        controls.target.lerp(focusPoint, .7);
        controls.update(); changed();
      } else resetView();
    });
    listen(window, 'resize', resize);
    listen(window, 'pagehide', () => stop());
    listen(document, 'visibilitychange', () => { lastTime = null; });
    listen(window, 'keydown', event => {
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); pause(); }
      if (event.code === 'KeyR') resetView();
    });
    gui = createSettingsPanel(settings, {
      garden, habitat, changed, resetView, updateSun, updateEnvironment, setMSAA, setAmbientOcclusion, resize, pause
    });
    progress('Preparing meshlets and light…');
    finishPhase('setupMs');
    await new Promise(resolve => requestAnimationFrame(resolve));
    await post.compile();
    finishPhase('compileMs');
    if (stopped) return;
    render();
    finishPhase('firstRenderMs');
    startup.readyMs = performance.now();
    startup.sceneMs = startup.readyMs - startup.modulesMs;
    status.hidden = true;
    let measuredAt = performance.now(), frameCount = 0;
    function frame(now) {
      if (stopped) return;
      animation = requestAnimationFrame(frame);
      if (document.hidden || manual) { lastTime = null; return; }
      const dt = lastTime === null ? 0 : Math.min((now - lastTime) / 1000, .05);
      lastTime = now;
      controls.autoRotate = settings.autoOrbit && !settings.pause;
      followOpening();
      controls.update(dt);
      try {
        if (!settings.pause) advance(dt);
        if (dirty) { render(); frameCount++; }
      } catch (error) { stop(error); }
      if (now - measuredAt >= 1000) {
        metrics.fps = Math.round(frameCount * 1000 / (now - measuredAt));
        measuredAt = now; frameCount = 0;
      }
    }
    window.moss = {
      renderer, scene, camera, controls, settings, garden, habitat, materials, post, meshlets, fireflies, backgroundLight, metrics, focusPoint,
      pause, advance, render, resetView, focusAt, nudgeAt, setMSAA, setAmbientOcclusion, dispose: stop,
      get manual() { return manual; }, set manual(value) {
        manual = Boolean(value);
        if (!manual) cameraLiftOffset = openingOffset();
        lastTime = null; changed();
      },
      inspect() { return { backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL', ...garden.stats, woodland: habitat.woodland.stats,
        meshletClusters: meshlets.info.clusters, meshletTriangles: meshlets.info.triangles,
        lodError: meshlets.lodThreshold, fireflies: settings.fireflies ? FIREFLY_COUNT : 0,
        focusDepth: [post.focusNear.value, post.focusFar.value], startup: { ...startup }, ...metrics, time: materials.time.value }; }
    };
    animation = requestAnimationFrame(frame);
  } catch (error) { stop(); throw error; }
}
