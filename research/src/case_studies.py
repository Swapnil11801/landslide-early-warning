"""Hindcasts of three well-documented rainfall-triggered disasters that happened after the
training period (the catalogue ends in 2017), so they are genuinely out-of-sample.

For each event the model, the Guzzetti (2008) threshold and the slope-stability model are
run on every day from 2015 to 2024 with ERA5 rainfall (same source and settings as the
training data). The question is not "did the score exceed 50%?" but "how unusual was the
score on the disaster day compared with every other day at the same place?".

Writes web/model/case_studies.json and research/figures/case_studies.png.
Locations are geocoded settlement centres (OpenStreetMap), within a few km of the failures.
"""
import json
import os
import sys

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, os.path.dirname(__file__))
import slope_stability as ss  # noqa: E402
import terrain  # noqa: E402
from features import FEATURES, rain_features  # noqa: E402
from train import guzzetti_score, js_like_predict  # noqa: E402

HERE = os.path.dirname(__file__)
WEB = os.path.join(HERE, "..", "..", "web", "model")
FIG = os.path.join(HERE, "..", "figures")
START, END = "2015-01-01", "2024-12-31"
WINDOW = 30

EVENTS = [
    dict(id="wayanad-2024", name="Wayanad debris flows, Kerala, India", date="2024-07-30",
         lat=11.4992, lon=76.1599, place="Chooralmala",
         note="Debris flows through Mundakkai and Chooralmala after extreme monsoon rain; more than 200 deaths."),
    dict(id="petropolis-2022", name="Petrópolis landslides, Rio de Janeiro, Brazil", date="2022-02-15",
         lat=-22.5270, lon=-43.1678, place="Morro da Oficina",
         note="Hundreds of landslides after an intense afternoon storm; more than 200 deaths."),
    dict(id="atami-2021", name="Atami debris flow, Shizuoka, Japan", date="2021-07-03",
         lat=35.1164, lon=139.0893, place="Izusan",
         note="Debris flow down the Aizome river after several days of rain; the source area included "
              "artificial fill, which the model cannot know about."),
]


def era5_daily(lat, lon):
    start = (pd.Timestamp(START) - pd.Timedelta(days=WINDOW - 1)).strftime("%Y-%m-%d")
    r = requests.get("https://archive-api.open-meteo.com/v1/archive", timeout=120, params=dict(
        latitude=lat, longitude=lon, start_date=start, end_date=END,
        daily="precipitation_sum", timezone="auto"))
    r.raise_for_status()
    d = r.json()["daily"]
    return pd.Series([0.0 if v is None else v for v in d["precipitation_sum"]], index=pd.to_datetime(d["time"]))


def run_event(ev, model, smp):
    t = terrain.features(ev["lat"], ev["lon"])
    rain = era5_daily(ev["lat"], ev["lon"])
    days = rain.index[WINDOW - 1:]
    rows = []
    for k, day in enumerate(days):
        win = rain.values[k:k + WINDOW]
        rows.append({"date": day, **t, **rain_features(list(win)), "precip": win})
    df = pd.DataFrame(rows)
    df["p"] = js_like_predict(model, df[FEATURES].values)
    df["guzzetti"] = guzzetti_score(df)
    st = [ss.stability(t["slope_p90_1km"], p, smp) for p in df.precip]
    df["pf"] = [s["pf"] for s in st]
    df["fs"] = [s["fs"] for s in st]

    ev_day = pd.Timestamp(ev["date"])
    i = int(np.where(df.date == ev_day)[0][0])
    # the rain may peak the day before a night-time failure: use the higher of the two days
    j = i - 1 if df.p[i - 1] > df.p[i] else i

    def pct(col, idx):
        return round(float((df[col] < df[col][idx]).mean() * 100), 2)

    window = df.iloc[i - 30:i + 11]
    return {
        **{k: ev[k] for k in ("id", "name", "date", "lat", "lon", "place", "note")},
        "terrain": t,
        "event_day": {
            "date_used": df.date[j].strftime("%Y-%m-%d"),
            "p": round(float(df.p[j]), 4), "p_percentile": pct("p", j),
            "guzzetti_ratio": round(float(df.guzzetti[j]), 3), "guzzetti_exceeded": bool(df.guzzetti[j] >= 1),
            "guzzetti_percentile": pct("guzzetti", j),
            "pf": round(float(df.pf[j]), 3), "fs": round(float(df.fs[j]), 3), "pf_percentile": pct("pf", j),
            "r1": round(float(df.r1[j]), 1), "r3": round(float(df.r3[j]), 1), "r7": round(float(df.r7[j]), 1),
            "r30": round(float(df.r30[j]), 1),
        },
        "days_scored": int(len(df)),
        # how often a day at this site scores at least as high as the event day
        "days_per_year_at_or_above": round(float((df.p >= df.p[j]).sum() / (len(df) / 365.25)), 2),
        "series": {
            "dates": [d.strftime("%Y-%m-%d") for d in window.date],
            "p": [round(float(x), 4) for x in window.p],
            "r1": [round(float(x), 1) for x in window.r1],
            "pf": [round(float(x), 3) for x in window.pf],
        },
    }


def figure(results):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(1, len(results), figsize=(5 * len(results), 3.6))
    for ax, r in zip(axes, results):
        s = r["series"]
        x = pd.to_datetime(s["dates"])
        ax2 = ax.twinx()
        ax2.bar(x, s["r1"], color="#9ecae1", width=0.9, label="daily rain (ERA5)")
        ax2.set_ylabel("rain (mm/day)", color="#3182bd")
        ax.plot(x, s["p"], color="#c0392b", lw=2, label="model probability")
        ax.set_zorder(ax2.get_zorder() + 1)
        ax.patch.set_visible(False)
        ax.axvline(pd.Timestamp(r["date"]), color="k", ls="--", lw=1)
        e = r["event_day"]
        ax.set_title(f"{r['name'].split(',')[0]} ({r['date'][:4]})\n"
                     f"p = {e['p']:.2f}, {e['p_percentile']:.1f}th percentile of 2015–24 days", fontsize=9)
        ax.set_ylim(0, 1)
        ax.set_ylabel("landslide probability")
        ax.tick_params(axis="x", labelrotation=45, labelsize=7)
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "case_studies.png"), dpi=150)


def main():
    model = json.load(open(os.path.join(WEB, "model.json")))
    smp = ss.sample_parameters()
    results = []
    for ev in EVENTS:
        r = run_event(ev, model, smp)
        e = r["event_day"]
        print(f"{ev['id']}: p={e['p']} ({e['p_percentile']}th pct), Guzzetti x{e['guzzetti_ratio']} "
              f"({e['guzzetti_percentile']}th pct), Pf={e['pf']} | r1={e['r1']} r3={e['r3']} r7={e['r7']} mm, "
              f"{r['days_per_year_at_or_above']} days/yr as high")
        results.append(r)
    json.dump({"window": [START, END], "events": results}, open(os.path.join(WEB, "case_studies.json"), "w"), indent=1)
    figure(results)


if __name__ == "__main__":
    main()
