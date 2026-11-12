import * as THREE from "three/webgpu";
import {
  Fn,
  vec3,
  vec4,
  color,
  mix,
  uv,
  attribute,
  uniform,
  texture,
  positionGeometry,
  positionView,
  normalViewGeometry,
  normalGeometry,
  mx_noise_float,
  mx_fractal_noise_float,
  mx_worley_noise_float,
} from "three/tsl";

// Surface-gradient bump mapping in scene units. The texture bump helper shifts
// UV lookups, so it cannot differentiate our procedural 3D grain. Screen-space
// height derivatives include both that grain and the corrosion front, while
// unnormalized position derivatives keep the relief consistent when zooming.
export function ironNormal(height) {
  return Fn(() => {
    const n = normalViewGeometry;
    const dx = positionView.dFdx(),
      dy = positionView.dFdy();
    const r1 = dy.cross(n),
      r2 = n.cross(dx);
    const determinant = dx.dot(r1);
    const inverse = determinant.sign().div(determinant.abs().max(1e-10));
    const gradient = r1
      .mul(height.dFdx())
      .add(r2.mul(height.dFdy()))
      .mul(inverse);
    return n.sub(gradient).normalize();
  })();
}

// Macro oxidation, eroded substrate, dense mineral grains and fine variation.
// Bake the cellular fields once so microscopic detail stays mip-filtered in motion.
export function bakeSurface(renderer) {
  const p = vec3(uv().mul(8), 3.71);
  const warp = vec3(
    mx_noise_float(p.mul(1.7)),
    mx_noise_float(p.mul(1.7).add(19)),
    mx_noise_float(p.mul(1.7).add(43)),
  );
  const clouds = mx_fractal_noise_float(p.add(warp.mul(0.6)), 5, 2, 0.52)
    .mul(0.72)
    .add(0.5)
    .clamp();
  const craters = mx_worley_noise_float(p.mul(13).add(warp.mul(1.6)), 1, 0)
    .smoothstep(0.12, 0.42)
    .oneMinus();
  const eroded = mx_fractal_noise_float(p.mul(8).add(warp), 4, 2, 0.56)
    .mul(0.4)
    .add(0.6);
  const pitting = eroded.sub(craters.mul(0.42)).clamp();
  const particles = mx_worley_noise_float(p.mul(68).add(warp.mul(2.3)), 1, 0);
  const grit = particles
    .smoothstep(0.04, 0.68)
    .oneMinus()
    .mul(mx_noise_float(p.mul(102)).mul(0.24).add(0.8))
    .clamp();
  const mineral = mx_fractal_noise_float(p.mul(26).add(17), 3, 2, 0.55)
    .mul(0.7)
    .add(0.5)
    .clamp();
  const target = new THREE.RenderTarget(2048, 2048, {
    depthBuffer: false,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    wrapS: THREE.MirroredRepeatWrapping,
    wrapT: THREE.MirroredRepeatWrapping,
  });
  target.texture.anisotropy = Math.min(8, renderer.getMaxAnisotropy());
  target.texture.name =
    "Oxidation, pitted substrate, mineral grains and granular variation";
  const material = new THREE.MeshBasicNodeMaterial();
  material.fragmentNode = vec4(clouds, pitting, grit, mineral);
  material.toneMapped = false;
  const quad = new THREE.QuadMesh(material),
    previous = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    quad.render(renderer);
  } finally {
    renderer.setRenderTarget(previous);
    material.dispose();
  }
  return target;
}

export function createCorrosion(
  surface,
  { reliefScale = 1, triplanar = false } = {},
) {
  const age = uniform(0.66),
    relief = uniform(1);
  // Geometry carries each mine's surface profile, so the shared materials and
  // GPU pipelines survive replacements. Slider endpoints remain clean/full rust.
  const profile = triplanar ? attribute("mineSurface", "vec2") : null;
  const corrosionAge = triplanar
    ? age.add(profile.x.mul(age.mul(age.oneMinus()).mul(4))).clamp()
    : age;
  const surfaceRelief = triplanar ? relief.mul(profile.y) : relief;
  const data = attribute("linkData", "vec2");
  const local = positionGeometry.toVarying("ironLocalPosition");
  const fieldUV = uv().mul(0.8).add(data.xy);
  const axes = normalGeometry.toVarying("ironLocalNormal").abs().pow(4);
  const weights = axes.div(axes.x.add(axes.y).add(axes.z).max(0.0001));
  const project = (scale, offset) => {
    // Fixed density in the shell's own coordinates; no spherical UV pole or
    // seam. Blend the packed color/height fields before deriving the normal.
    const p = local.mul(0.5);
    const sample = (plane) =>
      texture(surface.texture, plane.add(data.xy).mul(scale).add(offset));
    return sample(p.yz)
      .mul(weights.x)
      .add(sample(p.zx).mul(weights.y))
      .add(sample(p.xy).mul(weights.z));
  };
  const field = triplanar ? project(1, 0) : texture(surface.texture, fieldUV);
  const fine = triplanar
    ? project(2.73, 0.137)
    : texture(surface.texture, fieldUV.mul(2.73).add(0.137));
  const cap = attribute("fracture", "float");
  const depth = corrosionAge.sub(
    field.r.mul(0.82).add(fine.r.mul(0.09)).add(0.045),
  );
  // A soft oxidation front leaves weathered iron between deposits, without
  // the sharp, clean islands that make a corroded surface look painted.
  const rust = depth.smoothstep(-0.075, 0.09).mul(cap.oneMinus());
  const film = corrosionAge
    .smoothstep(0.04, 0.7)
    .mul(field.a.mul(0.25).add(0.7));
  const iron = mix(
    color("#303b3d"),
    color("#66655c"),
    field.a.mul(0.35).add(0.1),
  );
  const stainedIron = mix(iron, color("#493426"), film.mul(0.35));
  const variation = field.r
    .mul(0.5)
    .add(field.a.mul(0.35))
    .add(fine.a.mul(0.15));
  const oxide = mix(
    color("#30251e"),
    color("#76513b"),
    variation.smoothstep(0.3, 0.7),
  );
  const dryOxide = mix(
    oxide,
    color("#9b7a56"),
    fine.r.smoothstep(0.58, 0.8).mul(0.22),
  );
  const crystal = field.b
    .smoothstep(0.25, 0.6)
    .mul(fine.a.smoothstep(0.2, 0.7));
  const cavities = field.g.smoothstep(0.15, 0.56).mul(0.35).add(0.65);
  const surfaceColor = mix(stainedIron, dryOxide, rust)
    .mul(mix(1, cavities, rust))
    .mul(field.a.mul(0.28).add(0.83));
  const material = new THREE.MeshStandardNodeMaterial({
    name: "Granular oxide / pitted iron / fresh fracture",
  });
  material.colorNode = mix(
    mix(surfaceColor, color("#aaa598"), crystal.mul(rust).mul(0.16)),
    color("#a5aaa4"),
    cap,
  );
  material.metalnessNode = mix(
    mix(film.mul(-0.28).add(0.96), crystal.mul(0.3).add(0.055), rust),
    0.96,
    cap,
  );
  material.roughnessNode = mix(
    mix(
      field.a.mul(0.13).add(0.25),
      field.a.mul(0.12).add(0.65).sub(crystal.mul(0.32)),
      rust,
    ),
    0.38,
    cap,
  );
  material.aoNode = mix(1, cavities, rust.mul(0.65));
  // Relief exists at three scales: corrosion pits, individual oxide grains,
  // and finer grit. Exposed iron shares the same eroded substrate.
  const substrate = field.g.mul(0.0032).mul(rust.mul(0.82).add(0.18));
  const grains = field.b
    .pow(1.3)
    .mul(0.00105)
    .add(fine.b.mul(0.00019))
    .mul(rust.mul(0.88).add(0.12));
  const crust = rust
    .mul(0.00065)
    .add(depth.smoothstep(0.06, 0.2).mul(field.r).mul(0.001));
  const hammering = mx_noise_float(local.mul(95).add(data.y))
    .mul(0.0005)
    .mul(rust.mul(0.85).add(0.15));
  material.normalNode = ironNormal(
    substrate
      .add(grains)
      .add(crust)
      .add(hammering)
      .mul(surfaceRelief)
      .mul(reliefScale)
      .mul(cap.oneMinus()),
  );
  return {
    material,
    age,
    relief,
    dispose() {
      material.dispose();
    },
  };
}
