"""Feature definitions shared by training and (mirrored in web/js/model.js) inference."""

TERRAIN_FEATURES = ["elev", "slope", "slope_mean_1km", "slope_p90_1km", "relief_2km"]
RAIN_FEATURES = ["r1", "r3", "r7", "r30", "ante"]
FEATURES = TERRAIN_FEATURES + RAIN_FEATURES

LABELS = {
    "elev": "Elevation (m)",
    "slope": "Slope at point (°)",
    "slope_mean_1km": "Mean slope within 1 km (°)",
    "slope_p90_1km": "Steepest-10% slope within 1 km (°)",
    "relief_2km": "Local relief within 2 km (m)",
    "r1": "Rain on the day (mm)",
    "r3": "3-day rain (mm)",
    "r7": "7-day rain (mm)",
    "r30": "30-day rain (mm)",
    "ante": "Antecedent rain, days 8–30 (mm)",
}


def rain_features(p):
    """p: 30 daily precipitation totals (mm), oldest first, last = day of interest."""
    p = [0.0 if v is None else float(v) for v in p]
    r7, r30 = sum(p[-7:]), sum(p[-30:])
    return {"r1": p[-1], "r3": sum(p[-3:]), "r7": r7, "r30": r30, "ante": r30 - r7}
