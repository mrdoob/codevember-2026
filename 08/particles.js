import * as THREE from "three/webgpu";
import {
  Fn,
  If,
  instanceIndex,
  storage,
  cameraViewMatrix,
  cameraProjectionMatrix,
  positionView,
  uniform,
  uv,
  vec3,
  vec4,
  viewportSize,
} from "three/tsl";
import { FLOOR_Y, CEILING_Y, CEILING_FIXTURE_DEPTH } from "./room-layout.js";

export const PARTICLE_COUNT = 120000;

export function createParticles(scene, field, air, opaqueViewZ, settings) {
  const geometry = new THREE.InstancedBufferGeometry(),
    plane = new THREE.PlaneGeometry(1, 1);
  geometry.index = plane.index;
  geometry.attributes = plane.attributes;
  geometry.instanceCount = PARTICLE_COUNT;
  const seeds = new Float32Array(PARTICLE_COUNT * 4);
  let randomState = 8157;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const seedBuffer = new THREE.StorageBufferAttribute(seeds, 4);
  const stateBuffer = new THREE.StorageInstancedBufferAttribute(
    PARTICLE_COUNT,
    4,
  );
  const velocityBuffer = new THREE.StorageBufferAttribute(PARTICLE_COUNT, 4);
  const seedStorage = storage(seedBuffer, "vec4", PARTICLE_COUNT).toReadOnly();
  const state = storage(stateBuffer, "vec4", PARTICLE_COUNT),
    velocity = storage(velocityBuffer, "vec4", PARTICLE_COUNT);
  const clock = uniform(0),
    step = uniform(0),
    airSpeed = uniform(settings.airSpeed);
  const intensity = uniform(settings.particleBrightness),
    size = uniform(settings.particleSize);
  const height = CEILING_Y - CEILING_FIXTURE_DEPTH - FLOOR_Y - 0.35;
  const initialize = Fn(() => {
    If(instanceIndex.lessThan(PARTICLE_COUNT), () => {
      const seed = seedStorage.element(instanceIndex),
        phase = seed.w.mul(Math.PI * 2);
      const position = vec3(
        seed.x.mul(16).sub(8).add(clock.mul(0.12).add(phase).sin().mul(0.3)),
        seed.y
          .add(clock.mul(0.0025).mul(seed.w.add(0.3)))
          .fract()
          .mul(height)
          .add(FLOOR_Y + 0.18),
        seed.z
          .mul(17)
          .sub(8)
          .add(clock.mul(0.09).add(phase.mul(2)).cos().mul(0.35)),
      );
      state.element(instanceIndex).assign(vec4(position, seed.w));
      velocity.element(instanceIndex).assign(vec4(0));
    });
  })()
    .compute(PARTICLE_COUNT)
    .setName("Dust reset");
  const simulate = Fn(() => {
    If(instanceIndex.lessThan(PARTICLE_COUNT), () => {
      const particle = state.element(instanceIndex),
        position = particle.xyz.toVar();
      const settling = vec3(0, particle.w.mul(-0.004), 0);
      const target = air.sample(position).mul(airSpeed).add(settling);
      const response = step.mul(-2.4).exp().oneMinus();
      const v = velocity.element(instanceIndex).xyz.toVar();
      v.addAssign(target.sub(v).mul(response));
      position.addAssign(v.mul(step));
      const low = vec3(-8.35, FLOOR_Y + 0.12, -8.4),
        extent = vec3(16.7, height + 0.11, 17.8);
      position.assign(
        position.sub(low).div(extent).fract().mul(extent).add(low),
      );
      particle.assign(vec4(position, particle.w));
      velocity.element(instanceIndex).assign(vec4(v, 0));
    });
  })()
    .compute(PARTICLE_COUNT)
    .setName("Dust advection");
  const particle = state.toAttribute(),
    center = particle.xyz;
  const illumination = field.sample(center).toVarying("dustIllumination");
  // Soft billboards allow nearby grains to grow beyond a one-pixel point.
  const material = new THREE.SpriteNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.positionNode = center;
  material.colorNode = illumination.mul(intensity);
  const diameter = particle.w.mul(0.7).add(0.3).mul(size);
  const depth = cameraViewMatrix.mul(vec4(center, 1)).z.negate().max(0.1);
  const pixelWorld = depth
    .mul(2)
    .div(cameraProjectionMatrix.element(1).y.mul(viewportSize.y));
  const renderedDiameter = diameter.max(pixelWorld.mul(1.5));
  // Collapse unlit billboards before rasterization; distant dust stays in the
  // fluid simulation but consumes no fragment shading or blending work.
  material.scaleNode = illumination
    .dot(vec3(1))
    .greaterThan(0)
    .select(renderedDiameter, 0);
  const coverage = diameter.div(renderedDiameter).pow(2);
  const r2 = uv().sub(0.5).length().mul(2).pow(2);
  const disc = r2.mul(-3).exp().mul(r2.smoothstep(0.7, 1).oneMinus());
  const visible = positionView.z.greaterThanEqual(opaqueViewZ.sub(0.02));
  material.opacityNode = coverage.mul(disc).mul(visible);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  let lastTime = null,
    initialized = false;
  return {
    mesh,
    count: PARTICLE_COUNT,
    clock,
    stateBuffer,
    velocityBuffer,
    seedBuffer,
    update(time, settings, renderer) {
      const elapsed = lastTime === null ? 0 : time - lastTime;
      lastTime = time;
      clock.value = time;
      intensity.value = settings.particleBrightness;
      size.value = settings.particleSize;
      airSpeed.value = settings.airSpeed;
      mesh.visible = settings.particles;
      if (!settings.particles) {
        initialized = false;
        return;
      }
      if (!initialized || elapsed < 0 || elapsed > 0.2) {
        renderer.compute(initialize);
        initialized = true;
      } else if (elapsed > 0) {
        step.value = elapsed;
        renderer.compute(simulate);
      }
    },
    reset() {
      initialized = false;
    },
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      initialize.dispose();
      simulate.dispose();
      seedBuffer.dispose();
      stateBuffer.dispose();
      velocityBuffer.dispose();
    },
  };
}
