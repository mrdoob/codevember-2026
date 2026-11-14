import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaze, createItinerary } from '../maze.js';
import { createCameraRoute } from '../camera-route.js';
import { createFlightProfile } from '../flight.js';

const maze = createMaze(), route = createCameraRoute(createItinerary().points, maze.clearance);
const angle = (a, b) => Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z);

test('the full rounded route clears hedges and its tangent matches physical travel', () => {
  for (let d = 0; d < route.length; d += .05) {
    const p = route.at(d), a = route.at(d - .001), b = route.at(d + .001), tangent = route.tangent(d);
    assert.ok(maze.clearance(p.x, p.z) > .8, `Hedge clearance at ${d}`);
    const distance = Math.hypot(b.x - a.x, b.z - a.z), actual = { x: (b.x - a.x) / distance, z: (b.z - a.z) / distance };
    assert.ok(Math.abs(angle(actual, tangent)) < 1e-5, `Tangent differs from movement at ${d}`);
    assert.ok(Math.abs(distance / .002 - 1) < .002, `Uneven arc-length mapping at ${d}`);
  }
});

test('the opening uses broad bends into the clearing, with space for the camera', () => {
  const [, , entry, center] = route.segments.filter(segment => segment.control);
  assert.ok(entry.length > 7, 'The entry bend is still tight');
  assert.ok(center.length > 8, 'The bend inside the clearing is still tight');
  const p = route.at(center.start + center.length);
  assert.ok(Math.abs(p.x) < .001 && p.z > -12, 'The bend inside the clearing does not lead down its center');
});

test('straight passages stay straight and corners turn monotonically through 90 degrees', () => {
  for (const segment of route.segments) {
    const incoming = route.tangent(segment.start), outgoing = route.tangent(segment.start + segment.length);
    const total = angle(incoming, outgoing);
    if (!segment.control) {
      for (let j = 0; j <= 20; j++) assert.ok(Math.abs(angle(incoming, route.tangent(segment.start + segment.length * j / 20))) < 1e-8, 'Look-around in a straight passage');
    } else {
      assert.ok(Math.abs(Math.abs(total) - Math.PI / 2) < 1e-8, 'Corner does not correspond to a map bend');
      let previous = incoming;
      for (let j = 1; j <= 80; j++) {
        const next = route.tangent(segment.start + segment.length * j / 80);
        assert.ok(angle(previous, next) * Math.sign(total) >= -1e-10, 'Corner counter-steers');
        previous = next;
      }
    }
  }
});

test('position, tangent, and curvature are continuous at every segment join and the loop seam', () => {
  for (const segment of route.segments) {
    const d = segment.start, epsilon = .001;
    const a = route.at(d - epsilon), b = route.at(d + epsilon);
    assert.ok(Math.hypot(b.x - a.x, b.z - a.z) < epsilon * 2.001, 'Position discontinuity');
    assert.ok(Math.abs(angle(route.tangent(d - epsilon), route.tangent(d + epsilon))) / (epsilon * 2) < .003, 'Corner joins with nonzero curvature');
  }
  assert.deepEqual(route.at(0), route.at(route.length));
  assert.deepEqual(route.tangent(0), route.tangent(route.length));
});

test('the actual flight never pivots in place and brakes smoothly through every corner', () => {
  const flight = createFlightProfile(route.length, d => route.tangent(d)), dt = 1 / 30;
  let distance = 0, previousSpeed;
  for (let time = 0; time < flight.duration(2.4); time += dt) {
    const next = flight.advance(distance, dt, 2.4), speed = ((next - distance + route.length) % route.length) / dt;
    assert.ok(speed > .5, 'The camera nearly stops to pivot');
    assert.ok(Math.abs(angle(route.tangent(distance), route.tangent(next))) / dt < .63, 'Abrupt turn');
    if (previousSpeed !== undefined) assert.ok(Math.abs(speed - previousSpeed) / dt < .651, 'Abrupt acceleration');
    previousSpeed = speed; distance = next;
  }
});
