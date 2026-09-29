// Every perk is complete: its numbers, a machine look, an icon, a jingle, and a
// machine on every map that has perks.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PERKS, PERK_IDS, maxHp, perkMult, perkCost } from '../src/shared/perks.js';
import { MAPS } from '../src/shared/map.js';
import { PERK_LOOKS } from '../src/client/render/machines.js';
import { PERK_SYMBOLS } from '../src/client/perk-icons.js';
import { PERK_JINGLES } from '../src/client/audio.js';

test('every perk has a name, a price, a colour and a blurb, and something it does', () => {
  const effects = ['hp', 'reviveMult', 'reloadMult', 'rateMult'];
  for (const id of PERK_IDS) {
    const P = PERKS[id];
    assert.ok(P.name && P.blurb, `${id} has words`);
    assert.ok(Number.isFinite(P.cost) && P.cost > 0, `${id} has a price`);
    assert.match(P.color, /^#[0-9a-f]{6}$/i, `${id} has a colour`);
    assert.ok(effects.some((k) => P[k] !== undefined), `${id} does something`);
  }
});

test('every perk has a machine, an icon and a jingle', () => {
  for (const id of PERK_IDS) {
    assert.ok(PERK_LOOKS[id], `${id} has a machine look (render/machines.js)`);
    assert.ok(PERK_SYMBOLS[id], `${id} has an icon (perk-icons.js)`);
    assert.ok(PERK_JINGLES.includes(id), `${id} has a jingle (audio.js)`);
  }
});

test('perk effects combine as documented', () => {
  assert.equal(maxHp([]), 100);
  assert.equal(maxHp(['ironclad']), PERKS.ironclad.hp);
  assert.equal(perkMult(['quicksilver', 'hairtrigger'], 'reloadMult'), PERKS.quicksilver.reloadMult);
  assert.equal(perkMult([], 'rateMult'), 1);
  assert.equal(perkCost('lazarus', true), PERKS.lazarus.solo.cost);
  assert.equal(perkCost('lazarus', false), PERKS.lazarus.cost);
});

test('a map with perk machines has one of each', () => {
  for (const map of Object.values(MAPS)) {
    if (!map.PERKS?.length) continue;
    assert.deepEqual(map.PERKS.map((m) => m.perk).sort(), [...PERK_IDS].sort(), `${map.id} sells every perk`);
    assert.ok(map.POWER, `${map.id} has a breaker for them`);
  }
});
