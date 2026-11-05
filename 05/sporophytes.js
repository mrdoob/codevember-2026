import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { randomSeed } from './random.js';

// A few mature sporophytes: a reddish seta and an inclined spore capsule.
// The leaf-bearing shoots remain the overwhelmingly dominant geometry.
export function createSporophyteGeometry(seed) {
  const random = randomSeed(seed), height = .19 + random() * .11;
  const bend = .025 + random() * .035;
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(), new THREE.Vector3(0, height * .5, 0),
    new THREE.Vector3(bend * .15, height, 0), new THREE.Vector3(bend, height, 0)
  );
  const stem = new THREE.TubeGeometry(curve, 12, .0011, 5, false);
  const capsule = new THREE.SphereGeometry(1, 10, 8);
  capsule.scale(.0065, .015, .0065);
  capsule.rotateZ(-.95);
  capsule.translate(bend + .010, height + .006, 0);
  const colorize = (geometry, hex) => {
    const color = new THREE.Color(hex), colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
    geometry.setAttribute('pigment', new THREE.BufferAttribute(colors, 3));
    geometry.deleteAttribute('uv');
  };
  colorize(stem, '#63351d'); colorize(capsule, '#98722b');
  const geometry = mergeGeometries([stem, capsule]);
  stem.dispose(); capsule.dispose();
  geometry.computeBoundingSphere();
  return geometry;
}
