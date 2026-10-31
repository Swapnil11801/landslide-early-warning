"""Reference terrain features + model outputs for web/tests.html (Python <-> browser parity)."""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import terrain  # noqa: E402
import slope_stability as ss  # noqa: E402

POINTS = [("Kathmandu rim", 27.75, 85.45), ("Kansas plains", 38.5, -98.5),
          ("Wayanad", 11.468, 76.14), ("Oso", 48.282, -121.85),
          ("Tile corner (Alps)", 46.0, 7.73), ("Southern Andes", -41.1, -71.5)]

smp = ss.sample_parameters()
CASES = [("dry, 20°", 20, [0.0] * 30), ("wet, 30°", 30, [0.0] * 27 + [40.0, 80.0, 120.0]),
         ("monsoon, 38°", 38, [12.0] * 30), ("flat, storm", 3, [0.0] * 29 + [250.0])]
out = {"terrain": [{"name": n, "lat": la, "lon": lo, "terrain": terrain.features(la, lo)} for n, la, lo in POINTS],
       "stability": [{"name": n, "beta": b, "precip": p, "result": ss.stability(b, p, smp)} for n, b, p in CASES]}
path = os.path.join(os.path.dirname(__file__), "..", "..", "web", "model", "parity.json")
json.dump(out, open(path, "w"), indent=1)
print(json.dumps(out, indent=1))
