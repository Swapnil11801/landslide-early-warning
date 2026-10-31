"""Compact copy of the NASA Global Landslide Catalog for the map layer."""
import json
import os

import pandas as pd

HERE = os.path.dirname(__file__)
d = pd.read_csv(os.path.join(HERE, "..", "data", "glc.csv"))
d["date"] = pd.to_datetime(d.event_date, format="%m/%d/%Y %I:%M:%S %p").dt.strftime("%Y-%m-%d")
d = d.dropna(subset=["latitude", "longitude"])
rows = [[round(r.latitude, 4), round(r.longitude, 4), r.date,
         int(r.fatality_count) if pd.notna(r.fatality_count) else None,
         r.landslide_trigger if isinstance(r.landslide_trigger, str) else "unknown",
         r.landslide_size if isinstance(r.landslide_size, str) else "unknown",
         (r.event_title if isinstance(r.event_title, str) else "")[:90]]
        for r in d.itertuples()]
out = os.path.join(HERE, "..", "..", "web", "data", "events.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump({"columns": ["lat", "lon", "date", "fatalities", "trigger", "size", "title"],
           "source": "NASA Global Landslide Catalog (Kirschbaum et al. 2010, 2015)",
           "rows": rows}, open(out, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)
print(len(rows), "events ->", out, os.path.getsize(out) // 1024, "KB")
