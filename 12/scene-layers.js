import { Color, Layers, PassNode, StandardDrawingPipeline } from 'three/webgpu';
import { context, mrt, output, pass, positionView, perspectiveDepthToViewZ, screenUV, uniform, vec4 } from 'three/tsl';
import { createDepthInstances } from './depth-instances.js';
import { FOCUS_BAND } from './scene-constants.js';

const lensDepth = positionView.z.negate().toVarying('v_lensDepth').setInterpolation('perspective', 'centroid');

class FeatherPass extends PassNode {
  constructor(scene, camera, kind, index, focus, environment, drawingPipeline) {
    super(PassNode.COLOR, scene, camera, { samples: 4 });
    this.kind = kind; this.name = `Feathers / ${kind}`;
    this.environment = environment;
    this.drawingPipeline = drawingPipeline;
    const mask = new Layers(); mask.set(index); this.setLayers(mask);
    const environmentDepth = perspectiveDepthToViewZ(environment.getTextureNode('depth').sample(screenUV).r,
      uniform(camera.near), uniform(camera.far)).negate();
    this.contextNode = context({ getOutput: (node, builder) => {
      if (builder.camera === camera && builder.object.parent !== null) {
        const near = lensDepth.lessThan(focus.sub(FOCUS_BAND.near));
        const far = lensDepth.greaterThan(focus.add(FOCUS_BAND.far));
        const outside = kind === 'foreground' ? near.not() : kind === 'background' ? far.not() : near.or(far);
        outside.discard();
        // Respect unblurred environment depth so buried or hidden feathers
        // cannot show through the soil, buildings or trees.
        lensDepth.greaterThan(environmentDepth.add(.02)).discard();
      }
      return node;
    } });
  }
  updateBefore(frame) {
    // Resolve the dependency before changing the scene background or camera
    // mask. A lazy texture update inside the feather draw would inherit them.
    frame.updateBeforeNode(this.environment);
    const { renderer } = frame, { scene } = this;
    const background = scene.background, backgroundNode = scene.backgroundNode;
    const color = renderer.getClearColor(new Color()), alpha = renderer.getClearAlpha();
    const drawingPipeline = renderer.drawingPipeline;
    scene.background = null; scene.backgroundNode = null;
    renderer.setClearColor(0, 0); renderer.drawingPipeline = this.drawingPipeline;
    try { super.updateBefore(frame); }
    finally {
      scene.background = background; scene.backgroundNode = backgroundNode;
      renderer.setClearColor(color, alpha); renderer.drawingPipeline = drawingPipeline;
    }
  }
}

export function createSceneLayers(scene, camera, focus, focusRange) {
  const instances = createDepthInstances(scene, camera), lights = [];
  scene.traverse(object => {
    if (object.isLight) {
      lights.push([object, object.layers.mask]);
      for (const layer of [1, 2, 3]) object.layers.enable(layer);
    }
  });
  const mask = new Layers(); mask.set(0);
  const environment = pass(scene, camera, { samples: 4 }).setLayers(mask);
  environment.name = 'Environment / meshlet field and farm';
  // This pass can update as a feather depth dependency. Do not inherit that
  // feather pass's clipping context while rendering the environment itself.
  environment.contextNode = context({ getOutput: node => node });
  // Feather materials use ordinary instancing. Keep these passes out of the
  // meshlet pipeline so they cannot overwrite its static field visibility cache.
  const drawingPipeline = new StandardDrawingPipeline();
  const background = new FeatherPass(scene, camera, 'background', 1, focus, environment, drawingPipeline);
  const focused = new FeatherPass(scene, camera, 'focused', 2, focus, environment, drawingPipeline);
  const foreground = new FeatherPass(scene, camera, 'foreground', 3, focus, environment, drawingPipeline);
  function bins(layer, distance) {
    const coc = distance.smoothstep(0, focusRange);
    const medium = coc.smoothstep(0, .35), large = coc.smoothstep(.35, .95);
    const weights = [medium.oneMinus(), medium.mul(large.oneMinus()), large];
    const names = ['output', 'medium', 'large'], outputs = {};
    names.forEach((name, i) => { outputs[name] = vec4(output.rgb.mul(weights[i]), weights[i]); });
    const attachments = mrt(outputs);
    for (const name of names) attachments.setClearColor(name, 0, 0);
    layer.setMRT(attachments);
    return names.map(name => layer.getTextureNode(name));
  }
  const farInputs = bins(background, lensDepth.sub(focus.add(FOCUS_BAND.far)));
  const nearInputs = bins(foreground, focus.sub(FOCUS_BAND.near).sub(lensDepth));
  return {
    environment, background, focused, foreground, instances, farInputs, nearInputs,
    passes: [environment, background, focused, foreground],
    update() { instances.update(focus.value); },
    dispose() {
      for (const layer of this.passes) layer.dispose();
      drawingPipeline.dispose();
      instances.dispose(); lights.forEach(([light, mask]) => { light.layers.mask = mask; });
    },
  };
}
