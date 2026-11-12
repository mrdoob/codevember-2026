import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  instancedArray,
  instanceIndex,
  uniformArray,
  float,
  attribute,
  positionView,
  uniform,
  uv,
  vec3,
  cameraPosition,
  mix,
  color,
} from "three/tsl";

export function createDust(scene, opaqueViewZ) {
  const count = 16000,
    plane = new THREE.PlaneGeometry(1, 1),
    geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.attributes = plane.attributes;
  geometry.instanceCount = count;
  const data = new Float32Array(count * 4);
  let state = 931;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < count; i++)
    data.set([random(), random(), random(), random()], i * 4);
  geometry.setAttribute(
    "dustSeed",
    new THREE.InstancedBufferAttribute(data, 4),
  );
  const clock = uniform(0),
    strength = uniform(0.25),
    seed = attribute("dustSeed", "vec4");
  const seeds = instancedArray(data, "vec4");
  const positions = instancedArray(count, "vec3"),
    velocities = instancedArray(count, "vec3");
  const volumeCenter = uniform(new THREE.Vector3(0, 0, 3.15)),
    delta = uniform(0);
  const wakePositions = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const wakeVelocities = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const wakeSpins = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const wakeCount = uniform(0, "int");
  const trailPositions = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const trailVelocities = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const trailSpins = uniformArray(
    Array.from({ length: 32 }, () => new THREE.Vector4()),
  );
  const trailCount = uniform(0, "int");
  const shockPositions = uniformArray(
    Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, 100)),
  );
  const shockPower = uniformArray([0, 0, 0, 0], "float");
  const halfBox = vec3(6, 5, 6),
    box = halfBox.mul(2);
  const initialize = Fn(() => {
    positions
      .element(instanceIndex)
      .assign(
        seeds.element(instanceIndex).xyz.sub(0.5).mul(box).add(volumeCenter),
      );
    velocities.element(instanceIndex).assign(vec3(0));
  })().compute(count);
  const compute = Fn(() => {
    const p = positions.element(instanceIndex),
      v = velocities.element(instanceIndex);
    const s = seeds.element(instanceIndex);
    const relative = p.sub(volumeCenter).add(halfBox).toVar();
    const wrapped = relative
      .sub(relative.div(box).floor().mul(box))
      .sub(halfBox)
      .add(volumeCenter)
      .toVar();
    If(p.sub(wrapped).length().greaterThan(1), () => {
      v.assign(vec3(0));
    });
    p.assign(wrapped);
    // Spatially coherent, divergence-free currents carry neighboring motes
    // together. Their different drag response keeps the water from moving as a sheet.
    const t = clock.mul(0.12);
    const current = vec3(
      p.y.mul(0.65).add(t).sin().add(p.z.mul(0.48).sub(t).cos().mul(0.45)),
      p.z
        .mul(0.62)
        .add(t)
        .sin()
        .mul(0.45)
        .add(p.x.mul(0.58).add(t).cos().mul(0.25))
        .sub(0.12),
      p.x
        .mul(0.55)
        .sub(t)
        .sin()
        .mul(0.7)
        .add(p.y.mul(0.5).add(t).cos().mul(0.35)),
    ).mul(0.14);
    v.addAssign(current.sub(v).mul(delta).mul(s.w.mul(0.5).add(0.65)));
    Loop({ start: 0, end: wakeCount, type: "int" }, ({ i }) => {
      const body = wakePositions.element(i),
        motion = wakeVelocities.element(i),
        spin = wakeSpins.element(i);
      const offset = p.sub(body.xyz).toVar(),
        d2 = offset.dot(offset).toVar();
      const influence = d2
        .div(body.w)
        .negate()
        .exp()
        .mul(motion.w)
        .mul(delta)
        .toVar();
      const surfaceMotion = motion.xyz.add(spin.xyz.cross(offset).mul(0.8));
      v.addAssign(surfaceMotion.sub(v).mul(influence).mul(2.8));
      // Metal pushes nearby motes outward as well as entraining its wake.
      v.addAssign(offset.div(d2.sqrt().max(0.04)).mul(influence).mul(0.45));
      // The mine displaces water; motes slide around its shell, not through it.
      If(spin.w.greaterThan(0).and(d2.lessThan(spin.w.pow2())), () => {
        p.assign(body.xyz.add(offset.div(d2.sqrt().max(0.001)).mul(spin.w)));
      });
    });
    Loop({ start: 0, end: trailCount, type: "int" }, ({ i }) => {
      const eddy = trailPositions.element(i),
        motion = trailVelocities.element(i),
        spin = trailSpins.element(i);
      const offset = p.sub(eddy.xyz).toVar();
      const influence = offset
        .dot(offset)
        .div(eddy.w)
        .negate()
        .exp()
        .mul(motion.w)
        .mul(delta);
      const flow = motion.xyz.mul(0.5).add(spin.xyz.cross(offset).mul(0.7));
      v.addAssign(flow.sub(v.mul(0.2)).mul(influence));
    });
    Loop(4, ({ i }) => {
      const shock = shockPositions.element(i),
        age = shock.w;
      const offset = p.sub(shock.xyz).toVar(),
        distance = offset.length().max(0.03).toVar();
      const shell = distance.sub(age.mul(3.4)).div(0.3).pow2().negate().exp();
      const power = shell
        .mul(age.mul(-2).exp())
        .mul(shockPower.element(i))
        .mul(delta)
        .mul(18);
      v.addAssign(offset.div(distance).mul(power));
    });
    v.mulAssign(float(4).div(v.length().max(4)));
    p.addAssign(v.mul(delta));
  })().compute(count);
  const center = positions.toAttribute();
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = center;
  const distance = center.sub(cameraPosition).length();
  const size = seed.w.pow(3).mul(0.007).add(0.002);
  // Cap angular size, including near-camera motes. Water grains stay small
  // instead of turning into large depth-of-field discs.
  const rendered = size.min(distance.mul(0.0025));
  material.scaleNode = rendered;
  material.colorNode = mix(
    color("#58b3c4"),
    color("#a5e8ed"),
    seed.x.smoothstep(0.55, 0.98),
  );
  const disc = uv().sub(0.5).length().mul(2).smoothstep(0.55, 1).oneMinus();
  const depth = positionView.z.sub(opaqueViewZ).smoothstep(0, 0.05);
  material.opacityNode = disc
    .mul(strength)
    .mul(size.div(rendered.max(0.0001)).min(1))
    .mul(
      velocities.toAttribute().length().smoothstep(0.12, 1.4).mul(0.5).add(0.8),
    )
    .mul(depth)
    // Keep the foreground clear, including the screen edges during an orbit.
    .mul(positionView.z.negate().smoothstep(2, 4))
    .mul(distance.smoothstep(10, 16).oneMinus());
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let pending = 0,
    initialized = false,
    nextShock = 0,
    emitAge = 0,
    trails = [];
  const viewDirection = new THREE.Vector3();
  return {
    clock,
    strength,
    mesh,
    positions,
    velocities,
    viewDistance: 6,
    get wakeCount() {
      return wakeCount.value;
    },
    get trailCount() {
      return trails.length;
    },
    advance(dt) {
      pending += dt;
      emitAge += dt;
      for (const trail of trails) {
        trail.age += dt;
        for (let k = 0; k < 3; k++) trail.p[k] += trail.v[k] * dt * 0.12;
      }
      trails = trails.filter((t) => t.age < 4.2);
      for (const shock of shockPositions.array) shock.w += dt;
    },
    burst(point, power = 1) {
      shockPositions.array[nextShock].set(point.x, point.y, point.z, 0);
      shockPower.array[nextShock] = power;
      nextShock = (nextShock + 1) % 4;
    },
    clear() {
      pending = 0;
      initialized = false;
      emitAge = 0;
      trails = [];
      trailCount.value = wakeCount.value = 0;
      for (const shock of shockPositions.array) shock.w = 100;
    },
    update(renderer, journey, camera) {
      camera.getWorldDirection(viewDirection);
      volumeCenter.value
        .copy(camera.position)
        .addScaledVector(viewDirection, this.viewDistance * 0.72);
      if (!initialized) {
        renderer.compute(initialize);
        initialized = true;
      }
      if (pending <= 0) return;
      const bodies = [];
      for (const shot of journey.shots) {
        if (shot === journey.next) continue;
        for (const body of [
          ...shot.simulation.links,
          ...shot.simulation.fragments,
          shot.simulation.mine,
        ]) {
          if (!body) continue;
          const p = body.position,
            v = body.velocity;
          const distance =
            (p[0] - camera.position.x) ** 2 +
            (p[1] - camera.position.y) ** 2 +
            (p[2] + shot.z - camera.position.z) ** 2;
          const speed = Math.hypot(...v),
            mine = body === shot.simulation.mine,
            spin = mine ? (body.angularVelocity ?? [0, 0, 0]) : [0, 0, 0];
          if (distance < 400 && (mine || speed > 0.06))
            bodies.push({
              p,
              v,
              z: shot.z,
              distance,
              speed,
              spin,
              mine,
              radius: mine ? 4.2 : 0.4,
            });
        }
      }
      bodies.sort(
        (a, b) => Number(b.mine) - Number(a.mine) || a.distance - b.distance,
      );
      wakeCount.value = Math.min(32, bodies.length);
      for (let i = 0; i < wakeCount.value; i++) {
        const { p, v, z, speed, radius, spin, mine } = bodies[i];
        wakePositions.array[i].set(p[0], p[1], p[2] + z, radius);
        wakeVelocities.array[i].set(
          ...v,
          Math.min(
            1.5,
            speed * (mine ? 1.1 : 0.65) + Math.hypot(...spin) * 0.7,
          ),
        );
        wakeSpins.array[i].set(...spin, mine ? 1.32 : 0);
      }
      if (emitAge >= 0.16) {
        emitAge %= 0.16;
        for (const body of bodies) {
          if (!body.mine || body.speed + Math.hypot(...body.spin) < 0.09)
            continue;
          const length = Math.hypot(body.v[0], body.v[1]);
          const side =
            length > 0.05
              ? [-body.v[1] / length, body.v[0] / length, 0]
              : [1, 0, 0];
          for (const sign of [-1, 1])
            trails.push({
              p: body.p.map(
                (v, k) => v + (k === 2 ? body.z : 0) + side[k] * sign * 0.72,
              ),
              v: [...body.v],
              spin: body.spin.map(
                (v, k) => v * 0.8 + (k === 2 ? sign * body.speed * 0.85 : 0),
              ),
              power: Math.min(
                1.4,
                0.2 + body.speed * 0.6 + Math.hypot(...body.spin) * 0.5,
              ),
              age: 0,
            });
        }
        trails = trails.slice(-32);
      }
      trailCount.value = trails.length;
      trails.forEach((t, i) => {
        trailPositions.array[i].set(...t.p, 1.4 + t.age * 0.55);
        trailVelocities.array[i].set(
          ...t.v,
          t.power * Math.exp(-t.age * 0.65) * (1 - t.age / 4.2),
        );
        trailSpins.array[i].set(...t.spin, 0);
      });
      // One dispatch per rendered frame, independent of the rigid-body substeps.
      delta.value = Math.min(pending, 0.05);
      renderer.compute(compute);
      pending = 0;
    },
    dispose() {
      scene.remove(mesh);
      initialize.dispose();
      compute.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

// Short-lived fracture glints with ballistic motion on the GPU.
export function createSparks(scene, opaqueViewZ) {
  const bursts = Array.from({ length: 3 }, () =>
    createSparkBurst(scene, opaqueViewZ),
  );
  let current = 0;
  return {
    get age() {
      return bursts[current].age;
    },
    burst(point) {
      current = (current + 1) % bursts.length;
      bursts[current].burst(point);
    },
    update(dt) {
      for (const burst of bursts) burst.update(dt);
    },
    clear() {
      for (const burst of bursts) burst.clear();
    },
    dispose() {
      for (const burst of bursts) burst.dispose();
    },
  };
}
function createSparkBurst(scene, opaqueViewZ) {
  const count = 480,
    plane = new THREE.PlaneGeometry(1, 1),
    geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.attributes = plane.attributes;
  geometry.instanceCount = count;
  const values = new Float32Array(count * 4);
  let state = 713;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < count; i++)
    values.set([random(), random(), random(), random()], i * 4);
  geometry.setAttribute(
    "sparkSeed",
    new THREE.InstancedBufferAttribute(values, 4),
  );
  const age = uniform(100),
    origin = uniform(new THREE.Vector3()),
    seed = attribute("sparkSeed", "vec4"),
    t = age.min(4);
  const azimuth = seed.x.mul(Math.PI * 2),
    z = seed.y.mul(2).sub(1),
    radius = z.pow2().oneMinus().sqrt();
  const speed = seed.z.pow(2).mul(3.5).add(0.5);
  const velocity = vec3(
    azimuth.cos().mul(radius),
    azimuth.sin().mul(radius).add(0.16),
    z.mul(0.85),
  ).mul(speed);
  const center = origin.add(velocity.mul(t)).sub(vec3(0, t.pow2().mul(0.5), 0));
  const size = seed.w.pow(3).mul(0.006).add(0.0015);
  const distance = center.sub(cameraPosition).length();
  const rendered = size.min(distance.mul(0.0025));
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = center;
  material.scaleNode = rendered;
  material.colorNode = mix(color("#ffb16a"), color("#fff0d5"), seed.w).mul(
    seed.z.mul(0.6).add(0.85),
  );
  const disc = uv().sub(0.5).length().mul(2).smoothstep(0.35, 1).oneMinus();
  const lifetime = age.smoothstep(0.06, 1.25).oneMinus();
  const depth = positionView.z.sub(opaqueViewZ).smoothstep(0, 0.02);
  material.opacityNode = disc
    .mul(lifetime)
    .mul(size.div(rendered.max(0.0001)).min(1))
    .mul(depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return {
    age,
    burst(point) {
      origin.value.copy(point);
      age.value = 0;
    },
    update(dt) {
      age.value += dt;
    },
    clear() {
      age.value = 100;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
