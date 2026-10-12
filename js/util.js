// Small DOM/format helpers shared by the UI modules.
export const $ = (sel, root = document) => root.querySelector(sel);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const f0 = (n) => Math.round(n).toLocaleString();
export const f1 = (n) => (Math.round(n * 10) / 10).toString();
export const uid = () => crypto.randomUUID();
export const money = (n) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
export const qtyText = (q, u) => (q == null ? (u || '') : `${f1(q)}${u ? ' ' + u : ''}`);
