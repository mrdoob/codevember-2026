// A phase-referenced vibration envelope, evaluated once per rendered frame.
// Solver storage is read-only. Heights remain in metres until rendering.
struct Mode { q:f32,v:f32,omega:f32,invMass:f32,gravityAcc:f32,couplingAcc:f32,a:f32,b:f32,c:f32,d:f32,pickup:f32,parity:f32 };
// Live field: cos phase, sin phase, 1 / drive omega, smoothing.
// Steady shape: drive omega, force, damping ratio, smoothing.
// Display: height scale, steady forcing blend, inverse elapsed time, smoothing.
@group(0) @binding(0) var<uniform> reference:vec4f;
@group(0) @binding(1) var<storage,read> modes:array<Mode>;
@group(0) @binding(2) var<storage,read> basis:array<f32>;
@group(0) @binding(3) var<storage,read_write> envelope:array<vec4f>;
var<workgroup> quadratures:array<vec4f,34>;

@group(0) @binding(4) var<storage,read> liveEnvelope:array<vec4f>;
@group(0) @binding(5) var<storage,read> steadyEnvelope:array<vec4f>;
// xy: fluid forcing quadratures, z: height / radius, w: vertical speed / radius.
@group(0) @binding(6) var<storage,read_write> display:array<vec4f>;

@compute @workgroup_size(128)
fn displayField(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=21025u){return;}
  let live=liveEnvelope[k].xy;let steady=steadyEnvelope[k].xy;
  // Round the zero over one micron to avoid a razor crease at nodal lines.
  let steadyHeight=sqrt(dot(steady,steady)+1e-12)-1e-6;
  let height=steadyHeight*reference.x;
  let speed=clamp((height-display[k].z)*reference.z,-3.0,3.0);
  display[k]=vec4f(mix(live,steady,reference.y),height,mix(display[k].w,speed,reference.w));
}

fn writeEnvelope(k:u32) {
  if(k>=21025u){return;}
  let x=i32(k%145u)-72;let z=i32(k/145u)-72;
  let sampleIndex=u32(abs(z)*73+abs(x));
  var value=vec2f(0);var energy=0.0;
  for(var m=0u;m<34u;m++) {
    let mode=quadratures[m];let flags=u32(mode.z);
    let flipX=x<0&&(flags&1u)!=0u;let flipZ=z<0&&(flags&2u)!=0u;
    value+=mode.xy*basis[m*5329u+sampleIndex]*select(1.0,-1.0,flipX!=flipZ);
    energy+=dot(mode.xy,mode.xy);
  }
  // Smooth the two signed quadratures before taking their magnitude. This
  // keeps nodes dark/quiet and removes carrier aliasing without freezing the
  // envelope when the drive changes or stops.
  let filtered=mix(envelope[k].xy,value,reference.w);
  envelope[k]=vec4f(filtered,0,mix(envelope[k].w,sqrt(energy),reference.w));
}

@compute @workgroup_size(128)
fn waveField(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32) {
  if(lane<34u) {
    let mode=modes[lane];
    let q=mode.q-mode.gravityAcc/(mode.omega*mode.omega);
    let v=mode.v*reference.z;
    quadratures[lane]=vec4f(q*reference.x-v*reference.y,q*reference.y+v*reference.x,mode.parity,0);
  }
  workgroupBarrier();writeEnvelope(id.x);
}

@compute @workgroup_size(128)
fn steadyField(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32) {
  if(lane<34u) {
    let mode=modes[lane];let omega=reference.x;
    let detuning=mode.omega*mode.omega-omega*omega;
    let loss=2.0*reference.z*mode.omega*omega;
    let scale=reference.y*mode.couplingAcc/max(detuning*detuning+loss*loss,1e-20);
    // Steady sinusoidal response of the same unloaded, damped modal model.
    // It is independent of carrier phase and transient grain impacts.
    quadratures[lane]=vec4f(-loss*scale,detuning*scale,mode.parity,0);
  }
  workgroupBarrier();writeEnvelope(id.x);
}
