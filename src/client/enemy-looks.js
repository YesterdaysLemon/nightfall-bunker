// How each enemy family looks and sounds when something happens to it: the
// client's half of src/shared/enemies.js (whose `look` field picks the family).
// A new enemy type can reuse a family here or add one; its renderer registers in
// render/zombies.js (Zombies.drawers).
//
// Each family: attack(game, z) plays the attack sound and returns a caption key;
// hit(game, x, y, z, dir, part) shows a bullet hit; kill(game, k) plays the death
// (k: { x, y, z, kind, dx, dz, mine, seed }, kind is a KILL code from protocol.js).

import { ZS, KILL } from '../shared/protocol.js';
import { enemy } from '../shared/enemies.js';

export const LOOKS = {
  zombie: {
    attack(g, z) {
      z.voice = g.audio.zombieAttack({ x: z.x, y: z.y + 1.5, z: z.z }, z.seed);
      return 'swipe';
    },
    hit(g, x, y, z, [ux, uy, uz], part) {
      g.fx.blood(x, y, z, ux, uy, uz, part === 0 ? 1.4 : 0.8);
    },
    kill(g, k) {
      if (k.kind === KILL.HEAD) {
        g.fx.blood(k.x, k.y + 1.65, k.z, k.dx * 0.5, 0.6, k.dz * 0.5, 2.5);
        if (k.mine) g.audio.headshot({ x: k.x, y: k.y + 1.6, z: k.z });
      } else if (k.kind === KILL.BLAST) {
        g.fx.blood(k.x, k.y + 1.0, k.z, k.dx, 0.8, k.dz, 2.5);
      } else if (k.kind === KILL.NUKE) {
        g.fx.blood(k.x, k.y + 1.2, k.z, 0, 1, 0, 1);
      } else if (k.kind === KILL.SHOCK) {
        g.audio.sizzle({ x: k.x, y: k.y + 1.2, z: k.z });   // the body fries in render/zombies.js
      }
      g.audio.zombieDeath({ x: k.x, y: k.y + 1.4, z: k.z }, k.seed);
    },
  },
  hound: {
    attack(g, z) {
      const at = { x: z.x, y: z.y + 0.6, z: z.z };
      const warp = z.state === ZS.WARP;
      z.voice = warp ? g.audio.houndBark(at, z.seed) : g.audio.houndBite(at);
      return warp ? 'howl' : 'bite';
    },
    hit(g, x, y, z, [ux, uy, uz]) {
      g.fx.blood(x, y, z, ux, uy, uz, 0.5);
      g.fx.add.emit(x, y, z, ux, 1, uz, 1, 0.5, 0.1, 1, 0.08, 0.3, 2, 1); // embers
    },
    kill(g, k) {
      g.fx.houndBurst(k.x, k.y, k.z);
      g.audio.houndDeath({ x: k.x, y: k.y + 0.6, z: k.z }, k.seed);
      if (k.kind === KILL.HEAD && k.mine) g.audio.headshot({ x: k.x, y: k.y + 0.6, z: k.z });
    },
  },
  kintsugi: {
    attack(g, z) {
      g.audio.bossAttack({ x: z.x, y: z.y + 1.5, z: z.z });
      return 'porcelain';
    },
    hit(g, x, y, z) {
      g.fx.porcelain(x, y, z, 0.12, 0.25);
    },
    kill(g, k) {
      g.fx.porcelain(k.x, k.y + 1.0, k.z, 2.5, 1.6);
      g.audio.bossDeath({ x: k.x, y: k.y + 1, z: k.z });
    },
  },
};

export function lookOf(cls) {
  return LOOKS[enemy(cls).look] || LOOKS.zombie;
}
