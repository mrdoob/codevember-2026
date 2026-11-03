import * as THREE from 'three/webgpu';

export const LETTER_SEQUENCE = [...'CODEVEMBER'];
export const LETTER_SHARDS = 48;
export const letterSeed = letter => {
  const index = LETTER_SEQUENCE.indexOf(letter);
  return (index >= 0 ? index : letter.charCodeAt(0)) * 71 + 13;
};

// Extruded type outlines retain their counters (O, D, B, R) in both the
// visible mesh and the convex decomposition used for fracture and contact.
export function letterGeometry(letter, font) {
  const shapes = font.generateShapes(letter, 3);
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: 0.6, bevelEnabled: false, curveSegments: 6, steps: 1 });
  geometry.computeBoundingBox();
  const scale = 2.8 / geometry.boundingBox.getSize(new THREE.Vector3()).y;
  geometry.scale(scale, scale, 1);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  const volumes = [], triangles = [], counterCenters = [];
  shapes.forEach((shape, shapeIndex) => {
    const extracted = shape.extractPoints(6);
    const contour = extracted.shape, holes = extracted.holes;
    for (const hole of holes) {
      const center = hole.reduce((sum, p) => sum.add(p), new THREE.Vector2()).divideScalar(hole.length);
      counterCenters.push(center);
    }
    const indices = THREE.ShapeUtils.triangulateShape(contour, holes);
    const points = [...contour, ...holes.flat()].map(p => new THREE.Vector2(p.x * scale - center.x, p.y * scale - center.y));
    const polygons = indices.filter(tri => {
      const [a, b, c] = tri.map(i => points[i]);
      return Math.abs(b.clone().sub(a).cross(c.clone().sub(a))) > 1e-10;
    }).map(tri => {
      const [a, b, c] = tri.map(i => points[i]);
      return b.clone().sub(a).cross(c.clone().sub(a)) < 0 ? [tri[0], tri[2], tri[1]] : tri.slice();
    });
    // Merge neighboring triangles when their union stays convex. This keeps
    // the exact outline while reducing Box3D's compound contact workload.
    mergeConvexPolygons(polygons, points);
    const edgeKey = (a, b) => `${shapeIndex}:${Math.min(a, b)}:${Math.max(a, b)}`;
    const edgeCounts = new Map();
    for (const poly of polygons) for (let i = 0; i < poly.length; i++) {
      const key = edgeKey(poly[i], poly[(i + 1) % poly.length]);
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
    for (const tri of polygons) {
      const xy = tri.map(i => points[i]);
      for (let j = 1; j < xy.length - 1; j++) {
        const area = Math.abs(xy[j].clone().sub(xy[0]).cross(xy[j + 1].clone().sub(xy[0]))) / 2;
        if (area > 1e-10) triangles.push({ points: [xy[0], xy[j], xy[j + 1]], area });
      }
      const vertex = (i, z, n) => ({ p: new THREE.Vector3(xy[i].x, xy[i].y, z), n });
      const front = new THREE.Vector3(0, 0, 1), back = new THREE.Vector3(0, 0, -1);
      const faces = [xy.map((_, i) => vertex(i, 0.3, front)), xy.map((_, i) => vertex(i, -0.3, back)).reverse()];
      for (let i = 0; i < xy.length; i++) {
        const j = (i + 1) % xy.length;
        const normal = new THREE.Vector3(xy[j].y - xy[i].y, xy[i].x - xy[j].x, 0).normalize();
        const face = [vertex(i, -0.3, normal), vertex(j, -0.3, normal), vertex(j, 0.3, normal), vertex(i, 0.3, normal)];
        const key = edgeKey(tri[i], tri[j]);
        if (edgeCounts.get(key) === 2) face.interface = key;
        faces.push(face);
      }
      volumes.push(faces);
    }
  });
  geometry.userData.counterCenters = counterCenters.map(p => new THREE.Vector3(p.x * scale - center.x, p.y * scale - center.y, 0));
  geometry.userData.fractureVolumes = volumes;
  const totalArea = triangles.reduce((sum, t) => sum + t.area, 0);
  geometry.userData.sampleVolume = random => {
    let pick = random() * totalArea;
    const triangle = triangles.find(t => (pick -= t.area) <= 0) || triangles.at(-1);
    const [a, b, c] = triangle.points;
    const u = Math.sqrt(random()), v = random();
    return new THREE.Vector3(a.x * (1 - u) + b.x * u * (1 - v) + c.x * u * v,
      a.y * (1 - u) + b.y * u * (1 - v) + c.y * u * v, (random() - 0.5) * 0.6);
  };
  return geometry;
}


function mergeConvexPolygons(polygons, points) {
  let changed = true;
  while (changed) {
    changed = false;
    search: for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
      const a = polygons[i], b = polygons[j];
      for (let k = 0; k < a.length; k++) for (let l = 0; l < b.length; l++) {
        if (a[k] !== b[(l + 1) % b.length] || a[(k + 1) % a.length] !== b[l]) continue;
        const merged = Array.from({ length: a.length }, (_, n) => a[(k + 1 + n) % a.length])
          .concat(Array.from({ length: b.length - 2 }, (_, n) => b[(l + 2 + n) % b.length]));
        if (new Set(merged).size !== merged.length) continue;
        const convex = merged.every((id, n) => {
          const p = points[id], q = points[merged[(n + 1) % merged.length]], r = points[merged[(n + 2) % merged.length]];
          return q.clone().sub(p).cross(r.clone().sub(q)) >= -1e-10;
        });
        if (!convex) continue;
        polygons[i] = merged; polygons.splice(j, 1); changed = true;
        break search;
      }
    }
  }
}
