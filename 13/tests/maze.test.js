import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN } from '../maze-plan.js';
import { CELL, PLAN_SCALE, WIDTH, DEPTH, createMaze, createItinerary, occupied, grid, world } from '../maze.js';

const maze = createMaze();
const itinerary = createItinerary();

test('walls stay one cell wide, preserving the reference map’s open areas', () => {
  assert.equal(PLAN.length, 55);
  assert.equal(PLAN[0].length, 39);
  assert.ok(PLAN.every(row => row.length === PLAN[0].length && /^[.#]+$/.test(row)));
  for (let z = 17; z <= 37; z++) assert.equal(PLAN[z].slice(17, 22), '.....', `Central clearing obstructed at row ${z}`);
  for (let z = 0; z < PLAN.length - 1; z++) for (let x = 0; x < PLAN[0].length - 1; x++) {
    const square = PLAN[z].slice(x, x + 2) + PLAN[z + 1].slice(x, x + 2);
    assert.notEqual(square, '####', `Double-width hedge at ${x}, ${z}`);
    if (square === '....') {
      const centralClearing = x >= 17 && x <= 20 && z >= 17 && z <= 36;
      const entranceVestibule = x >= 17 && x <= 18 && z >= 51 && z <= 52;
      assert.ok(centralClearing || entranceVestibule, `Unexpected wide passage at ${x}, ${z}`);
    }
  }
});

test('every passage connects to the southern entrance without enclosed walk cells', () => {
  const depth = PLAN.length, start = PLAN[depth - 1].indexOf('.');
  assert.equal(start, 18, 'The reference entrance is one cell left of center');
  assert.equal(PLAN[depth - 1].replaceAll('#', ''), '.');
  const queue = [[start, depth - 1]], seen = new Set([`${start},${depth - 1}`]);
  for (const [x, z] of queue) for (const [a, b] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
    const key = `${a},${b}`;
    if (PLAN[b]?.[a] === '.' && !seen.has(key)) { seen.add(key); queue.push([a, b]); }
  }
  assert.equal(seen.size, PLAN.join('').split('.').length - 1);
});

test('the hedge rectangles cover the uniformly subdivided plan exactly once', () => {
  assert.equal(PLAN.length * PLAN_SCALE, DEPTH);
  assert.equal(PLAN[0].length * PLAN_SCALE, WIDTH);
  const coverage = new Uint8Array(WIDTH * DEPTH);
  for (const r of maze.rectangles) {
    const [cx, cz] = grid(r.x, r.z), w = Math.round(r.w / CELL), d = Math.round(r.d / CELL);
    const x = Math.round(cx - (w - 1) / 2), z = Math.round(cz - (d - 1) / 2);
    for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) coverage[(z + j) * WIDTH + x + i]++;
  }
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) {
    const hedge = PLAN[Math.floor(z / PLAN_SCALE)][Math.floor(x / PLAN_SCALE)] === '#';
    assert.equal(occupied(x, z), hedge);
    assert.equal(coverage[z * WIDTH + x], hedge ? 1 : 0);
  }
});

test('the itinerary is a continuous closed walk through connected passages', () => {
  assert.ok(itinerary.points.length > 500);
  for (let i = 0; i < itinerary.points.length; i++) {
    const p = itinerary.points[i], next = itinerary.points[(i + 1) % itinerary.points.length];
    assert.ok(Math.abs(Math.hypot(next[0] - p[0], next[1] - p[1]) - CELL * PLAN_SCALE) < 1e-7, `Disconnected step ${i}`);
    assert.ok(maze.clearance(...p) > .63, `Insufficient passage clearance at step ${i}`);
    assert.ok(Number.isFinite(maze.height(...p)));
  }
});

test('the journey visits the middle of the central clearing and the outer maze', () => {
  assert.ok(itinerary.points.some(([x, z]) => Math.abs(x) < 1 && Math.abs(z) < 1));
  assert.ok(itinerary.points.some(([x]) => x < -30));
  assert.ok(itinerary.points.some(([x]) => x > 30));
  assert.ok(itinerary.points.some(([, z]) => z < -45));
  assert.ok(itinerary.points.some(([, z]) => z > 45));
});

test('three opening turns lead into the clearing before crossing its center to the southern gate', () => {
  const entry = itinerary.route.findIndex(cell => cell % PLAN[0].length >= 17 && cell % PLAN[0].length <= 21 && Math.floor(cell / PLAN[0].length) >= 17 && Math.floor(cell / PLAN[0].length) <= 37);
  assert.ok(entry > 0 && entry < 25, 'The clearing is not near the opening');
  let turns = 0;
  for (let i = 1; i < entry; i++) {
    if (itinerary.route[i] - itinerary.route[i - 1] !== itinerary.route[i + 1] - itinerary.route[i]) turns++;
  }
  assert.equal(turns, 3);
  const center = itinerary.route.indexOf(22 * PLAN[0].length + 19);
  for (let i = 0; i <= 17; i++) assert.equal(itinerary.route[center + i], (22 + i) * PLAN[0].length + 19, 'The camera veers off the central axis');
});

test('the flight route stays on map-cell centers and never doubles back', () => {
  for (let i = 0; i < itinerary.route.length; i++) {
    const cell = itinerary.route[i], x = cell % PLAN[0].length, z = Math.floor(cell / PLAN[0].length);
    assert.equal(PLAN[z][x], '.');
    assert.deepEqual(itinerary.points[i], world(x * PLAN_SCALE + (PLAN_SCALE - 1) / 2, z * PLAN_SCALE + (PLAN_SCALE - 1) / 2));
    assert.notEqual(itinerary.route[(i + itinerary.route.length - 1) % itinerary.route.length], itinerary.route[(i + 1) % itinerary.route.length], `U-turn at ${x}, ${z}`);
  }
});

test('placement and paths are deterministic', () => {
  const again = createItinerary();
  assert.deepEqual(again.points, itinerary.points);
  assert.deepEqual(again.route, itinerary.route);
});

test('snow remains finite across the whole plan and builds up at hedge bases', () => {
  let max = 0, min = Infinity;
  for (let z = 0; z < DEPTH; z += 2) for (let x = 0; x < WIDTH; x += 2) {
    const h = maze.height(...world(x, z)); assert.ok(Number.isFinite(h)); min = Math.min(min, h); max = Math.max(max, h);
  }
  assert.ok(min >= 0 && max < 1.3);
  assert.ok(max - min > .5);
});
