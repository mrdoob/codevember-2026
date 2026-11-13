import { Vector2 } from 'three/webgpu';
import { CAMERA } from '../scene-constants.js';

// Sample actual animation-frame cadence at native resolution. This is a
// diagnostic, not a hardware-dependent pass/fail FPS threshold.
export async function checkPerformance(app = window.feather) {
  const manual = app.manual, settings = { ...app.settings };
  const size = app.renderer.getSize(new Vector2()), results = [];
  try {
    app.manual = true; app.reset();
    for (const distance of [CAMERA.minDistance, CAMERA.maxDistance]) {
      for (const height of [CAMERA.minHeight, CAMERA.maxHeight]) {
        for (const azimuth of [0, 90, 180, 270]) {
          app.camera.position.setFromSphericalCoords(distance, (90 - CAMERA.elevation) * Math.PI / 180, azimuth * Math.PI / 180);
          const targetY = height - app.camera.position.y;
          app.camera.position.y = height; app.camera.lookAt(0, targetY, 0);
          app.settings.focus = distance;
          const samples = []; let previous = 0, triangles = 0;
          for (let i = 0; i < 42; i++) {
            const timestamp = await new Promise(requestAnimationFrame);
            app.advance(1 / 60); app.render();
            triangles = app.renderer.info.render.triangles;
            if (i > 17) samples.push(timestamp - previous);
            previous = timestamp;
          }
          samples.sort((a, b) => a - b);
          const average = samples.reduce((sum, x) => sum + x) / samples.length;
          results.push({ distance, height, azimuth, fps: 1000 / average, medianMs: samples[12], p90Ms: samples[21], triangles, meshletTriangles: app.meshlets.info.triangles, meshletClusters: app.meshlets.info.clusters });
        }
      }
    }
    return { size: size.toArray(), dpr: app.renderer.getPixelRatio(), results };
  } finally {
    Object.assign(app.settings, settings); app.reset();
    await new Promise(requestAnimationFrame); app.render(); app.manual = manual;
  }
}
