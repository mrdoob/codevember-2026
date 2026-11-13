import { MeshSSSNodeMaterial, DoubleSide } from 'three/webgpu';
import { GROUND_Y } from './scene-constants.js';
import { attribute, positionGeometry, positionWorld, normalGeometry, normalLocal, vec3, vec4, mix, uniform, Fn, referenceAttribute, transformNormal, float } from 'three/tsl';

export function createFeatherMaterial() {
  const time = uniform(0), breeze = uniform(1), light = uniform(1), scattering = uniform(1);
  const material = new MeshSSSNodeMaterial({ side: DoubleSide, roughness: .62, metalness: 0, specularIntensity: .22, sheen: .16, sheenRoughness: .8, sheenColor: '#ffd8c4' });
  const phase = attribute('featherPhase', 'float');
  const tint = attribute('featherTint', 'vec3').clamp(0, 1);
  const fiber = attribute('fiber', 'vec3');
  // Clamp interpolated attributes before nonlinear operations: subpixel MSAA
  // samples can extrapolate beyond the edges of these very narrow ribbons.
  const pigment = fiber.x.clamp(.5, 1);
  const down = fiber.y.clamp(0, 1);
  const edge = fiber.z.clamp(0, 1).pow(.7);
  const vane = fiber.y.smoothstep(-.3, 0);
  // The free rim is thinner than the body, so individual edge fibers catch
  // the backlight. Keep some density through the upper vane and the quill.
  const rim = edge.smoothstep(.55, .98);
  const tipDensity = positionGeometry.y.smoothstep(.65, 1.48);
  const thickness = tipDensity.mul(1.3).add(.48).mul(mix(1, .18, rim))
    .mul(mix(1, .4, down)).add(vane.oneMinus().mul(3.4));
  const absorption = vec3(.9, 1.6, 2.6);
  const transmittance = absorption.mul(thickness).negate().exp();

  material.positionNode = Fn(() => {
    const matrix = referenceAttribute('instanceMatrix', 'mat4');
    const p = positionGeometry.toVar();
    const tip = p.y.add(1.55).div(3.1);
    const wave = time.mul(1.3).add(phase).add(p.y.mul(2.4));
    p.z.addAssign(wave.sin().mul(tip.pow2()).mul(.055).mul(breeze));
    p.z.addAssign(time.mul(2.8).add(p.x.mul(11)).add(phase).sin().mul(p.x.abs().pow(1.4)).mul(.04).mul(breeze));
    p.x.addAssign(time.mul(.8).add(phase).sin().mul(tip.pow2()).mul(.025).mul(breeze));
    normalLocal.assign(transformNormal(normalGeometry, matrix));
    return matrix.mul(vec4(p, 1)).xyz;
  })();
  material.maskNode = positionWorld.y.greaterThan(GROUND_Y);
  // A brighter copper-red vane retains color away from the backlight. Keep
  // the dense shaft darker so it still reads through the illuminated fibers.
  material.colorNode = mix(vec3(.18, .13, .105), vec3(.64, .3, .22), vane).mul(tint).mul(pigment);
  material.roughnessNode = mix(.53, .86, down);
  // The SSS lighting model evaluates this per direct light, in view space.
  // The vane, thin rim, and down glow; the dense quill absorbs more light.
  // This is a real-time thin-fiber approximation, not volumetric path tracing.
  const downOcclusion = mix(1, edge.pow2().mul(.85).add(.15), down);
  material.thicknessColorNode = transmittance.mul(vec3(1.05, .65, .8)).mul(tint).mul(pigment).mul(mix(.045, 1, vane)).mul(downOcclusion);
  // A broad, low-energy scattering component keeps thin fibers soft on
  // either face. The directional lobe still makes backlighting strongest;
  // both terms are evaluated per light and disappear when it is switched off.
  material.thicknessDistortionNode = float(.15);
  material.thicknessAmbientNode = float(.2);
  material.thicknessAttenuationNode = scattering.mul(.34);
  material.thicknessPowerNode = float(1.6);
  material.thicknessScaleNode = float(1.8);
  return { material, time, breeze, light, scattering };
}
