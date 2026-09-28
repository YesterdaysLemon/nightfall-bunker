// Small helpers for the wire format shared by the rules and the encounters.

// Metres -> centimetres (events and snapshots carry integer centimetres).
export const r2 = (v) => Math.round(v * 100);

// A client-sent [x, y, z], or null if it is not three finite numbers.
export function vec3(a) {
  if (!Array.isArray(a) || a.length !== 3) return null;
  const v = a.map(Number);
  return v.every(Number.isFinite) ? v : null;
}
