import test from 'node:test';
import assert from 'node:assert/strict';
import { moveThroughMaze, dampedMotion, joystickAxes, WALK_RADIUS } from '../movement.js';
import { createMaze, createItinerary } from '../maze.js';

test('a long movement cannot tunnel through a hedge', () => {
  // Two passage interiors separated by a thick hedge.
  const maze = { clearance(x) { return x < 2 ? 2 - x : x > 4 ? x - 4 : 0; } };
  const position = { x: 0, z: 0 };
  moveThroughMaze(maze, position, 20, 0);
  assert.ok(position.x < 2 - WALK_RADIUS + 1e-9);
  assert.ok(position.x > 1.3);
});

test('diagonal input slides along walls', () => {
  const maze = { clearance(x) { return 2 - x; } }, position = { x: 1.4, z: 0 };
  moveThroughMaze(maze, position, 2, -3);
  assert.ok(position.x <= 2 - WALK_RADIUS);
  assert.ok(Math.abs(position.z + 3) < 1e-9);
});

test('manual movement stays clear of the real maze at corners and large time steps', () => {
  const maze = createMaze(), route = createItinerary(maze);
  for (let i = 0; i < route.points.length; i += 83) for (let angle = 0; angle < 8; angle++) {
    const [x, z] = route.points[i], position = { x, z };
    moveThroughMaze(maze, position, Math.cos(angle * Math.PI / 4) * 12, Math.sin(angle * Math.PI / 4) * 12);
    assert.ok(maze.clearance(position.x, position.z) >= WALK_RADIUS - 1e-8);
  }
});

test('acceleration covers the same distance at 30, 60, and 120 Hz', () => {
  const results = [30, 60, 120].map(fps => {
    let velocity = 0, distance = 0;
    for (let frame = 0; frame < fps * 3; frame++) {
      const result = dampedMotion(velocity, frame < fps * 2 ? 2 : 0, 8, 1 / fps);
      velocity = result.velocity; distance += result.distance;
    }
    return distance;
  });
  assert.ok(Math.max(...results) - Math.min(...results) < 1e-9);
});

test('the joystick has a dead zone and bounded diagonal speed', () => {
  assert.deepEqual(joystickAxes(2, 3), { x: 0, y: 0 });
  assert.deepEqual(joystickAxes(0, 0), { x: 0, y: 0 });
  const diagonal = joystickAxes(200, -200);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-9);
  assert.ok(diagonal.x > 0 && diagonal.y < 0);
  assert.ok(joystickAxes(0, -20).y > -1);
});
