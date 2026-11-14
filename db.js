// Almacenamiento local (IndexedDB). Todo se queda en el móvil.
const DB_NAME = 'armario-moni';
const VERSION = 1;
export const STORES = ['items', 'outfits', 'lookbooks', 'plans', 'trips', 'wishes', 'boards', 'images', 'meta'];

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let result;
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (s) => run(s, 'readonly', (st) => st.getAll()),
  get: (s, id) => run(s, 'readonly', (st) => st.get(id)),
  put: (s, v) => run(s, 'readwrite', (st) => st.put(v)).then(() => v),
  del: (s, id) => run(s, 'readwrite', (st) => st.delete(id)),
  clear: (s) => run(s, 'readwrite', (st) => st.clear()),
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---- imágenes ----
const urlCache = new Map();
export async function saveImage(blob) {
  const id = uid();
  await db.put('images', { id, blob });
  return id;
}
export async function imageURL(id) {
  if (!id) return '';
  if (urlCache.has(id)) return urlCache.get(id);
  const rec = await db.get('images', id);
  if (!rec) return '';
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(id, url);
  return url;
}
export async function deleteImage(id) {
  if (!id) return;
  const url = urlCache.get(id);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(id);
  await db.del('images', id);
}
