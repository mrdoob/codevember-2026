import { AdditiveBlending, Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SphereGeometry } from 'three/webgpu';
import { color, mix, normalView, positionViewDirection, uv } from 'three/tsl';
import { FIRE_VISUAL_RADIUS } from './heat-source.js';

// Visual size is independent of the much wider simulation heat volume.
export function createFireParticle(brightness) {
  const particle = new Group();
  const facing = normalView.dot(positionViewDirection).abs().smoothstep(0, .55);
  const coreMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  coreMaterial.colorNode = mix(color('#ff8f38').mul(.4), color('#fff0cf').mul(1.2), facing).mul(brightness);
  const core = new Mesh(new SphereGeometry(FIRE_VISUAL_RADIUS, 24, 16), coreMaterial);
  core.name = 'Fire core'; core.renderOrder = 1;
  particle.add(core);

  const p = uv().mul(2).sub(1), radius2 = p.dot(p);
  const glowMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  glowMaterial.colorNode = color('#ff761a').mul(brightness);
  glowMaterial.opacityNode = radius2.mul(-5).exp().mul(radius2.smoothstep(.65, 1).oneMinus()).mul(.07);
  const glow = new Mesh(new PlaneGeometry(FIRE_VISUAL_RADIUS * 4.2, FIRE_VISUAL_RADIUS * 4.2), glowMaterial);
  glow.name = 'Fire glow'; glow.renderOrder = 2;
  particle.add(glow);
  return particle;
}
