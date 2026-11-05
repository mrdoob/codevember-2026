import { MeshletDrawingPipeline } from 'three/addons/pipelines/MeshletDrawingPipeline.js';

// r187 calibrates draw-queue capacity from one view, then drops overflowing
// meshlets until its 30-frame readback catches up. Macro zooms can expose many
// more clusters immediately. Keep a complete queue for each botanical variant.
// These two hooks are intentionally pinned to r187; see scripts/meshlet-checks.js.
export class MossDrawingPipeline extends MeshletDrawingPipeline {
  createBatch(entry, capacity, view, culling) {
    const batch = super.createBatch(entry, capacity, view, culling);
    // The last three automatic LODs prune disconnected leaves and stems into
    // floating flecks. Keep the first three levels for botanical geometry;
    // the blurred woodland and shadow maps keep the full six-level chain.
    if (!culling.shadow && entry.clusters.hasAttribute('plant')) {
      batch.lodCount = 3;
      // r187 registers the batch inside its constructor, before this hook
      // returns. Update row 2.z of that table as well as the retained setting.
      if (batch.added) culling.tableArray[batch.index * 12 + 10] = batch.lodCount;
    }
    return batch;
  }

  _getBatchKey(clusters) {
    // Separate variants keep each full queue below r187's 2^20-item limit.
    return clusters.hasAttribute('plant') ? clusters : super._getBatchKey(clusters);
  }

  _getCullingCapacity(entries, capacities, occlusion, shadow, clusterBudget = 0) {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry.clusters.hasAttribute('plant')) continue;
      if (capacities[i] * entry.maxChunks > 2 ** 20) {
        throw new Error('A moss batch exceeds the safe meshlet queue size. Split its instances.');
      }
      entry.queueBudget = Infinity;
      entry.queueMeasured = true;
    }
    return super._getCullingCapacity(entries, capacities, occlusion, shadow, clusterBudget);
  }
}
