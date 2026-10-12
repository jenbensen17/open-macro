# Open Macro

A personal, MacroFactor-style nutrition tracker that runs on your iPhone as a PWA — no Mac, App Store, or developer account needed. All data stays on your device.

## Features

- **Food diary** — meals, calorie ring and macro bars against daily targets, copy meals from yesterday
- **Food search** — Open Food Facts and USDA FoodData Central
- **Barcode scanning** — rear camera via ZXing, with Open Food Facts then USDA lookup, plus manual entry
- **Custom foods, recipes, quick add** — recipes support cooked weight and servings
- **Weight trend** — exponentially smoothed trend line that filters out daily noise
- **Adaptive expenditure and targets** — estimates your TDEE from intake and trend-weight change, blends it with a formula estimate while data is sparse, and sets calories and macros for your goal rate
- **Kitchen** (pantry & meal planning, à la Pantry Persona):
  - **Pantry** — items by category with auto-estimated expiry, "use soon" alerts, always-on-hand staples, leftovers, clear expired
  - **Receipts** — type or paste `milk 3.99, eggs 4.50` lines; stocks the pantry, records prices, and checks off matching shopping items
  - **Recipes** — paste recipe text to import, ingredients/steps/tags, ratings, collections, ingredient swaps saved as variants, share; per-serving macros entered or estimated from your food library
  - **"I cooked this"** — logs servings to the diary, deducts ingredients from the pantry, saves leftovers, tracks times cooked
  - **Filters** — can-make-now (pantry coverage), quickest / top rated / most cooked, collections, and "safe for" a household member
  - **Meal plan** — weekly breakfast/lunch/dinner/snack grid with recipes or free text, sides, move/swap/copy, planned vs target calories, log a planned meal, day themes
  - **Shopping lists** — multiple stores, grouped by aisle, quantities merged, staples auto re-added, bought items into pantry, generate from the meal plan or a recipe minus what's in the pantry, share as text
  - **Household profiles** — diets (vegetarian, vegan, keto, gluten-free…), allergies and dislikes flag conflicting recipes
  - **Insights** — weekly nutrition averages vs targets, on-target hit rate, biggest shortfalls, spending by period/store/item, restock predictions
- **Backup/restore** (JSON, includes everything) and CSV export
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

Not included from Pantry Persona: importing a recipe straight from a URL (browsers block cross-site page fetches — paste the text instead), receipt photo OCR, Instacart export, and the AI chat features.

Targets are recalculated continuously from your recent data rather than in weekly steps. This is a personal tool, not medical advice.

## Development

No build step — plain ES modules.

```sh
npm test          # unit tests for the pure logic (node --test)
npm run serve     # http://localhost:8080
```

- `js/core.js` — pure logic (trend, expenditure, targets, food parsing)
- `js/db.js` — IndexedDB storage
- `js/api.js` — Open Food Facts / USDA clients
- `js/scanner.js` — barcode scanning
- `js/kitchen-core.js` — pure kitchen logic (categories, parsing, pantry matching, shopping generation, insights)
- `js/kitchen.js` — Kitchen UI
- `js/app.js` — app shell, diary, weight, foods, settings
- `vendor/zxing.min.js` — [@zxing/library](https://github.com/zxing-js/library) 0.21.3 (Apache-2.0)

When you change cached files, bump `CACHE` in `sw.js` so installed copies update.
