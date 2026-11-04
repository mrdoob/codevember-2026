import {
  DataTexture,
  RGBAFormat,
  UnsignedByteType,
  RepeatWrapping,
  LinearFilter,
  LinearMipmapLinearFilter
} from 'three/webgpu';

// A tileable height field at several scales. Broad fiber bundles remain
// visible at the normal camera distance; fine filaments resolve on zooming in.
export function createYarnSurface(seed = 0) {
  const width = 512,
    height = 256,
    data = new Uint8Array(width * height * 4),
    tau = Math.PI * 2;
  const phase = seed * 1.618;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = x / width,
        v = y / height;
      const crimp = 0.6 * Math.sin(tau * (u * 3 + v * 2) + phase) + 0.25 * Math.sin(tau * (u * 7 - v * 3));
      const bundle = Math.cos(tau * (v * 7 + u) + crimp * 1.2);
      const wool = Math.sin(tau * (u * 5 + v * 11) + phase) * Math.sin(tau * (u * 3 - v * 7));
      const fiber = Math.cos(tau * v * 43 + crimp);
      const filament = Math.cos(tau * (v * 79 + u * 2) + 0.4 * Math.sin(tau * u * 5));
      const grain = Math.sin(tau * (u * 71 + v * 97) + phase) * Math.sin(tau * (u * 53 - v * 67));
      const mottling = 0.5 + 0.25 * Math.sin(tau * (u * 5 + v * 3) + phase) + 0.12 * Math.sin(tau * (u * 17 - v * 11));
      const h = 0.5 + bundle * 0.23 + wool * 0.09 + fiber * 0.09 + filament * 0.04 + grain * 0.025;
      const i = (y * width + x) * 4;
      data[i] = Math.round(h * 255);
      data[i + 1] = Math.round((mottling * 0.7 + h * 0.3) * 255);
      data[i + 2] = Math.round((0.5 + grain * 0.25 + fiber * 0.15) * 255);
      data[i + 3] = 255;
    }
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}
