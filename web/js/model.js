// Gradient-boosted tree inference with per-feature attributions (Saabas path method).
// The model is trained by research/src/train.py and exported to model/model.json.

let MODEL = null;

export async function loadModel(url = "model/model.json") {
  MODEL = await (await fetch(url)).json();
  return MODEL;
}

export const getModel = () => MODEL;

// Same definitions as research/src/features.py
export function rainFeatures(p) {
  const v = p.map((x) => (x == null ? 0 : x));
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const r7 = sum(v.slice(-7)), r30 = sum(v.slice(-30));
  return { r1: v[v.length - 1], r3: sum(v.slice(-3)), r7, r30, ante: r30 - r7 };
}

/** Returns { p, band, contributions: {feature: logOdds}, base } */
export function predict(feat) {
  const x = MODEL.features.map((f) => Math.fround(feat[f])); // sklearn trees compare in float32
  const contrib = Object.fromEntries(MODEL.features.map((f) => [f, 0]));
  let raw = MODEL.init;
  let base = MODEL.init;
  for (const t of MODEL.trees) {
    let i = 0;
    base += t.v[0];
    while (t.l[i] !== -1) {
      const next = x[t.f[i]] <= t.t[i] ? t.l[i] : t.r[i];
      contrib[MODEL.features[t.f[i]]] += t.v[next] - t.v[i];
      i = next;
    }
    raw += t.v[i];
  }
  const p = 1 / (1 + Math.exp(-raw));
  return { p, band: band(p), contributions: contrib, base };
}

export const BANDS = [
  { name: "Low", color: "var(--risk-0)" },
  { name: "Moderate", color: "var(--risk-1)" },
  { name: "High", color: "var(--risk-2)" },
  { name: "Very high", color: "var(--risk-3)" },
];

export function band(p) {
  const edges = MODEL?.risk_bands ?? [0.25, 0.5, 0.75];
  let i = 0;
  while (i < edges.length && p >= edges[i]) i++;
  return { index: i, ...BANDS[i] };
}
