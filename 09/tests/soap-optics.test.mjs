import test from "node:test";
import assert from "node:assert/strict";
import {
  SOAP_IOR,
  SOAP_LUT_WIDTH as W,
  SOAP_LUT_HEIGHT as H,
  SOAP_MAX_THICKNESS as MAX,
  soapReflectance,
  soapReflectanceRGB,
  createSoapOpticsLUT,
} from "../soap-optics.js";

test("a vanishing film has no reflection, including at grazing incidence", () => {
  for (const c of [0, 0.001, 0.1, 0.5, 1])
    for (const wavelength of [380, 550, 780])
      assert.equal(soapReflectance(0, c, wavelength), 0);
});
test("quarter-wave maxima and half-wave minima include the interface phase reversal", () => {
  const n = SOAP_IOR,
    r = ((1 - n) / (1 + n)) ** 2;
  for (const wavelength of [400, 550, 700]) {
    assert.ok(
      Math.abs(
        soapReflectance(wavelength / (4 * n), 1, wavelength) -
          (4 * r) / (1 + r) ** 2,
      ) < 1e-14,
    );
    assert.ok(soapReflectance(wavelength / (2 * n), 1, wavelength) < 1e-25);
  }
});
test("reflection and independently evaluated transmission conserve energy", () => {
  const n = SOAP_IOR;
  for (const c of [0.001, 0.03, 0.2, 0.6, 1])
    for (let d = 10; d <= 1200; d += 37)
      for (const wavelength of [380, 470, 550, 650, 780]) {
        const ct = Math.sqrt(1 - (1 - c * c) / (n * n)),
          phase = (4 * Math.PI * n * d * ct) / wavelength;
        const rs = ((c - n * ct) / (c + n * ct)) ** 2,
          rp = ((n * c - ct) / (n * c + ct)) ** 2;
        const T =
          [rs, rp].reduce(
            (sum, r) =>
              sum +
              (1 - r) ** 2 /
                ((1 - r * Math.cos(phase)) ** 2 + (r * Math.sin(phase)) ** 2),
            0,
          ) * 0.5;
        const R = soapReflectance(d, c, wavelength);
        assert.ok(R >= 0 && R <= 1);
        assert.ok(Math.abs(R + T - 1) < 1e-10);
      }
});
test("Snell refraction shifts spectral extrema with the viewing angle", () => {
  const c = 0.4,
    ct = Math.sqrt(1 - (1 - c * c) / SOAP_IOR ** 2),
    wavelength = 550;
  assert.ok(
    soapReflectance(wavelength / (2 * SOAP_IOR * ct), c, wavelength) < 1e-24,
  );
  assert.ok(soapReflectance(wavelength / (2 * SOAP_IOR), c, wavelength) > 0.01);
  assert.deepEqual(soapReflectanceRGB(450, -c), soapReflectanceRGB(450, c));
});
test("the spectral lookup approximates direct integration without violating RGB energy bounds", () => {
  const lut = createSoapOpticsLUT();
  let maxError = 0;
  for (let i = 0; i < 240; i++) {
    const d = 30 + ((i * 139.73) % (MAX - 30)),
      c = 0.005 + ((i * 0.03719) % 0.995);
    const x = (d / MAX) * (W - 1),
      y = Math.sqrt(c) * (H - 1),
      ix = Math.floor(x),
      iy = Math.floor(y),
      fx = x - ix,
      fy = y - iy;
    const expected = soapReflectanceRGB(d, c);
    for (let channel = 0; channel < 3; channel++) {
      const a =
        lut[(iy * W + ix) * 4 + channel] * (1 - fx) +
        lut[(iy * W + ix + 1) * 4 + channel] * fx;
      const b =
        lut[((iy + 1) * W + ix) * 4 + channel] * (1 - fx) +
        lut[((iy + 1) * W + ix + 1) * 4 + channel] * fx;
      const value = a * (1 - fy) + b * fy;
      maxError = Math.max(maxError, Math.abs(value - expected[channel]));
      assert.ok(value >= 0 && value <= 1);
    }
  }
  assert.ok(maxError < 0.006, `lookup error ${maxError}`);
});
