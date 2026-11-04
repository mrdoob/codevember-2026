import test from 'node:test';
import assert from 'node:assert/strict';
import { color, float } from 'three/tsl';
import { WaxNodeMaterial } from '../wax-material.js';

test('EON reaches the lighting model alongside SSS and clearcoat', () => {
  const material = new WaxNodeMaterial({ diffuseRoughness: .65, clearcoat: .04 });
  material.thicknessColorNode = color('#e69b89');
  const check = expected => {
    const model = material.setupLightingModel();
    assert.equal(model.diffuseRoughness, expected, 'EON must reach PhysicalLightingModel');
    assert.equal(model.useSSS, true, 'SSS must remain enabled');
    assert.equal(model.clearcoat, true, 'Inherited physical features must remain enabled');
  };
  check(true);
  material.diffuseRoughness = 0;
  check(false);
  material.diffuseRoughnessNode = float(.65);
  check(true);
  material.dispose();
});
