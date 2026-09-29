// Reload and cycling choreography for the first-person guns, as keyframes over
// progress u (0..1), so every reload stretches to its gun's WEAPONS[id].reload.
// The viewmodel (viewmodel.js) plays these; game.js plays the reload sound cues.
// CYCLES (at the end) are the short actions after a shot: work the bolt, rack the
// pump, the slide's kick, the Leyden Rifle's crank, a revolver's hammer; STYLE_CYCLES
// picks one by reload style where the gun's kind does not imply it.
//
// A style has any of:
//   gun    [[u, [x, y, z, rx, ry, rz]], ...]   offset of the whole gun from its pose
//   parts  { mag | bolt | slide | pump | barrels | ...: [[u, [x, y, z, rx, ry, rz, shown]], ...] }
//          (any part a gun has, e.g. the HK21's cover and belt or the Python's ejector)
//          offsets from the part's rest pose, in the gun's frame (a part riding on
//          another: in that part's frame); `shown` (default 1)
//          switches, it does not blend (a magazine vanishes off screen and comes back)
//   left, right  [[u, place], ...] where each hand is (see HAND_PLACES in viewmodel.js):
//          'grip' (its hold), 'pocket' (off screen, fetching), or a part name ('mag',
//          'bolt', ...) to hold that part where it currently is; or [place, [x, y, z]
//          offset, pose] where place 'at' is a point in the gun's frame and a part's
//          offset is in that part's frame (so it turns with a crank)
//   prop   [[u, name | null], ...]   what the left hand carries: 'shell', 'shells', 'clip',
//          'speedloader', 'shell40'
//   eject  [u, name, count, 'drop'?] spent cases thrown out of the gun at u ('case',
//          'shell', 'case40'); 'drop' lets them fall instead of flicking them out
//   emptyOnly  [part, ...]           tracks that only play when the gun ran dry
//   cues   [[u, sound], ...]         AudioEngine.reload stages
// Keys blend with smoothstep between neighbours and hold before the first and
// after the last key.

const Z6 = [0, 0, 0, 0, 0, 0];
// The right hand on a turned-down bolt handle's knob.
const BOLT_HAND = ['bolt', [0.05, -0.03, 0.01], 'grip'];
// The left hand on the Leyden Rifle's crank knob (it turns with the crank).
const CRANK_HAND = ['bolt', [-0.018, 0.03, 0], 'crank'];

export const RELOADS = {
  // Detachable box magazine (rifles, SMGs, the BAR, the drum-fed PPSh, the MG 42's belt drum).
  mag: {
    gun: [
      [0, Z6], [0.12, [-0.055, 0.055, -0.035, 0.12, 0.2, -0.65]], [0.58, [-0.055, 0.055, -0.035, 0.12, 0.2, -0.65]],
      [0.62, [-0.05, 0.065, -0.025, 0.19, 0.2, -0.58]], [0.68, [-0.055, 0.055, -0.035, 0.12, 0.2, -0.65]],
      [0.8, [-0.025, 0.03, -0.02, 0.08, 0.1, -0.3]], [0.86, [-0.02, 0.028, -0.01, 0.1, 0.06, -0.24]], [1, Z6],
    ],
    parts: {
      mag: [
        [0.14, Z6], [0.2, [0, -0.02, 0, 0, 0, 0]], [0.3, [-0.03, -0.16, 0.03, 0.2, 0, 0.3]],
        [0.37, [-0.1, -0.42, 0.1, 0.4, 0, 0.6, 0]], [0.43, [-0.1, -0.42, 0.1, 0.4, 0, 0.6, 1]],
        [0.53, [-0.015, -0.1, 0.012, 0.08, 0, 0.1]], [0.6, [0, -0.014, 0, 0, 0, 0]], [0.63, Z6],
      ],
      bolt: [[0.8, Z6], [0.85, [0, 0, 0.06, 0, 0, 0]], [0.9, Z6]],
    },
    left: [[0, 'grip'], [0.12, 'grip'], [0.2, 'mag'], [0.63, 'mag'], [0.74, 'grip']],
    cues: [[0.2, 'out'], [0.61, 'in'], [0.85, 'bolt']],
  },

  // Pistol: the magazine drops free, a fresh one comes up, the slide snaps home.
  pistol: {
    gun: [
      [0, Z6], [0.1, [-0.01, 0.06, 0.02, 0.5, -0.3, -0.55]], [0.56, [-0.01, 0.06, 0.02, 0.5, -0.3, -0.55]],
      [0.6, [-0.01, 0.075, 0.02, 0.58, -0.3, -0.5]], [0.66, [-0.01, 0.06, 0.02, 0.5, -0.3, -0.55]],
      [0.76, [0, 0.02, 0.01, -0.06, 0, 0.05]], [0.8, [0, 0.005, 0.025, 0.08, 0, 0.02]], [0.9, Z6],
    ],
    parts: {
      mag: [
        [0.08, Z6], [0.14, [0, -0.03, 0, 0, 0, 0]], [0.26, [0.01, -0.3, 0.05, 0.5, 0, 0, 0]],
        [0.34, [-0.06, -0.32, 0.06, 0, 0, 0.3, 1]], [0.48, [0, -0.07, 0.005, 0, 0, 0]], [0.57, [0, -0.01, 0, 0, 0, 0]], [0.6, Z6],
      ],
      slide: [[0, [0, 0, 0.03, 0, 0, 0]], [0.74, [0, 0, 0.03, 0, 0, 0]], [0.76, Z6]],
      bolt: [[0.72, Z6], [0.76, [0, 0, 0.03, 0, 0, 0]], [0.8, Z6]],
    },
    emptyOnly: ['slide'],   // the slide is only locked back if the last shot emptied it
    left: [[0, 'grip'], [0.1, 'grip'], [0.22, 'pocket'], [0.34, 'mag'], [0.58, 'mag'], [0.68, 'grip']],
    cues: [[0.14, 'out'], [0.58, 'in'], [0.75, 'slide']],
  },

  // Bolt action with a stripper clip: open the bolt, thumb five rounds down, close it.
  bolt: {
    gun: [
      [0, Z6], [0.08, [0, -0.03, 0.02, 0.12, 0.28, 0.45]], [0.48, [0, -0.03, 0.02, 0.12, 0.28, 0.45]],
      [0.52, [0, -0.04, 0.02, 0.14, 0.28, 0.45]], [0.56, [0, -0.03, 0.02, 0.12, 0.28, 0.45]],
      [0.6, [0, -0.042, 0.02, 0.14, 0.28, 0.45]], [0.64, [0, -0.03, 0.02, 0.12, 0.28, 0.45]],
      [0.88, [0, -0.03, 0.02, 0.12, 0.28, 0.45]], [1, Z6],
    ],
    parts: {
      bolt: [
        [0.14, Z6], [0.2, [0, 0, 0, 0, 0, 1.3]], [0.28, [0, 0, 0.09, 0, 0, 1.3]],
        [0.72, [0, 0, 0.09, 0, 0, 1.3]], [0.79, [0, 0, 0, 0, 0, 1.3]], [0.85, Z6],
      ],
    },
    right: [[0, 'grip'], [0.06, 'grip'], [0.14, BOLT_HAND], [0.3, BOLT_HAND], [0.4, 'grip'], [0.64, 'grip'], [0.72, BOLT_HAND], [0.86, BOLT_HAND], [0.95, 'grip']],
    left: [
      [0, 'grip'], [0.3, 'grip'], [0.38, 'pocket'], [0.46, ['at', [0, 0.13, -0.07], 'over']],
      [0.52, ['at', [0, 0.1, -0.07], 'over']], [0.56, ['at', [0, 0.115, -0.07], 'over']],
      [0.6, ['at', [0, 0.095, -0.07], 'over']], [0.66, ['at', [-0.06, 0.15, 0.04], 'over']], [0.76, 'grip'],
    ],
    prop: [[0, null], [0.38, 'clip'], [0.62, null]],
    cues: [[0.2, 'bolt'], [0.5, 'clip'], [0.78, 'bolt']],
  },

  // Tube-fed shotgun: roll it over and thumb shells into the loading port one by one.
  pump: {
    gun: [
      [0, Z6], [0.08, [-0.03, 0.04, 0.02, 0.25, -0.1, -0.7]],
      [0.2, [-0.03, 0.036, 0.02, 0.27, -0.1, -0.7]], [0.24, [-0.03, 0.04, 0.02, 0.25, -0.1, -0.7]],
      [0.37, [-0.03, 0.036, 0.02, 0.27, -0.1, -0.7]], [0.41, [-0.03, 0.04, 0.02, 0.25, -0.1, -0.7]],
      [0.54, [-0.03, 0.036, 0.02, 0.27, -0.1, -0.7]], [0.58, [-0.03, 0.04, 0.02, 0.25, -0.1, -0.7]],
      [0.71, [-0.03, 0.036, 0.02, 0.27, -0.1, -0.7]], [0.75, [-0.03, 0.04, 0.02, 0.25, -0.1, -0.7]],
      [0.84, [0, -0.01, 0, 0.05, 0, 0]], [0.9, [0, -0.012, 0.02, 0.08, 0, 0]], [1, Z6],
    ],
    parts: { pump: [[0.86, Z6], [0.9, [0, 0, 0.1, 0, 0, 0]], [0.95, Z6]] },
    left: [
      [0, 'grip'], [0.08, 'grip'],
      [0.13, 'pocket'], [0.18, ['at', [0, -0.09, -0.07], 'post']], [0.21, ['at', [0, -0.05, -0.1], 'post']],
      [0.3, 'pocket'], [0.35, ['at', [0, -0.09, -0.07], 'post']], [0.38, ['at', [0, -0.05, -0.1], 'post']],
      [0.47, 'pocket'], [0.52, ['at', [0, -0.09, -0.07], 'post']], [0.55, ['at', [0, -0.05, -0.1], 'post']],
      [0.64, 'pocket'], [0.69, ['at', [0, -0.09, -0.07], 'post']], [0.72, ['at', [0, -0.05, -0.1], 'post']],
      [0.8, 'grip'],
    ],
    prop: [
      [0, null], [0.12, 'shell'], [0.21, null], [0.29, 'shell'], [0.38, null],
      [0.46, 'shell'], [0.55, null], [0.63, 'shell'], [0.72, null],
    ],
    cues: [[0.21, 'shell'], [0.38, 'shell'], [0.55, 'shell'], [0.72, 'shell'], [0.9, 'pump']],
  },

  // Break action: open, flick the empties out, two fresh shells, snap it shut.
  break: {
    gun: [
      [0, Z6], [0.1, [0, 0.0, 0.02, 0.35, 0.1, 0.25]], [0.2, [0, -0.025, 0.02, -0.06, 0.12, 0.3]],
      [0.66, [0, -0.025, 0.02, -0.06, 0.12, 0.3]], [0.72, [0, 0.01, 0, 0.22, 0.05, 0.1]],
      [0.8, [0, 0, 0.01, 0.04, 0, 0.02]], [1, Z6],
    ],
    parts: { barrels: [[0.06, Z6], [0.14, [0, 0, 0, 0.62, 0, 0]], [0.64, [0, 0, 0, 0.62, 0, 0]], [0.71, [0, 0, 0, -0.03, 0, 0]], [0.75, Z6]] },
    left: [
      [0, 'grip'], [0.1, 'grip'], [0.24, 'pocket'], [0.36, ['at', [0, 0.1, -0.04], 'over']],
      [0.46, ['at', [0, 0.075, -0.07], 'over']], [0.56, 'grip'],
    ],
    prop: [[0, null], [0.24, 'shells'], [0.47, null]],
    eject: [0.15, 'shell', 2],
    cues: [[0.13, 'open'], [0.45, 'shell'], [0.48, 'shell'], [0.71, 'close']],
  },

  // Rocket tube: lower it, bring a rocket up behind and slide it in from the rear.
  rocket: {
    gun: [
      [0, Z6], [0.12, [-0.06, -0.1, -0.45, 0.05, 1.05, 0.12]], [0.62, [-0.06, -0.1, -0.45, 0.05, 1.05, 0.12]],
      [0.66, [-0.06, -0.106, -0.43, 0.05, 1.05, 0.12]], [0.72, [-0.06, -0.1, -0.45, 0.05, 1.05, 0.12]],
      [0.82, [-0.06, -0.1, -0.45, 0.05, 1.05, 0.12]], [0.92, [0, 0, 0, 0.04, 0, 0]], [1, Z6],
    ],
    parts: {
      mag: [
        [0, [0, 0, 0, 0, 0, 0, 0]], [0.28, [-0.05, -0.35, 1.3, 0, 0, 0, 0]], [0.3, [-0.05, -0.35, 1.3, 0, 0, 0, 1]],
        [0.46, [0, 0, 1.2, 0, 0, 0]], [0.66, Z6],
      ],
    },
    left: [[0, 'grip'], [0.1, 'grip'], [0.24, 'pocket'], [0.3, ['mag', [0, -0.05, -0.6], 'post']], [0.66, ['mag', [0, -0.05, -0.6], 'post']], [0.78, 'grip']],
    cues: [[0.47, 'rocket'], [0.8, 'bolt']],
  },

  // Leyden Rifle: lift the spent jar rack out, seat a fresh one, crank it up to charge.
  jar: {
    gun: [
      [0, Z6], [0.1, [-0.02, -0.05, 0.03, 0.2, -0.2, -0.3]], [0.6, [-0.02, -0.05, 0.03, 0.2, -0.2, -0.3]],
      [0.63, [-0.02, -0.06, 0.03, 0.24, -0.2, -0.28]], [0.67, [-0.02, -0.05, 0.03, 0.2, -0.2, -0.3]],
      [0.9, [-0.02, -0.05, 0.03, 0.2, -0.2, -0.3]], [1, Z6],
    ],
    parts: {
      mag: [
        [0.12, Z6], [0.16, [0, 0.015, 0, 0, 0, 0]], [0.22, [0, 0.03, 0, 0, 0, 0]],
        [0.33, [-0.12, 0.08, 0.1, 0.3, 0, 0.5]], [0.4, [-0.28, -0.25, 0.16, 0.5, 0, 0.8, 0]],
        [0.46, [-0.28, -0.25, 0.16, 0.5, 0, 0.8, 1]], [0.56, [-0.02, 0.06, 0.01, 0, 0, 0.05]],
        [0.62, [0, 0.008, 0, 0, 0, 0]], [0.64, Z6],
      ],
      bolt: [[0.7, Z6], [0.88, [0, 0, 0, Math.PI * 4, 0, 0]]],
    },
    left: [
      [0, 'grip'], [0.1, 'grip'], [0.2, ['mag', [0, 0.1, 0.02], 'over']], [0.64, ['mag', [0, 0.1, 0.02], 'over']],
      [0.7, CRANK_HAND], [0.88, CRANK_HAND], [0.96, 'grip'],
    ],
    cues: [[0.15, 'jarOut'], [0.61, 'jarIn'], [0.72, 'crank'], [0.8, 'crank'], [0.86, 'charge']],
  },

  // Revolver (Python): roll it over and push the cylinder out on its crane ('mag'),
  // tip the muzzle up and slap the ejector rod so the six empties fall out, then
  // muzzle down, a speedloader into the chambers, and flick the cylinder shut.
  revolver: {
    gun: [
      [0, Z6], [0.1, [-0.04, 0.05, 0, 0.25, -0.45, -0.4]], [0.2, [-0.04, 0.055, 0, 0.25, -0.45, -0.4]],
      [0.27, [-0.04, 0.075, 0.02, 0.85, -0.4, -0.3]], [0.32, [-0.04, 0.075, 0.02, 0.85, -0.4, -0.3]],
      [0.335, [-0.04, 0.07, 0.02, 0.9, -0.4, -0.3]], [0.37, [-0.04, 0.075, 0.02, 0.85, -0.4, -0.3]],
      [0.45, [-0.05, 0.035, 0.02, -0.45, -0.45, -0.35]], [0.57, [-0.05, 0.035, 0.02, -0.45, -0.45, -0.35]],
      [0.59, [-0.05, 0.031, 0.02, -0.48, -0.45, -0.35]], [0.65, [-0.04, 0.045, 0, 0.1, -0.45, -0.4]],
      [0.71, [-0.03, 0.05, 0, 0.2, -0.35, -0.3]], [0.73, [-0.03, 0.055, 0, 0.25, -0.35, -0.25]], [0.9, Z6],
    ],
    parts: {
      mag: [[0.1, Z6], [0.17, [0, 0, 0, 0, 0, 1.5]], [0.64, [0, 0, 0, 0, 0, 1.5]], [0.71, Z6]],
      ejector: [[0.28, Z6], [0.33, [0, 0, 0.022, 0, 0, 0]], [0.38, Z6]],
      rounds: [
        [0.28, Z6], [0.33, [0, 0, 0.022, 0, 0, 0, 1]], [0.335, [0, 0, 0.022, 0, 0, 0, 0]],
        [0.56, [0, 0, 0.035, 0, 0, 0, 0]], [0.565, [0, 0, 0.035, 0, 0, 0, 1]], [0.6, [0, 0, 0, 0, 0, 0, 1]],
      ],
    },
    left: [
      [0, 'grip'], [0.07, 'grip'], [0.12, ['at', [-0.045, 0.047, -0.03], 'side']], [0.17, ['mag', [0.006, 0.056, 0], 'side']],
      [0.2, ['mag', [0.006, 0.056, 0], 'side']], [0.27, ['mag', [0.008, 0.021, -0.15], 'side']],
      [0.33, ['mag', [0.008, 0.021, -0.128], 'side']], [0.38, ['mag', [0.008, 0.021, -0.145], 'side']], [0.45, 'pocket'],
      [0.52, ['mag', [0.008, 0.021, 0.09], 'side']], [0.575, ['mag', [0.008, 0.021, 0.062], 'side']],
      [0.63, ['mag', [0.006, 0.056, 0], 'side']], [0.71, ['mag', [0.006, 0.056, 0], 'side']], [0.84, 'grip'],
    ],
    prop: [[0, null], [0.42, 'speedloader'], [0.575, null]],
    eject: [0.335, 'case', 6, 'drop'],
    cues: [[0.14, 'open'], [0.33, 'out'], [0.56, 'clip'], [0.7, 'close']],
  },

  // Belt-fed (HK21): flip the feed cover up, swap the belt box underneath, lay the
  // new belt across the feed tray, slam the cover and rack the charging handle.
  belt: {
    gun: [
      [0, Z6], [0.08, [-0.04, 0.035, 0, 0.12, 0.15, -0.35]], [0.46, [-0.04, 0.035, 0, 0.12, 0.15, -0.35]],
      [0.5, [-0.04, 0.045, 0, 0.16, 0.15, -0.33]], [0.54, [-0.04, 0.035, 0, 0.12, 0.15, -0.35]],
      [0.72, [-0.04, 0.035, 0, 0.12, 0.15, -0.35]], [0.745, [-0.04, 0.026, 0, 0.1, 0.15, -0.37]],
      [0.78, [-0.04, 0.035, 0, 0.12, 0.15, -0.35]], [0.86, [-0.03, 0.03, 0, 0.1, 0.1, -0.25]], [1, Z6],
    ],
    parts: {
      cover: [[0.1, Z6], [0.18, [0, 0, 0, 1.25, 0, 0]], [0.66, [0, 0, 0, 1.25, 0, 0]], [0.74, Z6]],
      mag: [
        [0.2, Z6], [0.26, [0, -0.025, 0, 0, 0, 0]], [0.34, [-0.08, -0.3, 0.06, 0.3, 0, 0.5, 0]],
        [0.4, [-0.08, -0.3, 0.06, 0.3, 0, 0.5, 1]], [0.48, [-0.005, -0.03, 0, 0.05, 0, 0.05]], [0.52, Z6],
      ],
      belt: [[0.36, Z6], [0.38, [-0.03, 0.02, 0, 0, 0, 0.5]], [0.54, [-0.03, 0.02, 0, 0, 0, 0.5]], [0.62, Z6]],
      bolt: [[0.8, Z6], [0.85, [0, 0, 0.08, 0, 0, 0]], [0.9, Z6]],
    },
    left: [
      [0, 'grip'], [0.08, 'grip'], [0.13, ['at', [0, 0.12, -0.19], 'over']], [0.19, ['at', [0, 0.225, -0.14], 'over']], [0.22, 'pocket'],
      [0.25, ['mag', [-0.01, -0.105, 0], 'post']], [0.34, ['mag', [-0.01, -0.105, 0], 'post']], [0.37, 'pocket'],
      [0.4, ['mag', [-0.01, -0.105, 0], 'post']], [0.52, ['mag', [-0.01, -0.105, 0], 'post']],
      [0.56, ['mag', [0.012, 0.1, 0.02], 'over']], [0.62, ['mag', [0.012, 0.09, 0.02], 'over']],
      [0.67, ['at', [0, 0.225, -0.14], 'over']], [0.74, ['at', [0, 0.12, -0.19], 'over']],
      [0.8, ['bolt', [-0.062, 0.031, -0.406], 'post']], [0.86, ['bolt', [-0.062, 0.031, -0.406], 'post']], [0.95, 'grip'],
    ],
    cues: [[0.16, 'open'], [0.25, 'out'], [0.5, 'in'], [0.6, 'clip'], [0.73, 'close'], [0.85, 'bolt']],
  },

  // Pump-action grenade launcher (China Lake): roll it over, push two fat 40 mm
  // rounds up and forward into the magazine tube, then rack the pump.
  launcher: {
    gun: [
      [0, Z6], [0.1, [-0.05, 0.065, 0.02, 0.25, -0.15, -0.75]],
      [0.27, [-0.05, 0.061, 0.024, 0.27, -0.15, -0.75]], [0.31, [-0.05, 0.065, 0.02, 0.25, -0.15, -0.75]],
      [0.53, [-0.05, 0.061, 0.024, 0.27, -0.15, -0.75]], [0.57, [-0.05, 0.065, 0.02, 0.25, -0.15, -0.75]],
      [0.74, [-0.05, 0.065, 0.02, 0.25, -0.15, -0.75]], [0.84, [0, -0.01, 0, 0.05, 0, 0]],
      [0.9, [0, -0.012, 0.025, 0.08, 0, 0]], [1, Z6],
    ],
    parts: { pump: [[0.84, Z6], [0.9, [0, 0, 0.12, 0, 0, 0]], [0.96, Z6]] },
    left: [
      [0, 'grip'], [0.08, 'grip'], [0.14, 'pocket'], [0.21, ['at', [0, -0.078, 0.0], 'side']],
      [0.28, ['at', [0, -0.036, -0.07], 'side']], [0.38, 'pocket'], [0.47, ['at', [0, -0.078, 0.0], 'side']],
      [0.54, ['at', [0, -0.036, -0.07], 'side']], [0.66, 'pocket'], [0.8, 'grip'],
    ],
    prop: [[0, null], [0.13, 'shell40'], [0.28, null], [0.39, 'shell40'], [0.54, null]],
    cues: [[0.18, 'rocket'], [0.44, 'rocket'], [0.9, 'pump']],
  },

  // Pressure canister (Gale Cannon): twist the spent canister off the breech and
  // drop it, seat a fresh one, then crank the valve wheel open until the turbine
  // spins back up.
  canister: {
    gun: [
      [0, Z6], [0.1, [-0.05, 0.05, -0.03, 0.12, 0.2, -0.6]], [0.52, [-0.05, 0.05, -0.03, 0.12, 0.2, -0.6]],
      [0.56, [-0.045, 0.06, -0.025, 0.18, 0.2, -0.55]], [0.6, [-0.05, 0.05, -0.03, 0.12, 0.2, -0.6]],
      [0.68, [-0.03, 0.03, 0, 0.1, 0.1, -0.25]], [0.88, [-0.03, 0.03, 0, 0.1, 0.1, -0.25]], [1, Z6],
    ],
    parts: {
      mag: [
        [0.12, Z6], [0.18, [0, 0, 0, 0, 0, 0.9]], [0.24, [0, -0.03, 0.01, 0, 0, 0.9]],
        [0.34, [-0.05, -0.3, 0.08, 0.3, 0, 1.2, 0]], [0.42, [-0.05, -0.3, 0.08, 0.3, 0, 1.2, 1]],
        [0.52, [0, -0.03, 0.01, 0, 0, 0.9]], [0.56, [0, 0, 0, 0, 0, 0.9]], [0.6, Z6],
      ],
      bolt: [[0.66, Z6], [0.86, [0, 0, 0, Math.PI * 4, 0, 0]]],
    },
    left: [
      [0, 'grip'], [0.1, 'grip'], [0.16, ['mag', [0, -0.034, 0], 'post']], [0.34, ['mag', [0, -0.034, 0], 'post']],
      [0.37, 'pocket'], [0.42, ['mag', [0, -0.034, 0], 'post']], [0.6, ['mag', [0, -0.034, 0], 'post']],
      [0.66, ['bolt', [-0.012, 0.018, 0], 'crank']], [0.86, ['bolt', [-0.012, 0.018, 0], 'crank']], [0.95, 'grip'],
    ],
    cues: [[0.19, 'jarOut'], [0.55, 'jarIn'], [0.68, 'crank'], [0.76, 'crank'], [0.84, 'charge']],
  },
};

// After-shot cycles, same format plus `dur` (s) and `delay` (s before it starts).
// `eject` names the case thrown out and when.
export const CYCLES = {
  bolt: {
    dur: 0.72, delay: 0.1,
    gun: [[0, Z6], [0.2, [0, -0.012, 0.01, 0.03, 0.04, 0.14]], [0.78, [0, -0.012, 0.01, 0.03, 0.04, 0.14]], [1, Z6]],
    parts: { bolt: [[0.12, Z6], [0.25, [0, 0, 0, 0, 0, 1.3]], [0.45, [0, 0, 0.09, 0, 0, 1.3]], [0.62, [0, 0, 0, 0, 0, 1.3]], [0.75, Z6]] },
    right: [[0, 'grip'], [0.12, BOLT_HAND], [0.78, BOLT_HAND], [0.95, 'grip']],
    eject: [0.45, 'case', 1],
  },
  pump: {
    dur: 0.46, delay: 0.07,
    gun: [[0, Z6], [0.4, [0, -0.006, 0.01, 0.06, 0, -0.04]], [1, Z6]],
    parts: { pump: [[0, Z6], [0.4, [0, 0, 0.1, 0, 0, 0]], [0.8, Z6]] },
    eject: [0.4, 'shell', 1],
  },
  slide: {
    dur: 0.1, delay: 0,
    parts: { slide: [[0, Z6], [0.35, [0, 0, 0.035, 0, 0, 0]], [1, Z6]] },
    eject: [0.35, 'case', 1],
  },
  crank: {
    dur: 0.6, delay: 0.12,
    gun: [[0, Z6], [0.3, [-0.004, -0.008, 0, 0.02, -0.04, -0.08]], [0.85, [-0.004, -0.008, 0, 0.02, -0.04, -0.08]], [1, Z6]],
    parts: { bolt: [[0.1, Z6], [0.85, [0, 0, 0, Math.PI * 2, 0, 0]]] },
    left: [[0, 'grip'], [0.1, CRANK_HAND], [0.85, CRANK_HAND], [1, 'grip']],
  },
  // Revolver: the hammer falls with the shot, then cocks again as the cylinder turns
  // to the next chamber (a sixth of a turn, so it ends where it started).
  hammer: {
    dur: 0.3, delay: 0,
    parts: {
      hammer: [[0, [0, 0, 0, -0.75, 0, 0]], [0.35, [0, 0, 0, -0.75, 0, 0]], [0.9, Z6]],
      cylinder: [[0.35, Z6], [0.9, [0, 0, 0, 0, 0, -Math.PI / 3]]],
    },
  },
  // Grenade launcher: a long, heavy pump stroke that throws the fat 40 mm case.
  launcher: {
    dur: 0.62, delay: 0.1,
    gun: [[0, Z6], [0.4, [0, -0.008, 0.012, 0.07, 0, -0.05]], [1, Z6]],
    parts: { pump: [[0, Z6], [0.4, [0, 0, 0.12, 0, 0, 0]], [0.8, Z6]] },
    eject: [0.4, 'case40', 1],
  },
  // Gale Cannon: the gun heaves as the blast leaves (its turbine whirls meanwhile).
  gust: {
    dur: 0.55, delay: 0,
    gun: [[0, Z6], [0.25, [0, 0.01, 0.02, 0.08, 0, 0.02]], [1, Z6]],
  },
};

// Guns whose reload style brings its own after-shot cycle (the rest cycle by kind).
export const STYLE_CYCLES = { revolver: 'hammer', launcher: 'launcher', canister: 'gust' };

// Sound cues for a style: [[u, stage], ...].
export function reloadCues(style) {
  return (RELOADS[style] || RELOADS.mag).cues;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Sample a numeric-array track at u into `out` (length n; missing entries fill
// from `fill`). Returns the index of the last key at or before u (for switches).
export function sampleTrack(keys, u, out, n, fill = 0) {
  if (!keys || !keys.length) { out.fill(fill, 0, n); return -1; }
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= u) i++;
  const [u0, a] = keys[i];
  const next = keys[i + 1];
  if (u <= u0 || !next) {
    for (let k = 0; k < n; k++) out[k] = a[k] ?? fill;
    return u < u0 ? -1 : i;
  }
  const [u1, b] = next;
  const t = smooth((u - u0) / (u1 - u0));
  for (let k = 0; k < n; k++) {
    const x = a[k] ?? fill, y = b[k] ?? fill;
    out[k] = x + (y - x) * t;
  }
  return i;
}

// The key segment around u for a discrete track (hand places, props):
// { a, b, t } with t = 0..1 eased between key a and key b.
export function sampleSteps(keys, u) {
  if (!keys || !keys.length) return null;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= u) i++;
  const [u0, a] = keys[i];
  const next = keys[i + 1];
  if (u <= u0 || !next) return { a, b: a, t: 0 };
  return { a, b: next[1], t: smooth((u - u0) / (next[0] - u0)) };
}
