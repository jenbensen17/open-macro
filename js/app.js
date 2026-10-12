import {
  dayStr, addDays, parseDay, forGrams, sum, scale, ZERO, trendSeries, weeklyRate, formulaTdee,
  estimateExpenditure, computeTargets, kgToDisplay, displayToKg, ACTIVITY, recipePer100,
} from './core.js';
import * as db from './db.js';
import { offSearch, usdaSearch, lookupBarcode } from './api.js';
import { startScan } from './scanner.js';

// ---------------------------------------------------------------- state
const MEALS = [
  { k: 'breakfast', n: 'Breakfast' }, { k: 'lunch', n: 'Lunch' },
  { k: 'dinner', n: 'Dinner' }, { k: 'snacks', n: 'Snacks' },
];
const DEFAULTS = {
  setup: false, sex: 'male', birthYear: 1995, heightCm: 175, activity: 'light', useLb: true,
  rate: -0.5, proteinPerKg: 2.0, fatPct: 0.3, startKg: 80, usdaKey: 'DEMO_KEY',
};
const S = { tab: 'diary', day: dayStr(), foods: [], entries: [], weights: [], range: 90, settings: loadSettings() };

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('om.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings() { localStorage.setItem('om.settings', JSON.stringify(S.settings)); }

async function reload() {
  [S.foods, S.entries, S.weights] = await Promise.all([db.all('foods'), db.all('entries'), db.all('weights')]);
}

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f0 = (n) => Math.round(n).toLocaleString();
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const uid = () => crypto.randomUUID();
const unit = () => (S.settings.useLb ? 'lb' : 'kg');
const entryN = (e) => forGrams(e.per100, e.grams);
const mealName = (k) => MEALS.find((m) => m.k === k)?.n ?? k;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function prettyDay(d) {
  const t = dayStr();
  if (d === t) return 'Today';
  if (d === addDays(t, -1)) return 'Yesterday';
  if (d === addDays(t, 1)) return 'Tomorrow';
  return parseDay(d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function insights() {
  const s = S.settings;
  const series = trendSeries(S.weights);
  const weightKg = series.length ? series[series.length - 1].trend : s.startKg;
  const age = new Date().getFullYear() - s.birthYear;
  const formula = formulaTdee({ sex: s.sex, weightKg, heightCm: s.heightCm, age, activity: s.activity });
  const intakeByDay = {};
  for (const e of S.entries) intakeByDay[e.day] = (intakeByDay[e.day] || 0) + entryN(e).cal;
  const est = estimateExpenditure({ intakeByDay, weights: S.weights, formula, today: dayStr() });
  const targets = computeTargets({ tdee: est.kcal, rateKgPerWeek: s.rate, weightKg, proteinPerKg: s.proteinPerKg, fatPct: s.fatPct });
  return { series, weightKg, formula, est, targets, rate: weeklyRate(series) };
}

// ---------------------------------------------------------------- modal
function modal(html) { $('#modal').innerHTML = `<div class="sheet">${html}</div>`; $('#modal').classList.add('open'); }
function closeModal() { A = null; stopScanner(); $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; }
let stopFn = null;
function stopScanner() { if (stopFn) { stopFn(); stopFn = null; } }

// ---------------------------------------------------------------- views
function render() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === S.tab));
  const v = $('#view');
  const nav = document.querySelector('nav');
  if (!S.settings.setup) { nav.style.display = 'none'; v.innerHTML = viewSettings(true); return; }
  nav.style.display = '';
  v.innerHTML = { diary: viewDiary, weight: viewWeight, foods: viewFoods, settings: () => viewSettings(false) }[S.tab]();
}

function ring(consumed, target) {
  const r = 52, c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, consumed / target));
  const over = consumed > target;
  return `<svg viewBox="0 0 120 120" class="ring"><circle cx="60" cy="60" r="${r}" class="ring-bg"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fg ${over ? 'over' : ''}" stroke-dasharray="${c * pct} ${c}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" class="ring-n">${f0(Math.abs(target - consumed))}</text>
    <text x="60" y="76" class="ring-l">${over ? 'over' : 'left'}</text></svg>`;
}

function bar(label, v, t, cls) {
  const pct = Math.max(0, Math.min(100, (v / Math.max(t, 1)) * 100));
  return `<div class="mbar"><div class="mbar-top"><span>${label}</span><span>${f0(v)} / ${f0(t)} g</span></div>
    <div class="track"><div class="fill ${cls}" style="width:${pct}%"></div></div></div>`;
}

function viewDiary() {
  const { targets } = insights();
  const entries = S.entries.filter((e) => e.day === S.day);
  const total = sum(entries.map(entryN));
  const yesterday = addDays(S.day, -1);
  const meals = MEALS.map((m) => {
    const list = entries.filter((e) => e.meal === m.k).sort((a, b) => a.ts - b.ts);
    const mt = sum(list.map(entryN));
    const canCopy = S.entries.some((e) => e.day === yesterday && e.meal === m.k);
    return `<section class="card meal">
      <div class="meal-h"><h3>${m.n}</h3><span class="muted">${f0(mt.cal)} kcal</span></div>
      ${list.map((e) => { const n = entryN(e); return `<div class="row item" data-a="edit-entry" data-id="${e.id}">
        <div class="grow"><div class="t">${esc(e.name)}</div><div class="muted s">${esc(e.brand ? e.brand + ' · ' : '')}${f0(e.grams)} g · P${f0(n.protein)} C${f0(n.carbs)} F${f0(n.fat)}</div></div>
        <div class="kcal">${f0(n.cal)}</div></div>`; }).join('') || '<div class="muted s empty">Nothing logged</div>'}
      <div class="row gap"><button class="btn small" data-a="add" data-meal="${m.k}">+ Add food</button>
      ${canCopy ? `<button class="btn small ghost" data-a="copy-meal" data-meal="${m.k}">Copy from yesterday</button>` : ''}</div>
    </section>`;
  }).join('');
  return `<div class="datebar"><button class="icon" data-a="day" data-d="-1" aria-label="Previous day">‹</button>
      <button class="datelabel" data-a="today">${prettyDay(S.day)}</button>
      <button class="icon" data-a="day" data-d="1" aria-label="Next day">›</button></div>
    <section class="card summary">${ring(total.cal, targets.cal)}
      <div class="grow"><div class="big">${f0(total.cal)} <span class="muted s">/ ${f0(targets.cal)} kcal</span></div>
      ${bar('Protein', total.protein, targets.protein, 'p')}${bar('Carbs', total.carbs, targets.carbs, 'c')}${bar('Fat', total.fat, targets.fat, 'f')}</div></section>
    ${meals}`;
}

function lineChart(series, days) {
  const cutoff = days ? addDays(dayStr(), -days) : '0000';
  const pts = series.filter((p) => p.day >= cutoff);
  if (pts.length < 2) return '<div class="muted s empty">Log at least two weigh-ins to see your trend.</div>';
  const W = 340, H = 190, L = 34, R = 8, T = 10, B = 22;
  const vals = pts.flatMap((p) => [kgToDisplay(p.kg, S.settings.useLb), kgToDisplay(p.trend, S.settings.useLb)]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.15, 0.5); lo -= pad; hi += pad;
  const t0 = parseDay(pts[0].day).getTime(), t1 = parseDay(pts[pts.length - 1].day).getTime();
  const x = (d) => L + ((parseDay(d).getTime() - t0) / Math.max(t1 - t0, 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const trend = pts.map((p) => `${x(p.day).toFixed(1)},${y(kgToDisplay(p.trend, S.settings.useLb)).toFixed(1)}`).join(' ');
  const dots = pts.map((p) => `<circle cx="${x(p.day).toFixed(1)}" cy="${y(kgToDisplay(p.kg, S.settings.useLb)).toFixed(1)}" r="2.6" class="dot"/>`).join('');
  const fmtD = (d) => parseDay(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Weight chart">
    <text x="2" y="${T + 8}" class="axis">${f1(hi)}</text><text x="2" y="${H - B}" class="axis">${f1(lo)}</text>
    <line x1="${L}" x2="${W - R}" y1="${H - B + 4}" y2="${H - B + 4}" class="grid"/>
    ${dots}<polyline points="${trend}" class="trend"/>
    <text x="${L}" y="${H - 4}" class="axis">${fmtD(pts[0].day)}</text>
    <text x="${W - R}" y="${H - 4}" class="axis" text-anchor="end">${fmtD(pts[pts.length - 1].day)}</text></svg>`;
}

function viewWeight() {
  const ins = insights();
  const last = ins.series[ins.series.length - 1];
  const recent = [...S.weights].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 30);
  const rate = ins.rate == null ? '—' : `${ins.rate > 0 ? '+' : ''}${f1(kgToDisplay(ins.rate, S.settings.useLb))} ${unit()}/wk`;
  const srcText = { formula: 'Formula estimate — log weight and food for 1–2 weeks to personalize it.',
    blended: `Blending your data with the formula (${ins.est.loggedDays} logged days over ${ins.est.spanDays} days).`,
    adaptive: `Based on ${ins.est.loggedDays} logged days over ${ins.est.spanDays} days.` }[ins.est.source];
  return `<div class="row between"><h2>Weight</h2><button class="btn" data-a="weigh">+ Weigh-in</button></div>
    <section class="card stats">
      <div><div class="muted s">Trend</div><div class="big">${last ? f1(kgToDisplay(last.trend, S.settings.useLb)) : '—'}<span class="s muted"> ${unit()}</span></div></div>
      <div><div class="muted s">Rate</div><div class="big sm">${rate}</div></div>
      <div><div class="muted s">Last</div><div class="big sm">${last ? f1(kgToDisplay(last.kg, S.settings.useLb)) : '—'}</div></div>
    </section>
    <section class="card"><div class="seg">${[[30, '1M'], [90, '3M'], [365, '1Y'], [0, 'All']].map(([d, l]) =>
    `<button class="${S.range === d ? 'on' : ''}" data-a="range" data-d="${d}">${l}</button>`).join('')}</div>
      ${lineChart(ins.series, S.range)}</section>
    <section class="card"><div class="muted s">Estimated expenditure</div>
      <div class="big">${f0(ins.est.kcal)} <span class="s muted">kcal/day</span></div><div class="muted s">${srcText}</div>
      <div class="muted s">Daily target: <b>${f0(ins.targets.cal)} kcal</b> · P${f0(ins.targets.protein)} C${f0(ins.targets.carbs)} F${f0(ins.targets.fat)}</div></section>
    <section class="card"><h3>History</h3>${recent.map((w) => `<div class="row item"><div class="grow">${prettyDay(w.day)}</div>
      <div class="kcal">${f1(kgToDisplay(w.kg, S.settings.useLb))} ${unit()}</div>
      <button class="icon del" data-a="del-weight" data-day="${w.day}" aria-label="Delete">✕</button></div>`).join('') || '<div class="muted s empty">No weigh-ins yet</div>'}</section>`;
}

let foodFilter = '';
function viewFoods() {
  const q = foodFilter.toLowerCase();
  const list = S.foods.filter((f) => !q || `${f.name} ${f.brand}`.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="row between"><h2>My foods</h2><div class="row gap"><button class="btn small" data-a="new-food">+ Food</button><button class="btn small" data-a="new-recipe">+ Recipe</button></div></div>
    <input class="search" id="food-filter" placeholder="Filter" value="${esc(foodFilter)}" autocomplete="off">
    <section class="card" id="food-list">${foodRows(list)}</section>`;
}
function foodRows(list) {
  return list.map((f) => `<div class="row item" data-a="edit-food" data-id="${f.id}"><div class="grow"><div class="t">${f.ingredients ? '🍲 ' : ''}${esc(f.name)}</div>
    <div class="muted s">${esc(f.brand ? f.brand + ' · ' : '')}${f0(f.per100.cal)} kcal / 100 g</div></div></div>`).join('') || '<div class="muted s empty">No foods yet. Search from the diary, scan a barcode, or add your own.</div>';
}

function viewSettings(onboarding) {
  const s = S.settings;
  const sel = (v, cur) => (v === cur ? 'selected' : '');
  const rates = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5].map((kg) => {
    const v = Math.abs(kgToDisplay(kg, s.useLb));
    const label = kg === 0 ? 'Maintain weight' : `${kg < 0 ? 'Lose' : 'Gain'} ${f1(v)} ${unit()}/week`;
    return `<option value="${kg}" ${s.rate === kg ? 'selected' : ''}>${label}</option>`;
  }).join('');
  const { targets, est } = insights();
  return `<h2>${onboarding ? 'Welcome — set up your profile' : 'Settings'}</h2>
    <form data-form="settings" class="card form">
      <label>Units<select name="useLb"><option value="1" ${sel(true, s.useLb)}>Pounds (lb)</option><option value="0" ${sel(false, s.useLb)}>Kilograms (kg)</option></select></label>
      <label>Sex<select name="sex"><option value="male" ${sel('male', s.sex)}>Male</option><option value="female" ${sel('female', s.sex)}>Female</option></select></label>
      <label>Birth year<input name="birthYear" type="number" inputmode="numeric" min="1900" max="2020" value="${s.birthYear}" required></label>
      <label>Height (cm)<input name="heightCm" type="number" inputmode="decimal" step="0.1" value="${s.heightCm}" required></label>
      ${onboarding ? `<label>Current weight (${unit()})<input name="startWeight" type="number" inputmode="decimal" step="0.1" value="${f1(kgToDisplay(s.startKg, s.useLb))}" required></label>` : ''}
      <label>Activity<select name="activity">${Object.entries(ACTIVITY).map(([k, a]) => `<option value="${k}" ${sel(k, s.activity)}>${a.label}</option>`).join('')}</select></label>
      <label>Goal<select name="rate">${rates}</select></label>
      <label>Protein (g per kg bodyweight)<input name="proteinPerKg" type="number" inputmode="decimal" step="0.1" min="0.5" max="4" value="${s.proteinPerKg}"></label>
      <label>Fat (% of calories)<input name="fatPct" type="number" inputmode="numeric" min="15" max="60" value="${Math.round(s.fatPct * 100)}"></label>
      <label>USDA API key <span class="muted s">(free at fdc.nal.usda.gov; DEMO_KEY is rate-limited)</span><input name="usdaKey" value="${esc(s.usdaKey)}" autocapitalize="off" autocomplete="off"></label>
      <button class="btn primary" type="submit">${onboarding ? 'Get started' : 'Save'}</button>
    </form>
    ${onboarding ? '' : `<section class="card"><div class="muted s">Current plan</div>
      <div class="big">${f0(targets.cal)} <span class="s muted">kcal/day</span></div>
      <div class="muted s">Protein ${f0(targets.protein)} g · Carbs ${f0(targets.carbs)} g · Fat ${f0(targets.fat)} g<br>Expenditure ${f0(est.kcal)} kcal (${est.source})</div></section>
    <section class="card form"><h3>Data</h3>
      <button class="btn" data-a="export-json">Back up (JSON)</button>
      <button class="btn" data-a="export-csv">Export food log (CSV)</button>
      <button class="btn" data-a="import-json">Restore from backup…</button>
      <input type="file" id="import-file" accept="application/json" hidden>
      <p class="muted s">Everything is stored on this device only. Back up now and then — iOS can clear website data if you don't use the app for a long time.</p></section>`}`;
}

// ---------------------------------------------------------------- add food flow
let A = null; // {meal, day, q, online:[], loading, msg}

function openAdd(meal, day = S.day) {
  A = { meal, day, q: '', online: [], loading: false, msg: '' };
  renderAdd();
}

function localMatches() {
  const q = A.q.trim().toLowerCase();
  const base = [...S.foods].sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
  return (q ? base.filter((f) => `${f.name} ${f.brand}`.toLowerCase().includes(q)) : base).slice(0, 25);
}

function foodItem(f, src, i) {
  return `<div class="row item" data-a="pick" data-src="${src}" data-i="${i}"><div class="grow"><div class="t">${f.ingredients ? '🍲 ' : ''}${esc(f.name)}</div>
    <div class="muted s">${esc(f.brand ? f.brand + ' · ' : '')}${f0(f.per100.cal)} kcal/100 g · ${esc(f.servingLabel)}</div></div></div>`;
}

function addListHtml() {
  const local = localMatches();
  return `<h4>${A.q ? 'My foods' : 'Recent & saved'}</h4>${local.map((f, i) => foodItem(f, 'local', i)).join('') || '<div class="muted s empty">None</div>'}
    ${A.q.trim() ? `<h4>Online ${A.loading ? '<span class="spin"></span>' : ''}</h4>
      ${A.online.map((f, i) => foodItem(f, 'online', i)).join('')}
      ${!A.loading && !A.online.length ? `<div class="muted s empty">${esc(A.msg || 'Press Search to look up Open Food Facts and USDA.')}</div>` : ''}` : ''}`;
}

function renderAdd() {
  modal(`<header><h2>Add to ${mealName(A.meal)}</h2><button class="btn small" data-a="close">Done</button></header>
    <form data-form="search" class="row gap"><input name="q" id="add-q" class="search grow" placeholder="Search foods" value="${esc(A.q)}" autocomplete="off" enterkeyhint="search"><button class="btn" type="submit">Search</button></form>
    <div class="row gap wrap"><button class="btn small" data-a="scan">📷 Scan barcode</button><button class="btn small" data-a="quick">⚡ Quick add</button>
      <button class="btn small" data-a="new-food-add">+ New food</button></div>
    <div id="add-list" class="list">${addListHtml()}</div>`);
}

async function doSearch() {
  const q = A.q.trim();
  if (!q) return;
  A.loading = true; A.online = []; A.msg = '';
  $('#add-list').innerHTML = addListHtml();
  const [off, usda] = await Promise.allSettled([offSearch(q), usdaSearch(q, S.settings.usdaKey)]);
  if (A.q.trim() !== q) return;
  const merged = [...(usda.status === 'fulfilled' ? usda.value : []), ...(off.status === 'fulfilled' ? off.value : [])];
  A.online = merged;
  if (!merged.length) A.msg = (off.status === 'rejected' && usda.status === 'rejected') ? 'Search failed — check your connection.' : 'No online results.';
  A.loading = false;
  if ($('#add-list')) $('#add-list').innerHTML = addListHtml();
}

// portion picker. ctx: {food, meal, day, entry?}
let P = null;
function openPortion(ctx) {
  P = ctx;
  const f = ctx.food;
  const grams = ctx.entry ? ctx.entry.grams : f.servingG;
  const hasServ = f.servingG && f.servingG !== 100;
  modal(`<header><button class="btn small ghost" data-a="${ctx.entry ? 'close' : 'back-add'}">‹ Back</button><h2 class="grow">${esc(f.name)}</h2></header>
    <div class="muted s">${esc(f.brand || '')}</div>
    <form data-form="portion" class="form">
      <div class="row gap"><label class="grow">Amount<input id="p-qty" name="qty" type="number" inputmode="decimal" step="any" min="0" value="${hasServ && !ctx.entry ? 1 : f1(grams)}" required></label>
      <label>Unit<select id="p-unit" name="unit"><option value="g" ${hasServ && !ctx.entry ? '' : 'selected'}>grams</option>${hasServ ? `<option value="s" ${ctx.entry ? '' : 'selected'}>× ${esc(f.servingLabel)}</option>` : ''}</select></label></div>
      <div id="p-prev" class="card prev"></div>
      ${ctx.entry ? '' : `<label>Meal<select name="meal">${MEALS.map((m) => `<option value="${m.k}" ${m.k === ctx.meal ? 'selected' : ''}>${m.n}</option>`).join('')}</select></label>`}
      <div class="row gap"><button class="btn primary grow" type="submit">${ctx.entry ? 'Update' : 'Log food'}</button>
      ${ctx.entry ? '<button class="btn danger" type="button" data-a="del-entry">Delete</button>' : ''}</div>
    </form>`);
  updatePortion();
}
function portionGrams() {
  const qty = parseFloat($('#p-qty').value) || 0;
  return $('#p-unit').value === 's' ? qty * P.food.servingG : qty;
}
function updatePortion() {
  const g = portionGrams();
  const n = forGrams(P.food.per100, g);
  $('#p-prev').innerHTML = `<div class="big">${f0(n.cal)} <span class="s muted">kcal · ${f0(g)} g</span></div>
    <div class="macros"><span class="pill p">P ${f1(n.protein)} g</span><span class="pill c">C ${f1(n.carbs)} g</span><span class="pill f">F ${f1(n.fat)} g</span></div>`;
}

async function saveToLibrary(food) {
  // Dedupe online foods by barcode or name+brand.
  let existing = S.foods.find((f) => f.id === food.id)
    || (food.barcode && S.foods.find((f) => f.barcode === food.barcode))
    || S.foods.find((f) => f.name === food.name && f.brand === food.brand && f.source === food.source);
  const rec = { ...(existing || food), lastUsed: Date.now() };
  await db.put('foods', rec);
  return rec;
}

async function logFood({ food, meal, day, grams }) {
  const rec = await saveToLibrary(food);
  await db.put('entries', { id: uid(), day, meal, ts: Date.now(), name: rec.name, brand: rec.brand, foodId: rec.id, grams, per100: rec.per100 });
}

// custom food / quick add / recipe forms
function openFoodForm(food, { returnTo } = {}) {
  const f = food || { name: '', brand: '', servingLabel: '1 serving', servingG: 100, per100: { ...ZERO }, barcode: '' };
  const per = scale(f.per100, f.servingG / 100);
  const v = (n) => (n ? f1(n) : '');
  modal(`<header><button class="btn small ghost" data-a="${returnTo || 'close'}">‹ Back</button><h2 class="grow">${food?.id ? 'Edit food' : 'New food'}</h2></header>
    <form data-form="food" class="form">
      <input type="hidden" name="id" value="${esc(food?.id || '')}"><input type="hidden" name="barcode" value="${esc(f.barcode || '')}">
      <label>Name<input name="name" value="${esc(f.name)}" required></label>
      <label>Brand (optional)<input name="brand" value="${esc(f.brand)}"></label>
      <div class="row gap"><label class="grow">Serving label<input name="servingLabel" value="${esc(f.servingLabel)}"></label>
      <label class="grow">Serving size (g)<input name="servingG" type="number" inputmode="decimal" step="any" min="1" value="${f1(f.servingG)}" required></label></div>
      <div class="muted s">Nutrition per serving</div>
      <div class="grid2"><label>Calories<input name="cal" type="number" inputmode="decimal" step="any" min="0" value="${v(per.cal)}" required></label>
      <label>Protein (g)<input name="protein" type="number" inputmode="decimal" step="any" min="0" value="${v(per.protein)}"></label>
      <label>Carbs (g)<input name="carbs" type="number" inputmode="decimal" step="any" min="0" value="${v(per.carbs)}"></label>
      <label>Fat (g)<input name="fat" type="number" inputmode="decimal" step="any" min="0" value="${v(per.fat)}"></label>
      <label>Fiber (g)<input name="fiber" type="number" inputmode="decimal" step="any" min="0" value="${v(per.fiber)}"></label></div>
      <div class="row gap"><button class="btn primary grow" type="submit">Save</button>
      ${food?.id ? '<button class="btn danger" type="button" data-a="del-food" data-id="' + food.id + '">Delete</button>' : ''}</div>
    </form>`);
}

function openQuick() {
  modal(`<header><button class="btn small ghost" data-a="back-add">‹ Back</button><h2 class="grow">Quick add</h2></header>
    <form data-form="quick" class="form"><label>Label (optional)<input name="name" placeholder="Quick add"></label>
      <div class="grid2"><label>Calories<input name="cal" type="number" inputmode="decimal" step="any" min="0" required></label>
      <label>Protein (g)<input name="protein" type="number" inputmode="decimal" step="any" min="0"></label>
      <label>Carbs (g)<input name="carbs" type="number" inputmode="decimal" step="any" min="0"></label>
      <label>Fat (g)<input name="fat" type="number" inputmode="decimal" step="any" min="0"></label></div>
      <button class="btn primary" type="submit">Log</button></form>`);
}

let R = null; // recipe draft
function openRecipe(food) {
  R = food ? { id: food.id, name: food.name, ingredients: structuredClone(food.ingredients), cooked: food.cookedG || '', servings: food.servings || 1 }
    : { id: null, name: '', ingredients: [], cooked: '', servings: 1 };
  renderRecipe();
}
function recipeSummary() {
  const r = recipePer100(R.ingredients, parseFloat(R.cooked) || 0);
  const sv = Math.max(1, parseFloat(R.servings) || 1);
  const per = scale(r.total, 1 / sv);
  return `<div class="big">${f0(per.cal)} <span class="s muted">kcal / serving · ${f0(r.weight)} g total</span></div>
    <div class="macros"><span class="pill p">P ${f1(per.protein)}</span><span class="pill c">C ${f1(per.carbs)}</span><span class="pill f">F ${f1(per.fat)}</span></div>`;
}
function renderRecipe() {
  const opts = [...S.foods].filter((f) => !f.ingredients).sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => `<option value="${f.id}">${esc(f.name)}${f.brand ? ' — ' + esc(f.brand) : ''}</option>`).join('');
  modal(`<header><button class="btn small ghost" data-a="close">‹ Cancel</button><h2 class="grow">${R.id ? 'Edit recipe' : 'New recipe'}</h2></header>
    <form data-form="recipe" class="form">
      <label>Name<input name="name" id="r-name" value="${esc(R.name)}" required></label>
      <div class="muted s">Ingredients</div>
      ${R.ingredients.map((i, ix) => `<div class="row item"><div class="grow t">${esc(i.name)}</div><div class="muted s">${f0(i.grams)} g</div>
        <button class="icon del" type="button" data-a="r-del" data-i="${ix}">✕</button></div>`).join('') || '<div class="muted s empty">No ingredients yet</div>'}
      ${opts ? `<div class="row gap"><select id="r-food" class="grow">${opts}</select><input id="r-grams" type="number" inputmode="decimal" placeholder="grams" step="any" min="0" style="width:90px">
        <button class="btn small" type="button" data-a="r-add">Add</button></div>`
      : '<div class="muted s">Add some foods to your library first (log or create foods), then build recipes from them.</div>'}
      <div class="row gap"><label class="grow">Servings<input id="r-serv" name="servings" type="number" inputmode="decimal" step="any" min="1" value="${R.servings}"></label>
      <label class="grow">Cooked weight (g, optional)<input id="r-cook" name="cooked" type="number" inputmode="decimal" step="any" min="0" value="${R.cooked}"></label></div>
      <div id="r-sum" class="card prev">${recipeSummary()}</div>
      <div class="row gap"><button class="btn primary grow" type="submit">Save recipe</button>
      ${R.id ? `<button class="btn danger" type="button" data-a="del-food" data-id="${R.id}">Delete</button>` : ''}</div>
    </form>`);
}

// barcode scanner
async function openScan() {
  modal(`<header><button class="btn small ghost" data-a="back-add">‹ Back</button><h2 class="grow">Scan barcode</h2></header>
    <div class="scan"><video id="scan-v"></video><div class="scan-frame"></div></div>
    <div id="scan-msg" class="muted s center">Point the camera at a barcode…</div>
    <form data-form="barcode" class="row gap"><input name="code" class="search grow" placeholder="…or type the barcode number" inputmode="numeric"><button class="btn" type="submit">Look up</button></form>`);
  stopFn = await startScan($('#scan-v'), (code) => handleBarcode(code), (err) => {
    const m = $('#scan-msg');
    if (m) m.textContent = err?.name === 'NotAllowedError'
      ? 'Camera access was denied. Enable it in Settings → Safari → Camera, or type the number below.'
      : 'Could not start the camera. You can type the number below.';
  });
}
async function handleBarcode(code) {
  stopScanner();
  const msg = $('#scan-msg');
  if (msg) msg.textContent = `Looking up ${code}…`;
  const local = S.foods.find((f) => f.barcode === code);
  const found = local || await lookupBarcode(code, S.settings.usdaKey);
  if (found) return openPortion({ food: found, meal: A.meal, day: A.day });
  modal(`<header><button class="btn small ghost" data-a="back-add">‹ Back</button><h2 class="grow">Not found</h2></header>
    <p>No product found for <b>${esc(code)}</b>. You can add it yourself — it'll be saved so the next scan works instantly.</p>
    <button class="btn primary" data-a="new-food-barcode" data-code="${esc(code)}">Add this product</button>`);
}

// ---------------------------------------------------------------- actions
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function copyMeal(meal) {
  const src = S.entries.filter((e) => e.day === addDays(S.day, -1) && e.meal === meal);
  await db.putMany('entries', src.map((e) => ({ ...e, id: uid(), day: S.day, ts: Date.now() })));
  await reload(); render(); toast(`Copied ${src.length} item${src.length === 1 ? '' : 's'}`);
}

const actions = {
  close: () => { closeModal(); render(); },
  day: (el) => { S.day = addDays(S.day, +el.dataset.d); render(); },
  today: () => { S.day = dayStr(); render(); },
  add: (el) => openAdd(el.dataset.meal),
  'back-add': () => { stopScanner(); renderAdd(); },
  'copy-meal': (el) => copyMeal(el.dataset.meal),
  pick: (el) => {
    const f = (el.dataset.src === 'local' ? localMatches() : A.online)[+el.dataset.i];
    openPortion({ food: f, meal: A.meal, day: A.day });
  },
  'edit-entry': (el) => {
    const e = S.entries.find((x) => x.id === el.dataset.id);
    const food = S.foods.find((f) => f.id === e.foodId) || {};
    openPortion({ entry: e, food: { ...food, name: e.name, brand: e.brand, per100: e.per100, servingG: food.servingG || 100, servingLabel: food.servingLabel || '100 g' }, meal: e.meal, day: e.day });
  },
  'del-entry': async () => { await db.del('entries', P.entry.id); await reload(); closeModal(); render(); },
  scan: openScan,
  quick: openQuick,
  'new-food': () => openFoodForm(null),
  'new-food-add': () => openFoodForm(null, { returnTo: 'back-add' }),
  'new-food-barcode': (el) => openFoodForm({ name: '', brand: '', barcode: el.dataset.code, servingLabel: '1 serving', servingG: 100, per100: { ...ZERO } }, { returnTo: 'back-add' }),
  'edit-food': (el) => {
    const f = S.foods.find((x) => x.id === el.dataset.id);
    f.ingredients ? openRecipe(f) : openFoodForm(f);
  },
  'del-food': async (el) => {
    if (!confirm('Delete this food? Past log entries are kept.')) return;
    await db.del('foods', el.dataset.id); await reload(); closeModal(); render();
  },
  'new-recipe': () => openRecipe(null),
  'r-add': () => {
    const f = S.foods.find((x) => x.id === $('#r-food').value);
    const grams = parseFloat($('#r-grams').value);
    if (!f || !(grams > 0)) return toast('Pick a food and enter grams');
    R.name = $('#r-name').value; R.servings = $('#r-serv').value; R.cooked = $('#r-cook').value;
    R.ingredients.push({ name: f.name, grams, per100: f.per100 });
    renderRecipe();
  },
  'r-del': (el) => {
    R.name = $('#r-name').value; R.servings = $('#r-serv').value; R.cooked = $('#r-cook').value;
    R.ingredients.splice(+el.dataset.i, 1); renderRecipe();
  },
  weigh: () => {
    const last = [...S.weights].sort((a, b) => b.day.localeCompare(a.day))[0];
    modal(`<header><h2 class="grow">Log weight</h2><button class="btn small" data-a="close">Cancel</button></header>
      <form data-form="weigh" class="form"><label>Date<input name="day" type="date" value="${dayStr()}" max="${dayStr()}" required></label>
      <label>Weight (${unit()})<input name="w" type="number" inputmode="decimal" step="0.1" min="20" value="${last ? f1(kgToDisplay(last.kg, S.settings.useLb)) : ''}" required autofocus></label>
      <button class="btn primary" type="submit">Save</button></form>`);
  },
  'del-weight': async (el) => { await db.del('weights', el.dataset.day); await reload(); render(); },
  range: (el) => { S.range = +el.dataset.d; render(); },
  'export-json': async () => {
    download(`open-macro-backup-${dayStr()}.json`, JSON.stringify({ version: 1, settings: S.settings, foods: S.foods, entries: S.entries, weights: S.weights }), 'application/json');
  },
  'export-csv': () => {
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = ['date,meal,name,brand,grams,calories,protein,carbs,fat,fiber'];
    [...S.entries].sort((a, b) => a.day.localeCompare(b.day) || a.ts - b.ts).forEach((e) => {
      const n = entryN(e);
      rows.push([e.day, e.meal, q(e.name), q(e.brand), f1(e.grams), f1(n.cal), f1(n.protein), f1(n.carbs), f1(n.fat), f1(n.fiber)].join(','));
    });
    download(`open-macro-log-${dayStr()}.csv`, rows.join('\n'), 'text/csv');
  },
  'import-json': () => $('#import-file').click(),
};

// ---------------------------------------------------------------- forms
const num = (fd, k) => parseFloat(fd.get(k)) || 0;
const forms = {
  async settings(fd) {
    const s = S.settings;
    const wasSetup = s.setup;
    s.useLb = fd.get('useLb') === '1';
    s.sex = fd.get('sex'); s.birthYear = num(fd, 'birthYear'); s.heightCm = num(fd, 'heightCm');
    s.activity = fd.get('activity'); s.rate = parseFloat(fd.get('rate'));
    s.proteinPerKg = num(fd, 'proteinPerKg') || 2; s.fatPct = (num(fd, 'fatPct') || 30) / 100;
    s.usdaKey = fd.get('usdaKey').trim() || 'DEMO_KEY';
    if (!wasSetup) {
      s.startKg = displayToKg(num(fd, 'startWeight'), s.useLb);
      await db.put('weights', { day: dayStr(), kg: s.startKg });
      s.setup = true;
      await db.persist();
    }
    saveSettings(); await reload(); render(); toast(wasSetup ? 'Saved' : 'You’re all set');
  },
  async search(fd) { A.q = fd.get('q'); $('#add-list').innerHTML = addListHtml(); await doSearch(); },
  async portion(fd) {
    const qty = num(fd, 'qty');
    const grams = fd.get('unit') === 's' ? qty * P.food.servingG : qty;
    if (!(grams > 0)) return toast('Enter an amount');
    if (P.entry) await db.put('entries', { ...P.entry, grams });
    else await logFood({ food: P.food, meal: fd.get('meal'), day: P.day, grams });
    await reload(); closeModal(); render(); toast(P.entry ? 'Updated' : 'Logged');
  },
  async food(fd) {
    const servingG = num(fd, 'servingG') || 100;
    const k = 100 / servingG;
    const id = fd.get('id');
    const existing = id && S.foods.find((f) => f.id === id);
    const food = {
      ...(existing || {}), id: id || uid(), source: existing?.source || 'custom',
      name: fd.get('name').trim(), brand: fd.get('brand').trim(), barcode: fd.get('barcode') || null,
      servingLabel: fd.get('servingLabel').trim() || `${servingG} g`, servingG,
      per100: { cal: num(fd, 'cal') * k, protein: num(fd, 'protein') * k, carbs: num(fd, 'carbs') * k, fat: num(fd, 'fat') * k, fiber: num(fd, 'fiber') * k },
      lastUsed: existing?.lastUsed || Date.now(),
    };
    await db.put('foods', food); await reload();
    if (A && !id) { openPortion({ food, meal: A.meal, day: A.day }); } else { closeModal(); render(); }
    toast('Saved');
  },
  async quick(fd) {
    const n = { cal: num(fd, 'cal'), protein: num(fd, 'protein'), carbs: num(fd, 'carbs'), fat: num(fd, 'fat'), fiber: 0 };
    await db.put('entries', { id: uid(), day: A.day, meal: A.meal, ts: Date.now(), name: fd.get('name').trim() || 'Quick add', brand: '', foodId: null, grams: 100, per100: n });
    await reload(); closeModal(); render(); toast('Logged');
  },
  async recipe(fd) {
    R.name = fd.get('name').trim(); R.servings = fd.get('servings'); R.cooked = fd.get('cooked');
    if (!R.ingredients.length) return toast('Add at least one ingredient');
    const servings = Math.max(1, parseFloat(R.servings) || 1);
    const cookedG = parseFloat(R.cooked) || 0;
    const r = recipePer100(R.ingredients, cookedG);
    const existing = R.id && S.foods.find((f) => f.id === R.id);
    await db.put('foods', {
      ...(existing || {}), id: R.id || uid(), source: 'recipe', name: R.name, brand: '', barcode: null,
      per100: r.per100, servingG: r.weight / servings, servingLabel: '1 serving', ingredients: R.ingredients, servings, cookedG,
      lastUsed: existing?.lastUsed || Date.now(),
    });
    await reload(); closeModal(); render(); toast('Recipe saved');
  },
  async weigh(fd) {
    const kg = displayToKg(num(fd, 'w'), S.settings.useLb);
    await db.put('weights', { day: fd.get('day'), kg });
    await reload(); closeModal(); render(); toast('Weigh-in saved');
  },
  async barcode(fd) {
    const code = fd.get('code').replace(/\D/g, '');
    if (code) await handleBarcode(code);
  },
};

// ---------------------------------------------------------------- wiring
document.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (tab) { S.tab = tab.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (e.target === $('#modal')) { closeModal(); render(); return; }
  const el = e.target.closest('[data-a]');
  if (el && actions[el.dataset.a]) { e.preventDefault(); actions[el.dataset.a](el); }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  try { await forms[form.dataset.form](new FormData(form)); } catch (err) { console.error(err); toast('Something went wrong: ' + err.message); }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'p-qty' || e.target.id === 'p-unit') updatePortion();
  else if (e.target.id === 'add-q') { A.q = e.target.value; $('#add-list').innerHTML = addListHtml(); }
  else if (e.target.id === 'food-filter') { foodFilter = e.target.value; $('#food-list').innerHTML = foodRows(S.foods.filter((f) => `${f.name} ${f.brand}`.toLowerCase().includes(foodFilter.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name))); }
  else if (e.target.id === 'r-serv' || e.target.id === 'r-cook') { R.servings = $('#r-serv').value; R.cooked = $('#r-cook').value; $('#r-sum').innerHTML = recipeSummary(); }
});

document.addEventListener('change', async (e) => {
  if (e.target.id !== 'import-file' || !e.target.files[0]) return;
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data.entries) || !Array.isArray(data.weights) || !Array.isArray(data.foods)) throw new Error('Not an Open Macro backup');
    if (!confirm('Replace all data on this device with the backup?')) return;
    await Promise.all(['foods', 'entries', 'weights'].map((s) => db.clear(s)));
    await Promise.all([db.putMany('foods', data.foods), db.putMany('entries', data.entries), db.putMany('weights', data.weights)]);
    S.settings = { ...DEFAULTS, ...data.settings }; saveSettings();
    await reload(); render(); toast('Backup restored');
  } catch (err) { toast('Restore failed: ' + err.message); }
  e.target.value = '';
});

(async function init() {
  try { await reload(); } catch (err) { $('#view').innerHTML = `<p class="card">Storage is unavailable: ${esc(err.message)}. Private browsing can cause this.</p>`; return; }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
