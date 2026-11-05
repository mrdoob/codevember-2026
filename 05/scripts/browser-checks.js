import { DataUtils, Raycaster, Vector2, Vector3 } from 'three/webgpu';
import { setMacroView } from './views.js';
import { groundHeight } from '../woodland.js';
// Run in the live experiment: await (await import('./scripts/browser-checks.js')).runBrowserChecks()
export async function runBrowserChecks(app = window.moss) {
  if (!app) throw new Error('Wait for the experiment to finish loading.');
  const { renderer, camera, controls, garden, materials, settings, meshlets } = app;
  const device = renderer.backend.device;
  const saved = {
    settings: { ...settings }, position: camera.position.clone(), target: controls.target.clone(),
    focus: app.focusPoint.clone(), time: materials.time.value, manual: app.manual
  };
  const checks = [];
  const check = (name, condition) => { if (!condition) throw new Error(name); checks.push(name); };
  const frames = async count => {
    for (let i = 0; i < count; i++) {
      await new Promise(requestAnimationFrame);
      app.render(); await device.queue.onSubmittedWorkDone();
    }
  };
  app.manual = true;
  Object.assign(settings, { pause: true, autoOrbit: false, fireflies: true, fireflyLighting: true, backgroundLight: true });
  materials.time.value = 5;
  device.pushErrorScope('validation');
  let error, report;
  try {
    check('WebGPU backend and MeshletDrawingPipeline are active', renderer.backend.isWebGPUBackend && meshlets.isMeshletDrawingPipeline);
    const imageRequests = performance.getEntriesByType('resource').filter(resource => /\.(hdr|exr|jpg|jpeg|png|webp|ktx2?|glb|gltf)(\?|$)/i.test(resource.name));
    check('No image, environment-map, or model assets are loaded', imageRequests.length === 0);
    check('Lighting is captured into a generated render target', app.scene.environment.isRenderTargetTexture === true);
    check('SkyMesh supplies the visible sky and environment', app.habitat.sky.isSkyMesh
      && app.habitat.sky.parent === app.scene && app.habitat.sky.cloudSpeed.value === 0);
    garden.setDensity(1);
    app.resetView();
    await frames(35);
    const clustered = renderer.lighting.getNode(app.scene);
    check('All firefly point lights use ClusteredLighting', clustered.isClusteredLightsNode
      && clustered.clusteredLights.length === app.fireflies.lights.length + 1
      && app.fireflies.lights.every(light => clustered.clusteredLights.includes(light) && !light.castShadow));
    check('The drifting background light uses the same cluster grid', clustered.clusteredLights.includes(app.backgroundLight.light)
      && !app.backgroundLight.light.castShadow);
    const lightIndexes = new Int32Array(await renderer.getArrayBufferAsync(clustered._lightIndexes.value));
    check('The GPU populates the clustered light grid', lightIndexes.some(index => index > 0));
    // Read scene color before compositing lanterns: glowing sprites alone must
    // not be enough to pass the illumination regression.
    const target = app.post.scenePass.renderTarget;
    const read = () => renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    settings.fireflyLighting = false;
    await frames(3);
    const unlit = await read();
    settings.fireflyLighting = true;
    await frames(3);
    const lit = await read();
    let brighter = 0;
    for (let i = 0; i < lit.length; i += 4) {
      const added = [0, 1, 2].reduce((sum, c) => sum + DataUtils.fromHalfFloat(lit[i + c]) - DataUtils.fromHalfFloat(unlit[i + c]), 0);
      if (added > .03) brighter++;
    }
    check('Fireflies visibly light scene surfaces before glow compositing', brighter > target.width * target.height * .001);
    settings.backgroundLight = false;
    await frames(3);
    const withoutBackground = await read();
    let backgroundPixels = 0;
    for (let i = 0; i < lit.length; i += 4) {
      const added = [0, 1, 2].reduce((sum, c) => sum + DataUtils.fromHalfFloat(lit[i + c]) - DataUtils.fromHalfFloat(withoutBackground[i + c]), 0);
      if (added > .03) backgroundPixels++;
    }
    check('The moving background light visibly illuminates the woodland', backgroundPixels > target.width * target.height * .001);
    settings.backgroundLight = true;
    // Inspect final pixels as well as the scene pass: grading must reach the
    // displayed image, and zero strength must bypass every grading control.
    const output = app.post.outputTarget;
    const readOutput = () => renderer.readRenderTargetPixelsAsync(output, 0, 0, output.width, output.height);
    settings.gradeStrength = 0;
    await frames(2);
    const neutral = await readOutput();
    settings.gradeStrength = 1;
    await frames(2);
    const graded = await readOutput();
    let changedPixels = 0;
    for (let i = 0; i < neutral.length; i += 4) {
      if ([0, 1, 2].some(c => Math.abs(neutral[i + c] - graded[i + c]) > 2)) changedPixels++;
    }
    check('Color grading changes the rendered palette', changedPixels > output.width * output.height * .1);
    settings.gradeStrength = 0; settings.gradeContrast = 1.2; settings.saturation = .5;
    await frames(2);
    const bypassed = await readOutput();
    let bypassError = 0, differingChannels = 0;
    for (let i = 0; i < neutral.length; i++) {
      const delta = Math.abs(bypassed[i] - neutral[i]);
      bypassError += delta;
      if (delta > 1) differingChannels++;
    }
    // Indirect geometry can differ at a few shared edges even with an unchanged
    // view. Require a negligible mean difference and >99.95% matching channels.
    check('Zero grade strength bypasses contrast and saturation', bypassError / neutral.length < .01
      && differingChannels / neutral.length < .0005);
    for (const key of ['gradeStrength', 'gradeContrast', 'saturation']) settings[key] = saved.settings[key];
    check('GPU counters report visible meshlets', meshlets.info.clusters > 0 && meshlets.info.triangles > 0);
    // Pinned r187 internals are inspected only by diagnostics, not by rendering.
    const sceneBatches = [...meshlets._records].flatMap(reference => {
      const record = reference.deref();
      return record?.culling?.shadow === false ? [...record.staticGroups.values()].flatMap(group => group.entries) : [];
    }).filter(entry => entry.count > 0);
    const batches = sceneBatches.filter(entry => entry.material === materials.moss);
    check('All moss instances use GPU meshlet batches', batches.every(entry => entry.batch !== null)
      && batches.reduce((sum, entry) => sum + entry.count, 0) === garden.stats.tufts);
    check('Animated plant bounds remain GPU-cullable', batches.every(entry => entry.batch.unbounded.value === 0));
    check('Moss excludes LODs that prune the canopy into flecks', batches.every(entry => entry.batch.lodCount === 3
      && entry.batch.culling.tableArray[entry.batch.index * 12 + 10] === 3));
    const floorBatches = sceneBatches.filter(entry => entry.objects.some(object => object.name.startsWith('Floor moss shoots')));
    check('Floor moss uses GPU meshlets with the leaf-preserving LOD limit', floorBatches.length > 0
      && floorBatches.every(entry => entry.batch?.lodCount === 3)
      && floorBatches.reduce((sum, entry) => sum + entry.count, 0) === app.inspect().woodland.floorMossTufts);
    const outcropBatches = sceneBatches.filter(entry => entry.objects.some(object => object.name.startsWith('Ground rock moss shoots')));
    check('Ground rock shoots use GPU meshlets with the leaf-preserving LOD limit', outcropBatches.length > 0
      && outcropBatches.every(entry => entry.batch?.lodCount === 3)
      && outcropBatches.reduce((sum, entry) => sum + entry.count, 0) === app.inspect().woodland.outcropMossTufts);

    const t = materials.time.value;
    app.advance(1 / 30);
    check('Manual animation stepping is deterministic', Math.abs(materials.time.value - t - 1 / 30) < 1e-10);
    const before = garden.tufts.reduce((sum, mesh) => sum + mesh.count, 0);
    garden.setDensity(.35);
    await frames(2);
    check('Density changes the instance count', garden.tufts.reduce((sum, mesh) => sum + mesh.count, 0) < before * .36);
    garden.setDensity(0);
    await frames(2);
    check('Bare-stone mode hides both shoots and their substrate', garden.tufts.every(mesh => mesh.count === 0) && garden.beds.every(bed => !bed.visible) && garden.capsules.every(mesh => !mesh.visible));
    garden.setDensity(1);
    garden.setSporophytes(true);
    await frames(2);
    check('Spore capsules can be enabled', garden.capsules.every(mesh => mesh.visible));
    settings.meshlets = true;
    await frames(2);
    check('Meshlet debug mode renders', meshlets.debug);
    settings.meshlets = false;

    const canvas = renderer.domElement, rect = canvas.getBoundingClientRect();
    const oldFocus = app.focusPoint.clone();
    const oldDepth = [app.post.focusNear.value, app.post.focusFar.value];
    const screenPoint = garden.rocks[0].pivot.position.clone().project(camera);
    check('Navigation picking intersects the visible colony', app.focusAt(rect.left + rect.width * (screenPoint.x * .5 + .5), rect.top + rect.height * (.5 - screenPoint.y * .5)));
    check('Navigation picking updates the zoom destination', app.focusPoint.distanceTo(oldFocus) > .001);
    await frames(1);
    check('Picking a surface does not change whole-rock focus', app.post.focusNear.value === oldDepth[0] && app.post.focusFar.value === oldDepth[1]);
    const verifyFocus = label => {
      const { focusNear, focusFar, focusVolume } = app.post;
      check(`Whole colony stays inside the sharp depth interval: ${label}`, focusVolume.corners.every(corner => {
        const depth = -corner.clone().applyMatrix4(camera.matrixWorldInverse).z;
        return depth < camera.near || depth >= focusNear.value - 1e-6 && depth <= focusFar.value + 1e-6;
      }));
    };
    verifyFocus('default view');

    // Refresh the baseline after the earlier animation step: the opening
    // camera offset depends on the current lift time.
    app.resetView();
    const resetPosition = camera.position.clone(), resetTarget = controls.target.clone();
    const doubleClick = (x, y) => canvas.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: x, clientY: y }));
    doubleClick(rect.left + rect.width * (screenPoint.x * .5 + .5), rect.top + rect.height * (.5 - screenPoint.y * .5));
    check('Double-clicking a nearby rock still explores it', camera.position.distanceTo(resetPosition) > .1
      && controls.target.distanceTo(resetTarget) > .01);
    const picker = new Raycaster(), surfaces = [...garden.focusSurfaces, ...app.habitat.woodland.focusSurfaces].filter(object => object.visible);
    camera.updateMatrixWorld();
    let distantPoint;
    for (let y = -.9; y <= .9 && !distantPoint; y += .15) for (let x = -.9; x <= .9; x += .15) {
      picker.setFromCamera(new Vector2(x, y), camera);
      const hit = picker.intersectObjects(surfaces, false)[0];
      if (hit && hit.point.distanceTo(garden.rocks[0].pivot.position) > controls.maxDistance) {
        distantPoint = [rect.left + rect.width * (x * .5 + .5), rect.top + rect.height * (.5 - y * .5)];
        break;
      }
    }
    check('Distant woodland is rejected as an exploration destination', distantPoint && !app.focusAt(...distantPoint));
    doubleClick(...distantPoint);
    check('Double-clicking distant woodland restores the camera', camera.position.distanceTo(resetPosition) < 1e-6
      && controls.target.distanceTo(resetTarget) < 1e-6 && document.querySelector('#focus-mark').hidden);
    camera.position.set(0, 100, 0); camera.lookAt(new Vector3(0, 110, 0));
    doubleClick(rect.left + rect.width * .5, rect.top + rect.height * .5);
    check('Double-clicking empty sky also restores the camera', camera.position.distanceTo(resetPosition) < 1e-6
      && controls.target.distanceTo(resetTarget) < 1e-6);

    setMacroView(app);
    await frames(2);
    verifyFocus('macro view');
    check('Macro views tighten LOD to preserve leaf coverage', meshlets.lodThreshold < settings.lod * .6);
    const nearError = meshlets.lodThreshold;
    app.focusPoint.set(50, 50, 50);
    await frames(1);
    check('Nearby moss detail does not depend on the last picked point', Math.abs(meshlets.lodThreshold - nearError) < 1e-6);
    app.focusPoint.copy(controls.target);
    camera.position.set(-4, 2.5, -5); controls.target.set(0, 2.2, 0); controls.update();
    await frames(2);
    verifyFocus('opposite side');
    settings.fireflies = false;
    await frames(2);
    check('Disabling fireflies removes both lanterns and illumination', !app.fireflies.group.visible
      && !app.fireflies.glowScene.children[0].visible && app.fireflies.lights.every(light => light.intensity === 0)
      && clustered.clusteredLights.length === 1 && clustered.clusteredLights.includes(app.backgroundLight.light));
    settings.fireflies = true; settings.breeze = 0; settings.pause = false;
    const flyBefore = app.fireflies.positions.array.slice();
    const rockBefore = garden.rocks.map(rock => rock.pivot.position.clone());
    const backgroundBefore = app.backgroundLight.light.position.clone();
    app.manual = false;
    for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
    app.manual = true;
    check('Fireflies animate with the breeze turned off', flyBefore.some((value, i) => value !== app.fireflies.positions.array[i]));
    check('The background light moves independently of the breeze', app.backgroundLight.light.position.distanceTo(backgroundBefore) > 0);
    check('All four rocks float independently of the breeze', garden.rocks.length === 4 && garden.rocks.every((rock, i) => rock.pivot.position.distanceTo(rockBefore[i]) > 0));
    await frames(1);
    let uploadedStones = 0;
    for (const reference of meshlets._records) {
      const record = reference.deref();
      if (record?.culling?.shadow !== false) continue;
      const worlds = new Float32Array(await renderer.getArrayBufferAsync(record.culling.worldAttribute));
      for (const group of record.staticGroups.values()) for (const entry of group.entries) {
        if (entry.material !== materials.floatingStone || !entry.batch) continue;
        entry.objects.forEach((object, i) => {
          const offset = (entry.batch.dataOffset + i) * 16;
          check(`Floating pose reaches the GPU: rock ${++uploadedStones}`, object.matrixWorld.elements.every((value, j) => Math.abs(value - worlds[offset + j]) < 1e-5));
        });
      }
    }
    check('All floating stones have current GPU transforms', uploadedStones === 4);
    verifyFocus('floating animation');
    app.pause(true);
    const pausedTime = materials.time.value;
    const pausedLight = app.backgroundLight.light.position.clone();
    app.manual = false;
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    app.manual = true;
    check('Pause freezes firefly and moss animation together', materials.time.value === pausedTime);
    check('Pause freezes the background light', app.backgroundLight.light.position.distanceTo(pausedLight) === 0);
    camera.position.set(2, -1, 3); controls.target.set(0, 2.2, 0); controls.update();
    await frames(1);
    check('Low orbit can look up at the rocks while staying above soil', controls.maxPolarAngle > Math.PI / 2
      && camera.position.y < controls.target.y
      && camera.position.y >= groundHeight(camera.position.x, camera.position.z) + .249);
    verifyFocus('low orbit');
    for (const rock of garden.rocks) {
      camera.position.copy(rock.pivot.position);
      app.render();
      check(`Camera stays outside ${rock.pivot.name}`, camera.position.distanceTo(rock.pivot.position) > .2);
    }
    for (const enabled of [false, true]) {
      app.setMSAA(enabled);
      await frames(3);
      const target = app.post.scenePass.renderTarget;
      const color = renderer.backend.get(target.texture), depth = renderer.backend.get(target.depthTexture);
      check(`AA switch rebuilds color and depth sampling: ${enabled ? '4× MSAA' : 'FXAA only'}`,
        (enabled ? color.msaaTexture?.sampleCount === 4 : !color.msaaTexture)
        && depth.texture.sampleCount === (enabled ? 4 : 1));
    }
    app.setMSAA(saved.settings.msaa);
    report = { checks, scene: app.inspect() };
  } catch (failure) { error = failure; }
  finally {
    const validation = await device.popErrorScope();
    if (validation) error ||= new Error(`WebGPU validation: ${validation.message}`);
    Object.assign(settings, saved.settings);
    app.setMSAA(saved.settings.msaa);
    garden.setDensity(settings.density); garden.setSporophytes(settings.sporophytes);
    camera.position.copy(saved.position); controls.target.copy(saved.target); controls.update();
    app.focusPoint.copy(saved.focus); materials.time.value = saved.time;
    app.render(); app.manual = saved.manual;
  }
  if (error) throw error;
  check('No WebGPU validation errors', true);
  return report;
}
