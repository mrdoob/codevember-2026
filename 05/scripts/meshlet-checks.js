import { setMacroView } from './views.js';
// Pinned-r187 diagnostic: inspect the GPU's requested counts, not the delayed
// public triangle statistic, which clamps counts to the queue's capacity.
export async function runMeshletChecks(app = window.moss) {
  const { settings, camera, controls, materials, renderer, meshlets, focusPoint } = app;
  const saved = { settings: { ...settings }, position: camera.position.clone(), target: controls.target.clone(),
    focus: focusPoint.clone(), time: materials.time.value, manual: app.manual };
  const samples = [];
  const frame = async () => {
    // FRAME nodes render once per animation frame. A tight loop can otherwise
    // measure cached post-processing results instead of drawing the scene.
    await new Promise(requestAnimationFrame);
    app.render(); await renderer.backend.device.queue.onSubmittedWorkDone();
  };
  const inspectQueues = async label => {
    for (const reference of meshlets._records) {
      const record = reference.deref(), culling = record?.culling;
      if (!culling) continue;
      const counts = new Uint32Array(await renderer.getArrayBufferAsync(culling.countersAttribute));
      const entries = [...record.entries, ...[...record.staticGroups.values()].flatMap(group => group.entries)];
      let requested = 0, capacity = 0, overflow = Math.max(0, counts[0] - culling.capacity.clusters);
      for (const entry of entries) {
        if (!entry.clusters.hasAttribute('plant') || !entry.batch) continue;
        const batch = entry.batch, count = counts[1 + batch.index * 2];
        requested += count; capacity += batch.queueCapacity;
        overflow += Math.max(0, count - batch.queueCapacity);
      }
      const sample = { label, shadow: culling.shadow, requested, capacity, overflow };
      samples.push(sample);
      if (overflow > 0) throw new Error(`Meshlet queue overflow: ${JSON.stringify(sample)}`);
    }
  };
  app.manual = true;
  Object.assign(settings, { pause: true, autoOrbit: false, breeze: 0 });
  renderer.backend.device.pushErrorScope('validation');
  let failure;
  try {
    app.resetView();
    // Let the original implementation calibrate/shrink its queues first.
    for (let i = 0; i < 65; i++) await frame();
    await inspectQueues('calibrated overview');
    const views = [[0, false], [1, true], [2, false], [3, true], [0, true]];
    for (let i = 0; i < views.length; i++) {
      settings.breeze = i % 2 ? 1.5 : 0;
      materials.time.value += 1.3;
      setMacroView(app, ...views[i]);
      await frame(); await inspectQueues(`zoom ${i + 1}, first frame`);
      await frame(); await inspectQueues(`zoom ${i + 1}, second frame`);
    }
  } catch (error) { failure = error; }
  finally {
    const validation = await renderer.backend.device.popErrorScope();
    if (validation) failure ||= new Error(validation.message);
    Object.assign(settings, saved.settings);
    camera.position.copy(saved.position); controls.target.copy(saved.target); controls.update();
    focusPoint.copy(saved.focus); materials.time.value = saved.time;
    await frame(); app.manual = saved.manual;
  }
  if (failure) throw failure;
  return { checks: samples.length, maximumOverflow: 0, samples };
}
