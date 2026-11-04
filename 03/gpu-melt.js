import * as THREE from 'three/webgpu';
import { instanceIndex, storage, uniform, wgslFn } from 'three/tsl';
import { triTable } from 'three/addons/objects/MarchingCubes.js';
import { PALETTE, CORE_PALETTE, GRADIENT_COLOR, MAX_BLOBS, KNOT_PATH, KNOT_RADIUS, sculptureDistance } from './sculpture.js';
import { WAX_LIGHT_DIRECTIONS } from './lighting-config.js';
import { simulationStep } from './runtime.js';
import { HEAT_RADIUS, HEAT_FALLOFF, HEAT_DURATION, heatSourceHeight } from './heat-source.js';

// Preallocated storage: 715,008 cells, at most 60,000 output triangles. No growth,
// texture raymarching, CPU meshing, or per-frame particle readback.
export const GRID = Object.freeze({ x: 113, y: 85, z: 77, cell: .065, min: [-3.6, -.48, -2.4] });
export const MAX_VERTICES = 180000;
export const MELT_RATE = 10;
const VOXELS = GRID.x * GRID.y * GRID.z;
const CELLS = (GRID.x - 1) * (GRID.y - 1) * (GRID.z - 1);
const BIN = { x: 25, y: 19, z: 17, size: .3 };
const BINS = BIN.x * BIN.y * BIN.z;
const vec3 = v => `vec3<f32>(${v.map(n => n.toFixed(6)).join(',')})`;
const MIN = vec3(GRID.min);

export class GPUMelt {
  constructor(seed, material) {
    if (seed.groups.length > MAX_BLOBS) throw new Error('Blob budget exceeded');
    this.seed = seed; this.n = seed.groups.length; this.time = 0; this.frame = 0; this.accumulator = 0;
    this.attributes = []; this.kernelSources = [];
    const buffer = (count, size, type = Float32Array, data) => {
      const attribute = new THREE.StorageBufferAttribute(data || count, size, type);
      this.attributes.push(attribute);
      return storage(attribute, size === 1 ? (type === Int32Array ? 'int' : type === Uint32Array ? 'uint' : 'float') : `vec${size}`, count);
    };
    // Knot centerline shares the rest binding, retaining the eight-buffer limit.
    this.rest = buffer(MAX_BLOBS + KNOT_PATH.length, 4);
    this.colors = buffer(MAX_BLOBS, 4);
    this.primitive = uniform(seed.groups[0], 'uint');
    this.centerY = uniform(seed.centerY);
    this.inverseRotation = uniform(new THREE.Vector4());
    this.setSeed(seed);
    this.positions = [buffer(MAX_BLOBS, 4), buffer(MAX_BLOBS, 4)];
    this.velocities = [buffer(MAX_BLOBS, 4), buffer(MAX_BLOBS, 4)];
    this.surfaceCenters = buffer(MAX_BLOBS, 4);
    // The second half marks bins whose 27-bin neighborhood contains wax.
    // Reuse this binding so the field kernel still needs only eight buffers.
    this.heads = buffer(BINS * 2, 1, Uint32Array).toAtomic();
    this.next = buffer(MAX_BLOBS, 1, Uint32Array);
    this.field = buffer(VOXELS, 4);
    // vec3 storage already has a 16-byte stride. Use its fourth component for
    // liquid fraction so the material can soften without another buffer/pass.
    this.fieldNormals = buffer(VOXELS, 4);
    this.table = buffer(4096, 1, Int32Array, new Int32Array(triTable));
    this.vertices = buffer(MAX_VERTICES, 3);
    this.normals = buffer(MAX_VERTICES, 3);
    this.pigment = buffer(MAX_VERTICES, 3);
    this.thickness = buffer(MAX_VERTICES, 4);
    this.drawAttribute = new THREE.IndirectStorageBufferAttribute(new Uint32Array([0, 1, 0, 0, 0, 0, 0, 0]), 1);
    this.draw = storage(this.drawAttribute, 'uint', 8).toAtomic();
    this.dt = uniform(1 / 30); this.heat = uniform(1); this.viscosity = uniform(.75); this.tension = uniform(1);
    this.heatSphere = uniform(new THREE.Vector4(0, heatSourceHeight(this.top, 0), 0, HEAT_RADIUS));
    this.fireSphere = uniform(this.heatSphere.value.clone());

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', this.vertices.value);
    geometry.setAttribute('normal', this.normals.value);
    geometry.setAttribute('color', this.pigment.value);
    geometry.setAttribute('meltThickness', this.thickness.value);
    geometry.setIndirect(this.drawAttribute);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 2, 0), 6);
    this.mesh = new THREE.Mesh(geometry, material); this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.makeKernels();
  }
  setSeed(seed) {
    if (seed.groups.length > MAX_BLOBS) throw new Error('Blob budget exceeded');
    this.seed = seed; this.n = seed.groups.length;
    this.top = Math.max(...seed.positions.filter((_, i) => i % 3 === 1)) + seed.spacing * .6;
    this.primitive.value = seed.groups[0]; this.centerY.value=seed.centerY;
    this.inverseRotation.value.fromArray(seed.inverseRotation);
    const rest = this.rest.value.array;
    rest.fill(0);
    for (let i = 0; i < MAX_BLOBS; i++) {
      // Shape ID is already a uniform. Reuse w for relative heat capacity.
      rest[i * 4 + 3] = i < this.n ? seed.heatCapacity[i] : -1;
      if (i < this.n) rest.set(seed.positions.subarray(i * 3, i * 3 + 3), i * 4);
    }
    for (let i = 0; i < KNOT_PATH.length; i++) rest.set(KNOT_PATH[i], (MAX_BLOBS + i) * 4);
    this.rest.value.needsUpdate = true;
    this.updateColors(seed);
  }
  updateColors(seed) {
    // Color is attached to particle identity, so the diagonal travels with the
    // wax. Upload only on shape changes; reuse the existing color binding.
    const rest = this.rest.value.array;
    const projections = new Float32Array(this.n), depths = new Float32Array(this.n);
    for (let i = 0; i < this.n; i++) {
      projections[i] = rest[i*4] + rest[i*4+1] - rest[i*4+2]*.25;
      depths[i] = Math.max(0, -sculptureDistance(seed, rest[i*4], rest[i*4+1], rest[i*4+2]));
    }
    const low = Math.min(...projections), span = Math.max(...projections) - low;
    const shell = seed.spacing * .85;
    const depthSpan = Math.max(.000001, Math.min(seed.spacing * 1.5, Math.max(...depths) - shell));
    const baseColor = new THREE.Color(PALETTE[seed.groups[0]]), tipColor = new THREE.Color(GRADIENT_COLOR);
    const coreColor = new THREE.Color(CORE_PALETTE[seed.groups[0]]);
    const c = new THREE.Color(), colors = this.colors.value.array;
    colors.fill(0);
    for (let i = 0; i < this.n; i++) {
      const t = (projections[i] - low) / Math.max(span, .000001);
      c.copy(baseColor).lerp(tipColor, t*t*(3-2*t));
      // Preserve the pastel outer gradient, then blend into a pale colored
      // interior. Pigment travels with the wax as melting exposes the core.
      const core = Math.max(0, Math.min(1, (depths[i] - shell) / depthSpan));
      c.lerp(coreColor, core*core*(3-2*core));
      colors.set([c.r, c.g, c.b, 1], i*4);
    }
    this.colors.value.needsUpdate = true;
  }
  sampleSurface(position, fallback) {
    // Eight field reads supply smooth normals and the local liquid fraction.
    const gradients = storage(this.fieldNormals.value, 'vec4', VOXELS).toReadOnly();
    return wgslFn(`fn meltGradient(p:vec3<f32>, fallback:vec3<f32>, gradients:ptr<storage,array<vec4<f32>>,read>) -> vec4<f32> {
      let q=clamp((p-vec3<f32>(${GRID.min.join(',')}))/${GRID.cell},vec3<f32>(0.0),vec3<f32>(${GRID.x-2}.0,${GRID.y-2}.0,${GRID.z-2}.0));
      let cell=vec3<u32>(floor(q)); let f=fract(q); let i=cell.x+${GRID.x}u*(cell.y+${GRID.y}u*cell.z);
      let a=mix(mix((*gradients)[i],(*gradients)[i+1u],f.x),mix((*gradients)[i+${GRID.x}u],(*gradients)[i+${GRID.x+1}u],f.x),f.y);
      let j=i+${GRID.x*GRID.y}u;
      let b=mix(mix((*gradients)[j],(*gradients)[j+1u],f.x),mix((*gradients)[j+${GRID.x}u],(*gradients)[j+${GRID.x+1}u],f.x),f.y);
      let g=mix(a,b,f.z); if(length(g.xyz)<0.00001) { return vec4<f32>(fallback,g.w); } return vec4<f32>(normalize(g.xyz),g.w);
    }`)({ p: position, fallback, gradients }).toVar('waxField');
  }
  makeKernels() {
    const N = MAX_BLOBS, SPACING = this.seed.spacing.toFixed(6);
    // Preserve the calibrated neighbor count and density as sampling gets
    // finer. Smaller bins keep the higher particle count affordable.
    const scale = this.seed.spacing / .195;
    const radius = (.44 * scale).toFixed(6), radius2 = (.44 * scale) ** 2;
    const smoothRadius2 = (.5 * scale) ** 2, smoothOffset = .055 * scale;
    const fieldRadius2 = (.42 * scale) ** 2, fieldScale = .12 * scale;
    const { x: BX, y: BY, z: BZ, size: BS } = BIN;
    if (.5 * scale > BS || .42 * scale + smoothOffset > BS) throw new Error('Neighbor support exceeds spatial bins');
    const { x: NX, y: NY, z: NZ, cell: CELL } = GRID;
    // Prefilter sharp primitive normals at the field's sampling scale. Tiny
    // differences alias facet boundaries into a scalloped lighting band when
    // the voxel normals are interpolated. Keep the geometry field unchanged.
    const normalStep = CELL * 1.5;
    if ((NX-1)*CELL >= BX*BS || (NY-1)*CELL >= BY*BS || (NZ-1)*CELL >= BZ*BS) throw new Error('Field exceeds spatial bins');
    const XY = NX * NY, CX = NX - 1, CY = NY - 1;
    const node = (name, code, parameters, count) => {
      // r187's native-function parser requires an explicit void return marker;
      // it removes the marker when emitting valid WGSL.
      code = code.replace(/\)\s*\{/, ') -> void {');
      this.kernelSources.push(code);
      return wgslFn(code)({ id: instanceIndex, ...parameters }).compute(count, [64]).setName(name);
    };
    this.initNode = node('Melt reset', `fn resetMelt(id:u32, rest:ptr<storage,array<vec4<f32>>,read_write>, a:ptr<storage,array<vec4<f32>>,read_write>, b:ptr<storage,array<vec4<f32>>,read_write>, va:ptr<storage,array<vec4<f32>>,read_write>, vb:ptr<storage,array<vec4<f32>>,read_write>) {
      if (id >= ${N}u) { return; }
      if ((*rest)[id].w < 0.0) { (*a)[id]=vec4<f32>(0.0,0.0,0.0,-1.0); (*b)[id]=(*a)[id]; (*va)[id]=vec4<f32>(0.0); (*vb)[id]=vec4<f32>(0.0); return; }
      (*a)[id]=vec4<f32>((*rest)[id].xyz,22.0); (*b)[id]=(*a)[id]; (*va)[id]=vec4<f32>(0.0); (*vb)[id]=vec4<f32>(0.0);
    }`, { rest: this.rest, a: this.positions[0], b: this.positions[1], va: this.velocities[0], vb: this.velocities[1] }, N);
    this.clearNode = node('Clear blob bins', `fn clearBins(id:u32, heads:ptr<storage,array<atomic<u32>>,read_write>) {
      if (id < ${BINS}u) { atomicStore(&(*heads)[id], 0xffffffffu); }
    }`, { heads: this.heads }, BINS);
    this.resetDrawNode = node('Reset mesh counter', `fn resetDraw(id:u32, draw:ptr<storage,array<atomic<u32>>,read_write>) {
      atomicStore(&(*draw)[0],0u); atomicStore(&(*draw)[1],1u); atomicStore(&(*draw)[2],0u); atomicStore(&(*draw)[3],0u);
      atomicStore(&(*draw)[4],0u); atomicStore(&(*draw)[5],0u);
    }`, { draw: this.draw }, 1);
    this.buildNodes = this.positions.map(positions => node('Bin melt blobs', `fn buildBins(id:u32, positions:ptr<storage,array<vec4<f32>>,read_write>, heads:ptr<storage,array<atomic<u32>>,read_write>, links:ptr<storage,array<u32>,read_write>) {
      if (id >= ${N}u) { return; }
      if ((*positions)[id].w < 0.0) { return; }
      let cell=clamp(vec3<i32>(floor(((*positions)[id].xyz-${MIN})/${BS})),vec3<i32>(0),vec3<i32>(${BX-1},${BY-1},${BZ-1}));
      let bin=u32(cell.x+${BX}*(cell.y+${BY}*cell.z));
      (*links)[id]=atomicExchange(&(*heads)[bin],id);
    }`, { positions, heads: this.heads, links: this.next }, N));
    this.fieldOccupancyNode = node('Mark field neighborhoods', `fn markFieldNeighborhoods(id:u32, heads:ptr<storage,array<atomic<u32>>,read_write>) {
      if(id>=${BINS}u) { return; }
      let cell=vec3<i32>(i32(id%${BX}u),i32((id/${BX}u)%${BY}u),i32(id/${BX*BY}u));
      for(var z:i32=-1;z<=1;z++) { for(var y:i32=-1;y<=1;y++) { for(var x:i32=-1;x<=1;x++) {
        let c=cell+vec3<i32>(x,y,z);
        if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(${BX},${BY},${BZ}))) { continue; }
        if(atomicLoad(&(*heads)[u32(c.x+${BX}*(c.y+${BY}*c.z))])!=0xffffffffu) {
          atomicStore(&(*heads)[${BINS}u+id],1u); return;
        }
      } } }
      atomicStore(&(*heads)[${BINS}u+id],0u);
    }`, { heads:this.heads }, BINS);
    this.simulateNodes = this.positions.map((positions, side) => node('Melt motion', `fn stepMelt(id:u32,
      positions:ptr<storage,array<vec4<f32>>,read_write>, velocities:ptr<storage,array<vec4<f32>>,read_write>, rest:ptr<storage,array<vec4<f32>>,read_write>,
      result:ptr<storage,array<vec4<f32>>,read_write>, resultVelocity:ptr<storage,array<vec4<f32>>,read_write>, heads:ptr<storage,array<atomic<u32>>,read_write>, links:ptr<storage,array<u32>,read_write>,
      dt:f32, heat:f32, heatSphere:vec4<f32>, viscosity:f32, tension:f32) {
      if (id >= ${N}u) { return; }
      if ((*rest)[id].w < 0.0) { return; }
      let source=(*positions)[id]; let original=(*rest)[id].xyz;
      var p=source.xyz; var v=(*velocities)[id].xyz; var enthalpy=source.w;
      // Accelerate phase change without increasing the motion timestep or
      // dispatching additional simulation work.
      let thermalDt=dt*${MELT_RATE}.0;
      var temperature=enthalpy;
      if(enthalpy>=42.0) { temperature=42.0+max(0.0,enthalpy-70.0); }
      let liquid=clamp((enthalpy-42.0)/28.0,0.0,1.0);
      // Once released, a blob never reattaches to its original shape on cooling.
      let mobility=max((*velocities)[id].w,pow(smoothstep(0.03,1.0,liquid),2.0));
      var correction=vec3<f32>(0.0); var exchange=vec3<f32>(0.0); var cohesion=vec3<f32>(0.0); var elastic=vec3<f32>(0.0); var weight=0.0; var conduction=0.0;
      let cell=vec3<i32>(floor((p-${MIN})/${BS}));
      for(var z:i32=-1;z<=1;z++) { for(var y:i32=-1;y<=1;y++) { for(var x:i32=-1;x<=1;x++) {
        let c=cell+vec3<i32>(x,y,z);
        if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(${BX},${BY},${BZ}))) { continue; }
        var j=atomicLoad(&(*heads)[u32(c.x+${BX}*(c.y+${BY}*c.z))]);
        for(var visited:u32=0u;visited<${N}u;visited++) {
          if(j==0xffffffffu) { break; }
          if(j!=id) {
            let d=(*positions)[j].xyz-p; let r2=dot(d,d);
            if(r2>0.000001 && r2<${radius2}) {
              let r=sqrt(r2); let w=1.0-r/${radius}; let other=(*velocities)[j];
              let freedom=mobility/(mobility+other.w+0.00001);
              correction-=d/r*max(0.0,${SPACING}*0.88-r)*freedom*0.55;
              exchange+=(other.xyz-v)*w; weight+=w;
              let h=(*positions)[j].w;
              let neighborTemperature=select(h,42.0+max(0.0,h-70.0),h>=42.0);
              conduction+=(neighborTemperature-temperature)*w;
              cohesion+=d/r*max(0.0,r-${SPACING})*w;
              let bond=(*rest)[j].xyz-original;
              if(dot(bond,bond)<${SPACING}*${SPACING}*1.45) {
                elastic+=(d-bond)*pow(1.0-max(mobility,other.w),4.0);
              }
            }
          }
          j=(*links)[j];
        }
      } } }
      let exposure=clamp(1.0-weight/7.6,0.06,1.0);
      // Heat the current particle position by proximity to a spherical fire
      // volume. The soft boundary prevents a hard, slicing melt front.
      let distance=length(p-heatSphere.xyz)-heatSphere.w;
      let incident=1.0-smoothstep(0.0,${HEAT_FALLOFF},distance);
      let sourceTemperature=22.0+170.0*heat;
      let floorContact=1.0-smoothstep(${SPACING}*0.42,${SPACING}*1.1,p.y);
      let cooling=(temperature-22.0)*(0.035*exposure+0.08*floorContact);
      // Constant pair coefficient makes conduction equal and opposite for
      // both particles; local neighbor normalization would create/lose heat.
      // Stored enthalpy is normalized by local heat capacity. Dividing the
      // entire heat flux preserves equal/opposite exchanged energy between
      // different wax patches, including the latent-heat interval.
      enthalpy+=(max(0.0,sourceTemperature-temperature)*incident*0.18+conduction*${(.65 / 7.6 * (.145 / this.seed.spacing) ** 2).toFixed(8)}-cooling)*thermalDt/(*rest)[id].w;
      let detached=(1.0-smoothstep(0.5,2.5,weight))*smoothstep(0.05,0.5,mobility);
      v+=vec3<f32>(0.0,-9.81*mix(mobility,1.0,detached),0.0)*dt;
      // Local bonds soften with heat. There are no springs to world-space
      // rest positions: a detached piece can fall instead of hanging in midair.
      v+=elastic*40.0*dt;
      v+=(exchange/max(1.0,weight))*(viscosity*15.0*dt);
      v+=cohesion*tension*4.0*mobility*dt;
      // Neighbor viscosity slows connected material; detached drops retain
      // their momentum instead of inheriting the bulk's heavy drag.
      v*=exp(-dt*(0.25+viscosity*6.0*smoothstep(0.5,3.0,weight)));
      p+=v*dt+clamp(correction,vec3<f32>(-0.05),vec3<f32>(0.05));
      let floorHeight=${SPACING}*0.42;
      if(p.y<floorHeight) { p.y=floorHeight; v.y=max(0.0,v.y); }
      p=clamp(p,vec3<f32>(-3.12,floorHeight,-2.12),vec3<f32>(3.12,4.5,2.12));
      (*result)[id]=vec4<f32>(p,enthalpy); (*resultVelocity)[id]=vec4<f32>(v,mobility);
    }`, { positions, velocities: this.velocities[side], rest: this.rest, result: this.positions[1 - side], resultVelocity: this.velocities[1 - side], heads: this.heads, links: this.next,
      dt: this.dt, heat: this.heat, heatSphere: this.heatSphere, viscosity: this.viscosity, tension: this.tension }, N));
    this.contactNodes = this.positions.map((positions, side) => this.velocities.map(velocities => node('Resolve liquid contacts', `fn resolveContacts(id:u32,
      positions:ptr<storage,array<vec4<f32>>,read_write>, velocities:ptr<storage,array<vec4<f32>>,read_write>, heads:ptr<storage,array<atomic<u32>>,read_write>, links:ptr<storage,array<u32>,read_write>, result:ptr<storage,array<vec4<f32>>,read_write>) {
      if(id>=${N}u) { return; }
      let source=(*positions)[id]; if(source.w<0.0) { (*result)[id]=source; return; }
      let p=source.xyz; let freedom=(*velocities)[id].w;
      let cell=vec3<i32>(floor((p-${MIN})/${BS})); var correction=vec3<f32>(0.0);
      for(var z:i32=-1;z<=1;z++) { for(var y:i32=-1;y<=1;y++) { for(var x:i32=-1;x<=1;x++) {
        let c=cell+vec3<i32>(x,y,z);
        if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(${BX},${BY},${BZ}))) { continue; }
        var j=atomicLoad(&(*heads)[u32(c.x+${BX}*(c.y+${BY}*c.z))]);
        for(var visited:u32=0u;visited<${N}u;visited++) {
          if(j==0xffffffffu) { break; }
          if(j!=id) {
            var d=p-(*positions)[j].xyz; var r=length(d);
            if(r<0.01) {
              // Antisymmetric, deterministic separation for coincident blobs.
              // A vertical stack landing on the floor must retain its volume.
              let angle=f32(min(id,j)*197u+max(id,j)*157u)*0.73;
              d=vec3<f32>(cos(angle),0.15*sin(angle*1.7),sin(angle))*select(-1.0,1.0,id>j);
              r=0.001;
            } else { d/=r; }
            let share=freedom/(freedom+(*velocities)[j].w+0.000001);
            correction+=d*max(0.0,${SPACING}*0.98-r)*share*0.7;
          }
          j=(*links)[j];
        }
      } } }
      correction*=min(1.0,0.06/max(length(correction),0.00001));
      let next=clamp(p+correction,vec3<f32>(-3.12,${SPACING}*0.42,-2.12),vec3<f32>(3.12,4.5,2.12));
      (*result)[id]=vec4<f32>(next,source.w);
    }`, {positions,velocities,heads:this.heads,links:this.next,result:this.positions[1-side]}, N)));
    // Surface centers are not needed during integration. Reuse that buffer to
    // retain the pre-step positions, then rebuild it before reconstructing.
    this.savePositionNodes = this.positions.map(positions => node('Save integration origins', `fn saveOrigins(id:u32,
      positions:ptr<storage,array<vec4<f32>>,read_write>, origins:ptr<storage,array<vec4<f32>>,read_write>) {
      if(id>=${N}u) { return; }
      (*origins)[id]=(*positions)[id];
    }`, {positions,origins:this.surfaceCenters}, N));
    this.velocityNodes = this.positions.map((positions, side) => node('Reconcile contact velocity', `fn reconcileVelocity(id:u32,
      positions:ptr<storage,array<vec4<f32>>,read_write>, origins:ptr<storage,array<vec4<f32>>,read_write>, velocities:ptr<storage,array<vec4<f32>>,read_write>, dt:f32, viscosity:f32) {
      if(id>=${N}u || (*positions)[id].w<0.0) { return; }
      let p=(*positions)[id].xyz;
      var v=(p-(*origins)[id].xyz)/max(dt,0.000001);
      // Contacts remove blocked momentum. Floor friction acts on the resolved
      // velocity instead of leaving downward energy trapped in a resting pool.
      if(p.y<=${SPACING}*0.42+0.001) {
        v.y=max(0.0,v.y);
        let friction=exp(-dt*10.0*viscosity);
        v.x*=friction; v.z*=friction;
      }
      (*velocities)[id]=vec4<f32>(v,(*velocities)[id].w);
    }`, {positions,origins:this.surfaceCenters,velocities:this.velocities[side],dt:this.dt,viscosity:this.viscosity}, N));
    this.prepareNodes = this.positions.map((positions, side) => node('Smooth surface samples', `fn prepareSurface(id:u32, positions:ptr<storage,array<vec4<f32>>,read_write>, velocities:ptr<storage,array<vec4<f32>>,read_write>, heads:ptr<storage,array<atomic<u32>>,read_write>, links:ptr<storage,array<u32>,read_write>, centers:ptr<storage,array<vec4<f32>>,read_write>, draw:ptr<storage,array<atomic<u32>>,read_write>) {
      if(id>=${N}u || (*positions)[id].w<0.0) { return; }
      let source=(*positions)[id]; let p=source.xyz; let cell=vec3<i32>(floor((p-${MIN})/${BS}));
      atomicAdd(&(*draw)[4],u32(clamp((source.w-42.0)/28.0,0.0,1.0)*1000.0));
      var offset=vec3<f32>(0.0); var weight=1.0;
      for(var z:i32=-1;z<=1;z++) { for(var y:i32=-1;y<=1;y++) { for(var x:i32=-1;x<=1;x++) {
        let c=cell+vec3<i32>(x,y,z);
        if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(${BX},${BY},${BZ}))) { continue; }
        var j=atomicLoad(&(*heads)[u32(c.x+${BX}*(c.y+${BY}*c.z))]);
        for(var visited:u32=0u;visited<${N}u;visited++) {
          if(j==0xffffffffu) { break; }
          let d=(*positions)[j].xyz-p; let t=max(0.0,1.0-dot(d,d)/${smoothRadius2}); let w=t*t*t;
          offset+=d*w; weight+=w; j=(*links)[j];
        }
      } } }
      offset=offset/weight*0.6;
      offset*=min(1.0,${smoothOffset}/max(length(offset),0.00001));
      // Released wax must retain its reconstructed shape when it cools. Reuse
      // the solver's irreversible mobility instead of restoring the primitive.
      let released=max(clamp((source.w-42.0)/28.0,0.0,1.0),sqrt((*velocities)[id].w));
      (*centers)[id]=vec4<f32>(p+offset,released);
    }`, { positions, velocities:this.velocities[side], heads:this.heads, links:this.next, centers:this.surfaceCenters, draw:this.draw }, N));
    this.fieldNodes = this.positions.map(source => node('Melt implicit field', `fn buildField(id:u32,
      positions:ptr<storage,array<vec4<f32>>,read_write>, source:ptr<storage,array<vec4<f32>>,read_write>, rest:ptr<storage,array<vec4<f32>>,read_write>, heads:ptr<storage,array<atomic<u32>>,read_write>, links:ptr<storage,array<u32>,read_write>, colors:ptr<storage,array<vec4<f32>>,read_write>, field:ptr<storage,array<vec4<f32>>,read_write>, gradients:ptr<storage,array<vec4<f32>>,read_write>, primitive:u32, centerY:f32, inverseRotation:vec4<f32>) {
      if(id>=${VOXELS}u) { return; }
      let grid=vec3<u32>(id%${NX}u,(id/${NX}u)%${NY}u,id/${XY}u);
      if(any(grid==vec3<u32>(0u))||any(grid==vec3<u32>(${NX-1}u,${NY-1}u,${NZ-1}u))) { (*field)[id]=vec4<f32>(0.0,0.0,0.0,-0.65); (*gradients)[id]=vec4<f32>(0.0); return; }
      let p=${MIN}+vec3<f32>(grid)*${CELL};
      let cell=vec3<i32>(floor((p-${MIN})/${BS}));
      // Conservative: field support plus sample smoothing is smaller than a
      // bin. Empty neighborhoods produce exactly the original empty field.
      if(atomicLoad(&(*heads)[${BINS}u+u32(cell.x+${BX}*(cell.y+${BY}*cell.z))])==0u) {
        (*field)[id]=vec4<f32>(0.0,0.0,0.0,-0.65*${fieldScale}); (*gradients)[id]=vec4<f32>(0.0); return;
      }
      var weight=0.0; var pigment=vec3<f32>(0.0); var gradient=vec3<f32>(0.0); var displacement=vec3<f32>(0.0); var phase=0.0; var released=0.0;
      for(var z:i32=-1;z<=1;z++) { for(var y:i32=-1;y<=1;y++) { for(var x:i32=-1;x<=1;x++) {
        let c=cell+vec3<i32>(x,y,z);
        if(any(c<vec3<i32>(0))||any(c>=vec3<i32>(${BX},${BY},${BZ}))) { continue; }
        var j=atomicLoad(&(*heads)[u32(c.x+${BX}*(c.y+${BY}*c.z))]);
        for(var visited:u32=0u;visited<${N}u;visited++) {
          if(j==0xffffffffu) { break; }
          let d=p-(*positions)[j].xyz;
          let liquid=clamp(((*source)[j].w-42.0)/28.0,0.0,1.0);
          let shapePhase=(*positions)[j].w;
          // A wetting film flattens at the floor. A spherical reconstruction
          // would visibly inflate a one-particle-deep pool.
          let vertical=mix(1.0,0.55,(1.0-smoothstep(0.12,0.4,(*positions)[j].y))*shapePhase);
          let scaled=vec3<f32>(d.x,d.y/vertical,d.z);
          let t=1.0-dot(scaled,scaled)/${fieldRadius2};
          if(t>0.0) {
            let w=t*t*t; weight+=w; pigment+=(*colors)[j].rgb*w;
            gradient+=vec3<f32>(d.x,d.y/(vertical*vertical),d.z)*t*t;
            displacement+=((*source)[j].xyz-(*rest)[j].xyz)*w;
            phase+=liquid*w;
            released+=shapePhase*w;
          }
          j=(*links)[j];
        }
      } } }
      let blend=smoothstep(0.02,0.55,released/max(weight,0.000001));
      var phi=(weight-0.65)*${fieldScale};
      var normal=gradient*(6.0/${fieldRadius2})*${fieldScale};
      if(weight>0.000001 && blend<1.0) {
        let world=p-displacement/weight-vec3<f32>(0.0,centerY,0.0);
        let q=world+2.0*cross(inverseRotation.xyz,cross(inverseRotation.xyz,world)+inverseRotation.w*world);
        var solidDistance=0.0; var solidNormal=vec3<f32>(0.0);
        if(primitive==7u) {
          var nearest=1e8; var delta=vec3<f32>(0.0);
          for(var segment=0u;segment<${KNOT_PATH.length}u;segment++) {
            let a=(*rest)[${MAX_BLOBS}u+segment].xyz;
            let b=(*rest)[${MAX_BLOBS}u+(segment+1u)%${KNOT_PATH.length}u].xyz;
            let ab=b-a; let t=clamp(dot(q-a,ab)/dot(ab,ab),0.0,1.0);
            let d=q-a-ab*t; let d2=dot(d,d);
            if(d2<nearest) { nearest=d2; delta=d; }
          }
          let distance=sqrt(nearest);
          solidDistance=distance-${KNOT_RADIUS}; solidNormal=delta/max(distance,0.000001);
        } else {
        var distances:array<f32,7>;
        for(var k=0u;k<7u;k++) {
          var sample=q;
          if(k>0u) { let axis=(k-1u)/2u; sample[axis]+=select(-${normalStep},${normalStep},k%2u==1u); }
          var distance=0.0;
          switch(primitive) {
            case 0u: { distance=max(abs(sample.y)-1.58,(length(sample.xz)-1.28*(1.58-sample.y)/3.16)*0.927); }
            case 1u: { distance=length(vec3<f32>(max(0.0,abs(sample.x)-1.02),sample.y,sample.z))-0.72; }
            case 2u: { let b=abs(sample)-vec3<f32>(0.82); distance=length(max(b,vec3<f32>(0.0)))+min(0.0,max(b.x,max(b.y,b.z)))-0.06; }
            case 3u: { distance=max(length(sample.xz)-0.84,abs(sample.y)-1.21); }
            case 4u: { distance=length(vec2<f32>(length(sample.xy)-1.0,sample.z))-0.52; }
            case 5u: { distance=(abs(sample.x)+abs(sample.y)+abs(sample.z)-1.6)/sqrt(3.0); }
            default: { distance=length(sample)-1.09; }
          }
          distances[k]=distance;
        }
        solidDistance=distances[0];
        solidNormal=vec3<f32>(distances[1]-distances[2],distances[3]-distances[4],distances[5]-distances[6])/${2*normalStep};
        }
        solidNormal+=2.0*cross(-inverseRotation.xyz,cross(-inverseRotation.xyz,solidNormal)+inverseRotation.w*solidNormal);
        phi=mix(-solidDistance,phi,blend); normal=mix(solidNormal,normal,blend);
      }
      (*field)[id]=vec4<f32>(pigment/max(weight,0.000001),phi);
      (*gradients)[id]=vec4<f32>(normal,phase/max(weight,0.000001));
    }`, { positions:this.surfaceCenters, source, rest: this.rest, heads: this.heads, links: this.next, colors: this.colors, field: this.field, gradients: this.fieldNormals, primitive:this.primitive, centerY:this.centerY, inverseRotation:this.inverseRotation }, VOXELS));
    this.meshNode = node('Marching Cubes', `fn marchingCubes(id:u32,
      field:ptr<storage,array<vec4<f32>>,read_write>, gradients:ptr<storage,array<vec4<f32>>,read_write>, table:ptr<storage,array<i32>,read_write>, vertices:ptr<storage,array<vec3<f32>>,read_write>, normals:ptr<storage,array<vec3<f32>>,read_write>, colors:ptr<storage,array<vec3<f32>>,read_write>, thickness:ptr<storage,array<vec4<f32>>,read_write>, draw:ptr<storage,array<atomic<u32>>,read_write>, fireSphere:vec4<f32>) {
      if(id>=${CELLS}u) { return; }
      let cube=vec3<u32>(id%${CX}u,(id/${CX}u)%${CY}u,id/${CX*CY}u);
      let offsets=array<vec3<u32>,8>(vec3<u32>(0,0,0),vec3<u32>(1,0,0),vec3<u32>(1,1,0),vec3<u32>(0,1,0),vec3<u32>(0,0,1),vec3<u32>(1,0,1),vec3<u32>(1,1,1),vec3<u32>(0,1,1));
      let edgeA=array<u32,12>(0,1,2,3,4,5,6,7,0,1,2,3);
      let edgeB=array<u32,12>(1,2,3,0,5,6,7,4,4,5,6,7);
      var values:array<vec4<f32>,8>; var coordinates:array<u32,8>; var mask=0u;
      for(var c=0u;c<8u;c++) {
        let q=cube+offsets[c]; let index=q.x+${NX}u*(q.y+${NY}u*q.z); coordinates[c]=index; values[c]=(*field)[index];
        if(values[c].w<0.0) { mask|=1u<<c; }
      }
      if(mask==0u||mask==255u) { return; }
      for(var triangle=0u;triangle<5u;triangle++) {
        let row=mask*16u+triangle*3u;
        if((*table)[row]<0) { break; }
        let base=atomicAdd(&(*draw)[0],3u);
        if(base+3u>${MAX_VERTICES}u) { atomicStore(&(*draw)[5],1u); continue; }
        for(var vertex=0u;vertex<3u;vertex++) {
          let edge=u32((*table)[row+vertex]); let a=edgeA[edge]; let b=edgeB[edge];
          let t=clamp(-values[a].w/(values[b].w-values[a].w),0.0,1.0);
          let local=mix(vec3<f32>(offsets[a]),vec3<f32>(offsets[b]),t);
          let gradient=mix((*gradients)[coordinates[a]].xyz,(*gradients)[coordinates[b]].xyz,t);
          let world=${MIN}+(vec3<f32>(cube)+local)*${CELL};
          let normal=gradient/max(length(gradient),0.00001);
          (*vertices)[base+vertex]=world;
          (*normals)[base+vertex]=normal;
          var ca=values[a].rgb; var cb=values[b].rgb;
          // Empty field samples represent air, not black pigment.
          if(dot(ca,ca)<0.000001) { ca=cb; }
          if(dot(cb,cb)<0.000001) { cb=ca; }
          (*colors)[base+vertex]=mix(ca,cb,t);
          // Optical path toward each light, including occluders after air gaps.
          // One bounded integration per vertex, interpolated by rasterization.
          let toFire=fireSphere.xyz-world; let fireDistance=length(toFire);
          let directions=array<vec3<f32>,3>(${WAX_LIGHT_DIRECTIONS.map(vec3).join(',')},toFire/max(fireDistance,0.00001));
          var depths=vec4<f32>(0.0);
          for(var light=0u;light<3u;light++) {
            // The fire emits throughout its volume; stop at its nearest surface.
            let limit=select(6.4,max(0.0,fireDistance-fireSphere.w),light==2u);
            for(var sample=0u;sample<64u;sample++) {
              let start=f32(sample)*0.1; if(start>=limit) { break; }
              let length=min(0.1,limit-start);
              let p=world+directions[light]*(start+length*0.5);
              let grid=(p-${MIN})/${CELL}; let q=vec3<i32>(floor(grid)); let f=fract(grid);
              if(any(q<vec3<i32>(0))||any(q>=vec3<i32>(${NX-1},${NY-1},${NZ-1}))) { break; }
              let a=u32(q.x+${NX}*(q.y+${NY}*q.z)); let b=a+${XY}u;
              let front=mix(mix((*field)[a].w,(*field)[a+1u].w,f.x),mix((*field)[a+${NX}u].w,(*field)[a+${NX+1}u].w,f.x),f.y);
              let back=mix(mix((*field)[b].w,(*field)[b+1u].w,f.x),mix((*field)[b+${NX}u].w,(*field)[b+${NX+1}u].w,f.x),f.y);
              let phi=mix(front,back,f.z);
              depths[light]+=smoothstep(-0.035,0.035,phi)*length;
              if(depths[light]>=2.0) { depths[light]=2.0; break; }
            }
          }
          (*thickness)[base+vertex]=depths;
        }
      }
    }`, { field: this.field, gradients: this.fieldNormals, table: this.table, vertices: this.vertices, normals: this.normals, colors: this.pigment, thickness:this.thickness, draw: this.draw, fireSphere: this.fireSphere }, CELLS);
    this.finalizeNode = node('Bound indirect draw', `fn finishMesh(id:u32, draw:ptr<storage,array<atomic<u32>>,read_write>) { atomicStore(&(*draw)[0],min(atomicLoad(&(*draw)[0]),${MAX_VERTICES}u)); }`, { draw: this.draw }, 1);
  }
  reset(renderer, settings = {}) {
    this.time = 0; this.frame = 0; this.accumulator = 0;
    const radius = settings.heatRadius ?? HEAT_RADIUS;
    this.heatSphere.value.set(0, heatSourceHeight(this.top, 0, radius), 0, radius);
    this.fireSphere.value.copy(this.heatSphere.value);
    renderer.compute([this.initNode, this.resetDrawNode, this.clearNode, this.buildNodes[0], this.fieldOccupancyNode, this.prepareNodes[0], this.fieldNodes[0], this.meshNode, this.finalizeNode]);
  }
  advance(renderer, seconds, settings) {
    const { steps, dt, remainder } = simulationStep(seconds, this.accumulator);
    this.accumulator = remainder;
    const radius = settings.heatRadius ?? HEAT_RADIUS, duration = settings.heatDuration ?? HEAT_DURATION;
    const fireY = heatSourceHeight(this.top, this.time + steps * dt, radius, duration);
    const sourceChanged = this.fireSphere.value.y !== fireY || this.fireSphere.value.w !== radius;
    this.fireSphere.value.set(0, fireY, 0, radius);
    if (!steps && !sourceChanged) return;
    this.dt.value = dt;
    this.heat.value = settings.heat; this.viscosity.value = settings.viscosity; this.tension.value = settings.tension;
    // Evaluate at the batch midpoint; all fixed motion steps share this uniform.
    this.heatSphere.value.set(0, heatSourceHeight(this.top, this.time + steps * dt * .5, radius, duration), 0, radius);
    const commands = [this.resetDrawNode];
    // Integrate actual elapsed time with small steps. Reconstruction and the
    // expensive thickness integration run only once per rendered frame.
    for (let step = 0; step < steps; step++) {
      const side = this.frame % 2, next = 1 - side;
      commands.push(this.savePositionNodes[side], this.clearNode, this.buildNodes[side], this.simulateNodes[side]);
      // Four relaxed contact iterations converge stacked floor layers before
      // deriving velocity, reducing the residual compression that drives jitter.
      for (let iteration = 0; iteration < 4; iteration++) {
        const current = (next + iteration) % 2;
        commands.push(this.clearNode, this.buildNodes[current], this.contactNodes[current][next]);
      }
      commands.push(this.velocityNodes[next]);
      this.frame++;
    }
    const final = this.frame % 2;
    commands.push(this.clearNode, this.buildNodes[final], this.fieldOccupancyNode, this.prepareNodes[final], this.fieldNodes[final], this.meshNode, this.finalizeNode);
    renderer.compute(commands);
    this.time += steps * dt;
  }
  async inspect(renderer) {
    const values = new Uint32Array(await renderer.getArrayBufferAsync(this.drawAttribute));
    return { time: this.time, particles: this.n, triangles: values[0] / 3, liquid: values[4] / (1000 * this.n), overflow: values[5] !== 0, cells: CELLS };
  }
  dispose() {
    this.mesh.geometry.dispose();
    for (const node of [this.initNode,this.clearNode,this.fieldOccupancyNode,this.resetDrawNode,...this.buildNodes,...this.simulateNodes,...this.contactNodes.flat(),...this.savePositionNodes,...this.velocityNodes,...this.prepareNodes,...this.fieldNodes,this.meshNode,this.finalizeNode]) node.dispose();
  }
}
