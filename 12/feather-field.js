import { InstancedMesh, InstancedBufferAttribute, Object3D, Vector3, Color } from 'three/webgpu';
import { createFeatherGeometry } from './feather-geometry.js';
import { randomGenerator } from './random.js';
import { CAMERA, GROUND_Y, FEATHER_SCALE, FEATHER_FALL_SPEED, FEATHER_SPREAD } from './scene-constants.js';

export function createFeatherField(scene, material, camera) {
  const random = randomGenerator(2412), dummy = new Object3D();
  const batches = [], feathers = [];
  const variants = [
    { seed: 21, detail: 1, count: 6 },
    { seed: 73, detail: .72, count: 18 },
    { seed: 44, detail: .34, count: 96 },
    { seed: 86, detail: .28, count: 136 },
  ];
  for (let v = 0; v < variants.length; v++) {
    const variant = variants[v], geometry = createFeatherGeometry(variant.seed, variant.detail);
    const mesh = new InstancedMesh(geometry, material, variant.count);
    mesh.name = `Feathers / detail ${variant.detail}`;
    const phases = new Float32Array(variant.count), tints = new Float32Array(variant.count * 3);
    mesh.frustumCulled = false;
    for (let i = 0; i < variant.count; i++) {
      const index = feathers.length, hero = index < 3;
      const phase = random() * Math.PI * 2;
      phases[i] = phase;
      const tone = random();
      const color = new Color(tone < .6 ? '#ffe1cf' : tone < .83 ? '#f5c4af' : '#e6a28d');
      color.toArray(tints, i * 3);
      const angle = random() * Math.PI * 2;
      const radius = v < 2 ? 2 + random() * 3 : 5 + Math.sqrt(random()) * 19;
      // Stay above the view even at maximum camera height and portrait FOV,
      // including diagonal wind travel and a margin for feather bounds.
      const top = Math.max(16, CAMERA.maxHeight + (CAMERA.maxDistance + radius * FEATHER_SPREAD + 3)
        * Math.tan((-CAMERA.elevation + CAMERA.portraitFov / 2) * Math.PI / 180) + 1.5);
      const base = new Vector3(Math.sin(angle) * radius, -5 + random() * (top + 5), Math.cos(angle) * radius);
      let scale = hero ? 1.25 : .45 + random() * .55;
      let tilt = hero ? -.19 : (random() - .5) * 5.4;
      if (index === 0) base.set(.65, 0, 0);
      if (index === 1) { base.set(-.6, 8, -.3); scale = 1.1; tilt = .55; }
      if (index === 2) { base.set(.3, 16, .4); scale = 1.15; tilt = -.75; }
      if (index === 3) { base.set(-3.8, -2.9, 3.1); scale = 1.15; tilt = -1.1; }
      if (index === 4) { base.set(-3.1, 1.4, -1.8); scale = .84; tilt = .75; }
      if (index === 5) { base.set(3.5, -1.5, -3.4); scale = .88; tilt = -1.32; }
      base.x *= FEATHER_SPREAD;
      base.z *= FEATHER_SPREAD;
      scale *= FEATHER_SCALE;
      const boundsRadius = (geometry.boundingSphere.radius + geometry.boundingSphere.center.length()) * scale + .25;
      feathers.push({ index, mesh, slot: i, hero, base, top, scale, boundsRadius, tilt, phase, speed: hero ? 1 : .75 + random() * .5, fall: 0, lastFallStep: 0, cycles: 0, offset: new Vector3(), velocity: new Vector3(), roll: 0, spin: 0 });
    }
    geometry.setAttribute('featherPhase', new InstancedBufferAttribute(phases, 1));
    geometry.setAttribute('featherTint', new InstancedBufferAttribute(tints, 3));
    scene.add(mesh); batches.push(mesh);
  }
  let time = 0;
  const viewPosition = new Vector3(), sway = new Vector3();
  function update(dt, settings) {
    time += dt;
    camera.updateMatrixWorld();
    const viewSlope = Math.tan(camera.fov * Math.PI / 360);
    const radiusFactor = Math.hypot(1, viewSlope);
    for (const feather of feathers) {
      const { base, phase, speed, hero, offset, velocity } = feather;
      const t = time * speed, amount = settings.breeze;
      velocity.multiplyScalar(Math.exp(-dt * .9));
      offset.addScaledVector(velocity, dt);
      offset.multiplyScalar(Math.exp(-dt * .18));
      feather.spin *= Math.exp(-dt * 1.3);
      feather.roll = (feather.roll + feather.spin * dt) * Math.exp(-dt * .35);
      // A feather slips sideways as it banks, then catches air at the turn.
      // Independent phases and a slower eddy prevent synchronized pendulums.
      const flutterRate = 1.65 + .35 * Math.sin(phase * 2.3);
      const flutter = t * flutterRate + phase + .22 * Math.sin(t * .47 + phase * 1.7);
      const slip = Math.sin(flutter), bank = Math.cos(flutter);
      const heading = phase * 2.4 + Math.sin(t * .23 + phase) * .35;
      const travel = (hero ? .42 : .56) * slip;
      sway.set(
        (Math.cos(heading) * travel + Math.sin(t * .27 + phase) * .3) * amount,
        0,
        (Math.sin(heading) * travel + Math.sin(t * .31 + phase * 1.8) * .25) * amount,
      );
      dummy.position.copy(base).add(offset).add(sway);
      // Faster descent while slipping, slower while catching the air. Keep
      // descent positive and integrate it so speed changes cannot teleport.
      const catchAir = 1 - .24 * amount * Math.cos(flutter * 2);
      feather.lastFallStep = dt * FEATHER_FALL_SPEED * speed * settings.fallSpeed * catchAir;
      feather.fall += feather.lastFallStep;
      dummy.position.y -= feather.fall;
      // Test the same wind-displaced position that will actually be rendered.
      // At high camera angles, depth sway can bring a feather above the edge.
      viewPosition.copy(dummy.position).applyMatrix4(camera.matrixWorldInverse);
      const belowView = viewPosition.y + feather.boundsRadius * radiusFactor < viewPosition.z * viewSlope;
      const belowGround = dummy.position.y + feather.boundsRadius < GROUND_Y;
      // The recycling height is only a gate. Wait until the entire feather
      // is below the view or below the soil before sending it overhead again.
      if (dummy.position.y < -8 && (belowView || belowGround)) {
        feather.fall = base.y - feather.top;
        feather.cycles++;
        offset.set(0, 0, 0); velocity.set(0, 0, 0);
        dummy.position.copy(base).add(sway); dummy.position.y = feather.top + sway.y;
      }
      dummy.rotation.set(
        (Math.sin(flutter - .6) * .28 + Math.sin(t * .51 + phase) * .12) * amount,
        (Math.sin(t * .46 + phase) * .55 + bank * .32 + t * (hero ? .045 : .085)) * amount,
        feather.tilt + (bank * (hero ? .46 : .62) + Math.sin(flutter * 2 - .4) * .1) * amount + feather.roll,
      );
      dummy.scale.setScalar(feather.scale);
      dummy.updateMatrix();
      feather.mesh.setMatrixAt(feather.slot, dummy.matrix);
      if (!feather.position) feather.position = new Vector3();
      feather.position.copy(dummy.position);
    }
    for (const mesh of batches) mesh.instanceMatrix.needsUpdate = true;
  }
  function stir(point, delta, strength = 1) {
    for (const f of feathers) {
      const d2 = (f.position.x - point.x) ** 2 + (f.position.y - point.y) ** 2;
      const weight = Math.exp(-d2 / 8) * Math.exp(-Math.abs(f.position.z) * .035) * strength;
      f.velocity.x += delta.x * weight * .8;
      f.velocity.y += delta.y * weight * .8;
      f.velocity.z += Math.hypot(delta.x, delta.y) * weight * .09;
      f.velocity.clampLength(0, 4);
      f.spin += (delta.x * -.23 + delta.y * .08) * weight;
      f.spin = Math.max(-2, Math.min(2, f.spin));
    }
  }
  return {
    feathers, batches, update, stir,
    setAspect(value) { feathers[0].base.x = (value < CAMERA.portraitAspect ? .06 : .65) * FEATHER_SPREAD; },
    get time() { return time; },
    reset() { time = 0; for (const f of feathers) { f.offset.set(0, 0, 0); f.velocity.set(0, 0, 0); f.roll = f.spin = f.fall = f.lastFallStep = f.cycles = 0; } },
    dispose() {
      for (const mesh of batches) {
        mesh.removeFromParent(); mesh.geometry.dispose(); mesh.dispose();
      }
    },
  };
}
