// Run in the existing experiment tab:
// await (await import('./scripts/gpu-checks.js')).runGPUChecks(tangle)
// Full particle readbacks are diagnostic only, never part of the animation loop.
import { instanceIndex } from 'three/tsl';
import { GPURopeSimulation } from '../gpu-rope.js';
import { RADIUS, SPACING, INITIAL_COUNT, STEP } from '../rope-config.js';
import { yarnIndexCount } from '../yarn-layout.js';

const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
const nextFrame = () => new Promise(requestAnimationFrame);
const read = async (app, buffer) => new Float32Array(await app.renderer.getArrayBufferAsync(buffer.value));

// Isolate contact and sleep behavior with two resting, stacked strands. Move
// the lower strand away, then verify that the upper strand wakes and falls.
export async function runGPUSupportChecks(renderer) {
  const count = 24;
  const g = new GPURopeSimulation(renderer, { strands: 2, count });
  const ptr = 'ptr<storage,array<vec4<f32>>,read_write>';
  const literal = value => Number(value).toFixed(9);
  try {
    g.settings.feed = 0;
    g.settings.wander = 0;
    g.syncSettings();
    const seed = g.kernel(
      'Seed stacked yarn check',
      `fn seed(id:u32,positions:${ptr},materials:${ptr},velocity:${ptr}) -> void {
        if(id>=${g.total}u) { return; }
        let p=vec4<f32>(f32(id%${count}u)*${literal(SPACING)},
          ${literal(RADIUS)}+f32(id/${count}u)*${literal(RADIUS * 2)},0.0,0.0);
        (*positions)[id]=p;(*velocity)[id]=vec4<f32>(0.0);
        (*materials)[id]=vec4<f32>(0.0,1.0,0.0,0.0);
        (*materials)[${g.total}u+id]=vec4<f32>(p.xyz,.5);
      }`,
      { id: instanceIndex, positions: g.a, materials: g.normals, velocity: g.velocity },
      g.total
    );
    // Use gravity without the inlet or length constraints so they cannot
    // support the upper strand after its contact disappears.
    const predict = g.kernel(
      'Drop unsupported yarn check',
      `fn predict(id:u32,positions:${ptr},output:${ptr},previous:${ptr},velocity:${ptr},materials:${ptr},carry:${ptr}) -> void {
        if(id>=${g.total}u) { return; }
        let p=(*positions)[id];(*previous)[id]=p;
        (*carry)[id]=(*materials)[id];(*carry)[${g.total}u+id]=(*materials)[${g.total}u+id];
        var next=p.xyz;
        if(id%${count}u>0u) {
          let v=(*velocity)[id].xyz+vec3<f32>(0.0,-${literal(9.81 * STEP)},0.0);
          next+=v*${literal(STEP)};
        }
        (*output)[id]=vec4<f32>(next,0.0);
      }`,
      {
        id: instanceIndex,
        positions: g.a,
        output: g.b,
        previous: g.previous,
        velocity: g.velocity,
        materials: g.normals,
        carry: g.materialPrevious
      },
      g.total
    );
    const remove = g.kernel(
      'Remove supporting yarn check',
      `fn remove(id:u32,positions:${ptr},materials:${ptr}) -> void {
        if(id>=${count}u) { return; }
        (*positions)[id].z+=2.0;(*materials)[${g.total}u+id].z+=2.0;
      }`,
      { id: instanceIndex, positions: g.a, materials: g.normals },
      count
    );
    const step = [predict, g.clearNode, g.binNode, g.contactNode, g.velocityNode, g.orientNode];
    renderer.compute(seed);
    for (let i = 0; i < 10; i++) renderer.compute(step);
    const supported = await read({ renderer }, g.a);
    const indices = Array.from({ length: count - 8 }, (_, i) => count + i + 4);
    const supportedDrift = Math.max(...indices.map(i => Math.abs(supported[i * 4 + 1] - RADIUS * 3)));
    check(supportedDrift < 1e-6, 'Supported yarn must remain settled');
    renderer.compute(remove);
    renderer.compute(step);
    const materials = await read({ renderer }, g.normals);
    check(
      indices.every(i => materials[(g.total + i) * 4 + 3] === 0),
      'Removing support must wake sleeping yarn'
    );
    for (let i = 0; i < 23; i++) renderer.compute(step);
    const fallen = await read({ renderer }, g.a);
    const minimumDrop = Math.min(...indices.map(i => supported[i * 4 + 1] - fallen[i * 4 + 1]));
    check(minimumDrop > RADIUS, 'Unsupported yarn must fall under gravity');
    check(
      indices.every(i => fallen[i * 4 + 1] >= RADIUS - 1e-6),
      'Falling yarn must stop at the floor'
    );
    return { supportedDrift, minimumDrop, passed: true };
  } finally {
    g.dispose();
  }
}

export async function runGPUChecks(app) {
  const g = app.simulation;
  check(g.isGPU, 'WebGPU simulation is not active');
  const saved = { settings: { ...app.settings }, manual: app.manual };
  const report = { engine: g.engine };
  const steps = async seconds => {
    for (let i = 0; i < Math.round(seconds * 30); i++) {
      app.advance(1 / 30);
      app.render();
      await nextFrame();
    }
  };
  try {
    app.pause(true);
    app.manual = true;
    app.reset();
    report.supportRemoval = await runGPUSupportChecks(app.renderer);
    const initial = await g.inspect();
    check(initial.finite && initial.minY > 1 && initial.maxStretch < 0.001, 'Startup must leave the floor empty');
    check(initial.particles === Math.min(INITIAL_COUNT, g.count) * g.strands, 'Incorrect initial hanging length');
    const draw = async () => new Uint32Array(await app.renderer.getArrayBufferAsync(g.drawArguments.value));
    check((await draw())[0] === yarnIndexCount(g.initialCount), 'Startup must draw only the active yarn');
    check(!g.positions, 'Animation must not maintain a CPU particle mirror');
    report.initial = initial;
    app.settings.feed = 0;
    app.settings.wander = 0;
    await steps(1);
    const held = await g.inspect();
    check(held.particles === initial.particles && held.minY > 1, 'Yarn must only grow when fed');
    check(!g.beginGrab(g.initialCount + 1, [0, 1, 0]), 'Inactive yarn must not be grabbable');
    app.reset();
    // Follow material through slot recycling, with the inlet still moving.
    app.settings.feed = 1.35;
    app.settings.wander = 1;
    app.settings.friction = 0.85;
    await steps(12);
    const before = await read(app, g.a),
      normalsBefore = await read(app, g.normals),
      clockBefore = await read(app, g.state);
    check(clockBefore[4] > g.initialCount && clockBefore[4] < g.count, 'Yarn must grow toward capacity');
    check((await draw())[0] === yarnIndexCount(clockBefore[4]), 'Drawing must follow the growing yarn');
    await steps(5);
    const after = await read(app, g.a),
      normalsAfter = await read(app, g.normals),
      clockAfter = await read(app, g.state);
    const shift = Math.round((clockAfter[2] - clockBefore[2]) / SPACING),
      drifts = [],
      rotations = [];
    let total = 0,
      contacts = 0;
    for (let strand = 0; strand < g.strands; strand++)
      for (let i = 10; i < Math.min(clockBefore[4], clockAfter[4] - shift) - 3; i++) {
        const j = (strand * g.count + i) * 4,
          k = j + shift * 4;
        const drift = Math.hypot(after[k] - before[j], after[k + 1] - before[j + 1], after[k + 2] - before[j + 2]);
        if (before[j + 1] <= RADIUS + 0.01 && after[k + 1] <= RADIUS + 0.01) {
          total += drift;
          contacts++;
        }
        if (normalsBefore[g.total * 4 + j + 3] < 0.5 || normalsAfter[g.total * 4 + k + 3] < 0.5) continue;
        drifts.push(drift);
        if (drift > 1e-6) continue; // A contact can wake, move, then settle again.
        const a = normalsBefore.subarray(j, j + 3),
          b = normalsAfter.subarray(k, k + 3);
        const cosine = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (Math.hypot(...a) * Math.hypot(...b));
        rotations.push(Math.acos(Math.max(-1, Math.min(1, cosine))));
      }
    check(contacts > 100, 'The nest did not settle on the floor');
    report.restingMeanDrift = total / contacts;
    check(report.restingMeanDrift < 0.005, 'Resting GPU yarn is sliding');
    drifts.sort((a, b) => a - b);
    report.sleepingPoints = drifts.length;
    report.sleepingDriftP95 = drifts[Math.floor(drifts.length * 0.95)];
    check(drifts.length > 100 && report.sleepingDriftP95 < 1e-6, 'Settled yarn moves while feeding');
    report.restingMeanRotation = rotations.reduce((a, b) => a + b, 0) / rotations.length;
    check(rotations.length > 100 && report.restingMeanRotation < 0.02, 'The surface rolls on stationary yarn');
    app.settings.feed = 0;
    app.settings.wander = 0;
    const canvas = app.renderer.domElement,
      rect = canvas.getBoundingClientRect();
    const projected = app.controls.target.clone();
    let hit = null;
    for (let i = 100; i < clockAfter[4] - 4 && !hit; i += 7) {
      projected.fromArray(after, i * 4).project(app.camera);
      if (Math.abs(projected.x) > 0.7 || Math.abs(projected.y) > 0.7) continue;
      hit = await g.pick(
        (projected.x * 0.5 + 0.5) * rect.width,
        (-projected.y * 0.5 + 0.5) * rect.height,
        app.camera,
        rect.width,
        rect.height
      );
    }
    check(hit, 'GPU picking failed');
    const target = [hit.position[0] + 0.3, hit.position[1] + 1.5, hit.position[2]];
    check(g.beginGrab(hit.index, target, hit.travel), 'GPU grab was rejected');
    await steps(1);
    const pulled = await read(app, g.a),
      p = hit.index * 4;
    report.grabError = Math.hypot(pulled[p] - target[0], pulled[p + 1] - target[1], pulled[p + 2] - target[2]);
    check(report.grabError < 0.2, 'GPU grab did not follow the target');
    const grabbedMaterials = await read(app, g.normals);
    check(grabbedMaterials[g.total * 4 + p + 3] === 0, 'Grabbing did not wake the yarn');
    g.endGrab();
    await steps(1);
    const released = await g.inspect();
    check(released.finite && released.minY >= RADIUS - 1e-6, 'Release destabilized the yarn');
    app.settings.friction = 0;
    app.advance(1 / 30);
    check((await g.inspect()).sleeping === 0, 'Zero friction must release resting contacts');
    app.settings.friction = 0.85;
    app.settings.feed = 3;
    app.settings.wander = 1;
    app.reset();
    const buffers = g.attributes.length;
    await steps(Math.ceil((g.count * SPACING + 2) / 3));
    const recycled = await g.inspect(),
      clock = await read(app, g.state);
    check(clock[2] > g.count * SPACING, 'The check did not recycle a full strand');
    check(
      recycled.particles === g.total && (await draw())[0] === yarnIndexCount(g.count),
      'Yarn must grow to its full capacity'
    );
    check(
      recycled.finite && recycled.meanStretch < 0.025 && recycled.maxStretch < 0.3,
      'Recycling destabilized the GPU solver'
    );
    check(recycled.minY >= RADIUS - 1e-6 && g.attributes.length === buffers, 'Floor or buffer budget failed');
    report.recycled = recycled;
    report.travel = clock[2];
    const frames = await read(app, g.frames);
    check(frames.every(Number.isFinite), 'Invalid GPU yarn frames');
    for (let strand = 0; strand < g.strands; strand++)
      for (let sample = 0; sample < g.samples; sample++) {
        check(
          frames[(strand * g.samples * 3 + sample) * 4 + 3] === 1,
          'Old yarn must retain its full width up to the cut'
        );
      }
    report.framesFinite = true;
    app.reset();
    const reset = await g.inspect();
    check(reset.particles === initial.particles && reset.minY > 1, 'Reset must clear the floor again');
    check((await draw())[0] === yarnIndexCount(g.initialCount), 'Reset must hide the old pile');
    report.passed = true;
    return report;
  } finally {
    Object.assign(app.settings, saved.settings);
    app.reset();
    app.manual = saved.manual;
    app.pause(saved.settings.pause);
    app.render();
  }
}
