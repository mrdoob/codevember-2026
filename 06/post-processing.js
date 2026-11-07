import * as THREE from "three/webgpu";
import {
  pass,
  mrt,
  output,
  normalView,
  diffuseColor,
  velocity,
  metalness,
  roughness,
  sample,
  vec2,
  vec3,
  vec4,
  uniform,
  screenUV,
  mix,
  rtt,
  Fn,
  property,
  If,
} from "three/tsl";
import { ssgi } from "three/addons/tsl/display/SSGINode.js";
import { ssr } from "./vendor/SSRNode.js";
import { traa } from "three/addons/tsl/display/TRAANode.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { temporalDenoise } from "three/addons/tsl/display/DenoiseNode.js";
import { ENV_RAY_LENGTH_THRESHOLD } from "three/addons/tsl/utils/SpecularHelpers.js";
import { createLightShafts } from "./light-shafts.js";
import { createBeamDust } from "./beam-dust.js";
import { sphereDirect } from "./sphere-area-light.js";
import { createBackgroundDOF } from "./background-dof.js";

export function createPostProcessing(
  renderer,
  scene,
  camera,
  caustics,
  time,
) {
  // Two half floats keep precise normals and room for the specular attachment
  // within WebGPU's default 32-byte colour-attachment budget.
  const encodeNormal = Fn(([normal]) => {
    const n = normal.div(normal.abs().dot(vec3(1))).toVar();
    const xy = n.xy.toVar();
    If(n.z.lessThan(0), () => {
      xy.assign(
        n.yx
          .abs()
          .oneMinus()
          .mul(
            vec2(
              n.x.greaterThanEqual(0).select(1, -1),
              n.y.greaterThanEqual(0).select(1, -1),
            ),
          ),
      );
    });
    return xy;
  });
  const decodeNormal = Fn(([packed]) => {
    const n = vec3(
      packed,
      packed.x.abs().add(packed.y.abs()).oneMinus(),
    ).toVar();
    const t = n.z.negate().clamp();
    n.x.addAssign(n.x.greaterThanEqual(0).select(t.negate(), t));
    n.y.addAssign(n.y.greaterThanEqual(0).select(t.negate(), t));
    return n.normalize();
  });
  // Capture environment specular separately so a screen-space hit replaces it.
  // Adding SSR over the complete beauty pass washes dark reflections out.
  const environmentSpecular = property("vec3", "orreryEnvironmentSpecular");
  const areaSpecular = property("vec3", "orreryAreaSpecular");
  const materialSetups = new Map();
  scene.traverse((object) => {
    for (const material of object.material ? [object.material].flat() : []) {
      if (materialSetups.has(material)) continue;
      const setup = material.setupLightingModel;
      if (!setup) continue;
      materialSetups.set(material, setup);
      material.setupLightingModel = function (builder) {
        const model = setup.call(this, builder);
        if (!model) return model;
        const sphereLightFarField = this.userData.sphereLightFarField;
        const direct = model.direct;
        model.direct = function (input, builder) {
          if (input.sphereRadius) {
            const before = input.reflectedLight.directSpecular.toVar();
            // In the far field the source is under five degrees in radius.
            // Use the punctual limit on the room, keeping the finite emitter
            // integration for the nearby glass, mechanism and pedestal.
            if (sphereLightFarField) {
              direct.call(this, input, builder);
            } else {
              If(input.sphereVector.length().lessThan(8), () => {
                sphereDirect.call(this, input, builder);
              }).Else(() => {
                direct.call(this, input, builder);
              });
            }
            areaSpecular.addAssign(
              input.reflectedLight.directSpecular.sub(before),
            );
          } else direct.call(this, input, builder);
        };
        const area = model.directRectArea;
        model.directRectArea = function (input, builder) {
          const before = input.reflectedLight.directSpecular.toVar();
          area.call(this, input, builder);
          areaSpecular.addAssign(
            input.reflectedLight.directSpecular.sub(before),
          );
        };
        const finish = model.finish;
        model.finish = function (builder) {
          finish.call(this, builder);
          environmentSpecular.assign(
            builder.context.reflectedLight.indirectSpecular.add(areaSpecular),
          );
        };
        return model;
      };
    }
  });
  // Temporal AA supplies subpixel coverage; MSAA must be off for TRAA.
  const scenePass = pass(scene, camera, { samples: 0 });
  scenePass.name = "Scene beauty";
  const layers = new THREE.Layers();
  layers.set(0);
  layers.enable(1);
  scenePass.setLayers(layers);
  const glassMask = uniform(0).onObjectUpdate(({ object }) =>
    object.userData.isGlass ? 1 : 0,
  );
  const glassF0 = uniform(0.04),
    transmissionAmount = uniform(1);
  const skipSSR = uniform(0).onObjectUpdate(({ object }) =>
    object.userData.skipSSR ? 1 : 0,
  );
  // Half floats represent these eleven metadata bits exactly: 4 metalness,
  // 6 roughness and 1 glass flag. This removes an entire MRT attachment.
  const surfaceFlags = metalness
    .mul(15)
    .round()
    .add(mix(roughness, 1, skipSSR).mul(63).round().mul(16))
    .add(glassMask.mul(1024));
  scenePass.setMRT(
    mrt({
      output,
      normal: encodeNormal(normalView),
      diffuse: vec4(diffuseColor.rgb, surfaceFlags),
      velocity,
      environment: vec4(environmentSpecular, 1),
    }),
  );
  scenePass.getTexture("velocity").format = THREE.RGFormat;
  scenePass.getTexture("normal").format = THREE.RGFormat;
  scenePass.getTexture("diffuse").minFilter = THREE.NearestFilter;
  scenePass.getTexture("diffuse").magFilter = THREE.NearestFilter;
  scenePass.getTexture("environment").format = THREE.RGBFormat;
  scenePass.getTexture("environment").type = THREE.UnsignedInt101111Type;
  const beauty = scenePass.getTextureNode("output"),
    depth = scenePass.getTextureNode("depth"),
    surface = scenePass.getTextureNode("diffuse");
  const diffuse = sample((uv) => {
    const s = surface.sample(uv);
    return vec4(s.rgb, s.a.div(1024).floor());
  });
  const metalRough = sample((uv) => {
    const flags = surface.sample(uv).a.round();
    return vec2(flags.mod(16).div(15), flags.div(16).floor().mod(64).div(63));
  });
  const normals = scenePass.getTextureNode("normal"),
    motion = scenePass.getTextureNode("velocity"),
    environment = scenePass.getTextureNode("environment");
  const normal = sample((uv) => decodeNormal(normals.sample(uv).rg));
  const shafts = createLightShafts(depth, camera, caustics);
  const dust = createBeamDust(depth, camera, caustics, time);
  const gi = ssgi(beauty, depth, normal, camera);
  gi.resolutionScale = 1 / 3;
  gi.sliceCount.value = 2;
  gi.stepCount.value = 8;
  gi.radius.value = 4.5;
  gi.thickness.value = 0.35;
  gi.giIntensity.value = 3;
  gi.aoIntensity.value = 1;
  gi.useScreenSpaceSampling.value = false;
  const giInput = rtt(vec4(gi.getGINode().rgb, gi.getAONode()), null, null, {
    resolutionScale: 1 / 3,
  });
  const giDenoise = temporalDenoise(giInput, {
    depth,
    normal,
    camera,
    velocity: motion,
    alpha: true,
  });
  giDenoise.iterations = 2;
  giDenoise.luminancePhi.value = 4;
  giDenoise.maxFrames.value = 12;
  const reflections = ssr(beauty, depth, normal, {
    camera,
    stochastic: true,
    metalnessNode: metalRough.r,
    // Matte plaster/ceiling and the outside scenery contribute through IBL/GI.
    // Avoid tracing long, low-contribution reflection rays over most of the room.
    roughnessNode: Fn(() => {
      const r = metalRough.g.toVar();
      r.greaterThan(0.7).discard();
      return r;
    })(),
    diffuseNode: diffuse,
    // Glass uses its current IOR; ordinary dielectrics use F0 = 0.04.
    specularNode: mix(
      vec3(mix(0.04, glassF0, diffuse.a)),
      diffuse.rgb,
      metalRough.r,
    ),
    binaryRefine: true,
  });
  reflections.resolutionScale = 0.375;
  reflections.quality.value = 0.25;
  reflections.maxDistance.value = 12;
  reflections.thickness.value = 0.2;
  reflections.mirrorBias.value = 0.55;
  reflections.intensity.value = 1;
  reflections.screenEdgeFadeBlack = true;
  reflections.screenEdgeFade.value = 0.08;
  const reflectionTexture = reflections.getTextureNode();
  const hitCoverage = reflectionTexture.a
    .greaterThan(0)
    .and(reflectionTexture.a.lessThan(ENV_RAY_LENGTH_THRESHOLD))
    .select(1, 0);
  const reflectionInput = rtt(
    vec4(reflectionTexture.rgb.mul(hitCoverage), hitCoverage),
    null,
    null,
    { resolutionScale: 0.375 },
  );
  const temporalReflections = temporalDenoise(reflectionInput, {
    depth,
    normal,
    camera,
    velocity: motion,
    roughness: sample((uv) => metalRough.sample(uv).g),
    hitDistance: sample((uv) => reflectionTexture.sample(uv).a),
    // Keep radiance premultiplied through denoising AND bilinear upsampling.
    // Straight radiance at tiny coverage can otherwise bleed into neighbouring
    // covered texels and turn isolated bright SSR samples into sparkles.
    alpha: true,
  });
  // Filter reflection radiance and hit coverage together.
  temporalReflections.iterations = 2;
  temporalReflections.maxFrames.value = 16;
  const pipeline = new THREE.RenderPipeline(renderer),
    dofBlur = uniform(3);
  let key = "",
    composite,
    focused,
    temporal,
    defocus,
    glow;
  function configure(settings) {
    gi.giIntensity.value = settings.giIntensity;
    gi.radius.value = settings.giRadius;
    reflections.intensity.value = settings.reflectionIntensity;
    dofBlur.value = settings.dofBlur;
    glassF0.value = ((settings.ior - 1) / (settings.ior + 1)) ** 2;
    transmissionAmount.value = settings.transmission;
    const showShafts =
      settings.daylight < 1 &&
      settings.transmission > 0 &&
      settings.caustics > 0;
    const next = `${settings.ssgi}/${settings.ssr}/${settings.compare}/${settings.view}/${settings.denoise}/${showShafts}/${settings.dof}`;
    if (next === key) return false;
    key = next;
    glow?.dispose();
    defocus?.dispose();
    temporal?.dispose();
    focused?.dispose();
    composite?.dispose();
    giDenoise.reset();
    temporalReflections.reset();
    const giResult = settings.denoise ? giDenoise.getTextureNode() : giInput;
    const reflectionResult = settings.denoise
      ? temporalReflections.getTextureNode()
      : reflectionInput;
    let result = beauty.rgb;
    const opaque = diffuse.a.mul(transmissionAmount).oneMinus();
    const visibility = settings.ssgi ? mix(1, giResult.a, opaque) : 1;
    const indirect = diffuse.rgb
      .mul(giResult.rgb)
      .mul(opaque)
      .mul(metalRough.r.oneMinus());
    if (settings.ssgi) result = result.mul(visibility).add(indirect);
    if (settings.ssr)
      result = result
        .sub(
          environment.rgb
            .mul(reflectionResult.a)
            .mul(visibility)
            .mul(reflections.intensity.clamp()),
        )
        .max(0)
        .add(reflectionResult.rgb);
    if (showShafts && settings.view === "Full scene")
      result = result.add(shafts.rgb).add(dust.node.rgb);
    if (settings.view === "Indirect light") result = indirect;
    if (settings.view === "Reflections") result = reflectionResult.rgb;
    if (settings.view === "Contact shading") result = vec3(giResult.a);
    if (settings.compare)
      result = mix(beauty.rgb, result, screenUV.x.greaterThan(0.5));
    composite = rtt(vec4(result, 1));
    defocus =
      settings.dof && settings.view === "Full scene"
        ? createBackgroundDOF(composite, depth, camera, dofBlur)
        : null;
    focused = defocus
      ? rtt(defocus.node, null, null, { depthBuffer: false })
      : null;
    // Resolve depth-dependent silhouettes together with the geometry. Applying
    // a raw-depth mask after TRAA would restore jagged edges on the thin rings.
    temporal = traa(focused || composite, depth, motion, camera);
    glow = bloom(temporal, 0.14, 0.5, 2.2);
    pipeline.outputNode = vec4(temporal.rgb.add(glow.rgb), 1);
    pipeline.needsUpdate = true;
    return true;
  }
  return {
    pipeline,
    scenePass,
    gi,
    reflections,
    temporalReflections,
    giDenoise,
    shafts,
    dust,
    get dof() {
      return defocus;
    },
    configure,
    async warmup() {
      // Match the pass's visible layers, including the glass, during compilation.
      const mask = camera.layers.mask;
      camera.layers.mask = layers.mask;
      try {
        await scenePass.compileAsync(renderer);
      } finally {
        camera.layers.mask = mask;
      }
    },
    invalidate() {
      temporal?.setSize(1, 1);
      giDenoise.reset();
      temporalReflections.reset();
    },
    render() {
      defocus?.update(renderer);
      pipeline.render();
    },
    dispose() {
      glow?.dispose();
      defocus?.dispose();
      temporal?.dispose();
      focused?.dispose();
      composite?.dispose();
      pipeline.dispose();
      scenePass.dispose();
      shafts.dispose();
      dust.dispose();
      for (const [material, setup] of materialSetups)
        material.setupLightingModel = setup;
      gi.dispose();
      reflections.dispose();
      reflectionInput.dispose();
      giInput.dispose();
      giDenoise.dispose();
      temporalReflections.dispose();
    },
  };
}
