import { Color } from 'three/webgpu';
import { Fn, Loop, float, vec2, vec3, vec4, uniform, texture, textureSize, getViewPosition, screenUV, rtt } from 'three/tsl';
import { SIZE_X, SIZE_Z } from './maze.js';

export function createAtmosphere(depth, camera, lighting) {
  const time = uniform(0), density = uniform(1), lightStrength = uniform(1);
  const world = uniform(camera.matrixWorld), inverseProjection = uniform(camera.projectionMatrixInverse);
  const air = uniform(new Color(.024, .043, .087));
  const volume = rtt(Fn(() => {
    const view = getViewPosition(screenUV, depth.r, inverseProjection).toVar();
    const origin = world.mul(vec4(0, 0, 0, 1)).xyz.toVar();
    const direction = world.mul(vec4(view.normalize(), 0)).xyz.toVar();
    const distance = view.length().min(55).toVar();
    const step = distance.div(32).toVar();
    const sum = vec3(0).toVar(), transmission = float(1).toVar();
    Loop(32, ({ i }) => {
      const travel = float(i).add(.5).mul(step), p = origin.add(direction.mul(travel));
      const fieldUV = p.xz.div(vec2(SIZE_X, SIZE_Z)).add(.5);
      const irradiance = texture(lighting.field, fieldUV).level(0).rgb;
      const billow = p.x.mul(.43).add(p.z.mul(.27)).add(time.mul(.11)).sin()
        .mul(p.z.mul(.71).sub(time.mul(.14)).sin()).mul(.23).add(.8);
      const low = p.y.max(0).mul(-.72).exp().mul(.025);
      const extinction = low.add(.055).mul(density).mul(billow);
      const opacity = extinction.mul(step).negate().exp().oneMinus();
      const illumination = irradiance.mul(p.y.max(0).mul(-.25).exp()).mul(lightStrength).mul(1.3).add(air);
      sum.addAssign(illumination.mul(opacity).mul(transmission));
      transmission.mulAssign(opacity.oneMinus());
    });
    return vec4(sum, transmission);
  })(), null, null, { resolutionScale: .5, depthBuffer: false });
  // Four depth-aware taps retain a crisp hedge silhouette against distant haze.
  const output = Fn(() => {
    const size = vec2(textureSize(volume)), pixel = screenUV.mul(size).sub(.5), base = pixel.floor(), fraction = pixel.fract();
    const distance = getViewPosition(screenUV, depth.r, inverseProjection).length();
    const result = vec4(0).toVar(), total = float(0).toVar();
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const uv = base.add(vec2(x + .5, y + .5)).div(size);
      const d = getViewPosition(uv, depth.sample(uv).r, inverseProjection).length();
      const weight = (x ? fraction.x : fraction.x.oneMinus()).mul(y ? fraction.y : fraction.y.oneMinus()).mul(d.sub(distance).abs().mul(-1.4).exp().max(.0001));
      result.addAssign(volume.sample(uv).mul(weight)); total.addAssign(weight);
    }
    return result.div(total);
  })();
  return { output, volume, time, density, lightStrength, air, dispose() { volume.dispose(); } };
}
