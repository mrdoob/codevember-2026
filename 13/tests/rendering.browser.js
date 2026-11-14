// Run in the loaded experiment: await (await import('./tests/rendering.browser.js')).checkLabyrinth()
export async function checkLabyrinth(app = window.labyrinth) {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const { renderer, meshlets, journey, camera, maze, settings } = app;
  assert(renderer.backend.isWebGPUBackend, 'Native WebGPU is required');
  assert(renderer.drawingPipeline === meshlets && meshlets.isMeshletDrawingPipeline, 'Meshlet pipeline inactive');
  assert(renderer.lighting.constructor.name === 'ClusteredLighting', 'Clustered lighting inactive');
  assert(app.lighting.lamps.length < renderer.lighting.maxLights, 'Light capacity exceeded');
  const manual = app.manual, distance = journey.distance, original = { ...settings };
  const frame = async () => { await new Promise(requestAnimationFrame); app.render(); await renderer.backend.device.queue.onSubmittedWorkDone(); };
  const samples = []; let minimumClearance = Infinity, testedPositions = 0, maximumRequested = 0;
  app.manual = true;
  renderer.backend.device.pushErrorScope('validation');
  let failure;
  try {
    for (let d = 0; d < journey.length; d += .12) {
      const p = journey.at(d), clearance = maze.clearance(p.x, p.z);
      minimumClearance = Math.min(minimumClearance, clearance); testedPositions++;
      assert(clearance > .52, `The camera clips the hedge at ${d.toFixed(2)} m (${clearance})`);
    }
    assert(journey.at(0).distanceTo(journey.at(journey.length)) < 1e-6, 'The loop does not meet');
    const tangentA = journey.tangent(.001), tangentB = journey.tangent(journey.length - .001);
    assert(tangentA.dot(tangentB) > .99, 'Camera direction jumps at the loop seam');
    for (const d of [journey.opening, 30, 48, 90, 115, 180, 310, 530, 900, journey.length * .8, journey.length * .9, journey.length - 1]) {
      journey.seek(d);
      for (const yaw of [0, Math.PI / 2, Math.PI]) {
        journey.seek(d); camera.rotateY(yaw); camera.updateMatrixWorld(); await frame(); await frame();
        for (const reference of meshlets._records) {
          const record = reference.deref(); if (!record?.culling) continue;
          const entries = [...record.entries, ...[...record.staticGroups.values()].flatMap(group => group.entries)];
          const counts = new Uint32Array(await renderer.getArrayBufferAsync(record.culling.countersAttribute));
          assert(counts[0] <= record.culling.capacity.clusters, 'Global meshlet visibility overflow');
          let requested = 0, instances = 0;
          for (const entry of entries) {
            if (!entry.count) continue;
            assert(entry.batch?.added, 'A meshlet batch fell back or exceeded storage capacity');
            const n = counts[1 + entry.batch.index * 2]; requested += n;
            assert(n <= entry.batch.queueCapacity, `Meshlet queue overflow at ${d} m / ${yaw}`);
            if (entry.material === app.materials.snow || entry.material === app.materials.foliage) instances += entry.count;
          }
          assert(instances === app.hedges.patches * 2, 'Some hedge instances were omitted');
          maximumRequested = Math.max(maximumRequested, requested); samples.push({ distance: d, yaw, requested });
        }
      }
    }
    settings.paused = true; const before = journey.distance, time = app.time; app.advance(1);
    assert(journey.distance === before && app.time === time, 'Pause advances the scene');
    settings.paused = false; journey.seek(journey.length - .2); app.advance(1);
    assert(journey.distance >= 0 && journey.distance < settings.speed, 'The camera does not wrap around the loop');
  } catch (error) { failure = error; }
  finally {
    const validation = await renderer.backend.device.popErrorScope(); if (validation) failure ||= new Error(validation.message);
    Object.assign(settings, original); journey.seek(distance); await frame(); app.manual = manual;
  }
  if (failure) throw failure;
  return { passed: true, testedPositions, minimumClearance, views: samples.length, maximumRequestedMeshlets: maximumRequested, fullDetailTriangles: app.hedges.fullTriangles, lamps: app.lighting.lamps.length, samples };
}

export async function checkPerformance(app = window.labyrinth, frames = 45) {
  const manual = app.manual, distance = app.journey.distance; app.manual = true; const samples = [];
  try {
    for (let i = 0; i < frames + 5; i++) {
      await new Promise(requestAnimationFrame); const start = performance.now();
      app.advance(1 / 60); app.render(); await app.renderer.backend.device.queue.onSubmittedWorkDone();
      if (i >= 5) samples.push(performance.now() - start);
    }
  } finally { app.journey.seek(distance); app.manual = manual; }
  samples.sort((a, b) => a - b);
  return { frames, pixelRatio: app.renderer.getPixelRatio(), viewport: [innerWidth, innerHeight], medianGPUCompletionMs: samples[Math.floor(samples.length / 2)], p95GPUCompletionMs: samples[Math.floor(samples.length * .95)] };
}
