"""Build the training dataset.

Positives : rainfall-triggered landslides from NASA's Global Landslide Catalog (GLC),
            location accuracy <= 5 km, 2007-2017.
Negatives : for every positive we create two "controls":
  * temporal control - SAME location, a random day 60-700 days away with no catalogued
    landslide within 25 km / +-10 days  -> teaches the model what rainfall matters
  * spatial control  - SAME day, a random land point 10-80 km away with no catalogued
    landslide within 5 km / +-10 days    -> teaches the model what terrain matters
This case-control design keeps climate and season balanced between classes.

Rainfall comes from ERA5 reanalysis via the Open-Meteo archive API (daily precipitation,
30-day window ending on the event day, local time zone).

Resumable: every network result is cached under data/.
"""
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(__file__))
import terrain  # noqa: E402
from features import rain_features  # noqa: E402

HERE = os.path.dirname(__file__)
DATA = os.path.join(HERE, "..", "data")
GLC_URL = ("https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/"
           "Global_Landslide_Catalog_Export_rows.csv")
N_POSITIVES = 1100
SEED = 42
RAIN_TRIGGERS = {"rain", "downpour", "continuous_rain", "monsoon", "tropical_cyclone"}
GOOD_ACCURACY = {"exact", "1km", "5km"}
WINDOW_DAYS = 30

rng = random.Random(SEED)


def load_catalog():
    path = os.path.join(DATA, "glc.csv")
    if not os.path.exists(path):
        print("downloading GLC ...")
        r = requests.get(GLC_URL, timeout=600)
        r.raise_for_status()
        with open(path, "wb") as f:
            f.write(r.content)
    d = pd.read_csv(path)
    d["date"] = pd.to_datetime(d.event_date, format="%m/%d/%Y %I:%M:%S %p").dt.normalize()
    return d


def haversine_km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = (np.sin((lat2 - lat1) * p / 2) ** 2
         + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2)
    return 12742 * np.arcsin(np.sqrt(a))


def destination(lat, lon, km, bearing_deg):
    R = 6371.0
    b, la, lo = map(math.radians, (bearing_deg, lat, lon))
    la2 = math.asin(math.sin(la) * math.cos(km / R) + math.cos(la) * math.sin(km / R) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(km / R) * math.cos(la),
                          math.cos(km / R) - math.sin(la) * math.sin(la2))
    return math.degrees(la2), (math.degrees(lo2) + 540) % 360 - 180


def sample_positives(d):
    c = d[d.landslide_trigger.isin(RAIN_TRIGGERS)
          & d.location_accuracy.isin(GOOD_ACCURACY)
          & (d.date >= "2007-01-01")].copy()
    print(f"eligible positives: {len(c)}")
    # Cap any single country at 30% of the sample to limit US over-representation.
    c = c.sample(frac=1, random_state=SEED)
    cap = int(0.30 * N_POSITIVES)
    c["rank"] = c.groupby("country_name", dropna=False).cumcount()
    c = c[c["rank"] < cap].head(N_POSITIVES)
    return c


class Catalog:
    """Fast 'is there a catalogued landslide near here, near this date?' lookups."""

    def __init__(self, d):
        self.lat, self.lon = d.latitude.values, d.longitude.values
        self.day = (d.date - pd.Timestamp("1970-01-01")).dt.days.values

    def clear(self, lat, lon, date, km, days):
        dd = (date - pd.Timestamp("1970-01-01")).days
        m = np.abs(self.day - dd) <= days
        if not m.any():
            return True
        return not (haversine_km(lat, lon, self.lat[m], self.lon[m]) <= km).any()


def safe_terrain(lat, lon):
    try:
        f = terrain.features(lat, lon)
        return f if np.isfinite(list(f.values())).all() else None
    except Exception as e:  # noqa: BLE001
        print("terrain error", lat, lon, e)
        return None


def make_points(pos, cat):
    points = []
    for _, r in pos.iterrows():
        eid = int(r.event_id)
        points.append(dict(id=f"{eid}", kind="landslide", label=1, event_id=eid,
                           lat=r.latitude, lon=r.longitude, date=r.date,
                           country=r.country_name))
        for _ in range(50):
            dt = pd.Timedelta(days=rng.randint(60, 700) * rng.choice([-1, 1]))
            nd = r.date + dt
            if pd.Timestamp("2007-01-01") <= nd <= pd.Timestamp("2017-12-31") and \
                    cat.clear(r.latitude, r.longitude, nd, 25, 10):
                points.append(dict(id=f"{eid}-t", kind="temporal_control", label=0, event_id=eid,
                                   lat=r.latitude, lon=r.longitude, date=nd,
                                   country=r.country_name))
                break
        cands = []
        for _ in range(6):
            la, lo = destination(r.latitude, r.longitude, rng.uniform(10, 80), rng.uniform(0, 360))
            if cat.clear(la, lo, r.date, 5, 10):
                cands.append((la, lo))
        points.append(dict(id=f"{eid}-s", kind="spatial_control", label=0, event_id=eid,
                           lat=None, lon=None, date=r.date, country=r.country_name, cands=cands))
    return points


def attach_terrain(points):
    todo = [(p["lat"], p["lon"]) for p in points if p["lat"] is not None]
    todo += [c for p in points if p["lat"] is None for c in p["cands"]]
    todo = list(dict.fromkeys((round(a, 5), round(b, 5)) for a, b in todo))
    print(f"terrain for {len(todo)} locations ...")
    with ThreadPoolExecutor(16) as ex:
        res = dict(zip(todo, ex.map(lambda ll: safe_terrain(*ll), todo)))
    out = []
    for p in points:
        if p["lat"] is None:
            for la, lo in p.pop("cands"):
                t = res.get((round(la, 5), round(lo, 5)))
                if t and t["elev"] > 1:           # must be on land
                    p.update(lat=la, lon=lo, **t)
                    break
            else:
                continue
        else:
            t = res.get((round(p["lat"], 5), round(p["lon"], 5)))
            if not t:
                continue
            p.update(t)
        out.append(p)
    return out


def fetch_rain(points):
    cache_path = os.path.join(DATA, "rain_cache.jsonl")
    cache = {}
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            for line in f:
                j = json.loads(line)
                cache[j["key"]] = j["p"]
    key = lambda p: f"{p['lat']:.4f},{p['lon']:.4f},{p['date']:%Y-%m-%d}"  # noqa: E731
    todo = [p for p in points if key(p) not in cache]
    # group by date so same-day points share one multi-location request
    groups = {}
    for p in todo:
        groups.setdefault(p["date"], []).append(p)
    print(f"rain: {len(cache)} cached, {len(todo)} to fetch in {len(groups)} requests")
    with open(cache_path, "a") as f:
        for i, (date, grp) in enumerate(groups.items()):
            start = (date - pd.Timedelta(days=WINDOW_DAYS - 1)).strftime("%Y-%m-%d")
            params = dict(latitude=",".join(f"{p['lat']:.4f}" for p in grp),
                          longitude=",".join(f"{p['lon']:.4f}" for p in grp),
                          start_date=start, end_date=date.strftime("%Y-%m-%d"),
                          daily="precipitation_sum", timezone="auto")
            for attempt in range(8):
                r = requests.get("https://archive-api.open-meteo.com/v1/archive",
                                 params=params, timeout=60)
                if r.status_code == 429 or r.status_code >= 500:
                    wait = 65 * (attempt + 1)
                    print(f"  {r.status_code} ({r.text[:120]}), sleeping {wait}s")
                    time.sleep(wait)
                    continue
                r.raise_for_status()
                break
            else:
                raise SystemExit("giving up; rerun later to resume")
            js = r.json()
            js = js if isinstance(js, list) else [js]
            for p, j in zip(grp, js):
                pr = j["daily"]["precipitation_sum"]
                cache[key(p)] = pr
                f.write(json.dumps({"key": key(p), "p": pr}) + "\n")
            f.flush()
            if i % 50 == 0:
                print(f"  {i}/{len(groups)}")
            time.sleep(0.6)
    for p in points:
        p["precip"] = cache.get(key(p))
    return points


def main():
    d = load_catalog()
    cat = Catalog(d)
    pos = sample_positives(d)
    pts_path = os.path.join(DATA, "points.json")
    if os.path.exists(pts_path):
        pts = json.load(open(pts_path))
        for p in pts:
            p["date"] = pd.Timestamp(p["date"])
    else:
        pts = attach_terrain(make_points(pos, cat))
        json.dump([{**p, "date": p["date"].strftime("%Y-%m-%d")} for p in pts],
                  open(pts_path, "w"))
    pts = fetch_rain(pts)
    rows, series = [], []
    for p in pts:
        pr = p.pop("precip")
        if pr is None or len(pr) != WINDOW_DAYS or sum(v is None for v in pr) > 2:
            continue
        rows.append({**p, "date": p["date"].strftime("%Y-%m-%d"), **rain_features(pr)})
        series.append([p["id"]] + [0.0 if v is None else v for v in pr])
    df = pd.DataFrame(rows)
    out = os.path.join(DATA, "dataset.csv")
    df.to_csv(out, index=False)
    # the daily series themselves, used by the slope-stability model in train.py
    pd.DataFrame(series, columns=["id"] + [f"p{i:02d}" for i in range(WINDOW_DAYS)]).to_csv(
        os.path.join(DATA, "precip_30d.csv"), index=False)
    print(f"wrote {out}: {len(df)} rows\n{df.kind.value_counts()}")


if __name__ == "__main__":
    main()
