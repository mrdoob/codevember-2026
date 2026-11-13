import { Vector3 } from 'three/webgpu';
import { color, screenUV, vec3, vec4, mix, cameraProjectionMatrixInverse, cameraWorldMatrix } from 'three/tsl';

// Shared by the world-space sunset and the light illuminating the fibers.
export const sunDirection = new Vector3(-.23, .16, -1).normalize();

export function createLandscape(scene) {
  const clip = vec4(screenUV.x.mul(2).sub(1), screenUV.y.mul(-2).add(1), 1, 1);
  const viewRay = cameraProjectionMatrixInverse.mul(clip).xyz;
  const ray = cameraWorldMatrix.mul(vec4(viewRay, 0)).xyz.normalize();
  const distance = ray.sub(vec3(sunDirection)).length();
  const halo = distance.div(.42).pow2().negate().exp();
  const sky = mix(color('#f6d395'), color('#c5c8c1'), ray.y.smoothstep(.02, .4));
  const litSky = sky.add(vec3(.3, .19, .055).mul(halo));
  const ridge = ray.x.mul(4).add(ray.z.mul(3)).sin().mul(.024)
    .add(ray.x.mul(13).sub(ray.z.mul(8)).sin().mul(.008)).add(.018);
  const horizon = ridge.sub(ray.y).smoothstep(-.01, .014);
  const hills = mix(color('#b17636'), color('#5d4030'), ray.y.negate().smoothstep(0, .22));
  const landscape = mix(litSky, hills, horizon);
  const disk = distance.div(.019).pow(4).negate().exp();
  const innerGlow = distance.div(.095).pow2().negate().exp();
  const background = landscape.add(vec3(3.8, 2.7, 1.4).mul(disk)).add(vec3(.6, .27, .055).mul(innerGlow));
  scene.backgroundNode = background;
  return { background };
}
