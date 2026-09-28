// Region probing (client/net.js probeRegions) picks the truly closest region
// even when parallel probes jitter each other by more than the gap between
// neighbours. Measured from California on 2026-09-28: wnam 45 ms, the "sam" beacon
// 61 ms (Cloudflare placed it in North America), enam 80 ms, the rest 150 ms+.

import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRegions } from '../src/client/net.js';
import { chooseRegion } from '../src/shared/protocol.js';
import { mulberry32 } from '../src/shared/rng.js';

const TRUE = { wnam: 45, enam: 80, sam: 61, weur: 157, eeur: 169, apac: 260, oc: 181, afr: 150, me: 175 };
const REGIONS = Object.keys(TRUE);

// A timer whose samples jitter by up to 40 ms while probes overlap, 3 ms alone.
function network(seed) {
  const rnd = mulberry32(seed);
  let active = 0;
  return async (r) => {
    active++;
    await new Promise((res) => setImmediate(res));
    const jitter = active > 1 ? rnd() * 40 : rnd() * 3;
    active--;
    return TRUE[r] + jitter;
  };
}

test('probing picks the closest region despite parallel jitter', async () => {
  let firstPassWrong = 0;
  for (let seed = 1; seed <= 300; seed++) {
    let firstPass = null;
    const out = await probeRegions(REGIONS, network(seed), (partial) => {
      if (!firstPass && Object.keys(partial).length === REGIONS.length) firstPass = partial;
    });
    assert.equal(chooseRegion([out], REGIONS).region, 'wnam', `seed ${seed}: ${JSON.stringify(out)}`);
    if (chooseRegion([firstPass], REGIONS).region !== 'wnam') firstPassWrong++;
  }
  // The jitter is real enough that one parallel pass alone gets it wrong sometimes.
  assert.ok(firstPassWrong > 0, 'the test network is noisy enough to matter');
});

test('an unreachable region is left out, not guessed', async () => {
  const time = async (r) => (r === 'apac' ? null : TRUE[r]);
  const out = await probeRegions(REGIONS, time);
  assert.equal(out.apac, undefined);
  assert.equal(out.wnam, 45);
});
