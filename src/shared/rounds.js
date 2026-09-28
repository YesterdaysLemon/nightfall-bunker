// Round scaling for the regular rounds: zombie health and how many come.

export function roundHealth(r) {
  if (r < 10) return 150 + (r - 1) * 100;
  return Math.round(950 * Math.pow(1.1, r - 9));
}

export function roundCount(r, players) {
  const table = [6, 8, 13, 18, 24, 27, 28, 28, 29, 33];
  const solo = r <= 10 ? table[r - 1] : 33 + (r - 10) * 4;
  return Math.round(solo * (1 + 0.5 * (Math.max(1, players) - 1)));
}
