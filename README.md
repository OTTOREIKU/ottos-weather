# OTTO's Weather

A weather app that doesn't trust any single forecast. It pulls **8 genuinely independent
forecast models** (ECMWF, GFS, ICON, ARPEGE, UKMO, JMA, GEM, CMA) in one Open-Meteo request,
then shows the **mean and the spread**. When the models agree the number is solid, and
when they diverge you can see exactly how much.

## Features

- **Current conditions**: mean across models with an agreement badge (models agree /
  some disagreement / models diverge), the min–max range, feels like, humidity, wind,
  dew point, pressure, and sunrise/sunset
- **Model breakdown**: each model's current reading with its deviation from the mean
- **Hourly chart**: per-model temperature lines, bold mean, spread band, and mean
  precipitation bars; flip between 12, 24, and 48 hours, hover or drag to read any hour
- **8-day outlook**: daily hi/lo means with the hi span, consensus condition, and rain
  as model agreement ("5/8 · 2.3 mm"); tap any day for its full hourly breakdown
- **Animated radar**: past 2 hours of RainViewer tiles on a dark map, plus about 40
  minutes of future frames the app estimates itself by tracking storm motion across
  recent frames (RainViewer shut down their forecast tiles, so we built our own)
- **NWS alerts**: official National Weather Service watches and warnings for the
  selected location, tap to expand
- **Rain soon**: 15-minute resolution "rain expected around 3:40 PM" readout for
  the next couple of hours
- **Installable PWA**: add it to your home screen and it opens like a real app,
  loads instantly, no browser chrome
- Location search, browser geolocation, favorites, °F/°C toggle, and a refresh button
  with optional auto refresh: all remembered between visits
- Rain probability is computed as **model agreement** (share of models predicting
  precipitation), not a single model's percentage

## Accuracy scoring

A scheduled GitHub Action snapshots every model's 1, 2, and 3 day ahead forecasts each
day for the locations in `public/data/locations.json`, then verifies them against observed
conditions once each day has passed. Running scores live in `public/data/scores.json` and
power the Model Scorecard in the app: average temperature error, rain hit rate, and
whether each model tends to run hot or cold.

Once a model has 14+ verified days, the app starts weighting the mean toward the models
with the best track record and correcting each model's known temperature bias before
averaging. Scores are also kept per location, so over time the app learns which models
are actually good for your area, not just on average. Both behaviors have toggles in the
scorecard if you'd rather see the plain mean.

Edit `public/data/locations.json` to change which locations get scored.

No API keys, no server. Everything is fetched client-side from free, keyless APIs, and the
scoring data is stored in the repo itself by the workflow.

## Data sources

- Forecasts & geocoding: [Open-Meteo](https://open-meteo.com/) (free, non-commercial)
- Alerts: [National Weather Service](https://www.weather.gov/documentation/services-web-api)
- Radar: [RainViewer](https://www.rainviewer.com/api.html) public API
- Basemap: © OpenStreetMap contributors, © CARTO
