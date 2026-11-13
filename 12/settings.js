import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { CAMERA } from './scene-constants.js';

export function createSettings(reduced = false) {
  return { breeze: 1, speed: 1, fallSpeed: 1, autoOrbit: true, orbitSpeed: 6, paused: reduced, exposure: 1.05, sunlight: 1, scattering: 1, aperture: 3.2, environmentBlur: true, focus: CAMERA.radius, bloom: .16, saturation: 1.08, resolution: 0 };
}
export function createSettingsPanel(settings, actions) {
  const gui = new GUI({ title: 'Settings', width: 238 });
  gui.add(settings, 'breeze', 0, 2, .01).name('Breeze');
  gui.add(settings, 'speed', .1, 2, .05).name('Time');
  gui.add(settings, 'fallSpeed', .2, 2, .05).name('Fall speed');
  gui.add(settings, 'autoOrbit').name('Auto orbit');
  gui.add(settings, 'orbitSpeed', 0, 12, .1).name('Orbit speed (°/s)');
  gui.add(settings, 'paused').name('Pause').listen();
  gui.add(actions, 'gust').name('A passing gust');
  gui.add(actions, 'reset').name('Start again');
  const lens = gui.addFolder('Light & lens');
  lens.add(settings, 'sunlight', .2, 2, .01).name('Backlight');
  lens.add(settings, 'scattering', 0, 2, .01).name('Subsurface');
  lens.add(settings, 'exposure', .5, 1.8, .01).name('Exposure');
  lens.add(settings, 'focus', .1, 30, .1).name('Focus distance').listen();
  lens.add(settings, 'aperture', 0, 5, .1).name('Depth of field');
  lens.add(settings, 'environmentBlur').name('Environment blur').listen();
  lens.add(settings, 'bloom', 0, .5, .01).name('Glow');
  lens.add(settings, 'saturation', 0, 1.5, .01).name('Saturation');
  lens.add(settings, 'resolution', { 'Device DPR': 0, '1×': 1, '1.5×': 1.5, '2×': 2 }).name('Resolution').onChange(actions.resize);
  lens.close(); gui.close();
  gui.onChange(actions.changed);
  return gui;
}
