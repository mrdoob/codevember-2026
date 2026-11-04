import * as THREE from 'three/webgpu';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RopeSimulation } from './rope-simulation.js';
import { GPURopeSimulation } from './gpu-rope.js';
import { Yarn, PALETTES } from './yarn.js';
import { createStudio } from './studio.js';
import { createPostProcessing } from './post-processing.js';
import { addDragging } from './drag.js';
import { DEFAULT_PHYSICS } from './rope-config.js';

const PHYSICS_KEYS = Object.keys(DEFAULT_PHYSICS);

export async function startExperiment() {
  const canvas = document.querySelector('canvas'),
    status = document.querySelector('#status');
  const abort = new AbortController();
  const listen = (target, event, fn) => target.addEventListener(event, fn, { signal: abort.signal });
  let renderer,
    gui,
    controls,
    drag,
    pipeline,
    scene,
    simulation,
    animation = 0,
    stopped = false;
  const yarns = [];
  const settings = {
    ...DEFAULT_PHYSICS,
    speed: 1,
    pause: matchMedia('(prefers-reduced-motion: reduce)').matches,
    palette: 'Haberdashery',
    sheen: 1,
    bump: 1.2,
    fiberAlignment: 0.85,
    shadowSoftness: 0.055,
    exposure: 1,
    contrast: 1.08,
    saturation: 1.1,
    temperature: 0,
    tint: 0,
    quality: 1,
    autoOrbit: true
  };
  function stop(error) {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(animation);
    abort.abort();
    drag?.dispose();
    controls?.dispose();
    gui?.destroy();
    pipeline?.dispose();
    for (const yarn of yarns) yarn.dispose();
    simulation?.dispose?.();
    scene?.traverse(object => {
      if (object.isLight) object.dispose();
    });
    studio?.floor.geometry.dispose();
    studio?.floor.material.dispose();
    renderer?.dispose().catch(error => console.warn('Renderer cleanup:', error));
    if (error) {
      status.hidden = false;
      status.textContent = `Stopped: ${error.message}`;
      console.error(error);
    }
  }
  let studio;
  try {
    renderer = new THREE.WebGPURenderer({ canvas, antialias: false, alpha: false });
    renderer.onDeviceLost = info => stop(new Error(`Graphics device lost: ${info.message}`));
    await renderer.init();
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.exposure;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    scene = new THREE.Scene();
    studio = createStudio(scene, renderer.backend.isWebGPUBackend === true);
    const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 70);
    const defaultCameraPosition = new THREE.Vector3(1.705246, 2.481762, 6.812798);
    const defaultCameraTarget = new THREE.Vector3(0, 0.9, 0);
    let cameraDistance = Math.max(1, 1.15 / camera.aspect);
    controls = new OrbitControls(camera, canvas);
    function setDefaultView() {
      // Consume any remaining orbit motion before restoring the saved view.
      const damping = controls.enableDamping,
        autoRotate = controls.autoRotate;
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.update();
      controls.target.copy(defaultCameraTarget);
      camera.position
        .copy(defaultCameraPosition)
        .sub(defaultCameraTarget)
        .multiplyScalar(cameraDistance)
        .add(defaultCameraTarget);
      controls.update();
      controls.enableDamping = damping;
      controls.autoRotate = autoRotate;
    }
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = 4.5;
    controls.maxDistance = 23;
    controls.maxPolarAngle = Math.PI * 0.47;
    controls.minPolarAngle = 0.12;
    controls.autoRotateSpeed = 0.5;
    setDefaultView();
    controls.saveState();
    if (renderer.backend.isWebGPUBackend) {
      const device = renderer.backend.device;
      device.pushErrorScope('validation');
      let error;
      try {
        simulation = new GPURopeSimulation(renderer);
      } finally {
        error = await device.popErrorScope();
      }
      if (error) throw new Error(`GPU simulation: ${error.message}`);
    } else simulation = new RopeSimulation();
    for (let s = 0; s < simulation.strands; s++) {
      const yarn = new Yarn(simulation, s, PALETTES[settings.palette][s]);
      yarn.material.aoNode = studio.ao;
      yarns.push(yarn);
      scene.add(yarn);
    }
    pipeline = createPostProcessing(renderer, scene, camera, settings);
    let dirty = true,
      lastTime = null,
      manual = false;
    const performanceStats = { fps: 0, simulationMs: 0, frames: 0 };
    let measuredAt = performance.now(),
      frameCount = 0;
    const changed = () => {
      dirty = true;
    };
    drag = addDragging(canvas, camera, simulation, controls, changed);
    controls.addEventListener('change', changed);
    function syncSettings() {
      for (const key of PHYSICS_KEYS) simulation.settings[key] = settings[key];
    }
    function updateYarn() {
      for (const yarn of yarns) yarn.update();
    }
    function draw() {
      pipeline.render();
      performanceStats.frames++;
      dirty = false;
    }
    function pause(value = !settings.pause) {
      settings.pause = value;
      lastTime = null;
      changed();
    }
    function reset() {
      drag.end();
      syncSettings();
      simulation.reset();
      updateYarn();
      lastTime = null;
      changed();
    }
    function palette(name) {
      if (!PALETTES[name]) return;
      settings.palette = name;
      yarns.forEach((yarn, i) => yarn.setColor(PALETTES[name][i]));
      changed();
    }
    function nextPalette() {
      const names = Object.keys(PALETTES);
      palette(names[(names.indexOf(settings.palette) + 1) % names.length]);
    }
    function resize() {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      const nextDistance = Math.max(1, 1.15 / camera.aspect);
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextDistance / cameraDistance)
        .add(controls.target);
      cameraDistance = nextDistance;
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5) * settings.quality);
      renderer.setSize(innerWidth, innerHeight);
      changed();
    }
    listen(window, 'resize', resize);
    listen(window, 'pagehide', () => stop());
    listen(document, 'visibilitychange', () => {
      lastTime = null;
    });
    listen(window, 'keydown', event => {
      if (/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        pause();
      }
      if (event.code === 'KeyR') reset();
      if (event.code === 'KeyC') nextPalette();
    });
    gui = new GUI({ title: 'Settings', width: 244 });
    const motion = gui.addFolder('Tangle');
    motion.add(settings, 'feed', 0, 3, 0.05).name('Yarn feed');
    motion.add(settings, 'wander', 0, 2, 0.05).name('Feeder orbit');
    motion.add(settings, 'softness', 0, 1, 0.01).name('Softness');
    motion.add(settings, 'friction', 0, 1, 0.01).name('Friction');
    motion.add(settings, 'speed', 0.2, 1.5, 0.05).name('Time scale');
    motion.add(settings, 'pause').name('Pause').listen().onChange(pause);
    motion.add({ reset }, 'reset').name('Reset tangle');
    const material = gui.addFolder('Yarn');
    material.add(settings, 'palette', Object.keys(PALETTES)).name('Palette').listen().onChange(palette);
    material
      .add(settings, 'sheen', 0, 1, 0.01)
      .name('Wool sheen')
      .onChange(value => {
        for (const yarn of yarns) yarn.material.sheen = value;
        changed();
      });
    material
      .add(settings, 'bump', 0, 4, 0.01)
      .name('Fiber relief')
      .onChange(value => {
        for (const yarn of yarns) yarn.bumpStrength.value = value;
        changed();
      });
    material
      .add(settings, 'fiberAlignment', 0, 1, 0.01)
      .name('Fiber alignment')
      .onChange(value => {
        for (const yarn of yarns) yarn.fiberAlignment.value = value;
        changed();
      });
    const appearance = gui.addFolder('Studio');
    appearance
      .add(settings, 'autoOrbit')
      .name('Auto orbit')
      .onChange(value => {
        controls.autoRotate = value;
        changed();
      });
    appearance
      .add(settings, 'shadowSoftness', 0.01, 0.14, 0.005)
      .name('Shadow softness')
      .onChange(value => {
        studio.softness.value = value;
        studio.key.shadow.radius = value * 60;
        changed();
      });
    appearance
      .add(settings, 'quality', { '50%': 0.5, '75%': 0.75, '100%': 1, '150%': 1.5 })
      .name('Resolution')
      .onChange(resize);
    appearance
      .add(
        {
          resetView() {
            setDefaultView();
            changed();
          }
        },
        'resetView'
      )
      .name('Reset camera');
    const grade = gui.addFolder('Color grading');
    grade
      .add(settings, 'exposure', 0.5, 1.8, 0.01)
      .name('Exposure')
      .onChange(value => {
        renderer.toneMappingExposure = value;
        changed();
      });
    for (const [key, min, max] of [
      ['contrast', 0.7, 1.5],
      ['saturation', 0, 2],
      ['temperature', -1, 1]
    ]) {
      grade.add(settings, key, min, max, 0.01).onChange(value => {
        pipeline.grading[key].value = value;
        changed();
      });
    }
    gui.close();
    resize();
    function frame(now) {
      if (stopped) return;
      animation = requestAnimationFrame(frame);
      if (document.hidden || manual) {
        lastTime = null;
        return;
      }
      const dt = lastTime === null ? 1 / 60 : Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      controls.autoRotate = settings.autoOrbit && !settings.pause;
      controls.update(dt);
      if (!settings.pause) {
        syncSettings();
        const start = performance.now();
        simulation.advance(dt * settings.speed);
        updateYarn();
        performanceStats.simulationMs = performance.now() - start;
        dirty = true;
      }
      if (dirty) draw();
      frameCount++;
      if (now - measuredAt > 1000) {
        performanceStats.fps = (frameCount * 1000) / (now - measuredAt);
        frameCount = 0;
        measuredAt = now;
      }
    }
    window.tangle = {
      renderer,
      scene,
      camera,
      controls,
      simulation,
      yarns,
      settings,
      drag,
      performance: performanceStats,
      pause,
      reset,
      palette,
      nextPalette,
      resize,
      stop,
      get manual() {
        return manual;
      },
      set manual(value) {
        manual = !!value;
        lastTime = null;
      },
      advance(dt) {
        syncSettings();
        simulation.advance(dt);
        updateYarn();
        changed();
      },
      render() {
        draw();
      },
      async inspect() {
        return {
          ...(await simulation.inspect()),
          engine: simulation.engine,
          ...performanceStats,
          backend: renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2'
        };
      }
    };
    draw();
    status.hidden = true;
    animation = requestAnimationFrame(frame);
  } catch (error) {
    stop(error);
    throw error;
  }
}
