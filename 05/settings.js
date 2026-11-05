import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

export function createSettings(reducedMotion = false) {
  return {
    pause: reducedMotion,
    autoOrbit: true, breeze: .35, wetness: .3, translucency: .75,
    density: 1, sporophytes: false, exposure: 1.15, saturation: .95,
    gradeStrength: .85, gradeContrast: 1.2, gradeShadows: .65, gradeHighlights: .5,
    quality: 1, msaa: true, ambientOcclusion: false, depthOfField: true, depthRange: 7, aperture: 22,
    fireflies: true, fireflyBrightness: 1, fireflyLighting: true,
    backgroundLight: true, backgroundLightBrightness: 1,
    sunAzimuth: -55, sunHeight: 10, lod: 2, meshlets: false
  };
}

export function createSettingsPanel(settings, {
  garden, habitat, changed, resetView, updateSun, updateEnvironment, setMSAA, setAmbientOcclusion, resize, pause
}) {
  const gui = new GUI({ title: 'Settings', width: 244 });
  const mossFolder = gui.addFolder('Moss');
  mossFolder.add(settings, 'wetness', 0, 1, .01).name('Moisture');
  mossFolder.add(settings, 'translucency', 0, 1, .01).name('Leaf translucency');
  mossFolder.add(settings, 'breeze', 0, 1.5, .01).name('Breeze');
  mossFolder.add(settings, 'sporophytes').name('Spore capsules').onChange(value => garden.setSporophytes(value));
  mossFolder.add(settings, 'density', { 'Bare stone': 0, Sparse: .35, Dense: .65, Full: 1 }).name('Density').onChange(value => garden.setDensity(value));
  const lens = gui.addFolder('Camera');
  lens.add(settings, 'autoOrbit').name('Auto orbit').listen();
  lens.add(settings, 'depthOfField').name('Depth of field');
  lens.add(settings, 'depthRange', .5, 16, .1).name('Blur transition');
  lens.add(settings, 'aperture', 0, 40, .5).name('Background blur');
  lens.add({ resetView }, 'resetView').name('Reset view');
  const light = gui.addFolder('Light');
  light.add(settings, 'sunAzimuth', -180, 180, 1).name('Sky azimuth').onChange(updateSun).onFinishChange(updateEnvironment);
  light.add(settings, 'sunHeight', -8, 85, .1).name('Sun elevation').onChange(updateSun).onFinishChange(updateEnvironment);
  light.add(habitat.sun.shadow, 'radius', 1, 40, 1).name('Shadow softness');
  light.add(settings, 'exposure', .4, 2, .01).name('Exposure');
  light.add(settings, 'backgroundLight').name('Drifting light');
  light.add(settings, 'backgroundLightBrightness', 0, 2, .05).name('Drifting light strength');
  const grading = gui.addFolder('Color grade');
  grading.add(settings, 'gradeStrength', 0, 1, .01).name('Strength');
  grading.add(settings, 'saturation', .5, 1.5, .01).name('Saturation');
  grading.add(settings, 'gradeContrast', .85, 1.2, .01).name('Contrast');
  grading.add(settings, 'gradeShadows', 0, 1, .01).name('Cool shadows');
  grading.add(settings, 'gradeHighlights', 0, 1, .01).name('Warm highlights');
  const insects = gui.addFolder('Fireflies');
  insects.add(settings, 'fireflies').name('Visible');
  insects.add(settings, 'fireflyBrightness', 0, 3, .05).name('Glow');
  insects.add(settings, 'fireflyLighting').name('Illuminate rocks');
  const rendering = gui.addFolder('Rendering');
  rendering.add(settings, 'msaa', { '4× MSAA': true, 'FXAA only': false }).name('Antialiasing').onChange(setMSAA);
  rendering.add(settings, 'ambientOcclusion').name('Ambient occlusion').onChange(setAmbientOcclusion);
  rendering.add(settings, 'quality', { '50%': .5, '75%': .75, '100%': 1, '125%': 1.25, '150%': 1.5 }).name('Resolution').onChange(resize);
  rendering.add(settings, 'lod', .1, 3, .1).name('Max LOD error (px)');
  rendering.add(settings, 'meshlets').name('Show meshlets');
  rendering.add(settings, 'pause').name('Pause').listen().onChange(pause);
  gui.onChange(changed);
  gui.close();
  return gui;
}
