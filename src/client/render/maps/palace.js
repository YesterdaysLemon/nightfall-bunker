// The Aurora Picture Palace's dressing (shared/maps/palace.js is its data): a boarded-up
// 1960s movie palace at night. The shell and trim (palace/shell.js), the rooms and their
// furniture (palace/rooms.js, palace/theatre.js), the street, alley, fire escape and
// dock outside (palace/outside.js), a fixture for every lamp (palace/lamps.js), and the
// velvet curtain over the Forge's alcove (the map's one custom door). Its own painted
// textures (palace/paint.js) follow the game's 1997 TV look like the shared ones.
//
// A map's dressing is { build(level, batch), after(level), door(level, d), update(level, dt),
// dispose(level) }; see ../level.js for when each runs.
//
// The palace's geometry does not depend on the level it hangs on, so it is built once
// (built(): merged per material, then split into spatial chunks so the camera only draws
// the parts it can see) and every later Level of the palace only makes meshes around it:
// switching back to the map costs a few dozen objects, not a rebuild. Level.dispose frees
// the GPU copies of the geometry and they upload again on the next visit.

import * as THREE from 'three';
import { Batch } from '../geo.js';
import { palaceTextures, paintNext, releaseTextures, syncRetro } from './palace/paint.js';
import { buildShell, buildCasings } from './palace/shell.js';
import { buildLamps, attachLamps } from './palace/lamps.js';
import { buildRooms } from './palace/rooms.js';
import { buildTheatre, attachTheatre } from './palace/theatre.js';
import { buildOutside, attachOutside } from './palace/outside.js';
import { buildCurtain } from './palace/curtain.js';
import { chunkBatch } from './palace/chunks.js';
import { Culler, buildPortals } from './palace/zones.js';

function lambert(map, extra = {}) {
  return new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
}

// The palace's materials, added to the level's own (meshes look them up by name).
function addMaterials(level) {
  const t = level.ptex;
  Object.assign(level.mats, {
    drape: lambert(t.drape),
    plush: lambert(t.plush),
    carpet: lambert(t.carpet),
    gilt: lambert(t.gilt),
    damask: lambert(t.damask),
    panel: lambert(t.panel),
    mahogany: lambert(t.mahogany),
    cream: lambert(t.cream),
    terracotta: lambert(t.terracotta),
    linen: lambert(t.linen),
    posters: lambert(t.posters),
    signs: lambert(t.signs),
    screen: lambert(t.screen, { alphaTest: 0.5, side: THREE.DoubleSide }),
    // Glass (poster cases, the booth, shop windows): a faint cool sheen over what's behind.
    mirror: new THREE.MeshLambertMaterial({ color: 0x8d9ca4, transparent: true, opacity: 0.2, vertexColors: true, depthWrite: false }),
    // Silvered mirrors (the vanity, the back bar): mostly opaque, grey-green and foxed.
    silver: new THREE.MeshLambertMaterial({ color: 0x84928e, transparent: true, opacity: 0.8, vertexColors: true }),
    // Standing water: dark, with a little of the sky's blue in it.
    puddle: new THREE.MeshLambertMaterial({ color: 0x1a222c, transparent: true, opacity: 0.7, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    dome: lambert(t.dome),
    // Plain paint: the colour is all in the vertex tint (the car, the hydrant, bins).
    enamel: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    // Chain-link fences: cut-out wire.
    chainlink: new THREE.MeshLambertMaterial({ map: t.chainlink, alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true }),
    // The ghost sign painted on the alley's brick (its alpha is the paint).
    ghostSign: new THREE.MeshLambertMaterial({ map: t.ghost, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, vertexColors: true, opacity: 0.7 }),
  });
}

// --- The palace's geometry, built once -------------------------------------------------------------

let BUILT = null;

// Every builder writes into one batch (any material name will do: the meshes are made per
// level, with that level's own materials) or, for repeated pieces, into ctx.instances. The
// build is a generator, one step per part (each a few milliseconds), so it can be done a
// step at a time in idle moments (prewarm) or all at once (built).
function* buildSteps() {
  const batch = new Batch(new Proxy({}, { get: () => true }));
  const ctx = { batch, instances: [] };
  yield* buildShell(batch);
  buildCasings(batch);
  const lamps = yield* buildLamps(batch);
  yield* buildRooms(ctx);
  const moon = yield* buildTheatre(ctx);
  const outside = yield* buildOutside(batch);
  const chunks = yield* chunkBatch(batch);
  BUILT = { chunks, instances: ctx.instances, lamps, moon, outside, portals: buildPortals() };
}

let steps = null;
function built() {
  if (!BUILT) {
    steps ||= buildSteps();
    while (!BUILT) if (steps.next().done && !BUILT) throw new Error('the palace failed to build');
  }
  return BUILT;
}

// The shared geometry (for tests and the tour's statistics).
export const palaceGeometry = built;

// A few seconds after the game loads, when the browser has nothing to do, paint the palace's
// pages and build its geometry a step at a time, so choosing the map finds them ready. Nothing
// runs unless the browser reports idle time (Safari has no idle callbacks: no warm-up there).
function prewarm() {
  if (typeof requestIdleCallback !== 'function') return;
  const step = () => { if (!paintNext()) { steps ||= buildSteps(); steps.next(); } };
  const idle = (deadline) => {
    if (BUILT) return;
    // a step at a time while the frame has time to spare (one, if the browser has forced this call)
    if (deadline.didTimeout) step();
    else while (!BUILT && deadline.timeRemaining() > 5) step();
    if (!BUILT) requestIdleCallback(idle, { timeout: 2000 });
  };
  setTimeout(() => requestIdleCallback(idle, { timeout: 2000 }), 5000);
}
prewarm();

// The meshes of one level of the palace, around the shared geometry.
function attach(level, B) {
  const mats = level.mats;
  const culler = new Culler(B.portals);
  const use = (key) => mats[key] || (() => { throw new Error(`palace: no material ${key}`); })();
  for (const { key, geo, zones } of B.chunks) {
    const mesh = new THREE.Mesh(geo, use(key));
    mesh.name = key;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    level.group.add(mesh);
    culler.add(mesh, zones);
  }
  for (const it of B.instances) {
    const mesh = new THREE.InstancedMesh(it.geo, use(it.key), it.count);
    mesh.instanceMatrix = it.matrices;
    mesh.instanceColor = it.colors;
    mesh.computeBoundingSphere();
    mesh.name = it.name;
    level.group.add(mesh);
    culler.add(mesh, it.zones);
  }
  const reg = (mesh, zones) => culler.add(mesh, zones);
  return {
    culler,
    lamps: attachLamps(level, B.lamps, reg),
    theatre: attachTheatre(level, B.moon, reg),
    outside: attachOutside(level, B.outside, reg),
  };
}

export const PALACE_DRESS = {
  build(level) {
    level.ptex = palaceTextures();
    syncRetro(level.ptex, level.tex);
    addMaterials(level);
    level.palace = attach(level, built());
  },

  after() {},

  // The Forge's curtain: heavy red velvet that parts when the teleporter is first used.
  door(level, d) {
    return buildCurtain(level, d);
  },

  update(level, dt) {
    syncRetro(level.ptex, level.tex);
    const P = level.palace;
    if (!P) return;
    P.culler.update(level.rig.camera);
    P.lamps.update(dt);
    P.outside.update(dt);
  },

  dispose(level) {
    level.palace = null;
    releaseTextures();
  },
};
