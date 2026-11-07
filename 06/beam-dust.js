import * as THREE from "three/webgpu";
import { lightCones } from "./light-shafts.js";
import {
  Fn,
  If,
  attribute,
  cameraWorldMatrix,
  getViewPosition,
  mix,
  pass,
  positionGeometry,
  positionView,
  screenUV,
  uniform,
  uv,
  varyingProperty,
  vec3,
  vec4,
} from "three/tsl";

export function createBeamDust(depth, camera, caustics, time) {
  const scene = new THREE.Scene();
  const cones = lightCones(caustics);
  const count = cones.reduce((sum, cone) => sum + cone.particles, 0);
  let state = 9123;
  const random = () =>
    (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const seeds = new Float32Array(count * 4);
  let offset = 0;
  cones.forEach((cone, index) => {
    for (let i = 0; i < cone.particles; i++)
      seeds.set([random(), random(), random(), index], offset++ * 4);
  });
  const geometry = new THREE.PlaneGeometry(1, 1);
  geometry.setAttribute(
    "dustSeed",
    new THREE.InstancedBufferAttribute(seeds, 4),
  );
  const seed = attribute("dustSeed", "vec4");
  const tint = varyingProperty("vec3", "dustTint");
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  material.positionNode = Fn(() => {
    const p = vec3(0).toVar();
    for (let i = 0; i < cones.length; i++) {
      const b = cones[i];
      If(seed.w.equal(i), () => {
        const phase = seed.x.mul(Math.PI * 2).add(time.mul(0.025));
        const drift = time.mul(0.12).add(seed.x.mul(19)).sin().mul(0.012);
        const along = seed.y.add(drift).clamp(0.04, 0.96).mul(b.length);
        const spread = b.baseRadius.add(b.slope.mul(along));
        p.assign(b.centre.add(b.direction.mul(along)));
        tint.assign(
          mix(
            b.tint.div(b.tint.r.max(b.tint.g).max(b.tint.b).max(0.1)),
            vec3(1, 0.95, 0.85),
            0.08,
          ),
        );
        const radius = seed.z.sqrt().mul(spread).mul(0.7);
        p.addAssign(
          b.u.mul(phase.cos()).add(b.v.mul(phase.sin())).mul(radius),
        );
      });
    }
    const size = seed.x.mul(0.032).add(0.018);
    const billboard = cameraWorldMatrix.mul(
      vec4(positionGeometry.xy.mul(size), 0, 0),
    ).xyz;
    return p.add(billboard);
  })();
  const inverseProjection = uniform(camera.projectionMatrixInverse);
  const surface = getViewPosition(
    screenUV,
    depth.sample(screenUV).r,
    inverseProjection,
  );
  const visible = positionView.z.sub(surface.z).smoothstep(0.01, 0.12);
  const r = uv().sub(0.5).length().mul(2);
  const sprite = r
    .pow2()
    .mul(-22)
    .exp()
    .add(r.pow2().mul(-5).exp().mul(0.12))
    .mul(r.smoothstep(0.7, 1).oneMinus());
  const glint = time.mul(0.8).add(seed.x.mul(31)).sin().mul(0.22).add(0.6);
  material.colorNode = tint.mul(2.2);
  material.opacityNode = sprite
    .mul(glint)
    .mul(visible)
    .mul(caustics.strength.mul(0.25).clamp());
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const node = pass(scene, camera, { samples: 0 });
  node.name = "Dust in the light";
  node.setResolutionScale(0.75);
  return {
    node: node.getTextureNode(),
    count,
    dispose() {
      node.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
