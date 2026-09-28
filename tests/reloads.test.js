// Reload choreography (client/render/reloads.js): every gun's reload style exists,
// keys run in order inside 0..1, and the sound cues are stages the audio engine plays.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RELOADS, reloadCues, sampleTrack, sampleSteps } from '../src/client/render/reloads.js';
import { WEAPONS, reloadStyle } from '../src/shared/weapons.js';

const STAGES = new Set(['out', 'in', 'bolt', 'shell', 'clip', 'open', 'close', 'pump', 'slide', 'rocket', 'jarOut', 'jarIn', 'crank', 'charge']);
const PLACES = new Set(['grip', 'pocket', 'at', 'mag', 'bolt', 'slide', 'pump', 'barrels']);

function ordered(name, keys) {
  assert.ok(Array.isArray(keys) && keys.length, `${name} has keys`);
  for (let i = 0; i < keys.length; i++) {
    const u = keys[i][0];
    assert.ok(u >= 0 && u <= 1, `${name} key ${i} is inside 0..1`);
    if (i) assert.ok(u >= keys[i - 1][0], `${name} key ${i} is in order`);
  }
}

test('every gun has a reload animation', () => {
  for (const [id, W] of Object.entries(WEAPONS)) assert.ok(RELOADS[reloadStyle(W)], `${id}: ${reloadStyle(W)}`);
});

for (const [style, R] of Object.entries(RELOADS)) {
  test(`reload "${style}" is well formed`, () => {
    if (R.gun) ordered(`${style}.gun`, R.gun);
    for (const [part, keys] of Object.entries(R.parts || {})) ordered(`${style}.parts.${part}`, keys);
    for (const hand of ['left', 'right']) {
      if (!R[hand]) continue;
      ordered(`${style}.${hand}`, R[hand]);
      for (const [, place] of R[hand]) assert.ok(PLACES.has(Array.isArray(place) ? place[0] : place), `${style}.${hand}: ${place}`);
    }
    if (R.prop) ordered(`${style}.prop`, R.prop);
    ordered(`${style}.cues`, R.cues);
    for (const [, s] of reloadCues(style)) assert.ok(STAGES.has(s), `${style} cue ${s}`);
  });
}

test('tracks hold before the first key, blend between keys and hold after the last', () => {
  const keys = [[0.2, [0, 10]], [0.6, [1, 20]]];
  const out = [0, 0];
  sampleTrack(keys, 0, out, 2);
  assert.deepEqual(out, [0, 10]);
  sampleTrack(keys, 0.4, out, 2);
  assert.ok(Math.abs(out[0] - 0.5) < 1e-9 && Math.abs(out[1] - 15) < 1e-9);
  sampleTrack(keys, 0.9, out, 2);
  assert.deepEqual(out, [1, 20]);
  const s = sampleSteps([[0, 'grip'], [0.5, 'mag']], 0.25);
  assert.equal(s.a, 'grip');
  assert.equal(s.b, 'mag');
  assert.equal(s.t, 0.5);
});
