# Weather Aggregator

A weather app that doesn't trust any single forecast. It pulls **8 genuinely independent
forecast models** (ECMWF, GFS, ICON, ARPEGE, UKMO, JMA, GEM, CMA) in one Open-Meteo request,
then shows the **mean and the spread**. When the models agree the number is solid, and
when they diverge you can see exactly how much.

## Features

- **Current conditions**: mean across models with an agreement badge (models agree /
  some disagreement / models diverge) and the min–max range
- **Model breakdown**: each model's current reading with its deviation from the mean
- **48-hour chart**: per-model temperature lines, bold mean, spread band, and mean
  precipitation bars; hover for per-model values at any hour
- **8-day outlook**: daily hi/lo means with the hi span, consensus condition, and rain
  as model agreement ("5/7 · 2.3 mm")
- **Animated radar**: RainViewer tiles on a dark Leaflet map: past 2 hours plus
  short-term nowcast, play/pause and scrubber
- Location search (Open-Meteo geocoding), browser geolocation, saved locations,
  °F/°C toggle: all persisted in localStorage
- Rain probability is computed as **model agreement** (share of models predicting
  precipitation), not a single model's percentage
- **NWS alerts**: official National Weather Service watches and warnings for the
  selected location, tap to expand
- **Rain soon**: 15-minute resolution "rain expected around 3:40 PM" readout for
  the next couple of hours
- **Installable PWA**: add to home screen on mobile, loads instantly, works as an app

## Accuracy scoring

A scheduled GitHub Action (daily) snapshots every model's 1, 2, and 3 day ahead forecasts
for the locations in `public/data/locations.json`, then verifies them against observed
conditions once each day has passed. Running scores live in `public/data/scores.json` and
power the Model Scorecard in the app: average temperature error and rain hit rate per model.
Once every model has 14+ verified days, the app can weight the forecast mean toward the
models with the best track record (toggle in the scorecard).

Edit `public/data/locations.json` to change which locations get scored.

No API keys, no server. Everything is fetched client-side from free, keyless APIs, and the
scoring data is stored in the repo itself by the workflow.

## Data sources

- Forecasts & geocoding: [Open-Meteo](https://open-meteo.com/) (free, non-commercial)
- Radar: [RainViewer](https://www.rainviewer.com/api.html) public API
- Basemap: © OpenStreetMap contributors, © CARTO
