import { parseOpenFoodFactsProduct, parseUsdaFood } from './core.js';

const OFF_FIELDS = 'code,product_name,brands,nutriments,serving_quantity,serving_size';
const hasNutrition = (f) => f && (f.per100.cal > 0 || f.per100.protein > 0 || f.per100.carbs > 0 || f.per100.fat > 0);

async function getJson(url, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

export async function offBarcode(code) {
  const j = await getJson(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (j.status !== 1) return null;
  const f = parseOpenFoodFactsProduct({ ...j.product, code: j.product.code || code });
  return hasNutrition(f) ? f : null;
}

export async function offSearch(q) {
  const j = await getJson(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${OFF_FIELDS}`, 20000);
  return (j.products || []).map(parseOpenFoodFactsProduct).filter(hasNutrition);
}

export async function usdaSearch(q, key = 'DEMO_KEY') {
  const j = await getJson(`https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(q)}&pageSize=20&dataType=Foundation,SR%20Legacy,Branded`);
  return (j.foods || []).map(parseUsdaFood).filter(hasNutrition);
}

/** Barcode lookup: Open Food Facts first, then USDA branded (GTIN search). */
export async function lookupBarcode(code, usdaKey) {
  try { const f = await offBarcode(code); if (f) return f; } catch { /* fall through */ }
  try {
    const hits = await usdaSearch(code, usdaKey);
    const gtin = code.replace(/^0+/, '');
    return hits.find((h) => h.barcode && h.barcode.replace(/^0+/, '') === gtin) || null;
  } catch { return null; }
}
