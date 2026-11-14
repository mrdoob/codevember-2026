import { PLAN } from './maze-plan.js';
import { noise } from './random.js';

// Each source-map cell is 2.56 m wide. Walls and ordinary passages are one
// cell wide; the supplied map also has a broad central clearing.
// Subdivide uniformly for terrain, foliage placement, and lighting;
// this increases sampling density without changing any wall or passage widths.
export const PLAN_SCALE = 4;
export const CELL = .64;
export const HEDGE_HEIGHT = 4.65;
const raster = PLAN.flatMap(row => Array(PLAN_SCALE).fill([...row].map(cell => cell.repeat(PLAN_SCALE)).join('')));
export const WIDTH = raster[0].length, DEPTH = raster.length;
export const SIZE_X = WIDTH * CELL, SIZE_Z = DEPTH * CELL;
export const world = (x, z) => [(x + .5) * CELL - SIZE_X / 2, (z + .5) * CELL - SIZE_Z / 2];
export const grid = (x, z) => [(x + SIZE_X / 2) / CELL - .5, (z + SIZE_Z / 2) / CELL - .5];
export const occupied = (x, z) => x >= 0 && z >= 0 && x < WIDTH && z < DEPTH && raster[z][x] === '#';

export function createMaze() {
  const distance = new Float32Array(WIDTH * DEPTH).fill(1000);
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) if (occupied(x, z)) distance[z * WIDTH + x] = 0;
  // Eight-neighbor distance transform, followed by bilinear world queries.
  for (let sweep = 0; sweep < 2; sweep++) {
    const s = sweep ? -1 : 1;
    for (let z = sweep ? DEPTH - 1 : 0; z >= 0 && z < DEPTH; z += s) for (let x = sweep ? WIDTH - 1 : 0; x >= 0 && x < WIDTH; x += s) {
      const i = z * WIDTH + x;
      for (const [dx, dz] of [[-s, 0], [0, -s], [-s, -s], [s, -s]]) {
        const a = x + dx, b = z + dz;
        if (a >= 0 && a < WIDTH && b >= 0 && b < DEPTH) distance[i] = Math.min(distance[i], distance[b * WIDTH + a] + Math.hypot(dx, dz) * CELL);
      }
    }
  }
  function clearance(x, z) {
    const [gx, gz] = grid(x, z), i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    if (i < 0 || j < 0 || i >= WIDTH - 1 || j >= DEPTH - 1) return 0;
    const a = j * WIDTH + i;
    return Math.max(0, (distance[a] * (1 - u) + distance[a + 1] * u) * (1 - v) + (distance[a + WIDTH] * (1 - u) + distance[a + WIDTH + 1] * u) * v - CELL * .5);
  }
  // Merge the subdivided grid into exact, uniformly wide hedge rectangles.
  const used = new Uint8Array(WIDTH * DEPTH), rectangles = [];
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) {
    if (!occupied(x, z) || used[z * WIDTH + x]) continue;
    let w = 1, d = 1;
    while (x + w < WIDTH && occupied(x + w, z) && !used[z * WIDTH + x + w]) w++;
    outer: while (z + d < DEPTH) {
      for (let k = 0; k < w; k++) if (!occupied(x + k, z + d) || used[(z + d) * WIDTH + x + k]) break outer;
      d++;
    }
    for (let j = 0; j < d; j++) used.fill(1, (z + j) * WIDTH + x, (z + j) * WIDTH + x + w);
    const [wx, wz] = world(x + (w - 1) / 2, z + (d - 1) / 2);
    rectangles.push({ x: wx, z: wz, w: w * CELL, d: d * CELL });
  }
  // Only exposed faces receive botanical patches; shared interior faces disappear.
  const faces = [];
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) {
    if (!occupied(x, z)) continue;
    const [wx, wz] = world(x, z);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!occupied(x + dx, z + dz)) faces.push({ x: wx + dx * CELL / 2, z: wz + dz * CELL / 2, nx: dx, nz: dz });
  }
  const drift = new Float32Array(distance.length), weights = [1, 4, 6, 4, 1];
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) {
    let total = 0;
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) total += distance[Math.max(0, Math.min(DEPTH - 1, z + j)) * WIDTH + Math.max(0, Math.min(WIDTH - 1, x + i))] * weights[i + 2] * weights[j + 2];
    drift[z * WIDTH + x] = total / 256;
  }
  function height(x, z) {
    const [gx, gz] = grid(x, z), ix = Math.max(0, Math.min(WIDTH - 2, Math.floor(gx))), iz = Math.max(0, Math.min(DEPTH - 2, Math.floor(gz)));
    const u = Math.max(0, Math.min(1, gx - ix)), v = Math.max(0, Math.min(1, gz - iz)), i = iz * WIDTH + ix;
    const smoothed = Math.max(0, (drift[i] * (1 - u) + drift[i + 1] * u) * (1 - v) + (drift[i + WIDTH] * (1 - u) + drift[i + WIDTH + 1] * u) * v - CELL * .55);
    const d = smoothed * .3 + clearance(x, z) * .7;
    const bank = Math.exp(-d * d / (.32 + noise(x * .4, z * .4) * .25));
    return .06 + noise(x * .17, z * .17) * .14 + noise(x * 1.6, z * 1.6) * .025 + bank * (.58 + .4 * noise(x * .42, z * .42));
  }
  return { distance, clearance, rectangles, faces, height };
}

export function createItinerary() {
  // Trace a continuous passage circuit with the hedge on the right. Planning
  // on the authored grid keeps the route centered and removes sub-cell zigzags.
  // Remove dead-end excursions afterward to leave a forward-only flight loop.
  const width = PLAN[0].length, depth = PLAN.length;
  const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const walkable = (x, z) => x >= 0 && z >= 0 && x < width && z < depth && PLAN[z][x] === '.';
  const center = (x, z) => world(x * PLAN_SCALE + (PLAN_SCALE - 1) / 2, z * PLAN_SCALE + (PLAN_SCALE - 1) / 2);
  const start = 9 * width + 17;
  if (!walkable(17, 9)) throw new Error('The opening must be inside a passage.');
  // Start facing south in the lit approach corridor.
  const initial = start * 4 + 2, seen = new Set(), route = [];
  let state = initial;
  do {
    if (seen.has(state)) throw new Error('The passage circuit does not close at its start.');
    seen.add(state);
    const cell = Math.floor(state / 4), direction = state % 4;
    const x = cell % width, z = Math.floor(cell / width);
    route.push(cell);
    const exits = directions.map(([dx, dz], d) => walkable(x + dx, z + dz) ? d : -1).filter(d => d >= 0);
    const next = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4].find(d => exits.includes(d));
    if (next === undefined) throw new Error('Isolated passage cell.');
    const [dx, dz] = directions[next]; state = ((z + dz) * width + x + dx) * 4 + next;
  } while (state !== initial);
  // Collapse A -> B -> A spurs repeatedly, including across the closing seam.
  // This removes the whole trip into a dead end, not just its final reversal.
  while (route.length > 2) {
    const i = route.findIndex((cell, i) => route[(i + route.length - 1) % route.length] === route[(i + 1) % route.length]);
    if (i < 0) break;
    route.splice(i, 1); route.splice(i % route.length, 1);
  }
  if (route.length < 4 || route[0] !== start) throw new Error('The opening passage must belong to a continuous flight circuit.');
  // Start in the northern approach: west, south, then east through the
  // clearing entrance. Once inside, glide south down its central axis.
  const throughClearing = [[15, 17], [15, 21], [19, 21], [19, 39], [25, 39]], detour = [];
  for (let i = 1; i < throughClearing.length; i++) {
    let [x, z] = throughClearing[i - 1];
    const [endX, endZ] = throughClearing[i], dx = Math.sign(endX - x), dz = Math.sign(endZ - z);
    if (dx && dz) throw new Error('The clearing route must follow cardinal passages.');
    while (x !== endX || z !== endZ) {
      if (!walkable(x, z)) throw new Error('The clearing route crosses a hedge.');
      detour.push(z * width + x); x += dx; z += dz;
    }
  }
  const entry = route.indexOf(17 * width + 15), exit = route.indexOf(39 * width + 25);
  if (entry < 0 || exit <= entry) throw new Error('The clearing route must rejoin the outer circuit in order.');
  route.splice(entry, exit - entry, ...detour);
  const points = route.map(cell => center(cell % width, Math.floor(cell / width)));
  return { points, start, route };
}
