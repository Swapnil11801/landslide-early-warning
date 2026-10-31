"""Train, evaluate (spatial cross-validation) and export the landslide model.

Outputs
  web/model/model.json    - gradient-boosted trees for in-browser inference
  web/model/results.json  - metrics, curves and importances shown on the Research page
  research/figures/*.png  - figures for the paper / README
"""
import json
import math
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import GradientBoostingClassifier  # noqa: E402
from sklearn.inspection import permutation_importance  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import (average_precision_score, brier_score_loss,  # noqa: E402
                             precision_recall_curve, roc_auc_score, roc_curve)
from sklearn.model_selection import GroupKFold  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import FunctionTransformer, StandardScaler  # noqa: E402

sys.path.insert(0, os.path.dirname(__file__))
from features import FEATURES, LABELS, RAIN_FEATURES, TERRAIN_FEATURES  # noqa: E402

HERE = os.path.dirname(__file__)
ROOT = os.path.join(HERE, "..", "..")
DATA = os.path.join(HERE, "..", "data")
FIG = os.path.join(HERE, "..", "figures")
WEB = os.path.join(ROOT, "web", "model")
SEED = 42
GBM_PARAMS = dict(n_estimators=250, learning_rate=0.05, max_depth=3,
                  subsample=0.8, min_samples_leaf=20, random_state=SEED)
RISK_BANDS = [0.25, 0.5, 0.75]  # Low | Moderate | High | Very high


def gbm():
    return GradientBoostingClassifier(**GBM_PARAMS)


def logreg():
    return make_pipeline(FunctionTransformer(lambda X: np.log1p(np.clip(X, 0, None))), StandardScaler(),
                         LogisticRegression(max_iter=2000))


def guzzetti_score(df):
    """Guzzetti et al. (2008) global rainfall intensity-duration threshold
    I = 2.20 * D^-0.44 (mm/h, h). Score = max exceedance ratio over 1/3/7-day windows."""
    s = np.zeros(len(df))
    for col, days in (("r1", 1), ("r3", 3), ("r7", 7)):
        d_h = 24 * days
        s = np.maximum(s, (df[col].values / d_h) / (2.20 * d_h ** -0.44))
    return s


def spatial_groups(df):
    """An event and its two controls always share a group; groups are 5-degree cells,
    so the model is always tested on regions it has never seen."""
    ev = df[df.label == 1].set_index("event_id")
    cell = ((ev.lat // 5).astype(int).astype(str) + "_" + (ev.lon // 5).astype(int).astype(str))
    return df.event_id.map(cell).values


def cross_validate(df, make_model, cols, groups, k=5):
    oof = np.zeros(len(df))
    for tr, te in GroupKFold(n_splits=k).split(df, df.label, groups):
        m = make_model().fit(df.iloc[tr][cols], df.iloc[tr].label)
        oof[te] = m.predict_proba(df.iloc[te][cols])[:, 1]
    return oof


def metrics(y, s, kind):
    out = {"roc_auc": roc_auc_score(y, s), "pr_auc": average_precision_score(y, s)}
    for ctl in ("temporal_control", "spatial_control"):
        m = (kind == "landslide") | (kind == ctl)
        out[f"auc_vs_{ctl.split('_')[0]}"] = roc_auc_score(y[m], s[m])
    return {k: round(float(v), 4) for k, v in out.items()}


# ---------------------------------------------------------------- export ---
def export_tree(est, lr):
    t = est.tree_
    n = t.node_count
    val = np.zeros(n)
    w = t.weighted_n_node_samples
    # leaf values are the Newton-step outputs; propagate weighted means upward so that
    # every internal node carries a consistent expected value (for per-feature attribution)
    for i in reversed(range(n)):
        if t.children_left[i] == -1:
            val[i] = t.value[i][0][0]
    for i in reversed(range(n)):
        l, r = t.children_left[i], t.children_right[i]
        if l != -1:
            val[i] = (val[l] * w[l] + val[r] * w[r]) / (w[l] + w[r])
    return {"f": t.feature.tolist(), "t": [float(x) for x in t.threshold],
            "l": t.children_left.tolist(), "r": t.children_right.tolist(),
            "v": [round(float(x * lr), 7) for x in val]}


def js_like_predict(model_json, X):
    """Re-implementation of web/js/model.js used to verify the export is exact."""
    out = []
    for row in np.asarray(X, dtype=np.float32).astype(float):  # sklearn trees compare in float32
        raw = model_json["init"]
        for tr in model_json["trees"]:
            i = 0
            while tr["l"][i] != -1:
                i = tr["l"][i] if row[tr["f"][i]] <= tr["t"][i] else tr["r"][i]
            raw += tr["v"][i]
        out.append(1 / (1 + math.exp(-raw)))
    return np.array(out)


# ------------------------------------------------------------------ main ---
def main():
    os.makedirs(FIG, exist_ok=True)
    os.makedirs(WEB, exist_ok=True)
    df = pd.read_csv(os.path.join(DATA, "dataset.csv"))
    # keep only complete triplets' events that still have a positive
    df = df[df.event_id.isin(df[df.label == 1].event_id)].reset_index(drop=True)
    y, kind = df.label.values, df.kind.values
    groups = spatial_groups(df)
    print(df.kind.value_counts().to_dict(), "groups:", len(set(groups)))

    scores = {
        "Gradient boosting (all features)": cross_validate(df, gbm, FEATURES, groups),
        "Logistic regression (all features)": cross_validate(df, logreg, FEATURES, groups),
        "Gradient boosting (rainfall only)": cross_validate(df, gbm, RAIN_FEATURES, groups),
        "Gradient boosting (terrain only)": cross_validate(df, gbm, TERRAIN_FEATURES, groups),
        "Guzzetti 2008 rainfall threshold": guzzetti_score(df),
        "Mean slope only": df.slope_mean_1km.values,
    }
    table = {name: metrics(y, s, kind) for name, s in scores.items()}
    for name, m in table.items():
        print(f"{name:40s} {m}")

    main_s = scores["Gradient boosting (all features)"]
    # Guzzetti threshold as a binary warning, for comparison with our banded output
    gz = guzzetti_score(df) >= 1
    ours = main_s >= 0.5
    binary = {}
    for name, pred in (("Guzzetti 2008 (exceeded)", gz), ("This model (p ≥ 0.5)", ours)):
        tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
        fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
        binary[name] = {"hit_rate": round(tp / (tp + fn), 3), "false_alarm_rate": round(fp / (fp + tn), 3),
                        "precision": round(tp / max(tp + fp, 1), 3), "tp": tp, "fp": fp, "fn": fn, "tn": tn}
    # fair comparison: our hit rate when allowed exactly Guzzetti's false-alarm rate (and vice versa)
    fa_g, hr_g = binary["Guzzetti 2008 (exceeded)"]["false_alarm_rate"], binary["Guzzetti 2008 (exceeded)"]["hit_rate"]
    fpr, tpr, _ = roc_curve(y, main_s)
    matched = {"at_guzzetti_false_alarm_rate": {"false_alarm_rate": fa_g, "hit_rate": round(float(np.interp(fa_g, fpr, tpr)), 3)},
               "at_guzzetti_hit_rate": {"hit_rate": hr_g, "false_alarm_rate": round(float(np.interp(hr_g, tpr, fpr)), 3)}}
    print(binary, matched)

    # risk bands: what share of real landslides / controls land in each band (out-of-fold)
    edges = [0] + RISK_BANDS + [1.0001]
    names = ["Low", "Moderate", "High", "Very high"]
    bands = []
    for i, nm in enumerate(names):
        m = (main_s >= edges[i]) & (main_s < edges[i + 1])
        bands.append({"band": nm, "from": edges[i], "to": min(edges[i + 1], 1),
                      "landslides": int((m & (y == 1)).sum()), "controls": int((m & (y == 0)).sum()),
                      "landslide_share": round(float(y[m].mean()), 3) if m.any() else None})

    # curves (downsampled) for the web page
    curves = {}
    for name in ("Gradient boosting (all features)", "Logistic regression (all features)",
                 "Guzzetti 2008 rainfall threshold", "Mean slope only"):
        fpr, tpr, _ = roc_curve(y, scores[name])
        idx = np.unique(np.linspace(0, len(fpr) - 1, 80).astype(int))
        curves[name] = {"fpr": np.round(fpr[idx], 4).tolist(), "tpr": np.round(tpr[idx], 4).tolist()}

    # final model on all data
    model = gbm().fit(df[FEATURES], y)
    # importance measured on held-out regions only (mean over the 5 spatial folds)
    imps = []
    for tr, te in GroupKFold(n_splits=5).split(df, y, groups):
        m = gbm().fit(df.iloc[tr][FEATURES], y[tr])
        imps.append(permutation_importance(m, df.iloc[te][FEATURES], y[te], scoring="roc_auc",
                                           n_repeats=10, random_state=SEED).importances_mean)
    importance = sorted(({"feature": f, "label": LABELS[f], "importance": round(float(v), 4)}
                         for f, v in zip(FEATURES, np.mean(imps, axis=0))),
                        key=lambda d: -d["importance"])

    prior = float(model.init_.class_prior_[1])
    mj = {"features": FEATURES, "labels": LABELS, "init": math.log(prior / (1 - prior)),
          "trees": [export_tree(e[0], model.learning_rate) for e in model.estimators_],
          "risk_bands": RISK_BANDS, "params": GBM_PARAMS}
    chk = js_like_predict(mj, df[FEATURES].values[:500])
    err = np.abs(chk - model.predict_proba(df[FEATURES].iloc[:500])[:, 1]).max()
    print(f"export check max |diff| = {err:.2e}")
    assert err < 1e-4
    json.dump(mj, open(os.path.join(WEB, "model.json"), "w"), separators=(",", ":"))

    # descriptive stats for the paper
    desc = (df.groupby("kind")[FEATURES].median().round(1).T)
    results = {
        "n": {k: int(v) for k, v in df.kind.value_counts().items()},
        "n_countries": int(df[df.label == 1].country.nunique()),
        "n_spatial_groups": int(len(set(groups))),
        "top_countries": df[df.label == 1].country.value_counts().head(8).to_dict(),
        "metrics": table, "binary": binary, "matched": matched, "bands": bands, "roc": curves,
        "importance": importance, "medians": desc.to_dict(),
        "date_range": [df.date.min(), df.date.max()],
    }
    json.dump(results, open(os.path.join(WEB, "results.json"), "w"), indent=1)

    # --------------------------------------------------------------- figures
    plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    fig, ax = plt.subplots(figsize=(5, 5))
    for name, c in curves.items():
        ax.plot(c["fpr"], c["tpr"], label=f"{name} (AUC {table[name]['roc_auc']:.2f})")
    ax.plot([0, 1], [0, 1], ":", color="grey")
    ax.set(xlabel="False positive rate", ylabel="True positive rate",
           title="ROC, 5-fold spatial cross-validation")
    ax.legend(fontsize=7, loc="lower right")
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "roc.png"), dpi=200)

    fig, ax = plt.subplots(figsize=(6, 3.8))
    imp = importance[::-1]
    ax.barh([d["label"] for d in imp], [d["importance"] for d in imp], color="#b4532a")
    ax.set(xlabel="Drop in ROC-AUC when shuffled", title="Permutation feature importance")
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "importance.png"), dpi=200)

    fig, ax = plt.subplots(figsize=(5.5, 3.5))
    for lbl, nm in ((1, "Landslides"), (0, "Controls")):
        ax.hist(main_s[y == lbl], bins=25, range=(0, 1), alpha=0.6, label=nm, density=True)
    ax.set(xlabel="Out-of-fold predicted risk", ylabel="Density", title="Score separation")
    ax.legend()
    fig.tight_layout()
    fig.savefig(os.path.join(FIG, "score_hist.png"), dpi=200)
    print("done")


if __name__ == "__main__":
    main()
