import * as THREE from "three/webgpu";
import {
  color,
  mix,
  positionLocal,
  positionWorld,
  normalLocal,
  normalWorld,
  vec3,
  vec4,
  uv,
  texture,
  mx_noise_float,
  mx_fractal_noise_float,
  mx_worley_noise_float,
  materialRoughness,
  bumpMap,
  Fn,
  If,
  float,
  atan,
  hash,
  smoothstep,
} from "three/tsl";

// The surface fields are authored in TSL, then evaluated once on the GPU.
// Runtime shading reads the cached colour/height fields, retaining the same
// physical roughness and bump response without re-running layered noise.
let atlases;
const span = 16;
const metalSpan = 4;
function stoneField(p) {
  const layers = mx_fractal_noise_float(
    p.mul(vec3(0.75, 4, 0.75)),
    3,
    2,
    0.5,
  );
  const cloudy = mx_noise_float(p.mul(4.5));
  const poreDomain = p.mul(12).add(mx_noise_float(p.mul(31)).mul(0.45));
  const pores = mx_worley_noise_float(poreDomain, 1, 0)
    .smoothstep(0.12, 0.38)
    .oneMinus()
    .mul(mx_noise_float(p.mul(3.2).add(7)).smoothstep(-0.15, 0.4));
  const fine = mx_noise_float(p.mul(115));
  const stone = mix(
    color("#bda18c"),
    color("#ebd5b9"),
    layers.mul(0.55).add(0.62).clamp(),
  );
  return {
    rgb: mix(
      stone.mul(cloudy.mul(0.055).add(1)),
      color("#80634a"),
      pores.mul(0.85),
    ),
    height: layers
      .mul(0.008)
      .add(cloudy.mul(0.002))
      .sub(pores.mul(0.025))
      .add(fine.mul(0.0009)),
  };
}
function plasterField(p) {
  const cloud = mx_fractal_noise_float(p.mul(0.75), 3, 2, 0.5),
    grain = mx_noise_float(p.mul(12));
  return {
    rgb: mix(
      color("#cab7a6"),
      color("#d8c5b3"),
      cloud.mul(0.2).add(0.52),
    ).mul(grain.mul(0.12).add(1)),
    height: cloud.mul(0.003).add(grain.mul(0.005)),
  };
}
function metalField(p) {
  const cloud = mx_fractal_noise_float(p.mul(3.6), 3, 2, 0.5);
  const grain = mx_noise_float(p.mul(vec3(3, 110, 3)));
  const scratches = mx_noise_float(p.mul(vec3(0.45, 85, 0.45))).smoothstep(
    0.3,
    0.62,
  );
  const wear = mx_noise_float(p.mul(vec3(65, 95, 65)))
    .smoothstep(0.12, 0.5)
    .mul(cloud.smoothstep(-0.3, 0.2));
  return {
    rgb: vec3(
      cloud.mul(0.5).add(0.5),
      grain.mul(0.5).add(0.5),
      wear.mul(0.3).add(scratches.mul(0.28)),
    ),
    height: grain.mul(0.001).add(cloud.mul(0.0005)).sub(wear.mul(0.0008)),
  };
}
export function prepareSurfaceTextures(renderer) {
  if (atlases) return atlases;
  function bake(field, size = 2048, heightScale = 16) {
    const target = new THREE.RenderTarget(size, size, {
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
    });
    target.texture.anisotropy = Math.min(8, renderer.getMaxAnisotropy());
    const material = new THREE.MeshBasicNodeMaterial();
    material.toneMapped = false;
    material.fragmentNode = vec4(
      field.rgb,
      field.height.mul(heightScale).add(0.5),
    );
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
  function tile(field, period = span) {
    const p = uv().sub(0.5).mul(period);
    const a = field(p),
      b = field(p.sub(vec3(period, 0, 0).xy));
    const c = field(p.sub(vec3(0, period, 0).xy)),
      d = field(p.sub(period));
    const blend = uv().smoothstep(0, 1);
    return {
      rgb: mix(
        mix(a.rgb, b.rgb, blend.x),
        mix(c.rgb, d.rgb, blend.x),
        blend.y,
      ),
      height: mix(
        mix(a.height, b.height, blend.x),
        mix(c.height, d.height, blend.x),
        blend.y,
      ),
    };
  }
  atlases = {
    top: bake(tile((p) => stoneField(vec3(p.x, 0, p.y)))),
    side: bake(tile((p) => stoneField(vec3(p.x, p.y, 0)))),
    wall: bake(tile((p) => plasterField(vec3(p.x, p.y, 0)))),
    metalTop: bake(
      tile((p) => metalField(vec3(p.x, 0, p.y)), metalSpan),
      1024,
      256,
    ),
    metalSide: bake(
      tile((p) => metalField(vec3(p.x, p.y, 0)), metalSpan),
      1024,
      256,
    ),
  };
  return atlases;
}
export function disposeSurfaceTextures() {
  if (!atlases) return;
  Object.values(atlases).forEach((t) => t.dispose());
  atlases = null;
}
function projected(
  top,
  side,
  p,
  period = span,
  projectionNormal = normalWorld,
) {
  const weight = projectionNormal.abs().pow(8),
    sum = weight.x.add(weight.y).add(weight.z);
  const xy = texture(side.texture, p.xy.div(period).add(0.5));
  const yz = texture(side.texture, p.zy.div(period).add(0.5));
  const xz = texture(top.texture, p.xz.div(period).add(0.5));
  return xy
    .mul(weight.z)
    .add(yz.mul(weight.x))
    .add(xz.mul(weight.y))
    .div(sum);
}
export function agedMetal(baseColor, roughness = 0.3) {
  const m = new THREE.MeshStandardNodeMaterial({
    color: baseColor,
    metalness: 0.88,
    roughness,
  });
  const p = positionLocal;
  // Bake the layered wear once, then let mip filtering resolve the fine grain.
  const field = atlases
    ? projected(
        atlases.metalTop,
        atlases.metalSide,
        p,
        metalSpan,
        normalLocal,
      )
    : null;
  const live = field ? null : metalField(p);
  const packed = field || live.rgb;
  const cloud = packed.r.sub(0.5).mul(2),
    grain = packed.g.sub(0.5).mul(2),
    wear = packed.b;
  m.colorNode = color(baseColor)
    .mul(cloud.mul(0.08).add(1))
    .add(color("#b99457").mul(wear));
  m.roughnessNode = materialRoughness
    .add(cloud.mul(0.025))
    .add(grain.mul(0.035))
    .sub(wear.mul(0.2))
    .clamp(0.12, 0.65);
  m.normalNode = bumpMap(field ? field.a.sub(0.5).div(256) : live.height);
  return m;
}
export function turnedBronze(vertical = false) {
  const m = new THREE.MeshStandardNodeMaterial({
    color: "#80705d",
    metalness: 1,
    roughness: 0.29,
  });
  m.name = vertical ? "Axial brushed bronze" : "Turned bronze";
  const p = positionLocal;
  const direction = vertical ? vec3(60, 0.65, 60) : vec3(0.5, 55, 0.5);
  const stroke = p.mul(direction);
  const resolved = stroke.fwidth().length().smoothstep(0.45, 1.5).oneMinus();
  const brushing = mx_noise_float(stroke).mul(resolved);
  const patina = mx_fractal_noise_float(p.mul(vec3(2, 3, 2)), 2, 2, 0.5);
  const bevel = normalLocal.y.abs().smoothstep(0.12, 0.75);
  // Fine hairline cuts, with a sharp groove profile instead of stretched
  // noise blobs. Cylindrical coordinates follow the turning of the metal.
  const radial = p.xz.length();
  const around = atan(p.z, p.x).mul(radial.max(0.01));
  const across = (vertical ? around : mix(p.y, radial, bevel))
    .add(32)
    .mul(120);
  const row = across.floor();
  const along = (vertical ? p.y : around)
    .add(32)
    .mul(0.3)
    .add(hash(row).mul(20));
  const seed = row.mul(1009).add(along.floor());
  const distance = across.fract().sub(hash(row.add(7)).mul(0.4).add(0.3));
  const width = hash(seed.add(13)).mul(0.07).add(0.13);
  const aa = across.fwidth().mul(0.5).max(0.012);
  const cut = smoothstep(
    width.negate().sub(aa),
    width.negate().add(aa),
    distance,
  ).sub(smoothstep(width.sub(aa), width.add(aa), distance));
  const halfLength = hash(seed.add(23)).mul(0.22).add(0.12);
  const ends = smoothstep(
    halfLength.sub(0.035),
    halfLength,
    along.fract().sub(0.5).abs(),
  ).oneMinus();
  const scratches = cut
    .mul(ends)
    .mul(hash(seed.add(31)).smoothstep(0.1, 0.2))
    .mul(across.fwidth().smoothstep(0.6, 1.8).oneMinus());
  m.colorNode = mix(color("#80705d"), color("#b09570"), bevel.mul(0.45))
    .mul(patina.mul(0.18).add(brushing.mul(0.04)).add(1))
    .add(color("#c3a47e").mul(scratches.mul(0.16)));
  m.roughnessNode = mix(0.29, 0.18, bevel)
    .add(patina.mul(0.045))
    .add(brushing.mul(0.025))
    .add(scratches.mul(0.07));
  m.normalNode = bumpMap(
    brushing.mul(0.0003).add(patina.mul(0.00045)).sub(scratches.mul(0.00045)),
  );
  return m;
}

export function travertine({
  roughness = 0.48,
  scale = 1,
  bumpStrength = 1,
} = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness, metalness: 0 });
  const p = positionWorld.mul(scale);
  // A live field also supports geometry-only inspection without a GPU.
  const field = atlases ? projected(atlases.top, atlases.side, p) : null;
  const live = field ? null : stoneField(p);
  const height = field ? field.a.sub(0.5).div(16) : live.height;
  // A small live grain layer retains crisp surface detail at close range.
  const grain = Fn(() => {
    const weight = p
      .fwidth()
      .length()
      .mul(125)
      .smoothstep(0.5, 1.5)
      .oneMinus();
    const detail = float(0).toVar();
    If(weight.greaterThan(0.01), () => {
      detail.assign(mx_noise_float(p.mul(125)).mul(weight));
    });
    return detail;
  })();
  m.colorNode = (field ? field.rgb : live.rgb).mul(grain.mul(0.045).add(1));
  m.roughnessNode = materialRoughness
    .sub(height.mul(3))
    .add(normalLocal.y.abs().oneMinus().mul(0.13))
    .clamp(0.15, 0.9);
  m.normalNode = bumpMap(height.add(grain.mul(0.0015)).mul(bumpStrength));
  return m;
}
export function plaster() {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const p = positionWorld.sub(vec3(0, 6, 0));
  const field = atlases ? projected(atlases.wall, atlases.wall, p) : null;
  const live = field ? null : plasterField(p);
  m.colorNode = field ? field.rgb : live.rgb;
  m.normalNode = bumpMap(field ? field.a.sub(0.5).div(16) : live.height);
  return m;
}
