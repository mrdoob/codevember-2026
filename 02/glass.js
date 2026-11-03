import * as THREE from 'three/webgpu';
import { studioFloorColor } from './studio.js';
import { Fn, If, Loop, Break, float, vec2, vec3, vec4, color, uniform, attribute, mix, abs, normalView, positionView, normalize, refract, reflect, dot, pow, exp, log, depth, screenUV, texture, normalMap, textureSize, log2, max, smoothstep, cameraProjectionMatrix, cameraProjectionMatrixInverse, cameraWorldMatrix, getViewPosition, getScreenPosition, pmremTexture } from 'three/tsl';

export function createGlass(uniforms, maps) {
  const material = new THREE.MeshPhysicalNodeMaterial({
    roughness: 0, metalness: 0, clearcoat: 0.4, clearcoatRoughness: 0.018,
    side: THREE.FrontSide, ior: 1.46
  });
  const fracture = attribute('fractureFace', 'float');
  const edge = attribute('fractureEdge', 'float');
  const neutral = new THREE.Color(1, 1, 1);
  const objectTint = uniform(neutral).onObjectUpdate(({ object }) => object.userData.glassTint || neutral);
  const pigment = mix(vec3(1), objectTint.mul(uniforms.color), uniforms.tint);
  material.colorNode = pigment;
  const detail = texture(maps.roughness).r;
  material.normalNode = normalMap(texture(maps.normal), vec2(uniforms.bump.mul(mix(0.12, 1, fracture))));
  material.roughnessNode = uniforms.roughness.add(detail.mul(mix(0.004, 0.035, fracture))).add(edge.mul(0.018)).clamp(0.015, 1);
  material.iorNode = uniforms.ior;
  return { material, pigment };
}

// Sample the studio along the transmitted ray, including a subtle spectral
// separation. The fallback remains meaningful for off-screen and peeled glass.
function environmentTransmission(environment, directions, roughness, exitPoint, internalReflection) {
  const worldExit = cameraWorldMatrix.mul(vec4(exitPoint, 1)).xyz;
  const sample = (direction, channel) => {
    const worldRay = direction.transformDirection(cameraWorldMatrix);
    const studioLight = pmremTexture(environment, worldRay, roughness).rgb;
    const radiance = studioLight.mul(0.8).toVar();
    // Off-screen transmission sees the same seamless floor as the scene.
    // Keep the environment for total internal reflection and studio highlights.
    If(worldRay.y.lessThan(-0.001), () => {
      const travel = worldExit.y.max(0).div(worldRay.y.negate());
      const hit = worldExit.add(worldRay.mul(travel));
      const floor = studioFloorColor(hit).mul(1.7);
      radiance.assign(mix(floor, color('#030814'), travel.smoothstep(22, 55)));
    });
    return mix(radiance, studioLight, internalReflection[channel]);
  };
  return vec3(sample(directions[0], 0).r, sample(directions[1], 1).g, sample(directions[2], 2).b);
}

export function addRefraction(material, pigment, uniforms, buffers, environment, objectId) {
  const { frontDepth, behindColor, behindDepth, exitColor, exitDepth } = buffers;
  const nearest = frontDepth ? abs(depth.sub(frontDepth.sample(screenUV).r)).lessThan(0.00001) : null;
  material.backdropAlphaNode = uniforms.refraction;
  material.backdropNode = Fn(() => {
    const origin = positionView.toVar(), incident = normalize(origin).toVar();
    const entryNormal = normalView.toVar();
    const inside = refract(incident, entryNormal, uniforms.ior.reciprocal()).toVar();
    const chord = attribute('glassThickness', 'float').max(0.01);
    const distance = chord.div(abs(dot(inside, entryNormal)).max(0.35)).toVar();
    const exitNormal = entryNormal.negate().toVar();
    const exitPoint = origin.add(inside.mul(distance)).toVar();
    // Object identity prevents a neighboring fragment's back face from being
    // mistaken for this fragment's exit. Refine a depth crossing on the ray.
    If(uniforms.refraction.greaterThan(0), () => {
      const previous = float(0).toVar();
      Loop({ start: 1, end: 25, type: 'int', condition: '<' }, ({ i }) => {
        const travel = chord.mul(3).mul(float(i).div(24)).toVar();
        const point = origin.add(inside.mul(travel));
        const coord = getScreenPosition(point, cameraProjectionMatrix);
        If(coord.x.lessThan(0.002).or(coord.x.greaterThan(0.998)).or(coord.y.lessThan(0.002)).or(coord.y.greaterThan(0.998)), () => { Break(); });
        const packed = exitColor.sample(coord).level(0);
        const d = exitDepth.sample(coord).level(0).r;
        const surface = getViewPosition(coord, d, cameraProjectionMatrixInverse);
        If(abs(packed.a.sub(objectId)).lessThan(0.25).and(d.lessThan(0.99999)).and(point.z.lessThanEqual(surface.z)), () => {
          const low = previous.toVar(), high = travel.toVar();
          Loop(5, () => {
            const mid = low.add(high).mul(0.5);
            const p = origin.add(inside.mul(mid));
            const uv = getScreenPosition(p, cameraProjectionMatrix);
            const back = exitColor.sample(uv).level(0);
            const surfaceZ = getViewPosition(uv, exitDepth.sample(uv).level(0).r, cameraProjectionMatrixInverse).z;
            If(abs(back.a.sub(objectId)).lessThan(0.25).and(p.z.lessThanEqual(surfaceZ)), () => { high.assign(mid); }).Else(() => { low.assign(mid); });
          });
          distance.assign(low.add(high).mul(0.5));
          exitPoint.assign(origin.add(inside.mul(distance)));
          const exitUV = getScreenPosition(exitPoint, cameraProjectionMatrix);
          exitNormal.assign(normalize(exitColor.sample(exitUV).level(0).rgb.mul(2).sub(1)));
          Break();
        });
        previous.assign(travel);
      });
    });
    // Snell's law at both interfaces. Exit normals point out of the glass;
    // refract expects the normal pointing into the incident medium.
    const spread = uniforms.dispersion.mul(uniforms.ior.sub(1));
    const internalReflection = [];
    const outgoing = [-1, 0, 1].map(channel => {
      const eta = uniforms.ior.add(spread.mul(channel));
      const ray = refract(inside, exitNormal.negate(), eta).toVar();
      const tir = float(dot(ray, ray).lessThan(0.01)).toVar();
      internalReflection.push(tir);
      If(tir.greaterThan(0), () => { ray.assign(reflect(inside, exitNormal)); });
      return ray;
    });
    const roughness = material.roughnessNode;
    const transmitted = environmentTransmission(environment, outgoing, roughness, exitPoint, internalReflection).toVar();
    if (behindColor) {
      If(nearest.and(outgoing[1].z.lessThan(-0.01)), () => {
        const end = exitPoint.add(outgoing[1].mul(12));
        const startUV = getScreenPosition(exitPoint, cameraProjectionMatrix), endUV = getScreenPosition(end, cameraProjectionMatrix);
        const startK = exitPoint.z.negate().reciprocal(), endK = end.z.negate().reciprocal();
        const startQ = exitPoint.mul(startK), endQ = end.mul(endK);
        const previous = float(0).toVar();
        Loop({ start: 1, end: 81, type: 'int', condition: '<' }, ({ i }) => {
          const s = float(i).div(80), uv = mix(startUV, endUV, s);
          If(uv.x.lessThan(0.002).or(uv.x.greaterThan(0.998)).or(uv.y.lessThan(0.002)).or(uv.y.greaterThan(0.998)), () => { Break(); });
          const point = mix(startQ, endQ, s).div(mix(startK, endK, s));
          const d = behindDepth.sample(uv).level(0).r;
          const surface = getViewPosition(uv, d, cameraProjectionMatrixInverse);
          const error = surface.z.sub(point.z);
          If(d.lessThan(0.99999).and(surface.z.lessThan(origin.z.sub(0.01))).and(error.greaterThanEqual(0)).and(error.lessThan(0.25)), () => {
            const low = previous.toVar(), high = s.toVar();
            Loop(5, () => {
              const mid = low.add(high).mul(0.5), coord = mix(startUV, endUV, mid);
              const p = mix(startQ, endQ, mid).div(mix(startK, endK, mid));
              const z = getViewPosition(coord, behindDepth.sample(coord).level(0).r, cameraProjectionMatrixInverse).z;
              If(p.z.lessThan(z), () => { high.assign(mid); }).Else(() => { low.assign(mid); });
            });
            const hit = low.add(high).mul(0.5), coord = mix(startUV, endUV, hit);
            const rayPoint = mix(startQ, endQ, hit).div(mix(startK, endK, hit));
            const z = getViewPosition(coord, behindDepth.sample(coord).level(0).r, cameraProjectionMatrixInverse).z;
            const tolerance = max(abs(z).mul(4).div(float(textureSize(behindColor).y)), 0.015);
            If(abs(z.sub(rayPoint.z)).lessThan(tolerance), () => {
              const travel = rayPoint.sub(exitPoint).length();
              const footprint = roughness.pow(2).mul(travel.add(distance)).mul(float(textureSize(behindColor).y)).div(abs(origin.z).max(0.1));
              const lod = log2(footprint.add(1));
              const color = behindColor.sample(coord).level(lod).rgb;
              const edge = coord.x.min(coord.y).min(coord.x.oneMinus()).min(coord.y.oneMinus());
              transmitted.assign(mix(transmitted, color, smoothstep(0, 0.035, edge)));
              Break();
            });
          });
          previous.assign(s);
        });
      });
    }
    // Beer–Lambert attenuation makes thick interiors darker than thin tips.
    const absorption = log(pigment.max(vec3(0.015))).negate().mul(uniforms.absorption);
    const attenuation = exp(absorption.mul(distance).negate());
    const f0 = uniforms.ior.sub(1).div(uniforms.ior.add(1)).pow(2);
    const fresnel = f0.add(pow(float(1).sub(abs(dot(incident, entryNormal)).clamp()), 5).mul(f0.oneMinus()));
    return transmitted.mul(attenuation).mul(fresnel.oneMinus());
  })();
}
