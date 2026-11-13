import { FrontSide } from 'three/webgpu';
import { CAMERA } from '../scene-constants.js';

// Pinned-revision diagnostic. Read actual GPU queue requests rather than the
// delayed public triangle counter, which clamps overflow to draw capacity.
export async function checkMeshlets(app = window.feather) {
  const { renderer, meshlets, camera, wheat } = app;
  const manual = app.manual, settings = { ...app.settings };
  const samples = [];
  const frame = async () => {
    await new Promise(requestAnimationFrame); app.render();
    await renderer.backend.device.queue.onSubmittedWorkDone();
  };
  if (!meshlets.isMeshletDrawingPipeline || renderer.drawingPipeline !== meshlets) throw new Error('Meshlet pipeline inactive');
  if (wheat.material.positionNode === null || wheat.material.side !== FrontSide) throw new Error('Wheat must use vertex wind and front-sided geometry');
  if (wheat.batches.some(mesh => mesh.children.length > 0)) throw new Error('Depth-layer copies remain');
  const expected = wheat.batches.reduce((sum, mesh) => sum + mesh.count, 0);
  const inspect = async label => {
    let fieldInstances = 0;
    for (const reference of meshlets._records) {
      const record = reference.deref(), culling = record?.culling;
      if (!culling) continue;
      const entries = [...record.entries, ...[...record.staticGroups.values()].flatMap(group => group.entries)]
        .filter(entry => entry.material === wheat.material && entry.count > 0);
      if (!entries.length) continue;
      const counts = new Uint32Array(await renderer.getArrayBufferAsync(culling.countersAttribute));
      let requested = 0, overflow = Math.max(0, counts[0] - culling.capacity.clusters);
      for (const entry of entries) {
        if (!entry.batch) throw new Error('Wheat fell back to ordinary instancing');
        if (entry.batch.unbounded?.value !== 0) throw new Error('Wheat wind disabled finite meshlet culling bounds');
        const count = counts[1 + entry.batch.index * 2];
        requested += count; overflow += Math.max(0, count - entry.batch.queueCapacity);
        fieldInstances += entry.count;
      }
      samples.push({ label, requested, overflow });
      if (overflow) throw new Error(`Meshlet queue overflow: ${JSON.stringify(samples.at(-1))}`);
    }
    if (fieldInstances !== expected) throw new Error(`Meshlet field coverage: ${fieldInstances}/${expected}`);
  };
  app.manual = true;
  renderer.backend.device.pushErrorScope('validation');
  let failure;
  try {
    app.reset();
    for (let i = 0; i < 65; i++) await frame();
    await inspect('calibrated opening');
    for (const distance of [CAMERA.minDistance, CAMERA.maxDistance]) {
      for (const height of [CAMERA.minHeight, CAMERA.maxHeight]) {
        for (const azimuth of [0, 90, 180, 270]) {
          camera.position.setFromSphericalCoords(distance, (90 - CAMERA.elevation) * Math.PI / 180, azimuth * Math.PI / 180);
          const targetY = height - camera.position.y;
          camera.position.y = height; camera.lookAt(0, targetY, 0); app.settings.focus = distance;
          await frame(); await inspect(`${distance}/${height}/${azimuth}, first frame`);
          await frame(); await inspect(`${distance}/${height}/${azimuth}, second frame`);
        }
      }
    }
  } catch (error) { failure = error; }
  finally {
    const validation = await renderer.backend.device.popErrorScope();
    if (validation) failure ||= new Error(validation.message);
    Object.assign(app.settings, settings); app.reset();
    await frame(); app.manual = manual;
  }
  if (failure) throw failure;
  return { passed: samples.length, fieldInstances: expected, maximumOverflow: 0, samples };
}
