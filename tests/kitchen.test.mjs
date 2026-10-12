import test from 'node:test';
import assert from 'node:assert/strict';
import {
  categorize, defaultExpiry, expiryStatus, namesMatch, parseIngredient, parseRecipeText, estimateRecipeMacros,
  recipeConflicts, planDeduction, pantryCoverage, shoppingFromPlan, parseReceiptText, spendingSummary,
  restockPredictions, nutritionTrends, normUnit, toGrams,
} from '../js/kitchen-core.js';

const near = (a, b, t = 0.01) => assert.ok(Math.abs(a - b) <= t, `${a} !~ ${b}`);

test('categorize', () => {
  assert.equal(categorize('Chicken breast'), 'meat');
  assert.equal(categorize('whole milk'), 'dairy');
  assert.equal(categorize('Frozen peas'), 'frozen');
  assert.equal(categorize('bell pepper'), 'vegetables');
  assert.equal(categorize('black pepper'), 'condiments_spices');
  assert.equal(categorize('tomato sauce'), 'canned');
  assert.equal(categorize('widget'), 'other');
});

test('expiry defaults and status', () => {
  assert.equal(defaultExpiry('dairy', '2026-01-01'), '2026-01-11');
  assert.equal(defaultExpiry('canned', '2026-01-01'), null);
  assert.equal(expiryStatus('2026-01-01', '2026-01-02'), 'expired');
  assert.equal(expiryStatus('2026-01-04', '2026-01-02'), 'soon');
  assert.equal(expiryStatus('2026-02-04', '2026-01-02'), 'ok');
  assert.equal(expiryStatus(null, '2026-01-02'), 'none');
});

test('fuzzy name matching', () => {
  assert.ok(namesMatch('tomatoes', 'Tomato'));
  assert.ok(namesMatch('chicken', 'chicken breast'));
  assert.ok(namesMatch('Fresh Basil', 'basil'));
  assert.ok(!namesMatch('milk', 'eggs'));
});

test('ingredient parsing', () => {
  assert.deepEqual(parseIngredient('1 1/2 cups all-purpose flour'), { name: 'all-purpose flour', quantity: 1.5, unit: 'cup' });
  assert.deepEqual(parseIngredient('2 cloves garlic, minced'), { name: 'garlic', quantity: 2, unit: 'clove' });
  assert.deepEqual(parseIngredient('½ tsp salt'), { name: 'salt', quantity: 0.5, unit: 'tsp' });
  assert.deepEqual(parseIngredient('3 eggs'), { name: 'eggs', quantity: 3, unit: '' });
  assert.deepEqual(parseIngredient('salt to taste'), { name: 'salt to taste', quantity: null, unit: '' });
  assert.equal(parseIngredient('200 g chicken breast').quantity, 200);
});

test('recipe text parsing', () => {
  const r = parseRecipeText(`Garlic Chicken
Serves 4
Prep time: 10
Cook time: 25
Ingredients
500 g chicken breast
2 cloves garlic
Instructions
1. Season the chicken.
2. Cook for 25 minutes.`);
  assert.equal(r.name, 'Garlic Chicken');
  assert.equal(r.servings, 4); assert.equal(r.prepTime, 10); assert.equal(r.cookTime, 25);
  assert.equal(r.ingredients.length, 2);
  assert.deepEqual(r.steps, ['Season the chicken.', 'Cook for 25 minutes.']);
});

test('units', () => { assert.equal(normUnit('Pounds'), 'lb'); near(toGrams(1, 'lb'), 453.592, 0.01); assert.equal(toGrams(1, 'cup'), null); });

test('macro estimate from library foods (weight units only)', () => {
  const foods = [{ id: 1, name: 'Chicken breast', per100: { cal: 120, protein: 22, carbs: 0, fat: 2.6, fiber: 0 } },
    { id: 2, name: 'Rice', per100: { cal: 130, protein: 3, carbs: 28, fat: 0.3, fiber: 0 } }];
  const recipe = { servings: 2, ingredients: [{ name: 'chicken breast', quantity: 400, unit: 'g' }, { name: 'rice', quantity: 1, unit: 'cup' }, { name: 'salt', quantity: 1, unit: 'tsp' }] };
  const e = estimateRecipeMacros(recipe, foods);
  assert.equal(e.matched, 1);
  near(e.perServing.cal, 240); near(e.perServing.protein, 44);
});

test('dietary conflicts', () => {
  const r = { ingredients: [{ name: 'chicken thighs' }, { name: 'butter' }, { name: 'cilantro' }, { name: 'spaghetti' }], macros: { carbs: 40 } };
  assert.deepEqual(recipeConflicts(r, { diets: ['vegetarian'] }), ['chicken thighs']);
  assert.ok(recipeConflicts(r, { diets: ['vegan'] }).includes('butter'));
  assert.deepEqual(recipeConflicts(r, { dislikes: ['cilantro'] }), ['cilantro']);
  assert.ok(recipeConflicts(r, { diets: ['gluten-free'] }).includes('spaghetti'));
  assert.ok(recipeConflicts(r, { diets: ['keto'] }).some((x) => x.includes('carbs')));
});

test('pantry deduction and coverage', () => {
  const pantry = [{ id: 'a', name: 'Chicken breast', quantity: 1, unit: 'lb' }, { id: 'b', name: 'garlic', quantity: 2, unit: 'clove' }, { id: 'c', name: 'salt', quantity: 1, unit: '', alwaysOnHand: true }];
  const recipe = { servings: 2, ingredients: [{ name: 'chicken breast', quantity: 200, unit: 'g' }, { name: 'garlic', quantity: 3, unit: 'clove' }, { name: 'salt', quantity: 1, unit: 'tsp' }, { name: 'lime', quantity: 1, unit: '' }] };
  const ch = planDeduction(pantry, recipe, 1);
  const a = ch.find((c) => c.id === 'a'); near(a.quantity, 1 - 200 / 453.592, 0.01);
  assert.equal(ch.find((c) => c.id === 'b').quantity, null); // garlic used up
  assert.equal(ch.find((c) => c.id === 'c'), undefined); // always on hand
  near(pantryCoverage(recipe, pantry), 0.75);
});

test('shopping list from plan merges, scales, and subtracts pantry', () => {
  const r1 = { name: 'Pasta', servings: 2, ingredients: [{ name: 'tomatoes', quantity: 4, unit: '' }, { name: 'spaghetti', quantity: 200, unit: 'g' }, { name: 'salt', quantity: 1, unit: 'tsp' }] };
  const r2 = { name: 'Salad', servings: 2, ingredients: [{ name: 'Tomato', quantity: 2, unit: '' }] };
  const pantry = [{ id: 1, name: 'spaghetti', quantity: 500, unit: 'g' }, { id: 2, name: 'salt', quantity: 1, alwaysOnHand: true }];
  const list = shoppingFromPlan([{ recipe: r1 }, { recipe: r2 }], pantry);
  assert.equal(list.length, 1);
  assert.equal(list[0].quantity, 6); assert.deepEqual(list[0].from.sort(), ['Pasta', 'Salad']);
  const doubled = shoppingFromPlan([{ recipe: r2, servings: 4 }], []);
  assert.equal(doubled[0].quantity, 4);
});

test('receipt parsing', () => {
  const { items, total } = parseReceiptText('milk 3.99, eggs $4.50\n2 x apples 3.00\nSubtotal 11.49\nTotal 12.10');
  assert.deepEqual(items.map((i) => [i.name, i.price, i.quantity]), [['milk', 3.99, 1], ['eggs', 4.5, 1], ['apples', 3, 2]]);
  assert.equal(total, 12.1);
});

test('spending and restock', () => {
  const receipts = [
    { date: '2026-01-01', store: 'A', total: 20, items: [{ name: 'milk', price: 4 }] },
    { date: '2026-01-08', store: 'B', total: 30, items: [{ name: 'Milk', price: 4 }] },
    { date: '2026-01-15', store: 'A', total: 10, items: [{ name: 'milks', price: 4 }] },
  ];
  const s = spendingSummary(receipts, { period: 'month', today: '2026-01-20' });
  assert.equal(s.total, 60); assert.equal(s.trips, 3); assert.equal(s.byStore.length, 2);
  assert.equal(s.byStore.find((x) => x.name === 'A').amount, 30);
  const r = restockPredictions(receipts, '2026-01-20');
  assert.equal(r[0].everyDays, 7); assert.equal(r[0].nextDate, '2026-01-22'); assert.equal(r[0].daysUntil, 2);
});

test('nutrition trends: hit rate and deficits', () => {
  const totals = {};
  for (let i = 0; i < 10; i++) totals[`2026-01-${String(20 - i).padStart(2, '0')}`] = { cal: i < 5 ? 2000 : 2600, protein: 100, carbs: 200, fat: 70, fiber: 10 };
  const t = nutritionTrends(totals, { cal: 2000, protein: 150, carbs: 200, fat: 70 }, { weeks: 4, today: '2026-01-20' });
  near(t.hitRate, 0.5); assert.equal(t.loggedDays, 10);
  assert.equal(t.deficits[0].name, 'Fiber');
  assert.equal(t.weeks.length, 4);
});
