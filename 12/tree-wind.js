import { Fn, normalLocal, positionLocal, vec3 } from 'three/tsl';
import { wheatGust } from './wheat-wind.js';

export const TREE_WIND_STRENGTH = 3;

// Trees carry the same fronts as the wheat, but their heavier branches lag
// behind each gust. Coordinates stay relative to each rooted trunk.
export const treeWindOffset = Fn(([p, root, direction, time, breeze, leaves]) => {
  const height = p.y.max(0), bend = height.div(8.5).clamp(0, 1).pow2();
  const crown = height.smoothstep(2.5, 7);
  const phase = root.x.mul(.17).add(root.z.mul(.23));
  const gust = wheatGust(root, time).mul(.25)
    .add(wheatGust(root, time.sub(.45)).mul(.5))
    .add(wheatGust(root, time.sub(.9)).mul(.25));
  const sway = time.mul(1.05).add(phase).sin().mul(.12);
  const along = gust.mul(.8).add(.12).add(sway);
  const branch = time.mul(1.8).add(phase).add(p.x.mul(.7)).add(p.z.mul(.5)).sin().mul(.12);
  const flutter = time.mul(4.3).add(p.x.mul(2.1)).sub(p.z.mul(1.7)).add(phase).sin().mul(.045).mul(leaves);
  const amount = breeze.clamp(0, 2);
  const forward = along.mul(bend).add(branch.mul(.35).add(flutter).mul(crown)).mul(amount);
  const across = branch.add(flutter).mul(crown).mul(amount);
  return vec3(
    direction.x.mul(forward).sub(direction.z.mul(across)),
    along.mul(amount).pow2().mul(bend).mul(-.09),
    direction.z.mul(forward).add(direction.x.mul(across)),
  ).mul(TREE_WIND_STRENGTH);
});

export function createTreeWind(root, direction, time, breeze, leaves) {
  return Fn(() => {
    const p = positionLocal.toVar();
    const offset = treeWindOffset(p, root, direction, time, breeze, leaves).toVar();
    // Tilt the surface with the broad bend; tiny leaf ripples only change
    // the silhouette. The base has exactly zero displacement and slope.
    const slope = p.y.greaterThan(0).and(p.y.lessThan(8.5)).select(p.y.max(.001).reciprocal().mul(2), 0);
    normalLocal.y.subAssign(normalLocal.x.mul(offset.x).add(normalLocal.z.mul(offset.z)).mul(slope));
    normalLocal.assign(normalLocal.normalize());
    return p.add(offset);
  })();
}
