import { MeshStandardNodeMaterial } from 'three/webgpu';
import { cameraViewMatrix, mix, normalWorldGeometry, positionLocal, positionWorld, vec4, wgslFn } from 'three/tsl';

// One evaluation supplies color, relief and roughness. Continuous, warped
// mineral fields avoid polygonal cell boundaries, including at macro distances.
const hash3 = wgslFn(`
fn rockHash(p: vec3<f32>) -> vec3<f32> {
  let q = vec3<u32>(vec3<i32>(p));
  var h = (q.x*1597334677u) ^ (q.y*3812015801u) ^ (q.z*2798796415u);
  h = (h^(h>>16u))*2246822519u; h = h^(h>>13u);
  let a = h;
  h = (h^(h>>15u))*3266489917u; let b = h;
  h = (h^(h>>16u))*668265263u;
  return vec3<f32>(f32(a&65535u),f32(b&65535u),f32(h&65535u))/65535.0;
}`);
export const rockNoise = wgslFn(`fn rockNoise(p: vec3<f32>) -> f32 {
  let cell = floor(p); let f = fract(p); let u = f*f*f*(f*(f*6.0-15.0)+10.0);
  var n = 0.0;
  for(var i=0u;i<8u;i++) {
    let c=vec3<f32>(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u));
    let w=mix(1.0-u,u,c); n+=rockHash(cell+c).x*w.x*w.y*w.z;
  }
  return n;
}`, [hash3]);

// Exact quintic-noise slopes, evaluated independently at each fragment. Unlike
// dpdx(height), these do not share a slope across a 2x2 pixel quad. Fade both
// value and slope before a grain becomes too small to resolve at grazing angles.
export const rockGrain = wgslFn(`fn rockGrain(p: vec3<f32>) -> vec4<f32> {
  // Oblique slices avoid lining up the noise lattice with the flat soil.
  let rotation=mat3x3<f32>(vec3<f32>(0.8,0.0,0.6),vec3<f32>(0.36,0.8,-0.48),vec3<f32>(-0.48,0.6,0.64));
  let q=rotation*p;
  let cell=floor(q); let f=fract(q);
  let u=f*f*f*(f*(f*6.0-15.0)+10.0);
  let du=30.0*f*f*(f-1.0)*(f-1.0);
  var value=0.0; var gradient=vec3<f32>(0.0);
  for(var i=0u;i<8u;i++) {
    let c=vec3<f32>(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u));
    let w=mix(1.0-u,u,c); let n=rockHash(cell+c).x;
    value+=n*w.x*w.y*w.z;
    gradient+=n*(2.0*c-1.0)*du*vec3<f32>(w.y*w.z,w.x*w.z,w.x*w.y);
  }
  let footprint=max(length(dpdx(p)),length(dpdy(p)));
  let resolved=1.0-smoothstep(0.18,0.75,footprint);
  return vec4<f32>(transpose(rotation)*gradient*resolved,mix(0.5,value,resolved));
}`, [hash3]);
const geology = wgslFn(`fn rockSurface(p: vec3<f32>) -> mat4x4<f32> {
  let rotation=mat3x3<f32>(vec3<f32>(0.8,0.0,0.6),vec3<f32>(0.36,0.8,-0.48),vec3<f32>(-0.48,0.6,0.64));
  let q=rotation*p;
  let coarse=rockNoise(q*2.4+11.0);
  let middle=rockNoise(q*11.0+vec3<f32>(3.0,19.0,7.0));
  let warp=vec3<f32>(middle,rockNoise(q*9.0+27.0),coarse)-0.5;
  let grainP=q*145.0+warp*5.2;
  let footprint=max(length(dpdx(grainP)),length(dpdy(grainP)));
  let resolved=1.0-smoothstep(0.4,1.5,footprint);
  let microResolved=1.0-smoothstep(0.35,1.3,footprint*2.73);
  let grain=rockNoise(grainP);
  let micro=mix(0.5,rockNoise(rotation*grainP*2.73+31.0),microResolved);
  let mineral=grain*0.68+micro*0.32;
  let fine=mix(0.5,rockNoise(q*92.0),1.0-smoothstep(0.4,1.5,footprint*0.635));
  let mica=(1.0-smoothstep(0.29,0.43,mineral))*resolved;
  let quartz=smoothstep(0.57,0.72,mineral)*resolved;
  // Linear-light albedos: muted feldspar, pale quartz, dark mica.
  var color=mix(vec3<f32>(0.075,0.083,0.080),vec3<f32>(0.175,0.174,0.156),coarse);
  color*=0.86+middle*0.26;
  color=mix(color,vec3<f32>(0.032,0.038,0.035),mica*0.65);
  color=mix(color,vec3<f32>(0.29,0.31,0.28),quartz*0.48);
  color*=1.0+(micro-0.5)*resolved*0.15;
  let stains=smoothstep(0.56,0.76,rockNoise(q*3.8+57.0))*0.33;
  color=mix(color,color*vec3<f32>(1.11,0.90,0.69),stains);
  // Sparse crustose lichen: a ragged outer colony with smaller broken areoles.
  let field=rockNoise(q*5.3+vec3<f32>(17.0,3.0,21.0));
  let islands=rockNoise(q*43.0+warp*1.8);
  let lichen=smoothstep(0.64,0.72,field+(middle-0.5)*0.22+(islands-0.5)*0.18);
  let cracks=smoothstep(0.19,0.36,islands);
  color=mix(color,mix(vec3<f32>(0.19,0.23,0.16),vec3<f32>(0.38,0.41,0.31),fine),lichen*cracks*0.85);
  let height=(middle-0.5)*0.006+(fine-0.5)*0.0012
    +(grain-0.5)*resolved*0.0009+(micro-0.5)*resolved*0.00035+lichen*cracks*0.0015;
  let roughness=clamp(0.90-mica*0.15-quartz*0.09+lichen*0.06,0.65,1.0);
  return mat4x4<f32>(vec4<f32>(color,height),vec4<f32>(roughness,lichen,0.0,0.0),vec4<f32>(0.0),vec4<f32>(0.0));
}
`, [rockNoise]);

// Surface-gradient bump mapping from screen derivatives of a world-space
// height field. This preserves its physical scale without a UV atlas.
export const reliefNormal = wgslFn(`fn reliefNormal(p: vec3<f32>, n: vec3<f32>, h: f32) -> vec3<f32> {
  let sx=dpdx(p); let sy=dpdy(p);
  let r1=cross(sy,n); let r2=cross(n,sx);
  let det=dot(sx,r1);
  let gradient=(dpdx(h)*r1+dpdy(h)*r2)*sign(det);
  return normalize(abs(det)*n-gradient);
}`);

export function createRockMaterial(wetness, attached = false) {
  const material = new MeshStandardNodeMaterial({ roughness: .9 });
  const surface = geology({ p: attached ? positionLocal : positionWorld }).toVar('geology');
  const stone = surface.element(0), finish = surface.element(1);
  material.colorNode = stone.xyz.mul(mix(1, .72, wetness));
  material.roughnessNode = finish.x.mul(mix(1, .8, wetness));
  const n = reliefNormal({ p: positionWorld, n: normalWorldGeometry, h: stone.w });
  material.normalNode = cameraViewMatrix.mul(vec4(n, 0)).xyz.normalize();
  return material;
}
