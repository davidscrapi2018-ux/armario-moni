// Utilidades de imagen: redimensionar, quitar fondo, recortar, color dominante.

export function loadImg(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
}

export function canvasToBlob(c, type = 'image/png', q = 0.9) {
  return new Promise((res) => c.toBlob(res, type, q));
}

// Reduce la foto a un tamaño manejable (el móvil hace fotos enormes)
export async function shrink(file, max = 1200) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * s);
    c.height = Math.round(im.naturalHeight * s);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return await canvasToBlob(c, 'image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

let bgModule;
// Quita el fondo dentro del propio móvil. Devuelve la imagen recortada SIN trim (mismo tamaño que el original)
// para poder retocarla luego con el pincel.
//  1) Modelo de IA (isnet_fp16, más preciso que el cuantizado)
//  2) Detector por color: estima el color del fondo desde los bordes y marca como prenda todo lo que se diferencia
//  3) Une ambos, se queda con el objeto principal y rellena huecos que no son fondo
export async function removeBackground(blob, onProgress) {
  if (!bgModule) bgModule = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
  const cut = await bgModule.removeBackground(blob, {
    model: 'isnet_fp16',
    output: { format: 'image/png' },
    progress: (key, cur, total) => onProgress && onProgress(key, cur, total),
  });
  // 2ª IA (Segment Anything): a partir de lo que ha visto la 1ª, selecciona el objeto ENTERO
  let extra = null;
  try { extra = await samComplete(blob, cut, onProgress); } catch (e) { console.warn('SAM', e); }
  onProgress && onProgress('refine', 0, 0);
  return refineCutout(blob, cut, extra);
}

async function samComplete(blob, cut, onProgress) {
  const SAM = await import('./sam.js');
  onProgress && onProgress('sam', 0, 0);
  const seg = await SAM.prepare(blob, (l, t) => onProgress && onProgress('fetch:sam', l, t));
  const { W, H } = seg;
  const C = await pixelsOf(cut, W, H); const a = C.data.data; const N = W * H;
  let sx = 0, sy = 0, n = 0;
  const m1 = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (a[i * 4 + 3] > 110) { m1[i] = 1; sx += i % W; sy += (i / W) | 0; n++; }
  const points = [];
  if (n > 50) {
    let cx = sx / n, cy = sy / n;
    // si el centro cae fuera de lo detectado, uso el píxel detectado más cercano
    if (!m1[Math.round(cy) * W + Math.round(cx)]) {
      let best = 1e18;
      for (let i = 0; i < N; i += 3) if (m1[i]) { const d = (i % W - cx) ** 2 + (((i / W) | 0) - cy) ** 2; if (d < best) { best = d; points[0] = { x: i % W, y: (i / W) | 0, label: 1 }; } }
    } else points.push({ x: cx, y: cy, label: 1 });
  } else points.push({ x: W / 2, y: H / 2, label: 1 });
  const g = SAM.pickGarment(await seg.segment(points), W, H);
  if (!g) return null;
  // debe contener casi todo lo que vio la 1ª IA, si no algo raro ha pasado
  let inside = 0; for (let i = 0; i < N; i++) if (m1[i] && g.mask[i]) inside++;
  if (n > 50 && inside / n < 0.6) return null;
  return { mask: g.mask, W, H };
}

async function pixelsOf(blob, W, H) {
  const u = URL.createObjectURL(blob);
  try {
    const im = await loadImg(u);
    const c = document.createElement('canvas');
    c.width = W || im.naturalWidth; c.height = H || im.naturalHeight;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(im, 0, 0, c.width, c.height);
    return { canvas: c, ctx: x, data: x.getImageData(0, 0, c.width, c.height) };
  } finally { URL.revokeObjectURL(u); }
}

// espacio de color "oponente" sencillo: separa luz de color para no confundir sombras con prenda
function opp(r, g, b) { return [(r + g + b) / 3, r - g, (r + g) / 2 - b]; }

export async function refineCutout(origBlob, cutBlob, extra) {
  const O = await pixelsOf(origBlob);
  const W = O.canvas.width, H = O.canvas.height, N = W * H;
  const C = await pixelsOf(cutBlob, W, H);
  const o = O.data.data, a = C.data.data;
  const m1 = new Uint8Array(N);
  let m1count = 0;
  if (extra && extra.W === W && extra.H === H) for (let i = 0; i < N; i++) if (extra.mask[i]) a[i * 4 + 3] = 255;
  for (let i = 0; i < N; i++) if (a[i * 4 + 3] > 110) { m1[i] = 1; m1count++; }

  // --- color de fondo a partir del borde de la foto ---
  const band = Math.max(3, Math.round(Math.min(W, H) * 0.03));
  const samples = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    if (x >= band && x < W - band && y >= band && y < H - band) continue;
    const i = y * W + x; if (m1[i]) continue;
    samples.push(opp(o[i * 4], o[i * 4 + 1], o[i * 4 + 2]));
  }
  let m2 = new Uint8Array(N);
  if (samples.length > 50) {
    const med = [0, 1, 2].map((k) => { const v = samples.map((s) => s[k]).sort((p, q) => p - q); return v[v.length >> 1]; });
    const dist = (r, g, b) => { const p = opp(r, g, b); return Math.sqrt(0.35 * (p[0] - med[0]) ** 2 + (p[1] - med[1]) ** 2 + (p[2] - med[2]) ** 2); };
    const ds = samples.map((s) => Math.sqrt(0.35 * (s[0] - med[0]) ** 2 + (s[1] - med[1]) ** 2 + (s[2] - med[2]) ** 2)).sort((p, q) => p - q);
    const thr = Math.max(22, ds[Math.floor(ds.length * 0.95)] * 1.6); // tolera la textura del fondo
    for (let i = 0; i < N; i++) if (dist(o[i * 4], o[i * 4 + 1], o[i * 4 + 2]) > thr) m2[i] = 1;
    m2 = majority(m2, W, H);
    // si el fondo es muy irregular el detector de color no es fiable: lo descartamos
    let borderFg = 0, borderN = 0;
    for (let x = 0; x < W; x++) { borderN += 2; borderFg += m2[x] + m2[(H - 1) * W + x]; }
    for (let y = 0; y < H; y++) { borderN += 2; borderFg += m2[y * W] + m2[y * W + W - 1]; }
    if (borderFg / borderN > 0.35) m2 = new Uint8Array(N);
  }

  // --- unión + quedarse con los objetos que toca la IA (o el más grande) ---
  const u = new Uint8Array(N);
  for (let i = 0; i < N; i++) u[i] = m1[i] | m2[i];
  const lab = new Int32Array(N); const sizes = [0]; const hits = [0];
  const stack = new Int32Array(N);
  let L = 0;
  for (let s = 0; s < N; s++) {
    if (!u[s] || lab[s]) continue;
    L++; let sp = 0, size = 0, hit = 0; stack[sp++] = s; lab[s] = L;
    while (sp) {
      const i = stack[--sp]; size++; hit += m1[i];
      const x = i % W, y = (i / W) | 0;
      if (x > 0 && u[i - 1] && !lab[i - 1]) { lab[i - 1] = L; stack[sp++] = i - 1; }
      if (x < W - 1 && u[i + 1] && !lab[i + 1]) { lab[i + 1] = L; stack[sp++] = i + 1; }
      if (y > 0 && u[i - W] && !lab[i - W]) { lab[i - W] = L; stack[sp++] = i - W; }
      if (y < H - 1 && u[i + W] && !lab[i + W]) { lab[i + W] = L; stack[sp++] = i + W; }
    }
    sizes.push(size); hits.push(hit);
  }
  const keepLab = new Uint8Array(L + 1);
  let biggest = 0;
  for (let k = 1; k <= L; k++) {
    if (sizes[k] > sizes[biggest]) biggest = k;
    if (m1count && hits[k] > Math.max(30, m1count * 0.02)) keepLab[k] = 1;
  }
  if (!keepLab.some((v) => v) && biggest) keepLab[biggest] = 1;
  const keep = new Uint8Array(N);
  let keepCount = 0;
  for (let i = 0; i < N; i++) if (lab[i] && keepLab[lab[i]]) { keep[i] = 1; keepCount++; }

  // --- rellenar huecos interiores (estampados, sombras dentro de la prenda) ---
  const outside = new Uint8Array(N); let sp = 0;
  const push = (i) => { if (!keep[i] && !outside[i]) { outside[i] = 1; stack[sp++] = i; } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (sp) {
    const i = stack[--sp]; const x = i % W, y = (i / W) | 0;
    if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
  }
  // los huecos pequeños se rellenan siempre; los grandes solo si no se parecen al fondo (p. ej. asa de un bolso)
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (keep[s] || outside[s] || seen[s]) continue;
    const pix = []; let sp2 = 0; stack[sp2++] = s; seen[s] = 1; let fgLike = 0;
    while (sp2) {
      const i = stack[--sp2]; pix.push(i); fgLike += m2[i] | m1[i];
      const x = i % W, y = (i / W) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1]) {
        if (j >= 0 && !keep[j] && !outside[j] && !seen[j]) { seen[j] = 1; stack[sp2++] = j; }
      }
    }
    if (pix.length < keepCount * 0.015 || fgLike / pix.length > 0.3) for (const i of pix) keep[i] = 2;
  }

  // --- alfa final con bordes suaves ---
  const alpha = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    if (!keep[i]) continue;
    alpha[i] = m1[i] ? Math.max(a[i * 4 + 3], 200) : 255;
  }
  const soft = blurAlpha(alpha, W, H);
  const out = O.ctx.createImageData(W, H);
  for (let i = 0; i < N; i++) {
    out.data[i * 4] = o[i * 4]; out.data[i * 4 + 1] = o[i * 4 + 1]; out.data[i * 4 + 2] = o[i * 4 + 2];
    out.data[i * 4 + 3] = keep[i] ? Math.max(soft[i], m1[i] ? a[i * 4 + 3] : 0) : Math.min(soft[i], 60);
  }
  O.ctx.putImageData(out, 0, 0);
  return canvasToBlob(O.canvas, 'image/png');
}

function majority(m, W, H) {
  const r = new Uint8Array(m.length);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x;
    const s = m[i - W - 1] + m[i - W] + m[i - W + 1] + m[i - 1] + m[i] + m[i + 1] + m[i + W - 1] + m[i + W] + m[i + W + 1];
    r[i] = s >= 5 ? 1 : 0;
  }
  return r;
}
function blurAlpha(a, W, H) {
  const t = new Uint8ClampedArray(a.length), r = new Uint8ClampedArray(a.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; t[i] = (a[i] * 2 + (x > 0 ? a[i - 1] : a[i]) + (x < W - 1 ? a[i + 1] : a[i])) / 4; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; r[i] = (t[i] * 2 + (y > 0 ? t[i - W] : t[i]) + (y < H - 1 ? t[i + W] : t[i])) / 4; }
  return r;
}

// Recorta los bordes transparentes y deja un pequeño margen
export async function trimTransparent(blob, pad = 12) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await loadImg(url);
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 12) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return blob;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    const o = document.createElement('canvas');
    o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
    o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
    return await canvasToBlob(o, 'image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const COLOR_NAMES = [
  ['Negro', '#1b1b1b'], ['Blanco', '#f5f5f2'], ['Gris', '#8d8d8d'], ['Beige', '#d9c7a7'],
  ['Marrón', '#7a4e2d'], ['Rojo', '#c0262d'], ['Burdeos', '#6e1f2e'], ['Rosa', '#e79ab5'],
  ['Naranja', '#e57a2e'], ['Amarillo', '#ecc94b'], ['Verde', '#3f8f4a'], ['Caqui', '#7d7a4f'],
  ['Azul', '#2f62b5'], ['Azul marino', '#1f2a4d'], ['Celeste', '#8fc3e8'], ['Morado', '#7d4fb0'],
  ['Lila', '#c3a6e0'], ['Dorado', '#c9a227'], ['Plateado', '#c0c4c8'],
];

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function nearestColorName(hex) {
  const [r, g, b] = hexToRgb(hex);
  let best = COLOR_NAMES[0], bd = Infinity;
  for (const c of COLOR_NAMES) {
    const [R, G, B] = hexToRgb(c[1]);
    const d = 2 * (r - R) ** 2 + 4 * (g - G) ** 2 + 3 * (b - B) ** 2;
    if (d < bd) { bd = d; best = c; }
  }
  return best[0];
}

// Color dominante ignorando lo transparente y el fondo blanco
export async function dominantColor(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await loadImg(url);
    const c = document.createElement('canvas');
    const s = 64 / Math.max(im.naturalWidth, im.naturalHeight);
    c.width = Math.max(1, Math.round(im.naturalWidth * s));
    c.height = Math.max(1, Math.round(im.naturalHeight * s));
    const ctx = c.getContext('2d');
    ctx.drawImage(im, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) continue;
      const key = (d[i] >> 4) << 8 | (d[i + 1] >> 4) << 4 | (d[i + 2] >> 4);
      const b = buckets.get(key) || [0, 0, 0, 0];
      b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++;
      buckets.set(key, b);
    }
    let top = null;
    for (const b of buckets.values()) if (!top || b[3] > top[3]) top = b;
    if (!top) return { hex: '#f5f5f2', name: 'Blanco' };
    const hex = rgbToHex(Math.round(top[0] / top[3]), Math.round(top[1] / top[3]), Math.round(top[2] / top[3]));
    return { hex, name: nearestColorName(hex) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Compone una imagen de outfit a partir de capas posicionadas (coordenadas 0..1)
export async function composeOutfit(layers, size = 900) {
  const c = document.createElement('canvas');
  c.width = size; c.height = Math.round(size * 1.25);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);
  for (const L of [...layers].sort((a, b) => (a.z || 0) - (b.z || 0))) {
    if (!L.url) continue;
    const im = await loadImg(L.url);
    const w = L.w * c.width;
    const h = w * (im.naturalHeight / im.naturalWidth);
    ctx.save();
    ctx.translate(L.x * c.width, L.y * c.height);
    ctx.rotate(((L.rot || 0) * Math.PI) / 180);
    ctx.drawImage(im, -w / 2, -h / 2, w, h);
    ctx.restore();
  }
  return canvasToBlob(c, 'image/jpeg', 0.88);
}

export function blobToDataURL(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
export async function dataURLToBlob(u) { return (await fetch(u)).blob(); }
