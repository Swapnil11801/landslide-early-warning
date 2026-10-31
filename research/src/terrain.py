"""Terrain features from AWS Terrain Tiles (Terrarium encoding).

This module is deliberately mirrored 1:1 by web/js/terrain.js so the features the
model is trained on are exactly the features the browser computes at inference time.
"""
import io
import math
import os
import threading

import numpy as np
import requests
from PIL import Image

ZOOM = 11
TILE = 256
TILE_URL = "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
EARTH_CIRC = 40075016.686
R_SLOPE_M = 1000.0   # neighbourhood for mean / p90 slope
R_RELIEF_M = 2000.0  # neighbourhood for local relief

_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "tiles")
_lock = threading.Lock()
_mem = {}


def _tile(x, y, z=ZOOM):
    key = (z, x, y)
    if key in _mem:
        return _mem[key]
    path = os.path.join(_CACHE_DIR, f"{z}_{x}_{y}.png")
    if os.path.exists(path):
        img = Image.open(path)
    else:
        r = requests.get(TILE_URL.format(z=z, x=x, y=y), timeout=60)
        r.raise_for_status()
        os.makedirs(_CACHE_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(r.content)
        img = Image.open(io.BytesIO(r.content))
    a = np.asarray(img.convert("RGB"), dtype=np.float64)
    elev = a[..., 0] * 256.0 + a[..., 1] + a[..., 2] / 256.0 - 32768.0
    with _lock:
        if len(_mem) > 400:
            _mem.clear()
        _mem[key] = elev
    return elev


def world_px(lat, lon, z=ZOOM):
    n = TILE * 2 ** z
    x = (lon + 180.0) / 360.0 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


def pixel_size_m(lat, z=ZOOM):
    return EARTH_CIRC * math.cos(math.radians(lat)) / (TILE * 2 ** z)


def window(lat, lon, r_px):
    """Elevation window of size (2r+1)^2 centred on the pixel containing (lat, lon)."""
    px, py = world_px(lat, lon)
    cx, cy = int(math.floor(px)), int(math.floor(py))
    x0, y0, x1, y1 = cx - r_px, cy - r_px, cx + r_px, cy + r_px
    n_tiles = 2 ** ZOOM
    out = np.empty((2 * r_px + 1, 2 * r_px + 1))
    for ty in range(y0 // TILE, y1 // TILE + 1):
        for tx in range(x0 // TILE, x1 // TILE + 1):
            t = _tile(tx % n_tiles, min(max(ty, 0), n_tiles - 1))
            gx0, gy0 = tx * TILE, ty * TILE
            ax0, ay0 = max(x0, gx0), max(y0, gy0)
            ax1, ay1 = min(x1, gx0 + TILE - 1), min(y1, gy0 + TILE - 1)
            out[ay0 - y0:ay1 - y0 + 1, ax0 - x0:ax1 - x0 + 1] = \
                t[ay0 - gy0:ay1 - gy0 + 1, ax0 - gx0:ax1 - gx0 + 1]
    return out


def slope_deg(e, cell):
    """Horn (1981) slope for every interior cell of e."""
    a, b, c = e[:-2, :-2], e[:-2, 1:-1], e[:-2, 2:]
    d, f = e[1:-1, :-2], e[1:-1, 2:]
    g, h, i = e[2:, :-2], e[2:, 1:-1], e[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * cell)
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * cell)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def features(lat, lon):
    cell = pixel_size_m(lat)
    r_px = int(math.ceil(R_RELIEF_M / cell)) + 1
    e = window(lat, lon, r_px)
    yy, xx = np.mgrid[-r_px:r_px + 1, -r_px:r_px + 1]
    dist = np.hypot(xx, yy) * cell
    s = slope_deg(e, cell)                       # shape (2r-1)^2, centred the same way
    ds = dist[1:-1, 1:-1]
    s1k = s[ds <= R_SLOPE_M]
    return {
        "elev": float(e[r_px, r_px]),
        "slope": float(s[r_px - 1, r_px - 1]),
        "slope_mean_1km": float(s1k.mean()),
        "slope_p90_1km": float(np.percentile(s1k, 90)),
        "relief_2km": float(e[dist <= R_RELIEF_M].max() - e[dist <= R_RELIEF_M].min()),
    }


if __name__ == "__main__":
    # Sanity checks: Kathmandu valley rim (steep) vs. central Kansas (flat)
    print("Nepal ", features(27.75, 85.45))
    print("Kansas", features(38.5, -98.5))
