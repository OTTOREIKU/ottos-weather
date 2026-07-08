# Weather Aggregator — Project Plan

## The idea
A personal webapp that pulls weather for a searched location from multiple sources, averages the results, and shows the spread — to get a better read than any single weather app/site that always seems slightly off.

## Key decisions & insights

**Use APIs, not scraping.** The weather sites you look at pull their data from APIs anyway. Scraping HTML is fragile (layout changes, bot-blocking, ToS issues). Hitting APIs directly with a lat/long returns clean JSON.

**Averaging is subtler than it looks.** Many weather sites trace back to the *same* underlying models (mostly NOAA GFS and ECMWF). Averaging five sites that all use ECMWF = one opinion five times, not five independent opinions. For a meaningful average, pull from genuinely *different* models.

**Show the spread, not just the mean.** When models agree, the average is solid. When they diverge, the mean can land in a "valley" nobody predicted. Displaying the range (e.g. "68°F, models span 64–72°") is often more useful than a single blended number — the spread is basically a confidence signal.

## Chosen approach
Since this is personal use only (no free-tier limits to worry about), **Open-Meteo alone gets most of the way there**:
- Free, no API key required
- Exposes 30+ models (ECMWF, NOAA/GFS, DWD, Météo-France, JMA, etc.)
- Can query multiple individual models in a **single request** and average *those* directly — genuine model diversity without juggling multiple API keys
- Up to 10,000 calls/day free for non-commercial use

Optional later: add OpenWeatherMap (own proprietary model), WeatherAPI.com, or Visual Crossing for even more independent sources — each needs its own key.

## Architecture
```
location search string
      ↓
geocode → lat/long   (Open-Meteo has a free geocoding endpoint)
      ↓
fan out request(s) → pull several models from Open-Meteo
      ↓
normalize units
      ↓
compute mean + spread (min/max, std dev)
      ↓
display: per-model temps, average, and range
```

## Build notes
- Can be **purely client-side** (single HTML/JS file) since Open-Meteo needs no key and allows browser requests — easy to run locally or host anywhere.
- Open-Meteo forecast endpoint: `https://api.open-meteo.com/v1/forecast`
  - Select specific models via the `models=` parameter to compare/average them
  - Geocoding endpoint: `https://geocoding-api.open-meteo.com/v1/search`
- Suggested v1 display: current temp per model, the average, and the min–max spread. Add hourly/daily and other variables (humidity, wind, precip) later.

## Next step
Come back to Claude when at the desktop and ask it to scaffold the single-file webapp (client-side, Open-Meteo). Decide then whether v1 is current-conditions only or includes an hourly/daily forecast view.
