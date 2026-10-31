// Node parity tests: the browser's model and slope-stability code must reproduce the
// Python reference values in web/model/parity.json (written by research/src/make_parity.py).
// Run: node --test web/tests/   (terrain needs a browser: see run-browser-tests.mjs)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const WEB = fileURLToPath(new URL("..", import.meta.url));
// the modules fetch "model/*.json" relative to the page; serve those from disk
globalThis.fetch = async (url) => ({ json: async () => JSON.parse(await readFile(WEB + url, "utf8")) });

const { loadModel, predict } = await import("../js/model.js");
const { loadStability, stability } = await import("../js/stability.js");
const ref = JSON.parse(await readFile(WEB + "model/parity.json", "utf8"));
await loadModel();
await loadStability();

test("model probabilities match Python", () => {
  assert.ok(ref.model.length > 0);
  for (const c of ref.model) {
    const { p } = predict(c.features);
    assert.ok(Math.abs(p - c.p) < 1e-9, `${c.id}: browser ${p} vs Python ${c.p}`);
  }
});

test("attributions add up to the model's log-odds", () => {
  for (const c of ref.model) {
    const { p, base, contributions } = predict(c.features);
    const sum = base + Object.values(contributions).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - Math.log(p / (1 - p))) < 1e-9, c.id);
  }
});

test("slope stability matches Python", () => {
  for (const c of ref.stability) {
    const got = stability(c.beta, c.precip);
    for (const [k, v] of Object.entries(c.result)) {
      assert.ok(Math.abs(got[k] - v) < 1e-9 * Math.max(1, Math.abs(v)), `${c.name} ${k}: ${got[k]} vs ${v}`);
    }
  }
});
