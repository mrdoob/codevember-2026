import * as THREE from 'three/webgpu';
import {
  Fn,
  attribute,
  texture,
  textureLoad,
  storage,
  ivec2,
  vec2,
  vec3,
  uniform,
  positionLocal,
  normalLocal,
  tangentLocal,
  tangentGeometry,
  uv,
  mix,
  varying,
  bumpMap,
  modelViewMatrix,
  modelWorldMatrix
} from 'three/tsl';
import { SPACING, RADIUS } from './rope-config.js';
import {
  LEAD_SAMPLES,
  LEAD_SPACING,
  SUBDIVISIONS,
  PLY_SIDES as SIDES,
  PLY_COUNT,
  TWIST,
  yarnSamples,
  yarnIndexCount,
  yarnDistance,
  yarnCutFraction,
  yarnParticleIndex
} from './yarn-layout.js';
import { createYarnSurface } from './yarn-surface.js';

export const PALETTES = {
  Haberdashery: ['#d65339', '#e3a72f', '#378b83', '#d9b5cf', '#f0e2bd'],
  Wildflower: ['#9a61b3', '#d57b9e', '#9ba84a', '#e7c251', '#dedbc9'],
  Seaside: ['#315b73', '#619caa', '#d88262', '#dfb47b', '#eee2c8'],
  Sorbet: ['#f2768e', '#f5b55b', '#8ebeb1', '#a7a0d1', '#f0d0b4']
};
const PLY_ORBIT = 0.026,
  PLY_RADIUS = 0.031;

// Catmull–Rom interpolation with no temporary Vector3s in the update loop.
function catmull(a, b, c, d, t) {
  return b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
}
function catmullTangent(a, b, c, d, t) {
  return 0.5 * (c - a) + t * (2 * a - 5 * b + 4 * c - d) + 1.5 * t * t * (3 * (b - c) + d - a);
}

export class Yarn extends THREE.Group {
  constructor(simulation, strand, hex) {
    super();
    this.simulation = simulation;
    this.strand = strand;
    this.samples = yarnSamples(simulation.count);
    if (!simulation.isGPU) {
      this.frames = new Float32Array(this.samples * 12);
      this.centers = new Float32Array(this.samples * 3);
      this.tangents = new Float32Array(this.samples * 3);
      this.frameTexture = new THREE.DataTexture(this.frames, this.samples, 3, THREE.RGBAFormat, THREE.FloatType);
      this.frameTexture.needsUpdate = true;
    }
    const state = simulation.isGPU ? storage(simulation.state.value, 'vec4', 2).toReadOnly() : null;
    const clock = state?.element(0);
    this.activeCount = state ? state.element(1).x : uniform(simulation.active[strand]);
    this.travel = clock ? clock.z : uniform(0);
    this.cutFraction = clock
      ? this.activeCount.greaterThanEqual(simulation.count).select(clock.y.div(SPACING).sub(1).clamp(), 0)
      : uniform(0);
    const rawArc = attribute('arcDistance', 'float'),
      cut = attribute('cutFace', 'float');
    const arc = mix(rawArc, this.activeCount.sub(1).mul(SPACING), cut);
    const tailWeight = arc.sub(this.activeCount.sub(2).mul(SPACING)).div(SPACING).clamp();
    const visibleArc = arc.sub(tailWeight.mul(this.cutFraction).mul(SPACING));
    const materialArc = visibleArc.sub(this.travel);
    const endArc = this.activeCount.sub(1).sub(this.cutFraction).mul(SPACING);
    const axialScale = endArc.sub(visibleArc).div(SPACING).clamp();
    this.rotationPhase = materialArc
      .sub(rawArc)
      .mul(TWIST)
      .add(materialArc.mul(1.7).sin().mul(0.22))
      .add(materialArc.mul(8).sin().mul(0.05));
    const radiusVariation = materialArc
      .mul(15)
      .sin()
      .mul(0.025)
      .add(materialArc.mul(37.2).add(strand).sin().mul(0.015))
      .add(1);
    const sampleIndex = mix(
      attribute('sampleIndex', 'float'),
      this.activeCount.sub(1).mul(SUBDIVISIONS).add(LEAD_SAMPLES),
      cut
    ).toInt();
    const gpuFrames = simulation.isGPU
      ? storage(simulation.frames.value, 'vec4', simulation.strands * this.samples * 3).toReadOnly()
      : null;
    const frame = row =>
      gpuFrames
        ? gpuFrames.element(sampleIndex.add((strand * 3 + row) * this.samples))
        : textureLoad(this.frameTexture, ivec2(sampleIndex, row));
    const c = frame(0),
      n = frame(1).xyz,
      b = frame(2).xyz;
    const tangent = n.cross(b);
    const rotate = value => {
      const cos = this.rotationPhase.cos(),
        sin = this.rotationPhase.sin();
      return vec3(value.x.mul(cos).sub(value.y.mul(sin)), value.x.mul(sin).add(value.y.mul(cos)), value.z);
    };
    const deform = Fn(() => {
      const local = rotate(positionLocal);
      const fiber = rotate(tangentGeometry.xyz);
      tangentLocal.assign(n.mul(fiber.x).add(b.mul(fiber.y)).add(tangent.mul(fiber.z)).normalize());
      return c.xyz.add(
        n
          .mul(local.x)
          .add(b.mul(local.y))
          .add(tangent.mul(local.z.mul(axialScale)))
          .mul(c.w)
          .mul(radiusVariation)
      );
    })();
    const normal = Fn(() => {
      const local = rotate(normalLocal);
      return n.mul(local.x).add(b.mul(local.y)).add(tangent.mul(local.z)).normalize();
    })();

    this.material = new THREE.MeshPhysicalNodeMaterial({
      color: hex,
      roughness: 0.6,
      metalness: 0,
      sheen: 1,
      sheenColor: new THREE.Color(hex).lerp(new THREE.Color('#fff4df'), 0.5),
      sheenRoughness: 0.8,
      specularIntensity: 0.6
    });
    this.material.positionNode = deform;
    const transportedNormal = varying(normal, 'transportedYarnNormal');
    const viewNormal = transportedNormal.transformDirection(modelViewMatrix);
    this.surfaceTexture = createYarnSurface(strand);
    this.bumpStrength = uniform(1.2);
    // A fiber is smoother along its length than across its circumference.
    // Three.js broadens the tangent lobe, so put that axis across the fibers.
    this.fiberAlignment = uniform(0.85);
    this.material.anisotropyNode = vec2(0, this.fiberAlignment.mul(cut.oneMinus()));
    const surfaceUV = mix(vec2(materialArc.mul(2), uv().y), uv().mul(2.2), cut);
    const surface = texture(this.surfaceTexture, surfaceUV);
    // Keep the height sample separate from color/roughness so the bump node
    // can evaluate it again at its derivative-offset UVs.
    this.material.normalNode = bumpMap(texture(this.surfaceTexture, surfaceUV).r, this.bumpStrength, viewNormal);
    this.material.smoothShadowNormalNode = transportedNormal.transformDirection(modelWorldMatrix);
    this.tint = uniform(new THREE.Color(hex));
    this.material.colorNode = this.tint.mul(mix(0.86, 1.1, surface.g)).mul(mix(1, 1.06, cut));
    this.material.roughnessNode = mix(mix(0.5, 0.7, surface.b), 0.92, cut);
    const geometry = this.createPlies();
    if (simulation.isGPU) geometry.setIndirect(simulation.drawArguments.value);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.strand = strand;
    this.add(this.mesh);
    this.update();
  }

  createPlies() {
    const count = PLY_COUNT * (this.samples * (SIDES + 1) + SIDES + 2);
    const position = new Float32Array(count * 3),
      normal = new Float32Array(count * 3),
      tangent = new Float32Array(count * 4);
    const uv = new Float32Array(count * 2),
      sample = new Float32Array(count);
    const arc = new Float32Array(count),
      cut = new Float32Array(count);
    const indices = [];
    let vertex = 0;
    const slope = PLY_ORBIT * TWIST,
      inverse = 1 / Math.sqrt(1 + slope * slope);
    for (let ply = 0; ply < PLY_COUNT; ply++) {
      for (let i = 0; i < this.samples; i++) {
        const distance = this.distanceAt(i);
        const phase = distance * TWIST + (ply * Math.PI * 2) / PLY_COUNT;
        const x = Math.cos(phase),
          y = Math.sin(phase);
        for (let k = 0; k <= SIDES; k++, vertex++) {
          const angle = (k / SIDES) * Math.PI * 2,
            a = Math.cos(angle),
            b = Math.sin(angle);
          const nx = a * x - b * y * inverse,
            ny = a * y + b * x * inverse,
            nz = -b * slope * inverse;
          const px = x * PLY_ORBIT + nx * PLY_RADIUS,
            py = y * PLY_ORBIT + ny * PLY_RADIUS;
          position.set([px, py, i === this.samples - 1 ? 0 : nz * PLY_RADIUS], vertex * 3);
          normal.set([nx, ny, nz], vertex * 3);
          const length = Math.hypot(TWIST * px, TWIST * py, 1);
          tangent.set([(-TWIST * py) / length, (TWIST * px) / length, 1 / length, 1], vertex * 4);
          uv.set([distance, k / SIDES + ply * 0.23], vertex * 2);
          sample[vertex] = i;
          arc[vertex] = distance;
        }
      }
    }
    // Duplicate end vertices so the flat cut normal stays independent of the
    // rounded side normals. Every ply keeps its full cross-section at the cut.
    const distance = this.distanceAt(this.samples - 1);
    for (let ply = 0; ply < PLY_COUNT; ply++) {
      const phase = distance * TWIST + (ply * Math.PI * 2) / PLY_COUNT,
        x = Math.cos(phase),
        y = Math.sin(phase);
      const center = vertex++;
      position.set([x * PLY_ORBIT, y * PLY_ORBIT, 0], center * 3);
      normal.set([0, 0, 1], center * 3);
      uv.set([0.5, 0.5], center * 2);
      tangent.set([1, 0, 0, 1], center * 4);
      sample[center] = this.samples - 1;
      arc[center] = distance;
      cut[center] = 1;
      for (let k = 0; k <= SIDES; k++, vertex++) {
        const angle = (k / SIDES) * Math.PI * 2,
          a = Math.cos(angle),
          b = Math.sin(angle);
        const nx = a * x - b * y * inverse,
          ny = a * y + b * x * inverse;
        position.set([x * PLY_ORBIT + nx * PLY_RADIUS, y * PLY_ORBIT + ny * PLY_RADIUS, 0], vertex * 3);
        normal.set([0, 0, 1], vertex * 3);
        uv.set([0.5 + nx * 0.5, 0.5 + ny * 0.5], vertex * 2);
        tangent.set([1, 0, 0, 1], vertex * 4);
        sample[vertex] = this.samples - 1;
        arc[vertex] = distance;
        cut[vertex] = 1;
        if (k < SIDES) indices.push(center, vertex, vertex + 1);
      }
    }
    // A draw-count prefix always includes all three caps and complete rings.
    // The cap shader follows the active end while unused body rows stay hidden.
    for (let i = 0; i < this.samples - 1; i++)
      for (let ply = 0; ply < PLY_COUNT; ply++)
        for (let k = 0; k < SIDES; k++) {
          const aa = (ply * this.samples + i) * (SIDES + 1) + k,
            bb = aa + SIDES + 1;
          indices.push(aa, aa + 1, bb, bb, aa + 1, bb + 1);
        }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    geometry.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geometry.setAttribute('sampleIndex', new THREE.BufferAttribute(sample, 1));
    geometry.setAttribute('arcDistance', new THREE.BufferAttribute(arc, 1));
    geometry.setAttribute('cutFace', new THREE.BufferAttribute(cut, 1));
    geometry.setIndex(indices);
    return geometry;
  }

  distanceAt(sample) {
    return yarnDistance(sample);
  }

  update() {
    if (this.simulation.isGPU) return;
    const sim = this.simulation,
      p = sim.positions,
      centers = this.centers,
      frames = this.frames,
      tangents = this.tangents;
    const offset = this.strand * sim.count,
      live = sim.active[this.strand],
      count = yarnSamples(live);
    const cut = live === sim.count ? yarnCutFraction(sim.phase[this.strand]) : 0;
    this.cutFraction.value = cut;
    this.activeCount.value = live;
    this.mesh.geometry.setDrawRange(0, yarnIndexCount(live));
    for (let i = 0; i < count; i++) {
      // The unspooled lead continues above the simulated inlet, so portrait
      // framing and zooming out never reveal floating cut ends.
      if (i < LEAD_SAMPLES) {
        centers[i * 3] = p[offset * 3];
        centers[i * 3 + 1] = p[offset * 3 + 1] + (LEAD_SAMPLES - i) * LEAD_SPACING;
        centers[i * 3 + 2] = p[offset * 3 + 2];
        tangents[i * 3] = 0;
        tangents[i * 3 + 1] = -1;
        tangents[i * 3 + 2] = 0;
        continue;
      }
      const f = yarnParticleIndex(i, live, cut),
        j = Math.floor(f),
        t = f - j;
      const a = (offset + Math.max(0, j - 1)) * 3,
        b = (offset + j) * 3;
      const c = (offset + Math.min(live - 1, j + 1)) * 3,
        d = (offset + Math.min(live - 1, j + 2)) * 3;
      for (let k = 0; k < 3; k++) {
        centers[i * 3 + k] = catmull(p[a + k], p[b + k], p[c + k], p[d + k], t);
        tangents[i * 3 + k] = catmullTangent(p[a + k], p[b + k], p[c + k], p[d + k], t);
      }
    }
    let nx = 1,
      ny = 0,
      nz = 0;
    for (let i = 0; i < count; i++) {
      let tx = tangents[i * 3],
        ty = tangents[i * 3 + 1],
        tz = tangents[i * 3 + 2];
      let length = Math.hypot(tx, ty, tz) || 1;
      tx /= length;
      ty /= length;
      tz /= length;
      // Parallel transport keeps the cross-section from flipping at inflections.
      let dot = nx * tx + ny * ty + nz * tz;
      nx -= dot * tx;
      ny -= dot * ty;
      nz -= dot * tz;
      length = Math.hypot(nx, ny, nz);
      if (length < 0.00001) {
        nx = -ty;
        ny = tx;
        nz = 0;
        length = Math.hypot(nx, ny) || 1;
      }
      nx /= length;
      ny /= length;
      nz /= length;
      const bx = ty * nz - tz * ny,
        by = tz * nx - tx * nz,
        bz = tx * ny - ty * nx;
      // Reuse the texture buffer; longer strands should not create thousands
      // of temporary arrays on every rendered frame.
      const centerOffset = i * 4,
        normalOffset = (this.samples + i) * 4,
        binormalOffset = (this.samples * 2 + i) * 4;
      frames[centerOffset] = centers[i * 3];
      frames[centerOffset + 1] = Math.max(RADIUS * 0.98, centers[i * 3 + 1]);
      frames[centerOffset + 2] = centers[i * 3 + 2];
      frames[centerOffset + 3] = 1;
      frames[normalOffset] = nx;
      frames[normalOffset + 1] = ny;
      frames[normalOffset + 2] = nz;
      frames[binormalOffset] = bx;
      frames[binormalOffset + 1] = by;
      frames[binormalOffset + 2] = bz;
    }
    this.travel.value = sim.travel[this.strand];
    this.frameTexture.needsUpdate = true;
  }

  setColor(hex) {
    this.tint.value.set(hex);
    this.material.color.set(hex);
    this.material.sheenColor.set(hex).lerp(new THREE.Color('#fff4df'), 0.5);
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.frameTexture?.dispose();
    this.surfaceTexture.dispose();
  }
}
