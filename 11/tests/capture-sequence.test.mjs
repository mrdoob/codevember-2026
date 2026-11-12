import test from "node:test";
import assert from "node:assert/strict";
import { MineJourney } from "../mine-journey.js";
import {
  FPS,
  TOTAL_FRAMES,
  LOOP_BLEND_FRAMES,
  SEED,
  SWING_DURATION,
  createDragSequence,
} from "../scripts/capture-sequence.js";

test("capture gives both mines a slow drag and break, then clears all metal before the loop", () => {
  const journey = new MineJourney({ seed: SEED, getAspect: () => 1 }),
    sequence = createDragSequence(),
    ranges = [
      { min: 0, max: 0 },
      { min: 0, max: 0 },
    ];
  try {
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      if (frame > 0) {
        sequence.update(journey);
        journey.advance(1 / FPS, { orbitSpeed: 2.5 });
      }
      const sim = journey.current.simulation;
      if (journey.index < 2 && sim.dragTarget && !sim.broken) {
        const x =
          sim.mine.position[0] * Math.cos(journey.orbitAngle) -
          sim.mine.position[2] * Math.sin(journey.orbitAngle);
        const range = ranges[journey.index];
        range.min = Math.min(range.min, x);
        range.max = Math.max(range.max, x);
      }
      if (frame < TOTAL_FRAMES - LOOP_BLEND_FRAMES) continue;
      const pose = journey.cameraPose(),
        tangent = Math.tan((pose.fov * Math.PI) / 360);
      for (const shot of journey.shots) {
        if (shot === journey.next) continue;
        for (const [body, radius] of [
          [shot.simulation.mine, 1.9],
          ...[...shot.simulation.links, ...shot.simulation.fragments].map(
            (b) => [b, 0.5],
          ),
        ]) {
          if (!body) continue;
          const x = body.position[0] - pose.x,
            y = body.position[1] - pose.y,
            z = body.position[2] - pose.z,
            depth = -x * Math.sin(pose.azimuth) - z * Math.cos(pose.azimuth);
          assert.ok(
            depth < -radius ||
              Math.abs(y) > depth * tangent + radius * Math.hypot(1, tangent),
            `Visible metal at loop frame ${frame}`,
          );
        }
      }
    }
    const grabs = sequence.events.filter((e) => e.type === "grab"),
      breaks = sequence.events.filter((e) => e.type === "break");
    assert.deepEqual(
      grabs.map((e) => e.mine),
      [0, 1],
    );
    assert.deepEqual(
      breaks.map((e) => e.mine),
      [0, 1],
    );
    assert.notEqual(breaks[0].link, breaks[1].link);
    for (let i = 0; i < 2; i++) {
      assert.ok(breaks[i].time - grabs[i].time > SWING_DURATION + 1.8);
      assert.ok(breaks[i].time - grabs[i].time < SWING_DURATION + 3);
      assert.ok(
        ranges[i].max - ranges[i].min > 1.5,
        "Mine traverses a broad arc in camera space",
      );
    }
    assert.equal(journey.next.index, 2);
    assert.equal(
      journey.next.ready,
      false,
      "Third mine waits for the loop's entrance",
    );
  } finally {
    journey.dispose();
  }
});
