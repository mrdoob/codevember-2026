import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three/webgpu';
import { RopeSimulation } from '../rope-simulation.js';
import { SPACING } from '../rope-config.js';
import { Yarn } from '../yarn.js';
import { yarnSamples, yarnIndexCount } from '../yarn-layout.js';

test('the visible mesh follows the growing yarn and reset hides the old pile', () => {
  const sim = new RopeSimulation({ strands: 1, count: 80 });
  const yarn = new Yarn(sim, 0, '#ab632e');
  try {
    const geometry = yarn.mesh.geometry,
      originalPositions = geometry.attributes.position;
    const checkEnd = () => {
      const live = sim.active[0],
        last = yarnSamples(live) - 1;
      assert.equal(geometry.drawRange.count, yarnIndexCount(live));
      let caps = 0;
      for (let i = 0; i < geometry.drawRange.count; i++) {
        const v = geometry.index.getX(i);
        if (geometry.attributes.cutFace.getX(v)) caps++;
        else assert.ok(geometry.attributes.sampleIndex.getX(v) <= last, 'No inactive body row may be drawn');
      }
      assert.equal(caps, 72, 'All three end caps remain visible');
      assert.equal(yarn.activeCount.value, live);
      assert.equal(yarn.frames[last * 4 + 3], 1);
      assert.ok(Math.abs(yarn.frames[last * 4 + 1] - sim.positions[(live - 1) * 3 + 1]) < 1e-6);
      const normal = new Vector3().fromArray(yarn.frames, (yarn.samples + last) * 4);
      assert.ok(Math.abs(normal.length() - 1) < 1e-5, 'Growing frames must keep the allocated texture stride');
    };
    checkEnd();
    for (let i = 0; i < 30; i++) sim.advance(1 / 30);
    yarn.update();
    checkEnd();
    assert.ok(sim.active[0] > sim.initialCount);
    assert.equal(yarn.cutFraction.value, 0, 'The old end must not be cut before capacity is reached');
    assert.equal(geometry.attributes.position, originalPositions);
    sim.reset();
    yarn.update();
    checkEnd();
    assert.ok(yarn.frames[(yarnSamples(sim.initialCount) - 1) * 4 + 1] > 1);
  } finally {
    yarn.dispose();
  }
});

test('ply triangles face outward and the transported frames are orthonormal', () => {
  const sim = new RopeSimulation({ strands: 1, count: 20 });
  const yarn = new Yarn(sim, 0, '#ab632e');
  try {
    const g = yarn.mesh.geometry;
    const position = g.attributes.position,
      normal = g.attributes.normal,
      sample = g.attributes.sampleIndex;
    const tangent = g.attributes.tangent;
    for (let i = 0; i < position.count; i++) {
      const t = new Vector3().fromBufferAttribute(tangent, i),
        n = new Vector3().fromBufferAttribute(normal, i);
      assert.ok(Math.abs(t.length() - 1) < 1e-5, 'Fiber directions must be normalized');
      assert.ok(Math.abs(t.dot(n)) < 1e-5, 'Fiber directions must lie along the ply surface');
    }
    const point = index =>
      new Vector3().fromBufferAttribute(position, index).add(new Vector3(0, 0, yarn.distanceAt(sample.getX(index))));
    for (let i = 0; i < g.index.count; i += 3) {
      const a = g.index.getX(i),
        b = g.index.getX(i + 1),
        c = g.index.getX(i + 2);
      const face = point(b)
        .sub(point(a))
        .cross(point(c).sub(point(a)))
        .normalize();
      const smooth = new Vector3()
        .fromBufferAttribute(normal, a)
        .add(new Vector3().fromBufferAttribute(normal, b))
        .add(new Vector3().fromBufferAttribute(normal, c))
        .normalize();
      assert.ok(face.dot(smooth) > 0.5, 'Winding must agree with outward-facing normals');
    }
    assert.ok(yarn.frames.every(Number.isFinite));
    for (let i = 0; i < yarn.samples; i++) {
      const n = new Vector3().fromArray(yarn.frames, (yarn.samples + i) * 4);
      const b = new Vector3().fromArray(yarn.frames, (yarn.samples * 2 + i) * 4);
      assert.ok(Math.abs(n.length() - 1) < 1e-5);
      assert.ok(Math.abs(b.length() - 1) < 1e-5);
      assert.ok(Math.abs(n.dot(b)) < 1e-5);
      assert.equal(yarn.frames[i * 4 + 3], 1, 'The old end must not taper');
    }
    const cut = g.attributes.cutFace;
    const endSide = [],
      cap = [];
    for (let i = 0; i < position.count; i++) {
      if (sample.getX(i) !== yarn.samples - 1) continue;
      assert.equal(position.getZ(i), 0, 'The cut must lie in one tangent plane');
      if (cut.getX(i)) {
        cap.push(i);
        assert.deepEqual([normal.getX(i), normal.getY(i), normal.getZ(i)], [0, 0, 1]);
      } else endSide.push(i);
    }
    assert.ok(cap.length > 0, 'Each cut needs a visible end face');
    for (const i of endSide)
      assert.ok(
        cap.some(j => position.getX(i) === position.getX(j) && position.getY(i) === position.getY(j)),
        'The cap must reach the full sidewall without a gap'
      );
  } finally {
    yarn.dispose();
  }
});

test('the full-width cut moves between feed events and stays continuous when a particle recycles', () => {
  const sim = new RopeSimulation({ strands: 1, count: 20 });
  for (let i = 0; i < sim.count; i++) sim.positions.set([i * SPACING, 1, 0], i * 3);
  const yarn = new Yarn(sim, 0, '#ab632e'),
    end = (yarn.samples - 1) * 4;
  try {
    let previous = yarn.frames[end];
    for (let step = 1; step <= 16; step++) {
      sim.phase[0] = SPACING * (1 + step / 16);
      yarn.update();
      const current = yarn.frames[end];
      assert.ok(current < previous, 'The cut must advance even before a particle recycles');
      assert.ok(previous - current < SPACING / 8, 'The cut must not jump by an entire segment');
      assert.equal(yarn.frames[end + 3], 1, 'Cutting must preserve the full cross-section');
      assert.ok(yarn.frames.every(Number.isFinite));
      previous = current;
    }
    assert.ok(Math.abs(previous - (sim.count - 2) * SPACING) < 1e-6);
    const cutBefore = yarn.centers.slice(-3);
    sim.positions.copyWithin(3, 0, (sim.count - 1) * 3);
    sim.phase[0] = SPACING;
    sim.travel[0] += SPACING;
    yarn.update();
    assert.deepEqual(yarn.centers.slice(-3), cutBefore, 'Recycling must not move the cut');
  } finally {
    yarn.dispose();
  }
});
