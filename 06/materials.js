import * as THREE from "three/webgpu";
import { color, mix, positionLocal, uniform } from "three/tsl";
import { agedMetal, turnedBronze, travertine } from "./surface-materials.js";

export function createMaterials() {
  const metalRoughness = uniform(0.29),
    sunGlow = uniform(3.2);
  const brass = agedMetal("#dfb57a", 0.29);
  const brassVariation = brass.roughnessNode;
  brass.roughnessNode = brassVariation.add(metalRoughness.sub(0.29));
  const darkMetal = agedMetal("#5d5044", 0.36);
  const base = turnedBronze();
  const pole = turnedBronze(true);
  darkMetal.metalness = 0.82;
  const dial = travertine({ roughness: 0.17, scale: 1.4 });
  const ivory = new THREE.MeshPhysicalNodeMaterial({
    color: "#e9dcc3",
    roughness: 0.25,
    clearcoat: 0.2,
    clearcoatRoughness: 0.2,
  });
  const sun = new THREE.MeshPhysicalNodeMaterial({
    color: "#ffe4ac",
    roughness: 0.24,
    clearcoat: 0.2,
    clearcoatRoughness: 0.15,
  });
  sun.emissiveNode = mix(
    color("#ffb346"),
    color("#ffe7b7"),
    positionLocal.y.add(0.7).div(1.4).clamp(),
  ).mul(sunGlow);
  // Palette materials supply tint before the shared glass material is attached.
  const planets = ["#efbd66", "#2448ba", "#df744c", "#9dbd8b", "#9cc9d3"].map(
    (color) => new THREE.MeshPhysicalNodeMaterial({ color }),
  );
  for (const [name, material] of Object.entries({
    "Brass fittings": brass,
    "Dark bronze hoop": darkMetal,
    "Bronze base": base,
    "Brushed bronze pole": pole,
    "Stone dial": dial,
    "Ivory rings and moons": ivory,
    "Opal sun": sun,
  }))
    material.name = name;
  const all = [brass, darkMetal, base, pole, dial, ivory, sun, ...planets];
  return {
    brass,
    darkMetal,
    base,
    pole,
    dial,
    ivory,
    sun,
    planets,
    metalRoughness,
    sunGlow,
    dispose() {
      all.forEach((m) => m.dispose());
    },
  };
}
