import * as THREE from "three/webgpu";
import {
  Fn,
  color,
  float,
  hash,
  mix,
  normalLocal,
  output,
  positionLocal,
  screenCoordinate,
  texture,
  transformNormalToView,
  uniform,
  vec3,
  vec4,
} from "three/tsl";
import { liningColor } from "./journey.js";

function noise(x, y) {
  let h = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function makeTexture(size, sample) {
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      data[y * size + x] = Math.round(
        THREE.MathUtils.clamp(sample(x, y), 0, 1) * 255,
      );
  return textureFromData(size, data);
}

function textureFromData(size, data) {
  const map = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.anisotropy = 2;
  map.needsUpdate = true;
  return map;
}

function softNoise(x, y, cells) {
  const u = (x / 512) * cells,
    v = (y / 512) * cells;
  const ix = Math.floor(u),
    iy = Math.floor(v);
  const fx = u - ix,
    fy = v - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  const value = (dx, dy) =>
    noise((ix + dx) % cells, ((iy + dy) % cells) + 1709);
  const a = value(0, 0) * (1 - sx) + value(1, 0) * sx;
  const b = value(0, 1) * (1 - sx) + value(1, 1) * sx;
  return a * (1 - sy) + b * sy;
}

function bakeGradients(map) {
  const size = map.image.width,
    height = map.image.data;
  const data = new Uint8Array(size * size * 4);
  const sample = (x, y) =>
    height[((y + size) % size) * size + ((x + size) % size)] / 255;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (sample(x + 1, y) - sample(x - 1, y)) * 0.5;
      const dy = (sample(x, y + 1) - sample(x, y - 1)) * 0.5;
      // Amplify small derivatives before packing to preserve fine surface detail.
      data[i] = Math.round(THREE.MathUtils.clamp(0.5 + dx * 2, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(0.5 + dy * 2, 0, 1) * 255);
      data[i + 2] = 128;
      data[i + 3] = height[y * size + x];
    }
  map.image.data = data;
  map.format = THREE.RGBAFormat;
  map.needsUpdate = true;
  return map;
}

// Bake the bump gradients once instead of resampling height derivatives for
// every fragment. Three projections supply height and stable surface relief.
function triplanarSurface(map, scale, depth, surfaceFlip) {
  const p = positionLocal.mul(surfaceFlip).mul(scale);
  const weight = normalLocal.abs().pow(6);
  const w = weight.div(weight.x.add(weight.y).add(weight.z).max(0.0001));
  const x = texture(map, p.zy).toVar(),
    y = texture(map, p.xz).toVar(),
    z = texture(map, p.xy).toVar();
  const gx = x.rg.sub(0.5).mul(0.5),
    gy = y.rg.sub(0.5).mul(0.5),
    gz = z.rg.sub(0.5).mul(0.5);
  const gradient = vec3(
    gy.x.mul(w.y).add(gz.x.mul(w.z)),
    gx.y.mul(w.x).add(gz.y.mul(w.z)),
    gx.x.mul(w.x).add(gy.y.mul(w.y)),
  )
    .mul(map.image.width * scale * depth)
    .mul(surfaceFlip);
  const tangentGradient = gradient.sub(
    normalLocal.mul(gradient.dot(normalLocal)),
  );
  return {
    height: x.a.mul(w.x).add(y.a.mul(w.y)).add(z.a.mul(w.z)),
    normal: transformNormalToView(normalLocal.sub(tangentGradient)).normalize(),
  };
}

export function createMaterials(background = color("#dce2eb")) {
  const fade = uniform(0).onObjectUpdate(
    ({ object }) => object.userData.fade ?? 0,
  );
  const probeCapture = uniform(0);
  function fadeMaterial(material) {
    // Tint the complete lit surface, including specular highlights. In local
    // probes also fade premultiplied coverage, smoothly revealing the studio.
    const coverage = fade.mul(probeCapture).oneMinus();
    material.outputNode = vec4(
      mix(output.rgb, background, fade).mul(coverage),
      output.a.mul(coverage),
    );
    material.castShadowNode = Fn(() => {
      hash(screenCoordinate.x.add(screenCoordinate.y.mul(4096)))
        .lessThan(fade)
        .discard();
      return vec4(0, 0, 0, 1);
    })();
    return material;
  }
  // A lower half is built by rotating the upper geometry 180 degrees. Undo
  // that rotation for texture lookup so closed and split surfaces share the
  // original object's coordinates, even while individual pieces rotate.
  const surfaceSign = uniform(1).onObjectUpdate(
    ({ object }) => object.userData.surfaceSign ?? 1,
  );
  const surfaceFlip = vec3(surfaceSign, surfaceSign, 1);
  // A fine, nondirectional satin finish. Several sizes of rounded grain
  // break up the highlight without etched lines or a machining direction.
  const metalGrain = bakeGradients(
    makeTexture(
      512,
      (x, y) =>
        0.14 +
        softNoise(x, y, 24) * 0.16 +
        softNoise(x, y, 64) * 0.32 +
        softNoise(x, y, 128) * 0.28 +
        noise(x, y) * 0.1,
    ),
  );
  const brushing = bakeGradients(
    makeTexture(
      512,
      (x, y) =>
        0.24 +
        noise(0, y) * 0.48 +
        noise(Math.floor(x / 128), y) * 0.18 +
        noise(x, y) * 0.1,
    ),
  );
  const roughness = uniform(0.46);
  const metalSurface = triplanarSurface(metalGrain, 2.8, 0.00022, surfaceFlip);
  const grain = metalSurface.height;
  // The same local-space collar appears on the closed solid and each half.
  // Fade all texture out of this narrow band beside the cut.
  const textured = positionLocal.y.abs().smoothstep(0.028, 0.04);
  const cleanNormal = transformNormalToView(normalLocal).normalize();
  function metal() {
    const material = new THREE.MeshPhysicalNodeMaterial({
      metalness: 1,
      roughness: 0.46,
    });
    // A literal conductor lets the shader remove unused diffuse lighting,
    // including the diffuse branch of the local reflection filter.
    material.metalnessNode = float(1);
    material.colorNode = mix(
      color("#aeb4bd"),
      color("#bdc2ca").mul(mix(0.985, 1.015, grain)),
      textured,
    );
    material.roughnessNode = mix(
      0.19,
      roughness.add(grain.sub(0.57).mul(0.14)).clamp(0.1, 0.82),
      textured,
    );
    material.normalNode = mix(
      cleanNormal,
      metalSurface.normal,
      textured,
    ).normalize();
    return fadeMaterial(material);
  }
  const liningSurface = triplanarSurface(metalGrain, 2.4, 0.00035, surfaceFlip);
  const brushSurface = triplanarSurface(brushing, 0.85, 0.00006, surfaceFlip);
  const grainLines = brushSurface.height;
  function setLiningColor(material, id) {
    const { h, s, l } = liningColor(id);
    material.color.setHSL(h, s, l, THREE.SRGBColorSpace);
  }
  // One independently colored lining per reusable shell slot. Updating the
  // uniforms avoids compiling or retaining a material for every new color.
  const linings = [];
  function lining() {
    const material = new THREE.MeshPhysicalNodeMaterial({
      roughness: 0.42,
      metalness: 1,
      anisotropy: 0.6,
      anisotropyRotation: Math.PI / 2,
    });
    material.metalnessNode = float(1);
    material.colorNode = uniform(material.color).mul(
      mix(0.95, 1.025, grainLines),
    );
    material.roughnessNode = float(0.42)
      .add(grainLines.sub(0.6).mul(0.16))
      .add(liningSurface.height.sub(0.57).mul(0.08))
      .clamp(0.3, 0.55);
    // Fine grain breaks up the directional reflection. The brushing adds
    // shallow machining lines, without the broad relief or sheen of cloth.
    material.normalNode = mix(
      liningSurface.normal,
      brushSurface.normal,
      0.12,
    ).normalize();
    setLiningColor(material, 0);
    linings.push(material);
    return fadeMaterial(material);
  }
  return {
    metal,
    lining,
    roughness,
    linings,
    setLiningColor,
    fadeMaterial,
    probeCapture,
    dispose() {
      metalGrain.dispose();
      brushing.dispose();
      linings.forEach((m) => m.dispose());
    },
  };
}
