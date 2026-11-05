import { setMacroView } from './views.js';

export async function benchmark(app = window.moss, sampleCount = 30) {
  const { settings, camera, controls, focusPoint, materials, renderer } = app;
  const saved = { settings: { ...settings }, position: camera.position.clone(), target: controls.target.clone(),
    focus: focusPoint.clone(), time: materials.time.value, manual: app.manual };
  app.manual = true;
  Object.assign(settings, { pause: true, autoOrbit: false, breeze: 0, depthOfField: true, lod: 2 });
  const measure = async () => {
    const times = [];
    for (let i = 0; i < sampleCount + 40; i++) {
      await new Promise(requestAnimationFrame);
      const start = performance.now();
      app.render(); await renderer.backend.device.queue.onSubmittedWorkDone();
      if (i >= 40) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    return { medianMs: times[Math.floor(times.length / 2)], p90Ms: times[Math.floor(times.length * .9)],
      meshletTriangles: app.meshlets.info.triangles };
  };
  try {
    app.resetView();
    const overview = await measure();
    setMacroView(app);
    const macro = await measure();
    return { viewport: [renderer.domElement.width, renderer.domElement.height], sampleCount,
      method: 'Median CPU submission plus GPU completion time; one render per animation frame, 40 warmup frames.', overview, macro };
  } finally {
    Object.assign(settings, saved.settings);
    camera.position.copy(saved.position); controls.target.copy(saved.target); controls.update();
    focusPoint.copy(saved.focus); materials.time.value = saved.time;
    await new Promise(requestAnimationFrame); app.render(); app.manual = saved.manual;
  }
}
