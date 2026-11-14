import GUI from 'three/addons/libs/lil-gui.module.min.js';

export function createSettings(reduced = false) {
  return { paused: reduced, speed: 2.4, walkSpeed: 2, height: 1.48, fog: 1, lights: 1, moon: 1, snowfall: .65, exposure: .86, bloom: .3, resolution: 0, map: false, meshlets: false, music: true, volume: .55 };
}
export function createSettingsPanel(settings, actions) {
  const gui = new GUI({ title: 'Settings', width: 238 });
  gui.add(settings, 'paused').name('Pause').listen();
  gui.add(settings, 'speed', .5, 5, .1).name('Flight speed');
  gui.add(settings, 'walkSpeed', .5, 4, .1).name('Walking speed');
  gui.add(settings, 'height', .7, 2.6, .01).name('Camera height');
  gui.add(settings, 'map').name('Maze plan').listen().onChange(actions.map);
  gui.add(actions, 'restartFlight').name('Restart flight');
  const sound = gui.addFolder('Sound');
  sound.add(settings, 'music').name('Music').listen().onChange(actions.sound);
  sound.add(settings, 'volume', 0, 1, .01).name('Volume').listen().onChange(actions.sound);
  sound.close();
  const light = gui.addFolder('Winter night');
  light.add(settings, 'fog', 0, 2.5, .01).name('Fog');
  light.add(settings, 'lights', 0, 2.5, .01).name('Blue floodlights');
  light.add(settings, 'moon', 0, 2, .01).name('Moonlight');
  light.add(settings, 'snowfall', 0, 2, .01).name('Blowing snow');
  light.add(settings, 'exposure', .4, 2, .01).name('Exposure');
  light.add(settings, 'bloom', 0, 1, .01).name('Halation');
  light.close();
  const rendering = gui.addFolder('Rendering');
  rendering.add(settings, 'resolution', { 'Auto': 0, 'Device DPR': -1, '1×': 1, '1.5×': 1.5, '2×': 2 }).name('Resolution').onChange(actions.resize);
  rendering.add(settings, 'meshlets').name('Show meshlets'); rendering.close();
  gui.onChange(actions.changed); gui.close(); return gui;
}
