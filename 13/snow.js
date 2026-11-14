import { BundleGroup, Mesh, BufferGeometry, Float32BufferAttribute, CanvasTexture, LinearFilter, Vector3 } from 'three/webgpu';
import { texture, vec2, positionWorld, bumpMap, mix } from 'three/tsl';
import { SIZE_X, SIZE_Z } from './maze.js';
import { smoothstep, randomSeed } from './random.js';

export function createSnow(scene, maze, journey, materials) {
  const group = new BundleGroup(); group.name = 'Drifted snow and footprints';
  const footprints = [], buckets = new Map(), seen = new Set(), random = randomSeed(13013), p = new Vector3(), ahead = new Vector3();
  const bucketKey = (x, z) => `${Math.floor(x)},${Math.floor(z)}`;
  for (let d = 0, step = 0; d < journey.length; d += .61, step++) {
    journey.at(d + .38, p); journey.at(d + .5, ahead);
    const angle = Math.atan2(ahead.x - p.x, ahead.z - p.z), side = step % 2 ? 1 : -1;
    const x = p.x + Math.cos(angle) * .14 * side, z = p.z - Math.sin(angle) * .14 * side;
    const key = `${Math.round(x * 1.5)},${Math.round(z * 1.5)}`;
    if (seen.has(key) || maze.clearance(x, z) < .7 || (buckets.get(bucketKey(x, z)) || []).some(f => Math.hypot(f.x - x, f.z - z) < .43)) continue;
    seen.add(key);
    const foot = { x, z, angle: angle + side * .09, depth: .065 + random() * .025, side };
    footprints.push(foot);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const k = bucketKey(x + i, z + j); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(foot);
    }
  }
  function footprint(x, z) {
    let depression = 0, compressed = 1;
    for (const f of buckets.get(bucketKey(x, z)) || []) {
      const dx = x - f.x, dz = z - f.z;
      if (Math.abs(dx) > .3 || Math.abs(dz) > .3) continue;
      const u = (dx * Math.cos(f.angle) - dz * Math.sin(f.angle)) / .083;
      const v = (dx * Math.sin(f.angle) + dz * Math.cos(f.angle)) / .185;
      const r = Math.sqrt(u * u + v * v);
      const inside = 1 - smoothstep(.6, 1.12, r);
      depression = Math.min(depression, -inside * f.depth + Math.exp(-Math.pow((r - 1.3) * 5, 2)) * .015);
      compressed = Math.min(compressed, 1 - inside * .65);
    }
    return [depression, compressed];
  }
  // A fine height atlas preserves the boot's heel, toe, and powder lip between
  // terrain vertices. Geometry supplies the depression; this supplies its rim.
  const atlas = document.createElement('canvas'); atlas.width = 2048; atlas.height = Math.round(2048 * SIZE_Z / SIZE_X);
  const ctx = atlas.getContext('2d'), scale = atlas.width / SIZE_X;
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, atlas.width, atlas.height);
  for (const f of footprints) {
    ctx.save(); ctx.translate((f.x + SIZE_X / 2) * scale, (f.z + SIZE_Z / 2) * scale); ctx.rotate(-f.angle);
    ctx.scale(.105 * scale, .215 * scale);
    const gradient = ctx.createRadialGradient(0, 0, .05, 0, 0, 1.32);
    gradient.addColorStop(0, '#262626'); gradient.addColorStop(.55, '#303030'); gradient.addColorStop(.73, '#434343'); gradient.addColorStop(.84, '#9c9c9c'); gradient.addColorStop(1, '#808080');
    ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(0, 0, 1.32, 1.32, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  const detail = new CanvasTexture(atlas); detail.flipY = false; detail.minFilter = LinearFilter; detail.magFilter = LinearFilter;
  const stamp = texture(detail, positionWorld.xz.div(vec2(SIZE_X, SIZE_Z)).add(.5)).r;
  materials.ground.colorNode = materials.ground.colorNode.mul(stamp.smoothstep(.14, .49).mul(.25).add(.75));
  const originalNormal = materials.ground.normalNode;
  materials.ground.normalNode = mix(originalNormal, bumpMap(stamp, .1), stamp.sub(.5).abs().smoothstep(.005, .06)).normalize();
  const tile = 10.24, divisions = 64;
  const nx = Math.ceil(SIZE_X / tile), nz = Math.ceil(SIZE_Z / tile);
  let triangles = 0;
  for (let tz = 0; tz < nz; tz++) for (let tx = 0; tx < nx; tx++) {
    const positions = [], surface = [], indices = [];
    for (let j = 0; j <= divisions; j++) for (let i = 0; i <= divisions; i++) {
      const x = tx * tile + i * tile / divisions - SIZE_X / 2;
      const z = tz * tile + j * tile / divisions - SIZE_Z / 2;
      const [depth, compression] = footprint(x, z);
      positions.push(x, maze.height(x, z) + depth, z); surface.push(compression, 0);
    }
    for (let j = 0; j < divisions; j++) for (let i = 0; i < divisions; i++) {
      const a = j * (divisions + 1) + i, b = a + divisions + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('snowSurface', new Float32BufferAttribute(surface, 2));
    geometry.setIndex(indices); geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, materials.ground); mesh.name = `Snowdrift ${tx},${tz}`; group.add(mesh); triangles += indices.length / 3;
  }
  scene.add(group);
  return { group, footprints, footprint, triangles, detail,
    dispose() { scene.remove(group); detail.dispose(); for (const mesh of group.children) mesh.geometry.dispose(); } };
}
