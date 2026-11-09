// Incompressible MAC-grid flow in the membrane's planar coordinates.
// Velocity is in disk radii / second; optical thickness is in nanometres.
override N:u32=256u;
struct Params { dt:f32, stirring:f32, viscosity:f32, drag:f32 };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> velocity:array<vec2f>;
@group(0) @binding(2) var<storage,read_write> nextVelocity:array<vec2f>;
@group(0) @binding(3) var<storage,read> film:array<f32>;
@group(0) @binding(4) var<storage,read_write> nextFilm:array<f32>;
@group(0) @binding(5) var<storage,read> pressure:array<f32>;
@group(0) @binding(6) var<storage,read_write> nextPressure:array<f32>;
@group(0) @binding(7) var<storage,read_write> divergence:array<f32>;
@group(0) @binding(8) var<storage,read> wave:array<vec4f>;
@group(0) @binding(9) var<storage,read> predictedFilm:array<f32>;
@group(0) @binding(10) var<storage,read_write> curl:array<f32>;

fn cell(k:u32)->vec2i{return vec2i(i32(k%N),i32(k/N));}
fn index(c:vec2i)->u32{let q=clamp(c,vec2i(0),vec2i(i32(N)-1));return u32(q.y)*N+u32(q.x);}
fn position(c:vec2i)->vec2f{return (vec2f(c)+.5)*2.0/f32(N)-1.0;}
fn inside(c:vec2i)->bool{let p=position(c);return all(c>=vec2i(0))&&all(c<vec2i(i32(N)))&&dot(p,p)<1.0;}
fn faceOpen(c:vec2i,axis:vec2i)->bool{return inside(c)&&inside(c+axis);}
fn bounded(p:vec2f)->vec2f{return p/max(1.0,length(p)/.99999);}
fn readVelocity(c:vec2i)->vec2f{if(!inside(c)){return vec2f(0);}return velocity[index(c)];}
fn centeredVelocity(c:vec2i)->vec2f {
  return (readVelocity(c)+vec2f(readVelocity(c-vec2i(1,0)).x,readVelocity(c-vec2i(0,1)).y))*.5;
}

fn seedNoise(p:vec2f)->f32 {
  let c=vec2i(floor(p));let f=fract(p);let u=f*f*(3.0-2.0*f);
  var values:array<f32,4>;
  for(var i=0u;i<4u;i++) {
    let q=c+vec2i(i32(i%2u),i32(i/2u));
    var h=bitcast<u32>(q.x)*374761393u+bitcast<u32>(q.y)*668265263u;
    h=(h^(h>>13u))*1274126177u;h=h^(h>>16u);
    values[i]=f32(h&0xffffffu)/16777215.0;
  }
  return mix(mix(values[0],values[1],u.x),mix(values[2],values[3],u.x),u.y)*2.0-1.0;
}

fn sampleVelocityComponent(p:vec2f,component:u32)->f32 {
  let offset=select(vec2f(1,.5),vec2f(.5,1),component==1u);
  let g=clamp((p+1.0)*f32(N)*.5-offset,vec2f(0),vec2f(f32(N)-1.0001));
  let c=vec2i(floor(g));let f=fract(g);
  return mix(mix(velocity[index(c)][component],velocity[index(c+vec2i(1,0))][component],f.x),mix(velocity[index(c+vec2i(0,1))][component],velocity[index(c+vec2i(1,1))][component],f.x),f.y);
}
fn sampleVelocity(p:vec2f)->vec2f{return vec2f(sampleVelocityComponent(p,0u),sampleVelocityComponent(p,1u));}
fn departure(p:vec2f,dt:f32)->vec2f {
  let mid=bounded(p-sampleVelocity(p)*dt*.5);
  return bounded(p-sampleVelocity(mid)*dt);
}
fn sampleFilm(p:vec2f,predicted:bool)->f32 {
  let g=clamp((bounded(p)+1.0)*f32(N)*.5-.5,vec2f(0),vec2f(f32(N)-1.0001));
  let c=vec2i(floor(g));let f=fract(g);
  let ids=vec4u(index(c),index(c+vec2i(1,0)),index(c+vec2i(0,1)),index(c+vec2i(1,1)));
  var values:vec4f;
  if(predicted){values=vec4f(predictedFilm[ids.x],predictedFilm[ids.y],predictedFilm[ids.z],predictedFilm[ids.w]);}
  else{values=vec4f(film[ids.x],film[ids.y],film[ids.z],film[ids.w]);}
  return mix(mix(values.x,values.y,f.x),mix(values.z,values.w,f.x),f.y);
}
fn sampleWave(p:vec2f)->vec4f {
  let g=clamp((p+1.0)*72.0,vec2f(0),vec2f(143.9999));let c=vec2u(g);let f=fract(g);let k=c.y*145u+c.x;
  return mix(mix(wave[k],wave[k+1u],f.x),mix(wave[k+145u],wave[k+146u],f.x),f.y);
}
fn waveEnergy(q:vec2f)->f32{return min(dot(q,q)*1e8,16.0);}

@compute @workgroup_size(128)
fn initialize(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let p=position(cell(k));
  nextVelocity[k]=vec2f(0);nextPressure[k]=0;
  // Initial thickness variation only; all subsequent motion is transported.
  let warp=vec2f(seedNoise(p*2.7+vec2f(3.1,7.2)),seedNoise(p*2.7-vec2f(4.3,2.1)))*.26;
  let q=p+warp;
  nextFilm[k]=540.0+250.0*seedNoise(q*3.5)+140.0*seedNoise(q*10.0+vec2f(5,2))+65.0*seedNoise(q*24.0)+24.0*seedNoise(q*49.0);
}

@compute @workgroup_size(128)
fn computeCurl(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);
  if(!inside(c)){curl[k]=0;return;}
  curl[k]=(centeredVelocity(c+vec2i(1,0)).y-centeredVelocity(c-vec2i(1,0)).y-centeredVelocity(c+vec2i(0,1)).x+centeredVelocity(c-vec2i(0,1)).x)*f32(N)*.25;
}

@compute @workgroup_size(128)
fn advectVelocity(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);if(!inside(c)){nextVelocity[k]=vec2f(0);return;}
  let dx=2.0/f32(N);let p=position(c);let v=velocity[k];
  var advected=vec2f(sampleVelocityComponent(departure(p+vec2f(dx*.5,0),params.dt),0u),sampleVelocityComponent(departure(p+vec2f(0,dx*.5),params.dt),1u));
  let laplacian=(readVelocity(c+vec2i(1,0))+readVelocity(c-vec2i(1,0))+readVelocity(c+vec2i(0,1))+readVelocity(c-vec2i(0,1))-4.0*v)/(dx*dx);
  let center=sampleWave(p);let right=sampleWave(p+vec2f(dx,0));let top=sampleWave(p+vec2f(0,dx));
  let e=waveEnergy(center.xy);
  let gradient=vec2f(waveEnergy(right.xy)-e,waveEnergy(top.xy)-e)/dx;
  let slope=vec2f(right.z-center.z,top.z-center.z)/dx;
  let verticalSpeed=(vec2f(right.w,top.w)+center.w)*.5;
  let thickness=vec2f((film[k]+film[index(c+vec2i(1,0))])*.5,(film[k]+film[index(c+vec2i(0,1))])*.5);
  // A stylized cycle-averaged wave stress, with thickness-dependent mobility.
  // This is one-way forcing; it cannot change the membrane or grain state.
  let gradientCurl=vec2f(abs(curl[index(c+vec2i(1,0))])-abs(curl[index(c-vec2i(1,0))]),abs(curl[index(c+vec2i(0,1))])-abs(curl[index(c-vec2i(0,1))]));
  let direction=gradientCurl/max(length(gradientCurl),1e-6);
  // Vorticity confinement offsets numerical smoothing of small eddies.
  let confinement=vec2f(direction.y,-direction.x)*curl[k]*dx*2.5;
  let mobility=540.0/max(thickness,vec2f(100));
  // Rising/falling display geometry pushes along its slopes. This bounded,
  // thickness-dependent coupling is a visual approximation, not a 3D solver.
  let motionForce=-clamp(slope*verticalSpeed,vec2f(-8),vec2f(8))*mobility*.35;
  let force=(-gradient*(mobility-1.0)*.085+motionForce)*params.stirring+confinement;
  advected=(advected+(laplacian*params.viscosity+force)*params.dt)*exp(-params.drag*params.dt);
  advected=clamp(advected,vec2f(-.65),vec2f(.65));
  nextVelocity[k]=vec2f(select(0.0,advected.x,faceOpen(c,vec2i(1,0))),select(0.0,advected.y,faceOpen(c,vec2i(0,1))));
}

@compute @workgroup_size(128)
fn computeDivergence(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);
  if(!inside(c)){divergence[k]=0;return;}
  divergence[k]=(velocity[k].x-readVelocity(c-vec2i(1,0)).x+velocity[k].y-readVelocity(c-vec2i(0,1)).y)*f32(N)*.5;
}

@compute @workgroup_size(128)
fn solvePressure(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);if(!inside(c)){nextPressure[k]=0;return;}
  var total=0.0;var count=0.0;
  let neighbors=array<vec2i,4>(vec2i(1,0),vec2i(-1,0),vec2i(0,1),vec2i(0,-1));
  for(var i=0u;i<4u;i++){let other=c+neighbors[i];if(inside(other)){total+=pressure[index(other)];count+=1.0;}}
  let dx=2.0/f32(N);nextPressure[k]=(total-dx*dx*divergence[k])/max(count,1.0);
}

@compute @workgroup_size(128)
fn project(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);let invDx=f32(N)*.5;let p=pressure[k];
  let u=velocity[k].x-(pressure[index(c+vec2i(1,0))]-p)*invDx;
  let v=velocity[k].y-(pressure[index(c+vec2i(0,1))]-p)*invDx;
  nextVelocity[k]=vec2f(select(0.0,u,faceOpen(c,vec2i(1,0))),select(0.0,v,faceOpen(c,vec2i(0,1))));
}

@compute @workgroup_size(128)
fn advectFilm(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);
  if(!inside(c)){nextFilm[k]=film[k];return;}
  nextFilm[k]=sampleFilm(departure(position(c),params.dt),false);
}

@compute @workgroup_size(128)
fn correctFilm(@builtin(global_invocation_id) id:vec3u) {
  let k=id.x;if(k>=N*N){return;}let c=cell(k);
  if(!inside(c)){nextFilm[k]=film[k];return;}
  let p=position(c);let reverse=sampleFilm(departure(p,-params.dt),true);
  let corrected=predictedFilm[k]+.5*(film[k]-reverse);
  let g=clamp((departure(p,params.dt)+1.0)*f32(N)*.5-.5,vec2f(0),vec2f(f32(N)-1.0001));let q=vec2i(g);
  let values=vec4f(film[index(q)],film[index(q+vec2i(1,0))],film[index(q+vec2i(0,1))],film[index(q+vec2i(1,1))]);
  let lo=min(min(values.x,values.y),min(values.z,values.w));let hi=max(max(values.x,values.y),max(values.z,values.w));
  // Limited MacCormack advection keeps the color filaments from diffusing
  // away, without creating negative thickness or new extrema.
  nextFilm[k]=clamp(corrected,lo,hi);
}
