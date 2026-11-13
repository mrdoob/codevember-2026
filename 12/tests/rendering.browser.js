import { DataUtils, Matrix4, Quaternion, Vector2, Vector3 } from 'three/webgpu';
import { CAMERA, GROUND_Y } from '../scene-constants.js';

// Run from a live page: await (await import('./tests/rendering.browser.js')).checkFeather()
export async function checkFeather(app = window.feather) {
  const results = [];
  const check = (condition, label, detail) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
    results.push({ check: label, ...(detail === undefined ? {} : { detail }) });
  };
  const settings = { ...app.settings }, manual = app.manual;
  const size = app.renderer.getSize(new Vector2()), ratio = app.renderer.getPixelRatio();
  const allBatches = [...app.field.batches, ...app.wheat.batches];
  const visibility = allBatches.map(mesh => mesh.visible), farmVisible = app.farm.root.visible;
  const frame = () => new Promise(requestAnimationFrame);
  const read = async (refreshField = true, target = app.post.scenePass.renderTarget) => {
    if (refreshField) app.wheat.group.needsUpdate = true;
    await frame(); app.render();
    const data = await app.renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    return Float32Array.from(data, DataUtils.fromHalfFloat);
  };
  const difference = (a, b) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
    return sum / (a.length * .75);
  };
  try {
    app.manual = true;
    check(app.renderer.backend.isWebGPUBackend, 'Native WebGPU backend');
    check(settings.resolution !== 0 || ratio === devicePixelRatio, 'Default resolution uses the full device DPR', ratio);
    check(app.field.feathers.length === 256, '256 individual feathers');
    const crops = app.wheat.batches.filter(mesh => mesh.userData.isWheat);
    check(crops.reduce((sum, mesh) => sum + mesh.count * mesh.userData.stalksPerInstance, 0) > 250000, 'Dense field contains over 250,000 ears');
    check(crops.every(mesh => mesh.geometry.index.count / (3 * mesh.userData.stalksPerInstance) <= 100), 'Each simplified wheat stalk stays below 100 triangles');
    for (const mesh of allBatches) {
      for (const data of Object.values(mesh.geometry.attributes)) {
        check(data.array.every(Number.isFinite), `Finite ${mesh.geometry.id} / ${data.name || data.itemSize + '-component attribute'}`);
      }
      check(mesh.instanceMatrix.array.every(Number.isFinite), `Finite instance matrices ${mesh.id}`);
    }
    app.reset();
    const initial = app.field.batches.map(mesh => Array.from(mesh.instanceMatrix.array));
    const centers = new Set(app.field.feathers.map(f => f.position.toArray().map(x => x.toFixed(3)).join(',')));
    check(centers.size === 256, 'Instance transforms keep all feathers distinct');
    app.field.stir(new Vector3(.7, 0, 0), new Vector3(1, .5, 0), 2);
    app.advance(.5);
    check(app.field.feathers[0].offset.length() > .1, 'A local gust displaces the foreground feather');
    app.reset();
    check(app.field.batches.every((mesh, i) => mesh.instanceMatrix.array.every((value, j) => value === initial[i][j])), 'Reset restores the seeded arrangement exactly');
    const initialCamera = app.camera.position.clone();
    check(Math.abs(app.camera.position.y - CAMERA.height) < 1e-8, 'Opening view preserves the default camera altitude');
    app.advance(1);
    check(app.camera.position.distanceTo(initialCamera) < 1e-8, 'Manual simulation stepping keeps camera capture independent');
    app.settings.autoOrbit = true; app.settings.paused = false;
    for (let i = 0; i < 60; i++) app.orbit.update(1 / 60);
    check(app.camera.position.distanceTo(initialCamera) > .1, 'Auto orbit moves the camera');
    const heldCamera = app.camera.position.clone();
    app.settings.autoOrbit = false;
    for (let i = 0; i < 5; i++) app.orbit.update(1 / 60);
    check(app.camera.position.distanceTo(heldCamera) < 1e-8, 'Turning auto orbit off holds the current viewpoint');
    app.settings.autoOrbit = true;
    app.reset();
    const side = initialCamera.clone().set(initialCamera.z, initialCamera.y, 0);
    app.camera.position.copy(side); app.orbit.update();
    check(app.camera.position.distanceTo(side) < 1e-8, 'Orbit supports side views');
    const back = initialCamera.clone(); back.z *= -1;
    app.camera.position.copy(back); app.orbit.update();
    check(app.camera.position.distanceTo(back) < 1e-8, 'Orbit supports the back of the scene');
    app.reset();
    check(app.camera.position.distanceTo(initialCamera) < 1e-8, 'Reset restores the camera');
    app.settings.breeze = 0; app.settings.fallSpeed = 1;
    app.reset();
    const heights = app.field.feathers.map(f => f.position.y);
    app.advance(1);
    check(app.field.feathers.every((f, i) => f.position.y < heights[i] - .2), 'Every feather falls in still air, including all foreground feathers');
    const descent = heights[0] - app.field.feathers[0].position.y;
    const height = app.field.feathers[0].position.y;
    app.settings.fallSpeed = 2; app.field.update(0, app.settings);
    check(app.field.feathers[0].position.y === height, 'Changing fall speed does not teleport feathers');
    app.advance(1);
    check(Math.abs(height - app.field.feathers[0].position.y - descent * 2) < 1e-6, 'Doubling fall speed doubles the actual descent');
    let bounded = true;
    for (let i = 0; i < 180; i++) {
      app.field.update(1, app.settings);
      bounded &&= app.field.feathers.every(f => f.position.y + f.boundsRadius >= GROUND_Y && f.position.y <= f.top);
    }
    check(bounded && app.field.feathers.every(f => f.cycles >= 2), 'All feathers recycle repeatedly within the falling volume');
    // In wind, descent stays continuous while banks and side slips reverse.
    app.settings.breeze = 1; app.settings.fallSpeed = 1; app.reset();
    const hero = app.field.feathers[0], startY = hero.position.y;
    const heading = hero.phase * 2.4 + Math.sin(hero.phase) * .35;
    const previous = hero.position.clone(), matrix = new Matrix4();
    const rotation = new Quaternion(), lastRotation = new Quaternion(), scale = new Vector3(), position = new Vector3();
    hero.mesh.getMatrixAt(hero.slot, matrix); matrix.decompose(position, lastRotation, scale);
    let turns = 0, lastDirection = 0, maxTurn = 0, slowest = Infinity, fastest = 0;
    for (let i = 0; i < 360; i++) {
      app.advance(1 / 60);
      const direction = Math.sign((hero.position.x - previous.x) * Math.cos(heading)
        + (hero.position.z - previous.z) * Math.sin(heading));
      if (lastDirection && direction !== lastDirection) turns++;
      lastDirection = direction; previous.copy(hero.position);
      hero.mesh.getMatrixAt(hero.slot, matrix); matrix.decompose(position, rotation, scale);
      maxTurn = Math.max(maxTurn, lastRotation.angleTo(rotation)); lastRotation.copy(rotation);
      slowest = Math.min(slowest, hero.lastFallStep * 60); fastest = Math.max(fastest, hero.lastFallStep * 60);
    }
    const meanDescent = (startY - hero.position.y) / 6;
    check(turns >= 2 && maxTurn < .06, 'Flutter reverses smoothly without orientation snaps', { turns, maxTurn });
    check(meanDescent > .36 && slowest > .25 && fastest > slowest * 1.4,
      'Faster fall catches air at each flutter while continuing downward', { meanDescent, slowest, fastest });
    app.settings.breeze = settings.breeze; app.settings.fallSpeed = settings.fallSpeed;
    app.reset();
    app.renderer.setPixelRatio(1); app.renderer.setSize(360, 260, false);
    for (const mesh of app.field.batches) mesh.visible = false;
    app.farm.root.visible = false;
    app.settings.breeze = 1;
    await read(); // settle meshlet/occlusion history at the diagnostic viewport
    const wheatStill = await read(false, app.post.lens.renderTarget);
    for (let i = 0; i < 3; i++) app.advance(1);
    const wheatMoving = await read(false, app.post.lens.renderTarget);
    const wheatDifference = difference(wheatStill, wheatMoving);
    check(wheatDifference > .001 && app.wheat.material.positionNode !== null, 'Wind moves the blurred wheat canopy without refreshing static bundles', wheatDifference);
    app.settings.breeze = 0;
    const calm = await read(false, app.post.lens.renderTarget);
    for (let i = 0; i < 3; i++) app.advance(1);
    const calmDifference = difference(calm, await read(false, app.post.lens.renderTarget));
    check(calmDifference < .0005, 'Zero breeze holds the wheat still', calmDifference);
    app.settings.breeze = settings.breeze;
    app.farm.root.visible = farmVisible;
    for (const mesh of app.field.batches) mesh.visible = true;
    for (const mesh of app.wheat.batches) mesh.visible = false;
    app.reset();
    const feathersStill = await read();
    for (let i = 0; i < 3; i++) app.advance(1);
    const feathersMoving = await read();
    const featherDifference = difference(feathersStill, feathersMoving);
    check(featherDifference > .001, 'Feathers drift and flutter independently', featherDifference);
    app.reset(); app.settings.scattering = 0;
    const opaque = await read();
    app.settings.scattering = 1;
    const backlit = await read();
    const backScattering = difference(opaque, backlit);
    check(app.fibers.material.useSSS && backScattering > .001, 'Subsurface scattering changes the rendered feathers', backScattering);
    app.camera.position.copy(back); app.orbit.update();
    app.settings.scattering = 0; const frontOpaque = await read();
    app.settings.scattering = 1; const frontScattered = await read();
    const frontScattering = difference(frontOpaque, frontScattered);
    check(frontScattering < backScattering * .35, 'Scattering responds to camera/light angle', { backScattering, frontScattering });
    app.settings.scattering = 0; app.settings.sunlight = 0;
    const frontUnlit = await read();
    const frontSurfaceLight = difference(frontOpaque, frontUnlit);
    check(frontSurfaceLight > .001, 'The sun-facing side retains physical surface lighting', frontSurfaceLight);
    app.reset(); app.settings.sunlight = 0;
    app.settings.scattering = 0; const unlitOpaque = await read();
    app.settings.scattering = 1; const unlitScattered = await read();
    check(difference(unlitOpaque, unlitScattered) < .0001, 'Scattering vanishes when the direct light is off');
    app.settings.sunlight = settings.sunlight; app.settings.scattering = settings.scattering;
    for (const mesh of app.wheat.batches) mesh.visible = true;
    const pixels = await read();
    let min = Infinity, max = -Infinity, valid = true;
    for (const value of pixels) { valid &&= Number.isFinite(value); min = Math.min(min, value); max = Math.max(max, value); }
    check(valid && min >= 0 && max < 16, 'Finite, bounded HDR output without fiber fireflies', { min, max });
    app.manual = false; app.settings.paused = true;
    const pausedAt = app.time;
    const pausedCamera = app.camera.position.clone();
    await frame(); await frame(); await frame();
    check(app.time === pausedAt, 'Pause freezes the feather clock');
    check(app.camera.position.distanceTo(pausedCamera) < 1e-8, 'Camera stays still without input');
    app.settings.paused = false;
    await frame(); await frame(); await frame();
    check(app.time > pausedAt, 'Resume advances the shared clock');
    check(app.camera.position.distanceTo(pausedCamera) > 0, 'Resume restarts the automatic camera');
    const resumedCamera = app.camera.position.clone();
    app.settings.paused = true;
    await frame(); await frame(); await frame();
    check(app.camera.position.distanceTo(resumedCamera) < 1e-8, 'Pause stops automatic camera momentum');
    app.manual = true;
    return { passed: results.length, results };
  } finally {
    app.manual = true;
    Object.assign(app.settings, settings);
    allBatches.forEach((mesh, i) => mesh.visible = visibility[i]);
    app.farm.root.visible = farmVisible; app.wheat.group.needsUpdate = true;
    app.renderer.setPixelRatio(ratio); app.renderer.setSize(size.x, size.y);
    app.reset(); await frame(); app.render();
    app.manual = manual;
  }
}
