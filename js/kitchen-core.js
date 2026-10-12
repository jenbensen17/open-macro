// Pure kitchen logic: pantry, recipes, meal plan, shopping, receipts, insights.
import { addDays, daysBetween, forGrams, scale, sum, ZERO } from './core.js';

// ---------- categories (shared by pantry and shopping; order = aisle walk order) ----------
export const CATS = [
  ['fruits', 'Fruits'], ['vegetables', 'Vegetables'], ['dairy', 'Dairy & eggs'], ['meat', 'Meat'], ['seafood', 'Seafood'],
  ['deli', 'Deli'], ['meat_alternatives', 'Meat alternatives'], ['bread', 'Bread & bakery'], ['pasta_rice_cereal', 'Pasta, rice & cereal'],
  ['canned', 'Canned & jarred'], ['frozen', 'Frozen'], ['snacks', 'Snacks'], ['beverages', 'Beverages'],
  ['condiments_spices', 'Condiments & spices'], ['baking', 'Baking'], ['household', 'Household'], ['pet', 'Pet'],
  ['leftovers', 'Leftovers'], ['other', 'Other'],
].map(([id, name]) => ({ id, name }));
export const catName = (id) => CATS.find((c) => c.id === id)?.name ?? 'Other';
const catIndex = (id) => { const i = CATS.findIndex((c) => c.id === id); return i < 0 ? CATS.length : i; };

const CAT_RULES = [
  ['frozen', /\bfrozen\b|ice cream|popsicle/],
  ['household', /paper towel|toilet|detergent|\bsoap\b|aluminum foil|trash bag|sponge|dish/],
  ['pet', /\bdog\b|cat food|\bpet\b|litter/],
  ['seafood', /salmon|tuna|shrimp|\bcod\b|tilapia|\bfish\b|crab|lobster|scallop|halibut|sardine/],
  ['meat', /chicken|beef|pork|steak|turkey|bacon|sausage|\bham\b|lamb|\bribs?\b|brisket|ground meat/],
  ['deli', /\bdeli\b|salami|prosciutto|pepperoni|lunch meat/],
  ['meat_alternatives', /tofu|tempeh|seitan|beyond|impossible/],
  ['dairy', /milk|cheese|yogurt|yoghurt|butter|cream|\beggs?\b|kefir|sour cream/],
  ['bread', /bread|bagel|tortilla|\bbuns?\b|\brolls?\b|pita|naan|croissant/],
  ['pasta_rice_cereal', /pasta|spaghetti|\brice\b|cereal|\boats?\b|oatmeal|noodle|quinoa|couscous|macaroni/],
  ['canned', /canned|beans?\b|chickpea|lentil|tomato sauce|tomato paste|broth|stock|soup|diced tomato/],
  ['snacks', /chips|cracker|cookie|granola|popcorn|\bnuts?\b|almonds?|pretzel|\bbars?\b/],
  ['beverages', /juice|soda|coffee|\btea\b|\bwater\b|\bbeer\b|\bwine\b|kombucha|seltzer/],
  ['baking', /flour|sugar|baking|yeast|vanilla|cocoa|chocolate chip/],
  ['condiments_spices', /\bsalt\b|black pepper|ground pepper|pepper flakes|spice|cumin|paprika|oregano|cinnamon|ketchup|mustard|mayo|sauce|vinegar|\boil\b|salsa|honey|syrup|dressing/],
  ['fruits', /apple|banana|orange|berry|berries|grape|lemon|\blimes?\b|mango|avocado|\bpears?\b|peach|melon|pineapple|cherr/],
  ['vegetables', /lettuce|spinach|kale|onion|garlic|carrot|broccoli|pepper|tomato|potato|cucumber|celery|zucchini|mushroom|cabbage|cauliflower|\bpeas?\b|corn|ginger|cilantro|parsley|basil|squash|asparagus|salad/],
];
export function categorize(name) {
  const n = String(name).toLowerCase();
  for (const [cat, re] of CAT_RULES) if (re.test(n)) return cat;
  return 'other';
}

const SHELF_LIFE_DAYS = { fruits: 7, vegetables: 7, dairy: 10, meat: 3, seafood: 2, deli: 5, meat_alternatives: 10, bread: 6, frozen: 90, leftovers: 4 };
/** Estimated expiry day (YYYY-MM-DD) for a category, or null if non-perishable. */
export function defaultExpiry(category, from) {
  const d = SHELF_LIFE_DAYS[category];
  return d ? addDays(from, d) : null;
}
export function expiryStatus(expiresAt, today) {
  if (!expiresAt) return 'none';
  const d = daysBetween(today, expiresAt);
  return d < 0 ? 'expired' : d <= 3 ? 'soon' : 'ok';
}

// ---------- names & units ----------
const NOISE = new Set(['fresh', 'organic', 'large', 'small', 'medium', 'whole', 'raw', 'chopped', 'diced', 'sliced', 'minced', 'ground', 'of', 'the', 'a', 'and']);
const singular = (w) => (w.length > 3 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && /(ches|shes|oes|ses)$/.test(w) ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
export const nameTokens = (name) => String(name).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).map(singular).filter((t) => !NOISE.has(t));
export const normName = (name) => nameTokens(name).join(' ');
/** Fuzzy match: equal, or all tokens of the shorter name appear in the longer. */
export function namesMatch(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return s.every((t) => l.includes(t));
}
const exactNameMatch = (a, b) => normName(a) === normName(b);

const UNIT_ALIASES = {
  g: 'g', gram: 'g', grams: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg', oz: 'oz', ounce: 'oz', ounces: 'oz', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
  ml: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', cup: 'cup', cups: 'cup', tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp', tbs: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp', gal: 'gal', gallon: 'gal', gallons: 'gal', clove: 'clove', cloves: 'clove', can: 'can', cans: 'can',
  bunch: 'bunch', bunches: 'bunch', pinch: 'pinch', slice: 'slice', slices: 'slice', piece: 'piece', pieces: 'piece', dozen: 'dozen', pkg: 'pkg', package: 'pkg',
  container: 'container', portion: 'portion', stick: 'stick', sticks: 'stick', head: 'head', heads: 'head',
};
export const normUnit = (u) => (u ? (UNIT_ALIASES[String(u).toLowerCase().replace(/\.$/, '')] ?? String(u).toLowerCase()) : '');
const GRAMS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 };
export const toGrams = (qty, unit) => { const f = GRAMS[normUnit(unit)]; return f ? qty * f : null; };

// ---------- ingredient / recipe text parsing ----------
const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
function parseQty(str) {
  const parts = str.trim().split(/\s+/);
  let total = 0, used = 0;
  for (const p of parts) {
    if (FRAC[p]) { total += FRAC[p]; used++; }
    else if (/^\d+\/\d+$/.test(p)) { const [a, b] = p.split('/').map(Number); total += a / b; used++; }
    else if (/^\d*\.?\d+$/.test(p)) { total += parseFloat(p); used++; }
    else break;
  }
  return used ? { qty: total, used } : null;
}
/** "1 1/2 cups flour, sifted" -> {qty:1.5, unit:'cup', name:'flour'} */
export function parseIngredient(line) {
  let text = line.replace(/^[-*•\s]+/, '').trim().replace(/^(\d+)\s*-\s*\d+/, '$1'); // "2-3 cloves" -> 2
  for (const k of Object.keys(FRAC)) text = text.replace(k, ` ${k} `).replace(/\s+/g, ' ').trim();
  const q = parseQty(text);
  let rest = q ? text.split(' ').slice(q.used).join(' ') : text;
  let unit = '';
  const m = rest.match(/^([A-Za-z.]+)\s+(.*)$/);
  if (q && m && UNIT_ALIASES[m[1].toLowerCase().replace(/\.$/, '')]) { unit = normUnit(m[1]); rest = m[2]; }
  rest = rest.replace(/^of\s+/i, '').replace(/\(.*?\)/g, '').split(',')[0].trim();
  return { name: rest || text, quantity: q ? q.qty : null, unit };
}

/** Parse pasted recipe text (title, ingredients, instructions, servings, times). */
export function parseRecipeText(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out = { name: '', ingredients: [], steps: [], servings: 0, prepTime: 0, cookTime: 0 };
  let mode = 'head';
  for (const raw of lines) {
    if (!raw) continue;
    const l = raw.replace(/:$/, '');
    if (/^ingredients?$/i.test(l)) { mode = 'ing'; continue; }
    if (/^(instructions?|directions?|method|steps?|preparation)$/i.test(l)) { mode = 'steps'; continue; }
    let m;
    if ((m = raw.match(/^(?:serves|servings?|yield|makes)\s*:?\s*(\d+)/i))) { out.servings = +m[1]; continue; }
    if ((m = raw.match(/^prep(?:\s*time)?\s*:?\s*(\d+)/i))) { out.prepTime = +m[1]; continue; }
    if ((m = raw.match(/^cook(?:\s*time)?\s*:?\s*(\d+)/i))) { out.cookTime = +m[1]; continue; }
    if (mode === 'head') { if (!out.name) out.name = raw; else { mode = 'ing'; out.ingredients.push(parseIngredient(raw)); } }
    else if (mode === 'ing') out.ingredients.push(parseIngredient(raw));
    else out.steps.push(raw.replace(/^\s*(?:step\s*)?\d+[.):]\s*/i, ''));
  }
  return out;
}

// ---------- macros from ingredients ----------
/** Estimate per-serving macros using library foods for ingredients given in weight units. */
export function estimateRecipeMacros(recipe, foods) {
  const parts = [];
  let matched = 0;
  for (const ing of recipe.ingredients) {
    const grams = ing.quantity != null ? toGrams(ing.quantity, ing.unit) : null;
    if (grams == null) continue;
    const food = foods.find((f) => !f.ingredients && exactNameMatch(f.name, ing.name)) || foods.find((f) => !f.ingredients && namesMatch(f.name, ing.name));
    if (!food) continue;
    matched++;
    parts.push(forGrams(food.per100, grams));
  }
  const total = sum(parts);
  const servings = Math.max(1, recipe.servings || 1);
  return { perServing: scale(total, 1 / servings), matched, total: recipe.ingredients.length };
}

// ---------- dietary conflicts ----------
const GLUTEN = /wheat|flour|bread|pasta|spaghetti|noodle|barley|rye|couscous|cracker|tortilla|bagel|soy sauce|beer/;
const EGG = /\beggs?\b|mayo/;
const DAIRY_RE = /milk|cheese|yogurt|yoghurt|butter|cream|kefir|whey/;
/** Returns ingredient names in `recipe` that conflict with a profile's diets/exclusions/dislikes. */
export function recipeConflicts(recipe, profile) {
  const hits = new Set();
  const terms = [...(profile.exclusions || []), ...(profile.dislikes || [])].filter(Boolean);
  const diets = (profile.diets || []).map((d) => d.toLowerCase());
  for (const ing of recipe.ingredients) {
    const n = ing.name.toLowerCase();
    const cat = categorize(ing.name);
    if (terms.some((t) => namesMatch(t, ing.name) || n.includes(t.toLowerCase()))) hits.add(ing.name);
    if (diets.includes('vegetarian') && ['meat', 'seafood', 'deli'].includes(cat)) hits.add(ing.name);
    if (diets.includes('vegan') && (['meat', 'seafood', 'deli'].includes(cat) || DAIRY_RE.test(n) || EGG.test(n) || /honey/.test(n))) hits.add(ing.name);
    if (diets.includes('pescatarian') && ['meat', 'deli'].includes(cat)) hits.add(ing.name);
    if ((diets.includes('dairy-free') || diets.includes('dairy free')) && DAIRY_RE.test(n)) hits.add(ing.name);
    if ((diets.includes('gluten-free') || diets.includes('gluten free')) && GLUTEN.test(n)) hits.add(ing.name);
  }
  const carbs = recipe.macros?.carbs;
  const out = [...hits];
  if (diets.includes('keto') && carbs != null && carbs > 15) out.push(`${Math.round(carbs)} g carbs/serving`);
  if ((diets.includes('low-carb') || diets.includes('low carb')) && carbs != null && carbs > 30) out.push(`${Math.round(carbs)} g carbs/serving`);
  return out;
}

// ---------- pantry ----------
const unitsCompat = (a, b) => normUnit(a) === normUnit(b) || (!a && !b);
function findPantry(pantry, name) {
  return pantry.find((p) => exactNameMatch(p.name, name)) || pantry.find((p) => namesMatch(p.name, name));
}
export const inPantry = (pantry, name) => { const p = findPantry(pantry, name); return !!p && (p.alwaysOnHand || p.quantity > 0); };

/** Fraction (0..1) of a recipe's ingredients covered by the pantry. */
export function pantryCoverage(recipe, pantry) {
  if (!recipe.ingredients.length) return 0;
  return recipe.ingredients.filter((i) => inPantry(pantry, i.name)).length / recipe.ingredients.length;
}

/** Changes needed to deduct `factor` × recipe from the pantry: [{id, quantity|null}] (null = remove). */
export function planDeduction(pantry, recipe, factor = 1) {
  const changes = new Map();
  for (const ing of recipe.ingredients) {
    const p = findPantry(pantry, ing.name);
    if (!p || p.alwaysOnHand || ing.quantity == null) continue;
    const have = changes.has(p.id) ? changes.get(p.id) : p.quantity;
    if (have == null) continue;
    let need = ing.quantity * factor;
    if (!unitsCompat(p.unit, ing.unit)) {
      const g1 = toGrams(1, p.unit), g2 = toGrams(need, ing.unit);
      if (g1 && g2 != null) need = g2 / g1; else continue;
    }
    const left = Math.round((have - need) * 100) / 100;
    changes.set(p.id, left > 0 ? left : null);
  }
  return [...changes].map(([id, quantity]) => ({ id, quantity }));
}

// ---------- shopping from meal plan ----------
/**
 * plan: [{recipe, servings?}] — each planned meal. Returns merged missing items.
 * Quantities in the same unit are summed; pantry-covered items are subtracted/omitted.
 */
export function shoppingFromPlan(plan, pantry, { checkPantry = true } = {}) {
  const merged = new Map();
  for (const { recipe, servings } of plan) {
    const factor = (servings || recipe.servings || 1) / Math.max(1, recipe.servings || 1);
    for (const ing of recipe.ingredients) {
      const unit = normUnit(ing.unit);
      const key = `${normName(ing.name)}|${unit}`;
      const cur = merged.get(key) || { name: ing.name, unit, quantity: ing.quantity == null ? null : 0, from: new Set() };
      if (ing.quantity != null && cur.quantity != null) cur.quantity += ing.quantity * factor;
      cur.from.add(recipe.name);
      merged.set(key, cur);
    }
  }
  const out = [];
  for (const it of merged.values()) {
    let qty = it.quantity;
    if (checkPantry) {
      const p = findPantry(pantry, it.name);
      if (p && (p.alwaysOnHand || p.quantity > 0)) {
        if (p.alwaysOnHand || qty == null) continue;
        if (unitsCompat(p.unit, it.unit)) { qty -= p.quantity; if (qty <= 0) continue; }
        else continue; // different unit: assume covered
      }
    }
    out.push({ name: it.name, quantity: qty == null ? null : Math.round(qty * 100) / 100, unit: it.unit, category: categorize(it.name), from: [...it.from] });
  }
  return out.sort((a, b) => catIndex(a.category) - catIndex(b.category) || a.name.localeCompare(b.name));
}

/** Merge an incoming shopping item into a list, summing same-name same-unit items. */
export function mergeShopping(list, item, store) {
  const ex = list.find((s) => s.store === store && !s.checked && exactNameMatch(s.name, item.name) && unitsCompat(s.unit, item.unit));
  if (ex) { ex.quantity = (ex.quantity ?? 0) + (item.quantity ?? 0) || null; return ex; }
  return null;
}

// ---------- receipts ----------
/** Parse typed/pasted receipt text: "milk 3.99, eggs 4.50" or one per line; "2 x apples 3.00". */
export function parseReceiptText(text) {
  const items = [];
  let total = null;
  for (const seg of text.split(/[\n;]+|,(?=\s*[A-Za-z0-9])/)) {
    const s = seg.trim();
    if (!s) continue;
    const m = s.match(/^(.*?)[\s:]*\$?\s*(\d+(?:\.\d{1,2})?)\s*$/);
    if (!m || !m[1].trim()) { if (/^[A-Za-z]/.test(s)) items.push({ name: s, price: null, quantity: 1 }); continue; }
    let name = m[1].trim();
    const price = parseFloat(m[2]);
    if (/^(sub\s*total|total|tax|change|cash|visa|mastercard|amex|balance)\b/i.test(name)) { if (/^total/i.test(name)) total = price; continue; }
    let quantity = 1;
    const q = name.match(/^(\d+)\s*[x@]\s*(.*)$/i);
    if (q) { quantity = +q[1]; name = q[2]; }
    items.push({ name, price, quantity });
  }
  return { items, total };
}

// ---------- insights ----------
const receiptTotal = (r) => (r.total != null ? r.total : (r.items || []).reduce((a, i) => a + (i.price || 0), 0));
export function spendingSummary(receipts, { period = 'month', today }) {
  const days = { week: 7, month: 30, quarter: 90, year: 365 }[period];
  const start = addDays(today, -days + 1), prevStart = addDays(start, -days);
  const inRange = receipts.filter((r) => r.date >= start && r.date <= today);
  const prev = receipts.filter((r) => r.date >= prevStart && r.date < start);
  const byStore = {}, byItem = {};
  for (const r of inRange) {
    byStore[r.store || 'Unknown'] = (byStore[r.store || 'Unknown'] || 0) + receiptTotal(r);
    for (const i of r.items || []) if (i.price) byItem[normName(i.name)] = (byItem[normName(i.name)] || 0) + i.price;
  }
  const total = inRange.reduce((a, r) => a + receiptTotal(r), 0);
  const prevTotal = prev.reduce((a, r) => a + receiptTotal(r), 0);
  const rank = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, amount]) => ({ name, amount }));
  return { total, prevTotal, trips: inRange.length, byStore: rank(byStore), topItems: rank(byItem) };
}

/** Items bought repeatedly: average restock interval and predicted next purchase. */
export function restockPredictions(receipts, today, { minPurchases = 2 } = {}) {
  const buys = new Map();
  for (const r of receipts) for (const i of r.items || []) {
    const k = normName(i.name);
    if (!k) continue;
    const e = buys.get(k) || { name: i.name, days: new Set() };
    e.days.add(r.date); buys.set(k, e);
  }
  const out = [];
  for (const e of buys.values()) {
    const days = [...e.days].sort();
    if (days.length < minPurchases) continue;
    const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg <= 0) continue;
    const next = addDays(days[days.length - 1], Math.round(avg));
    out.push({ name: e.name, purchases: days.length, everyDays: Math.round(avg), nextDate: next, daysUntil: daysBetween(today, next) });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil);
}

/** Weekly averages over logged days, calorie-target hit rate, and biggest shortfalls. */
export function nutritionTrends(totalsByDay, targets, { weeks = 4, today }) {
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const end = addDays(today, -7 * w), start = addDays(end, -6);
    const days = [];
    for (let d = start; d <= end; d = addDays(d, 1)) if (totalsByDay[d] && totalsByDay[d].cal > 0) days.push(totalsByDay[d]);
    const avg = days.length ? scale(sum(days), 1 / days.length) : { ...ZERO };
    out.push({ start, end, loggedDays: days.length, avg });
  }
  const all = Object.entries(totalsByDay).filter(([d, t]) => t.cal > 0 && d >= addDays(today, -7 * weeks + 1) && d <= today).map(([, t]) => t);
  const hits = all.filter((t) => Math.abs(t.cal - targets.cal) <= targets.cal * 0.1).length;
  const avgAll = all.length ? scale(sum(all), 1 / all.length) : { ...ZERO };
  const fiberTarget = (14 * targets.cal) / 1000;
  const deficits = all.length ? [
    { name: 'Protein', pct: 1 - avgAll.protein / targets.protein, avg: avgAll.protein, target: targets.protein, unit: 'g' },
    { name: 'Fiber', pct: 1 - avgAll.fiber / fiberTarget, avg: avgAll.fiber, target: fiberTarget, unit: 'g' },
  ].filter((d) => d.pct > 0.05).sort((a, b) => b.pct - a.pct) : [];
  return { weeks: out.reverse(), hitRate: all.length ? hits / all.length : null, loggedDays: all.length, deficits };
}
