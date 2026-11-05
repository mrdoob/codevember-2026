import { Fn, float, reference, renderGroup, texture, vogelDiskSample } from 'three/tsl';

// A fixed disk avoids the screen-space grain of r187's five randomly rotated
// PCF samples. Hardware comparison filtering still smooths each lookup.
export function createSoftShadowFilter(shadow) {
  const radius = reference('radius', 'float', shadow).setGroup(renderGroup);
  const mapSize = reference('mapSize', 'vec2', shadow).setGroup(renderGroup);
  return Fn(({ depthTexture, shadowCoord }) => {
    const visibility = float(0).toVar();
    for (let i = 0; i < 16; i++) {
      const offset = vogelDiskSample(i, 16, .73).mul(radius.div(mapSize));
      visibility.addAssign(texture(depthTexture, shadowCoord.xy.add(offset)).compare(shadowCoord.z));
    }
    return visibility.div(16);
  });
}
