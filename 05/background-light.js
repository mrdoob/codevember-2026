import { PointLight } from 'three/webgpu';
import { groundHeight } from './woodland.js';

export function createBackgroundLight() {
  const light = new PointLight('#b7d4ff', 14, 6.5, 2);
  light.name = 'Drifting woodland light';
  function update(time, enabled = true, brightness = 1) {
    const x = Math.sin(time * .085 + .4) * 4.7;
    const z = -6.5 + Math.cos(time * .063) * 1.6;
    light.position.set(x, groundHeight(x, z) + 1.8 + Math.sin(time * .11) * .3, z);
    light.visible = enabled;
    light.intensity = enabled ? 14 * brightness : 0;
  }
  update(0);
  return { light, update, dispose() { light.dispose(); } };
}
