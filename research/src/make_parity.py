"""Reference terrain features, stability and model outputs for the browser parity tests
(web/tests.html in a browser, web/tests/parity.test.mjs in Node)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import terrain  # noqa: E402
import slope_stability as ss  # noqa: E402
import pandas as pd  # noqa: E402
from features import FEATURES  # noqa: E402
from train import js_like_predict  # noqa: E402

HERE = os.path.dirname(__file__)

POINTS = [("Kathmandu rim", 27.75, 85.45), ("Kansas plains", 38.5, -98.5),
          ("Wayanad", 11.468, 76.14), ("Oso", 48.282, -121.85),
          ("Tile corner (Alps)", 46.0, 7.73), ("Southern Andes", -41.1, -71.5)]

smp = ss.sample_parameters()
CASES = [("dry, 20°", 20, [0.0] * 30), ("wet, 30°", 30, [0.0] * 27 + [40.0, 80.0, 120.0]),
         ("monsoon, 38°", 38, [12.0] * 30), ("flat, storm", 3, [0.0] * 29 + [250.0])]
# model: 24 evenly spaced rows of the training data, scored by the Python mirror of model.js
# (train.py asserts that mirror matches scikit-learn to < 1e-4)
model = json.load(open(os.path.join(HERE, "..", "..", "web", "model", "model.json")))
df = pd.read_csv(os.path.join(HERE, "..", "data", "dataset.csv"))
rows = df.iloc[::len(df) // 24][:24]
probs = js_like_predict(model, rows[FEATURES].values)
MODEL_CASES = [{"id": str(r.id), "features": {f: float(r[f]) for f in FEATURES}, "p": float(p)}
               for (_, r), p in zip(rows.iterrows(), probs)]

out = {"model": MODEL_CASES, "terrain": [{"name": n, "lat": la, "lon": lo, "terrain": terrain.features(la, lo)} for n, la, lo in POINTS],
       "stability": [{"name": n, "beta": b, "precip": p, "result": ss.stability(b, p, smp)} for n, b, p in CASES]}
path = os.path.join(HERE, "..", "..", "web", "model", "parity.json")
json.dump(out, open(path, "w"), indent=1)
print(f"wrote {path}: {len(out['model'])} model, {len(out['terrain'])} terrain, {len(out['stability'])} stability cases")
