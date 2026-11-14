import { MeshStandardNodeMaterial } from 'three/webgpu';
import { attribute, positionWorld, normalView, cameraViewMatrix, mix, vec3, vec4, wgslFn } from 'three/tsl';

const grain = wgslFn(`fn snowGrain(p: vec3<f32>) -> vec4<f32> {
  let cell = vec3<i32>(floor(p)); let f = fract(p); let u = f*f*(3.0-2.0*f); let du=6.0*f*(1.0-f);
  var value=0.0; var gradient=vec3<f32>(0.0);
  for(var i=0u; i<8u; i++) {
    let corner=vec3<u32>(i&1u,(i>>1u)&1u,(i>>2u)&1u); let q=vec3<u32>(cell)+corner;
    var h=(q.x*1597334677u)^(q.y*3812015801u)^(q.z*2798796415u); h=(h^(h>>16u))*2246822519u; h=h^(h>>13u);
    let n=f32(h&65535u)/65535.0; let b=vec3<f32>(corner); let w=mix(1.0-u,u,b);
    value+=n*w.x*w.y*w.z; gradient+=n*(2.0*b-1.0)*du*vec3<f32>(w.y*w.z,w.x*w.z,w.x*w.y);
  }
  let footprint=max(abs(dpdx(p)),abs(dpdy(p)));
  let visible=1.0-smoothstep(0.4,1.4,max(footprint.x,max(footprint.y,footprint.z)));
  return vec4<f32>(gradient*visible,mix(0.5,value,visible));
}`);

export function createMaterials() {
  const foliage = new MeshStandardNodeMaterial({ roughness: .91 });
  foliage.colorNode = attribute('pigment', 'vec3');
  foliage.aoNode = attribute('hedgeDetail', 'float');
  const snow = new MeshStandardNodeMaterial({ roughness: .87, metalness: 0 });
  const broad = grain({ p: positionWorld.mul(16) }), fine = grain({ p: positionWorld.mul(135) });
  snow.colorNode = attribute('pigment', 'vec3').mul(broad.w.mul(.15).add(.88));
  snow.aoNode = attribute('hedgeDetail', 'float');
  snow.normalNode = normalView.add(cameraViewMatrix.mul(vec4(broad.xyz.mul(.17).add(fine.xyz.mul(.10)), 0)).xyz).normalize();
  snow.roughnessNode = fine.w.mul(.15).add(.77);

  const ground = new MeshStandardNodeMaterial({ roughness: .89 });
  const surface = attribute('snowSurface', 'vec2');
  const waves = grain({ p: positionWorld.mul(vec3(4, 8, 11)) }), powder = grain({ p: positionWorld.mul(160) });
  ground.colorNode = mix(vec3(.69, .76, .86), vec3(.84, .89, .96), surface.x).mul(waves.w.mul(.08).add(.95));
  ground.aoNode = surface.x.mul(.52).add(.48);
  ground.normalNode = normalView.add(cameraViewMatrix.mul(vec4(waves.xyz.mul(.075).add(powder.xyz.mul(.11)), 0)).xyz).normalize();
  const core = new MeshStandardNodeMaterial({ roughness: 1 });
  const coreGrain = grain({ p: positionWorld.mul(29) });
  core.colorNode = mix(vec3(.015, .024, .018), vec3(.23, .28, .33), coreGrain.w.smoothstep(.46, .73));
  core.normalNode = normalView.add(cameraViewMatrix.mul(vec4(coreGrain.xyz.mul(.45), 0)).xyz).normalize();
  return { foliage, snow, ground, core, dispose() { foliage.dispose(); snow.dispose(); ground.dispose(); core.dispose(); } };
}
