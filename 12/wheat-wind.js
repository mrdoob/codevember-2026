import { Fn, positionLocal, normalLocal, vec3 } from 'three/tsl';
import { terrainHeightNode } from './field-terrain.js';

// Shared by bending and canopy illumination: a passing front changes both
// the stalk orientation and the amount of exposed, sunlit grain.
export const wheatGust = Fn(([p, time]) => {
  const front = p.x.mul(.32).add(p.z.mul(.16)).sub(time.mul(1.65));
  const swell = p.x.mul(.065).sub(p.z.mul(.12)).sub(time.mul(.5)).sin();
  // Uneven fronts keep the canopy from forming evenly spaced, solid ridges.
  const eddy = p.x.mul(.57).add(p.z.mul(.39)).add(time.mul(.19)).sin();
  return front.add(swell.mul(1.3)).add(eddy.mul(.85)).sin().mul(.5).add(.5).pow2();
});

// A prevailing breeze, broad traveling gust fronts, and small turbulent
// ripples. World-space phases keep neighboring stalks moving together.
export const wheatWindOffset = Fn(([p, time, breeze]) => {
  const height = p.y.sub(terrainHeightNode(p.xz)).max(0);
  const bend = height.div(1.65).clamp(0, 1).pow2();
  const gust = wheatGust(p, time);
  const flutter = p.x.mul(2.2).add(p.z.mul(1.7)).add(time.mul(3.8)).sin();
  // The same gust-and-release cycles reach every part of the field.
  const along = gust.mul(1.125).add(.025).add(flutter.mul(.02));
  const across = p.x.mul(.31).sub(p.z.mul(.27)).sub(time.mul(.8)).sin().mul(.09);
  const amount = breeze.clamp(0, 2).mul(bend);
  const pushX = along.mul(.92).sub(across.mul(.39)).mul(amount);
  const pushZ = along.mul(.39).add(across.mul(.92)).mul(amount);
  // Limit bending by stalk height, without any camera-relative restriction.
  const reach = pushX.mul(pushX).add(pushZ.mul(pushZ)).sqrt().max(.0001);
  const maxReach = height.mul(.98);
  // Approach maximum lean smoothly instead of snapping whole rows onto a
  // shared flat plateau as soon as the gust exceeds a hard bend threshold.
  const limit = maxReach.div(maxReach.mul(maxReach).add(reach.mul(reach)).sqrt());
  const x = pushX.mul(limit), z = pushZ.mul(limit);
  // Follow a full arc at large bends instead of the small-angle sag estimate.
  const sag = height.mul(height).sub(x.mul(x)).sub(z.mul(z)).max(0).sqrt().sub(height);
  return vec3(x, sag, z);
});

export function createWheatWind(time, breeze) {
  return Fn(() => {
    // positionLocal has already passed through the patch instance transform.
    // These meshes have identity object transforms, so it is also world space.
    const p = positionLocal.toVar(), offset = wheatWindOffset(p, time, breeze).toVar();
    const height = p.y.sub(terrainHeightNode(p.xz)).max(0);
    const slope = height.lessThan(1.65).select(height.max(.001).reciprocal().mul(2), 0);
    normalLocal.y.subAssign(normalLocal.x.mul(offset.x).add(normalLocal.z.mul(offset.z)).mul(slope));
    normalLocal.assign(normalLocal.normalize());
    return p.add(offset);
  })();
}
