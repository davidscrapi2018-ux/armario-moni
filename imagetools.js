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
// Quita el fondo dentro del propio móvil (la primera vez descarga el modelo, luego queda guardado)
export async function removeBackground(blob, onProgress) {
  if (!bgModule) bgModule = await import('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
  const out = await bgModule.removeBackground(blob, {
    model: 'isnet_quint8',
    output: { format: 'image/png' },
    progress: (key, cur, total) => onProgress && onProgress(key, cur, total),
  });
  return trimTransparent(out);
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
