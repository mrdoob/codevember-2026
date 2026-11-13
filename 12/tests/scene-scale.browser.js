import { Scene, Frustum, Matrix4, Sphere, Vector3, RenderTarget, HalfFloatType, NoToneMapping, DataUtils } from 'three/webgpu';
import { createFeatherField } from '../feather-field.js';
import { CAMERA, GROUND_Y } from '../scene-constants.js';

// Exercise the actual camera limits, full wind, and repeated falling cycles.
// Use an isolated field so this check preserves the live scene's arrangement.
export async function checkSceneScale(app = window.feather) {
  const results = [];
  const check = (condition, label, detail) => {
    if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
    results.push({ check: label, detail });
  };
  const camera = app.camera.clone();
  const field = createFeatherField(new Scene(), app.fibers.material, camera);
  const settings = { breeze: 2, fallSpeed: 2 };
  const frustum = new Frustum(), matrix = new Matrix4(), sphere = new Sphere();
  const before = field.feathers.map(() => ({ fall: 0, cycles: 0 }));
  const lengths = field.feathers.map(f => {
    f.mesh.geometry.computeBoundingBox();
    const box = f.mesh.geometry.boundingBox;
    return (box.max.y - box.min.y) * f.scale;
  });
  let recycled = 0, viewpoints = 0;
  try {
    for (const aspect of [390 / 844, 1.5, 3.2]) {
      camera.aspect = aspect;
      camera.fov = aspect < CAMERA.portraitAspect ? CAMERA.portraitFov : CAMERA.fov;
      camera.updateProjectionMatrix();
      field.setAspect(aspect);
      for (const radius of [CAMERA.minDistance, CAMERA.maxDistance]) for (const height of [CAMERA.minHeight, 0, CAMERA.maxHeight]) {
        for (let azimuth = 0; azimuth < 360; azimuth += 45) {
          camera.position.setFromSphericalCoords(radius, (90 - CAMERA.elevation) * Math.PI / 180, azimuth * Math.PI / 180);
          const targetY = height - camera.position.y;
          camera.position.y = height;
          camera.lookAt(0, targetY, 0); camera.updateMatrixWorld();
          frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), camera.coordinateSystem);
          field.reset(); field.update(0, settings);
          let visibleExits = 0, visibleEntries = 0, clippedByFarPlane = 0;
          for (let step = 0; step < 1200; step++) {
            field.feathers.forEach((f, i) => { before[i].fall = f.fall; before[i].cycles = f.cycles; });
            field.update(.25, settings);
            for (let i = 0; i < field.feathers.length; i++) {
              const f = field.feathers[i];
              sphere.center.copy(f.position); sphere.radius = f.boundsRadius;
              if (sphere.center.distanceTo(camera.position) + sphere.radius >= camera.far) clippedByFarPlane++;
              if (f.cycles === before[i].cycles) continue;
              recycled++;
              if (frustum.intersectsSphere(sphere)) visibleEntries++;
              // Recover the old, wind-displaced position at this same instant,
              // before the recycling jump. No gust offsets are used in this test.
              sphere.center.y += f.base.y - (before[i].fall + f.lastFallStep) - f.top;
              if (sphere.center.y + sphere.radius > GROUND_Y && frustum.intersectsSphere(sphere)) visibleExits++;
            }
          }
          check(visibleExits === 0 && visibleEntries === 0 && clippedByFarPlane === 0,
            'Falling volume stays inside the far plane and recycles out of view',
            { aspect, radius, height, azimuth, visibleExits, visibleEntries, clippedByFarPlane });
          viewpoints++;
          // Yield between views so the full sweep keeps the browser responsive.
          await new Promise(requestAnimationFrame);
        }
      }
    }
    check(recycled > 10000, 'Orbit sweep exercises repeated recycling', { recycled, viewpoints });
  } finally { field.dispose(); }

  // The far floor must already match the sky before clipping or a mesh edge
  // exposes the sky. Compare pixels with and without the floor at high views.
  const renderer = app.renderer, manual = app.manual;
  const previousTarget = renderer.getRenderTarget(), toneMapping = renderer.toneMapping;
  const target = new RenderTarget(128, 96, { type: HalfFloatType });
  const scene = new Scene(), ground = app.wheat.ground.clone();
  scene.backgroundNode = app.landscape.background; scene.add(ground);
  camera.aspect = 128 / 96; camera.fov = CAMERA.fov; camera.updateProjectionMatrix();
  const sample = async visible => {
    ground.visible = visible;
    await new Promise(requestAnimationFrame);
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    return renderer.readRenderTargetPixelsAsync(target, 0, 0, 128, 96);
  };
  try {
    app.manual = true; renderer.toneMapping = NoToneMapping;
    for (const azimuth of [0, 45, 90, 180, 270]) {
      // An oblique diagnostic view exposes more of the floor than normal use.
      camera.position.setFromSphericalCoords(CAMERA.radius, Math.PI / 3, azimuth * Math.PI / 180);
      camera.lookAt(0, 0, 0);
      const floor = await sample(true), sky = await sample(false);
      let horizonError = 0, nearDifference = 0, horizonPixels = 0, nearPixels = 0;
      const ray = new Vector3();
      for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
        // Moving the camera closer changes which rows hit the faded floor.
        // Select samples by actual ray distance, not a fixed screen band.
        ray.set((x + .5) / 64 - 1, 1 - (y + .5) / 48, .5).unproject(camera).sub(camera.position).normalize();
        const distance = ray.y < 0 ? (GROUND_Y - camera.position.y) / ray.y : Infinity;
        const far = distance > CAMERA.far * .85 + 1, near = distance < CAMERA.far * .6 - 1;
        if (far) horizonPixels++;
        if (near) nearPixels++;
        for (let channel = 0; channel < 3; channel++) {
          const i = (y * 128 + x) * 4 + channel;
          const error = Math.abs(DataUtils.fromHalfFloat(floor[i]) - DataUtils.fromHalfFloat(sky[i]));
          if (far) horizonError = Math.max(horizonError, error);
          if (near) nearDifference = Math.max(nearDifference, error);
        }
      }
      check(horizonPixels > 100 && nearPixels > 100 && horizonError < .002 && nearDifference > .01,
        'Far ground blends into the landscape while nearby soil remains visible', { azimuth, horizonError, nearDifference, horizonPixels, nearPixels });
    }
  } finally {
    renderer.setRenderTarget(previousTarget); renderer.toneMapping = toneMapping;
    target.dispose();
    await new Promise(requestAnimationFrame); app.render(); app.manual = manual;
  }
  return { passed: results.length, featherLengths: [Math.min(...lengths), Math.max(...lengths)], results };
}
