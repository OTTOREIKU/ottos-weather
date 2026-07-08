# Weather Aggregator

A weather app that doesn't trust any single forecast. It pulls **7 genuinely independent
forecast models** (ECMWF, GFS, ICON, ARPEGE, UKMO, JMA, GEM) in one Open-Meteo request,
then shows the **mean and the spread** — when the models agree the number is solid, and
when they diverge you can see exactly how much.

## Features

- **Current conditions** — mean across models with an agreement badge (models agree /
  some disagreement / models diverge) and the min–max range
- **Model breakdown** — each model's current reading with its deviation from the mean
- **48-hour chart** — per-model temperature lines, bold mean, spread band, and mean
  precipitation bars; hover for per-model values at any hour
- **8-day outlook** — daily hi/lo means with the hi span, consensus condition, and rain
  as model agreement ("5/7 · 2.3 mm")
- **Animated radar** — RainViewer tiles on a dark Leaflet map: past 2 hours plus
  short-term nowcast, play/pause and scrubber
- Location search (Open-Meteo geocoding), browser geolocation, saved locations,
  °F/°C toggle — all persisted in localStorage
- Rain probability is computed as **model agreement** (share of models predicting
  precipitation), not a single model's percentage

The app also silently logs each day's per-model forecasts to localStorage — groundwork
for a future accuracy scoreboard (compare forecasts against observed history and weight
models by how well they perform for your location).

No API keys, no backend — everything is fetched client-side from free, keyless APIs.

## Data sources

- Forecasts & geocoding: [Open-Meteo](https://open-meteo.com/) (free, non-commercial)
- Radar: [RainViewer](https://www.rainviewer.com/api.html) public API
- Basemap: © OpenStreetMap contributors, © CARTO
