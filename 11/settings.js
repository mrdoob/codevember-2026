import GUI from "three/addons/libs/lil-gui.module.min.js";

export function createSettings() {
  return {
    auto: false,
    speed: 1,
    orbitSpeed: 2.5,
    strength: 1,
    rust: 0.66,
    relief: 1,
    exposure: 1.7,
    environment: 0.5,
    keyLight: 2,
    fractureLight: 2,
    fogBlur: 1.2,
    dust: 0.25,
    vignette: 1.05,
    saturation: 1.25,
    temperature: 1,
    tint: -0.5,
    contrast: 1.3,
    lift: 0,
    shadows: "#ffffff",
    occlusion: 4,
    fog: 0.3,
    fogStart: 2.4,
    resolution: 0,
  };
}

export function createSettingsPanel(
  settings,
  { onChange, onResolutionChange },
) {
  const gui = new GUI({ title: "Settings", width: 238 });
  const sequence = gui.addFolder("Tension & fracture");
  sequence.add(settings, "speed", 0.2, 1.8, 0.05).name("Playback speed");
  sequence.add(settings, "strength", 0.6, 1.6, 0.05).name("Link strength");
  const view = gui.addFolder("Camera");
  view.add(settings, "orbitSpeed", 0, 8, 0.1).name("Orbit speed (°/s)");
  view.close();
  const material = gui.addFolder("Iron & oxide");
  material.add(settings, "rust", 0, 1, 0.01).name("Corrosion");
  material.add(settings, "relief", 0, 2, 0.05).name("Surface relief");
  material.close();
  const light = gui.addFolder("Light & water");
  light.add(settings, "environment", 0, 6, 0.05).name("Environment light");
  light.add(settings, "keyLight", 0, 2, 0.05).name("Shadow key");
  light.add(settings, "fractureLight", 0, 4, 0.05).name("Fracture light");
  light.add(settings, "fogBlur", 0, 4, 0.1).name("Fog softness");
  light.add(settings, "dust", 0, 1, 0.05).name("Water particles");
  light.add(settings, "vignette", 0, 1.8, 0.05).name("Vignette");
  light.add(settings, "occlusion", 0, 4, 0.1).name("GTAO strength");
  light.add(settings, "fog", 0, 1, 0.005).name("Water fog");
  light.add(settings, "fogStart", 0, 6, 0.1).name("Fog start");
  light
    .add(settings, "resolution", { Auto: 0, "1×": 1, "1.5×": 1.5, "2×": 2 })
    .name("Resolution")
    .onChange(onResolutionChange);
  light.close();
  const grade = gui.addFolder("Color grading");
  grade.add(settings, "exposure", 0.4, 3, 0.05).name("Exposure");
  grade.add(settings, "temperature", -1, 1, 0.01).name("Temperature");
  grade.add(settings, "tint", -1, 1, 0.01).name("Tint");
  grade.add(settings, "contrast", 0.5, 1.6, 0.01).name("Contrast");
  grade.add(settings, "saturation", 0, 2, 0.05).name("Saturation");
  grade.add(settings, "lift", -0.1, 0.1, 0.005).name("Black level");
  grade.addColor(settings, "shadows").name("Shadow tint");
  grade.close();
  gui.close();
  gui.onChange(onChange);
  return gui;
}
