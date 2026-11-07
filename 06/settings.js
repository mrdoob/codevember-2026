import { GUI } from "three/addons/libs/lil-gui.module.min.js";

export function createSettings(reducedMotion = false) {
  return {
    pause: reducedMotion,
    speed: 1,
    autoOrbit: !reducedMotion,
    cameraView: "Instrument",
    ssgi: true,
    ssr: true,
    compare: false,
    view: "Full scene",
    denoise: true,
    dof: true,
    dofBlur: 3,
    ior: 1.8,
    transmission: 1,
    absorption: 1.1,
    dispersion: 0.018,
    glassRoughness: 0.075,
    daylight: 1,
    giIntensity: 6,
    giRadius: 6,
    reflectionIntensity: 1,
    roughness: 0.29,
    sunGlow: 3.2,
    planetGlow: 0,
    caustics: 0.5,
    exposure: 1,
  };
}

export function createSettingsPanel(
  settings,
  { changed, pause, resetMechanism, setDaylight },
) {
  const gui = new GUI({ title: "Settings", width: 244 });
  const motion = gui.addFolder("Motion");
  motion.add(settings, "speed", -2, 2, 0.01).name("Time speed");
  motion.add(settings, "pause").name("Pause").listen().onChange(pause);
  motion.add({ resetMechanism }, "resetMechanism").name("Reset mechanism");

  const lighting = gui.addFolder("Lighting");
  lighting
    .add(settings, "daylight", 0, 1, 0.01)
    .name("Daylight")
    .listen()
    .onChange(setDaylight);
  lighting
    .add(settings, "sunGlow", 0, 20, 0.05)
    .name("Sun emission")
    .listen();
  lighting
    .add(settings, "planetGlow", 0, 16, 0.05)
    .name("Planet emission")
    .listen();
  lighting.add(settings, "caustics", 0, 2, 0.05).name("Caustic strength");
  lighting.add(settings, "exposure", 0.5, 1.6, 0.01).name("Exposure");
  lighting
    .add(settings, "roughness", 0.1, 0.65, 0.01)
    .name("Metal roughness");

  const effects = gui.addFolder("Screen space");
  effects.add(settings, "denoise").name("Denoise");
  effects.add(settings, "giIntensity", 0, 10, 0.1).name("Indirect light");
  effects.add(settings, "giRadius", 1, 12, 0.1).name("GI radius");
  effects
    .add(settings, "reflectionIntensity", 0, 2, 0.05)
    .name("Reflection strength");
  effects.add(settings, "dof").name("Depth of field");
  effects.add(settings, "dofBlur", 0, 6, 0.1).name("Background blur");
  effects
    .add(settings, "view", [
      "Full scene",
      "Indirect light",
      "Reflections",
      "Contact shading",
    ])
    .name("Render output");

  const glass = gui.addFolder("Glass");
  glass.add(settings, "ior", 1, 1.8, 0.01).name("IOR");
  glass.add(settings, "transmission", 0, 1, 0.01).name("Transmission");
  glass.add(settings, "absorption", 0, 3, 0.01).name("Colour density");
  glass.add(settings, "dispersion", 0, 0.08, 0.001).name("Dispersion");
  glass.add(settings, "glassRoughness", 0.02, 0.35, 0.01).name("Frosting");
  gui.onChange(changed);
  gui.close();
  return gui;
}
