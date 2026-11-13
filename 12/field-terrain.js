import { Mesh, MeshStandardNodeMaterial, PlaneGeometry } from 'three/webgpu';
import { Fn, cameraPosition, color, mix, output, positionWorld, vec2, vec3, vec4 } from 'three/tsl';
import { CAMERA, GROUND_Y, WHEAT_OUTER_RADIUS } from './scene-constants.js';

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const FIELD_BASE_Y = -6, FIELD_RISE_START = 6, FIELD_RISE_END = 40;

export function fieldHeight(x, z) {
  const rise = smooth((Math.hypot(x, z) - 23) / (WHEAT_OUTER_RADIUS - 23)) * 3.8;
  return rise + Math.sin(x * .11 + z * .045) * .55 + Math.cos(z * .09 - x * .055) * .4;
}

// Continue the distant rolling field into a broad, shallow valley beneath the
// camera, instead of building a steep circular bank around the clearing.
export function terrainHeight(x, z) {
  const radius = Math.hypot(x, z);
  const rise = smooth((radius - FIELD_RISE_START) / (FIELD_RISE_END - FIELD_RISE_START));
  const field = FIELD_BASE_Y + (-1.5 + fieldHeight(x, z) - FIELD_BASE_Y) * rise;
  return GROUND_Y + (field - GROUND_Y) * (1 - smooth((radius - 65) / 20));
}

// The vertex wind uses the same soil surface to keep every root anchored,
// including sloping patches and the shorter plants near the camera.
export const terrainHeightNode = Fn(([p]) => {
  const radius = p.length();
  const rise = radius.smoothstep(23, WHEAT_OUTER_RADIUS).mul(3.8);
  const height = rise.add(p.x.mul(.11).add(p.y.mul(.045)).sin().mul(.55))
    .add(p.y.mul(.09).sub(p.x.mul(.055)).cos().mul(.4));
  const field = height.sub(1.5).sub(FIELD_BASE_Y)
    .mul(radius.smoothstep(FIELD_RISE_START, FIELD_RISE_END)).add(FIELD_BASE_Y);
  return field.sub(GROUND_Y).mul(radius.smoothstep(65, 85).oneMinus()).add(GROUND_Y);
});

export function createFieldTerrain(scene) {
  const geometry = new PlaneGeometry(180, 180, 180, 180);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new MeshStandardNodeMaterial({ roughness: 1 });
  // A bed of broken straw continues between the modeled plants. Irregular
  // strands and broad patches avoid reading as smooth bands of exposed soil.
  const p = positionWorld.xz.mul(9.6), cell = p.floor(), local = p.fract().sub(.5);
  const seed = cell.dot(vec2(127.1, 311.7)).sin().mul(43758.5453).fract();
  const angle = seed.mul(Math.PI * 2);
  const along = local.x.mul(angle.cos()).add(local.y.mul(angle.sin()));
  const across = local.y.mul(angle.cos()).sub(local.x.mul(angle.sin()));
  const straw = across.abs().smoothstep(.025, .08).oneMinus().mul(along.abs().smoothstep(.2, .48).oneMinus());
  const patches = positionWorld.x.mul(.43).add(positionWorld.z.mul(.29)).sin()
    .mul(positionWorld.z.mul(.61).sub(positionWorld.x.mul(.17)).sin()).mul(.5).add(.5);
  material.colorNode = mix(mix(color('#995622'), color('#bd7b32'), patches), color('#dfab59'), straw.mul(.14));
  material.emissiveNode = vec3(.045, .018, .003).mul(patches.mul(.4).add(.6));
  const fade = cameraPosition.sub(positionWorld).length().smoothstep(CAMERA.far * .6, CAMERA.far * .85);
  material.outputNode = vec4(mix(output.rgb, scene.backgroundNode, fade), output.a);
  const mesh = new Mesh(geometry, material);
  mesh.name = 'Continuous field soil';
  scene.add(mesh);
  return { mesh, dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); } };
}
