import test from "node:test";
import assert from "node:assert/strict";
import {
  MineSimulation,
  MINE_LINK_STRENGTH,
  MINE_HOME,
} from "../mine-simulation.js";
import { MineJourney } from "../mine-journey.js";
import { STEP, b3 } from "../tension-simulation.js";
import { rotateVector, linkPoint, LINK } from "../link-shape.js";
import { EYE_CENTER, MINE_EYE } from "../mine-attachment.js";
import { createAlgaeRoots } from "../algae-roots.js";
import { SeaweedSimulation } from "../seaweed-simulation.js";
const distance = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
function finite(sim) {
  for (const body of [sim.mine, ...sim.links, ...sim.fragments].filter(Boolean))
    assert.ok([...body.position, ...body.quaternion].every(Number.isFinite));
  const attachment = rotateVector(EYE_CENTER, sim.mine.quaternion).map(
    (v, k) => v + sim.mine.position[k],
  );
  assert.ok(
    distance(attachment, sim.links[0].position) < 0.53,
    "First link stays threaded through the physical eye",
  );
  for (const [a, b] of sim.edges)
    if (sim.links[a] && sim.links[b])
      assert.ok(
        distance(sim.links[a].position, sim.links[b].position) < 0.57,
        "Unbroken neighbors remain interlocked",
      );
}
test("mine rests without failure, responds to a sideways drag and relaxes on release", () => {
  const sim = new MineSimulation({ strength: 24000 });
  try {
    sim.advance(6, 0);
    finite(sim);
    assert.equal(sim.broken, false);
    sim.dragTarget = [0.65, 0.8, 0];
    sim.advance(1.5, 0);
    finite(sim);
    assert.ok(sim.mine.position[0] > 0.4);
    assert.equal(sim.broken, false);
    sim.dragTarget = null;
    sim.advance(2.5, 0);
    finite(sim);
    assert.ok(Math.abs(sim.mine.position[0]) < 0.2);
  } finally {
    sim.dispose();
  }
});
test("a rising mine can be grabbed, pushed below the old drag limit and turned either way", () => {
  for (const direction of [-1, 1]) {
    const sim = new MineSimulation({
      arrivalY: -6.1,
      strength: 30000,
      seed: 0,
    });
    try {
      sim.advance(4, 0);
      assert.equal(sim.phase, "rising");
      const p = [...sim.mine.position];
      sim.beginDrag(p.map((v, k) => v + (k === 2 ? 1.28 : 0)));
      sim.dragTarget = [p[0] + direction * 0.8, p[1] - 1.7, p[2]];
      sim.advance(1.4, 0);
      finite(sim);
      assert.equal(
        sim.broken,
        false,
        "Taking slack out downward does not break the chain",
      );
      assert.ok(
        sim.mine.position[1] < p[1] - 0.25,
        "The mine follows a downward grab during its entrance",
      );
      assert.ok((sim.mine.position[0] - p[0]) * direction > 0.3);
      assert.ok(
        sim.mine.quaternion[1] * direction > 0.08,
        "The grabbed surface turns toward the pointer",
      );
      const y = sim.mine.position[1];
      sim.endDrag();
      sim.advance(1, 0);
      assert.equal(sim.grabLocal, null);
      assert.ok(
        sim.mine.position[1] > y + 0.3,
        "Release resumes the buoyant ascent",
      );
    } finally {
      sim.dispose();
    }
  }
});

test("a prepared replacement sleeps until ready and is reused at the handoff", () => {
  let created = 0,
    removed = 0;
  const journey = new MineJourney({
    seed: 2,
    onCreate(shot, preparing) {
      created++;
      return !preparing;
    },
    onRemove() {
      removed++;
    },
  });
  try {
    const outgoing = journey.current;
    const next = journey.prepareNext();
    assert.equal(
      journey.prepareNext(),
      next,
      "Only one replacement is prepared",
    );
    journey.advance(14);
    assert.equal(next.simulation.time, 0);
    assert.equal(next.simulation.phase, "rising");
    journey.setDrag([0, 5, 0]);
    journey.advance(8);
    assert.ok(outgoing.simulation.broken);
    assert.equal(
      journey.current,
      outgoing,
      "An unfinished visual never enters the frame",
    );
    next.ready = true;
    journey.advance(STEP);
    assert.equal(journey.current, next);
    assert.equal(next.simulation.time, 0);
    assert.equal(created, 2, "Handoff creates no new physics or visuals");
  } finally {
    journey.dispose();
  }
  assert.equal(
    removed,
    created,
    "Both active and prepared assemblies are disposed",
  );
});
test("upward dragging takes up slack, fractures a link and lets the mine rise", () => {
  const sim = new MineSimulation({ strength: 24000 });
  try {
    sim.advance(2, 0);
    sim.dragTarget = [0, 5, 0];
    // This legacy start has several units of slack to lift through water drag.
    while (!sim.broken && sim.time < 10) {
      sim.advance(STEP, 0);
      finite(sim);
    }
    assert.ok(sim.broken);
    assert.ok(
      sim.mine.position[1] > MINE_HOME[1] + 1.15,
      "No immediate failure from dragging inertia",
    );
    assert.equal(sim.fractures.length, 1);
    const y = sim.mine.position[1];
    sim.advance(2, 0);
    finite(sim);
    assert.ok(sim.mine.position[1] > y + 2);
    assert.equal(sim.dragTarget, null);
  } finally {
    sim.dispose();
  }
});
test("fracture sends a larger bend through the surviving chain without separating intact links", () => {
  for (const [fractureMode, weakLink] of [
    ["snap", 3],
    ["tear", 8],
    ["shatter", 15],
  ]) {
    const sim = new MineSimulation({ arrivalY: -6.1, weakLink, fractureMode });
    try {
      sim.advance(14, 0);
      assert.equal(sim.recoil.length, 0, "No recoil is added while tethered");
      sim.dragTarget = [0, 5, 0];
      while (!sim.broken && sim.time < 23) sim.advance(STEP, 0);
      assert.equal(sim.broken, true);
      const start = sim.links.map((b) => b?.position.slice());
      let transverse = 0,
        samples = 0,
        movement = 0;
      for (let frame = 0; frame < 144; frame++) {
        sim.advance(STEP, 0);
        finite(sim);
        sim.links.forEach((body, i) => {
          if (!body || Math.abs(i - weakLink) < 3) return;
          transverse += body.velocity[0] ** 2 + body.velocity[2] ** 2;
          movement = Math.max(
            movement,
            Math.hypot(
              body.position[0] - start[i][0],
              body.position[2] - start[i][2],
            ),
          );
          samples++;
        });
      }
      assert.ok(
        Math.sqrt(transverse / samples) > 0.15,
        `${fractureMode}: links beyond the cut actively recoil`,
      );
      assert.ok(
        movement > 0.2,
        `${fractureMode}: the bend reaches the rest of the chain`,
      );
      assert.equal(
        sim.recoil.length,
        0,
        "The release pulse ends instead of sustaining jitter",
      );
    } finally {
      sim.dispose();
    }
  }
});

test("suspended underwater links settle instead of continually shaking", () => {
  for (const arrivalY of [-6.1, -7.47]) {
    const sim = new MineSimulation({ arrivalY, seed: 0, strength: 24000 });
    try {
      sim.advance(14, 0);
      assert.equal(sim.phase, "ready");
      let linear = 0,
        angular = 0,
        samples = 0,
        largestStep = 0;
      for (let i = 0; i < 480; i++) {
        sim.step(0);
        for (const body of sim.links.slice(0, 7)) {
          linear += Math.hypot(...body.velocity) ** 2;
          angular +=
            Math.hypot(...b3.b3Body_GetAngularVelocity([0, 0, 0], body.id)) **
            2;
          largestStep = Math.max(
            largestStep,
            distance(body.position, body.previousPosition),
          );
          samples++;
        }
      }
      assert.ok(
        Math.sqrt(linear / samples) < 0.025,
        "Idle links retain only a slow drift",
      );
      assert.ok(
        Math.sqrt(angular / samples) < 0.08,
        "Link rocking settles in the water",
      );
      assert.ok(largestStep < 0.001, "No abrupt positional chatter");
      assert.equal(sim.broken, false);
    } finally {
      sim.dispose();
    }
  }
});
test("the first link bears on the eye surface without fused stock", () => {
  const sim = new MineSimulation({ strength: 24000, arrivalY: -6.1 });
  try {
    sim.advance(14, 0);
    const dragY = MINE_HOME[1] + 0.5;
    for (const target of [null, [0.5, dragY, 0], [-0.45, dragY, 0]]) {
      sim.dragTarget = target;
      sim.advance(1.8, 0);
      assert.equal(sim.broken, false);
      const eye = Array.from({ length: 192 }, (_, i) =>
        rotateVector(
          linkPoint(i / 192, MINE_EYE).map((v, k) => v + EYE_CENTER[k]),
          sim.mine.quaternion,
        ).map((v, k) => v + sim.mine.position[k]),
      );
      let closest = Infinity;
      for (let i = 0; i < 192; i++) {
        const p = rotateVector(linkPoint(i / 192), sim.links[0].quaternion).map(
          (v, k) => v + sim.links[0].position[k],
        );
        for (const e of eye) closest = Math.min(closest, distance(p, e));
      }
      assert.ok(
        closest > MINE_EYE.tube + LINK.tube - 0.012,
        "Iron surfaces remain separate under load",
      );
      assert.ok(
        closest < MINE_EYE.tube + LINK.tube + 0.012,
        "Link rests against the forged eye",
      );
    }
  } finally {
    sim.dispose();
  }
});
test("surviving branches keep the mine tethered until their own links fail", () => {
  for (const chainCount of [2, 3]) {
    const sim = new MineSimulation({
      chainCount,
      strength: 24000,
      weakLink: 8,
    });
    try {
      sim.dragTarget = [0, 5, 0];
      let first = false;
      while (!sim.broken && sim.time < 12) {
        sim.advance(STEP, 0);
        finite(sim);
        if (sim.fractures.length === 1 && !sim.pendingFracture) {
          assert.equal(sim.broken, false);
          first = true;
        }
      }
      assert.ok(first);
      assert.ok(sim.broken);
      assert.equal(sim.fractures.length, chainCount);
    } finally {
      sim.dispose();
    }
  }
});
test("an orbiting camera watches mines rise, break and clear the view from every side", () => {
  for (const aspect of [16 / 9, 390 / 844]) {
    const journey = new MineJourney({ seed: 2, getAspect: () => aspect });
    const camera = journey.cameraPose();
    const failures = [];
    try {
      for (let encounter = 0; encounter < 3; encounter++) {
        journey.orbitAngle = (encounter * Math.PI * 2) / 3;
        const shot = journey.current,
          sim = shot.simulation;
        assert.equal(sim.chainCount, 1);
        assert.ok(
          sim.mine.position[1] < -5,
          "Incoming mine begins below the frame",
        );
        assert.equal(sim.phase, "rising");
        while (sim.phase !== "ready" && sim.time < 16) {
          journey.advance(STEP);
          const view = journey.cameraPose();
          assert.ok(
            Math.abs(Math.hypot(view.x, view.z) - camera.z) < 1e-8,
            "Orbit retains the framing distance",
          );
          assert.deepEqual(view.target, camera.target);
          finite(sim);
          assert.equal(
            sim.broken,
            false,
            "Entrance cannot fracture the tether",
          );
        }
        assert.equal(sim.phase, "ready", "Chain catches and settles the mine");
        assert.ok(
          sim.mine.position[1] > -0.5 && sim.mine.position[1] < 0.2,
          "Mine settles lower in the frame",
        );
        journey.advance(3);
        assert.equal(sim.broken, false, "Mine waits for the user");
        assert.ok(
          Math.abs(sim.mine.velocity[1]) < 0.3,
          "Tether stops the ascent",
        );
        journey.setDrag([0, 4, 0]);
        let litLink = null;
        for (let i = 0; i < 120 * 8 && !sim.broken; i++) {
          journey.advance(STEP);
          if (!sim.fracture && shot.stressLink !== null) {
            if (litLink !== null) assert.equal(shot.stressLink, litLink);
            litLink = shot.stressLink;
          }
        }
        assert.ok(sim.broken, "User pull releases the mine");
        assert.notEqual(litLink, null, "Tension lights a link before fracture");
        assert.equal(
          sim.fracture.index,
          litLink,
          "The illuminated link actually breaks",
        );
        assert.ok(
          sim.fracture.index !== failures.at(-1),
          "Consecutive mines fail at different visible links",
        );
        failures.push(sim.fracture.index);
        assert.ok(
          journey.shots.includes(shot),
          "Visible outgoing chain remains",
        );
        const lower = sim.links.at(-1),
          shellY = sim.mine.position[1];
        journey.advance(1.5);
        assert.ok(
          lower.velocity[1] < -0.1,
          "Lower chain falls after its initial recoil",
        );
        assert.ok(sim.mine.position[1] > shellY + 0.3, "Mine floats upward");
        while (journey.current === shot && journey.transitionAge < 10)
          journey.advance(STEP);
        assert.equal(journey.index, encounter + 1);
        const view = journey.cameraPose(),
          depth =
            camera.z -
            (sim.mine.position[0] * view.x + sim.mine.position[2] * view.z) /
              camera.z;
        assert.ok(
          sim.mine.position[1] - view.y - 1.92 >
            depth * Math.tan((view.fov * Math.PI) / 360),
          "Outgoing shell fully clears the orbiting view before replacement",
        );
        assert.equal(journey.current.z, 0);
      }
    } finally {
      journey.dispose();
    }
  }
});

test("a tensioned link stays selected after releasing and pulling again", () => {
  const journey = new MineJourney({ seed: 8 });
  try {
    journey.advance(14);
    const shot = journey.current,
      sim = shot.simulation;
    assert.equal(
      shot.stressLink,
      null,
      "Idle buoyancy does not select a glowing link",
    );
    const y = sim.mine.position[1];
    for (let i = 0; i < 600 && sim.load < sim.strength * 0.7; i++) {
      journey.setDrag([0, y + i * STEP * 0.6, 0]);
      journey.advance(STEP);
    }
    assert.equal(sim.broken, false);
    assert.notEqual(shot.stressLink, null);
    const selected = shot.stressLink;
    assert.deepEqual(
      journey.recentBreakLinks,
      [],
      "A preview does not count as a completed break",
    );
    journey.setDrag(null);
    journey.advance(2);
    assert.equal(sim.controlled, false);
    assert.equal(
      shot.stressLink,
      selected,
      "Release keeps the future break location stable",
    );
    journey.setDrag([0, 5, 0]);
    for (let i = 0; i < 600 && !sim.broken; i++) journey.advance(STEP);
    assert.equal(sim.broken, true);
    assert.equal(sim.fracture.index, selected);
    assert.deepEqual(journey.recentBreakLinks, [selected]);
  } finally {
    journey.dispose();
  }
});

test("orbit keeps moving during dragging and holds at zero speed", () => {
  const journey = new MineJourney({ seed: 2 });
  try {
    journey.advance(14);
    const angle = journey.orbitAngle;
    assert.ok(angle > 0.5, "Orbit advances during the entrance");
    journey.setDrag([...journey.current.simulation.mine.position]);
    journey.advance(0.5);
    assert.ok(
      journey.orbitAngle > angle + 0.02,
      "Picking up a mine keeps the orbit moving",
    );
    const held = journey.orbitAngle;
    journey.setDrag(null);
    journey.advance(STEP);
    assert.ok(journey.orbitAngle > held && journey.orbitAngle - held < 0.001);
    const resumed = journey.orbitAngle;
    journey.advance(0.5, { orbitSpeed: 0 });
    assert.equal(
      journey.orbitAngle,
      resumed,
      "Zero speed holds the current angle",
    );
  } finally {
    journey.dispose();
  }
});

test("side and rear camera views retain visible old assemblies", () => {
  const journey = new MineJourney({ seed: 2 });
  try {
    const old = journey.current;
    journey.current = journey.createShot(1);
    for (const body of [old.simulation.mine, ...old.simulation.links]) {
      body.position = [0, 0, 0];
      body.previousPosition = [0, 0, 0];
    }
    for (const angle of [Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      journey.orbitAngle = angle;
      journey.retire(2);
      assert.ok(
        journey.shots.includes(old),
        "An assembly in the center of the rotated view remains visible",
      );
    }
    for (const body of [old.simulation.mine, ...old.simulation.links]) {
      body.position = [0, -30, 0];
      body.previousPosition = [0, -30, 0];
    }
    journey.retire(2);
    assert.ok(
      !journey.shots.includes(old),
      "The assembly is retired once it clears the view",
    );
  } finally {
    journey.dispose();
  }
});

test("algae roots follow the shell while tips lag and segments remain finite", async () => {
  const { SeaweedSimulation } = await import("../seaweed-simulation.js");
  const body = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
    root = [0, 0, 1.3];
  const algae = new SeaweedSimulation(
    [{ root, length: 0.4, width: 0.008, phase: 0 }],
    body,
  );
  for (let i = 0; i < 180; i++) algae.advance(STEP, body);
  const strand = algae.strands[0],
    oldTip = [...strand.points.at(-1)];
  for (let i = 0; i < 30; i++) {
    body.position[0] += 0.005;
    algae.advance(STEP, body);
  }
  assert.ok(distance(strand.points[0], [0.15, 0, 1.3]) < 1e-6);
  assert.ok(strand.points.at(-1)[0] - oldTip[0] < 0.13, "Tip lags behind root");
  for (const p of strand.points) assert.ok(p.every(Number.isFinite));
  for (let i = 1; i < strand.points.length; i++)
    assert.ok(
      distance(strand.points[i - 1], strand.points[i]) < 0.065,
      "Strands retain length",
    );
});

test("chain algae follows rotating links and stays on the matching broken piece", () => {
  for (const fractureMode of ["snap", "tear", "shatter"]) {
    const sim = new MineSimulation({
      strength: 24000,
      arrivalY: -6.1,
      weakLink: 8,
      fractureMode,
    });
    try {
      sim.advance(14, 0);
      const roots = createAlgaeRoots(sim, () => 0.42);
      const algae = new SeaweedSimulation(roots, sim.mine);
      const chainStrands = algae.strands.filter(
        (s) => s.linkIndex !== undefined,
      );
      assert.ok(chainStrands.length > 60);
      const cutStrands = chainStrands.filter((s) => s.linkIndex === 8);
      const lowerStrand = chainStrands.find((s) => s.linkIndex === 12);
      const oldTip = [...lowerStrand.points.at(-1)];
      sim.dragTarget = [0.4, 5, 0];
      for (let i = 0; i < 720 && !sim.broken; i++) {
        sim.step(0);
        algae.advance(STEP, sim.mine);
      }
      assert.ok(sim.broken);
      const fracture = sim.fractures.find((f) => f.index === 8);
      for (const strand of cutStrands)
        assert.ok(
          fracture.fragments.includes(strand.body),
          "Root transfers to surviving metal",
        );
      for (let i = 0; i < 120; i++) {
        sim.step(0);
        algae.advance(STEP, sim.mine);
      }
      for (const strand of chainStrands) {
        const anchor = rotateVector(strand.root, strand.body.quaternion).map(
          (v, k) => v + strand.body.position[k],
        );
        assert.ok(
          distance(strand.points[0], anchor) < 1e-6,
          "Roots follow the link's full position and rotation",
        );
        for (const p of strand.points) assert.ok(p.every(Number.isFinite));
      }
      assert.ok(
        distance(oldTip, lowerStrand.points.at(-1)) > 0.1,
        "Algae follows the falling chain",
      );
    } finally {
      sim.dispose();
    }
  }
});

test("stronger mine tethers need a farther pull, including the highest slider setting", () => {
  let previousPull = 0;
  for (const strength of [
    30000,
    MINE_LINK_STRENGTH,
    MINE_LINK_STRENGTH * 1.6,
  ]) {
    const sim = new MineSimulation({ arrivalY: -6.1, strength, seed: 0 });
    try {
      sim.advance(14, 0);
      assert.equal(sim.broken, false);
      const y = sim.mine.position[1];
      let pull = 0;
      while (!sim.broken && pull < 8) {
        sim.dragTarget = [0, y + pull * 0.65, 0];
        sim.advance(STEP, 0);
        pull += STEP;
      }
      assert.ok(
        sim.broken,
        "A deliberate pull can break even the strongest tether",
      );
      assert.ok(sim.fracture.load >= strength);
      assert.ok(
        pull > previousPull + 0.4,
        "Increasing strength takes a longer, farther pull",
      );
      previousPull = pull;
    } finally {
      sim.dispose();
    }
  }
});
