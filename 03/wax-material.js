import { MeshSSSNodeMaterial, PhysicalLightingModel } from 'three/webgpu';
import { attribute, cameraViewMatrix, float, mix, normalView, positionViewDirection, positionWorld, uniform, vec3, vec4, wgslFn } from 'three/tsl';

class WaxLightingModel extends PhysicalLightingModel {
  constructor(material) {
    super(material.useClearcoat, material.useSheen, material.useIridescence, material.useAnisotropy,
      material.useTransmission, material.useDispersion, material.useRetroreflection, material.useDiffuseRoughness);
    this.useSSS = material.useSSS;
  }

  direct(input, builder) {
    const { lightNode, lightDirection, lightColor, reflectedLight } = input;
    const index = lightNode.light.userData.waxThicknessIndex;
    if (index === undefined) { super.direct(input, builder); return; }
    const material = builder.material;
    const path = attribute('meltThickness', 'vec4').element(index);
    // Per-channel Beer–Lambert attenuation along the actual light direction.
    // The field integration includes separated occluders, so scattering uses
    // incident light before the opaque shadow test, without leaking through wax.
    const pigment = material.thicknessColorNode.clamp(.05, .95);
    const extinction = pigment.oneMinus().mul(2).add(vec3(.65, .8, 1.05));
    const transmittance = path.div(material.scatterDistanceNode).negate().mul(extinction).exp();
    let incident = lightNode.baseColorNode || lightColor;
    if (lightNode.light.userData.waxFire) {
      const source = material.fireSphereNode;
      const distance2 = source.xyz.sub(positionWorld).lengthSq();
      // A finite spherical emitter avoids the point-light singularity when it
      // enters the wax. The same measured path occludes direct illumination.
      incident = (lightNode.baseColorNode || lightNode.colorNode).div(distance2.add(source.w.mul(source.w)));
      super.direct({ ...input, lightColor: incident.mul(transmittance) }, builder);
    } else super.direct(input, builder);
    if (!this.useSSS) return;
    const backFacing = normalView.dot(lightDirection).negate().smoothstep(-.2, .65);
    const forward = positionViewDirection.dot(lightDirection.negate()).clamp().pow(3).mul(.35).add(.65);
    reflectedLight.directDiffuse.addAssign(incident.mul(pigment).mul(transmittance)
      .mul(backFacing).mul(forward).mul(material.thicknessAttenuationNode));
  }
}

export class WaxNodeMaterial extends MeshSSSNodeMaterial {
  static get type() { return 'WaxNodeMaterial'; }

  constructor(parameters) {
    super(parameters);
    this.scatterDistanceNode = uniform(.28);
  }

  setupLightingModel() {
    // Preserve r187 EON alongside the directional thickness scattering model.
    return new WaxLightingModel(this);
  }
}

// Value noise and its analytic gradient share the same eight corner hashes.
// Derivative filtering fades grains smaller than a pixel; no texture or pass.
const waxNoise = wgslFn(`fn waxNoise(p:vec3<f32>) -> vec4<f32> {
  let cell=vec3<u32>(vec3<i32>(floor(p))); let f=fract(p);
  let u=f*f*(3.0-2.0*f); let du=6.0*f*(1.0-f);
  var value=0.0; var gradient=vec3<f32>(0.0);
  for(var i=0u;i<8u;i++) {
    let corner=vec3<u32>(i&1u,(i>>1u)&1u,(i>>2u)&1u);
    let q=cell+corner;
    var h=(q.x*1597334677u) ^ (q.y*3812015801u) ^ (q.z*2798796415u);
    h=(h^(h>>16u))*2246822519u; h=h^(h>>13u);
    let n=f32(h&65535u)/65535.0;
    let b=vec3<f32>(corner); let w=mix(1.0-u,u,b);
    value+=n*w.x*w.y*w.z;
    gradient+=n*(2.0*b-1.0)*du*vec3<f32>(w.y*w.z,w.x*w.z,w.x*w.y);
  }
  let footprint=max(abs(dpdx(p)),abs(dpdy(p)));
  let visible=1.0-smoothstep(0.35,1.0,max(footprint.x,max(footprint.y,footprint.z)));
  return vec4<f32>(gradient*visible,mix(0.5,value,visible));
}`);

export function applyWaxFinish(material, fieldSample, solidRoughness, solidDiffuseRoughness) {
  const roughness = uniform(solidRoughness);
  const diffuseRoughness = uniform(solidDiffuseRoughness);
  const wet = fieldSample.w.smoothstep(.1, .85).toVar('waxWet');
  const dry = wet.oneMinus();
  const grain = waxNoise({ p: positionWorld.mul(65) }).toVar('waxGrain');
  const mottling = waxNoise({ p: positionWorld.mul(4.5) }).w.sub(.5);
  const normal = fieldSample.xyz;
  // Shadow filtering uses the smooth surface, excluding microscopic grain.
  material.smoothShadowNormalNode = normal;
  const tangent = grain.xyz.sub(normal.mul(grain.xyz.dot(normal)));
  const waxNormal = normal.add(tangent.mul(.035).mul(dry)).normalize();
  const viewNormal = cameraViewMatrix.mul(vec4(waxNormal, 0)).xyz.normalize().toVar('waxNormal');
  material.normalNode = viewNormal;
  material.clearcoatNormalNode = viewNormal;
  material.colorNode = float(1).add(mottling.mul(.045)).add(grain.w.sub(.5).mul(.035).mul(dry));
  material.roughnessNode = mix(roughness, roughness.mul(.55), wet).add(grain.w.sub(.5).mul(.05).mul(dry)).clamp(.15, .9);
  material.diffuseRoughnessNode = diffuseRoughness.mul(dry).clamp();
  return { roughness, diffuseRoughness };
}
