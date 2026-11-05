import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PhysicalLightingModel, Color } from 'three/webgpu';
import { attribute, cameraViewMatrix, float, instanceIndex, mix, normalView, normalWorldGeometry, positionLocal, uniform, vec3, vec4, wgslFn } from 'three/tsl';
import { createRockMaterial } from './geology.js';

// Value and analytic gradient. Suppress grains smaller than a pixel to keep
// mineral detail stable as the camera retreats.
export const mossGrain = wgslFn(`fn mossGrain(p: vec3<f32>) -> vec4<f32> {
  let cell = vec3<u32>(vec3<i32>(floor(p))); let f = fract(p);
  let u = f*f*(3.0-2.0*f); let du = 6.0*f*(1.0-f);
  var value = 0.0; var gradient = vec3<f32>(0.0);
  for(var i=0u; i<8u; i++) {
    let corner=vec3<u32>(i&1u,(i>>1u)&1u,(i>>2u)&1u);
    let q=cell+corner;
    var h=(q.x*1597334677u)^(q.y*3812015801u)^(q.z*2798796415u);
    h=(h^(h>>16u))*2246822519u; h=h^(h>>13u);
    let n=f32(h&65535u)/65535.0;
    let b=vec3<f32>(corner); let w=mix(1.0-u,u,b);
    value+=n*w.x*w.y*w.z;
    gradient+=n*(2.0*b-1.0)*du*vec3<f32>(w.y*w.z,w.x*w.z,w.x*w.y);
  }
  let footprint=max(abs(dpdx(p)),abs(dpdy(p)));
  let visible=1.0-smoothstep(0.4,1.3,max(footprint.x,max(footprint.y,footprint.z)));
  return vec4<f32>(gradient*visible,mix(0.5,value,visible));
}`);

class LeafLightingModel extends PhysicalLightingModel {
  constructor(material) {
    super(material.useClearcoat, false, false, false, false, false, false, material.useDiffuseRoughness);
  }
  direct(input, builder) {
    const { lightDirection, lightColor, reflectedLight } = input;
    const material = builder.material;
    // A thin-sheet diffuse transmission lobe. Incoming light is already
    // shadowed, and the reflected fraction is reduced by the same budget.
    const tissue = attribute('plant', 'vec3').y;
    const fraction = material.translucencyNode.mul(tissue).mul(.38);
    super.direct({ ...input, lightColor: lightColor.mul(fraction.oneMinus()) }, builder);
    const cosTheta = normalView.dot(lightDirection).negate().max(0);
    const pigment = attribute('pigment', 'vec3');
    const transmitted = pigment.max(.012).pow(.65);
    reflectedLight.directDiffuse.addAssign(lightColor.mul(transmitted).mul(cosTheta).mul(fraction).mul(1 / Math.PI));
  }
}

class MossMaterial extends MeshPhysicalNodeMaterial {
  static get type() { return 'MossMaterial'; }
  constructor() { super(); this.translucencyNode = uniform(.75); }
  setupLightingModel() { return new LeafLightingModel(this); }
}

export function createMaterials(settings) {
  const wetness = uniform(settings.wetness), time = uniform(0), wind = uniform(settings.breeze);
  const moss = new MossMaterial();
  moss.roughness = .68;
  moss.ior = 1.43;
  moss.specularIntensity = .45;
  moss.clearcoat = .2;
  moss.clearcoatRoughness = .24;
  const tissue = attribute('plant', 'vec3');
  moss.colorNode = attribute('pigment', 'vec3').mul(mix(1, .67, wetness));
  moss.roughnessNode = mix(.76, .38, wetness);
  moss.clearcoatNode = wetness.mul(.35).mul(tissue.y);
  moss.aoNode = tissue.z;
  moss.translucencyNode.value = settings.translucency;
  // positionLocal has already been instanced. The source position attribute
  // keeps each root fixed and is also understood by meshlet bounds fitting.
  const flex = attribute('position', 'vec3').y.div(.13).clamp().pow(2).mul(wind).mul(.006);
  const phase = instanceIndex.toFloat().mul(1.618);
  moss.positionNode = positionLocal.add(vec3(
    time.mul(1.3).add(phase).sin().mul(flex),
    float(0),
    time.mul(.89).add(phase.mul(.73)).sin().mul(flex).mul(.7)
  ));

  const stone = createRockMaterial(wetness);
  const floatingStone = createRockMaterial(wetness, true);

  const substrate = new MeshStandardNodeMaterial({ color: '#243009', roughness: 1 });
  const soilGrain = mossGrain({ p: positionLocal.mul(140) });
  substrate.colorNode = mix(new Color('#121a06'), new Color('#3e4b0d'), soilGrain.w);
  substrate.aoNode = float(.45);
  substrate.normalNode = cameraViewMatrix.mul(vec4(normalWorldGeometry.add(soilGrain.xyz.mul(.5)).normalize(), 0)).xyz.normalize();

  const sporophyte = new MeshStandardNodeMaterial({ roughness: .63 });
  sporophyte.colorNode = attribute('pigment', 'vec3');
  return { moss, stone, floatingStone, substrate, sporophyte, wetness, time, wind, dispose() {
    for (const m of [moss, stone, floatingStone, substrate, sporophyte]) m.dispose();
  } };
}
