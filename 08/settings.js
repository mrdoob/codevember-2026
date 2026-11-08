import GUI from "three/addons/libs/lil-gui.module.min.js";
import { COLOR_MODES } from "./neon-pattern.js";
import {
  MIN_PERSPECTIVE,
  MAX_PERSPECTIVE,
  DEFAULT_TUBE_RADIUS,
  MAX_TUBE_RADIUS,
} from "./sculpture.js";

export function createSettings(pixelRatio) {
  return {
    speed: 2,
    motion: "Inside out",
    perspective: 3.6,
    autoOrbit: true,
    orbitSpeed: 0.5,
    color: "Multicolor",
    power: 45,
    radius: DEFAULT_TUBE_RADIUS,
    illumination: true,
    flicker: 0,
    blinking: true,
    blinkSpeed: 8,
    floorRoughness: 0.15,
    floorRoughnessMax: 0.6,
    floorTextureLow: 0.15,
    floorTextureHigh: 1,
    bloom: 0.05,
    glowRadius: 0.5,
    particles: true,
    particleBrightness: 16,
    particleSize: 0.012,
    airSpeed: 3,
    airTurbulence: 2,
    ceilingShadows: true,
    shadowSpeed: 2,
    shadowSoftness: 6,
    columnShadows: true,
    columnShadowStrength: 1,
    columnShadowSoftness: 1.8,
    exposure: 0.6,
    contrast: 1.04,
    saturation: 0.85,
    resolution: Math.min(pixelRatio, 1.5),
  };
}
export function createSettingsPanel(settings, actions) {
  const gui = new GUI({ title: "Settings", width: 240 });
  const motion = gui.addFolder("Fourth dimension");
  motion.add(settings, "speed", 0.1, 2, 0.05).name("Speed");
  motion
    .add(settings, "motion", {
      "Multi-axis poses": "Multi-axis poses",
      "Coupled rotation": "Coupled rotation",
      "Double rotation": "Double rotation",
      "Inside out": "Inside out",
    })
    .name("Rotation");
  motion
    .add(settings, "perspective", MIN_PERSPECTIVE, MAX_PERSPECTIVE, 0.05)
    .name("4D perspective");
  motion.add(actions, "turn").name("Turn a quarter");
  const camera = gui.addFolder("Camera");
  camera.add(settings, "autoOrbit").name("Auto orbit");
  camera.add(settings, "orbitSpeed", 0.1, 2, 0.05).name("Orbit speed");
  camera.close();
  const neon = gui.addFolder("Neon tubes");
  neon.add(settings, "color", COLOR_MODES).name("Color");
  neon.add(settings, "power", 5, 160, 1).name("Radiance");
  neon
    .add(settings, "radius", 0.004, MAX_TUBE_RADIUS, 0.0005)
    .name("Tube radius");
  neon.add(settings, "illumination").name("Light the room");
  neon.add(settings, "blinking").name("Blink during moves");
  neon.add(settings, "blinkSpeed", 0.25, 8, 0.05).name("Blink speed");
  neon.add(settings, "flicker", 0, 1, 0.05).name("Electrical shimmer");
  const rendering = gui.addFolder("Rendering");
  const floor = rendering.addFolder("Floor");
  const minimum = floor
    .add(settings, "floorRoughness", 0.05, 0.95, 0.01)
    .name("Min roughness")
    .onChange((value) => {
      if (value > settings.floorRoughnessMax) {
        settings.floorRoughnessMax = value;
        maximum.updateDisplay();
      }
    });
  const maximum = floor
    .add(settings, "floorRoughnessMax", 0.05, 0.95, 0.01)
    .name("Max roughness")
    .onChange((value) => {
      if (value < settings.floorRoughness) {
        settings.floorRoughness = value;
        minimum.updateDisplay();
      }
    });
  const textureLow = floor
    .add(settings, "floorTextureLow", 0, 0.99, 0.01)
    .name("Texture low")
    .onChange((value) => {
      if (value >= settings.floorTextureHigh) {
        settings.floorTextureHigh = value + 0.01;
        textureHigh.updateDisplay();
      }
    });
  const textureHigh = floor
    .add(settings, "floorTextureHigh", 0.01, 1, 0.01)
    .name("Texture high")
    .onChange((value) => {
      if (value <= settings.floorTextureLow) {
        settings.floorTextureLow = value - 0.01;
        textureLow.updateDisplay();
      }
    });
  floor.add(settings, "columnShadows").name("Column shadows");
  floor
    .add(settings, "columnShadowStrength", 0, 1, 0.01)
    .name("Shadow strength");
  floor
    .add(settings, "columnShadowSoftness", 0.2, 4, 0.1)
    .name("Shadow softness");
  const atmosphere = gui.addFolder("Atmosphere");
  atmosphere.add(settings, "bloom", 0, 1.2, 0.01).name("Bloom");
  atmosphere.add(settings, "glowRadius", 0, 1, 0.01).name("Glow spread");
  atmosphere.add(settings, "particles").name("Floating particles");
  atmosphere
    .add(settings, "particleBrightness", 0, 16, 0.5)
    .name("Particle brightness");
  atmosphere
    .add(settings, "particleSize", 0.0003, 0.012, 0.0001)
    .name("Grain size");
  atmosphere.add(settings, "airSpeed", 0, 3, 0.1).name("Air speed");
  atmosphere.add(settings, "airTurbulence", 0, 2, 0.05).name("Air turbulence");
  atmosphere.add(settings, "ceilingShadows").name("Ceiling shadows");
  atmosphere.add(settings, "shadowSpeed", 0, 4, 0.1).name("Shadow movement");
  atmosphere
    .add(settings, "shadowSoftness", 1, 12, 0.5)
    .name("Shadow softness");
  atmosphere.close();
  rendering.add(settings, "exposure", 0.3, 1.6, 0.01).name("Exposure");
  rendering.add(settings, "contrast", 0.85, 1.2, 0.01).name("Contrast");
  rendering
    .add(settings, "resolution", { "1×": 1, "1.5×": 1.5, "2×": 2 })
    .onChange(actions.resize);
  rendering.close();
  gui.add(actions, "pause").name("Play / pause");
  gui.add(actions, "reset").name("Restart");
  gui.onChange(actions.changed);
  gui.close();
  return gui;
}
