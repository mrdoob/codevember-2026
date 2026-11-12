import test from "node:test";
import assert from "node:assert/strict";
import {
  TensionSimulation,
  STEP,
  CENTER_LINK,
  BREAKABLE_LINKS,
  LINK_COUNT,
  halfPath,
} from "../tension-simulation.js";
import {
  BreakingJourney,
  CHAIN_SPACING,
  cameraFov,
  cameraDistance,
  belowRetirementView,
  chainAngle,
} from "./fixtures/chain-journey.js";
import { LINK, colliderPath, rotateVector } from "../link-shape.js";

const distance = (a, b) => Math.hypot(...a.map((v, k) => v - b[k]));
function checkBodies(sim) {
  for (const body of [...sim.links, ...sim.fragments].filter(Boolean)) {
    assert.ok(
      [...body.position, ...body.quaternion].every(Number.isFinite),
      "Finite rigid body pose",
    );
    assert.ok(
      Math.abs(Math.hypot(...body.quaternion) - 1) < 0.001,
      "Normalized rotation",
    );
  }
  for (const [a, b] of sim.edges)
    if (sim.links[a] && sim.links[b])
      assert.ok(
        distance(sim.links[a].position, sim.links[b].position) < 0.56,
        "Intact links stay interlocked",
      );
}
function runUntilBreak(sim, pull = 1) {
  while (!sim.broken && sim.time < 20) {
    sim.advance(STEP, pull);
    checkBodies(sim);
  }
  assert.ok(sim.broken, "Pulling eventually reaches the failure load");
  return sim.fracture.time;
}

test("manual mode holds the chain without breaking under gravity", () => {
  for (const index of [0, 2, 4]) {
    const sim = new TensionSimulation({
      angle: chainAngle(index),
      seed: index,
    });
    try {
      for (let i = 0; i < 120 * 8; i++) {
        sim.advance(STEP, 0);
        checkBodies(sim);
      }
      assert.equal(sim.extension, 0);
      assert.ok(sim.slackRemaining > 0.35, "Manual mode retains the slack");
      assert.equal(
        sim.weakLink,
        null,
        "No failure site chosen before the snap",
      );
      assert.equal(sim.broken, false);
      assert.ok(sim.load > 1000 && sim.load < sim.strength);
      assert.ok(sim.inspect().contacts > 0);
    } finally {
      sim.dispose();
    }
  }
});

test("failure replaces only the weakened link with two open U bodies", () => {
  const sim = new TensionSimulation();
  try {
    const time = runUntilBreak(sim);
    assert.ok(
      time > 4 && time < 8,
      "Slack is taken up and the chain snaps promptly",
    );
    assert.ok(sim.fracture.load >= sim.strength);
    assert.equal(sim.links[sim.weakLink], null);
    assert.equal(sim.fragments.length, 2);
    assert.equal(sim.inspect().bodies, LINK_COUNT + 1);
    for (const half of [0, 1]) {
      const path = halfPath(half);
      assert.ok(
        distance(path[0], path.at(-1)) > LINK.bend * 1.9,
        "Broken ends are open",
      );
      assert.ok(
        Math.abs(path[0][1]) < 1e-10 && Math.abs(path.at(-1)[1]) < 1e-10,
      );
    }
    const fracture = sim.fracture;
    sim.breakLink();
    assert.equal(sim.fracture, fracture);
    for (let i = 0; i < 240; i++) {
      sim.advance(STEP, 0);
      checkBodies(sim);
    }
    assert.equal(sim.fragments.length, 2, "Failure is one-shot");
    assert.ok(
      distance(
        sim.links[sim.weakLink - 1].position,
        sim.links[sim.weakLink + 1].position,
      ) > 2,
      "Released halves recoil apart",
    );
  } finally {
    sim.dispose();
  }
});

test("holding to pull speeds up failure and stronger links last longer", () => {
  const times = [];
  for (const [pull, strength] of [
    [1, 35000],
    [3.7, 35000],
    [1, 50000],
  ]) {
    const sim = new TensionSimulation({ strength });
    try {
      times.push(runUntilBreak(sim, pull));
    } finally {
      sim.dispose();
    }
  }
  assert.ok(times[1] < times[0] * 0.65, `Accelerated pull: ${times}`);
  assert.ok(times[2] > times[0] + 0.25, `Strength: ${times}`);
});

test("fixed steps give identical fracture and motion at 30, 60 and 144 fps", () => {
  function run(fps) {
    const sim = new TensionSimulation();
    try {
      for (let i = 0; i < fps * 15; i++) sim.advance(1 / fps);
      return {
        fracture: Object.fromEntries(
          Object.entries(sim.fracture).filter(([key]) => key !== "fragments"),
        ),
        poses: [...sim.links, ...sim.fragments].map(
          (b) => b && [...b.position, ...b.quaternion],
        ),
      };
    } finally {
      sim.dispose();
    }
  }
  assert.deepEqual(run(30), run(60));
  assert.deepEqual(run(30), run(144));
});

function pointSegmentDistance(point, a, b) {
  const d = b.map((v, k) => v - a[k]);
  const t = Math.max(
    0,
    Math.min(
      1,
      d.reduce((sum, v, k) => sum + v * (point[k] - a[k]), 0) /
        d.reduce((sum, v) => sum + v * v, 0),
    ),
  );
  return distance(
    point,
    a.map((v, k) => v + d[k] * t),
  );
}

test("the repeating journey changes angle, clears the incoming hole and bounds world lifetime", () => {
  let created = 0,
    removed = 0,
    broken = 0,
    previousZ = 0;
  const failedLinks = [],
    layouts = new Set(),
    modes = new Set();
  let checkingRetirement = true;
  const journey = new BreakingJourney({
    seed: 42,
    onCreate(shot) {
      layouts.add(shot.simulation.chainCount);
      modes.add(shot.simulation.fractureMode);
      created++;
    },
    onBreak(shot) {
      failedLinks.push(shot.simulation.weakLink);
      broken++;
    },
    onRemove(shot) {
      if (checkingRetirement) {
        const pose = journey.cameraPose();
        const bottomSlope = Math.tan((cameraFov(16 / 9) * Math.PI) / 360);
        for (const body of [
          ...shot.simulation.links,
          ...shot.simulation.fragments,
        ].filter(Boolean)) {
          for (const p of [body.position, body.previousPosition])
            assert.ok(
              p[1] + 0.45 < pose.y - (pose.z - shot.z - p[2]) * bottomSlope,
              "No visible link or interpolated pose is removed",
            );
        }
        assert.ok(
          shot.outsideTime >= 0.75,
          "Cleanup waits for a sustained exit",
        );
      }
      removed++;
    },
  });
  try {
    for (let i = 0; i < 60 * 100; i++) {
      journey.advance(1 / 60);
      const pose = journey.cameraPose();
      assert.ok(Object.values(pose).flat().every(Number.isFinite));
      assert.ok(pose.z >= previousZ - 1e-6, "Camera retreats continuously");
      previousZ = pose.z;
      assert.ok(
        journey.shots.length <= 6,
        "Falling chains eventually leave the view and release their worlds",
      );
      if (journey.next) {
        assert.equal(
          journey.next.simulation.time,
          0,
          "Incoming link stays centered until revealed",
        );
        assert.ok(
          Math.abs(
            journey.next.simulation.angle - journey.current.simulation.angle,
          ) > 0.1,
        );
        const z = pose.z - journey.next.z;
        if (Math.abs(z) < 0.1) {
          const link = journey.next.simulation.links[CENTER_LINK];
          const path = colliderPath(10).map((p) =>
            rotateVector(p, link.quaternion),
          );
          for (let k = 0; k < path.length; k++)
            assert.ok(
              pointSegmentDistance(
                [pose.x, pose.y, z],
                path[k],
                path[(k + 1) % path.length],
              ) -
                LINK.tube >
                0.018,
              "Camera passes through the opening, clear of the metal",
            );
        }
      }
    }
    assert.ok(broken >= 6);
    assert.deepEqual([...layouts].sort(), [1, 2, 3]);
    assert.deepEqual([...modes].sort(), ["shatter", "snap", "tear"]);
    assert.ok(new Set(failedLinks).size >= 3, "Failure positions vary");
    for (let i = 1; i < failedLinks.length; i++)
      assert.notEqual(
        failedLinks[i],
        failedLinks[i - 1],
        "No consecutive repeat",
      );
    assert.ok(journey.index >= 6);
    assert.equal(journey.breaks, broken);
    assert.equal(created - removed, journey.shots.length);
    assert.ok(previousZ > CHAIN_SPACING * 6);
  } finally {
    checkingRetirement = false;
    journey.dispose();
  }
  assert.equal(created, removed, "All worlds released on disposal");
});

function sag(sim) {
  const a = sim.links[0].position,
    b = sim.links.at(-1).position;
  const mid = sim.links[CENTER_LINK]?.position ?? sim.fracture.position;
  return pointSegmentDistance(mid, a, b);
}

test("fresh chains hang in an arc and take up slack before building failure load", () => {
  const sim = new TensionSimulation();
  try {
    const initialSag = sag(sim);
    assert.ok(initialSag > 2.6, "Visible opening sag");
    for (let i = 0; i < 120; i++) sim.advance(STEP);
    assert.equal(sim.extension, 0, "Brief rest before pulling engages");
    assert.ok(sim.load < sim.strength * 0.15, "Opening has low tension");
    runUntilBreak(sim);
    assert.equal(sim.slackRemaining, 0);
    assert.ok(sag(sim) < initialSag * 0.4, "Pulling straightens the chain");
  } finally {
    sim.dispose();
  }
});

test("every candidate link can split, including both alternating orientations", () => {
  for (const weakLink of BREAKABLE_LINKS) {
    const sim = new TensionSimulation({ weakLink });
    try {
      runUntilBreak(sim, 3.7);
      assert.equal(sim.fracture.index, weakLink);
      assert.equal(sim.links[weakLink], null);
      for (let i = 0; i < 120; i++) {
        sim.advance(STEP, 0);
        checkBodies(sim);
      }
    } finally {
      sim.dispose();
    }
  }
});

test("portrait breaks stay visible without giving away a site in advance", () => {
  const aspect = 390 / 844,
    failed = [];
  const journey = new BreakingJourney({
    seed: 42,
    getAspect: () => aspect,
    onBreak(shot) {
      const sim = shot.simulation,
        point = sim.fracture.position,
        center = shot.breakCenter;
      const halfHeight =
        (cameraDistance(sim.chainCount) + shot.depthOffset - point[2]) *
        Math.tan((cameraFov(aspect, sim.chainCount) * Math.PI) / 360);
      assert.ok(Math.abs(point[0] - center[0]) < halfHeight * aspect - 0.1);
      assert.ok(Math.abs(point[1] - center[1]) < halfHeight - 0.1);
      failed.push(sim.weakLink);
    },
  });
  try {
    for (let i = 0; i < 60 * 48; i++) {
      journey.advance(1 / 60, { pulling: true });
      const sim = journey.current.simulation;
      if (!sim.fracture) {
        assert.equal(sim.weakLink, null);
        const pose = journey.cameraPose(),
          center = sim.links[CENTER_LINK].position;
        assert.ok(
          Math.abs(pose.x - center[0]) < 0.002 &&
            Math.abs(pose.y - center[1]) < 0.002,
          "Camera does not anticipate the break",
        );
      }
    }
    assert.ok(failed.length >= 5);
    assert.ok(new Set(failed).size >= 2, "More than one visible link can fail");
  } finally {
    journey.dispose();
  }
});

test("retirement keeps visible fragments, interpolation and the next wider view", () => {
  const aspect = 16 / 9,
    pose = { y: 0, z: 8 },
    future = { y: 0, z: 8 + CHAIN_SPACING };
  const below = { position: [0, -20, 0], previousPosition: [0, -20, 0] };
  const edge = { position: [0, -3.6, 0], previousPosition: [0, -3.6, 0] };
  const shot = { z: 0, simulation: { links: [below], fragments: [edge] } };
  assert.equal(
    belowRetirementView(shot, pose, future, aspect),
    false,
    "A fragment at the edge is retained",
  );
  edge.position = [0, -20, 0];
  assert.equal(
    belowRetirementView(shot, pose, future, aspect),
    false,
    "Previous rendered pose is retained",
  );
  edge.previousPosition = [0, -20, 0];
  assert.equal(
    belowRetirementView(shot, pose, future, aspect),
    true,
    "All metal has left the frame",
  );
  edge.position = edge.previousPosition = [0, -5, 0];
  assert.equal(
    belowRetirementView(shot, pose, future, aspect),
    false,
    "Next retreat can still reveal this fragment",
  );
});

test("visible older chains survive regardless of how many newer chains exist", () => {
  const journey = new BreakingJourney({ seed: 42 });
  try {
    const old = journey.current;
    old.simulation.breakLink();
    old.simulation.releaseAnchors();
    journey.current = journey.createShot(1);
    journey.next = journey.createShot(2);
    journey.createShot(3);
    journey.retireFallenChains(2);
    assert.ok(
      journey.shots.includes(old),
      "Visible old chain is not evicted by a fixed count",
    );
    for (const body of [
      ...old.simulation.links,
      ...old.simulation.fragments,
    ].filter(Boolean)) {
      body.position = [0, -100, 0];
      body.previousPosition = [0, -100, 0];
    }
    journey.retireFallenChains(0.5);
    assert.ok(journey.shots.includes(old), "Exit grace period");
    journey.retireFallenChains(0.3);
    assert.ok(!journey.shots.includes(old), "Invisible old chain is released");
  } finally {
    journey.dispose();
  }
});

test("branches thread directly through distinct main-chain links and all carry load", () => {
  for (const chainCount of [2, 3]) {
    const sim = new TensionSimulation({ chainCount });
    try {
      assert.equal(sim.links.length, 19 + (chainCount - 1) * 9);
      assert.equal(sim.anchors.length, chainCount + 1);
      const roots = sim.chains.slice(1).map((chain) => chain[0]);
      assert.equal(new Set(roots).size, chainCount - 1);
      assert.ok(roots.every((index) => sim.chains[0].includes(index)));
      while (!sim.fracture && sim.time < 12) {
        sim.advance(STEP);
        checkBodies(sim);
      }
      assert.ok(
        sim.anchors.every((a) => a.load > 10000),
        "Every pulling point carries tension",
      );
      for (let i = 0; i < 120; i++) {
        sim.advance(STEP, 0);
        checkBodies(sim);
      }
    } finally {
      sim.dispose();
    }
  }
});

test("releasing lets single and branched assemblies return to slack", () => {
  for (const chainCount of [1, 3]) {
    const sim = new TensionSimulation({ chainCount, strength: 1e8 });
    try {
      sim.advance(5.5);
      const loaded = sim.load;
      assert.ok(sim.extension > 1.4);
      sim.advance(1.5, 0);
      assert.ok(sim.extension < 0.05);
      assert.ok(
        sim.load < loaded * 0.3,
        "The pull relaxes instead of accumulating",
      );
      assert.equal(sim.fracture, null);
      checkBodies(sim);
      sim.advance(0.25, 2.7);
      assert.ok(sim.extension > 0.15, "A new tug takes up slack again");
    } finally {
      sim.dispose();
    }
  }
});

test("one-sided tears stay joined for a beat before separating", () => {
  const sim = new TensionSimulation({
    fractureMode: "tear",
    chainCount: 3,
    weakLink: 7,
  });
  try {
    while (!sim.fracture && sim.time < 12) sim.advance(STEP);
    assert.ok(sim.fracture);
    assert.ok(sim.hinge);
    assert.equal(sim.broken, false);
    const firstCrack = sim.fracture.time;
    sim.advance(0.15);
    assert.equal(
      sim.broken,
      false,
      "The other side still holds after the first crack",
    );
    const tearing = sim.fracture;
    while (sim.pendingFracture && sim.time < 12) sim.advance(STEP);
    assert.ok(tearing.completeTime - firstCrack >= 0.32);
    assert.ok(
      tearing.opening > 0.6,
      "The sections rotate apart before release",
    );
    assert.equal(sim.hinge, null);
    sim.advance(1);
    checkBodies(sim);
  } finally {
    sim.dispose();
  }
});

test("brittle failure creates four moving pieces and conserves the link's mass", () => {
  const sim = new TensionSimulation({
    fractureMode: "shatter",
    chainCount: 2,
    weakLink: 19,
  });
  try {
    const mass = sim.links[19].mass;
    while (!sim.fracture && sim.time < 12) {
      sim.advance(STEP);
      checkBodies(sim);
    }
    assert.equal(sim.fragments.length, 4);
    assert.ok(
      Math.abs(sim.fragments.reduce((sum, b) => sum + b.mass, 0) - mass) <
        mass * 0.001,
    );
    sim.advance(1);
    checkBodies(sim);
    assert.ok(
      distance(sim.fragments[0].position, sim.fragments[2].position) > 0.15,
    );
  } finally {
    sim.dispose();
  }
});

test("remaining paths tighten and fracture before the assembly is finished", () => {
  const sim = new TensionSimulation({ chainCount: 3, weakLink: CENTER_LINK });
  try {
    while (!sim.fracture && sim.time < 12) sim.advance(STEP);
    assert.equal(sim.broken, false);
    assert.equal(
      sim.loadedComponents.length,
      2,
      "Both sides still connect two pulling points",
    );
    const originalFragments = [...sim.fragments];
    while (!sim.broken && sim.time < 20) {
      sim.advance(STEP);
      checkBodies(sim);
    }
    assert.ok(sim.broken);
    assert.equal(sim.fractures.length, 3);
    assert.equal(sim.loadedComponents.length, 0);
    assert.ok(
      originalFragments.every((body) => sim.fragments.includes(body)),
      "Earlier pieces stay in the world",
    );
    for (let i = 1; i < sim.fractures.length; i++) {
      assert.ok(
        sim.fractures[i].time - sim.fractures[i - 1].completeTime >= 0.64,
      );
      assert.ok(
        sim.fractures[i].load >= sim.strength,
        "Each later break is driven by tension",
      );
    }
  } finally {
    sim.dispose();
  }
});

test("portrait camera follows both surviving sides before retreating", () => {
  for (const seed of [2, 42, 88]) {
    const journey = new BreakingJourney({ seed, getAspect: () => 390 / 844 });
    try {
      while (journey.index < 1 && journey.time < 15) journey.advance(1 / 60);
      assert.equal(journey.index, 1);
      const shot = journey.current,
        sim = shot.simulation;
      assert.ok(sim.chainCount > 1);
      sim.forcedWeakLink = CENTER_LINK;
      while (shot.reportedBreaks < 1 && journey.time < 25)
        journey.advance(1 / 60);
      assert.equal(sim.broken, false);
      assert.equal(journey.current, shot);
      assert.equal(journey.next, null);
      assert.equal(journey.transitionAge, -1);
      while (!sim.broken && sim.time < 15) {
        journey.advance(1 / 60);
        checkBodies(sim);
      }
      assert.ok(
        sim.broken,
        "Neither surviving side can get stuck outside the camera",
      );
      assert.equal(shot.reportedBreaks, sim.chainCount);
      assert.ok(journey.next);
      assert.equal(
        journey.current,
        shot,
        "Retreat starts only after the final break",
      );
    } finally {
      journey.dispose();
    }
  }
});
