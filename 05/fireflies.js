import {
  AdditiveBlending, DynamicDrawUsage, Group, InstancedBufferAttribute,
  InstancedBufferGeometry, Mesh, PlaneGeometry, PointLight, Scene, SpriteNodeMaterial, Vector3
} from 'three/webgpu';
import { attribute, cameraProjectionMatrix, float, modelViewMatrix, screenSize, uv, vec2, vec4 } from 'three/tsl';
import { randomSeed, smoothstep } from './random.js';
import { groundHeight } from './woodland.js';
import { STONE_SCALE } from './stone.js';
import { defocusAmount } from './lens.js';
import { createMossFlight } from './firefly-flight.js';

export const FIREFLY_COUNT = 48;
export const FIREFLY_INTENSITY = .6;
// A rounded rise and a long fade, with zero slope at either end.
const pulse = age => smoothstep(0, .38, age) * (1 - smoothstep(.42, 1, age));

export function createFireflies(layouts = [], getRockOffset = null) {
  const group = new Group();
  group.name = 'Fireflies';
  const random = randomSeed(5052026);
  // Behavior has a separate stream so changing flight never changes the glow.
  const flightRandom = randomSeed(5052027);
  const positions = new InstancedBufferAttribute(new Float32Array(FIREFLY_COUNT * 3), 3).setUsage(DynamicDrawUsage);
  const glows = new InstancedBufferAttribute(new Float32Array(FIREFLY_COUNT), 1).setUsage(DynamicDrawUsage);
  const colors = new InstancedBufferAttribute(new Float32Array(FIREFLY_COUNT * 3), 3);
  const plane = new PlaneGeometry(1, 1);
  const geometry = new InstancedBufferGeometry().copy(plane);
  plane.dispose();
  geometry.instanceCount = FIREFLY_COUNT;
  geometry.setAttribute('flyPosition', positions);
  geometry.setAttribute('flyGlow', glows);
  geometry.setAttribute('flyColor', colors);
  const glowScene = new Scene();
  const glow = new SpriteNodeMaterial({ blending: AdditiveBlending, depthWrite: false, depthTest: false, fog: false });
  glow.positionNode = attribute('flyPosition', 'vec3');
  const lanterns = new Mesh(geometry, glow);
  lanterns.name = 'Firefly lanterns and lens glow';
  // Positions live in instanced attributes, not geometry's unit-plane bounds.
  lanterns.frustumCulled = false;
  glowScene.add(lanterns);
  function setLens({ sceneDepth, focusNear, focusFar, depthRange, aperture, enabled }) {
    const depth = modelViewMatrix.mul(vec4(glow.positionNode, 1)).z.negate();
    const outside = depth.sub(focusFar).max(0).add(focusNear.sub(depth).max(0));
    const coc = defocusAmount(outside, depthRange).mul(enabled);
    const worldPerPixel = depth.mul(2).div(cameraProjectionMatrix[1][1].mul(screenSize.y));
    const blur = aperture.mul(coc).mul(worldPerPixel);
    // Combine emitter size, lens defocus, and subpixel coverage. A tiny sharp
    // lantern becomes a soft lens disk as it leaves the rock's focus interval.
    const sourceRadius = .0075;
    const coreRadius = blur.pow(2).add(sourceRadius ** 2).add(worldPerPixel.mul(.6).pow(2)).sqrt();
    const haloRadius = blur.add(.10);
    glow.scaleNode = vec2(haloRadius.mul(2));
    const radius = uv().sub(.5).length().mul(2).mul(haloRadius);
    const edge = worldPerPixel.mul(.75).max(blur.mul(.28));
    const disk = radius.smoothstep(coreRadius.sub(edge).max(0), coreRadius.add(edge)).oneMinus();
    const core = radius.div(coreRadius).pow(2).mul(-2).exp().mix(disk, blur.div(worldPerPixel).smoothstep(1, 4));
    // Spread roughly the same energy over a larger blur, retaining only a
    // faint artistic floor so distant flashes remain visible at twilight.
    const energy = float(sourceRadius).div(coreRadius).pow(2).mul(.9994).add(.0006);
    const haloEnergy = float(.10).div(haloRadius).pow(2);
    const halo = radius.div(haloRadius).pow(2).mul(-6).exp().mul(.16).mul(haloEnergy);
    const tint = attribute('flyColor', 'vec3');
    glow.colorNode = tint.pow(.45).mul(core.mul(28).mul(energy)).add(tint.mul(halo)).mul(attribute('flyGlow', 'float'));
    const visible = sceneDepth.add(.002).greaterThanEqual(depth);
    glow.opacityNode = radius.div(haloRadius).smoothstep(.8, 1).oneMinus().mul(visible);
    glow.needsUpdate = true;
  }
  const lights = [], paths = [];
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const angle = random() * Math.PI * 2;
    const distance = i < 20 ? 2.1 + random() * 1.8 : 4.2 + random() * 6;
    const x = Math.cos(angle) * distance, z = Math.sin(angle) * distance;
    const layout = i < 24 && layouts.length ? layouts[i % layouts.length] : null;
    const region = layout ? {
      index: i % layouts.length, flight: createMossFlight(layout, flightRandom),
      radius: Math.max(STONE_SCALE.x * (layout.width ?? 1), STONE_SCALE.z) * layout.scale + .35,
      height: layout.scale * .65 + .2
    } : null;
    paths.push({ x, z, y: groundHeight(x, z) + .65 + random() * 2.3,
      phase: random() * Math.PI * 2, speed: .14 + random() * .12,
      drift: .28 + random() * .32, period: 6 + random() * 3,
      duration: 2.6 + random() * .8, paired: random() < .28, strength: .7 + random() * .3,
      region });
    const light = new PointLight(0xffffff, 0, 1.6, 2);
    light.color.setRGB(1, .76 + random() * .1, .22 + random() * .1);
    colors.setXYZ(i, light.color.r, light.color.g, light.color.b);
    light.name = `Firefly ${i + 1}`;
    lights.push(light); group.add(light);
  }
  const point = new Vector3(), flightCenter = new Vector3(), rockOffset = new Vector3();
  function update(time, enabled = true, brightness = 1, illuminate = true) {
    group.visible = enabled;
    lanterns.visible = enabled;
    for (let i = 0; i < FIREFLY_COUNT; i++) {
      const p = paths[i], t = time * p.speed, phase = p.phase;
      point.set(p.x + (Math.sin(t + phase) + .18 * Math.sin(t * 1.71 + phase * 2)) * p.drift,
        p.y + Math.sin(t * .87 + phase * 2) * .18 + Math.sin(t * 1.63 + phase) * .035,
        p.z + (Math.cos(t * .79 + phase) + .16 * Math.sin(t * 1.57 + phase)) * p.drift);
      if (p.region) {
        const region = p.region;
        rockOffset.set(0, 0, 0);
        getRockOffset?.(region.index, rockOffset);
        region.flight.sample(time, rockOffset, flightCenter);
        const angle = phase + t * .16 + Math.sin(t * .53 + phase * 1.7) * .65 + Math.sin(t * 1.13 + phase) * .18;
        const radius = region.radius + Math.sin(t * .67 + phase) * .025;
        point.set(flightCenter.x + Math.cos(angle) * radius,
          flightCenter.y + region.height + Math.sin(t * .71 + phase) * .12 + Math.sin(t * 1.31 + phase * .8) * .035,
          flightCenter.z + Math.sin(angle) * radius);
      }
      // Independent, slow flashes with a soft rise, long fade, and dark interval.
      // Some insects answer with a second, fainter pulse. The visible lantern
      // and its clustered point light always use exactly the same envelope.
      const cycle = (time + phase * p.period / (Math.PI * 2)) % p.period;
      const first = pulse(cycle / p.duration);
      // Fit the quiet echo inside the cycle; both ends are dark at the wrap.
      const echoDuration = p.duration * .55;
      const second = p.paired ? pulse((cycle - p.period + echoDuration + .2) / echoDuration) * .35 : 0;
      const intensity = (.002 + Math.max(first, second) * .998) * p.strength * brightness;
      positions.setXYZ(i, point.x, point.y, point.z); glows.setX(i, intensity);
      lights[i].position.copy(point);
      lights[i].intensity = enabled && illuminate ? intensity * FIREFLY_INTENSITY : 0;
    }
    positions.needsUpdate = glows.needsUpdate = true;
  }
  update(0);
  return { group, glowScene, lights, positions, glows, setLens, update,
    dispose() { geometry.dispose(); glow.dispose(); for (const light of lights) light.dispose(); }
  };
}
