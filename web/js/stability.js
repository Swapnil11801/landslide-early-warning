// Infinite-slope stability with a rainfall-driven water table and Monte Carlo reliability.
// Mirrors research/src/slope_stability.py; parameters and the Monte Carlo draws come from
// model/stability.json so the browser uses exactly the same samples as the paper.

let S = null;

export async function loadStability(url = "model/stability.json") {
  S = await (await fetch(url)).json();
  return S;
}

export const getStability = () => S;

const rad = (d) => (d * Math.PI) / 180;

/** precip: daily totals, oldest first; last value is the day of interest (mm). */
export function storageMm(precip, tau = S.tau_days) {
  let s = 0;
  for (let i = 0; i < precip.length; i++) s += (precip[precip.length - 1 - i] ?? 0) * Math.exp(-i / tau);
  return s;
}

export function factorOfSafety(betaDeg, storage, { c, phi, z, gamma, nd }) {
  const b = rad(Math.min(Math.max(betaDeg, 0.5), 89));
  const m = Math.min(1, storage / (1000 * nd * z));
  const cohesive = c / (gamma * z * Math.sin(b) * Math.cos(b));
  const frictional = ((1 - (m * S.gamma_w) / gamma) * Math.tan(rad(phi))) / Math.tan(b);
  return { fs: cohesive + frictional, wetness: m };
}

/** Deterministic FS (with optional user soil parameters) + probability of failure over the prior ensemble. */
export function stability(betaDeg, precip, soil = {}) {
  const storage = storageMm(precip);
  const det = factorOfSafety(betaDeg, storage, { ...S.deterministic, ...soil });
  const sm = S.samples;
  let fail = 0;
  for (let i = 0; i < sm.c.length; i++) {
    const { fs } = factorOfSafety(betaDeg, storage, { c: sm.c[i], phi: sm.phi[i], z: sm.z[i], gamma: sm.gamma[i], nd: sm.nd[i] });
    if (fs < 1) fail++;
  }
  return { storage_mm: storage, fs: det.fs, wetness: det.wetness, pf: fail / sm.c.length };
}
