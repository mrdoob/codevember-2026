import { Vector3 } from 'three/webgpu';
import { color, mix, uniform } from 'three/tsl';

export const studioCenter = uniform(new Vector3());

// Shared by the lit floor and the off-screen transmission fallback.
export const studioFloorColor = position => mix(color('#101c2a'), color('#050b16'), position.sub(studioCenter).xz.length().div(23).smoothstep(0, 1));
