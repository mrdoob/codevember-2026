import test from "node:test";
import assert from "node:assert/strict";
import { createFishSimulation, FISH_COUNT } from "../fish-simulation.js";
import { COLUMNS, floorHeight } from "../architecture.js";
import { WATER_HEIGHT } from "../motion.js";

test("fish share a deterministic fixed simulation clock across frame rates, pause and rewind", () => {
  const a = createFishSimulation(),
    b = createFishSimulation();
  for (let i = 0; i <= 180; i++) a.update(i / 30);
  for (let i = 0; i <= 864; i++) b.update(i / 144);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.headings, b.headings);
  assert.deepEqual(a.swim, b.swim);
  const paused = a.positions.slice(),
    beat = a.swim.slice();
  a.update(6);
  assert.deepEqual(a.positions, paused);
  assert.deepEqual(a.swim, beat);
  a.update(0);
  b.reset();
  b.update(0);
  assert.deepEqual(a.positions, b.positions);
  assert.deepEqual(a.swim, b.swim);
  a.update(6);
  assert.deepEqual(a.positions, paused);
});

test("fish stay upright, turn continuously, and clear columns, stairs, sphere and surface through a full lap", () => {
  const s = createFishSimulation();
  const columns = COLUMNS;
  let previous = s.positions.slice(),
    heading = s.headings.slice();
  let minY = 10,
    maxY = 0;
  for (let frame = 1; frame <= 7200; frame++) {
    s.update(frame / 60);
    for (let i = 0; i < FISH_COUNT; i++) {
      const k = i * 3,
        x = s.positions[k],
        y = s.positions[k + 1],
        z = s.positions[k + 2],
        radius = Math.hypot(x, z);
      assert.ok(Number.isFinite(x + y + z));
      assert.ok(
        Math.hypot(x - previous[k], y - previous[k + 1], z - previous[k + 2]) <
          0.018,
        "Fish teleported",
      );
      const dot =
        s.headings[k] * heading[k] +
        s.headings[k + 1] * heading[k + 1] +
        s.headings[k + 2] * heading[k + 2];
      assert.ok(dot > Math.cos(0.04), "Fish snapped its heading");
      assert.ok(Math.abs(s.headings[k + 1]) < 0.7, "Fish pitched vertically");
      assert.ok(
        radius > 3 && radius < 8.6,
        "Fish left its clear swimming corridor",
      );
      assert.ok(
        y > floorHeight(radius) + 0.3 && y < WATER_HEIGHT - 0.3,
        "Fish crossed a stair or the surface",
      );
      for (const column of columns)
        assert.ok(
          Math.hypot(x - column.x, z - column.z) > column.radius * 1.3 + 0.2,
          "Fish crossed a column",
        );
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (frame % 30 === 0)
      for (let i = 0; i < FISH_COUNT; i++)
        for (let j = i + 1; j < FISH_COUNT; j++) {
          const a = i * 3,
            b = j * 3,
            p = s.positions;
          assert.ok(
            Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]) >
              0.15,
            "Fish failed to yield to passing traffic",
          );
        }
    previous.set(s.positions);
    heading.set(s.headings);
  }
  assert.ok(maxY - minY > 3, "Fish did not explore the water column");
});
