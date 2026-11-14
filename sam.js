// "Segment Anything" (SlimSAM) dentro del móvil: selecciona objetos ENTEROS a partir de puntos.
// Se usa automáticamente para completar la prenda y también al tocar la prenda en el editor.
const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2';
const MODEL = 'Xenova/slimsam-77-uniform';

let lib, model, processor;
async function load(onProgress) {
  if (!lib) lib = await import(TF_URL);
  if (!model) {
    const progress_callback = (p) => { if (onProgress && p.status === 'progress' && p.total) onProgress(p.loaded, p.total); };
    [model, processor] = await Promise.all([
      lib.SamModel.from_pretrained(MODEL, { dtype: 'q8', progress_callback }),
      lib.AutoProcessor.from_pretrained(MODEL, { progress_callback }),
    ]);
  }
}

// Prepara una imagen (calcula su "embedding" una vez) y devuelve una función para segmentar con puntos
export async function prepare(blob, onProgress) {
  await load(onProgress);
  const u = URL.createObjectURL(blob);
  let raw;
  try { raw = await lib.RawImage.read(u); } finally { URL.revokeObjectURL(u); }
  const inputs = await processor(raw);
  const emb = await model.get_image_embeddings(inputs);
  const W = raw.width, H = raw.height;
  const [rh, rw] = inputs.reshaped_input_sizes[0];

  // points: [{x,y,label}] en píxeles de la imagen (label 1 = prenda, 0 = fondo)
  // devuelve las 3 máscaras candidatas (Uint8Array W*H) con su puntuación
  async function segment(points) {
    const pts = points.flatMap((p) => [(p.x / W) * rw, (p.y / H) * rh]);
    const input_points = new lib.Tensor('float32', pts, [1, 1, points.length, 2]);
    const input_labels = new lib.Tensor('int64', points.map((p) => BigInt(p.label)), [1, 1, points.length]);
    const out = await model({ ...emb, input_points, input_labels });
    const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
    const m = masks[0]; // [1, 3, H, W]
    const data = m.data; const N = W * H;
    const scores = Array.from(out.iou_scores.data);
    return [0, 1, 2].map((k) => {
      const mk = new Uint8Array(N); let area = 0;
      for (let i = 0; i < N; i++) if (data[k * N + i]) { mk[i] = 1; area++; }
      return { mask: mk, score: scores[k], area };
    });
  }
  return { W, H, segment };
}

// Elige la máscara que mejor representa "la prenda entera":
// la más grande que no sea el fondo (no toca demasiado los bordes ni ocupa casi toda la foto)
export function pickGarment(cands, W, H) {
  const N = W * H;
  const info = cands.map((c) => {
    let b = 0, bn = 0;
    for (let x = 0; x < W; x++) { b += c.mask[x] + c.mask[(H - 1) * W + x]; bn += 2; }
    for (let y = 0; y < H; y++) { b += c.mask[y * W] + c.mask[y * W + W - 1]; bn += 2; }
    return { c, border: b / bn };
  }).filter((o) => o.c.area > N * 0.01 && o.c.area < N * 0.85);
  // primero las que casi no tocan el borde (una prenda suele estar entera en la foto); si no hay, más permisivo
  for (const lim of [0.04, 0.3]) {
    const ok = info.filter((o) => o.border < lim).sort((a, b) => b.c.area - a.c.area);
    if (ok.length) return ok[0].c;
  }
  return null;
}
