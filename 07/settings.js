import GUI from "three/addons/libs/lil-gui.module.min.js";

export function createSettings(pixelRatio) {
  return {
    speed: 1,
    roughness: 0.46,
    exposure: 0.75,
    contrast: 1,
    saturation: 1,
    warmth: -1,
    tint: -1,
    orbit: true,
    cameraMotion: 1,
    reflections: true,
    depthOfField: true,
    lensBlur: 1,
    resolution: Math.min(pixelRatio, 1.5),
  };
}

export function createSettingsPanel(
  settings,
  actions,
  { changed, resize, refreshReflections },
) {
  const gui = new GUI({ title: "Settings", width: 240 });
  gui.add(settings, "speed", 0.2, 2, 0.05).name("Journey speed");
  gui.add(settings, "roughness", 0.12, 0.8, 0.01).name("Metal roughness");
  gui.add(settings, "orbit").name("Camera orbit");
  gui.add(settings, "cameraMotion", 0, 2, 0.05).name("Camera wander");
  gui
    .add(settings, "reflections")
    .name("Interior reflections")
    .onChange(refreshReflections);
  gui.add(settings, "depthOfField").name("Depth of field");
  gui.add(settings, "lensBlur", 0, 2, 0.05).name("Lens blur");
  gui
    .add(settings, "resolution", { "1×": 1, "1.5×": 1.5, "2×": 2 })
    .onChange(resize);

  const grading = gui.addFolder("Color grading");
  grading.add(settings, "exposure", 0.6, 1.6, 0.01).name("Exposure");
  grading.add(settings, "contrast", 0.6, 1.5, 0.01).name("Contrast");
  grading.add(settings, "saturation", 0, 1.6, 0.01).name("Saturation");
  grading.add(settings, "warmth", -1, 1, 0.01).name("Warmth");
  grading.add(settings, "tint", -1, 1, 0.01).name("Tint");
  grading.close();

  gui.add(actions, "pause").name("Play / pause");
  gui.add(actions, "next").name("Go deeper");
  gui.add(actions, "reset").name("Restart");
  gui.onChange(changed);
  gui.close();
  return gui;
}
