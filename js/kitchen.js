// Kitchen: pantry, recipes, meal plan, shopping lists, receipts, household profiles, insights.
import { dayStr, addDays, parseDay, daysBetween, sum, scale, ZERO } from './core.js';
import {
  CATS, catName, categorize, defaultExpiry, expiryStatus, parseIngredient, parseRecipeText, estimateRecipeMacros,
  recipeConflicts, pantryCoverage, inPantry, planDeduction, shoppingFromPlan, mergeShopping, parseReceiptText,
  spendingSummary, restockPredictions, nutritionTrends, namesMatch, normUnit,
} from './kitchen-core.js';
import * as db from './db.js';
import { $, esc, f0, f1, uid, money, qtyText } from './util.js';

let C; // context from app.js: {S, modal, closeModal, toast, reload, render, insights, MEALS, entryN, saveSettings}
export function init(ctx) { C = ctx; }

const SLOTS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snack']];
const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'keto', 'low-carb', 'dairy-free', 'gluten-free'];
const UI = { sub: 'pantry', pantryQ: '', recipeQ: '', canMake: false, collection: '', sort: 'relevance', forProfile: '', week: null, store: null, period: 'month' };

const S = () => C.S;
const set = () => C.S.settings;
const done = async (msg) => { await C.reload(); C.closeModal(); C.render(); if (msg) C.toast(msg); };
const weekStart = (d) => addDays(d, -((parseDay(d).getDay() + 6) % 7));
const catOptions = (cur) => CATS.map((c) => `<option value="${c.id}" ${c.id === cur ? 'selected' : ''}>${c.name}</option>`).join('');
const splitList = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const recipeById = (id) => S().recipes.find((r) => r.id === id);
const stores = () => (set().stores?.length ? set().stores : ['Groceries']);
const cookedMacros = (r) => r.macros || null;

// ================================================================ view
export function view() {
  const tabs = [['pantry', 'Pantry'], ['recipes', 'Recipes'], ['plan', 'Plan'], ['shop', 'Shop'], ['more', 'More']];
  const body = { pantry: viewPantry, recipes: viewRecipes, plan: viewPlan, shop: viewShop, more: viewMore }[UI.sub]();
  return `<div class="seg sub">${tabs.map(([k, n]) => `<button class="${UI.sub === k ? 'on' : ''}" data-a="k-sub" data-k="${k}">${n}</button>`).join('')}</div>${body}`;
}

// ---------------------------------------------------------------- pantry
function viewPantry() {
  const expiredN = S().pantry.filter((p) => expiryStatus(p.expiresAt, dayStr()) === 'expired').length;
  return `<div class="row gap wrap"><button class="btn small" data-a="k-pantry-add">+ Item</button><button class="btn small" data-a="k-receipt">🧾 Receipt</button>
      <button class="btn small" data-a="k-leftover">🥡 Leftovers</button>${expiredN ? `<button class="btn small danger" data-a="k-clear-expired">Clear ${expiredN} expired</button>` : ''}</div>
    <input class="search mt" id="k-pantry-q" placeholder="Search pantry" value="${esc(UI.pantryQ)}" autocomplete="off">
    <div id="k-pantry-list">${pantryBody()}</div>`;
}
function pantryBody() {
  const today = dayStr();
  const q = UI.pantryQ.toLowerCase();
  const items = S().pantry.filter((p) => !q || p.name.toLowerCase().includes(q));
  const urgent = S().pantry.filter((p) => ['expired', 'soon'].includes(expiryStatus(p.expiresAt, today)))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const groups = CATS.map((c) => ({ c, list: items.filter((p) => (p.category || 'other') === c.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.list.length);
  return `${urgent.length && !q ? `<section class="card warn"><h3>Use soon</h3>${urgent.map((p) => pantryRow(p, today)).join('')}</section>` : ''}
    ${groups.map((g) => `<section class="card"><h3>${g.c.name}</h3>${g.list.map((p) => pantryRow(p, today)).join('')}</section>`).join('')
      || `<div class="card muted s">${q ? 'No matches.' : 'Your pantry is empty. Add items, or log a receipt to stock it in one go.'}</div>`}`;
}
function pantryRow(p, today) {
  const st = expiryStatus(p.expiresAt, today);
  const badge = p.alwaysOnHand ? '<span class="badge">always</span>'
    : st === 'expired' ? '<span class="badge bad">expired</span>'
      : st === 'soon' ? `<span class="badge soon">${daysBetween(today, p.expiresAt) === 0 ? 'today' : daysBetween(today, p.expiresAt) + 'd'}</span>` : '';
  return `<div class="row item" data-a="k-pantry-edit" data-id="${p.id}"><div class="grow"><div class="t">${p.isLeftover ? '🥡 ' : ''}${esc(p.name)}</div>
    <div class="muted s">${esc(p.brand ? p.brand + ' · ' : '')}${p.alwaysOnHand ? 'On hand' : qtyText(p.quantity, p.unit)}${p.sourceMeal ? ' · from ' + esc(p.sourceMeal) : ''}</div></div>${badge}</div>`;
}
function pantryForm(p) {
  const it = p || { name: '', quantity: 1, unit: '', category: '', expiresAt: '', alwaysOnHand: false, brand: '' };
  C.modal(`<header><h2 class="grow">${p ? 'Edit item' : 'Add to pantry'}</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-pantry" class="form"><input type="hidden" name="id" value="${esc(p?.id || '')}">
      <label>Name<input name="name" value="${esc(it.name)}" required autocomplete="off"></label>
      <div class="row gap"><label class="grow">Quantity<input name="quantity" type="number" inputmode="decimal" step="any" min="0" value="${it.quantity ?? ''}"></label>
      <label class="grow">Unit<input name="unit" value="${esc(it.unit || '')}" placeholder="lb, bunch…"></label></div>
      <label>Category<select name="category"><option value="">Auto-detect</option>${catOptions(it.category)}</select></label>
      <label>Expires<input name="expiresAt" type="date" value="${esc(it.expiresAt || '')}"></label>
      <label>Brand (optional)<input name="brand" value="${esc(it.brand || '')}"></label>
      <label class="check"><input type="checkbox" name="alwaysOnHand" ${it.alwaysOnHand ? 'checked' : ''}> Always on hand (staple — never runs out)</label>
      <div class="muted s">${p ? '' : 'Leave expiry blank to estimate it from the category.'}</div>
      <div class="row gap"><button class="btn primary grow" type="submit">Save</button>
      ${p ? `<button class="btn" type="button" data-a="k-pantry-use" data-id="${p.id}">Used it all</button>` : ''}</div>
    </form>`);
}
async function addToPantry(items, today = dayStr()) {
  // Merge by name+unit; refresh expiry on restock.
  const pantry = S().pantry;
  const writes = [];
  for (const it of items) {
    const cat = it.category || categorize(it.name);
    const ex = pantry.find((p) => !p.isLeftover && p.name.toLowerCase() === it.name.toLowerCase() && normUnit(p.unit) === normUnit(it.unit));
    if (ex) {
      ex.quantity = (ex.quantity || 0) + (it.quantity || 1);
      ex.expiresAt = it.expiresAt || defaultExpiry(ex.category, today) || ex.expiresAt;
      writes.push(ex);
    } else {
      const rec = { id: uid(), name: it.name, quantity: it.quantity ?? 1, unit: it.unit || '', category: cat, brand: it.brand || '',
        expiresAt: it.expiresAt || defaultExpiry(cat, today), alwaysOnHand: false, addedAt: today };
      pantry.push(rec); writes.push(rec);
    }
  }
  await db.putMany('pantry', writes);
}

// ---------------------------------------------------------------- receipts
function receiptForm() {
  C.modal(`<header><h2 class="grow">Log receipt</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-receipt" class="form">
      <div class="row gap"><label class="grow">Date<input name="date" type="date" value="${dayStr()}" required></label>
      <label class="grow">Store<input name="store" list="k-stores" placeholder="Store"></label></div>
      <datalist id="k-stores">${[...new Set([...stores(), ...S().receipts.map((r) => r.store).filter(Boolean)])].map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      <label>Items — one per line or comma-separated, with prices
        <textarea name="text" id="k-receipt-text" rows="7" placeholder="milk 3.99\neggs 4.50\n2 x avocado 3.00\nTotal 11.49"></textarea></label>
      <div id="k-receipt-prev" class="muted s"></div>
      <label class="check"><input type="checkbox" name="toPantry" checked> Add items to pantry and check them off the shopping list</label>
      <button class="btn primary" type="submit">Save receipt</button></form>`);
}
function receiptPreview() {
  const { items, total } = parseReceiptText($('#k-receipt-text').value);
  const sumP = items.reduce((a, i) => a + (i.price || 0), 0);
  $('#k-receipt-prev').innerHTML = items.length ? `${items.length} item${items.length === 1 ? '' : 's'} · ${money(sumP)}${total != null ? ` · total ${money(total)}` : ''}<br>`
    + items.map((i) => `${esc(i.name)}${i.quantity > 1 ? ' ×' + i.quantity : ''} <span class="muted">(${catName(categorize(i.name))})</span>`).join(', ') : '';
}

// ---------------------------------------------------------------- recipes
function filteredRecipes() {
  const q = UI.recipeQ.toLowerCase();
  const prof = (set().profiles || []).filter((p) => !UI.forProfile || p.id === UI.forProfile);
  const col = UI.collection && S().collections.find((c) => c.id === UI.collection);
  let list = S().recipes.map((r) => ({
    r, cov: pantryCoverage(r, S().pantry),
    conflicts: UI.forProfile ? prof.flatMap((p) => recipeConflicts(r, p)) : [],
  }));
  if (q) list = list.filter(({ r }) => `${r.name} ${(r.tags || []).join(' ')} ${r.ingredients.map((i) => i.name).join(' ')}`.toLowerCase().includes(q));
  if (col) list = list.filter(({ r }) => col.recipeIds.includes(r.id));
  if (UI.canMake) list = list.filter((x) => x.cov === 1);
  if (UI.forProfile) list = list.filter((x) => !x.conflicts.length);
  const time = (r) => (r.prepTime || 0) + (r.cookTime || 0) || 9999;
  const sorters = {
    relevance: (a, b) => b.cov - a.cov || (b.r.rating || 0) - (a.r.rating || 0) || a.r.name.localeCompare(b.r.name),
    rating: (a, b) => (b.r.rating || 0) - (a.r.rating || 0),
    quickest: (a, b) => time(a.r) - time(b.r),
    mostCooked: (a, b) => (b.r.timesCooked || 0) - (a.r.timesCooked || 0),
    newest: (a, b) => (b.r.createdAt || '').localeCompare(a.r.createdAt || ''),
  };
  return list.sort(sorters[UI.sort]);
}
function recipeRows() {
  const list = filteredRecipes();
  return list.map(({ r, cov }) => {
    const m = cookedMacros(r);
    const t = (r.prepTime || 0) + (r.cookTime || 0);
    return `<div class="row item" data-a="k-recipe" data-id="${r.id}"><div class="grow"><div class="t">${esc(r.name)}</div>
      <div class="muted s">${r.rating ? '★'.repeat(r.rating) + ' · ' : ''}${t ? t + ' min · ' : ''}${m ? f0(m.cal) + ' kcal · P' + f0(m.protein) + ' · ' : ''}${Math.round(cov * 100)}% in pantry</div></div>
      ${cov === 1 ? '<span class="badge ok">ready</span>' : ''}</div>`;
  }).join('') || `<div class="muted s empty">${S().recipes.length ? 'No recipes match.' : 'No recipes yet — add one or paste one in.'}</div>`;
}
function viewRecipes() {
  const profs = set().profiles || [];
  return `<div class="row gap wrap"><button class="btn small" data-a="k-recipe-new">+ Recipe</button><button class="btn small" data-a="k-recipe-paste">📋 Paste recipe</button></div>
    <input class="search mt" id="k-recipe-q" placeholder="Search name, tag or ingredient" value="${esc(UI.recipeQ)}" autocomplete="off">
    <div class="row gap wrap filters">
      <label class="check"><input type="checkbox" id="k-canmake" ${UI.canMake ? 'checked' : ''}> Can make now</label>
      <select id="k-sort">${[['relevance', 'Best match'], ['rating', 'Top rated'], ['quickest', 'Quickest'], ['mostCooked', 'Most cooked'], ['newest', 'Newest']].map(([k, n]) => `<option value="${k}" ${UI.sort === k ? 'selected' : ''}>${n}</option>`).join('')}</select>
      ${S().collections.length ? `<select id="k-col"><option value="">All collections</option>${S().collections.map((c) => `<option value="${c.id}" ${UI.collection === c.id ? 'selected' : ''}>${esc((c.emoji ? c.emoji + ' ' : '') + c.name)}</option>`).join('')}</select>` : ''}
      ${profs.length ? `<select id="k-for"><option value="">For anyone</option>${profs.map((p) => `<option value="${p.id}" ${UI.forProfile === p.id ? 'selected' : ''}>Safe for ${esc(p.name)}</option>`).join('')}</select>` : ''}
    </div>
    <section class="card" id="k-recipe-list">${recipeRows()}</section>`;
}
function recipeDetail(r) {
  const m = cookedMacros(r);
  const conflicts = (set().profiles || []).map((p) => ({ p, c: recipeConflicts(r, p) })).filter((x) => x.c.length);
  const cols = S().collections.filter((c) => c.recipeIds.includes(r.id));
  C.modal(`<header><button class="btn small ghost" data-a="close">‹ Back</button><h2 class="grow">${esc(r.name)}</h2></header>
    <div class="muted s">${r.servings || 1} servings${r.prepTime ? ` · prep ${r.prepTime} min` : ''}${r.cookTime ? ` · cook ${r.cookTime} min` : ''}${r.difficulty ? ' · ' + r.difficulty : ''}${r.timesCooked ? ` · cooked ${r.timesCooked}×` : ''}</div>
    <div class="stars">${[1, 2, 3, 4, 5].map((n) => `<button data-a="k-rate" data-id="${r.id}" data-n="${n}" class="${(r.rating || 0) >= n ? 'on' : ''}" aria-label="${n} stars">★</button>`).join('')}</div>
    ${(r.tags || []).length || cols.length ? `<div class="row gap wrap">${(r.tags || []).map((t) => `<span class="badge">${esc(t)}</span>`).join('')}${cols.map((c) => `<span class="badge ok">${esc((c.emoji || '📁') + ' ' + c.name)}</span>`).join('')}</div>` : ''}
    ${m ? `<div class="card prev"><div class="big">${f0(m.cal)} <span class="s muted">kcal / serving</span></div>
      <div class="macros"><span class="pill p">P ${f1(m.protein)}</span><span class="pill c">C ${f1(m.carbs)}</span><span class="pill f">F ${f1(m.fat)}</span></div></div>` : '<div class="muted s">No nutrition yet — edit the recipe to add or estimate it.</div>'}
    ${conflicts.map(({ p, c }) => `<div class="badge bad wide">⚠️ ${esc(p.name)}: ${esc(c.join(', '))}</div>`).join('')}
    <div class="row gap wrap"><button class="btn small primary" data-a="k-cook" data-id="${r.id}">🍳 I cooked this</button><button class="btn small" data-a="k-plan-recipe" data-id="${r.id}">📅 Plan</button>
      <button class="btn small" data-a="k-recipe-shop" data-id="${r.id}">🛒 Shop missing</button></div>
    <h4>Ingredients</h4><div class="list">${r.ingredients.map((i) => `<div class="row item"><span class="${inPantry(S().pantry, i.name) ? 'have' : 'need'}">${inPantry(S().pantry, i.name) ? '✓' : '○'}</span>
      <div class="grow">${esc(i.name)}</div><div class="muted s">${qtyText(i.quantity, i.unit)}</div></div>`).join('')}</div>
    ${r.steps?.length ? `<h4>Steps</h4><ol class="steps">${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}
    ${r.notes ? `<p class="muted s">${esc(r.notes)}</p>` : ''}
    ${r.sourceUrl ? `<a class="s" href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">Original recipe ↗</a>` : ''}
    <div class="row gap wrap"><button class="btn small" data-a="k-recipe-edit" data-id="${r.id}">Edit</button><button class="btn small" data-a="k-variant" data-id="${r.id}">Swap ingredient…</button>
      <button class="btn small" data-a="k-collect" data-id="${r.id}">Collections…</button><button class="btn small" data-a="k-recipe-share" data-id="${r.id}">Share</button>
      <button class="btn small danger" data-a="k-recipe-del" data-id="${r.id}">Delete</button></div>`);
}
function ingredientsText(list) { return list.map((i) => [i.quantity != null ? f1(i.quantity) : '', i.unit, i.name].filter(Boolean).join(' ')).join('\n'); }
function recipeForm(r) {
  const x = r || { name: '', servings: 2, prepTime: '', cookTime: '', difficulty: '', tags: [], ingredients: [], steps: [], macros: null, notes: '', sourceUrl: '' };
  const m = x.macros || {};
  const v = (n) => (n != null && n !== '' ? f1(n) : '');
  C.modal(`<header><button class="btn small ghost" data-a="close">‹ Cancel</button><h2 class="grow">${r?.id ? 'Edit recipe' : 'New recipe'}</h2></header>
    <form data-form="k-recipe" class="form"><input type="hidden" name="id" value="${esc(r?.id || '')}"><input type="hidden" name="parentId" value="${esc(x.parentId || '')}">
      <label>Name<input name="name" value="${esc(x.name)}" required></label>
      <div class="grid3"><label>Servings<input name="servings" type="number" inputmode="numeric" min="1" value="${x.servings || 1}"></label>
      <label>Prep (min)<input name="prepTime" type="number" inputmode="numeric" min="0" value="${x.prepTime || ''}"></label>
      <label>Cook (min)<input name="cookTime" type="number" inputmode="numeric" min="0" value="${x.cookTime || ''}"></label></div>
      <label>Difficulty<select name="difficulty"><option value=""></option>${['Easy', 'Medium', 'Hard'].map((d) => `<option ${x.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}</select></label>
      <label>Tags (comma-separated)<input name="tags" value="${esc((x.tags || []).join(', '))}" placeholder="dinner, quick, high protein"></label>
      <label>Ingredients — one per line<textarea name="ingredients" id="k-ing" rows="7" placeholder="500 g chicken breast\n2 cloves garlic\n1 cup rice">${esc(ingredientsText(x.ingredients))}</textarea></label>
      <label>Steps — one per line<textarea name="steps" rows="5">${esc((x.steps || []).join('\n'))}</textarea></label>
      <div class="row between"><div class="muted s">Nutrition per serving</div><button class="btn small" type="button" data-a="k-estimate">Estimate from my foods</button></div>
      <div id="k-est" class="muted s"></div>
      <div class="grid2"><label>Calories<input name="cal" id="k-m-cal" type="number" inputmode="decimal" step="any" min="0" value="${v(m.cal)}"></label>
      <label>Protein (g)<input name="protein" id="k-m-protein" type="number" inputmode="decimal" step="any" min="0" value="${v(m.protein)}"></label>
      <label>Carbs (g)<input name="carbs" id="k-m-carbs" type="number" inputmode="decimal" step="any" min="0" value="${v(m.carbs)}"></label>
      <label>Fat (g)<input name="fat" id="k-m-fat" type="number" inputmode="decimal" step="any" min="0" value="${v(m.fat)}"></label>
      <label>Fiber (g)<input name="fiber" id="k-m-fiber" type="number" inputmode="decimal" step="any" min="0" value="${v(m.fiber)}"></label></div>
      <label>Notes<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
      <label>Source URL<input name="sourceUrl" type="url" value="${esc(x.sourceUrl || '')}"></label>
      <button class="btn primary" type="submit">Save recipe</button></form>`);
}
function parseIngredientsText(t) { return String(t).split('\n').map((l) => l.trim()).filter(Boolean).map(parseIngredient); }

function cookForm(r) {
  C.modal(`<header><button class="btn small ghost" data-a="k-recipe" data-id="${r.id}">‹ Back</button><h2 class="grow">Cooked ${esc(r.name)}</h2></header>
    <form data-form="k-cook" class="form"><input type="hidden" name="id" value="${r.id}">
      <div class="row gap"><label class="grow">Servings cooked<input name="cooked" type="number" inputmode="decimal" step="any" min="0" value="${r.servings || 1}"></label>
      <label class="grow">Servings you ate<input name="eaten" type="number" inputmode="decimal" step="any" min="0" value="1"></label></div>
      <label>Meal<select name="meal">${C.MEALS.map((m) => `<option value="${m.k}" ${m.k === guessMeal() ? 'selected' : ''}>${m.n}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" name="log" ${r.macros ? 'checked' : 'disabled'}> Log to food diary${r.macros ? '' : ' (add nutrition to the recipe first)'}</label>
      <label class="check"><input type="checkbox" name="deduct" checked> Deduct ingredients from pantry</label>
      <label class="check"><input type="checkbox" name="leftovers" checked> Save remaining servings as leftovers</label>
      <button class="btn primary" type="submit">Done</button></form>`);
}
function guessMeal() { const h = new Date().getHours(); return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks'; }

async function logRecipeToDiary(r, servings, meal, day) {
  await db.put('entries', { id: uid(), day, meal, ts: Date.now(), name: r.name, brand: '', foodId: null, recipeId: r.id,
    grams: servings * 100, per100: { ...ZERO, ...r.macros }, servingG: 100, servingLabel: 'serving' });
}

// ---------------------------------------------------------------- meal plan
function viewPlan() {
  UI.week ??= weekStart(dayStr());
  const days = Array.from({ length: 7 }, (_, i) => addDays(UI.week, i));
  const { targets } = C.insights();
  const planMap = Object.fromEntries(S().plan.map((p) => [p.key, p]));
  const rules = set().dayThemes || {};
  return `<div class="datebar"><button class="icon" data-a="k-week" data-d="-7" aria-label="Previous week">‹</button>
      <button class="datelabel s" data-a="k-week" data-d="0">Week of ${parseDay(UI.week).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</button>
      <button class="icon" data-a="k-week" data-d="7" aria-label="Next week">›</button></div>
    <div class="row gap"><button class="btn small" data-a="k-plan-shop">🛒 Shop for this week</button></div>
    ${days.map((d) => {
    const slots = SLOTS.map(([k]) => planMap[`${d}|${k}`]).filter(Boolean);
    const kcal = sum(slots.map((p) => { const r = p.recipeId && recipeById(p.recipeId); return r?.macros ? scale({ ...ZERO, ...r.macros }, (p.eatServings || 1)) : { ...ZERO }; })).cal;
    const dow = parseDay(d).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    return `<section class="card ${d === dayStr() ? 'today' : ''}"><div class="meal-h"><h3>${parseDay(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}${rules[dow] ? ` <span class="badge">${esc(rules[dow])}</span>` : ''}</h3>
      <span class="muted s">${kcal ? `${f0(kcal)} / ${f0(targets.cal)} kcal` : ''}</span></div>
      ${SLOTS.map(([k, n]) => { const p = planMap[`${d}|${k}`]; const r = p?.recipeId && recipeById(p.recipeId);
        return `<div class="row item" data-a="k-slot" data-day="${d}" data-slot="${k}"><div class="slot muted s">${n}</div>
        <div class="grow ${p ? 't' : 'muted s'}">${p ? esc(r ? r.name : p.text) + (p.sides?.length ? `<span class="muted s"> + ${esc(p.sides.join(', '))}</span>` : '') : '—'}</div>
        ${p?.logged ? '<span class="badge ok">logged</span>' : ''}</div>`; }).join('')}
    </section>`;
  }).join('')}`;
}
function slotForm(day, slot, presetRecipeId) {
  const key = `${day}|${slot}`;
  const p = S().plan.find((x) => x.key === key) || { recipeId: presetRecipeId || '', text: '', sides: [], eatServings: 1 };
  const recipes = [...S().recipes].sort((a, b) => a.name.localeCompare(b.name));
  const conflictsFor = (r) => (set().profiles || []).flatMap((pr) => recipeConflicts(r, pr).length ? [pr.name] : []);
  C.modal(`<header><h2 class="grow">${SLOTS.find((s) => s[0] === slot)[1]} · ${parseDay(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-slot" class="form"><input type="hidden" name="key" value="${key}">
      <label>Recipe<select name="recipeId"><option value="">— none / free text —</option>${recipes.map((r) => {
    const c = conflictsFor(r); return `<option value="${r.id}" ${p.recipeId === r.id ? 'selected' : ''}>${esc(r.name)}${c.length ? ' ⚠️ ' + esc(c.join(', ')) : ''}</option>`; }).join('')}</select></label>
      <label>…or free text<input name="text" value="${esc(p.recipeId ? '' : p.text)}" placeholder="Leftovers, eating out…"></label>
      <label>Sides (comma-separated)<input name="sides" value="${esc((p.sides || []).join(', '))}"></label>
      <label>Servings you'll eat<input name="eatServings" type="number" inputmode="decimal" step="any" min="0" value="${p.eatServings || 1}"></label>
      <div class="row gap"><button class="btn primary grow" type="submit">Save</button>
      ${p.key ? `<button class="btn" type="button" data-a="k-slot-log" data-key="${key}">Log to diary</button><button class="btn danger" type="button" data-a="k-slot-clear" data-key="${key}">Clear</button>` : ''}</div>
    </form>
    ${p.key ? `<form data-form="k-slot-move" class="card form"><input type="hidden" name="key" value="${key}"><div class="muted s">Move, swap or copy this meal</div>
      <div class="row gap"><input name="toDay" type="date" value="${day}" class="grow"><select name="toSlot">${SLOTS.map(([k, n]) => `<option value="${k}" ${k === slot ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row gap"><select name="mode" class="grow"><option value="move">Move</option><option value="swap">Swap</option><option value="copy">Copy</option></select><button class="btn" type="submit">Go</button></div></form>` : ''}`);
}

// shopping preview
let PREVIEW = null;
function shopPreview(items, title) {
  PREVIEW = items;
  C.modal(`<header><h2 class="grow">${esc(title)}</h2><button class="btn small" data-a="close">Cancel</button></header>
    ${items.length ? `<form data-form="k-shop-preview" class="form"><div class="list">${items.map((it, i) => `<label class="check row item"><input type="checkbox" name="i${i}" checked>
      <span class="grow">${esc(it.name)} <span class="muted s">${qtyText(it.quantity, it.unit)}${it.from ? ' · ' + esc(it.from.join(', ')) : ''}</span></span></label>`).join('')}</div>
      <label>Add to list<select name="store">${stores().map((s) => `<option ${s === (UI.store || stores()[0]) ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
      <button class="btn primary" type="submit">Add ${items.length} item${items.length === 1 ? '' : 's'}</button></form>`
    : '<p>Everything you need is already in your pantry. 🎉</p>'}`);
}
function planForRange(start, end) {
  const out = [];
  for (const p of S().plan) {
    if (p.day < start || p.day > end || !p.recipeId) continue;
    const r = recipeById(p.recipeId);
    if (r) out.push({ recipe: r });
  }
  return out;
}

// ---------------------------------------------------------------- shopping
function viewShop() {
  const st = stores();
  if (!UI.store || !st.includes(UI.store)) UI.store = st[0];
  const items = S().shopping.filter((s) => s.store === UI.store);
  const open = items.filter((s) => !s.checked), checked = items.filter((s) => s.checked);
  const groups = CATS.map((c) => ({ c, list: open.filter((s) => (s.category || 'other') === c.id).sort((a, b) => a.name.localeCompare(b.name)) })).filter((g) => g.list.length);
  return `<div class="seg wrap">${st.map((s) => `<button class="${s === UI.store ? 'on' : ''}" data-a="k-store" data-s="${esc(s)}">${esc(s)}</button>`).join('')}<button data-a="k-store-new" aria-label="New list">＋</button></div>
    <form data-form="k-shop-add" class="row gap"><input name="name" class="search grow" placeholder="Add item (e.g. 2 lb apples)" autocomplete="off" enterkeyhint="done"><button class="btn" type="submit">Add</button></form>
    <div class="row gap wrap mt"><button class="btn small" data-a="k-staples">⭐ Staples</button><button class="btn small" data-a="k-shop-export">Share list</button>
      <button class="btn small" data-a="k-store-edit">Rename/delete list</button></div>
    ${groups.map((g) => `<section class="card"><h3>${g.c.name}</h3>${g.list.map(shopRow).join('')}</section>`).join('') || `<div class="card muted s">${checked.length ? 'All done!' : 'List is empty.'}</div>`}
    ${checked.length ? `<section class="card"><div class="row between"><h3>In cart (${checked.length})</h3><button class="btn small" data-a="k-shop-clear">Clear checked</button></div>${checked.map(shopRow).join('')}</section>` : ''}`;
}
function shopRow(s) {
  return `<div class="row item shop ${s.checked ? 'checked' : ''}"><button class="tick" data-a="k-shop-toggle" data-id="${s.id}" aria-label="Toggle">${s.checked ? '✓' : ''}</button>
    <div class="grow" data-a="k-shop-toggle" data-id="${s.id}"><div class="t">${esc(s.name)}</div>${s.quantity || s.unit || s.brand ? `<div class="muted s">${qtyText(s.quantity, s.unit)}${s.brand ? ' · ' + esc(s.brand) : ''}</div>` : ''}</div>
    <button class="icon del" data-a="k-shop-edit" data-id="${s.id}" aria-label="Edit">⋯</button></div>`;
}
async function addShopping(items, store) {
  const writes = [];
  for (const it of items) {
    const merged = mergeShopping(S().shopping, it, store);
    if (merged) { writes.push(merged); continue; }
    const rec = { id: uid(), name: it.name, quantity: it.quantity ?? null, unit: it.unit || '', category: it.category || categorize(it.name), store, checked: false, brand: it.brand || '', addedAt: Date.now() };
    S().shopping.push(rec); writes.push(rec);
  }
  await db.putMany('shopping', writes);
}
function shopItemForm(s) {
  C.modal(`<header><h2 class="grow">Edit item</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-shop-item" class="form"><input type="hidden" name="id" value="${s.id}">
      <label>Name<input name="name" value="${esc(s.name)}" required></label>
      <div class="row gap"><label class="grow">Quantity<input name="quantity" type="number" inputmode="decimal" step="any" min="0" value="${s.quantity ?? ''}"></label>
      <label class="grow">Unit<input name="unit" value="${esc(s.unit || '')}"></label></div>
      <label>Aisle<select name="category">${catOptions(s.category)}</select></label>
      <label>Brand<input name="brand" value="${esc(s.brand || '')}"></label>
      <label>List<select name="store">${stores().map((x) => `<option ${x === s.store ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
      <div class="row gap"><button class="btn primary grow" type="submit">Save</button><button class="btn danger" type="button" data-a="k-shop-del" data-id="${s.id}">Delete</button></div></form>`);
}
function staplesForm() {
  const list = set().staples || [];
  C.modal(`<header><h2 class="grow">Staples</h2><button class="btn small" data-a="close">Done</button></header>
    <p class="muted s">Staples are re-added automatically every time you clear checked items.</p>
    <div class="list">${list.map((s) => `<div class="row item"><div class="grow">${esc(s.name)} <span class="muted s">${qtyText(s.quantity, s.unit)} · ${esc(s.store)}</span></div>
      <button class="icon del" data-a="k-staple-del" data-id="${s.id}" aria-label="Remove">✕</button></div>`).join('') || '<div class="muted s empty">No staples yet</div>'}</div>
    <form data-form="k-staple" class="row gap"><input name="name" class="search grow" placeholder="e.g. 1 gal milk" required><button class="btn" type="submit">Add</button></form>`);
}
async function clearChecked(toPantry) {
  const checked = S().shopping.filter((s) => s.store === UI.store && s.checked);
  if (toPantry) await addToPantry(checked.map((s) => ({ name: s.name, quantity: s.quantity || 1, unit: s.unit, category: s.category, brand: s.brand })));
  for (const s of checked) await db.del('shopping', s.id);
  S().shopping = S().shopping.filter((s) => !checked.includes(s));
  const staples = (set().staples || []).filter((st) => st.store === UI.store && !S().shopping.some((s) => s.store === st.store && !s.checked && s.name.toLowerCase() === st.name.toLowerCase()));
  if (staples.length) await addShopping(staples, UI.store);
  await done(`Cleared ${checked.length}${toPantry ? ' · added to pantry' : ''}${staples.length ? ` · ${staples.length} staple${staples.length === 1 ? '' : 's'} re-added` : ''}`);
}
/** "2 lb apples" -> {name, quantity, unit}; plain "apples" -> quantity null. */
function parseShopText(t) {
  const p = parseIngredient(t);
  return { name: p.name, quantity: p.quantity, unit: p.unit };
}

// ---------------------------------------------------------------- more: insights, receipts, household
function viewMore() {
  const today = dayStr();
  const { targets } = C.insights();
  const totals = {};
  for (const e of S().entries) { const n = C.entryN(e); const t = totals[e.day] || { ...ZERO }; totals[e.day] = sum([t, n]); }
  const tr = nutritionTrends(totals, targets, { weeks: 4, today });
  const sp = spendingSummary(S().receipts, { period: UI.period, today });
  const rs = restockPredictions(S().receipts, today).slice(0, 8);
  const profs = set().profiles || [];
  const change = sp.prevTotal ? ((sp.total - sp.prevTotal) / sp.prevTotal) * 100 : null;
  return `<section class="card"><h3>Nutrition — last 4 weeks</h3>
      ${tr.loggedDays ? `<div class="stats mt"><div><div class="muted s">On target (±10%)</div><div class="big sm">${Math.round(tr.hitRate * 100)}%</div></div>
        <div><div class="muted s">Logged days</div><div class="big sm">${tr.loggedDays}</div></div></div>
        <table class="tbl"><tr><th>Week</th><th>kcal</th><th>P</th><th>C</th><th>F</th></tr>${tr.weeks.map((w) => `<tr><td>${parseDay(w.start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
          ${w.loggedDays ? `<td>${f0(w.avg.cal)}</td><td>${f0(w.avg.protein)}</td><td>${f0(w.avg.carbs)}</td><td>${f0(w.avg.fat)}</td>` : '<td colspan="4" class="muted">no logs</td>'}</tr>`).join('')}
          <tr class="muted"><td>Target</td><td>${f0(targets.cal)}</td><td>${f0(targets.protein)}</td><td>${f0(targets.carbs)}</td><td>${f0(targets.fat)}</td></tr></table>
        ${tr.deficits.map((d) => `<div class="s">⬇️ <b>${d.name}</b> averages ${f0(d.avg)} ${d.unit} vs ${f0(d.target)} ${d.unit} target</div>`).join('')}`
    : '<div class="muted s">Log some food to see trends.</div>'}</section>
    <section class="card"><div class="row between"><h3>Spending</h3><button class="btn small" data-a="k-receipt">+ Receipt</button></div>
      <div class="seg mt">${['week', 'month', 'quarter', 'year'].map((p) => `<button class="${UI.period === p ? 'on' : ''}" data-a="k-period" data-p="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      <div class="big">${money(sp.total)} <span class="s muted">${sp.trips} trip${sp.trips === 1 ? '' : 's'}${change != null ? ` · ${change > 0 ? '+' : ''}${Math.round(change)}% vs previous` : ''}</span></div>
      ${sp.byStore.map((s) => `<div class="row between s"><span>${esc(s.name)}</span><span>${money(s.amount)}</span></div>`).join('')}
      ${sp.topItems.length ? `<h4>Top items</h4>${sp.topItems.map((s) => `<div class="row between s"><span>${esc(s.name)}</span><span>${money(s.amount)}</span></div>`).join('')}` : ''}</section>
    ${rs.length ? `<section class="card"><h3>Running low soon</h3><p class="muted s">Based on how often you buy things.</p>${rs.map((r) => `<div class="row item"><div class="grow">${esc(r.name)} <span class="muted s">every ~${r.everyDays} days</span></div>
      <span class="badge ${r.daysUntil <= 0 ? 'bad' : r.daysUntil <= 3 ? 'soon' : ''}">${r.daysUntil <= 0 ? 'due' : 'in ' + r.daysUntil + 'd'}</span>
      <button class="icon del" data-a="k-restock-add" data-name="${esc(r.name)}" aria-label="Add to list">＋</button></div>`).join('')}</section>` : ''}
    <section class="card"><div class="row between"><h3>Household</h3><button class="btn small" data-a="k-profile-new">+ Person</button></div>
      <p class="muted s">Diets, allergies and dislikes are used to flag and filter recipes.</p>
      ${profs.map((p) => `<div class="row item" data-a="k-profile" data-id="${p.id}"><div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="muted s">${esc([...(p.diets || []), ...(p.exclusions || []).map((x) => 'no ' + x)].join(', ') || 'No restrictions')}</div></div></div>`).join('')}
      <button class="btn small mt" data-a="k-themes">Day themes (e.g. Taco Tuesday)</button></section>
    <section class="card"><h3>Receipts</h3>${[...S().receipts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20).map((r) => `<div class="row item"><div class="grow">${parseDay(r.date).toLocaleDateString()} · ${esc(r.store || 'Unknown')}
      <span class="muted s">${r.items.length} items</span></div><div class="kcal">${money(r.total ?? r.items.reduce((a, i) => a + (i.price || 0), 0))}</div>
      <button class="icon del" data-a="k-receipt-del" data-id="${r.id}" aria-label="Delete">✕</button></div>`).join('') || '<div class="muted s empty">No receipts yet</div>'}</section>`;
}
function profileForm(p) {
  const x = p || { name: '', diets: [], exclusions: [], dislikes: [], likes: [], notes: '' };
  C.modal(`<header><h2 class="grow">${p ? esc(p.name) : 'New person'}</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-profile" class="form"><input type="hidden" name="id" value="${esc(p?.id || '')}">
      <label>Name<input name="name" value="${esc(x.name)}" required></label>
      <div class="muted s">Diets</div><div class="row gap wrap">${DIETS.map((d) => `<label class="check chip"><input type="checkbox" name="diet" value="${d}" ${x.diets.includes(d) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
      <label>Allergies / never eats (comma-separated)<input name="exclusions" value="${esc(x.exclusions.join(', '))}" placeholder="shellfish, peanuts"></label>
      <label>Dislikes<input name="dislikes" value="${esc(x.dislikes.join(', '))}" placeholder="cilantro, olives"></label>
      <label>Likes<input name="likes" value="${esc(x.likes.join(', '))}" placeholder="spicy, Italian"></label>
      <label>Notes<textarea name="notes" rows="2">${esc(x.notes)}</textarea></label>
      <div class="row gap"><button class="btn primary grow" type="submit">Save</button>${p ? `<button class="btn danger" type="button" data-a="k-profile-del" data-id="${p.id}">Delete</button>` : ''}</div></form>`);
}

// ================================================================ actions
export const actions = {
  'k-sub': (el) => { UI.sub = el.dataset.k; C.render(); window.scrollTo(0, 0); },
  // pantry
  'k-pantry-add': () => pantryForm(null),
  'k-pantry-edit': (el) => pantryForm(S().pantry.find((p) => p.id === el.dataset.id)),
  'k-pantry-use': async (el) => { await db.del('pantry', el.dataset.id); await done('Removed from pantry'); },
  'k-clear-expired': async () => {
    const ex = S().pantry.filter((p) => expiryStatus(p.expiresAt, dayStr()) === 'expired');
    if (!confirm(`Remove ${ex.length} expired item${ex.length === 1 ? '' : 's'}?`)) return;
    for (const p of ex) await db.del('pantry', p.id);
    await done('Cleared');
  },
  'k-leftover': () => C.modal(`<header><h2 class="grow">Add leftovers</h2><button class="btn small" data-a="close">Cancel</button></header>
    <form data-form="k-leftover" class="form"><label>What is it?<input name="name" required placeholder="Chicken stir-fry"></label>
      <div class="row gap"><label class="grow">Portions<input name="quantity" type="number" inputmode="decimal" min="0" step="any" value="1"></label>
      <label class="grow">Keeps for (days)<input name="days" type="number" inputmode="numeric" min="1" max="30" value="4"></label></div>
      <label>From (optional)<input name="sourceMeal" placeholder="Tuesday dinner"></label><button class="btn primary" type="submit">Save</button></form>`),
  'k-receipt': receiptForm,
  'k-receipt-del': async (el) => { if (confirm('Delete this receipt? Pantry items stay.')) { await db.del('receipts', el.dataset.id); await done(); } },
  // recipes
  'k-recipe-new': () => recipeForm(null),
  'k-recipe-paste': () => C.modal(`<header><h2 class="grow">Paste a recipe</h2><button class="btn small" data-a="close">Cancel</button></header>
    <p class="muted s">Copy the recipe text from a website or notes app (title, ingredients, instructions) and paste it here. You can review everything before saving.</p>
    <form data-form="k-paste" class="form"><textarea name="text" rows="12" required placeholder="Garlic Chicken\nServes 4\n\nIngredients\n500 g chicken breast\n3 cloves garlic\n\nInstructions\n1. …"></textarea>
      <button class="btn primary" type="submit">Continue</button></form>`),
  'k-recipe': (el) => recipeDetail(recipeById(el.dataset.id)),
  'k-recipe-edit': (el) => recipeForm(recipeById(el.dataset.id)),
  'k-recipe-del': async (el) => {
    if (!confirm('Delete this recipe?')) return;
    await db.del('recipes', el.dataset.id);
    for (const c of S().collections.filter((c) => c.recipeIds.includes(el.dataset.id))) await db.put('collections', { ...c, recipeIds: c.recipeIds.filter((id) => id !== el.dataset.id) });
    await done('Deleted');
  },
  'k-rate': async (el) => { const r = recipeById(el.dataset.id); r.rating = +el.dataset.n; await db.put('recipes', r); await C.reload(); recipeDetail(recipeById(r.id)); },
  'k-estimate': () => {
    const r = { servings: parseFloat($('[name=servings]').value) || 1, ingredients: parseIngredientsText($('#k-ing').value) };
    const e = estimateRecipeMacros(r, S().foods);
    if (!e.matched) { $('#k-est').textContent = 'No ingredients matched. Use weights (g, oz, lb) and names of foods in your library.'; return; }
    for (const k of ['cal', 'protein', 'carbs', 'fat', 'fiber']) $(`#k-m-${k}`).value = f1(e.perServing[k]);
    $('#k-est').textContent = `Estimated from ${e.matched} of ${e.total} ingredients — the rest weren't matched, so totals may be low.`;
  },
  'k-cook': (el) => cookForm(recipeById(el.dataset.id)),
  'k-plan-recipe': (el) => slotForm(dayStr(), 'dinner', el.dataset.id),
  'k-recipe-shop': (el) => { const r = recipeById(el.dataset.id); shopPreview(shoppingFromPlan([{ recipe: r }], S().pantry), `Missing for ${r.name}`); },
  'k-recipe-share': async (el) => {
    const r = recipeById(el.dataset.id);
    const text = `${r.name}\n${r.servings} servings\n\nIngredients\n${ingredientsText(r.ingredients)}\n\nInstructions\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    try { if (navigator.share) await navigator.share({ title: r.name, text }); else { await navigator.clipboard.writeText(text); C.toast('Copied to clipboard'); } } catch { /* cancelled */ }
  },
  'k-variant': (el) => {
    const r = recipeById(el.dataset.id);
    C.modal(`<header><button class="btn small ghost" data-a="k-recipe" data-id="${r.id}">‹ Back</button><h2 class="grow">Swap an ingredient</h2></header>
      <form data-form="k-variant" class="form"><input type="hidden" name="id" value="${r.id}">
        <label>Replace<select name="from">${r.ingredients.map((i, ix) => `<option value="${ix}">${esc(i.name)}</option>`).join('')}</select></label>
        <label>With<input name="to" required placeholder="e.g. lentils"></label>
        <label class="check"><input type="checkbox" name="saveAs" checked> Save as a new variant (keeps the original)</label>
        <p class="muted s">Nutrition is copied from the original — re-estimate it after saving if the swap changes it a lot.</p>
        <button class="btn primary" type="submit">Apply</button></form>`);
  },
  'k-collect': (el) => {
    const r = recipeById(el.dataset.id);
    C.modal(`<header><button class="btn small ghost" data-a="k-recipe" data-id="${r.id}">‹ Back</button><h2 class="grow">Collections</h2></header>
      <form data-form="k-collect" class="form"><input type="hidden" name="id" value="${r.id}">
        <div class="list">${S().collections.map((c) => `<label class="check row item"><input type="checkbox" name="c" value="${c.id}" ${c.recipeIds.includes(r.id) ? 'checked' : ''}> <span class="grow">${esc((c.emoji || '📁') + ' ' + c.name)}</span></label>`).join('') || '<div class="muted s empty">No collections yet</div>'}</div>
        <label>New collection<input name="newName" placeholder="Weeknight dinners"></label>
        <button class="btn primary" type="submit">Save</button></form>`);
  },
  // plan
  'k-week': (el) => { UI.week = +el.dataset.d ? addDays(UI.week, +el.dataset.d) : weekStart(dayStr()); C.render(); },
  'k-slot': (el) => slotForm(el.dataset.day, el.dataset.slot),
  'k-slot-clear': async (el) => { await db.del('plan', el.dataset.key); await done('Cleared'); },
  'k-slot-log': async (el) => {
    const p = S().plan.find((x) => x.key === el.dataset.key);
    const r = p.recipeId && recipeById(p.recipeId);
    if (!r?.macros) return C.toast(r ? 'Add nutrition to this recipe first' : 'Only recipes with nutrition can be logged');
    await logRecipeToDiary(r, p.eatServings || 1, p.slot, p.day);
    await db.put('plan', { ...p, logged: true });
    await done('Logged to diary');
  },
  'k-plan-shop': () => {
    const start = UI.week < dayStr() ? dayStr() : UI.week;
    shopPreview(shoppingFromPlan(planForRange(start, addDays(UI.week, 6)), S().pantry), 'Shop for this week');
  },
  // shopping
  'k-store': (el) => { UI.store = el.dataset.s; C.render(); },
  'k-store-new': async () => {
    const n = prompt('Name of the new list (e.g. Costco):')?.trim();
    if (!n || stores().includes(n)) return;
    set().stores = [...stores(), n]; C.saveSettings(); UI.store = n; C.render();
  },
  'k-store-edit': async () => {
    const n = prompt(`Rename "${UI.store}" (leave empty to delete the list):`, UI.store);
    if (n === null) return;
    const name = n.trim();
    const items = S().shopping.filter((s) => s.store === UI.store);
    if (!name) {
      if (stores().length === 1) return C.toast('You need at least one list');
      if (!confirm(`Delete "${UI.store}" and its ${items.length} items?`)) return;
      for (const s of items) await db.del('shopping', s.id);
      set().stores = stores().filter((s) => s !== UI.store);
      set().staples = (set().staples || []).filter((s) => s.store !== UI.store);
    } else {
      await db.putMany('shopping', items.map((s) => ({ ...s, store: name })));
      set().stores = stores().map((s) => (s === UI.store ? name : s));
      set().staples = (set().staples || []).map((s) => (s.store === UI.store ? { ...s, store: name } : s));
      UI.store = name;
    }
    C.saveSettings(); await done();
  },
  'k-shop-toggle': async (el) => { const s = S().shopping.find((x) => x.id === el.dataset.id); s.checked = !s.checked; await db.put('shopping', s); C.render(); },
  'k-shop-edit': (el) => shopItemForm(S().shopping.find((x) => x.id === el.dataset.id)),
  'k-shop-del': async (el) => { await db.del('shopping', el.dataset.id); await done(); },
  'k-shop-clear': () => C.modal(`<header><h2 class="grow">Clear checked items</h2><button class="btn small" data-a="close">Cancel</button></header>
    <p>Add the items you bought to your pantry too?</p>
    <div class="row gap"><button class="btn primary grow" data-a="k-shop-clear-go" data-p="1">Yes, add to pantry</button><button class="btn" data-a="k-shop-clear-go" data-p="0">Just clear</button></div>`),
  'k-shop-clear-go': (el) => clearChecked(el.dataset.p === '1'),
  'k-shop-export': async () => {
    const open = S().shopping.filter((s) => s.store === UI.store && !s.checked);
    const text = `${UI.store}\n` + CATS.map((c) => { const l = open.filter((s) => s.category === c.id); return l.length ? `\n${c.name}\n${l.map((s) => `• ${s.name}${s.quantity || s.unit ? ' — ' + qtyText(s.quantity, s.unit) : ''}`).join('\n')}` : ''; }).join('');
    try { if (navigator.share) await navigator.share({ title: UI.store, text }); else { await navigator.clipboard.writeText(text); C.toast('Copied to clipboard'); } } catch { /* cancelled */ }
  },
  'k-staples': staplesForm,
  'k-staple-del': async (el) => { set().staples = (set().staples || []).filter((s) => s.id !== el.dataset.id); C.saveSettings(); staplesForm(); },
  'k-restock-add': async (el) => { await addShopping([{ name: el.dataset.name }], stores()[0]); await C.reload(); C.toast(`Added to ${stores()[0]}`); },
  // more
  'k-period': (el) => { UI.period = el.dataset.p; C.render(); },
  'k-profile-new': () => profileForm(null),
  'k-profile': (el) => profileForm((set().profiles || []).find((p) => p.id === el.dataset.id)),
  'k-profile-del': (el) => { if (!confirm('Delete this person?')) return; set().profiles = set().profiles.filter((p) => p.id !== el.dataset.id); C.saveSettings(); C.closeModal(); C.render(); },
  'k-themes': () => {
    const t = set().dayThemes || {};
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    C.modal(`<header><h2 class="grow">Day themes</h2><button class="btn small" data-a="close">Cancel</button></header>
      <form data-form="k-themes" class="form">${days.map((d) => `<label>${d[0].toUpperCase() + d.slice(1)}<input name="${d}" value="${esc(t[d] || '')}" maxlength="22" placeholder="${d === 'tuesday' ? 'Taco Tuesday' : ''}"></label>`).join('')}
      <button class="btn primary" type="submit">Save</button></form>`);
  },
};

// ================================================================ forms
const num = (fd, k) => { const v = parseFloat(fd.get(k)); return Number.isFinite(v) ? v : null; };
export const forms = {
  async 'k-pantry'(fd) {
    const id = fd.get('id');
    const ex = id && S().pantry.find((p) => p.id === id);
    const name = fd.get('name').trim();
    const category = fd.get('category') || ex?.category || categorize(name);
    const rec = { ...(ex || { id: uid(), addedAt: dayStr() }), name, quantity: num(fd, 'quantity') ?? 1, unit: fd.get('unit').trim(), category,
      brand: fd.get('brand').trim(), alwaysOnHand: fd.get('alwaysOnHand') === 'on',
      expiresAt: fd.get('expiresAt') || (ex ? null : defaultExpiry(category, dayStr())) };
    await db.put('pantry', rec); await done('Saved');
  },
  async 'k-leftover'(fd) {
    await db.put('pantry', { id: uid(), name: fd.get('name').trim(), quantity: num(fd, 'quantity') ?? 1, unit: 'portion', category: 'leftovers', isLeftover: true,
      sourceMeal: fd.get('sourceMeal').trim(), expiresAt: addDays(dayStr(), num(fd, 'days') || 4), addedAt: dayStr() });
    await done('Leftovers saved');
  },
  async 'k-receipt'(fd) {
    const { items, total } = parseReceiptText(fd.get('text'));
    if (!items.length) return C.toast('No items found');
    const date = fd.get('date'), store = fd.get('store').trim();
    await db.put('receipts', { id: uid(), date, store, total, items });
    if (fd.get('toPantry') === 'on') {
      await addToPantry(items.map((i) => ({ name: i.name, quantity: i.quantity })), date);
      const toCheck = S().shopping.filter((s) => !s.checked && items.some((i) => namesMatch(i.name, s.name)));
      await db.putMany('shopping', toCheck.map((s) => ({ ...s, checked: true })));
    }
    await done(`Saved ${items.length} items`);
  },
  async 'k-paste'(fd) {
    const r = parseRecipeText(fd.get('text'));
    recipeForm({ ...r, servings: r.servings || 2, tags: [], macros: null });
  },
  async 'k-recipe'(fd) {
    const id = fd.get('id');
    const ex = id && recipeById(id);
    const ings = parseIngredientsText(fd.get('ingredients'));
    if (!ings.length) return C.toast('Add at least one ingredient');
    const mac = { cal: num(fd, 'cal'), protein: num(fd, 'protein') ?? 0, carbs: num(fd, 'carbs') ?? 0, fat: num(fd, 'fat') ?? 0, fiber: num(fd, 'fiber') ?? 0 };
    const rec = {
      ...(ex || { id: uid(), createdAt: new Date().toISOString(), timesCooked: 0, rating: 0 }),
      name: fd.get('name').trim(), servings: Math.max(1, num(fd, 'servings') || 1), prepTime: num(fd, 'prepTime') || 0, cookTime: num(fd, 'cookTime') || 0,
      difficulty: fd.get('difficulty'), tags: splitList(fd.get('tags')), ingredients: ings,
      steps: String(fd.get('steps')).split('\n').map((s) => s.trim()).filter(Boolean),
      macros: mac.cal != null ? mac : null, notes: fd.get('notes').trim(), sourceUrl: fd.get('sourceUrl').trim(), parentId: fd.get('parentId') || ex?.parentId || null,
    };
    await db.put('recipes', rec); await C.reload(); C.render(); recipeDetail(recipeById(rec.id)); C.toast('Recipe saved');
  },
  async 'k-variant'(fd) {
    const r = recipeById(fd.get('id'));
    const ix = +fd.get('from'), to = fd.get('to').trim();
    const ingredients = r.ingredients.map((i, n) => (n === ix ? { ...i, name: to } : i));
    if (fd.get('saveAs') === 'on') {
      const v = { ...structuredClone(r), id: uid(), name: `${r.name} (with ${to})`, ingredients, parentId: r.id, createdAt: new Date().toISOString(), timesCooked: 0, rating: 0 };
      await db.put('recipes', v); await C.reload(); C.render(); recipeDetail(recipeById(v.id));
    } else { await db.put('recipes', { ...r, ingredients }); await C.reload(); C.render(); recipeDetail(recipeById(r.id)); }
    C.toast('Swapped');
  },
  async 'k-collect'(fd) {
    const id = fd.get('id');
    const chosen = new Set(fd.getAll('c'));
    for (const c of S().collections) {
      const has = c.recipeIds.includes(id);
      if (has !== chosen.has(c.id)) await db.put('collections', { ...c, recipeIds: has ? c.recipeIds.filter((x) => x !== id) : [...c.recipeIds, id] });
    }
    const nn = fd.get('newName').trim();
    if (nn) await db.put('collections', { id: uid(), name: nn, emoji: '', recipeIds: [id] });
    await C.reload(); recipeDetail(recipeById(id)); C.toast('Saved');
  },
  async 'k-cook'(fd) {
    const r = recipeById(fd.get('id'));
    const cooked = num(fd, 'cooked') ?? r.servings, eaten = num(fd, 'eaten') ?? 1;
    const notes = [];
    if (fd.get('log') === 'on' && r.macros && eaten > 0) { await logRecipeToDiary(r, eaten, fd.get('meal'), dayStr()); notes.push('logged'); }
    if (fd.get('deduct') === 'on') {
      const ch = planDeduction(S().pantry, r, cooked / Math.max(1, r.servings));
      for (const c of ch) {
        if (c.quantity == null) await db.del('pantry', c.id);
        else await db.put('pantry', { ...S().pantry.find((p) => p.id === c.id), quantity: c.quantity });
      }
      if (ch.length) notes.push(`${ch.length} pantry item${ch.length === 1 ? '' : 's'} updated`);
    }
    const left = cooked - eaten;
    if (fd.get('leftovers') === 'on' && left > 0) {
      await db.put('pantry', { id: uid(), name: `${r.name} (leftovers)`, quantity: Math.round(left * 10) / 10, unit: 'portion', category: 'leftovers', isLeftover: true,
        sourceRecipe: r.id, sourceMeal: parseDay(dayStr()).toLocaleDateString(undefined, { weekday: 'long' }), expiresAt: addDays(dayStr(), 4), addedAt: dayStr() });
      notes.push(`${f1(left)} leftover portion${left === 1 ? '' : 's'} saved`);
    }
    await db.put('recipes', { ...r, timesCooked: (r.timesCooked || 0) + 1, lastCooked: dayStr() });
    await done(notes.length ? notes.join(' · ') : 'Nice!');
  },
  async 'k-slot'(fd) {
    const key = fd.get('key');
    const [day, slot] = key.split('|');
    const recipeId = fd.get('recipeId'), text = fd.get('text').trim();
    if (!recipeId && !text) { await db.del('plan', key); return done(); }
    const ex = S().plan.find((p) => p.key === key);
    await db.put('plan', { key, day, slot, recipeId: recipeId || null, text: recipeId ? '' : text, sides: splitList(fd.get('sides')),
      eatServings: num(fd, 'eatServings') || 1, logged: ex && ex.recipeId === (recipeId || null) ? ex.logged : false });
    UI.sub = 'plan'; UI.week = weekStart(day);
    await done('Planned');
  },
  async 'k-slot-move'(fd) {
    const from = S().plan.find((p) => p.key === fd.get('key'));
    const toKey = `${fd.get('toDay')}|${fd.get('toSlot')}`;
    if (toKey === from.key) return C.closeModal();
    const target = S().plan.find((p) => p.key === toKey);
    const mode = fd.get('mode');
    const [d, s] = toKey.split('|');
    await db.put('plan', { ...from, key: toKey, day: d, slot: s, logged: false });
    if (mode === 'move') await db.del('plan', from.key);
    if (mode === 'swap') { if (target) await db.put('plan', { ...target, key: from.key, day: from.day, slot: from.slot, logged: false }); else await db.del('plan', from.key); }
    await done(mode === 'copy' ? 'Copied' : mode === 'swap' ? 'Swapped' : 'Moved');
  },
  async 'k-shop-preview'(fd) {
    const items = PREVIEW.filter((_, i) => fd.get(`i${i}`) === 'on');
    const store = fd.get('store');
    await addShopping(items, store);
    UI.sub = 'shop'; UI.store = store;
    await done(`Added ${items.length} to ${store}`);
  },
  async 'k-shop-add'(fd) {
    const t = String(fd.get('name')).trim();
    if (!t) return;
    await addShopping([parseShopText(t)], UI.store);
    await C.reload(); C.render(); $('[data-form="k-shop-add"] input')?.focus();
  },
  async 'k-shop-item'(fd) {
    const s = S().shopping.find((x) => x.id === fd.get('id'));
    await db.put('shopping', { ...s, name: fd.get('name').trim(), quantity: num(fd, 'quantity'), unit: fd.get('unit').trim(), category: fd.get('category'), brand: fd.get('brand').trim(), store: fd.get('store') });
    await done('Saved');
  },
  async 'k-staple'(fd) {
    const p = parseShopText(String(fd.get('name')).trim());
    set().staples = [...(set().staples || []), { id: uid(), ...p, category: categorize(p.name), store: UI.store || stores()[0] }];
    C.saveSettings(); staplesForm();
  },
  async 'k-profile'(fd) {
    const id = fd.get('id') || uid();
    const rec = { id, name: fd.get('name').trim(), diets: fd.getAll('diet'), exclusions: splitList(fd.get('exclusions')), dislikes: splitList(fd.get('dislikes')), likes: splitList(fd.get('likes')), notes: fd.get('notes').trim() };
    const list = set().profiles || [];
    set().profiles = list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? rec : p)) : [...list, rec];
    C.saveSettings(); C.closeModal(); C.render(); C.toast('Saved');
  },
  async 'k-themes'(fd) {
    const t = {};
    for (const [k, v] of fd.entries()) if (String(v).trim()) t[k] = String(v).trim();
    set().dayThemes = t; C.saveSettings(); C.closeModal(); C.render();
  },
};

// ================================================================ live inputs
export function onInput(e) {
  const id = e.target.id;
  if (id === 'k-pantry-q') { UI.pantryQ = e.target.value; $('#k-pantry-list').innerHTML = pantryBody(); return true; }
  if (id === 'k-recipe-q') { UI.recipeQ = e.target.value; $('#k-recipe-list').innerHTML = recipeRows(); return true; }
  if (id === 'k-canmake') { UI.canMake = e.target.checked; $('#k-recipe-list').innerHTML = recipeRows(); return true; }
  if (id === 'k-sort') { UI.sort = e.target.value; $('#k-recipe-list').innerHTML = recipeRows(); return true; }
  if (id === 'k-col') { UI.collection = e.target.value; $('#k-recipe-list').innerHTML = recipeRows(); return true; }
  if (id === 'k-for') { UI.forProfile = e.target.value; $('#k-recipe-list').innerHTML = recipeRows(); return true; }
  if (id === 'k-receipt-text') { receiptPreview(); return true; }
  return false;
}
