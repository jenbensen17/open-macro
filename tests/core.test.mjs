import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, trendSeries, weeklyRate, formulaTdee, estimateExpenditure,
  computeTargets, parseOpenFoodFactsProduct, parseUsdaFood, recipePer100, forGrams,
} from '../js/core.js';

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

test('date helpers handle month boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-01-01', '2026-01-15'), 14);
});

test('trend smooths noise and starts at first weight', () => {
  const w = [80, 81, 79, 80.5, 79.5].map((kg, i) => ({ day: addDays('2026-01-01', i), kg }));
  const s = trendSeries(w);
  assert.equal(s[0].trend, 80);
  assert.ok(Math.abs(s[4].trend - 80) < 0.5);
});

test('weeklyRate reports loss as negative', () => {
  const w = Array.from({ length: 21 }, (_, i) => ({ day: addDays('2026-01-01', i), kg: 90 - i * (0.5 / 7) }));
  near(weeklyRate(trendSeries(w, 0.3), 14), -0.5, 0.1);
});

test('formula TDEE matches Mifflin-St Jeor', () => {
  // 80 kg, 180 cm, 30y male: BMR = 800+1125-150+5 = 1780; x1.55 = 2759
  near(formulaTdee({ sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate' }), 2759, 1);
});

test('adaptive expenditure recovers true TDEE from intake and weight change', () => {
  // True TDEE 2500, eating 2000/day -> loses 500*7/7700 kg/week
  const start = '2026-01-01', today = addDays(start, 70);
  const perDay = 500 / 7700;
  const weights = [], intakeByDay = {};
  for (let i = 0; i < 70; i++) {
    weights.push({ day: addDays(start, i), kg: 85 - i * perDay });
    intakeByDay[addDays(start, i)] = 2000;
  }
  const est = estimateExpenditure({ intakeByDay, weights, formula: 3000, today });
  assert.equal(est.source, 'adaptive');
  near(est.kcal, 2500, 60);
});

test('falls back to formula with too little data', () => {
  const est = estimateExpenditure({ intakeByDay: { '2026-01-01': 2000 }, weights: [{ day: '2026-01-01', kg: 80 }], formula: 2600, today: '2026-01-05' });
  assert.equal(est.source, 'formula');
  assert.equal(est.kcal, 2600);
});

test('targets: deficit, macro split sums to calories', () => {
  const t = computeTargets({ tdee: 2500, rateKgPerWeek: -0.5, weightKg: 80, proteinPerKg: 2, fatPct: 0.3 });
  near(t.cal, 2500 - 550, 1);
  near(t.protein * 4 + t.carbs * 4 + t.fat * 9, t.cal, 1);
  near(t.protein, 160, 0.01);
});

test('targets respect calorie floor', () => {
  assert.equal(computeTargets({ tdee: 1300, rateKgPerWeek: -1, weightKg: 60 }).cal, 1200);
});

test('Open Food Facts parsing, incl. kJ fallback', () => {
  const f = parseOpenFoodFactsProduct({
    code: '123', product_name: 'Oats', brands: 'Acme, Other', serving_quantity: '40',
    nutriments: { 'energy-kcal_100g': 370, proteins_100g: '13', carbohydrates_100g: 60, fat_100g: 7, fiber_100g: 10 },
  });
  assert.equal(f.brand, 'Acme');
  assert.equal(f.per100.cal, 370);
  assert.equal(f.per100.protein, 13);
  assert.equal(f.servingG, 40);
  const kj = parseOpenFoodFactsProduct({ product_name: 'X', nutriments: { energy_100g: 418.4 } });
  near(kj.per100.cal, 100, 0.01);
  assert.equal(parseOpenFoodFactsProduct({ nutriments: {} }), null);
});

test('USDA parsing', () => {
  const f = parseUsdaFood({
    description: 'BANANAS, RAW', foodNutrients: [
      { nutrientId: 1008, value: 89 }, { nutrientId: 1003, value: 1.09 }, { nutrientId: 1005, value: 22.8 }, { nutrientId: 1004, value: 0.33 },
    ],
  });
  assert.equal(f.name, 'Bananas, Raw');
  assert.equal(f.per100.cal, 89);
  assert.equal(f.servingG, 100);
});

test('recipe per-100g uses cooked weight when given', () => {
  const ings = [{ name: 'Rice', grams: 200, per100: { cal: 130, protein: 3, carbs: 28, fat: 0.3, fiber: 0 } }];
  const r = recipePer100(ings, 600);
  near(r.total.cal, 260, 0.01);
  near(r.per100.cal, 260 / 6, 0.01);
  near(forGrams(r.per100, 600).cal, 260, 0.01);
});
