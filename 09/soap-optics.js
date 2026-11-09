import { SOAP_SPECTRUM } from "./soap-spectrum.js";

// Ideal, nonabsorbing air / aqueous film / air, with unpolarized illumination.
export const SOAP_IOR = 1.33,
  SOAP_MAX_THICKNESS = 1200,
  SOAP_LUT_WIDTH = 512,
  SOAP_LUT_HEIGHT = 256;

function interfaces(cosine, n) {
  const c = Math.min(1, Math.max(0, Math.abs(cosine)));
  const ct = Math.sqrt(1 - (1 - c * c) / (n * n));
  return {
    ct,
    rs: ((c - n * ct) / (c + n * ct)) ** 2,
    rp: ((n * c - ct) / (n * c + ct)) ** 2,
  };
}
function airy(thickness, wavelength, n, { ct, rs, rp }) {
  if (thickness === 0) return 0;
  const s = Math.sin((2 * Math.PI * n * thickness * ct) / wavelength) ** 2;
  const polarized = (r) =>
    (4 * r * s) / Math.max((1 - r) ** 2 + 4 * r * s, 1e-30);
  return 0.5 * (polarized(rs) + polarized(rp));
}
export function soapReflectance(thickness, cosine, wavelength, n = SOAP_IOR) {
  return airy(Math.max(0, thickness), wavelength, n, interfaces(cosine, n));
}
export function soapReflectanceRGB(thickness, cosine) {
  const boundary = interfaces(cosine, SOAP_IOR),
    rgb = [0, 0, 0];
  for (const [wavelength, r, g, b] of SOAP_SPECTRUM) {
    const R = airy(Math.max(0, thickness), wavelength, SOAP_IOR, boundary);
    rgb[0] += R * r;
    rgb[1] += R * g;
    rgb[2] += R * b;
  }
  // The renderer is RGB, so out-of-gamut spectral colors must be clipped.
  return rgb.map((v) => Math.max(0, Math.min(1, v)));
}
let cached;
export function createSoapOpticsLUT() {
  if (cached) return cached;
  const data = new Float32Array(SOAP_LUT_WIDTH * SOAP_LUT_HEIGHT * 4);
  for (let y = 0; y < SOAP_LUT_HEIGHT; y++) {
    // More angular samples at grazing incidence, where Fresnel varies fastest.
    const cosine = (y / (SOAP_LUT_HEIGHT - 1)) ** 2;
    for (let x = 0; x < SOAP_LUT_WIDTH; x++) {
      const rgb = soapReflectanceRGB(
          (x / (SOAP_LUT_WIDTH - 1)) * SOAP_MAX_THICKNESS,
          cosine,
        ),
        k = (y * SOAP_LUT_WIDTH + x) * 4;
      data.set(rgb, k);
      data[k + 3] = 1;
    }
  }
  cached = data;
  return data;
}
