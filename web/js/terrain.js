// Terrain features from AWS Terrain Tiles (Terrarium PNG encoding).
// Mirrors research/src/terrain.py exactly - the model is trained on these same numbers.

export const ZOOM = 11;
const TILE = 256;
const TILE_URL = (z, x, y) =>
  `https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${z}/${x}/${y}.png`;
const EARTH_CIRC = 40075016.686;
const R_SLOPE_M = 1000;
const R_RELIEF_M = 2000;

const tileCache = new Map();

async function loadTile(x, y) {
  const key = `${x}/${y}`;
  if (!tileCache.has(key)) {
    tileCache.set(key, (async () => {
      const res = await fetch(TILE_URL(ZOOM, x, y));
      if (!res.ok) throw new Error(`Elevation tile ${key} failed (${res.status})`);
      const bmp = await createImageBitmap(await res.blob(),
        { colorSpaceConversion: "none", premultiplyAlpha: "none" });
      const cv = new OffscreenCanvas(TILE, TILE);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, TILE, TILE).data;
      const elev = new Float64Array(TILE * TILE);
      for (let i = 0; i < elev.length; i++) {
        elev[i] = px[4 * i] * 256 + px[4 * i + 1] + px[4 * i + 2] / 256 - 32768;
      }
      return elev;
    })());
    if (tileCache.size > 300) tileCache.delete(tileCache.keys().next().value);
  }
  try {
    return await tileCache.get(key);
  } catch (e) {
    tileCache.delete(key);
    throw e;
  }
}

export function worldPx(lat, lon) {
  const n = TILE * 2 ** ZOOM;
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
}

export const pixelSizeM = (lat) => (EARTH_CIRC * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** ZOOM);

async function windowAround(lat, lon, r) {
  const [px, py] = worldPx(lat, lon);
  const cx = Math.floor(px), cy = Math.floor(py);
  const x0 = cx - r, y0 = cy - r, x1 = cx + r, y1 = cy + r;
  const size = 2 * r + 1, nT = 2 ** ZOOM;
  const out = new Float64Array(size * size);
  const jobs = [];
  for (let ty = Math.floor(y0 / TILE); ty <= Math.floor(y1 / TILE); ty++) {
    for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) {
      jobs.push(loadTile(((tx % nT) + nT) % nT, Math.min(Math.max(ty, 0), nT - 1)).then((t) => {
        const gx0 = tx * TILE, gy0 = ty * TILE;
        const ax0 = Math.max(x0, gx0), ay0 = Math.max(y0, gy0);
        const ax1 = Math.min(x1, gx0 + TILE - 1), ay1 = Math.min(y1, gy0 + TILE - 1);
        for (let y = ay0; y <= ay1; y++) {
          for (let x = ax0; x <= ax1; x++) {
            out[(y - y0) * size + (x - x0)] = t[(y - gy0) * TILE + (x - gx0)];
          }
        }
      }));
    }
  }
  await Promise.all(jobs);
  return { e: out, size };
}

// numpy.percentile default ("linear") interpolation
function percentile(arr, q) {
  const a = Float64Array.from(arr).sort();
  const pos = (q / 100) * (a.length - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

export async function terrainFeatures(lat, lon) {
  const cell = pixelSizeM(lat);
  const r = Math.ceil(R_RELIEF_M / cell) + 1;
  const { e, size } = await windowAround(lat, lon, r);
  const E = (y, x) => e[y * size + x];
  let emin = Infinity, emax = -Infinity;
  const slopes1k = [];
  let slopeCentre = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r) * cell;
      if (d <= R_RELIEF_M) {
        emin = Math.min(emin, E(y, x));
        emax = Math.max(emax, E(y, x));
      }
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) continue;
      if (d > R_SLOPE_M && !(x === r && y === r)) continue;
      // Horn (1981)
      const a = E(y - 1, x - 1), b = E(y - 1, x), c = E(y - 1, x + 1);
      const dd = E(y, x - 1), f = E(y, x + 1);
      const g = E(y + 1, x - 1), h = E(y + 1, x), i = E(y + 1, x + 1);
      const dzdx = (c + 2 * f + i - (a + 2 * dd + g)) / (8 * cell);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cell);
      const s = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      if (x === r && y === r) slopeCentre = s;
      if (d <= R_SLOPE_M) slopes1k.push(s);
    }
  }
  return {
    elev: E(r, r),
    slope: slopeCentre,
    slope_mean_1km: slopes1k.reduce((s, v) => s + v, 0) / slopes1k.length,
    slope_p90_1km: percentile(slopes1k, 90),
    relief_2km: emax - emin,
  };
}
