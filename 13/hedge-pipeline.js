import { MeshletDrawingPipeline } from 'three/addons/pipelines/MeshletDrawingPipeline.js';

export class HedgeDrawingPipeline extends MeshletDrawingPipeline {
  createBatch(entry, capacity, view, culling) {
    const batch = super.createBatch(entry, capacity, view, culling);
    if (entry.clusters.hasAttribute('snowSurface') && batch.added) {
      // Adjacent terrain tiles share exact boundary vertices. Independent
      // simplification opens cracks at those edges, so retain the ground mesh.
      batch.lodCount = 1; culling.tableArray[batch.index * 12 + 10] = 1;
    }
    return batch;
  }
  _getBatchKey(clusters) {
    // Keep variants in separate queues, comfortably below the 2^20 work limit.
    return clusters.hasAttribute('hedgeDetail') ? clusters : super._getBatchKey(clusters);
  }
  _getCullingCapacity(entries, ...options) {
    for (const entry of entries) if (entry.clusters.hasAttribute('hedgeDetail')) {
      // A complete maze has hundreds of millions of source triangles, but the
      // eye-level camera only exposes a small fraction. Reserve 262k meshlets
      // per variant; full queues for every hidden wall exceed WebGPU's 128 MB
      // storage binding limit. Browser checks audit the actual GPU requests.
      entry.queueBudget = 262144; entry.queueMeasured = true;
    }
    return super._getCullingCapacity(entries, ...options);
  }
}
