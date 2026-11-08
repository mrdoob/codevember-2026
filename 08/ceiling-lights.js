import { Color, SpotLight, Vector3 } from "three/webgpu";
import { CEILING_Y } from "./room-layout.js";

// Three broad, upward-facing proxy lights shade the ceiling. They provide
// moving colored shadows without adding shadow sampling to 32 LTC emitters.
export function createCeilingLights(scene, settings) {
  const lights = Array.from({ length: 3 }, () => {
    const light = new SpotLight(0xffffff, 60, 24, Math.PI * 0.43, 0.55, 2);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.camera.near = 0.2;
    light.shadow.camera.far = 24;
    light.shadow.bias = -0.0002;
    light.shadow.normalBias = 0.035;
    light.shadow.radius = settings.shadowSoftness;
    scene.add(light, light.target);
    return light;
  });
  const center = new Vector3(),
    mid = new Vector3(),
    tint = new Color();
  let emitters = [];
  return {
    lights,
    setEmitters(value) {
      emitters = value;
    },
    update(travel) {
      // Angular travel stops on each pose and eases through its transition.
      const t = travel * settings.shadowSpeed;
      for (let group = 0; group < 3; group++) {
        center.set(0, 0, 0);
        tint.setRGB(0, 0, 0);
        let weight = 0,
          energy = 0,
          count = 0;
        for (let i = group; i < emitters.length; i += 3) {
          const source = emitters[i];
          mid.copy(source.start).add(source.end).multiplyScalar(0.5);
          const w = source.intensity * Math.max(0.1, mid.y + 1);
          center.addScaledVector(mid, w);
          weight += w;
          energy += source.intensity;
          count++;
          tint.r += source.color.r * source.intensity;
          tint.g += source.color.g * source.intensity;
          tint.b += source.color.b * source.intensity;
        }
        center.divideScalar(Math.max(weight, 0.001));
        const light = lights[group],
          phase = (group * Math.PI * 2) / 3;
        light.position.set(
          center.x * 0.35 + Math.sin(t * 0.8 + phase) * 2.4,
          2.1 + Math.sin(t * 0.51 + phase) * 0.35,
          center.z * 0.35 + Math.cos(t * 0.65 + phase) * 2.4,
        );
        light.target.position.set(center.x * 0.25, CEILING_Y, center.z * 0.25);
        light.color.copy(tint).multiplyScalar(1 / Math.max(energy, 0.001));
        light.intensity = (energy / Math.max(count, 1)) * 1.6;
        light.shadow.intensity = settings.ceilingShadows ? 1 : 0;
        light.shadow.radius = settings.shadowSoftness;
      }
    },
    dispose() {
      for (const light of lights) {
        scene.remove(light, light.target);
        light.dispose();
      }
    },
  };
}
