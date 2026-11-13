import { MeshletDrawingPipeline } from 'three/addons/pipelines/MeshletDrawingPipeline.js';

// Keep small bank patches and large field patches in separate queues. The
// pinned renderer otherwise sizes every bank slot for the largest field patch.
export class WheatDrawingPipeline extends MeshletDrawingPipeline {
  _getBatchKey(clusters) {
    return clusters.hasAttribute('wheatSurface')
      ? `${clusters.layoutKey}/${clusters.maxChunks > 32 ? 'field' : 'bank'}`
      : super._getBatchKey(clusters);
  }
  _getCullingCapacity(entries, ...options) {
    // Reserve complete queues so a fast orbit cannot outgrow the last view's
    // measured budget before the renderer's asynchronous readback catches up.
    for (const entry of entries) if (entry.clusters.hasAttribute('wheatSurface')) {
      entry.queueBudget = Infinity; entry.queueMeasured = true;
    }
    return super._getCullingCapacity(entries, ...options);
  }
}
