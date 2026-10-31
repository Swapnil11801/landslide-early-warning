// Renders the Research page from model/results.json (written by research/src/train.py),
// so every number on the page comes straight from the pipeline.

const REPO = "https://github.com/Swapnil11801/landslide-early-warning";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* unavailable */ } },
};
const t0 = store.get("theme");
if (t0) document.documentElement.dataset.theme = t0;
document.getElementById("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "light" : "dark";
  store.set("theme", document.documentElement.dataset.theme);
  draw();
};

const R = await (await fetch("model/results.json")).json();
const C = await (await fetch("model/case_studies.json")).json();
const f2 = (v) => v.toFixed(2);
const pct = (v) => `${Math.round(v * 100)}%`;
const MAIN = "Gradient boosting (all features)";
const main = R.metrics[MAIN];
const gz = R.metrics["Guzzetti 2008 rainfall threshold"];
const nPos = R.n.landslide, nNeg = (R.n.temporal_control ?? 0) + (R.n.spatial_control ?? 0);
const bin = R.binary;
const ours = bin["This model (p ≥ 0.5)"], guz = bin["Guzzetti 2008 (exceeded)"];
const P = R.physics;
const ci = (m) => `${f2(m.roc_auc_ci[0])}–${f2(m.roc_auc_ci[1])}`;
const wet = R.metrics["Infinite slope: soil wetness only"], pfm = R.metrics["Infinite slope: probability of failure"];
const topImp = R.importance.slice(0, 3).map((d) => d.label.replace(/ \(.*\)/, "").toLowerCase());

function draw() {
  document.getElementById("paper").innerHTML = `
  <header>
    <div class="kicker">Research note · v1.0 · ${new Date().getFullYear()}</div>
    <h1>SlopeWatch: explainable early warning of rainfall-triggered landslides from open global data</h1>
    <div class="authors">Swapnil Ray · <a href="${REPO}">source code &amp; data pipeline</a></div>
    <nav class="toc">
      <a href="#s1">1 Introduction</a><a href="#s2">2 Data</a><a href="#s3">3 Method</a>
      <a href="#s4">4 Results</a><a href="#cases">4.5 Case studies</a><a href="#s5">5 Limitations</a><a href="#s6">6 Future work</a><a href="#refs">References</a>
    </nav>
  </header>

  <section class="abstract"><p><b>Abstract.</b>
    Most landslide early-warning systems cover only a few well-instrumented regions. We ask whether
    a model built <i>only</i> from free, global, openly accessible data can tell apart the days and places where
    rainfall-triggered landslides occurred from comparable days and places where they did not.
    We paired ${nPos.toLocaleString()} landslides from NASA's Global Landslide Catalog (${R.n_countries} countries,
    ${R.date_range[0].slice(0, 4)}–${R.date_range[1].slice(0, 4)}) with ${nNeg.toLocaleString()} matched controls. For each case we
    derived five terrain descriptors from a global elevation model and five antecedent-rainfall descriptors
    from ERA5 reanalysis. Under 5-fold <i>spatial</i> cross-validation, where every test region is unseen
    during training, a gradient-boosted tree model reached a ROC-AUC of <b>${f2(main.roc_auc)}</b> (95% CI ${ci(main)}). The widely used
    global rainfall intensity–duration threshold of Guzzetti et al. (2008) reached ${f2(gz.roc_auc)} (${ci(gz)}), a statistically
    significant difference.
    Most of that gain comes from ranking the highest-risk cases better. At the threshold's own false-alarm rate,
    the two methods detect a similar share of landslides (${pct(R.matched.at_guzzetti_false_alarm_rate.hit_rate)} vs ${pct(guz.hit_rate)}).
    The most informative predictors on held-out regions were ${topImp.join(", ")}. We also tested a physically based
    infinite-slope stability model with Monte Carlo reliability analysis. Its rainfall-driven water table alone matched the
    empirical threshold (AUC ${f2(wet.roc_auc)}), but its probability of failure was barely better than chance (${f2(pfm.roc_auc)}).
    Our diagnosis is that global elevation data underestimate slope angles and that cohesion is unknown at global scale.
    In hindcasts of three disasters that occurred after the training period, the event day ranked in the top
    ${Math.ceil(100 - Math.min(...C.events.map((e) => e.event_day.p_percentile)))}% of all days at each site, but only one (${C.events.reduce((a, b) => (a.event_day.p_percentile > b.event_day.p_percentile ? a : b)).name.split(",")[0]})
    stood out clearly; reanalysis rainfall missed the intensity of the other two storms. The model runs entirely in a web browser,
    scores any point on Earth using live rainfall forecasts and explains each prediction.
  </p></section>

  <div class="kpis">
    <div class="kpi"><b>${f2(main.roc_auc)}</b><span>ROC-AUC, spatial cross-validation</span></div>
    <div class="kpi"><b>${f2(gz.roc_auc)}</b><span>ROC-AUC of the Guzzetti (2008) threshold</span></div>
    <div class="kpi"><b>${pct(R.bands[3].landslide_share)}</b><span>of "Very high" cases were real landslides (vs ${pct(R.bands[0].landslide_share)} in "Low")</span></div>
    <div class="kpi"><b>${nPos.toLocaleString()}</b><span>landslides from ${R.n_countries} countries</span></div>
  </div>

  <h2 id="s1">1 · Introduction</h2>
  <p>Rainfall is the most common trigger of landslides worldwide, and landslides kill thousands of people each
  year. Most of those deaths occur in low- and middle-income countries (Froude &amp; Petley, 2018). Operational warning
  systems usually rely on <i>rainfall thresholds</i>, which are empirical curves of rainfall intensity versus
  duration above which slopes tend to fail (Caine, 1980; Guzzetti et al., 2008). A threshold alone ignores
  terrain. The same storm is harmless on a plain and dangerous on a steep, deeply incised slope. Global
  systems such as NASA's LHASA (Kirschbaum &amp; Stanley, 2018) combine both kinds of information but need
  specialised infrastructure.</p>
  <p>This project asks three questions. <b>(Q1)</b> How well can openly available global data discriminate
  landslide occurrence in space <i>and</i> time? <b>(Q2)</b> How much do terrain and antecedent rainfall
  each contribute? <b>(Q3)</b> Does a physically based slope-stability model add anything to a data-driven one?
  <b>(Q4)</b> Can such a model be delivered as a transparent, zero-install tool that
  anyone can audit?</p>

  <h2 id="s2">2 · Data</h2>
  <p><b>Landslide inventory.</b> The NASA Global Landslide Catalog (GLC; Kirschbaum et al., 2010, 2015) lists
  about 11,000 events compiled from news and scientific reports. We kept events that were triggered by
  rain, downpours, continuous rain, monsoons or tropical cyclones, that were located to within 5 km, and
  that occurred in 2007 or later. From 4,904 eligible events we drew a random sample, capping any single
  country at 30% to limit the catalog's strong United States bias.</p>
  <p><b>Case–control design.</b> Each landslide was paired with two controls. A <i>temporal control</i> is the
  <i>same location</i> on a random day 60–700 days away with no catalogued landslide within 25 km and ±10
  days. A <i>spatial control</i> is the <i>same day</i> at a random land point 10–80 km away with no
  catalogued landslide within 5 km and ±10 days. Temporal controls test whether the model understands
  rainfall, and spatial controls test whether it understands terrain. Because controls share the climate and
  season of their case, this design limits confounding by region.</p>
  <p><b>Terrain.</b> We used the AWS Terrain Tiles global elevation model (a fusion of SRTM, Copernicus and national
  DEMs) at zoom 11, about 76 m per pixel at the equator. From it we derived elevation, slope at the point
  (Horn, 1981), mean and 90th-percentile slope within 1 km, and local relief (maximum minus minimum
  elevation) within 2 km. Neighbourhood statistics are used because catalogue locations are uncertain by up to 5 km.</p>
  <p><b>Rainfall.</b> Daily precipitation for the 30 days ending on the event day came from ERA5 reanalysis
  (Hersbach et al., 2020) via the Open-Meteo API. The features are rain on the day and 3-, 7- and
  30-day totals. We also included the <i>antecedent</i> total for days 8–30, a proxy for soil wetness.</p>

  <h2 id="s3">3 · Method</h2>
  <p>We trained a gradient-boosted decision-tree classifier (250 trees of depth 3, learning rate
  0.05, row subsampling 0.8) on the ten features. We compared it with (i) logistic regression on
  log-transformed features, (ii) the same model using only rainfall features and (iii) only terrain features,
  (iv) the Guzzetti et al. (2008) global intensity–duration threshold <i>I</i> = 2.20 <i>D</i><sup>−0.44</sup> applied to
  1-, 3- and 7-day windows, and (v) mean slope alone.</p>
  <p><b>Validation.</b> Landslides cluster in space, so a random train/test split leaks information between
  neighbouring events and inflates scores (Brenning, 2012). We therefore used <b>spatial cross-validation</b>.
  Each landslide and its two controls were assigned to a 5°×5° grid cell (${R.n_spatial_groups} cells in total),
  and the cells were split into five folds. Every score reported here is <i>out-of-fold</i>, meaning it
  comes from a model that never saw that region during training.</p>
  <p><b>Explanations.</b> Each prediction is decomposed into per-feature contributions by following the path
  through every tree and attributing each change in expected value to the splitting feature (Saabas, 2014).
  The contributions sum exactly to the model's log-odds output. This is what the "Why this score?" panel in
  the app shows.</p>
  <p><b>Physically based slope stability.</b> As a mechanistic counterpart to the data-driven model, we computed the
  infinite-slope factor of safety (Skempton &amp; DeLory, 1957; Montgomery &amp; Dietrich, 1994) for a planar slip surface
  at depth <i>z</i>, parallel to a slope of angle β, with seepage parallel to the slope:</p>
  <p style="text-align:center;font-family:var(--serif)"><i>FS</i> = <i>c′</i> / (γ <i>z</i> sin β cos β) + (1 − <i>m</i> γ<sub>w</sub>/γ) tan φ′ / tan β</p>
  <p>Here <i>c′</i> is effective cohesion (including root cohesion), φ′ the effective friction angle, γ the soil unit weight
  and <i>m</i> the height of the water table as a fraction of <i>z</i>. Rainfall raises the water table through a linear
  reservoir with a ${P.tau_days}-day drainage time constant, a simplification of transient infiltration (Iverson, 2000):
  the stored water is <i>S</i> = Σ <i>P</i><sub>t−i</sub> e<sup>−i/τ</sup> and <i>m</i> = min(1, <i>S</i> / (<i>n</i><sub>d</sub> <i>z</i>)), where
  <i>n</i><sub>d</sub> is the drainable porosity. Slope angle β is the steepest 10% of slopes within 1 km, which is the failure-prone part of the
  neighbourhood. Soil properties are not known at global scale, so instead of a single deterministic value we performed a
  <b>reliability analysis</b> (Griffiths &amp; Fenton, 2004). We drew 400 parameter sets from textbook ranges for shallow
  hillslope soils, <i>c′</i> ~ U(1, 10) kPa, φ′ ~ N(32°, 4°), <i>z</i> ~ U(0.5, 2.5) m, γ ~ N(19, 1) kN/m³ and <i>n</i><sub>d</sub> ~ U(0.1, 0.3),
  and report the probability of failure <i>P</i><sub>f</sub> = P(<i>FS</i> &lt; 1). All parameters were fixed <i>a priori</i>; none
  were fitted to the landslide data.</p>
  <p><b>Uncertainty.</b> 95% confidence intervals come from a cluster bootstrap (Efron &amp; Tibshirani, 1993) with 1,000
  replicates that resample whole 5° cells, so the intervals respect spatial dependence. Differences between models are
  tested in the same way: a difference is called significant when its interval excludes zero.</p>
  <p><b>Deployment.</b> The trained trees are exported to JSON and evaluated in JavaScript. Terrain features are
  recomputed in the browser from the same tiles, and the slope-stability model is re-implemented in JavaScript
  with the same Monte Carlo draws. An automated parity test confirms that both match the research code to within 10<sup>−6</sup> (<a href="tests.html">run it here</a>). Live rainfall for the past 40 days and
  the next 7 comes from Open-Meteo's forecast API.</p>

  <h2 id="s4">4 · Results</h2>
  <h3>4.1 Discrimination</h3>
  <div class="table-wrap"><table>
    <thead><tr><th>Model</th><th class="num">ROC-AUC (95% CI)</th><th class="num">PR-AUC</th><th class="num">AUC vs temporal controls</th><th class="num">AUC vs spatial controls</th></tr></thead>
    <tbody>${Object.entries(R.metrics).map(([k, m]) => `<tr class="${k === MAIN ? "best" : ""}"><td>${k}</td><td class="num">${f2(m.roc_auc)} <span class="tiny">(${ci(m)})</span></td><td class="num">${f2(m.pr_auc)}</td><td class="num">${f2(m.auc_vs_temporal)}</td><td class="num">${f2(m.auc_vs_spatial)}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="tiny">All values are out-of-fold under 5-fold spatial cross-validation. PR-AUC baseline (chance) = ${f2(nPos / (nPos + nNeg))}.</p>
  <figure>${rocSvg()}<figcaption><b>Figure 1.</b> ROC curves under spatial cross-validation. The dotted line marks chance.</figcaption></figure>
  <p>${resultsText()}</p>

  <h3>4.2 Which factors matter?</h3>
  <figure>${impSvg()}<figcaption><b>Figure 2.</b> Permutation importance on held-out regions, measured as the drop in out-of-fold ROC-AUC when a feature is shuffled (mean over five spatial folds).
  The rainfall features are strongly correlated with each other, so shuffling one of them understates how much rainfall matters as a group.</figcaption></figure>
  <p>Terrain steepness in the neighbourhood (the steepest 10% and the mean slope within 1 km) ranked highest, followed by
  3- and 7-day rainfall. Slope at the exact catalogue point mattered less than neighbourhood slope. This is consistent
  with catalogue positions being uncertain by up to 5 km.</p>

  <h3>4.3 Physically based slope stability</h3>
  <figure>${pfSvg()}<figcaption><b>Figure 3.</b> Probability of failure P(FS &lt; 1) versus slope angle over the 400 sampled soils, for
  three water-table states. The shaded band is the interquartile range of slope angles at real landslide sites, as measured on the elevation model.</figcaption></figure>
  <p>The mechanics behave as expected. Gentle slopes remain stable even when saturated, while steep slopes approach failure as
  the water table rises (Figure 3). The model's <b>hydrological</b> component is informative. The soil-wetness index alone
  separates landslide days from dry days at the same place with AUC ${f2(wet.auc_vs_temporal)}, the best score on that task of any
  method in this study, and it matches the Guzzetti threshold overall (${f2(wet.roc_auc)} vs ${f2(gz.roc_auc)}). The full
  <b>probability of failure</b>, however, is barely better than chance (AUC ${f2(pfm.roc_auc)}, CI ${ci(pfm)}).</p>
  <p>Two causes explain this. First, <b>slope angles are underestimated</b>. On the ~76 m elevation model, the steepest 10% of
  slopes at real landslide sites have a median of only ${P.landslide_slope_median}° (IQR ${P.landslide_slope_iqr[0]}–${P.landslide_slope_iqr[1]}°),
  whereas shallow landslides typically occur on slopes of 25–45°. Coarse grids smooth out the steep scarps where failures
  start, so the model predicts FS &lt; 1 for only ${pct(P.share_landslides_fs_below_1)} of real landslides
  (and ${pct(P.share_controls_fs_below_1)} of controls). Second, <b>the result is dominated by unknown soil strength</b>. A
  sensitivity analysis on a representative steep, wet slope shows that FS depends most on cohesion:</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Soil parameter</th><th class="num">Rank correlation with FS</th></tr></thead>
    <tbody>${P.sensitivity.map((d) => `<tr><td>${{ c: "Effective cohesion c′", z: "Depth of slip surface z", phi: "Friction angle φ′", nd: "Drainable porosity n<sub>d</sub>", gamma: "Unit weight γ" }[d.param]}</td><td class="num">${d.rho > 0 ? "+" : ""}${d.rho.toFixed(2)}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="tiny">Spearman correlation between each sampled parameter and FS for β = 35° and 150 mm of stored water.</p>
  <p>Cohesion, especially root cohesion, varies by an order of magnitude over short distances and cannot be mapped globally. Finally,
  giving the machine-learning model the physics outputs did not improve it (${Object.entries(P.hybrid).map(([k, m]) => `${k}: AUC ${f2(m.roc_auc)}`).join("; ")}),
  because the physics is computed from the same terrain and rainfall inputs. The lesson is that physically based models need
  <i>local</i> geotechnical data (high-resolution elevation, soil depth, strength from laboratory tests or back-analysis) to beat
  data-driven models. At global scale, their main value is explaining <i>why</i> a slope is at risk.</p>

  <h3>4.4 As a warning rule</h3>
  <div class="table-wrap"><table>
    <thead><tr><th>Rule</th><th class="num">Hit rate</th><th class="num">False-alarm rate</th><th class="num">Precision</th></tr></thead>
    <tbody>${Object.entries(bin).map(([k, b]) => `<tr><td>${k}</td><td class="num">${pct(b.hit_rate)}</td><td class="num">${pct(b.false_alarm_rate)}</td><td class="num">${pct(b.precision)}</td></tr>`).join("")}</tbody>
  </table></div>
  <p>The two rules sit at very different operating points. The Guzzetti threshold is designed as a <i>lower bound</i>, so it
  catches ${pct(guz.hit_rate)} of landslides but also fires on ${pct(guz.false_alarm_rate)} of controls. The model at p ≥ 0.5 is far
  more conservative, catching ${pct(ours.hit_rate)} with ${pct(ours.false_alarm_rate)} false alarms. For a fair comparison, we can
  fix the operating point. At Guzzetti's false-alarm rate the model catches ${pct(R.matched.at_guzzetti_false_alarm_rate.hit_rate)} of
  landslides, and at Guzzetti's hit rate it produces ${pct(R.matched.at_guzzetti_hit_rate.false_alarm_rate)} false alarms. The model is
  <b>only marginally better at that operating point</b>. Its advantage lies at stricter thresholds, where it can issue far
  fewer warnings with much higher precision (${pct(ours.precision)} vs ${pct(guz.precision)}). This is where a warning system
  that people must trust needs to operate.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Risk band</th><th>Index range</th><th class="num">Landslides</th><th class="num">Controls</th><th class="num">Share that were landslides</th></tr></thead>
    <tbody>${R.bands.map((b) => `<tr><td>${b.band}</td><td>${Math.round(b.from * 100)}–${Math.round(b.to * 100)}</td><td class="num">${b.landslides}</td><td class="num">${b.controls}</td><td class="num">${b.landslide_share == null ? "–" : pct(b.landslide_share)}</td></tr>`).join("")}</tbody>
  </table></div>
  <p class="tiny">The share that were landslides rises monotonically across bands, so the bands are ordered correctly.
  In this dataset landslides make up one third of cases by design. In the real world they are far rarer,
  so the index should be read as <i>relative</i> risk and not as a probability.</p>

  <h3 id="cases">4.5 Out-of-sample case studies</h3>
  <p>The catalogue ends in ${R.date_range[1].slice(0, 4)}, so disasters after that are a genuine out-of-sample test. For three
  well-documented events we scored <i>every day</i> from ${C.window[0].slice(0, 4)} to ${C.window[1].slice(0, 4)}
  (${C.events[0].days_scored.toLocaleString()} days) at the affected settlement, using ERA5 rainfall exactly as in training.
  The question is not whether the score crossed 50% but how unusual the disaster day was at that place.
  Because failures often happen at night after a day of rain, we use the higher of the event day and the day before.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Event</th><th class="num">Model p</th><th class="num">Percentile of all days</th><th class="num">Days/yr as high</th>
      <th class="num">Guzzetti ratio</th><th class="num">P<sub>f</sub></th><th class="num">ERA5 rain 1 d / 3 d (mm)</th></tr></thead>
    <tbody>${C.events.map((e) => { const d = e.event_day; return `<tr><td>${e.name}<br><span class="tiny">${e.date} · ${e.place}</span></td>
      <td class="num">${f2(d.p)}</td><td class="num">${d.p_percentile.toFixed(d.p_percentile >= 99.5 ? 2 : 1)}</td><td class="num">${e.days_per_year_at_or_above.toFixed(1)}</td>
      <td class="num">${d.guzzetti_ratio.toFixed(1)}×</td><td class="num">${pct(d.pf)}</td><td class="num">${Math.round(d.r1)} / ${Math.round(d.r3)}</td></tr>`; }).join("")}</tbody>
  </table></div>
  <figure>${C.events.map(caseSvg).join("")}
    <figcaption>Model probability (line) and ERA5 daily rain (bars), 30 days before to 10 days after each event (dashed line).</figcaption></figure>
  <p>The results are mixed, and the reasons are instructive. <b>Atami</b> had several days of extreme, widespread rain that ERA5
  captured well; the event day was among the two highest-scoring days of the decade at that location and would have stood out unambiguously.
  At <b>Wayanad</b> and <b>Petrópolis</b> the scores were elevated but not exceptional: a day at least as high occurs
  ${C.events.filter((e) => e.event_day.p_percentile < 99).map((e) => `${Math.round(e.days_per_year_at_or_above)} times a year at ${e.place}`).join(" and ")}.
  In both cases the trigger was intense, localised rain that a ~30 km reanalysis grid smooths away
  (ERA5 shows only ${C.events.filter((e) => e.event_day.p_percentile < 99).map((e) => `${Math.round(e.event_day.r1)} mm on the day at ${e.place}`).join(" and ")}).
  Rainfall input, not the terrain model, is the main bottleneck: gauge-corrected or radar rainfall would be the first upgrade.
  Three events are anecdotes, not a validation; a systematic hindcast against a post-2017 inventory is listed as future work.</p>

  <h2 id="s5">5 · Limitations</h2>
  <ul>
    <li><b>Reporting bias.</b> The GLC is compiled mainly from English-language media, so it over-represents
      populated areas and some countries (${Object.entries(R.top_countries).slice(0, 3).map(([c, n]) => `${c}: ${n}`).join(", ")} in our sample).
      Remote landslides are missing, and some "controls" may be unreported landslides.</li>
    <li><b>Location and date uncertainty.</b> Positions can be off by up to 5 km and reported dates by a day. Neighbourhood
      terrain statistics and 3-day rain windows reduce, but do not remove, this noise.</li>
    <li><b>Coarse rainfall.</b> ERA5 (~25–30 km) smooths out convective cloudbursts that often trigger debris flows.</li>
    <li><b>Training/deployment mismatch.</b> The model was trained on ERA5 reanalysis, but the app uses forecast-model
      rainfall. Systematic differences between the two may shift scores.</li>
    <li><b>Physics parameters.</b> The slope-stability model uses textbook soil properties and a simple linear-reservoir
      water table rather than site investigations or a full unsaturated-flow model.</li>
    <li><b>Missing predictors.</b> Lithology, soil depth, land cover, deforestation, road cuts and earthquakes are not included.</li>
    <li><b>Not operational.</b> This is a research prototype and must not replace official warnings.</li>
  </ul>

  <h2 id="s6">6 · Future work</h2>
  <ul>
    <li>A systematic hindcast against a post-2017 landslide inventory, extending the three case studies in §4.5, and a test with gauge-corrected
      (e.g. GPM IMERG Final, MSWEP) or radar rainfall in place of ERA5.</li>
    <li>Add soil moisture (SMAP, ERA5-Land), lithology and land-cover predictors, and quantify each one's gain.</li>
    <li>Compare with NASA LHASA, the operational global system.</li>
    <li>Run the slope-stability model with high-resolution elevation data (e.g. 1–5 m lidar) and local soil data, and back-analyse
      the mobilised strength at known failures to calibrate c′ and φ′ regionally.</li>
    <li>Train regional models where dense inventories exist, and study transfer between regions.</li>
    <li>Calibrate probabilities to real-world base rates for operational thresholds.</li>
  </ul>

  <h2>Reproducibility</h2>
  <p>All code, the derived dataset and figures are in the <a href="${REPO}">GitHub repository</a>. Running
  <code>python research/src/build_dataset.py</code>, <code>python research/src/train.py</code> and
  <code>python research/src/case_studies.py</code> regenerates every number on this page.</p>
  <pre class="cite">@software{slopewatch,
  title  = {SlopeWatch: explainable early warning of rainfall-triggered landslides from open global data},
  author = {Ray, Swapnil},
  year   = {${new Date().getFullYear()}},
  url    = {${REPO}}
}</pre>

  <h2 id="refs">References</h2>
  <ul class="tiny" style="font-family:var(--sans)">
    <li>Brenning, A. (2012). Spatial cross-validation and bootstrap for the assessment of prediction rules in remote sensing. <i>IGARSS 2012</i>.</li>
    <li>Caine, N. (1980). The rainfall intensity–duration control of shallow landslides and debris flows. <i>Geografiska Annaler A</i>, 62, 23–27.</li>
    <li>Efron, B., &amp; Tibshirani, R. J. (1993). <i>An Introduction to the Bootstrap</i>. Chapman &amp; Hall.</li>
    <li>Froude, M. J., &amp; Petley, D. N. (2018). Global fatal landslide occurrence from 2004 to 2016. <i>Natural Hazards and Earth System Sciences</i>, 18, 2161–2181.</li>
    <li>Griffiths, D. V., &amp; Fenton, G. A. (2004). Probabilistic slope stability analysis by finite elements. <i>Journal of Geotechnical and Geoenvironmental Engineering</i>, 130(5), 507–518.</li>
    <li>Guzzetti, F., Peruccacci, S., Rossi, M., &amp; Stark, C. P. (2008). The rainfall intensity–duration control of shallow landslides and debris flows: an update. <i>Landslides</i>, 5, 3–17.</li>
    <li>Hersbach, H., et al. (2020). The ERA5 global reanalysis. <i>Quarterly Journal of the Royal Meteorological Society</i>, 146, 1999–2049.</li>
    <li>Horn, B. K. P. (1981). Hill shading and the reflectance map. <i>Proceedings of the IEEE</i>, 69, 14–47.</li>
    <li>Iverson, R. M. (2000). Landslide triggering by rain infiltration. <i>Water Resources Research</i>, 36(7), 1897–1910.</li>
    <li>Kirschbaum, D. B., Adler, R., Hong, Y., Hill, S., &amp; Lerner-Lam, A. (2010). A global landslide catalog for hazard applications. <i>Natural Hazards</i>, 52, 561–575.</li>
    <li>Kirschbaum, D., Stanley, T., &amp; Zhou, Y. (2015). Spatial and temporal analysis of a global landslide catalog. <i>Geomorphology</i>, 249, 4–15.</li>
    <li>Kirschbaum, D., &amp; Stanley, T. (2018). Satellite-based assessment of rainfall-triggered landslide hazard for situational awareness. <i>Earth's Future</i>, 6, 505–523.</li>
    <li>Montgomery, D. R., &amp; Dietrich, W. E. (1994). A physically based model for the topographic control on shallow landsliding. <i>Water Resources Research</i>, 30(4), 1153–1171.</li>
    <li>Saabas, A. (2014). Interpreting random forests. Blog post, datadive.net.</li>
    <li>Skempton, A. W., &amp; DeLory, F. A. (1957). Stability of natural slopes in London Clay. <i>Proc. 4th Int. Conf. on Soil Mechanics and Foundation Engineering</i>, London, 2, 378–381.</li>
  </ul>`;
}

function resultsText() {
  const m = R.metrics;
  const rain = m["Gradient boosting (rainfall only)"], ter = m["Gradient boosting (terrain only)"];
  return `Combining terrain and rainfall outperformed either source alone (rainfall-only AUC ${f2(rain.roc_auc)},
    terrain-only ${f2(ter.roc_auc)}, combined ${f2(main.roc_auc)}). The breakdown by control type shows why. Rainfall separates landslides from
    <i>temporal</i> controls (same place, another day; rainfall-only AUC ${f2(rain.auc_vs_temporal)}), but it cannot separate them from
    <i>spatial</i> controls (${f2(rain.auc_vs_spatial)}), because a landslide and its spatial control share the same regional storm. Terrain shows the
    opposite pattern (${f2(ter.auc_vs_spatial)} vs spatial controls, and exactly 0.50 vs temporal controls, since terrain does not change between days, which is a
    useful sanity check). The combined model keeps most of both (${f2(main.auc_vs_temporal)} and ${f2(main.auc_vs_spatial)}).
    Two results are worth stating plainly. First, on the temporal task alone the simple Guzzetti threshold (${f2(gz.auc_vs_temporal)}) slightly
    <i>beats</i> every learned model, which suggests the physically motivated intensity–duration form captures rainfall timing well.
    Second, adding the Guzzetti exceedance ratio as an eleventh feature did not improve the model (+0.002 AUC), so we kept the simpler model.
    The combined model's advantage over the Guzzetti threshold is statistically significant (difference in AUC, 95% CI
    ${f2(gz.diff_vs_main_ci[0])} to ${f2(gz.diff_vs_main_ci[1])}), but its advantage over logistic regression is not
    (${f2(R.metrics["Logistic regression (all features)"].diff_vs_main_ci[0])} to ${f2(R.metrics["Logistic regression (all features)"].diff_vs_main_ci[1])}),
    so a simple, fully interpretable model does almost as well. Overall discrimination is moderate. An AUC of ${f2(main.roc_auc)} is useful for ranking risk but far from a perfect forecast. That is expected
    given coarse rainfall data and a noisy, news-based inventory (Section 5).`;
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function caseSvg(e) {
  const W = 300, H = 130, pad = 22, s = e.series, n = s.p.length, bw = (W - pad) / n;
  const rmax = Math.max(10, ...s.r1), iev = s.dates.indexOf(e.date);
  const x = (i) => pad + i * bw + bw / 2;
  return `<svg viewBox="0 0 ${W} ${H + 18}" style="width:32%;min-width:240px;display:inline-block" role="img" aria-label="${e.name}">
    <text x="${pad}" y="11" font-size="10" fill="var(--ink-2)">${e.name.split(",")[0]} (${e.date.slice(0, 4)})</text>
    ${s.r1.map((r, i) => `<rect x="${pad + i * bw + 0.5}" y="${H - (r / rmax) * (H - 20)}" width="${Math.max(bw - 1, 1)}" height="${(r / rmax) * (H - 20)}" fill="var(--accent)" opacity="0.45"/>`).join("")}
    <polyline fill="none" stroke="var(--risk-3)" stroke-width="2" points="${s.p.map((p, i) => `${x(i)},${H - p * (H - 20)}`).join(" ")}"/>
    <line x1="${x(iev)}" x2="${x(iev)}" y1="16" y2="${H}" stroke="var(--ink-2)" stroke-dasharray="3 3"/>
    <line x1="${pad}" x2="${W}" y1="${H}" y2="${H}" stroke="var(--line)"/>
    <text x="${pad - 3}" y="${H - (H - 20) + 4}" font-size="8" text-anchor="end" fill="var(--ink-3)">1</text>
    <text x="${pad - 3}" y="${H}" font-size="8" text-anchor="end" fill="var(--ink-3)">0</text>
    <text x="${pad}" y="${H + 12}" font-size="8" fill="var(--ink-3)">${s.dates[0].slice(5)}</text>
    <text x="${W}" y="${H + 12}" font-size="8" text-anchor="end" fill="var(--ink-3)">${s.dates[n - 1].slice(5)}</text></svg>`;
}

function rocSvg() {
  const W = 420, H = 380, p = 44, s = W - p - 12;
  const cols = [css("--accent"), css("--rain"), css("--risk-1"), css("--ink-3")];
  const x = (v) => p + v * s, y = (v) => H - p - v * (H - p - 12);
  const lines = Object.entries(R.roc).map(([k, c], i) =>
    `<polyline fill="none" stroke="${cols[i]}" stroke-width="${i ? 1.6 : 2.6}" points="${c.fpr.map((f, j) => `${x(f)},${y(c.tpr[j])}`).join(" ")}"/>`).join("");
  const leg = Object.keys(R.roc).map((k, i) =>
    `<g transform="translate(${x(0.3)},${y(0.28 - i * 0.065)})"><rect width="12" height="3" y="-4" fill="${cols[i]}"/><text x="18" font-size="11" fill="${css("--ink-2")}">${k.replace(" (all features)", "")} · ${f2(R.metrics[k].roc_auc)}</text></g>`).join("");
  const ticks = [0, 0.5, 1].map((v) => `<text x="${x(v)}" y="${H - p + 16}" text-anchor="middle" font-size="11" fill="${css("--ink-3")}">${v}</text><text x="${p - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${css("--ink-3")}">${v}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:520px;display:block" role="img" aria-label="ROC curves">
    <rect x="${p}" y="12" width="${s}" height="${H - p - 12}" fill="none" stroke="${css("--line")}"/>
    <line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" stroke="${css("--ink-3")}" stroke-dasharray="3 4"/>
    ${lines}${leg}${ticks}
    <text x="${x(0.5)}" y="${H - 6}" text-anchor="middle" font-size="12" fill="${css("--ink-2")}">False-positive rate</text>
    <text transform="translate(12,${y(0.5)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${css("--ink-2")}">True-positive rate</text></svg>`;
}

function pfSvg() {
  const c = P.pf_vs_slope, W = 520, H = 300, p = 46, s0 = c.slopes[0], s1 = c.slopes[c.slopes.length - 1];
  const x = (v) => p + ((v - s0) / (s1 - s0)) * (W - p - 14), y = (v) => H - 36 - v * (H - 52);
  const cols = [css("--risk-0"), css("--risk-1"), css("--risk-3")];
  const [q1, q3] = P.landslide_slope_iqr;
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:620px;display:block" role="img" aria-label="Probability of failure versus slope">
    <rect x="${x(q1)}" y="16" width="${x(q3) - x(q1)}" height="${H - 52}" fill="${css("--ink-3")}" opacity=".13"/>
    <text x="${(x(q1) + x(q3)) / 2}" y="28" text-anchor="middle" font-size="11" fill="${css("--ink-2")}">landslide sites (DEM)</text>
    <line x1="${p}" x2="${W - 14}" y1="${y(0)}" y2="${y(0)}" stroke="${css("--line")}"/>
    ${[0, 0.5, 1].map((v) => `<text x="${p - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${css("--ink-3")}">${v}</text>`).join("")}
    ${[0, 10, 20, 30, 40, 50].map((v) => `<text x="${x(v)}" y="${H - 18}" text-anchor="middle" font-size="11" fill="${css("--ink-3")}">${v}°</text>`).join("")}
    ${Object.entries(c.curves).map(([k, ys], i) => `<polyline fill="none" stroke="${cols[i]}" stroke-width="2.4" points="${ys.map((v, j) => `${x(c.slopes[j])},${y(v)}`).join(" ")}"/>
      <g transform="translate(${p + 12},${44 + i * 18})"><rect width="12" height="3" y="-4" fill="${cols[i]}"/><text x="18" font-size="11" fill="${css("--ink-2")}">${k}</text></g>`).join("")}
    <text x="${(p + W) / 2}" y="${H - 2}" text-anchor="middle" font-size="12" fill="${css("--ink-2")}">Slope angle</text>
    <text transform="translate(12,${y(0.5)}) rotate(-90)" text-anchor="middle" font-size="12" fill="${css("--ink-2")}">P(FS &lt; 1)</text></svg>`;
}

function impSvg() {
  const rows = R.importance, W = 560, rh = 26, lw = 250, H = rows.length * rh + 24;
  const mx = Math.max(...rows.map((r) => r.importance));
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block" role="img" aria-label="Feature importance">
    ${rows.map((r, i) => {
      const w = Math.max(0, (r.importance / mx) * (W - lw - 60));
      const rain = ["r1", "r3", "r7", "r30", "ante"].includes(r.feature);
      return `<text x="${lw - 8}" y="${i * rh + 17}" text-anchor="end" font-size="12" fill="${css("--ink-2")}">${r.label}</text>
        <rect x="${lw}" y="${i * rh + 5}" width="${w}" height="${rh - 10}" rx="3" fill="${rain ? css("--rain") : css("--accent")}"/>
        <text x="${lw + w + 6}" y="${i * rh + 17}" font-size="11" fill="${css("--ink-3")}">${r.importance.toFixed(3)}</text>`;
    }).join("")}
    <text x="${lw}" y="${H - 2}" font-size="11" fill="${css("--ink-3")}"><tspan fill="${css("--accent")}">■</tspan> terrain  <tspan fill="${css("--rain")}">■</tspan> rainfall</text></svg>`;
}

draw();
