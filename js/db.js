// Tiny IndexedDB wrapper. Stores: foods(id), entries(id, idx day), weights(day).
const NAME = 'openmacro';
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('foods', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: 'id' }).createIndex('day', 'day');
      db.createObjectStore('weights', { keyPath: 'day' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const out = fn(t.objectStore(store));
  await new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  return out instanceof IDBRequest ? out.result : out;
}

export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, obj) => tx(store, 'readwrite', (s) => s.put(obj));
export const putMany = (store, objs) => tx(store, 'readwrite', (s) => { objs.forEach((o) => s.put(o)); });
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear());

/** Ask the browser not to evict our data (best effort; helps on iOS). */
export async function persist() {
  try { return await navigator.storage?.persist?.(); } catch { return false; }
}
