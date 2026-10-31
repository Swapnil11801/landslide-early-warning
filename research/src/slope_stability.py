"""Physically based infinite-slope stability with a rainfall-driven water table.

Mirrored 1:1 by web/js/stability.js.

Infinite-slope factor of safety for a planar slip surface at depth z, parallel to a slope
of angle beta, with a water table at height m*z above the slip surface (seepage parallel
to the slope), e.g. Skempton & DeLory (1957); Montgomery & Dietrich (1994):

    FS = c' / (gamma * z * sin(beta) * cos(beta))
         + (1 - m * gamma_w / gamma) * tan(phi') / tan(beta)

Water table: rainfall recharges a linear reservoir that drains with time constant TAU days
(a common simplification of transient infiltration, cf. Iverson 2000; Crosta & Frattini 2003):

    S = sum_i P_{t-i} * exp(-i / TAU)            [mm stored]
    m = min(1, S / (1000 * n_d * z))             n_d = drainable porosity

Soil properties are unknown at global scale, so instead of one deterministic FS we treat
c', phi', z and gamma as random variables and report the probability of failure
P_f = P(FS < 1) (geotechnical reliability analysis, e.g. Griffiths & Fenton 2004).
All parameter ranges are fixed a priori from textbook values for shallow residual and
colluvial soils; none are fitted to the landslide data.
"""
import math

import numpy as np

GAMMA_W = 9.81          # kN/m3
TAU_DAYS = 3.0          # drainage time constant of the shallow soil reservoir
N_SAMPLES = 400
SEED = 7

# a-priori ranges for shallow soils on hillslopes
PRIORS = {
    "c":     ("uniform", 1.0, 10.0),   # effective cohesion incl. root cohesion, kPa
    "phi":   ("normal", 32.0, 4.0),    # effective friction angle, degrees
    "z":     ("uniform", 0.5, 2.5),    # depth of slip surface, m
    "gamma": ("normal", 19.0, 1.0),    # unit weight, kN/m3
    "nd":    ("uniform", 0.10, 0.30),  # drainable porosity (-)
}
DETERMINISTIC = {"c": 5.0, "phi": 32.0, "z": 1.5, "gamma": 19.0, "nd": 0.2}


def sample_parameters(n=N_SAMPLES, seed=SEED):
    """Fixed Monte Carlo sample, exported to the browser so both sides use identical draws."""
    rng = np.random.default_rng(seed)
    out = {}
    for k, (dist, a, b) in PRIORS.items():
        out[k] = rng.uniform(a, b, n) if dist == "uniform" else rng.normal(a, b, n)
    out["phi"] = np.clip(out["phi"], 20, 45)
    return {k: np.round(v, 4) for k, v in out.items()}


def storage_mm(precip, tau=TAU_DAYS):
    """precip: daily totals, oldest first; last value is the day of interest."""
    p = np.nan_to_num(np.asarray(precip, dtype=float))[::-1]
    return float(np.sum(p * np.exp(-np.arange(len(p)) / tau)))


def factor_of_safety(beta_deg, storage, c, phi, z, gamma, nd):
    """Vectorised over parameter arrays. beta in degrees, storage in mm."""
    beta = np.radians(np.clip(beta_deg, 0.5, 89.0))
    m = np.minimum(1.0, storage / (1000.0 * nd * z))
    cohesive = c / (gamma * z * np.sin(beta) * np.cos(beta))
    frictional = (1.0 - m * GAMMA_W / gamma) * np.tan(np.radians(phi)) / np.tan(beta)
    return cohesive + frictional, m


def stability(beta_deg, precip, samples):
    s = storage_mm(precip)
    fs, _ = factor_of_safety(beta_deg, s, **samples)
    fs_det, m_det = factor_of_safety(beta_deg, s, **DETERMINISTIC)
    return {"storage_mm": s, "fs": float(fs_det), "wetness": float(m_det),
            "pf": float(np.mean(fs < 1.0))}


if __name__ == "__main__":
    smp = sample_parameters()
    dry, wet = [0.0] * 30, [0.0] * 27 + [40.0, 80.0, 120.0]
    for beta in (10, 20, 30, 38):
        print(beta, "dry", stability(beta, dry, smp), "\n   wet", stability(beta, wet, smp))
