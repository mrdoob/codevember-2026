import { StorageBufferAttribute, IndirectStorageBufferAttribute, Vector4, Matrix4 } from 'three/webgpu';
import { storage, uniform, wgslFn, instanceIndex, localId, workgroupId, workgroupArray } from 'three/tsl';
import {
  STEP,
  SPACING,
  RADIUS,
  STRANDS,
  INITIAL_COUNT,
  GPU_CAPACITY,
  INLET_HEIGHT,
  DEFAULT_PHYSICS
} from './rope-config.js';
import { yarnSamples, SUBDIVISIONS, LEAD_SAMPLES, LEAD_SPACING, PLY_COUNT, PLY_SIDES } from './yarn-layout.js';

const WORKGROUP = 128,
  HASH_SIZE = 32768,
  CONTACT_PASSES = 4,
  ROPE_ITERATIONS = 8;
const BLOCK = 512,
  HALO = 64,
  TILE = BLOCK + HALO * 2,
  CELL = RADIUS * 2 + 0.008;
const SLEEP_TIME = 0.5,
  QUIET_SPEED = 0.035,
  WAKE_DISTANCE = 0.017;
const f = value => Number(value).toFixed(9);

// Positions never leave the GPU during animation. Rope constraints use a
// set of overlapping workgroup blocks; contacts read a snapshot and write a separate buffer.
export class GPURopeSimulation {
  constructor(renderer, { strands = STRANDS, count = GPU_CAPACITY } = {}) {
    this.renderer = renderer;
    this.strands = strands;
    this.count = count;
    this.total = strands * count;
    this.initialCount = Math.min(count, INITIAL_COUNT);
    this.isGPU = true;
    this.engine = 'WebGPU compute';
    this.time = 0;
    this.accumulator = 0;
    this.grab = null;
    this.settings = { ...DEFAULT_PHYSICS };
    this.attributes = [];
    this.kernels = [];
    const buffer = (length, size = 4, Type = Float32Array) => {
      const attribute = new StorageBufferAttribute(length, size, Type);
      this.attributes.push(attribute);
      return storage(attribute, size === 1 ? 'uint' : `vec${size}`, length);
    };
    this.a = buffer(this.total);
    this.b = buffer(this.total);
    this.previous = buffer(this.total);
    this.velocity = buffer(this.total);
    this.state = buffer(2);
    // First half: material normals. Second half: resting position and quiet time.
    // Pack these together to stay within eight storage bindings per kernel.
    this.normals = buffer(this.total * 2);
    this.materialPrevious = buffer(this.total * 2);
    this.contacts = buffer(this.total);
    this.heads = buffer(HASH_SIZE, 1, Uint32Array).toAtomic();
    this.links = buffer(this.total, 1, Uint32Array);
    this.samples = yarnSamples(count);
    this.frames = buffer(strands * this.samples * 3);
    // The GPU grows the visible prefix without reading particle counts back.
    const drawArguments = new IndirectStorageBufferAttribute(5, 1);
    this.attributes.push(drawArguments);
    this.drawArguments = storage(drawArguments, 'uint', 5);
    this.pickResult = buffer(2);
    this.parameters = uniform(new Vector4());
    this.grabReference = uniform(new Vector4(-1, 0, 0, 0));
    this.grabTarget = uniform(new Vector4());
    this.pickPointer = uniform(new Vector4());
    this.pickMatrix = uniform(new Matrix4());
    this.makeKernels();
    this.reset();
  }

  kernel(name, source, parameters, count, group = [WORKGROUP]) {
    const node = wgslFn(source)(parameters).compute(count, group).setName(name);
    this.kernels.push(node);
    return node;
  }

  makeKernels() {
    const N = this.total,
      C = this.count,
      S = this.strands,
      F = this.samples,
      blocks = Math.ceil(C / BLOCK) + 1;
    const ptr = 'ptr<storage,array<vec4<f32>>,read_write>';
    const shared = workgroupArray('vec4', TILE);
    const inlet = `
      let angle=f32(strand)*6.283185307/${f(S)};
      let t=clock.x*settings.y;
      let anchor=vec3<f32>(1.45*cos(angle+t*.23)+.48*sin(t*.71+angle*2.0),${f(INLET_HEIGHT)},
        1.05*sin(angle+t*.29)+.38*sin(t*.53+angle));`;
    const floorCode = (point, load, old) => `
      if(${point}.y<=${f(RADIUS)}) {
        ${load}+=${f(RADIUS)}-${point}.y;
        let slipVector=${point}.xz-${old}.xz;
        let slip=length(slipVector);
        if(slip>1e-10 && grip>0.0) {
          var fraction=min(1.0,grip*1.2*${load}/slip);
          if(slip<=grip*1.8*${load}) { fraction=1.0; }
          ${point}.x-=slipVector.x*fraction;${point}.z-=slipVector.y*fraction;
        }
      }
      ${point}=clamp(${point},vec3<f32>(-6.8,${f(RADIUS)},-6.8),vec3<f32>(6.8,7.5,6.8));`;

    this.resetNode = this.kernel(
      'Reset yarn',
      `fn resetYarn(id:u32,a:${ptr},b:${ptr},previous:${ptr},velocity:${ptr},state:${ptr},materials:${ptr},contacts:${ptr}) -> void {
      if(id<${N}u) {
        let strand=id/${C}u;let local=id%${C}u;let angle=f32(strand)*6.283185307/${f(S)};
        let length=select(0.0,f32(local)*${f(SPACING)},local<${this.initialCount}u);
        let p=vec4<f32>(1.45*cos(angle)+.48*sin(angle*2.0),${f(INLET_HEIGHT)}-length,1.43*sin(angle),0.0);
        (*a)[id]=p;(*b)[id]=p;(*previous)[id]=p;(*velocity)[id]=vec4<f32>(0.0);
        (*materials)[id]=vec4<f32>(1.0,0.0,0.0,0.0);(*materials)[${N}u+id]=p;(*contacts)[id]=vec4<f32>(0.0);
      }
      if(id==0u) { (*state)[0]=vec4<f32>(0.0,${f(SPACING)},0.0,0.0);(*state)[1]=vec4<f32>(${f(this.initialCount)},0.0,0.0,0.0); }
    }`,
      {
        id: instanceIndex,
        a: this.a,
        b: this.b,
        previous: this.previous,
        velocity: this.velocity,
        state: this.state,
        materials: this.normals,
        contacts: this.contacts
      },
      N
    );

    this.clockNode = this.kernel(
      'Feed yarn',
      `fn feedYarn(state:${ptr},settings:vec4<f32>) -> void {
      var clock=(*state)[0];var live=(*state)[1];clock.w=0.0;
      clock.x+=${f(STEP)};clock.y+=settings.x*${f(STEP)};
      if(clock.y>${f(SPACING * 2)}) {
        clock.y-=${f(SPACING)};clock.z+=${f(SPACING)};clock.w=1.0;
        live.x=min(${f(C)},live.x+1.0);
      }
      (*state)[0]=clock;(*state)[1]=live;
    }`,
      { state: this.state, settings: this.parameters },
      1,
      [1]
    );

    this.predictNode = this.kernel(
      'Integrate yarn',
      `fn predictYarn(id:u32,a:${ptr},b:${ptr},previous:${ptr},velocity:${ptr},state:${ptr},materials:${ptr},carry:${ptr},settings:vec4<f32>) -> void {
      if(id>=${N}u) { return; }
      let strand=id/${C}u;let local=id%${C}u;let clock=(*state)[0];${inlet}
      if(local>=u32((*state)[1].x)) { (*b)[id]=(*a)[id];return; }
      let source=id-select(0u,1u,clock.w>0.5 && local>0u);
      var p=(*a)[source].xyz;
      if(local==0u) { p=anchor; }
      (*previous)[id]=vec4<f32>(p,0.0);
      (*carry)[id]=(*materials)[source];(*carry)[${N}u+id]=(*materials)[${N}u+source];
      if(local>0u) {
        var v=(*velocity)[source].xyz*.997;v.y-=${f(9.81 * STEP)};
        p+=v*${f(STEP)};
      }
      (*b)[id]=vec4<f32>(p,0.0);
    }`,
      {
        id: instanceIndex,
        a: this.a,
        b: this.b,
        previous: this.previous,
        velocity: this.velocity,
        state: this.state,
        materials: this.normals,
        carry: this.materialPrevious,
        settings: this.parameters
      },
      N
    );

    const projectCode = `fn projectYarn(tid:u32,group:u32,shift:i32,input:${ptr},output:${ptr},previous:${ptr},state:${ptr},
        points:ptr<workgroup,array<vec4<f32>,${TILE}>>,settings:vec4<f32>,grab:vec4<f32>,handle:vec4<f32>) -> void {
      let strand=group/${blocks}u;let block=group%${blocks}u;
      let start=i32(block)*${BLOCK}-shift-${HALO};
      let base=strand*${C}u;let clock=(*state)[0];
      let live=i32((*state)[1].x);let grip=settings.w;
      let grabIndex=i32(grab.x)+i32(round((clock.z-grab.y)/${f(SPACING)}));
      let grabStrandLocal=grabIndex-i32(base);let grabLocal=grabStrandLocal-start;
      let grabbing=grab.z>0.5 && u32(max(0.0,grab.x))/${C}u==strand && grabStrandLocal>=4 && grabStrandLocal<live-3 && grabLocal>=0 && grabLocal<${TILE};
      for(var n=tid;n<${TILE}u;n+=${WORKGROUP}u) { (*points)[n]=(*input)[base+u32(clamp(start+i32(n),0,live-1))]; }
      workgroupBarrier();
      for(var iteration=0u;iteration<${ROPE_ITERATIONS}u;iteration++) {
        // Four edge colors make the two-segment bend constraints disjoint.
        for(var color=0u;color<4u;color++) {
          for(var a=tid*4u+color;a+2u<${TILE}u;a+=${WORKGROUP * 4}u) {
            let global=start+i32(a);
            if(global<=0 || global+2>=live) { continue; }
            let b=a+2u;let delta=(*points)[b].xyz-(*points)[a].xyz;let distance=length(delta);
            if(distance>1e-8) {
              let strength=.016+(1.0-settings.z)*.07;
              let correction=delta*((distance-${f(SPACING * 2)})/distance*strength*.5);
              (*points)[a]=vec4<f32>((*points)[a].xyz+correction,(*points)[a].w);
              (*points)[b]=vec4<f32>((*points)[b].xyz-correction,(*points)[b].w);
            }
          }
          workgroupBarrier();
        }
        // Even/odd edges share no particles within a color. All writes are
        // workgroup-local and every color ends at a workgroup-wide barrier.
        for(var color=0u;color<2u;color++) {
          for(var a=tid*2u+color;a+1u<${TILE}u;a+=${WORKGROUP * 2}u) {
            let global=start+i32(a);if(global<0 || global+1>=live) { continue; }
            let b=a+1u;let delta=(*points)[b].xyz-(*points)[a].xyz;let distance=length(delta);
            if(distance>1e-8) {
              let wa=select(1.0,0.0,global==0);let rest=select(${f(SPACING)},clock.y,global==0);
              let correction=delta*((distance-rest)/distance/(wa+1.0+.00432));
              (*points)[a]=vec4<f32>((*points)[a].xyz+correction*wa,(*points)[a].w);
              (*points)[b]=vec4<f32>((*points)[b].xyz-correction,(*points)[b].w);
            }
          }
          workgroupBarrier();
        }
        var pull=vec3<f32>(0.0);
        if(grabbing) { let delta=handle.xyz-(*points)[u32(grabLocal)].xyz;pull=delta*min(1.0,.1/max(length(delta),1e-8)); }
        workgroupBarrier();
        for(var n=tid;n<${TILE}u;n+=${WORKGROUP}u) {
          let global=start+i32(n);if(global<=0 || global>=live) { continue; }
          var point=(*points)[n].xyz;var load=(*points)[n].w;let old=(*previous)[base+u32(global)].xyz;
          let gap=abs(i32(n)-grabLocal);
          if(grabbing && gap<=3) { point+=pull*(.38*exp(-f32(gap*gap)*.28)); }
          ${floorCode('point', 'load', 'old')}
          (*points)[n]=vec4<f32>(point,load);
        }
        workgroupBarrier();
      }
      for(var n=tid;n<${BLOCK}u;n+=${WORKGROUP}u) {
        let global=start+${HALO}+i32(n);
        if(global>=0 && global<live) { (*output)[base+u32(global)]=(*points)[n+${HALO}u]; }
      }
    }`;
    const projectParameters = {
      tid: localId.x,
      group: workgroupId.x,
      output: this.b,
      previous: this.previous,
      state: this.state,
      points: shared,
      settings: this.parameters,
      grab: this.grabReference,
      handle: this.grabTarget
    };
    // An explicit dispatch size avoids an implicit per-invocation early return
    // around the workgroup barriers, including for short test ropes.
    // Overlapping reads require distinct source/destination buffers. The first
    // pass reads the prediction in b and writes a; copy a back to b afterwards.
    this.projectFirst = this.kernel(
      'Project incoming yarn',
      projectCode,
      { ...projectParameters, shift: 0, input: this.b, output: this.a },
      [S * blocks]
    );
    this.project = this.kernel(
      'Project yarn constraints',
      projectCode,
      { ...projectParameters, shift: 0, input: this.a },
      [S * blocks]
    );
    this.projectShifted = this.kernel(
      'Project offset yarn blocks',
      projectCode,
      { ...projectParameters, shift: BLOCK / 2, input: this.a },
      [S * blocks]
    );
    this.copyPrediction = this.kernel(
      'Copy projected yarn',
      `fn copyYarn(id:u32,a:${ptr},b:${ptr}) -> void { if(id<${N}u) { (*b)[id]=(*a)[id]; } }`,
      { id: instanceIndex, a: this.a, b: this.b },
      N
    );

    const hash = `fn yarnHash(cell:vec3<i32>) -> u32 { let u=bitcast<vec3<u32>>(cell);return ((u.x*73856093u)^(u.y*19349663u)^(u.z*83492791u))&${HASH_SIZE - 1}u; }`;
    this.clearNode = this.kernel(
      'Clear yarn bins',
      `fn clearYarnBins(id:u32,heads:ptr<storage,array<atomic<u32>>,read_write>) -> void { atomicStore(&(*heads)[id],0xffffffffu); }`,
      { id: instanceIndex, heads: this.heads },
      HASH_SIZE
    );
    this.binNode = this.kernel(
      'Bin yarn contacts',
      `fn binYarn(id:u32,positions:${ptr},state:${ptr},heads:ptr<storage,array<atomic<u32>>,read_write>,links:ptr<storage,array<u32>,read_write>) -> void {
      if(id>=${N}u) { return; }
      if(id%${C}u>=u32((*state)[1].x)) { return; }
      let cell=vec3<i32>(floor((*positions)[id].xyz/${f(CELL)}));
      (*links)[id]=atomicExchange(&(*heads)[yarnHash(cell)],id);
    }
    ${hash}`,
      { id: instanceIndex, positions: this.b, state: this.state, heads: this.heads, links: this.links },
      N
    );

    this.contactNode = this.kernel(
      'Yarn contact and friction',
      `fn contactYarn(id:u32,input:${ptr},output:${ptr},previous:${ptr},state:${ptr},heads:ptr<storage,array<atomic<u32>>,read_write>,links:ptr<storage,array<u32>,read_write>,contactInfo:${ptr},settings:vec4<f32>) -> void {
      if(id>=${N}u) { return; }
      let original=(*input)[id];let p=original.xyz;let local=id%${C}u;
      if(local==0u || local>=u32((*state)[1].x)) { (*output)[id]=original;(*contactInfo)[id]=vec4<f32>(0.0);return; }
      let old=(*previous)[id].xyz;let displacement=p-old;
      let grip=settings.w;
      let cell=vec3<i32>(floor(p/${f(CELL)}));
      var correction=vec3<f32>(0.0);var contacts=0.0;var support=0.0;var penetration=0.0;
      for(var z=-1;z<=1;z++) { for(var y=-1;y<=1;y++) { for(var x=-1;x<=1;x++) {
        let neighbor=cell+vec3<i32>(x,y,z);var other=atomicLoad(&(*heads)[yarnHash(neighbor)]);
        var visited=0u;
        loop {
          if(other==0xffffffffu || visited>=${N}u) { break; }
          let b=other;other=(*links)[b];visited++;
          if(b==id || (b/${C}u==id/${C}u && abs(i32(b)-i32(id))<=2)) { continue; }
          let q=(*input)[b].xyz;
          if(any(vec3<i32>(floor(q/${f(CELL)}))!=neighbor)) { continue; }
          var delta=p-q;var distance=length(delta);
          if(distance<${f(CELL)} && delta.y>distance*.3) { support=1.0; }
          if(distance>=${f(RADIUS * 2)}) { continue; }
          if(distance<1e-8) { delta=vec3<f32>(select(-.0001,.0001,id>b),0.0,0.0);distance=.0001; }
          let normal=delta/distance;let weight=1.0/(1.0+select(1.0,0.0,b%${C}u==0u));
          let load=(${f(RADIUS * 2)}-distance)*.9;
          penetration=max(penetration,${f(RADIUS * 2)}-distance);
          correction+=normal*(load*weight);
          let relative=displacement-(q-(*previous)[b].xyz);
          let tangent=relative-normal*dot(relative,normal);let slip=length(tangent);
          if(slip>1e-10 && grip>0.0) {
            var fraction=min(1.0,grip*.45*load/slip);
            if(slip<=grip*.7*load) { fraction=1.0; }
            correction-=tangent*(fraction*weight);
          }
          contacts+=1.0;
        }
      } } }
      // Relax dense contacts to avoid summing an unbounded number of Jacobi
      // corrections. Each invocation writes only its own output particle.
      var point=p+correction/max(1.0,contacts*.65);var load=original.w;
      ${floorCode('point', 'load', 'old')}
      (*output)[id]=vec4<f32>(point,load);
      (*contactInfo)[id]=vec4<f32>(support,penetration,contacts,0.0);
    }
    ${hash}`,
      {
        id: instanceIndex,
        input: this.b,
        output: this.a,
        previous: this.previous,
        state: this.state,
        heads: this.heads,
        links: this.links,
        contactInfo: this.contacts,
        settings: this.parameters
      },
      N
    );

    this.velocityNode = this.kernel(
      'Settle yarn and update velocity',
      `fn finishYarn(id:u32,positions:${ptr},result:${ptr},previous:${ptr},velocity:${ptr},state:${ptr},materials:${ptr},carry:${ptr},contacts:${ptr},settings:vec4<f32>,grab:vec4<f32>) -> void {
      if(id>=${N}u) { return; }
      var p=(*positions)[id].xyz;let old=(*previous)[id].xyz;let resting=(*carry)[${N}u+id];
      let clock=(*state)[0];let local=id%${C}u;
      let live=u32((*state)[1].x);
      if(local>=live) { (*result)[id]=(*positions)[id];(*velocity)[id]=vec4<f32>(0.0);return; }
      let grabIndex=i32(grab.x)+i32(round((clock.z-grab.y)/${f(SPACING)}));
      let nearGrab=grab.z>0.5 && u32(max(0.0,grab.x))/${C}u==id/${C}u && abs(i32(id)-grabIndex)<32;
      var supported=p.y<=${f(RADIUS + 0.004)} || (*contacts)[id].x>.5;
      if(local>0u && local<live-1u) {
        let left=(*carry)[${N}u+id-1u];let right=(*carry)[${N}u+id+1u];
        supported=supported || (left.w>=${f(SLEEP_TIME)} && right.w>=${f(SLEEP_TIME)} && p.y<=max(left.y,right.y)+.04);
      }
      var age=0.0;var restPosition=p;
      let canRest=supported && !nearGrab && settings.w>0.0 && local>0u;
      if(canRest) {
        if(resting.w>=${f(SLEEP_TIME)}) {
          // A sleeping contact remains in world space. A pull, impact, or
          // loss of support wakes it; weak numerical corrections do not.
          if(length(p-resting.xyz)<${f(WAKE_DISTANCE)}*settings.w/.85 && (*contacts)[id].y<.025) {
            p=resting.xyz;restPosition=p;age=${f(SLEEP_TIME)};
          }
        } else if(length(p-old)<${f(QUIET_SPEED * STEP)}) {
          age=min(${f(SLEEP_TIME)},resting.w+${f(STEP)});
        }
      }
      (*materials)[${N}u+id]=vec4<f32>(restPosition,age);
      (*result)[id]=vec4<f32>(p,(*positions)[id].w);
      var v=clamp((p-old)/${f(STEP)},vec3<f32>(-18.0),vec3<f32>(18.0));
      if(id%${C}u==0u) { v=vec3<f32>(0.0); }
      if(p.y<=${f(RADIUS + 0.005)}) { v.x*=1.0-settings.w*.16;v.z*=1.0-settings.w*.16;v.y=max(0.0,v.y)*.15; }
      (*velocity)[id]=vec4<f32>(v,0.0);
    }`,
      {
        id: instanceIndex,
        positions: this.a,
        result: this.b,
        previous: this.previous,
        velocity: this.velocity,
        state: this.state,
        materials: this.normals,
        carry: this.materialPrevious,
        contacts: this.contacts,
        settings: this.parameters,
        grab: this.grabReference
      },
      N
    );
    this.orientNode = this.kernel(
      'Advect material frames',
      `fn orientYarn(id:u32,positions:${ptr},previous:${ptr},carry:${ptr},result:${ptr},materials:${ptr},state:${ptr}) -> void {
      if(id>=${N}u) { return; }
      let local=id%${C}u;let base=id-local;
      let live=u32((*state)[1].x);
      if(local>=live) { (*result)[id]=(*positions)[id];return; }
      let before=base+u32(max(0,i32(local)-1));let after=base+min(live-1u,local+1u);
      var oldT=(*previous)[after].xyz-(*previous)[before].xyz;
      var newT=(*positions)[after].xyz-(*positions)[before].xyz;
      if(local==0u) {
        oldT-=vec3<f32>(0.0,${f(SPACING)},0.0);newT-=vec3<f32>(0.0,${f(SPACING)},0.0);
      }
      oldT=normalize(oldT+vec3<f32>(0.0,1e-10,0.0));newT=normalize(newT+vec3<f32>(0.0,1e-10,0.0));
      var normal=(*carry)[id].xyz;
      let axis=cross(oldT,newT);let cosine=dot(oldT,newT);
      if(cosine>-.9999) { normal+=cross(axis,normal)+cross(axis,cross(axis,normal))/(1.0+cosine); }
      normal-=newT*dot(normal,newT);
      if(length(normal)<1e-6) { normal=cross(newT,vec3<f32>(0.0,0.0,1.0)); }
      (*materials)[id]=vec4<f32>(normalize(normal),0.0);(*result)[id]=(*positions)[id];
    }`,
      {
        id: instanceIndex,
        positions: this.b,
        previous: this.previous,
        carry: this.materialPrevious,
        result: this.a,
        materials: this.normals,
        state: this.state
      },
      N
    );

    this.frameNode = this.kernel(
      'Smooth yarn centerlines',
      `fn yarnFrames(id:u32,positions:${ptr},normals:${ptr},frames:${ptr},state:${ptr},draw:ptr<storage,array<u32>,read_write>) -> void {
      if(id>=${S * F}u) { return; }
      let strand=id/${F}u;let sample=id%${F}u;let base=strand*${C}u;let frameBase=strand*${F * 3}u;
      let live=u32((*state)[1].x);let samples=${LEAD_SAMPLES + 1}u+(live-1u)*${SUBDIVISIONS}u;
      if(id==0u) {
        (*draw)[0]=${PLY_COUNT * PLY_SIDES * 3}u+(samples-1u)*${PLY_COUNT * PLY_SIDES * 6}u;
        (*draw)[1]=1u;(*draw)[2]=0u;(*draw)[3]=0u;(*draw)[4]=0u;
      }
      if(sample>=samples) { return; }
      let cut=select(0.0,clamp((*state)[0].y/${f(SPACING)}-1.0,0.0,1.0),live==${C}u);
      let center=sampleYarn(i32(sample),base,positions,live,cut,0.0);
      // Differentiate the curve, not the shrinking sample spacing at the cut.
      var tangent=sampleYarn(i32(sample),base,positions,live,cut,.1)-sampleYarn(i32(sample),base,positions,live,cut,-.1);
      tangent=normalize(tangent+vec3<f32>(0.0,1e-10,0.0));
      var normal=vec3<f32>(1.0,0.0,0.0);
      if(sample>=${LEAD_SAMPLES}u) {
        let u=yarnCoordinate(i32(sample),live,cut);let n=u32(floor(u));
        normal=mix((*normals)[base+n].xyz,(*normals)[base+min(live-1u,n+1u)].xyz,fract(u));
      }
      normal-=tangent*dot(normal,tangent);
      if(length(normal)<1e-6) { normal=cross(tangent,vec3<f32>(0.0,0.0,1.0)); }
      normal=normalize(normal);let binormal=cross(tangent,normal);
      (*frames)[frameBase+sample]=vec4<f32>(center.x,max(${f(RADIUS * 0.98)},center.y),center.z,1.0);
      (*frames)[frameBase+${F}u+sample]=vec4<f32>(normal,0.0);(*frames)[frameBase+${F * 2}u+sample]=vec4<f32>(binormal,0.0);
    }
    fn yarnCoordinate(sample:i32,live:u32,cut:f32) -> f32 {
      let u=clamp(f32(sample-${LEAD_SAMPLES})/${f(SUBDIVISIONS)},0.0,f32(live-1u));
      return u-max(0.0,u-f32(live-2u))*cut;
    }
    fn sampleYarn(sample:i32,base:u32,positions:${ptr},live:u32,cut:f32,offset:f32) -> vec3<f32> {
      if(sample<${LEAD_SAMPLES}) { return (*positions)[base].xyz+vec3<f32>(0.0,f32(${LEAD_SAMPLES}-sample)*${f(LEAD_SPACING)}-offset*${f(SPACING)},0.0); }
      let u=clamp(yarnCoordinate(sample,live,cut)+offset,0.0,f32(live-1u));
      let n=i32(floor(u));let t=fract(u);
      let a=(*positions)[base+u32(max(0,n-1))].xyz;let b=(*positions)[base+u32(n)].xyz;
      let c=(*positions)[base+min(live-1u,u32(n+1))].xyz;let d=(*positions)[base+min(live-1u,u32(n+2))].xyz;
      return b+.5*t*(c-a+t*(2.0*a-5.0*b+4.0*c-d+t*(3.0*(b-c)+d-a)));
    }`,
      {
        id: instanceIndex,
        positions: this.a,
        normals: this.normals,
        frames: this.frames,
        state: this.state,
        draw: this.drawArguments
      },
      S * F
    );

    this.pickNode = this.kernel(
      'Pick yarn',
      `fn pickYarn(positions:${ptr},state:${ptr},result:${ptr},matrix:mat4x4<f32>,pointer:vec4<f32>) -> void {
      var best=1e10;var selected=vec4<f32>(0.0,0.0,0.0,-1.0);
      for(var id=0u;id<${N}u;id++) {
        let local=id%${C}u;if(local<4u || local>u32((*state)[1].x)-4u) { continue; }
        let point=(*positions)[id].xyz;let clip=matrix*vec4<f32>(point,1.0);
        if(clip.w<=0.0) { continue; }
        let ndc=clip.xyz/clip.w;if(ndc.z<0.0 || ndc.z>1.0) { continue; }
        let screen=vec2<f32>((ndc.x*.5+.5)*pointer.z,(-ndc.y*.5+.5)*pointer.w);
        let distance=length(screen-pointer.xy);if(distance>16.0) { continue; }
        let score=ndc.z+distance*.0003;
        if(score<best) { best=score;selected=vec4<f32>(point,f32(id)); }
      }
      (*result)[0]=selected;(*result)[1]=(*state)[0];
    }`,
      {
        positions: this.a,
        state: this.state,
        result: this.pickResult,
        matrix: this.pickMatrix,
        pointer: this.pickPointer
      },
      1,
      [1]
    );
    this.stepNodes = [this.clockNode, this.predictNode];
    for (let iteration = 0; iteration < CONTACT_PASSES; iteration++) {
      if (iteration === 0) this.stepNodes.push(this.projectFirst, this.copyPrediction);
      else this.stepNodes.push(iteration % 2 ? this.projectShifted : this.project);
      this.stepNodes.push(this.clearNode, this.binNode, this.contactNode);
    }
    this.stepNodes.push(this.velocityNode, this.orientNode);
  }

  syncSettings() {
    const s = this.settings;
    this.parameters.value.set(s.feed, s.wander, s.softness, s.friction);
  }
  reset() {
    this.time = 0;
    this.accumulator = 0;
    this.endGrab();
    this.syncSettings();
    this.renderer.compute([this.resetNode, this.frameNode]);
  }
  advance(dt) {
    if (!Number.isFinite(dt) || dt < 0) return 0;
    this.accumulator += Math.min(dt, 0.1);
    let steps = 0;
    while (this.accumulator >= STEP - 1e-10) {
      this.accumulator -= STEP;
      steps++;
    }
    if (!steps) return 0;
    this.syncSettings();
    const commands = [];
    for (let i = 0; i < steps; i++) commands.push(...this.stepNodes);
    commands.push(this.frameNode);
    this.renderer.compute(commands);
    this.time += steps * STEP;
    return steps;
  }
  async pick(x, y, camera, width, height) {
    camera.updateMatrixWorld();
    this.pickMatrix.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.pickPointer.value.set(x, y, width, height);
    this.renderer.compute(this.pickNode);
    const data = new Float32Array(await this.renderer.getArrayBufferAsync(this.pickResult.value));
    if (data[3] < 0) return null;
    return { index: Math.round(data[3]), position: Array.from(data.slice(0, 3)), travel: data[6] };
  }
  beginGrab(index, target, travel = 0) {
    const n = index % this.count;
    const live = Math.min(this.count, this.initialCount + Math.round(travel / SPACING));
    if (!Number.isInteger(index) || index < 0 || index >= this.total || n < 4 || n > live - 4) return false;
    this.grab = { index, target: Array.from(target), travel };
    this.grabReference.value.set(index, travel, 1, 0);
    this.moveGrab(target);
    return true;
  }
  moveGrab(target) {
    if (this.grab) {
      this.grab.target = Array.from(target);
      this.grabTarget.value.set(target[0], target[1], target[2], 0);
    }
  }
  endGrab() {
    this.grab = null;
    this.grabReference.value.z = 0;
  }
  async inspect() {
    // Explicit diagnostic only. Animation and pointer motion do not read back
    // particle positions; picking reads just two vec4s when a drag starts.
    const data = new Float32Array(await this.renderer.getArrayBufferAsync(this.a.value));
    const state = new Float32Array(await this.renderer.getArrayBufferAsync(this.state.value));
    const live = Math.round(state[4]),
      particles = live * this.strands;
    let minY = Infinity,
      maxY = -Infinity,
      maxStretch = 0,
      sumStretch = 0;
    for (let i = 0; i < this.total; i++) {
      if (i % this.count >= live) continue;
      const j = i * 4;
      minY = Math.min(minY, data[j + 1]);
      maxY = Math.max(maxY, data[j + 1]);
      if (i % this.count < 2) continue;
      const error = Math.abs(
        Math.hypot(data[j] - data[j - 4], data[j + 1] - data[j - 3], data[j + 2] - data[j - 2]) / SPACING - 1
      );
      maxStretch = Math.max(maxStretch, error);
      sumStretch += error;
    }
    const materials = new Float32Array(await this.renderer.getArrayBufferAsync(this.normals.value));
    let sleeping = 0;
    for (let i = 0; i < this.total; i++)
      if (i % this.count < live && materials[(this.total + i) * 4 + 3] >= SLEEP_TIME - 1e-6) sleeping++;
    return {
      engine: this.engine,
      time: this.time,
      particles,
      capacity: this.total,
      sleeping,
      finite: data.every(Number.isFinite) && materials.every(Number.isFinite),
      minY,
      maxY,
      maxStretch,
      meanStretch: sumStretch / (particles - this.strands * 2)
    };
  }
  dispose() {
    for (const kernel of this.kernels) kernel.dispose();
    for (const attribute of this.attributes) attribute.dispose();
  }
}
