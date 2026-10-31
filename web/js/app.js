import { terrainFeatures } from "./terrain.js";
import { rainSeries, rainSeriesMany, geocode } from "./weather.js";
import { loadModel, predict, rainFeatures, band, BANDS, getModel } from "./model.js";
import { loadStability, stability, getStability } from "./stability.js";

const REPO_URL = "https://github.com/Swapnil11801/landslide-early-warning";
document.getElementById("gh-link").href = REPO_URL;

const $ = (s, el = document) => el.querySelector(s);
const content = $("#content");
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toFixed(d));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// ------------------------------------------------------------------ theme
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};
const savedTheme = store.get("theme");
if (savedTheme) document.documentElement.dataset.theme = savedTheme;
$("#theme").onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  store.set("theme", document.documentElement.dataset.theme);
  if (state.series) render();
};

// -------------------------------------------------------------------- map
const map = L.map("map", { preferCanvas: true, zoomControl: true, worldCopyJump: true }).setView([27.9, 84.5], 7);
const baseLayers = {
  Terrain: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17, attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
  }),
  Satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 18, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  }),
  Streets: L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap contributors © CARTO",
  }),
};
baseLayers.Terrain.addTo(map);
const historyLayer = L.layerGroup().addTo(map);
const scanLayer = L.layerGroup().addTo(map);
L.control.layers(baseLayers, { "Past landslides (NASA)": historyLayer, "Area scan": scanLayer }, { position: "topright" }).addTo(map);
L.control.scale({ imperial: false }).addTo(map);

let marker = null;
map.on("click", (e) => analyse(e.latlng.lat, e.latlng.lng));

// Scan tool
const Tools = L.Control.extend({
  options: { position: "bottomright" },
  onAdd() {
    const div = L.DomUtil.create("div", "map-tools");
    div.innerHTML = `
      <b>Area scan</b>
      <div class="tiny" style="margin:2px 0 6px">Scores a 10×10 grid over the visible map.</div>
      <select id="scan-day" aria-label="Scan day">
        <option value="0">Today</option>
        ${[1, 2, 3, 4, 5, 6].map((d) => `<option value="${d}">In ${d} day${d > 1 ? "s" : ""}</option>`).join("")}
      </select>
      <button class="btn btn-scan" id="scan">Scan visible area</button>
      <div class="tiny" id="scan-msg" style="margin-top:6px"></div>`;
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  },
});
new Tools().addTo(map);

// --------------------------------------------------------------- history
let EVENTS = [];
fetch("data/events.json").then((r) => r.json()).then((j) => {
  EVENTS = j.rows;
  const sizeR = { small: 3, medium: 4, large: 6, very_large: 8, catastrophic: 10 };
  for (const [lat, lon, date, fat, trig, size, title] of EVENTS) {
    L.circleMarker([lat, lon], {
      radius: sizeR[size] ?? 3, weight: 0.6, color: "#fff", fillColor: fat > 0 ? "#b02330" : "#6b4a3a", fillOpacity: 0.7,
    }).bindPopup(`<b>${esc(title || "Landslide")}</b><br>${date} · ${esc(trig.replace(/_/g, " "))} · ${esc(size.replace(/_/g, " "))}` +
      (fat ? `<br><b>${fat}</b> fatalities` : "")).addTo(historyLayer);
  }
}).catch(() => {});

function nearby(lat, lon, km = 25) {
  const out = [];
  for (const e of EVENTS) {
    const d = haversine(lat, lon, e[0], e[1]);
    if (d <= km) out.push({ d, date: e[2], fat: e[3], trig: e[4], title: e[6] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
function haversine(a, b, c, d) {
  const p = Math.PI / 180;
  const h = Math.sin(((c - a) * p) / 2) ** 2 + Math.cos(a * p) * Math.cos(c * p) * Math.sin(((d - b) * p) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ------------------------------------------------------------------ state
const state = { lat: null, lon: null, name: null, terrain: null, series: null, sel: null, extra: 0, soil: null };
const modelReady = Promise.all([loadModel(), loadStability()]);

function intro() {
  content.innerHTML = `
    <section class="intro card">
      <h1>Will this slope fail after the next storm?</h1>
      <p>SlopeWatch estimates the risk of a <b>rainfall-triggered landslide</b> anywhere on Earth by combining
      terrain steepness with the last 30 days of rain and the 7-day forecast. It uses a model trained on
      NASA's Global Landslide Catalog.</p>
      <ol class="how">
        <li><b>Click the map</b> or search a place. Hilly regions are the most interesting.</li>
        <li>SlopeWatch reads elevation tiles and computes <b>slope and relief</b> in your browser.</li>
        <li>It fetches <b>rainfall</b> for the past 40 days plus the forecast and scores every day.</li>
        <li>Each score comes with an <b>explanation</b> of which factors pushed the risk up or down.</li>
      </ol>
      <div class="tiny" style="margin:10px 0 6px">Try a place with a landslide history:</div>
      <div class="chips">
        ${[["Wayanad, India", 11.468, 76.14], ["Darjeeling, India", 27.03, 88.25], ["Petrópolis, Brazil", -22.505, -43.19],
          ["Pokhara hills, Nepal", 28.25, 83.95], ["Oso, USA", 48.282, -121.85], ["Amalfi Coast, Italy", 40.635, 14.6],
          ["Hiroshima, Japan", 34.47, 132.43], ["Kerala Ghats", 10.08, 77.06]]
          .map(([n, a, b]) => `<button class="chip" data-lat="${a}" data-lon="${b}" data-name="${n}">${n}</button>`).join("")}
      </div>
    </section>
    <p class="disclaimer">This is a research prototype and not an official warning service. In an emergency, follow the guidance of your local authorities.</p>`;
  content.querySelectorAll(".chip").forEach((c) =>
    (c.onclick = () => analyse(+c.dataset.lat, +c.dataset.lon, c.dataset.name, true)));
}

// ---------------------------------------------------------------- analyse
let runId = 0;
async function analyse(lat, lon, name = null, fly = false) {
  const id = ++runId;
  lon = ((lon + 540) % 360) - 180;
  Object.assign(state, { lat, lon, name, terrain: null, series: null, sel: null, extra: 0 });
  if (marker) marker.remove();
  marker = L.marker([lat, lon], { icon: L.divIcon({ className: "", html: '<div class="pulse"></div>', iconSize: [18, 18] }) }).addTo(map);
  if (fly) map.flyTo([lat, lon], 12, { duration: 1.2 });

  const steps = ["Loading model", "Reading elevation tiles and computing slope", "Fetching rainfall (past 40 days + 7-day forecast)", "Scoring the past week and the forecast"];
  const show = (k, err) => {
    content.innerHTML = `<div class="card"><h3>Analysing ${fmt(lat, 3)}°, ${fmt(lon, 3)}°</h3><ul class="loading">${steps
      .map((s, i) => `<li class="${i < k ? "done" : i === k ? "active" : ""}">${i < k ? "✓" : i === k ? (err ? "✕" : '<span class="spinner"></span>') : "·"} ${s}</li>`)
      .join("")}</ul>${err ? `<p class="err">${esc(err)}</p>` : ""}</div>`;
  };
  let k = 0;
  try {
    show(k); await modelReady; show(++k);
    const terrainP = terrainFeatures(lat, lon);
    const rainP = rainSeries(lat, lon);
    state.terrain = await terrainP; if (id !== runId) return; show(++k);
    state.series = await rainP; if (id !== runId) return; show(++k);
  } catch (e) {
    if (id === runId) show(k, e.message || String(e));
    return;
  }
  if (state.terrain.elev <= 0) {
    content.innerHTML = `<div class="card"><h3>That point is in water</h3><p class="muted">Elevation is ${fmt(state.terrain.elev)} m. Click a point on land.</p></div>`;
    return;
  }
  state.sel = state.series.todayIndex;
  render();
}

function scoreDay(i, extra = 0) {
  const p = state.series.precip.slice(i - 29, i + 1).map((v) => v ?? 0);
  if (extra) p[p.length - 1] += extra;
  const rf = rainFeatures(p);
  return { rain: rf, ...predict({ ...state.terrain, ...rf }) };
}

// ----------------------------------------------------------------- render
function render() {
  const s = state.series, t = state.terrain, T = s.todayIndex;
  const days = [];
  for (let i = T - 7; i <= T + 6; i++) days.push({ i, date: s.dates[i], ...scoreDay(i) });
  const cur = scoreDay(state.sel, state.extra);
  const selDate = new Date(s.dates[state.sel] + "T12:00");
  const rel = state.sel - T;
  const whenTxt = rel === 0 ? "today" : rel > 0 ? `in ${rel} day${rel > 1 ? "s" : ""} (forecast)` : `${-rel} day${rel < -1 ? "s" : ""} ago`;
  const hist = nearby(state.lat, state.lon);
  const fatal = hist.filter((h) => h.fat > 0);

  content.innerHTML = `
    <div class="loc">
      <div><h2>${esc(state.name ?? "Selected point")}</h2>
      <div class="coords">${fmt(state.lat, 4)}°, ${fmt(state.lon, 4)}° · ${fmt(t.elev)} m a.s.l.</div></div>
      <button class="chip" id="reset">✕ Clear</button>
    </div>

    <section class="card">
      <div class="risk-hero">
        ${gauge(cur.p)}
        <div>
          <div class="tiny">${selDate.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · ${whenTxt}</div>
          <div class="label" style="color:${cur.band.color}">${cur.band.name} risk</div>
          <div class="sub">${summary(cur, t)}</div>
        </div>
      </div>
      <h3 style="margin-top:14px">Past week + 7-day forecast <small>click a day</small></h3>
      <div class="strip">
        ${days.map((d) => {
          const dt = new Date(d.date + "T12:00");
          return `<button data-i="${d.i}" class="${d.i === T ? "today" : ""} ${d.i > T ? "fc" : ""}" aria-pressed="${d.i === state.sel}"
            title="${d.date}: ${d.band.name} (${Math.round(d.p * 100)}/100), ${fmt(d.rain.r1, 1)} mm rain">
            <div class="cell" style="background:${d.band.color}"></div>
            <span>${d.i === T ? "Today" : dt.toLocaleDateString(undefined, { weekday: "narrow" })}</span></button>`;
        }).join("")}
      </div>
      <div class="legend">${BANDS.map((b) => `<span><i style="background:${b.color}"></i>${b.name}</span>`).join("")}<span>▨ forecast</span></div>
    </section>

    <section class="card chart">
      <h3>Daily rainfall <small>mm · last 30 days + forecast</small></h3>
      ${rainChart()}
      <div class="stats" style="margin-top:10px">
        ${stat(fmt(cur.rain.r1, 1) + " mm", "on the selected day")}
        ${stat(fmt(cur.rain.r3, 0) + " mm", "3-day total")}
        ${stat(fmt(cur.rain.r7, 0) + " mm", "7-day total")}
        ${stat(fmt(cur.rain.r30, 0) + " mm", "30-day total")}
      </div>
    </section>

    <section class="card">
      <h3>Why this score? <small>contribution of each factor</small></h3>
      ${contribChart(cur)}
      <p class="tiny" style="margin:8px 0 0">Bars show how much each input pushed the risk <span style="color:var(--pos)">up</span> or
      <span style="color:var(--neg)">down</span> compared with the average location and day in the training data (in log-odds, using tree-path attribution).</p>
    </section>

    <section class="card whatif">
      <h3>What if it rains more? <small>scenario</small></h3>
      <div class="row"><span>Extra rain on the selected day</span><b id="xv">+${state.extra} mm</b></div>
      <input type="range" id="extra" min="0" max="300" step="5" value="${state.extra}" aria-label="Extra rainfall in millimetres">
      <div class="tiny">Drag to see how much rain this slope can absorb before the risk level changes.
      ${threshold()}</div>
    </section>

    <section class="card" id="stab"></section>

    <section class="card">
      <h3>Terrain <small>Copernicus/SRTM elevation via AWS Terrain Tiles</small></h3>
      <div class="stats">
        ${stat(fmt(t.slope_mean_1km, 1) + "°", "mean slope within 1 km")}
        ${stat(fmt(t.slope_p90_1km, 1) + "°", "steepest 10% within 1 km")}
        ${stat(fmt(t.relief_2km) + " m", "relief within 2 km")}
        ${stat(fmt(t.slope, 1) + "°", "slope at the exact point")}
      </div>
    </section>

    <section class="card history">
      <h3>Recorded history <small>NASA catalog, 2007–2017, within 25 km</small></h3>
      ${hist.length
        ? `<p class="muted" style="margin:0"><b>${hist.length}</b> landslide${hist.length > 1 ? "s" : ""} recorded${fatal.length ? `, <b>${fatal.length}</b> of them fatal` : ""}.</p>
           <ul>${hist.slice(0, 4).map((h) => `<li>${h.date} · ${esc(h.title || h.trig)} <span class="tiny">(${fmt(h.d, 0)} km)</span></li>`).join("")}</ul>`
        : `<p class="muted" style="margin:0">No landslides are catalogued nearby. The catalog is compiled from news reports, so remote areas are under-represented.</p>`}
    </section>
    <p class="disclaimer">Research prototype and not an official warning. The model was validated on regions it had never seen (spatial cross-validation), and it has known limitations, which are described on the <a href="research.html">Research</a> page.</p>`;

  $("#reset").onclick = () => { if (marker) marker.remove(); state.series = null; intro(); };
  content.querySelectorAll(".strip button").forEach((b) => (b.onclick = () => { state.sel = +b.dataset.i; state.extra = 0; render(); }));
  renderStability();
  const slider = $("#extra");
  slider.oninput = () => {
    state.extra = +slider.value;
    const keep = content.scrollTop;
    render();
    $("#extra").focus();
    content.scrollTop = keep;
  };
}

// ------------------------------------------------------- slope stability
const SOIL = [
  { k: "c", label: "Effective cohesion c′", unit: " kPa", min: 0, max: 20, step: 0.5 },
  { k: "phi", label: "Friction angle φ′", unit: "°", min: 20, max: 45, step: 1 },
  { k: "z", label: "Soil depth to slip surface z", unit: " m", min: 0.5, max: 3, step: 0.1 },
];

function stabDay(i, extra = 0) {
  const p = state.series.precip.slice(i - 29, i + 1).map((v) => v ?? 0);
  if (extra) p[p.length - 1] += extra;
  return stability(state.terrain.slope_p90_1km, p, state.soil);
}

function renderStability() {
  const S = getStability(), T = state.series.todayIndex;
  state.soil ??= { c: S.deterministic.c, phi: S.deterministic.phi, z: S.deterministic.z };
  const cur = stabDay(state.sel, state.extra);
  const days = [];
  for (let i = T - 7; i <= T + 6; i++) days.push({ i, ...stabDay(i, i === state.sel ? state.extra : 0) });
  const col = cur.fs < 1 ? "var(--risk-3)" : cur.fs < 1.3 ? "var(--risk-2)" : cur.fs < 1.5 ? "var(--risk-1)" : "var(--risk-0)";
  const verdict = cur.fs < 1 ? "Unstable (FS < 1)" : cur.fs < 1.3 ? "Marginally stable" : cur.fs < 1.5 ? "Stable, low margin" : "Stable";
  $("#stab").innerHTML = `
    <h3>Slope stability <small>infinite-slope model · geomechanics</small></h3>
    <div class="risk-hero">
      <div style="text-align:center;min-width:96px"><div class="tiny">Factor of safety</div>
        <div style="font:600 34px/1.1 var(--serif);color:${col}">${fmt(cur.fs, 2)}</div></div>
      <div><div class="label" style="font-size:19px;color:${col}">${verdict}</div>
        <div class="sub">Water table at <b>${Math.round(cur.wetness * 100)}%</b> of soil depth. Over 400 plausible soils,
        <b>${Math.round(cur.pf * 100)}%</b> would fail on this slope today: P(FS&nbsp;&lt;&nbsp;1).</div></div>
    </div>
    ${fsChart(days, T)}
    <div class="whatif" style="margin-top:8px">
      ${SOIL.map((p) => `<div class="row"><span>${p.label}</span><b>${fmt(state.soil[p.k], p.step < 1 ? 1 : 0)}${p.unit}</b></div>
        <input type="range" data-soil="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${state.soil[p.k]}" aria-label="${p.label}">`).join("")}
      <button class="chip" id="soil-reset" style="margin-top:4px">Reset to typical soil</button>
    </div>
    <p class="tiny" style="margin:8px 0 0">FS = c′/(γ z sin β cos β) + (1 − m γ<sub>w</sub>/γ) tan φ′ / tan β, using the steepest 10% of slopes within 1 km
    (β = ${fmt(state.terrain.slope_p90_1km, 1)}°) and a water table m fed by the last 30 days of rain. The soil properties are textbook values, not site measurements.
    Validation shows this model needs local soil data to be predictive. The <a href="research.html#s4">Research</a> page explains why.</p>`;
  $("#stab").querySelectorAll("input[data-soil]").forEach((el) => (el.oninput = () => {
    state.soil[el.dataset.soil] = +el.value;
    renderStability();
    $(`#stab input[data-soil="${el.dataset.soil}"]`).focus();
  }));
  $("#soil-reset").onclick = () => { state.soil = null; renderStability(); };
}

function fsChart(days, T) {
  const W = 380, H = 96, pad = 26, n = days.length, bw = (W - pad) / n;
  const max = Math.max(2, ...days.map((d) => Math.min(d.fs, 4)));
  const y = (v) => 6 + (1 - Math.min(v, max) / max) * (H - 24);
  const pts = days.map((d, k) => `${pad + k * bw + bw / 2},${y(d.fs)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;margin-top:8px" role="img" aria-label="Factor of safety, past week and forecast">
    <rect x="${pad}" y="${y(1)}" width="${W - pad}" height="${H - 18 - y(1)}" fill="var(--risk-3)" opacity=".1"/>
    <line x1="${pad}" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="var(--risk-3)" stroke-dasharray="3 3"/>
    <text x="${pad - 4}" y="${y(1) + 3}" text-anchor="end" font-size="10" fill="var(--ink-3)">1.0</text>
    <text x="${pad - 4}" y="${y(max) + 6}" text-anchor="end" font-size="10" fill="var(--ink-3)">${fmt(max, 1)}</text>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${days.map((d, k) => `<circle cx="${pad + k * bw + bw / 2}" cy="${y(d.fs)}" r="${d.i === state.sel ? 4 : 2.2}" fill="${d.i > T ? "var(--surface)" : "var(--accent)"}" stroke="var(--accent)"><title>FS ${fmt(d.fs, 2)}, P(fail) ${Math.round(d.pf * 100)}%</title></circle>`).join("")}
    <text x="${pad + (T - days[0].i) * bw + bw / 2}" y="${H - 4}" text-anchor="middle" font-size="10" fill="var(--ink-3)">today</text>
    <text x="${W}" y="${H - 4}" text-anchor="end" font-size="10" fill="var(--ink-3)">FS = 1 means failure</text></svg>`;
}

function summary(cur, t) {
  const steep = t.slope_mean_1km >= 20 ? "steep" : t.slope_mean_1km >= 10 ? "moderately steep" : "gentle";
  const wet = cur.rain.r3 >= 100 ? "very heavy recent rain" : cur.rain.r3 >= 40 ? "heavy recent rain" : cur.rain.r7 >= 40 ? "a wet week" : "little recent rain";
  return `Index ${Math.round(cur.p * 100)}/100. The terrain is ${steep} (${fmt(t.slope_mean_1km, 0)}° mean slope) and there has been ${wet}.`;
}

function threshold() {
  // smallest extra rain on the selected day that reaches the next band
  const base = scoreDay(state.sel).band.index;
  if (base >= 3) return "<br>The risk is already at the highest level.";
  for (let x = 5; x <= 400; x += 5) {
    const b = scoreDay(state.sel, x).band;
    if (b.index > base) return `<br>About <b>${x} mm</b> more rain would raise the level to <b style="color:${b.color}">${b.name}</b>.`;
  }
  return "<br>Even 400 mm of extra rain would not change the level here, so terrain is the limiting factor.";
}

const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;

function gauge(p) {
  const R = 50, cx = 59, cy = 58;
  const pt = (f) => [cx - R * Math.cos(Math.PI * f), cy - R * Math.sin(Math.PI * f)];
  const edges = [0, ...(getModel()?.risk_bands ?? [0.25, 0.5, 0.75]), 1];
  const arcs = BANDS.map((b, i) => {
    const [x0, y0] = pt(edges[i] + 0.006), [x1, y1] = pt(edges[i + 1] - 0.006);
    return `<path d="M${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1}" stroke="${b.color}" stroke-width="11" fill="none" opacity="${band(p).index === i ? 1 : 0.28}"/>`;
  }).join("");
  const [nx, ny] = pt(p);
  return `<svg class="gauge" viewBox="0 0 118 72" role="img" aria-label="Risk index ${Math.round(p * 100)} of 100">
    ${arcs}<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="4" fill="var(--ink)"/>
    <text x="${cx}" y="${cy + 13}" text-anchor="middle" font-size="12" font-weight="600">${Math.round(p * 100)}</text></svg>`;
}

function rainChart() {
  const s = state.series, T = s.todayIndex;
  const i0 = T - 30, i1 = s.dates.length - 1;
  const vals = s.precip.slice(i0, i1 + 1).map((v) => v ?? 0);
  const W = 380, H = 120, pad = 22, n = vals.length, bw = (W - pad) / n;
  const max = Math.max(20, ...vals, state.extra ? vals[state.sel - i0] + state.extra : 0);
  const y = (v) => H - 16 - (v / max) * (H - 26);
  const bars = vals.map((v, k) => {
    const i = i0 + k, x = pad + k * bw, fc = i > T;
    const extra = i === state.sel && state.extra ? `<rect x="${x + 1}" y="${y(v + state.extra)}" width="${bw - 2}" height="${y(v) - y(v + state.extra)}" fill="var(--accent)" opacity=".75"/>` : "";
    return `<rect x="${x + 1}" y="${y(v)}" width="${bw - 2}" height="${H - 16 - y(v)}" rx="1.5" fill="${fc ? "var(--rain-soft)" : "var(--rain)"}"
      ${i === state.sel ? 'stroke="var(--ink)" stroke-width="1.2"' : ""}><title>${s.dates[i]}: ${fmt(v, 1)} mm${fc ? " (forecast)" : ""}</title></rect>${extra}`;
  }).join("");
  const tx = pad + (T - i0) * bw;
  const ticks = [0, max / 2, max].map((v) => `<text x="${pad - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily rainfall bar chart">
    ${ticks}<line class="axis" x1="${pad}" x2="${W}" y1="${H - 16}" y2="${H - 16}"/>
    <line x1="${tx}" x2="${tx}" y1="4" y2="${H - 16}" stroke="var(--ink-3)" stroke-dasharray="2 3"/>
    <text x="${tx + 3}" y="10">today</text>
    ${bars}
    <text x="${pad}" y="${H - 3}">${s.dates[i0].slice(5)}</text>
    <text x="${W}" y="${H - 3}" text-anchor="end">${s.dates[i1].slice(5)}</text></svg>`;
}

function contribChart(cur) {
  const m = getModel();
  const feat = { ...state.terrain, ...cur.rain };
  const units = { elev: " m", slope: "°", slope_mean_1km: "°", slope_p90_1km: "°", relief_2km: " m", r1: " mm", r3: " mm", r7: " mm", r30: " mm", ante: " mm" };
  const items = m.features.map((f) => ({ f, c: cur.contributions[f], v: feat[f] })).sort((a, b) => Math.abs(b.c) - Math.abs(a.c));
  const mx = Math.max(0.5, ...items.map((d) => Math.abs(d.c)));
  return `<div class="contrib">${items.map((d) => {
    const w = (Math.abs(d.c) / mx) * 50;
    const left = d.c >= 0 ? 50 : 50 - w;
    return `<div class="name">${esc(m.labels[d.f].replace(/ \(.*\)/, ""))}<b>${fmt(d.v, d.v < 10 ? 1 : 0)}${units[d.f]}</b></div>
      <div class="bar" title="${d.c >= 0 ? "+" : ""}${d.c.toFixed(2)} log-odds"><i style="left:${left}%;width:${w}%;background:${d.c >= 0 ? "var(--pos)" : "var(--neg)"}"></i></div>`;
  }).join("")}</div>`;
}

// ------------------------------------------------------------------- scan
document.addEventListener("click", async (e) => {
  if (e.target.id !== "scan") return;
  const btn = e.target, msg = $("#scan-msg");
  if (map.getZoom() < 10) { msg.textContent = "Zoom in to at least level 10 first (about 150 km across)."; return; }
  btn.disabled = true;
  scanLayer.clearLayers();
  if (!map.hasLayer(scanLayer)) scanLayer.addTo(map);
  try {
    await modelReady;
    const b = map.getBounds(), N = 10, off = +$("#scan-day").value;
    const dLat = (b.getNorth() - b.getSouth()) / N, dLon = (b.getEast() - b.getWest()) / N;
    const cells = [];
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++)
      cells.push({ lat: b.getSouth() + (r + 0.5) * dLat, lon: b.getWest() + (c + 0.5) * dLon, r, c });
    msg.textContent = "Computing terrain…";
    let done = 0;
    await pool(cells, 8, async (cell) => {
      cell.t = await terrainFeatures(cell.lat, cell.lon);
      msg.textContent = `Computing terrain… ${++done}/${cells.length}`;
    });
    const land = cells.filter((c) => c.t.elev > 0);
    msg.textContent = "Fetching rainfall…";
    for (let k = 0; k < land.length; k += 50) {
      const chunk = land.slice(k, k + 50);
      const ser = await rainSeriesMany(chunk.map((c) => c.lat), chunk.map((c) => c.lon));
      chunk.forEach((c, j) => (c.s = ser[j]));
    }
    for (const c of land) {
      const i = c.s.todayIndex + off;
      const rf = rainFeatures(c.s.precip.slice(i - 29, i + 1));
      const pr = predict({ ...c.t, ...rf });
      L.rectangle([[c.lat - dLat / 2, c.lon - dLon / 2], [c.lat + dLat / 2, c.lon + dLon / 2]], {
        weight: 0, fillColor: css(`--risk-${pr.band.index}`), fillOpacity: 0.28 + 0.4 * pr.p,
      }).bindTooltip(`${pr.band.name} · ${Math.round(pr.p * 100)}/100<br>slope ${fmt(c.t.slope_mean_1km, 0)}°, 3-day rain ${fmt(rf.r3, 0)} mm`)
        .on("click", () => analyse(c.lat, c.lon)).addTo(scanLayer);
    }
    msg.textContent = `Scored ${land.length} cells for ${off ? `day +${off}` : "today"}. Click a cell for details.`;
  } catch (err) {
    msg.textContent = "Scan failed: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
});

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ----------------------------------------------------------------- search
const q = $("#q"), list = $("#results");
let timer;
q.addEventListener("input", () => {
  clearTimeout(timer);
  if (q.value.trim().length < 2) { list.hidden = true; return; }
  timer = setTimeout(async () => {
    const res = await geocode(q.value.trim());
    list.innerHTML = res.map((r, i) => `<li data-i="${i}">${esc(r.name)} <small>${esc([r.admin1, r.country].filter(Boolean).join(", "))}</small></li>`).join("")
      || "<li><small>No matches</small></li>";
    list.hidden = false;
    list.querySelectorAll("li[data-i]").forEach((li) => (li.onclick = () => {
      const r = res[+li.dataset.i];
      list.hidden = true; q.value = r.name;
      analyse(r.latitude, r.longitude, `${r.name}${r.country ? ", " + r.country : ""}`, true);
    }));
  }, 250);
});
q.addEventListener("keydown", (e) => { if (e.key === "Enter") list.querySelector("li[data-i]")?.click(); });
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) list.hidden = true; });

// deep link: #lat,lon
const m = location.hash.match(/^#(-?[\d.]+),(-?[\d.]+)/);
if (m) analyse(+m[1], +m[2], null, true); else intro();
