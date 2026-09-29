// Every map's horde has a look for every zombie class, each look walks only on its
// maps, and the pick is the same on every client (it comes from the zombie's id).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { MAPS } from '../src/shared/map.js';
import { ZOMBIE_MODELS, zombieModelId } from '../src/client/render/zombie-models.js';

test('every horde look names real maps, and the boot horde has its files', () => {
  for (const [id, m] of Object.entries(ZOMBIE_MODELS)) {
    for (const map of m.maps || []) assert.ok(MAPS[map], `${id} walks on a known map (${map})`);
    assert.equal(m.weight.length, 3, `${id} has a weight per class`);
    if (!m.later) assert.ok(existsSync(new URL(`../public/models/${id}.json`, import.meta.url)), `${id}.json exists (the menu waits for it)`);
  }
  assert.ok(!ZOMBIE_MODELS.ghoul.maps && !ZOMBIE_MODELS.ghoul.later, 'the ghoul is everywhere and always loaded (the fallback look)');
});

test('each map picks only its own horde, for every class', () => {
  for (const mapId of Object.keys(MAPS)) {
    for (let cls = 0; cls < 3; cls++) {
      const seen = new Set();
      for (let id = 1; id <= 400; id++) {
        const look = zombieModelId(id, cls, mapId);
        const m = ZOMBIE_MODELS[look];
        assert.ok(!m.maps || m.maps.includes(mapId), `${look} does not walk on ${mapId}`);
        seen.add(look);
        assert.equal(zombieModelId(id, cls, mapId), look, 'the same id always gets the same look');
      }
      assert.ok(seen.size >= 2, `${mapId} class ${cls} has some variety (${[...seen]})`);
    }
  }
  assert.ok([...Array(200).keys()].some((i) => zombieModelId(i + 1, 0, 'palace') === 'usher'), 'the palace has its ushers');
  assert.ok(![...Array(200).keys()].some((i) => zombieModelId(i + 1, 0, 'palace') === 'mended'), 'and no bunker mechanics');
});
