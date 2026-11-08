import test from "node:test";
import assert from "node:assert/strict";
import {
  EDGE_PALETTE,
  NEON_COLORS,
  tubeColor,
  tubeBlink,
} from "../neon-pattern.js";
import {
  createSculpture,
  DEFAULT_TUBE_RADIUS,
  TUBE_TRANSMISSION,
} from "../sculpture.js";
import { rotation4 } from "../hypercube.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);

test("multicolor spreads the palette across the edges and preserves single-color modes", () => {
  const colors = Array.from({ length: 32 }, (_, i) =>
    tubeColor(i, "Multicolor"),
  );
  assert.deepEqual(Object.keys(NEON_COLORS), ["Blue", "Green", "Purple"]);
  for (const color of EDGE_PALETTE) {
    const count = colors.filter((c) => c === color).length;
    assert.ok(
      count >= Math.floor(32 / EDGE_PALETTE.length) &&
        count <= Math.ceil(32 / EDGE_PALETTE.length),
    );
  }
  for (const [mode, color] of Object.entries(NEON_COLORS)) {
    assert.ok(
      Array.from({ length: 32 }, (_, i) => tubeColor(i, mode)).every(
        (c) => c === color,
      ),
    );
  }
});

test("random blinking has independent outages, soft transitions, and repeatable seeks", () => {
  const signatures = [];
  for (let edge = 0; edge < 32; edge++) {
    const levels = Array.from({ length: 600 }, (_, i) =>
      tubeBlink(edge, i / 20),
    );
    assert.ok(levels.every((x) => Number.isFinite(x) && x >= 0 && x <= 1));
    assert.ok(
      levels.includes(0) &&
        levels.includes(1) &&
        levels.some((x) => x > 0 && x < 1),
    );
    signatures.push(levels.join());
    // Out-of-order evaluation must not depend on a mutable RNG or frame rate.
    for (let i = 599; i >= 0; i--)
      assert.equal(tubeBlink(edge, i / 20), levels[i]);
    for (const time of [-2, 0, 0.31, 5, 80, 1000])
      assert.equal(tubeBlink(edge, time, 4), tubeBlink(edge, time * 4));
  }
  assert.equal(new Set(signatures).size, 32);
});

test("per-edge color and blinking agree between the neon material and area lights", () => {
  const settings = {
    perspective: 3.6,
    color: "Multicolor",
    power: 45,
    radius: DEFAULT_TUBE_RADIUS,
    flicker: 0,
    illumination: true,
    blinking: true,
    blinkSpeed: 1,
  };
  const sculpture = createSculpture(settings),
    matrix = rotation4(0);
  const radiance = sculpture.tubes.geometry.getAttribute("tubeRadiance");
  let dark = 0,
    lit = 0;
  for (let time = 0; time < 8; time += 0.137) {
    sculpture.update(matrix, time);
    sculpture.lights.forEach((light, i) => {
      const power = light.intensity / TUBE_TRANSMISSION;
      close(radiance.getX(i), light.color.r * power);
      close(radiance.getY(i), light.color.g * power);
      close(radiance.getZ(i), light.color.b * power);
      if (light.intensity === 0) dark++;
      else lit++;
    });
  }
  assert.ok(dark > 0 && lit > 0);
  settings.blinking = false;
  sculpture.update(matrix, 4);
  assert.ok(sculpture.blinkLevels.every((x) => x === 1));
  assert.ok(sculpture.lights.every((light) => light.intensity > 0));
  settings.illumination = false;
  sculpture.update(matrix, 4);
  assert.ok(sculpture.lights.every((light) => light.intensity === 0));
  assert.ok(radiance.array.some((value) => value > 0));
  settings.color = "Purple";
  sculpture.update(matrix, 4);
  assert.equal(
    new Set(sculpture.lights.map((light) => light.color.getHexString())).size,
    1,
  );
  sculpture.dispose();
});
