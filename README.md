# Open Macro

A personal, MacroFactor-style nutrition tracker that runs on your iPhone as a PWA — no Mac, App Store, or developer account needed. All data stays on your device.

## Features

- **Food diary** — meals, calorie ring and macro bars against daily targets, copy meals from yesterday
- **Food search** — Open Food Facts and USDA FoodData Central
- **Barcode scanning** — rear camera via ZXing, with Open Food Facts then USDA lookup, plus manual entry
- **Custom foods, recipes, quick add** — recipes support cooked weight and servings
- **Weight trend** — exponentially smoothed trend line that filters out daily noise
- **Adaptive expenditure and targets** — estimates your TDEE from intake and trend-weight change, blends it with a formula estimate while data is sparse, and sets calories and macros for your goal rate
- **Backup/restore** (JSON) and CSV export
- Works offline after the first load

## Install on your iPhone

The app has to be served over HTTPS (the camera won't work otherwise). Easiest options:

**GitHub Pages** — repo *Settings → Pages → Deploy from a branch*, pick the branch and `/ (root)`. (Pages needs a public repo on the free plan; the app contains no personal data.)

**Private alternative** — drag this folder onto [Netlify Drop](https://app.netlify.com/drop) or deploy it with Cloudflare Pages.

Then on your iPhone, open the URL in **Safari → Share → Add to Home Screen**. Use the home-screen icon from then on; iOS keeps data for installed web apps much more reliably than for Safari tabs. Back up from *Settings → Data* now and then.

## Using it

1. On first launch enter your profile and current weight.
2. Log food every day and weigh in regularly (daily is best). After about two weeks the app switches from a formula estimate to *your* measured expenditure.
3. Optional: get a free [USDA API key](https://fdc.nal.usda.gov/api-key.html) and paste it in Settings (the default `DEMO_KEY` is rate-limited).

## How the numbers work

- Trend weight: `trend += (1 − 0.9^gap) · (weight − trend)` per weigh-in.
- Expenditure = average logged intake − (Δ trend weight × 7700 kcal/kg) ÷ days, over the last 28 days (today excluded). Needs ≥ 7 days between weigh-ins and ≥ 5 logged days; blended with Mifflin-St Jeor × activity until ~14 days of data.
- Target calories = expenditure + goal rate × 7700 ÷ 7 (never below 1200). Protein is g per kg of trend weight, fat is a % of calories, carbs fill the rest.

Targets are recalculated continuously from your recent data rather than in weekly steps. This is a personal tool, not medical advice.

## Development

No build step — plain ES modules.

```sh
npm test          # unit tests for js/core.js (node --test)
npm run serve     # http://localhost:8080
```

- `js/core.js` — pure logic (trend, expenditure, targets, food parsing)
- `js/db.js` — IndexedDB storage
- `js/api.js` — Open Food Facts / USDA clients
- `js/scanner.js` — barcode scanning
- `js/app.js` — UI
- `vendor/zxing.min.js` — [@zxing/library](https://github.com/zxing-js/library) 0.21.3 (Apache-2.0)

When you change cached files, bump `CACHE` in `sw.js` so installed copies update.
