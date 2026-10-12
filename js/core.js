// Pure logic: dates, weight trend, adaptive expenditure, targets, food parsing.
// No DOM / storage access so it can be unit-tested with `node --test`.

export const KCAL_PER_KG = 7700;
export const LB_PER_KG = 2.20462262;

// ---------- dates (local calendar days as 'YYYY-MM-DD') ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return dayStr(d); };
export const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);

// ---------- nutrients ----------
export const ZERO = Object.freeze({ cal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
export const scale = (n, f) => ({ cal: n.cal * f, protein: n.protein * f, carbs: n.carbs * f, fat: n.fat * f, fiber: (n.fiber || 0) * f });
export const sum = (list) => list.reduce((a, n) => ({
  cal: a.cal + n.cal, protein: a.protein + n.protein, carbs: a.carbs + n.carbs, fat: a.fat + n.fat, fiber: a.fiber + (n.fiber || 0),
}), { ...ZERO });
/** Nutrients for `grams` of a food whose `per100` is per 100 g. */
export const forGrams = (per100, grams) => scale(per100, grams / 100);

// ---------- weight trend ----------
/**
 * Exponentially smoothed weight trend. `weights` is [{day, kg}] (one per day).
 * Gaps are handled by compounding the smoothing factor over the elapsed days.
 * Returns [{day, kg, trend}] for each measured day, sorted.
 */
export function trendSeries(weights, alpha = 0.1) {
  const sorted = [...weights].sort((a, b) => a.day.localeCompare(b.day));
  const out = [];
  let trend = null, prev = null;
  for (const w of sorted) {
    if (trend === null) trend = w.kg;
    else {
      const gap = Math.max(1, daysBetween(prev, w.day));
      const a = 1 - Math.pow(1 - alpha, gap);
      trend += a * (w.kg - trend);
    }
    prev = w.day;
    out.push({ day: w.day, kg: w.kg, trend });
  }
  return out;
}

/** Weekly rate of change of the trend (kg/week) over the last `days`, or null. */
export function weeklyRate(series, days = 14) {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const start = addDays(last.day, -days);
  const first = series.find((p) => p.day >= start) || series[0];
  const span = daysBetween(first.day, last.day);
  if (span < 5) return null;
  return ((last.trend - first.trend) / span) * 7;
}

// ---------- expenditure ----------
export const ACTIVITY = {
  sedentary: { label: 'Sedentary (desk job, little exercise)', factor: 1.2 },
  light: { label: 'Light (1-3 workouts/week)', factor: 1.375 },
  moderate: { label: 'Moderate (3-5 workouts/week)', factor: 1.55 },
  high: { label: 'High (6-7 workouts/week)', factor: 1.725 },
  extreme: { label: 'Extreme (physical job + training)', factor: 1.9 },
};

/** Mifflin-St Jeor BMR times activity factor. */
export function formulaTdee({ sex, weightKg, heightCm, age, activity }) {
  const bmr = 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === 'male' ? 5 : -161);
  return bmr * (ACTIVITY[activity]?.factor ?? 1.375);
}

/**
 * Adaptive expenditure: average intake minus the energy implied by the change in
 * trend weight, blended with the formula estimate while data is sparse.
 * `intakeByDay` is {day: kcal} (only days with food logged); `today` is excluded
 * because it is usually incomplete.
 */
export function estimateExpenditure({ intakeByDay, weights, formula, today, windowDays = 28 }) {
  const fallback = { kcal: formula, source: 'formula', weight: 0, loggedDays: 0, spanDays: 0 };
  const winStart = addDays(today, -windowDays);
  const series = trendSeries(weights).filter((p) => p.day >= winStart && p.day < today);
  if (series.length < 2) return fallback;
  const first = series[0], last = series[series.length - 1];
  const spanDays = daysBetween(first.day, last.day);
  if (spanDays < 7) return fallback;
  let total = 0, loggedDays = 0;
  for (let d = first.day; d <= last.day; d = addDays(d, 1)) {
    const k = intakeByDay[d];
    if (k > 0) { total += k; loggedDays++; }
  }
  if (loggedDays < 5) return fallback;
  const avgIntake = total / loggedDays;
  const adaptive = avgIntake - ((last.trend - first.trend) * KCAL_PER_KG) / spanDays;
  const weight = Math.min(1, loggedDays / 14) * Math.min(1, spanDays / 14);
  const kcal = Math.min(6000, Math.max(1000, weight * adaptive + (1 - weight) * formula));
  return { kcal, source: weight >= 0.95 ? 'adaptive' : 'blended', weight, loggedDays, spanDays };
}

// ---------- targets ----------
/**
 * Daily targets from expenditure and goal. `rateKgPerWeek` is negative to lose.
 * Protein is g/kg bodyweight, fat is a fraction of calories, carbs fill the rest.
 */
export function computeTargets({ tdee, rateKgPerWeek, weightKg, proteinPerKg = 2.0, fatPct = 0.3, minCal = 1200 }) {
  const cal = Math.max(minCal, tdee + (rateKgPerWeek * KCAL_PER_KG) / 7);
  const protein = proteinPerKg * weightKg;
  const fat = (fatPct * cal) / 9;
  const carbs = Math.max(0, (cal - protein * 4 - fat * 9) / 4);
  return { cal, protein, carbs, fat, fiber: 0 };
}

// ---------- unit helpers ----------
export const kgToDisplay = (kg, useLb) => (useLb ? kg * LB_PER_KG : kg);
export const displayToKg = (v, useLb) => (useLb ? v / LB_PER_KG : v);

// ---------- food parsing ----------
const num = (v) => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : 0; };
const uid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** Normalize an Open Food Facts product object into our food shape (per 100 g). */
export function parseOpenFoodFactsProduct(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let cal = num(n['energy-kcal_100g']);
  if (!cal && n.energy_100g) cal = num(n.energy_100g) / 4.184; // kJ fallback
  const name = (p.product_name || '').trim();
  if (!name) return null;
  const serving = num(p.serving_quantity);
  return {
    id: uid(), source: 'off', name,
    brand: (p.brands || '').split(',')[0].trim(),
    barcode: p.code || null,
    per100: { cal, protein: num(n.proteins_100g), carbs: num(n.carbohydrates_100g), fat: num(n.fat_100g), fiber: num(n.fiber_100g) },
    servingG: serving > 0 ? serving : 100,
    servingLabel: p.serving_size || (serving > 0 ? `${serving} g` : '100 g'),
  };
}

const USDA_IDS = { cal: 1008, protein: 1003, carbs: 1005, fat: 1004, fiber: 1079 };

/** Normalize a USDA FoodData Central search hit into our food shape (per 100 g). */
export function parseUsdaFood(f) {
  if (!f?.description) return null;
  const byId = {};
  for (const fn of f.foodNutrients || []) byId[fn.nutrientId ?? fn.nutrient?.id] = fn.value ?? fn.amount;
  let cal = num(byId[USDA_IDS.cal]);
  if (!cal && byId[2047]) cal = num(byId[2047]); // Atwater general factors
  if (!cal && byId[2048]) cal = num(byId[2048]);
  const unit = (f.servingSizeUnit || '').toLowerCase();
  const serving = (unit === 'g' || unit === 'ml') ? num(f.servingSize) : 0;
  const title = f.description.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    id: uid(), source: 'usda', name: title,
    brand: (f.brandName || f.brandOwner || '').trim(),
    barcode: f.gtinUpc || null,
    per100: { cal, protein: num(byId[USDA_IDS.protein]), carbs: num(byId[USDA_IDS.carbs]), fat: num(byId[USDA_IDS.fat]), fiber: num(byId[USDA_IDS.fiber]) },
    servingG: serving > 0 ? serving : 100,
    servingLabel: f.householdServingFullText || (serving > 0 ? `${serving} g` : '100 g'),
  };
}

/** Build a recipe food from ingredients [{name, grams, per100}] and cooked weight. */
export function recipePer100(ingredients, cookedWeightG) {
  const total = sum(ingredients.map((i) => forGrams(i.per100, i.grams)));
  const rawG = ingredients.reduce((a, i) => a + i.grams, 0);
  const weight = cookedWeightG > 0 ? cookedWeightG : rawG;
  return { total, weight, per100: weight > 0 ? scale(total, 100 / weight) : { ...ZERO } };
}
