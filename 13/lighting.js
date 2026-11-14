import { Group, PointLight, HemisphereLight, DirectionalLight, Color, Mesh, BoxGeometry, MeshStandardNodeMaterial, MeshBasicNodeMaterial, DataTexture, DataUtils, RGBAFormat, HalfFloatType, LinearFilter, Vector3 } from 'three/webgpu';
import { WIDTH, DEPTH, world, grid, occupied } from './maze.js';
import { randomSeed } from './random.js';

export function createLighting(scene, maze, journey) {
  const group = new Group(); group.name = 'Blue maze floodlights';
  const lamps = [], points = [], random = randomSeed(13131), p = new Vector3(), next = new Vector3();
  const casing = new MeshStandardNodeMaterial({ color: '#0a121b', roughness: .8, metalness: .5 });
  const glass = new MeshBasicNodeMaterial({ color: new Color(2.6, 5.4, 9) });
  const housingGeometry = new BoxGeometry(.23, .11, .16), glassGeometry = new BoxGeometry(.19, .075, .01), baseGeometry = new BoxGeometry(.24, .05, .23);
  function placeLamp(d, minimumSpacing) {
    journey.at(d, p); journey.at(d + .2, next);
    const spacing = minimumSpacing ?? (Math.abs(p.x) < 10 && Math.abs(p.z) < 30 ? 6.5 : 10);
    if (points.some(q => q.distanceToSquared(p) < spacing * spacing)) return;
    const forward = next.clone().sub(p).normalize(), side = new Vector3(-forward.z, 0, forward.x).multiplyScalar(random() < .5 ? 1 : -1);
    let offset = .35;
    while (offset < 2 && maze.clearance(p.x + side.x * offset, p.z + side.z * offset) > .52) offset += .12;
    const position = p.clone().addScaledVector(side, Math.max(.3, offset - .2));
    position.y = maze.height(position.x, position.z) + .075;
    const light = new PointLight('#6294ff', 5 + random() * 3, 11, 2);
    light.position.copy(position).addScaledVector(side, -.12); light.position.y += .18;
    light.name = `Blue floodlight ${lamps.length + 1}`;
    const housing = new Mesh(housingGeometry, casing); housing.position.copy(position);
    housing.rotation.set(-.45, Math.atan2(-side.x, -side.z), 0, 'YXZ');
    const pane = new Mesh(glassGeometry, glass); pane.position.set(0, 0, .085); housing.add(pane);
    const base = new Mesh(baseGeometry, casing); base.position.copy(position); base.position.y -= .055;
    group.add(light, housing, base); lamps.push({ light, housing, power: light.intensity }); points.push(p.clone());
  }
  // Give the first three approach corridors their own visible blue pools of
  // light, independent of the regular spacing around the rest of the circuit.
  const approach = journey.track.segments.filter(segment => !segment.control && segment.start >= journey.opening - 1e-6).slice(0, 3);
  for (const segment of approach) placeLamp(segment.start + segment.length * .65, 3);
  for (let d = 10; d < journey.length; d += 12 + random() * 7) placeLamp(d);
  const ambient = new HemisphereLight('#87a9e4', '#26344b', .22);
  const moon = new DirectionalLight('#9cb8eb', .12); moon.position.set(-20, 35, -15);
  scene.add(group, ambient, moon);
  // A baked, hedge-occluded irradiance field drives the depth-limited fog.
  // The real lamps still illuminate surfaces through ClusteredLighting.
  const data = new Float32Array(WIDTH * DEPTH * 4);
  const visible = (x, z, light) => {
    const dx = light.x - x, dz = light.z - z, steps = Math.ceil(Math.hypot(dx, dz) / .3);
    for (let i = 1; i < steps; i++) { const [gx, gz] = grid(x + dx * i / steps, z + dz * i / steps); if (occupied(Math.round(gx), Math.round(gz))) return false; }
    return true;
  };
  for (let z = 0; z < DEPTH; z++) for (let x = 0; x < WIDTH; x++) {
    const i = (z * WIDTH + x) * 4, [wx, wz] = world(x, z);
    if (occupied(x, z)) continue;
    let value = 0;
    for (const { light, power } of lamps) {
      const dx = wx - light.position.x, dz = wz - light.position.z, d2 = dx * dx + dz * dz;
      if (d2 > 20 * 20) continue;
      if (visible(wx, wz, light.position)) value += power / (d2 + 2.2) * Math.exp(-Math.sqrt(d2) * .035);
    }
    data[i] = value * .24; data[i + 1] = value * .49; data[i + 2] = value; data[i + 3] = 1;
  }
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) half[i] = DataUtils.toHalfFloat(data[i]);
  const field = new DataTexture(half, WIDTH, DEPTH, RGBAFormat, HalfFloatType); field.minFilter = field.magFilter = LinearFilter; field.needsUpdate = true;
  function update(settings) {
    for (const lamp of lamps) lamp.light.intensity = lamp.power * settings.lights;
    ambient.intensity = .22 * settings.moon; moon.intensity = .12 * settings.moon;
  }
  return { group, lamps, ambient, moon, field, update,
    dispose() { scene.remove(group, ambient, moon); housingGeometry.dispose(); glassGeometry.dispose(); baseGeometry.dispose(); casing.dispose(); glass.dispose(); field.dispose(); for (const { light } of lamps) light.dispose(); } };
}
