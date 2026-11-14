import test from 'node:test';
import assert from 'node:assert/strict';
import { createFlightProfile } from '../flight.js';

const length = 80;
// A smooth closed route with both long straights and a concentrated hairpin.
const tangent = distance => {
  const t = distance / length * Math.PI * 2;
  const yaw = t + .94 * Math.sin(t);
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
};

test('automatic flight has the same progress at different frame rates', () => {
  const flight = createFlightProfile(length, tangent);
  const expected = flight.advance(14, 20, 2.4);
  for (const fps of [20, 30, 60, 120]) {
    let distance = 14;
    for (let i = 0; i < 20 * fps; i++) distance = flight.advance(distance, 1 / fps, 2.4);
    assert.ok(Math.abs(distance - expected) < 1e-7, `Frame-rate drift at ${fps} Hz`);
  }
});

test('the flight heading and time mapping cross the closing seam continuously', () => {
  const flight = createFlightProfile(length, tangent);
  const angle = flight.headingAt(.001) - flight.headingAt(length - .001);
  assert.ok(Math.abs(Math.sin(angle / 2)) < .001);
  const roundTrip = flight.advance(19, flight.duration(2.4), 2.4);
  assert.ok(Math.abs(roundTrip - 19) < 1e-7);
});

test('the view follows travel exactly, without independent anticipation or heading lag', () => {
  const flight = createFlightProfile(length, tangent);
  for (let d = -.5; d < length + .5; d += .07) {
    const t = tangent(d), heading = flight.headingAt(d);
    assert.ok(Math.hypot(-Math.sin(heading) - t.x, -Math.cos(heading) - t.z) < 1e-10, `View looks away from travel at ${d}`);
  }
});

test('flight brakes for tight turns and bounds angular and linear acceleration', () => {
  const tightLength = 30, flight = createFlightProfile(tightLength, d => {
    const t = d / tightLength * Math.PI * 2, yaw = t + .98 * Math.sin(t);
    return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  });
  let distance = 0, previousSpeed, maxSpeed = 0, minSpeed = Infinity;
  const dt = 1 / 60;
  for (let t = 0; t < flight.duration(2.4); t += dt) {
    const next = flight.advance(distance, dt, 2.4), traveled = (next - distance + tightLength) % tightLength, speed = traveled / dt;
    const delta = flight.headingAt(next) - flight.headingAt(distance), angle = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
    assert.ok(angle / dt < .68, 'Turn exceeds the angular speed limit');
    if (previousSpeed !== undefined) assert.ok(Math.abs(speed - previousSpeed) / dt <= .651, 'Acceleration exceeds its limit');
    previousSpeed = speed; minSpeed = Math.min(minSpeed, speed); maxSpeed = Math.max(maxSpeed, speed); distance = next;
  }
  assert.ok(minSpeed < maxSpeed * .8, 'No slowdown at tight bends');
});
