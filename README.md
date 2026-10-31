# SlopeWatch: explainable landslide early warning

**Click any point on Earth and get a 14-day, explainable risk outlook for rainfall-triggered landslides.
It runs entirely in your browser.**

🌍 **Live demo:** https://swapnil11801.github.io/landslide-early-warning/ &nbsp;·&nbsp;
📄 **Research note:** [research.html](https://swapnil11801.github.io/landslide-early-warning/research.html)

![ROC curves](research/figures/roc.png)

## What it does

1. **Terrain.** It reads global elevation tiles (AWS Terrain Tiles) and computes slope and local relief around the point in the browser.
2. **Rainfall.** It fetches the past 40 days of daily rainfall and the 7-day forecast (Open-Meteo).
3. **Model.** A gradient-boosted tree model trained on NASA's Global Landslide Catalog scores every day from a week ago to six days ahead.
4. **Explanation.** Each score is broken down into the contribution of each factor ("Why this score?").
5. **Scenarios.** A what-if slider shows how much extra rain the slope can take before the risk level changes.
6. **Area scan.** It scores a 10×10 grid over the visible map for today or any forecast day.

It needs no backend and no API keys. The whole app is static files served by GitHub Pages.

## Results (5-fold spatial cross-validation)

| Model | ROC-AUC | vs temporal controls | vs spatial controls |
|---|---:|---:|---:|
| **Gradient boosting (all features)** | **0.73** | 0.81 | 0.64 |
| Logistic regression (all features) | 0.72 | 0.81 | 0.63 |
| Gradient boosting (rainfall only) | 0.67 | 0.82 | 0.51 |
| Gradient boosting (terrain only) | 0.60 | 0.50 | 0.70 |
| Guzzetti 2008 rainfall threshold | 0.68 | 0.84 | 0.53 |
| Mean slope only | 0.51 | 0.50 | 0.52 |

The dataset contains 1,097 rain-triggered landslides from 72 countries with 2,171 matched controls, split into 181 spatial blocks.

In short, combining terrain and rainfall beats either alone and beats the Guzzetti (2008) global rainfall threshold on ROC-AUC.
At the threshold's own false-alarm rate, however, the two methods catch a similar share of landslides (81% vs 80%).
The model's advantage lies in high-confidence, low-false-alarm warnings. The research page discusses this honestly.

The full methods, results and limitations are on the [Research page](web/research.html).

## Repository layout

```
web/                  static web app (published to the gh-pages branch)
  js/terrain.js       slope/relief from elevation tiles; mirrors research/src/terrain.py
  js/model.js         tree-ensemble inference + per-feature attributions
  js/weather.js       Open-Meteo rainfall + geocoding
  model/              exported model, results, parity reference values
  tests.html          browser <-> Python parity test (open it in a browser)
research/
  src/build_dataset.py   case-control dataset from NASA GLC + terrain + ERA5 rainfall
  src/train.py           spatial CV, baselines, importance, export to web/model/
  data/dataset.csv       the derived dataset (raw downloads are git-ignored)
  figures/               figures for the paper
```

## Reproduce

```bash
pip install -r research/requirements.txt
python research/src/build_dataset.py   # ~1 h: downloads the catalog, elevation tiles, ERA5 rainfall (cached, resumable)
python research/src/train.py           # spatial CV + exports web/model/model.json and results.json
python research/src/make_parity.py     # reference values for web/tests.html
python -m http.server -d web 8000      # then open http://localhost:8000
```

## Deploy

The live site is served by GitHub Pages from the `gh-pages` branch, which mirrors the `web/` folder:

```bash
git subtree split --prefix web -b gh-pages && git push -f origin gh-pages
```

## Data sources and credits

- NASA Global Landslide Catalog: Kirschbaum et al. (2010, 2015). NASA Open Data Portal.
- ERA5 reanalysis (Copernicus Climate Change Service) and weather forecasts, via [Open-Meteo](https://open-meteo.com) (CC BY 4.0).
- Elevation: [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), derived from SRTM, GMTED, ETOPO1 and national DEMs.
- Basemaps: OpenTopoMap, Esri World Imagery and CARTO / OpenStreetMap contributors.

## Disclaimer

This is a research prototype and **not** an official warning service. In an emergency, follow your local authorities.

## License

MIT. See [LICENSE](LICENSE). Cite with [CITATION.cff](CITATION.cff).
