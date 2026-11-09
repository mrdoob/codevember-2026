// Fixed-step circular membrane / rigid sphere model, in SI units.
// Uniform records use 256-byte dynamic offsets, one per physics substep.
struct Params { count:u32, modes:u32, grid:u32, audioIndex:u32, dt:f32, gravity:f32, friction:f32, restitution:f32, rolling:f32, force:f32, cell:f32, kick:f32, };
struct Grain { p:vec4f, v:vec4f, spin:vec4f };
struct Mode { q:f32,v:f32,omega:f32,invMass:f32,gravityAcc:f32,couplingAcc:f32,a:f32,b:f32,c:f32,d:f32,pickup:f32,pad:f32 };
struct Node { h:f32, v:f32, impulse:atomic<i32>, pad:f32 };
struct Neighbors { count:u32, ids:array<u32,64> };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read_write> grains:array<vec4f>;
@group(0) @binding(2) var<storage,read_write> outputGrains:array<vec4f>;
@group(0) @binding(3) var<storage,read_write> modes:array<Mode>;
@group(0) @binding(4) var<storage,read> basis:array<f32>;
@group(0) @binding(5) var<storage,read_write> nodes:array<Node>;
@group(0) @binding(6) var<storage,read> gram:array<f32>;
@group(0) @binding(7) var<storage,read_write> heads:array<atomic<i32>>;
@group(0) @binding(8) var<storage,read_write> links:array<vec4i>;
@group(0) @binding(9) var<storage,read_write> neighbors:array<Neighbors>;
@group(0) @binding(10) var<storage,read_write> drawData:array<vec4f>;
@group(0) @binding(11) var<storage,read_write> surfaceData:array<vec4f>;
@group(0) @binding(12) var<storage,read_write> audio:array<f32>;
@group(0) @binding(13) var<storage,read> kicks:array<f32>;
@group(0) @binding(14) var<storage,read_write> activeNodes:array<atomic<u32>>;
// Separate contiguous position, velocity, and spin planes. Broad-phase queries
// read only positions; contact kernels still evolve all three physical fields.
fn loadGrain(i:u32)->Grain{return Grain(grains[i],grains[params.count+i],grains[2u*params.count+i]);}
fn storeGrain(i:u32,g:Grain){grains[i]=g.p;grains[params.count+i]=g.v;grains[2u*params.count+i]=g.spin;}
fn storeOutput(i:u32,g:Grain){outputGrains[i]=g.p;outputGrains[params.count+i]=g.v;outputGrains[2u*params.count+i]=g.spin;}
// Circular modes have exact reflection symmetry. Store one quadrant of the
// basis to keep the field matrix in cache; the evaluation grid is still 145².
fn basisIndex(k:u32)->u32{let x=abs(i32(k%params.grid)-72);let z=abs(i32(k/params.grid)-72);return u32(z*73+x);}
fn basisSign(k:u32,flags:u32)->f32{
  let flipX=k%params.grid<72u&&(flags&1u)!=0u;
  let flipZ=k/params.grid<72u&&(flags&2u)!=0u;
  return select(1.0,-1.0,flipX!=flipZ);
}
const IMPULSE_SCALE:f32=1e12;
var<workgroup> reduction:array<f32,256>;

@compute @workgroup_size(256)
fn modal(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
  let m=group.x;var impulse=0.0;
  for(var index=lane;index<atomicLoad(&activeNodes[0]);index+=256u){
    let k=atomicLoad(&activeNodes[index+1u]);
    let j=atomicLoad(&nodes[k].impulse);
    if(j!=0){impulse+=f32(j)/IMPULSE_SCALE*basis[m*5329u+basisIndex(k)]*basisSign(k,u32(modes[m].pad));}
  }
  reduction[lane]=impulse;workgroupBarrier();
  for(var width=128u;width>0u;width/=2u){if(lane<width){reduction[lane]+=reduction[lane+width];}workgroupBarrier();}
  if(lane==0u){
    var mode=modes[m];let v=mode.v+reduction[0]*mode.invMass+kicks[m]*params.kick;
    let equilibrium=(params.force*mode.couplingAcc+mode.gravityAcc)/(mode.omega*mode.omega);
    let x=mode.q-equilibrium;mode.q=equilibrium+mode.a*x+mode.b*v;mode.v=mode.c*x+mode.d*v;modes[m]=mode;
  }
}

var<workgroup> modalValues:array<vec4f,34>;
@compute @workgroup_size(128)
fn field(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
  if(lane<params.modes){modalValues[lane]=vec4f(modes[lane].q,modes[lane].v,modes[lane].pad,0);}
  workgroupBarrier();
  let k=id.x;if(k>=5329u){return;}
  // Evaluate each quadrant sample once. Group modes by reflection parity, then
  // reconstruct all four quadrants without rereading the 34-mode basis.
  var evenEven=vec2f(0);var oddEven=vec2f(0);var evenOdd=vec2f(0);var oddOdd=vec2f(0);var ceiling=0.0;
  for(var m=0u;m<34u;m++){
    let mode=modalValues[m];let value=basis[m*5329u+k]*mode.xy;
    switch(u32(mode.z)){case 0u:{evenEven+=value;}case 1u:{oddEven+=value;}case 2u:{evenOdd+=value;}default:{oddOdd+=value;}}
    ceiling+=abs(mode.x);
  }
  let x=k%73u;let z=k/73u;
  let pp=(72u+z)*145u+72u+x;let np=(72u+z)*145u+72u-x;
  let pn=(72u-z)*145u+72u+x;let nn=(72u-z)*145u+72u-x;
  let positive=evenEven+evenOdd;let negative=evenEven-evenOdd;
  let oddPositive=oddEven+oddOdd;let oddNegative=oddEven-oddOdd;
  let a=positive+oddPositive;nodes[pp].h=a.x;nodes[pp].v=a.y;atomicStore(&nodes[pp].impulse,0);
  if(x>0u){let b=positive-oddPositive;nodes[np].h=b.x;nodes[np].v=b.y;atomicStore(&nodes[np].impulse,0);}
  if(z>0u){
    let c=negative+oddNegative;nodes[pn].h=c.x;nodes[pn].v=c.y;atomicStore(&nodes[pn].impulse,0);
    if(x>0u){let d=negative-oddNegative;nodes[nn].h=d.x;nodes[nn].v=d.y;atomicStore(&nodes[nn].impulse,0);}
  }
  if(k==0u){modes[params.modes].q=ceiling;atomicStore(&activeNodes[0],0u);}
}

struct Surface { h:f32,v:f32,sx:f32,sz:f32,corner:vec4u,weight:vec4f };
fn sampleSurface(position:vec2f)->Surface{
  let invCell=f32(params.grid-1u)/.3;
  let uv=clamp((position+.15)*invCell,vec2f(0),vec2f(f32(params.grid-1u)-.0001));
  let ij=vec2u(uv);let ab=fract(uv);let a=ab.x;let b=ab.y;let k=ij.y*params.grid+ij.x;
  let corner=vec4u(k,k+1u,k+params.grid,k+params.grid+1u);
  let w=vec4f((1-a)*(1-b),a*(1-b),(1-a)*b,a*b);
  let h=vec4f(nodes[corner.x].h,nodes[corner.y].h,nodes[corner.z].h,nodes[corner.w].h);
  let v=vec4f(nodes[corner.x].v,nodes[corner.y].v,nodes[corner.z].v,nodes[corner.w].v);
  return Surface(dot(h,w),dot(v,w),mix(h.y-h.x,h.w-h.z,b)*invCell,mix(h.z-h.x,h.w-h.y,a)*invCell,corner,w);
}
fn inverseSurfaceMass(s:Surface)->f32{
  let w=s.weight;let k=s.corner.x*10u;
  return w.x*w.x*gram[k]+2*w.x*w.y*gram[k+1u]+2*w.x*w.z*gram[k+2u]+2*w.x*w.w*gram[k+3u]
    +w.y*w.y*gram[k+4u]+2*w.y*w.z*gram[k+5u]+2*w.y*w.w*gram[k+6u]
    +w.z*w.z*gram[k+7u]+2*w.z*w.w*gram[k+8u]+w.w*w.w*gram[k+9u];
}

@compute @workgroup_size(64)
fn contact(@builtin(global_invocation_id) id:vec3u){
  let i=id.x;if(i>=params.count){return;}
  if(i==0u){var value=0.0;for(var m=0u;m<params.modes;m++){value+=modes[m].v*modes[m].pickup;}audio[params.audioIndex]=value;}
  var g=loadGrain(i);let r=g.p.w;let invMass=g.v.w;let dt=params.dt;
  g.p=vec4f(g.p.xyz+g.v.xyz*dt+vec3f(0,-.5*params.gravity*dt*dt,0),r);g.v.y-=params.gravity*dt;
  let radial2=dot(g.p.xz,g.p.xz);let limit=.15-r;
  if(radial2>limit*limit){let n=g.p.xz/sqrt(radial2);let outward=dot(g.v.xz,n);g.p=vec4f(n.x*limit,g.p.y,n.y*limit,r);if(outward>0){g.v=vec4f(g.v.x-(1+params.restitution)*outward*n.x,g.v.y,g.v.z-(1+params.restitution)*outward*n.y,invMass);}}
  if(g.p.y-r<=modes[params.modes].q+.000001){
    let s=sampleSurface(g.p.xz);let normal=normalize(vec3f(-s.sx,1,-s.sz));let gap=(g.p.y-s.h)*normal.y-r;
    if(gap<=0){
      g.p=vec4f(g.p.xyz-gap*normal,r);
      let relative=g.v.xyz-vec3f(0,s.v,0);let vn=dot(relative,normal);
      if(vn<0){
        let e=select(0.0,params.restitution,vn < -params.gravity*dt*3);
        let jn=-(1+e)*vn/(invMass+normal.y*normal.y*inverseSurfaceMass(s));
        let tangent=relative-vn*normal-r*cross(g.spin.xyz,normal);let slip=length(tangent);
        let jt=select(0.0,min(params.friction*jn,slip/(3.5*invMass))/max(slip,1e-20),slip>1e-12);
        let impulse=jn*normal-jt*tangent;g.v=vec4f(g.v.xyz+impulse*invMass,invMass);
        let angular=2.5*invMass/r;g.spin=vec4f(g.spin.xyz-angular*cross(normal,impulse),0);
        let rolling=g.spin.xyz-dot(g.spin.xyz,normal)*normal;let speed=length(rolling);
        let roll=min(1.0,params.rolling*jn*angular/max(speed,1e-20));g.spin=vec4f(g.spin.xyz-rolling*roll,0);
        for(var c=0u;c<4u;c++){atomicAdd(&nodes[s.corner[c]].impulse,i32(round(-impulse.y*s.weight[c]*IMPULSE_SCALE)));}
      }
    }
  }
  storeGrain(i,g);
}

fn hashCell(cell:vec3i)->u32{return ((u32(cell.x)*73856093u)^(u32(cell.y)*19349663u)^(u32(cell.z)*83492791u))&65535u;}
@compute @workgroup_size(256)
fn clearHeads(@builtin(global_invocation_id) id:vec3u){if(id.x<=65536u){atomicStore(&heads[id.x],-1);}}
@compute @workgroup_size(128)
fn buildHeads(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=params.count){return;}let cell=vec3i(i32(floor(grains[i].x/params.cell)),0,i32(floor(grains[i].z/params.cell)));links[i]=vec4i(cell,atomicExchange(&heads[hashCell(cell)],i32(i)));}
@compute @workgroup_size(128)
fn findNeighbors(@builtin(global_invocation_id) id:vec3u){
  let i=id.x;if(i>=params.count){return;}let cell=links[i].xyz;let p=grains[i];var count=0u;
  for(var z=-1;z<=1;z++){for(var x=-1;x<=1;x++){
    let c=cell+vec3i(x,0,z);var j=atomicLoad(&heads[hashCell(c)]);
    loop{if(j<0){break;}let link=links[u32(j)];if(u32(j)!=i&&all(link.xyz==c)){
      let other=grains[u32(j)];let d=p.xyz-other.xyz;let r=p.w+other.w;
      if(dot(d,d)<r*r){if(count<64u){neighbors[i].ids[count]=u32(j);}count++;}
    }j=link.w;}
  }}
  neighbors[i].count=count;atomicMax(&heads[65536],i32(count));
}
struct Delta { p:vec3f,v:vec3f,w:vec3f };
fn pairDelta(i:u32,j:u32,g:Grain)->Delta{
  let other=loadGrain(j);let offset=g.p.xyz-other.p.xyz;let d2=dot(offset,offset);let radius=g.p.w+other.p.w;
  if(d2>=radius*radius||d2<1e-24){return Delta(vec3f(0),vec3f(0),vec3f(0));}
  let d=sqrt(d2);let normal=offset/d;let invMass=g.v.w+other.v.w;
  // Symmetric degree scaling stabilizes simultaneous contacts. Isolated impacts
  // retain their exact restitution; momentum is equal/opposite for every pair.
  let scale=1.0/f32(max(1u,max(neighbors[i].count,neighbors[j].count)));
  let correction=normal*(radius-d)/invMass*g.v.w*scale;
  let relative=g.v.xyz-other.v.xyz;let vn=dot(relative,normal);
  if(vn>=0){return Delta(correction,vec3f(0),vec3f(0));}
  let jn=-(1+params.restitution)*vn/invMass;
  let tangent=relative-vn*normal-cross(g.p.w*g.spin.xyz+other.p.w*other.spin.xyz,normal);let slip=length(tangent);
  let jt=select(0.0,min(params.friction*jn,slip/(3.5*invMass))/max(slip,1e-20),slip>1e-12);
  let impulse=(jn*normal-jt*tangent)*scale;
  return Delta(correction,impulse*g.v.w,-2.5*g.v.w/g.p.w*cross(normal,impulse));
}
@compute @workgroup_size(128)
fn collide(@builtin(global_invocation_id) id:vec3u){
  let i=id.x;if(i>=params.count){return;}var g=loadGrain(i);var change=Delta(vec3f(0),vec3f(0),vec3f(0));let count=neighbors[i].count;
  if(count<=64u){for(var k=0u;k<count;k++){let d=pairDelta(i,neighbors[i].ids[k],g);change.p+=d.p;change.v+=d.v;change.w+=d.w;}}
  else{
    // Rare overfull neighborhoods use the complete cell lists, never drop pairs.
    let cell=links[i].xyz;
    for(var z=-1;z<=1;z++){for(var x=-1;x<=1;x++){
      let c=cell+vec3i(x,0,z);var j=atomicLoad(&heads[hashCell(c)]);
      loop{if(j<0){break;}let link=links[u32(j)];if(u32(j)!=i&&all(link.xyz==c)){let d=pairDelta(i,u32(j),g);change.p+=d.p;change.v+=d.v;change.w+=d.w;}j=link.w;}
    }}
  }
  g.p=vec4f(g.p.xyz+change.p,g.p.w);g.v=vec4f(g.v.xyz+change.v,g.v.w);g.spin=vec4f(g.spin.xyz+change.w,0);storeOutput(i,g);
}
@compute @workgroup_size(128)
fn draw(@builtin(global_invocation_id) id:vec3u){
  let i=id.x;
  if(i<params.count){drawData[i]=vec4f(grains[i].xyz*20+vec3f(0,.21,0),grains[i].w*20);}
  if(i<params.grid*params.grid){
    let x=i%params.grid;let z=i/params.grid;var normal=vec3f(0,1,0);
    if(x>0u&&x<params.grid-1u&&z>0u&&z<params.grid-1u){let scale=f32(params.grid-1u)/.6;normal=normalize(vec3f(-(nodes[i+1u].h-nodes[i-1u].h)*scale,1,-(nodes[i+params.grid].h-nodes[i-params.grid].h)*scale));}
    surfaceData[i]=vec4f(.21+nodes[i].h*20,normal);
  }
}
@compute @workgroup_size(128)
fn place(@builtin(global_invocation_id) id:vec3u){let i=id.x;if(i>=params.count){return;}var g=loadGrain(i);g.p.y=sampleSurface(g.p.xz).h+g.p.w+.00003;g.v=vec4f(0,0,0,g.v.w);g.spin=vec4f(0);storeGrain(i,g);}

// Compact touched membrane samples once, instead of visiting every sample for
// each mode. One global allocation per workgroup keeps atomic contention low.
var<workgroup> activeCount:atomic<u32>;
var<workgroup> activeBase:u32;
@compute @workgroup_size(128)
fn compact(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
  if(lane==0u){atomicStore(&activeCount,0u);}workgroupBarrier();
  var touched=false;var localIndex=0u;
  if(id.x<params.grid*params.grid){touched=atomicLoad(&nodes[id.x].impulse)!=0;}
  if(touched){localIndex=atomicAdd(&activeCount,1u);}workgroupBarrier();
  if(lane==0u){activeBase=atomicAdd(&activeNodes[0],atomicLoad(&activeCount));}workgroupBarrier();
  if(touched){atomicStore(&activeNodes[activeBase+localIndex+1u],id.x);}
}
