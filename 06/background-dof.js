import { Vector2, Vector3 } from "three/webgpu";
import {
  Fn,
  If,
  float,
  ivec2,
  mix,
  perspectiveDepthToViewZ,
  reference,
  rtt,
  screenUV,
  uniform,
  vec2,
  vec3,
  vec4,
} from "three/tsl";

// A far-field lens blur: preserve the whole instrument, soften only the room.
// One half-resolution gather reuses the existing HDR colour and scene depth.
export function createBackgroundDOF(
  input,
  depth,
  camera,
  radius = uniform(3),
) {
  const focusEnd = uniform(25),
    falloff = uniform(12),
    texel = uniform(new Vector2());
  const near = reference("near", "float", camera),
    far = reference("far", "float", camera);
  const distance = (uv) =>
    perspectiveDepthToViewZ(depth.sample(uv).r, near, far).negate();
  const coc = (z) => z.sub(focusEnd).div(falloff).smoothstep(0, 1);
  const taps = 24;
  const blurred = rtt(
    Fn(() => {
      const uv = screenUV;
      const blur = coc(distance(uv)).toVar();
      const sum = vec3(0).toVar(),
        weight = float(0).toVar();
      If(blur.greaterThan(0.001), () => {
        const step = texel.mul(radius).mul(blur).toVar();
        // A fixed Vogel disk is stable during orbiting and contains no noise.
        for (let i = 0; i < taps; i++) {
          const angle = i * 2.39996323,
            r = Math.sqrt((i + 0.5) / taps);
          const offset = vec2(Math.cos(angle) * r, Math.sin(angle) * r);
          const sampleUV = uv.add(step.mul(offset)).toVar();
          const pixel = ivec2(
            sampleUV
              .mul(input.size())
              .floor()
              .clamp(vec2(0), input.size().sub(1)),
          ).toVar();
          // Reject sharp foreground samples so bright globes and thin brass
          // rails cannot smear into the room behind their silhouettes.
          const z = perspectiveDepthToViewZ(
            depth.load(pixel).r,
            near,
            far,
          ).negate();
          const w = z.sub(focusEnd).smoothstep(0, 0.75).toVar();
          // Match colour/depth texels exactly: bilinear colour would mix a
          // sharp rail into a background texel before depth rejection sees it.
          sum.addAssign(input.load(pixel).rgb.mul(w));
          weight.addAssign(w);
        }
      });
      // Keep colour premultiplied across half-resolution upsampling.
      return vec4(sum.div(taps), weight.div(taps));
    })(),
    null,
    null,
    { resolutionScale: 0.5, depthBuffer: false },
  );
  blurred.name = "Background depth of field";
  const node = Fn(() => {
    const background = blurred.sample(screenUV).toVar();
    const amount = coc(distance(screenUV)).mul(
      background.a.smoothstep(0, 0.2),
    );
    return vec4(
      mix(input.rgb, background.rgb.div(background.a.max(0.0001)), amount),
      1,
    );
  })();
  const size = new Vector2(),
    centre = new Vector3();
  return {
    node,
    blurred,
    focusEnd,
    falloff,
    radius,
    update(renderer) {
      // This sphere contains the base and every moving part. Its rear tangent
      // tracks camera altitude/orbit without pulling focus off a far carrier.
      camera.updateMatrixWorld();
      centre.set(0, 5.7, 0).applyMatrix4(camera.matrixWorldInverse);
      focusEnd.value = Math.max(camera.near, -centre.z + 6.5);
      renderer.getSize(size);
      // Radius is in CSS pixels, independent of DPR and render-target scale.
      texel.value.set(1 / size.x, 1 / size.y);
    },
    dispose() {
      blurred.dispose();
    },
  };
}
