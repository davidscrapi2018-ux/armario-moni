import { db, uid, saveImage, imageURL, deleteImage, STORES } from './db.js';
import * as IT from './imagetools.js';

// ================== datos base ==================
const CATS = [
  { id: 'arriba', label: 'Partes de arriba' },
  { id: 'abajo', label: 'Partes de abajo' },
  { id: 'vestidos', label: 'Vestidos y monos' },
  { id: 'abrigos', label: 'Abrigos y chaquetas' },
  { id: 'zapatos', label: 'Zapatos' },
  { id: 'bolsos', label: 'Bolsos' },
  { id: 'accesorios', label: 'Accesorios' },
  { id: 'deporte', label: 'Deporte' },
  { id: 'otros', label: 'Otros' },
];
const catLabel = (id) => (CATS.find((c) => c.id === id) || { label: id }).label;
const SEASONS = ['Primavera', 'Verano', 'Otoño', 'Invierno'];

const S = { items: [], outfits: [], lookbooks: [], plans: [], trips: [], wishes: [], boards: [], settings: { currency: '€', autoBg: true } };
const ui = { cat: 'todo', q: '', sort: 'recientes', month: null, dress: null, canvas: null, canvasEditing: null };

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $actions = document.getElementById('header-actions');

// ================== utilidades ==================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const isoOf = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fmtDate = (iso) => iso ? new Date(iso + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const money = (n) => (n == null || n === '' || isNaN(n)) ? '—' : `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 })} ${S.settings.currency}`;
const wears = (it) => (it.wears || []).length;
const cpw = (it) => (it.price ? it.price / Math.max(1, wears(it)) : null);
const active = () => S.items.filter((i) => !i.archived);
const itemById = (id) => S.items.find((i) => i.id === id);
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

async function save(store, obj) {
  await db.put(store, obj);
  const arr = S[store];
  const i = arr.findIndex((x) => x.id === obj.id);
  if (i >= 0) arr[i] = obj; else arr.push(obj);
  return obj;
}
async function remove(store, id) {
  await db.del(store, id);
  S[store] = S[store].filter((x) => x.id !== id);
}

function hydrate(root = document) {
  root.querySelectorAll('img[data-img]').forEach((im) => {
    if (im.dataset.loaded === im.dataset.img) return;
    im.dataset.loaded = im.dataset.img;
    imageURL(im.dataset.img).then((u) => { if (u) im.src = u; });
  });
}
const img = (id, cls = '') => id ? `<img data-img="${esc(id)}" class="${cls}" alt="">` : `<div class="noimg ${cls}"></div>`;

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2200);
}

function sheet(html, onMount, { full = false, onClose = null } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${full ? 'full' : ''}"><div class="grab"></div><div class="sheet-body">${html}</div></div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => { if (closed) return; closed = true; onClose && onClose(); wrap.classList.remove('open'); setTimeout(() => wrap.remove(), 260); };
  wrap.querySelector('.sheet-bg').onclick = close;
  const body = wrap.querySelector('.sheet-body');
  onMount && onMount(body, close);
  hydrate(wrap);
  return close;
}

function confirmBox(msg, okLabel = 'Sí, borrar') {
  return new Promise((res) => {
    sheet(`<p class="confirm-msg">${esc(msg)}</p><div class="row gap"><button class="btn ghost grow" data-no>Cancelar</button><button class="btn danger grow" data-yes>${esc(okLabel)}</button></div>`,
      (b, close) => {
        b.querySelector('[data-no]').onclick = () => { close(); res(false); };
        b.querySelector('[data-yes]').onclick = () => { close(); res(true); };
      });
  });
}

function promptBox(title, value = '', placeholder = '') {
  return new Promise((res) => {
    sheet(`<h3>${esc(title)}</h3><input class="input" id="pv" value="${esc(value)}" placeholder="${esc(placeholder)}"><div class="row gap mt"><button class="btn ghost grow" data-no>Cancelar</button><button class="btn grow" data-yes>Guardar</button></div>`,
      (b, close) => {
        const inp = b.querySelector('#pv');
        setTimeout(() => inp.focus(), 300);
        b.querySelector('[data-no]').onclick = () => { close(); res(null); };
        b.querySelector('[data-yes]').onclick = () => { close(); res(inp.value.trim()); };
      });
  });
}

function pickFile(multiple = false) {
  return new Promise((res) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*'; i.multiple = multiple;
    i.onchange = () => res([...i.files]);
    i.click();
  });
}

// selector de prendas reutilizable
function pickItems({ multi = true, selected = [], cats = null, title = 'Elige prendas' } = {}) {
  return new Promise((res) => {
    const sel = new Set(selected);
    let cat = cats ? cats[0] : 'todo';
    const list = () => active().filter((i) => (cat === 'todo' ? (!cats || cats.includes(i.cat)) : i.cat === cat));
    const chips = ['todo', ...(cats || CATS.map((c) => c.id))];
    sheet(`<div class="row between"><h3>${esc(title)}</h3><button class="btn small" data-ok>Listo</button></div>
      <div class="chips" id="pk-chips">${chips.map((c) => `<button class="chip" data-c="${c}">${c === 'todo' ? 'Todo' : esc(catLabel(c))}</button>`).join('')}</div>
      <div class="grid sm" id="pk-grid"></div>`, (b, close) => {
      const draw = () => {
        b.querySelectorAll('#pk-chips .chip').forEach((x) => x.classList.toggle('on', x.dataset.c === cat));
        const L = list();
        b.querySelector('#pk-grid').innerHTML = L.length ? L.map((i) => `<button class="card pick ${sel.has(i.id) ? 'sel' : ''}" data-id="${i.id}"><div class="thumb">${img(i.img)}</div></button>`).join('') : `<p class="muted">No hay prendas aquí todavía.</p>`;
        hydrate(b);
      };
      b.querySelector('#pk-chips').onclick = (e) => { const c = e.target.closest('.chip'); if (c) { cat = c.dataset.c; draw(); } };
      b.querySelector('#pk-grid').onclick = (e) => {
        const c = e.target.closest('.card'); if (!c) return;
        const id = c.dataset.id;
        if (!multi) { close(); res([id]); return; }
        sel.has(id) ? sel.delete(id) : sel.add(id);
        c.classList.toggle('sel');
      };
      b.querySelector('[data-ok]').onclick = () => { close(); res([...sel]); };
      draw();
    }, { full: true });
  });
}

function pickOutfit(title = 'Elige un outfit') {
  return new Promise((res) => {
    sheet(`<h3>${esc(title)}</h3><div class="grid sm">${S.outfits.length ? [...S.outfits].reverse().map((o) => `<button class="card" data-id="${o.id}"><div class="thumb tall">${img(o.preview)}</div><div class="cap">${esc(o.name)}</div></button>`).join('') : '<p class="muted">Aún no tienes outfits guardados.</p>'}</div>`,
      (b, close) => { b.onclick = (e) => { const c = e.target.closest('.card'); if (c) { close(); res(c.dataset.id); } }; }, { full: true });
  });
}

// marca prendas como usadas en una fecha
async function logWear(itemIds, date = todayISO()) {
  for (const id of itemIds) {
    const it = itemById(id); if (!it) continue;
    it.wears = it.wears || [];
    if (!it.wears.includes(date)) { it.wears.push(date); it.wears.sort(); await save('items', it); }
  }
}
async function unlogWear(itemIds, date) {
  for (const id of itemIds) {
    const it = itemById(id); if (!it || !it.wears) continue;
    const n = it.wears.length;
    it.wears = it.wears.filter((d) => d !== date);
    if (it.wears.length !== n) await save('items', it);
  }
}

function setHeader(title, actionsHTML = '') {
  $title.textContent = title;
  $actions.innerHTML = actionsHTML;
}

// ================== router ==================
const routes = [];
const route = (re, fn) => routes.push([re, fn]);
function go(hash) { location.hash = hash; }
async function render() {
  const h = location.hash.slice(1) || '/armario';
  for (const [re, fn] of routes) {
    const m = h.match(re);
    if (m) {
      document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', h.startsWith(a.dataset.tab)));
      $view.scrollTop = 0; window.scrollTo(0, 0);
      await fn(...m.slice(1));
      hydrate($view);
      return;
    }
  }
  go('/armario');
}
window.addEventListener('hashchange', render);

// ================== ARMARIO (perfil) ==================
const profile = () => S.settings.profile || (S.settings.profile = { name: 'Moni', handle: 'armariodemoni', avatar: null, cover: null });

function profileSheet() {
  const p = profile();
  sheet(`<h3>Tu perfil</h3>
    <div class="row gap"><div class="avatar-edit" id="av">${p.avatar ? img(p.avatar) : `<span>${esc((p.name || 'M')[0])}</span>`}</div>
    <div class="grow"><button class="btn ghost small block" id="av-btn">Cambiar foto de perfil</button><button class="btn ghost small block mt" id="cv-btn">Cambiar portada</button></div></div>
    <label class="lbl">Nombre</label><input class="input" id="pn" value="${esc(p.name)}">
    <label class="lbl">Usuario</label><input class="input" id="ph" value="${esc(p.handle)}">
    <button class="btn block mt" id="ok">Guardar</button>`, (b, close) => {
    const pickInto = async (key, max) => {
      const [f] = await pickFile(); if (!f) return;
      const id = await saveImage(await IT.shrink(f, max));
      if (p[key]) await deleteImage(p[key]);
      p[key] = id; await saveSettings(); toast('Foto actualizada');
      if (key === 'avatar') { b.querySelector('#av').innerHTML = img(id); hydrate(b); }
    };
    b.querySelector('#av-btn').onclick = () => pickInto('avatar', 600);
    b.querySelector('#cv-btn').onclick = () => pickInto('cover', 1400);
    b.querySelector('#ok').onclick = async () => {
      p.name = b.querySelector('#pn').value.trim() || 'Moni';
      p.handle = b.querySelector('#ph').value.trim().replace(/^@/, '');
      await saveSettings(); close(); render();
    };
  });
}
async function saveSettings() { await db.put('meta', { id: 'settings', ...S.settings }); }

route(/^\/armario$/, () => {
  const p = profile();
  const act = active();
  const archived = S.items.filter((i) => i.archived).length;
  ui.ptab = ui.ptab || 'prendas';
  setHeader('', `<button class="icon-btn" id="h-set" aria-label="Ajustes">${ICON.gear}</button><button class="icon-btn" id="h-add" aria-label="Añadir prenda">${ICON.plus}</button>`);
  const bubbles = [['todo', 'Todo'], ['fav', 'Favoritos'], ...CATS.map((c) => [c.id, c.label])]
    .map(([id, l]) => {
      const pool = id === 'todo' ? act : id === 'fav' ? act.filter((i) => i.fav) : act.filter((i) => i.cat === id);
      if (!pool.length && !['todo'].includes(id)) return '';
      const cover = [...pool].sort((a, b) => wears(b) - wears(a))[0];
      return `<button class="bubble ${ui.cat === id ? 'on' : ''}" data-c="${id}"><span class="bub">${cover ? img(cover.img) : ''}</span><span class="bl">${esc(l)}</span></button>`;
    }).join('');
  $view.innerHTML = `
    <section class="profile">
      <div class="cover">${p.cover ? img(p.cover) : ''}</div>
      <button class="avatar" id="avatar">${p.avatar ? img(p.avatar) : `<span>${esc((p.name || 'M')[0])}</span>`}</button>
      <div class="pname">${esc(p.name)}</div>
      ${p.handle ? `<div class="handle">@${esc(p.handle)}</div>` : ''}
      <div class="ptabs">
        <button data-pt="prendas" class="${ui.ptab === 'prendas' ? 'on' : ''}"><b>${act.length}</b><span>Prendas</span></button>
        <button data-pt="outfits" class="${ui.ptab === 'outfits' ? 'on' : ''}"><b>${S.outfits.length}</b><span>Outfits</span></button>
        <button data-pt="lookbooks" class="${ui.ptab === 'lookbooks' ? 'on' : ''}"><b>${S.lookbooks.length}</b><span>Lookbooks</span></button>
      </div>
    </section>
    <div id="ptab"></div>
    <button class="fab" id="fab" aria-label="Añadir">${ICON.plus}</button>`;
  const box = $view.querySelector('#ptab');

  const drawPrendas = () => {
    box.innerHTML = `
      <div class="bubbles" id="bubbles">${bubbles}</div>
      <button class="archived-link ${ui.cat === 'archivo' ? 'on' : ''}" id="arch">Archivado (${archived})</button>
      <div class="row gap"><div class="search grow"><span>${ICON.search}</span><input id="q" placeholder="Buscar" value="${esc(ui.q)}"></div>
        <button class="icon-btn sq" id="sortbtn" aria-label="Ordenar">${ICON.sliders}</button></div>
      <div class="grid two-col items" id="grid"></div>`;
    const drawGrid = () => {
      const q = ui.q.toLowerCase();
      const L = S.items.filter((i) => {
        if (ui.cat === 'archivo') { if (!i.archived) return false; }
        else if (i.archived) return false;
        if (ui.cat === 'fav' && !i.fav) return false;
        if (!['todo', 'fav', 'archivo'].includes(ui.cat) && i.cat !== ui.cat) return false;
        if (q) {
          const hay = [i.name, i.brand, i.color?.name, catLabel(i.cat), ...(i.tags || []), ...(i.seasons || [])].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
      const sorters = {
        recientes: (a, b) => (b.created || 0) - (a.created || 0),
        usadas: (a, b) => wears(b) - wears(a),
        menos: (a, b) => wears(a) - wears(b),
        precio: (a, b) => (b.price || 0) - (a.price || 0),
        cpu: (a, b) => (cpw(a) ?? 1e9) - (cpw(b) ?? 1e9),
        color: (a, b) => (a.color?.name || '').localeCompare(b.color?.name || ''),
      };
      L.sort(sorters[ui.sort]);
      box.querySelector('#grid').innerHTML = L.length ? L.map((i) => `
        <a class="card item-card" href="#/prenda/${i.id}">
          <div class="thumb">${img(i.img)}<button class="heart-btn ${i.fav ? 'on' : ''}" data-fav="${i.id}" aria-label="Favorito">${i.fav ? ICON.heartFill : ICON.heart}</button></div>
          <div class="cap"><span>${esc(i.name || catLabel(i.cat))}</span><span class="muted">${wears(i)}×</span></div>
        </a>`).join('') : `<div class="empty"><p>${S.items.length ? 'Nada por aquí.' : 'Tu armario está vacío.<br>Pulsa <b>+</b> para añadir tu primera prenda.'}</p></div>`;
      hydrate(box);
    };
    box.querySelector('#q').oninput = (e) => { ui.q = e.target.value; drawGrid(); };
    box.querySelector('#bubbles').onclick = (e) => {
      const c = e.target.closest('.bubble'); if (!c) return;
      ui.cat = c.dataset.c;
      box.querySelectorAll('.bubble').forEach((x) => x.classList.toggle('on', x === c));
      box.querySelector('#arch').classList.remove('on');
      drawGrid();
    };
    box.querySelector('#arch').onclick = (e) => {
      ui.cat = ui.cat === 'archivo' ? 'todo' : 'archivo';
      e.target.classList.toggle('on', ui.cat === 'archivo');
      box.querySelectorAll('.bubble').forEach((x) => x.classList.toggle('on', x.dataset.c === ui.cat));
      drawGrid();
    };
    box.querySelector('#sortbtn').onclick = () => {
      const opts = [['recientes', 'Más recientes'], ['usadas', 'Más usadas'], ['menos', 'Menos usadas'], ['precio', 'Precio'], ['cpu', 'Coste por uso'], ['color', 'Color']];
      sheet(`<h3>Ordenar por</h3><div class="list">${opts.map(([v, l]) => `<button class="list-row" data-s="${v}"><span>${l}</span><span>${ui.sort === v ? '✓' : ''}</span></button>`).join('')}</div>`,
        (b, close) => b.querySelectorAll('[data-s]').forEach((x) => x.onclick = () => { ui.sort = x.dataset.s; close(); drawGrid(); }));
    };
    box.querySelector('#grid').onclick = async (e) => {
      const h = e.target.closest('[data-fav]'); if (!h) return;
      e.preventDefault(); e.stopPropagation();
      const it = itemById(h.dataset.fav); it.fav = !it.fav; await save('items', it);
      h.classList.toggle('on', it.fav); h.innerHTML = it.fav ? ICON.heartFill : ICON.heart;
    };
    drawGrid();
  };

  const drawOutfits = () => {
    const L = [...S.outfits].sort((a, b) => b.created - a.created);
    box.innerHTML = `<a class="btn ghost block" href="#/outfits/visteme">+ Crear outfit</a>
      <div class="grid two-col mt">${L.map((o) => `<button class="card" data-o="${o.id}"><div class="thumb tall">${img(o.preview)}</div><div class="cap"><span>${esc(o.name)}</span></div></button>`).join('') || '<div class="empty"><p>Aún no hay outfits.</p></div>'}</div>`;
    box.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => outfitSheet(b.dataset.o));
    hydrate(box);
  };

  const drawLookbooks = () => {
    box.innerHTML = `<button class="btn ghost block" id="new-lb">+ Nuevo lookbook</button>
      <div class="grid two-col mt">${S.lookbooks.map((lb) => {
        const covers = lb.outfits.slice(0, 4).map((id) => S.outfits.find((o) => o.id === id)).filter(Boolean);
        return `<a class="card" href="#/lookbook/${lb.id}"><div class="thumb collage">${covers.map((c) => img(c.preview)).join('') || '<div class="noimg"></div>'}</div><div class="cap"><span>${esc(lb.name)}</span><span class="muted">${lb.outfits.length}</span></div></a>`;
      }).join('')}</div>`;
    box.querySelector('#new-lb').onclick = async () => {
      const n = await promptBox('Nombre del lookbook', '', 'Ej: Fiestas'); if (!n) return;
      await save('lookbooks', { id: uid(), name: n, outfits: [], created: Date.now() }); render();
    };
    hydrate(box);
  };

  const tabs = { prendas: drawPrendas, outfits: drawOutfits, lookbooks: drawLookbooks };
  $view.querySelector('.ptabs').onclick = (e) => {
    const t = e.target.closest('[data-pt]'); if (!t) return;
    ui.ptab = t.dataset.pt;
    $view.querySelectorAll('.ptabs button').forEach((x) => x.classList.toggle('on', x === t));
    tabs[ui.ptab]();
  };
  $view.querySelector('#avatar').onclick = profileSheet;
  $view.querySelector('#fab').onclick = () => go(ui.ptab === 'outfits' ? '/outfits/visteme' : '/nueva');
  $actions.querySelector('#h-add').onclick = () => go('/nueva');
  $actions.querySelector('#h-set').onclick = () => go('/ajustes');
  tabs[ui.ptab]();
});

// ---------- formulario de prenda (nueva / editar) ----------
// Devuelve { original, cut (sin recortar bordes, o null), finalBlob (lo que se ve), color }
async function processPhoto(file, statusEl, wantBg) {
  statusEl.textContent = 'Preparando foto…';
  const small = await IT.shrink(file);
  let cut = null;
  if (wantBg) {
    try {
      statusEl.textContent = 'Detectando la prenda… (la primera vez tarda un poco)';
      cut = await IT.removeBackground(small, (key, cur, total) => {
        if (key.startsWith('fetch') && total) statusEl.textContent = `Descargando detector de prendas… ${Math.round((cur / total) * 100)}%`;
        else if (key.startsWith('compute')) statusEl.textContent = 'Detectando la prenda…';
        else if (key === 'sam') statusEl.textContent = 'Buscando la prenda entera…';
        else if (key === 'refine') statusEl.textContent = 'Afinando bordes…';
      });
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'No se pudo quitar el fondo, uso la foto original.';
      cut = null;
    }
  }
  const finalBlob = cut ? await IT.trimTransparent(cut) : small;
  const color = await IT.dominantColor(finalBlob);
  statusEl.textContent = cut ? '¿Se ha cortado algo? Usa “Retocar” para arreglarlo con el dedo.' : '';
  return { original: small, cut, finalBlob, color };
}

// Editor con pincel: borrar / recuperar zonas del recorte
function retouch(origBlob, cutBlob) {
  return new Promise(async (resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const ou = URL.createObjectURL(origBlob), cu = URL.createObjectURL(cutBlob);
    const [oim, cim] = await Promise.all([IT.loadImg(ou), IT.loadImg(cu)]);
    const W = oim.naturalWidth, H = oim.naturalHeight;
    const mask = document.createElement('canvas'); mask.width = W; mask.height = H;
    const mx = mask.getContext('2d', { willReadFrequently: true }); mx.drawImage(cim, 0, 0, W, H);
    const initial = mx.getImageData(0, 0, W, H);
    const comp = document.createElement('canvas'); comp.width = W; comp.height = H;
    const cx = comp.getContext('2d');
    let mode = 'restore', size = 40, ghost = true;
    const undo = [];
    sheet(`<div class="row between"><h3>Retocar recorte</h3><button class="btn small" data-ok>Listo</button></div>
      <div class="rt-stage"><canvas id="rt" width="${W}" height="${H}"></canvas></div>
      <div class="seg three"><a data-m="tap">✨ Tocar prenda</a><a data-m="restore" class="on">Recuperar</a><a data-m="erase">Borrar</a></div>
      <p class="muted small center" id="rt-msg"></p>
      <div class="row gap"><span class="muted small">Pincel</span><input type="range" id="sz" min="8" max="140" value="40" class="grow"></div>
      <div class="row gap mt"><button class="btn ghost grow small" data-undo>Deshacer</button><button class="btn ghost grow small" data-ghost>Ocultar foto</button><button class="btn ghost grow small" data-reset>Empezar de nuevo</button></div>
      <p class="muted small center">“Tocar prenda”: toca la prenda y la IA la selecciona entera (toca otra parte si falta algo). “Recuperar”: pinta lo que falta. “Borrar”: pinta lo que sobra.</p>`,
    (b, close) => {
      const cv = b.querySelector('#rt'); const ctx = cv.getContext('2d');
      const draw = () => {
        cx.globalCompositeOperation = 'source-over'; cx.clearRect(0, 0, W, H); cx.drawImage(oim, 0, 0);
        cx.globalCompositeOperation = 'destination-in'; cx.drawImage(mask, 0, 0); cx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, W, H);
        if (ghost) { ctx.globalAlpha = 0.28; ctx.drawImage(oim, 0, 0); ctx.globalAlpha = 1; }
        ctx.drawImage(comp, 0, 0);
      };
      let last = null;
      const pt = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height), k: W / r.width }; };
      const paint = (p) => {
        mx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over';
        mx.strokeStyle = mx.fillStyle = '#000'; mx.lineCap = 'round'; mx.lineJoin = 'round'; mx.lineWidth = size * p.k;
        mx.beginPath();
        if (last) { mx.moveTo(last.x, last.y); mx.lineTo(p.x, p.y); mx.stroke(); }
        else { mx.arc(p.x, p.y, (size * p.k) / 2, 0, Math.PI * 2); mx.fill(); }
        mx.globalCompositeOperation = 'source-over';
        last = p; draw();
      };
      const msg = b.querySelector('#rt-msg');
      let segP = null; const taps = []; let busy = false;
      const tapSelect = async (p) => {
        if (busy) return; busy = true;
        try {
          msg.textContent = 'La IA está buscando la prenda… (la primera vez tarda un poco)';
          if (!segP) segP = import('./sam.js').then((SAM) => SAM.prepare(origBlob, (l, t) => { msg.textContent = `Descargando IA… ${Math.round((l / t) * 100)}%`; }).then((seg) => ({ SAM, seg })));
          const { SAM, seg } = await segP;
          taps.push({ x: p.x * (seg.W / W), y: p.y * (seg.H / H), label: 1 });
          const cands = await seg.segment(taps);
          const g = SAM.pickGarment(cands, seg.W, seg.H) || [...cands].sort((a, c) => c.score - a.score)[0];
          const tmp = document.createElement('canvas'); tmp.width = seg.W; tmp.height = seg.H;
          const tx = tmp.getContext('2d'); const id = tx.createImageData(seg.W, seg.H);
          for (let i = 0; i < g.mask.length; i++) id.data[i * 4 + 3] = g.mask[i] ? 255 : 0;
          tx.putImageData(id, 0, 0);
          undo.push(mx.getImageData(0, 0, W, H)); if (undo.length > 15) undo.shift();
          mx.clearRect(0, 0, W, H); mx.drawImage(tmp, 0, 0, W, H); draw();
          msg.textContent = '¿Falta algo? Toca esa parte también. Para afinar usa Recuperar/Borrar.';
        } catch (err) { console.error(err); msg.textContent = 'No se pudo usar la IA (¿sin internet?). Usa el pincel.'; }
        busy = false;
      };
      cv.addEventListener('pointerdown', (e) => { if (mode === 'tap') { tapSelect(pt(e)); return; } cv.setPointerCapture(e.pointerId); undo.push(mx.getImageData(0, 0, W, H)); if (undo.length > 15) undo.shift(); last = null; paint(pt(e)); });
      cv.addEventListener('pointermove', (e) => { if (last) paint(pt(e)); });
      const end = () => { last = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      b.querySelectorAll('[data-m]').forEach((x) => x.onclick = () => { mode = x.dataset.m; b.querySelectorAll('[data-m]').forEach((y) => y.classList.toggle('on', y === x)); });
      b.querySelector('#sz').oninput = (e) => { size = Number(e.target.value); };
      b.querySelector('[data-undo]').onclick = () => { const d = undo.pop(); if (d) { mx.putImageData(d, 0, 0); draw(); } };
      b.querySelector('[data-reset]').onclick = () => { taps.length = 0; undo.push(mx.getImageData(0, 0, W, H)); mx.putImageData(initial, 0, 0); draw(); };
      b.querySelector('[data-ghost]').onclick = (e) => { ghost = !ghost; e.target.textContent = ghost ? 'Ocultar foto' : 'Ver foto'; draw(); };
      b.querySelector('[data-ok]').onclick = async () => { draw(); finish(await IT.canvasToBlob(comp, 'image/png')); close(); };
      draw();
    }, { full: true, onClose: () => { URL.revokeObjectURL(ou); URL.revokeObjectURL(cu); finish(null); } });
  });
}

function itemFormHTML(it) {
  return `
    <div class="photo-box" id="photo">${it.img ? img(it.img) : `<div class="photo-empty">${ICON.camera}<span>Hacer foto o elegir de la galería</span></div>`}</div>
    <div class="row gap center wrap-row"><button class="btn ghost small" id="change-photo">${it.img ? 'Cambiar foto' : 'Elegir foto'}</button>
      <button class="btn ghost small" id="retouch" ${it.orig && it.cut ? '' : 'hidden'}>${ICON.brush} Retocar</button>
      <label class="switch"><input type="checkbox" id="bg" ${S.settings.autoBg ? 'checked' : ''}><span>Quitar fondo</span></label></div>
    <p class="status" id="status"></p>
    <label class="lbl">Nombre</label><input class="input" id="f-name" value="${esc(it.name || '')}" placeholder="Ej: Top rojo de tirantes">
    <label class="lbl">Categoría</label>
    <div class="chips wrap" id="f-cat">${CATS.map((c) => `<button class="chip ${it.cat === c.id ? 'on' : ''}" data-c="${c.id}">${esc(c.label)}</button>`).join('')}</div>
    <label class="lbl">Color</label>
    <div class="row gap"><input type="color" id="f-hex" value="${esc(it.color?.hex || '#1b1b1b')}"><select class="input" id="f-color">${IT.COLOR_NAMES.map(([n]) => `<option ${it.color?.name === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="two">
      <div><label class="lbl">Marca</label><input class="input" id="f-brand" value="${esc(it.brand || '')}" placeholder="Zara, Shein…"></div>
      <div><label class="lbl">Precio (${esc(S.settings.currency)})</label><input class="input" id="f-price" inputmode="decimal" value="${esc(it.price ?? '')}" placeholder="0"></div>
    </div>
    <div class="two">
      <div><label class="lbl">Fecha de compra</label><input class="input" type="date" id="f-date" value="${esc(it.buyDate || '')}"></div>
      <div><label class="lbl">Estado</label><select class="input" id="f-cond"><option value="nuevo" ${it.condition !== 'segunda' ? 'selected' : ''}>Nuevo</option><option value="segunda" ${it.condition === 'segunda' ? 'selected' : ''}>Segunda mano</option></select></div>
    </div>
    <label class="lbl">Temporada</label>
    <div class="chips wrap" id="f-seasons">${SEASONS.map((s) => `<button class="chip ${(it.seasons || []).includes(s) ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
    <label class="lbl">Etiquetas</label><input class="input" id="f-tags" value="${esc((it.tags || []).join(', '))}" placeholder="fiesta, básico, trabajo…">
    <label class="lbl">Talla</label><input class="input" id="f-size" value="${esc(it.size || '')}" placeholder="S, 38…">
    <label class="lbl">Notas</label><textarea class="input" id="f-notes" rows="2">${esc(it.notes || '')}</textarea>
    <button class="btn block mt" id="f-save">Guardar prenda</button>`;
}

function mountItemForm(root, it, onSaved) {
  let pending = null; // { original, cut, finalBlob }
  let lastFile = null;
  let cat = it.cat || null;
  const status = root.querySelector('#status');
  const showBlob = (b) => {
    const u = URL.createObjectURL(b);
    root.querySelector('#photo').innerHTML = `<img src="${u}" alt="">`;
  };
  const setPending = (r) => {
    pending = r; showBlob(r.finalBlob);
    root.querySelector('#retouch').hidden = !r.cut;
  };
  const choose = async () => {
    const [f] = await pickFile(false);
    if (!f) return;
    lastFile = f;
    const r = await processPhoto(f, status, root.querySelector('#bg').checked);
    setPending(r);
    root.querySelector('#f-hex').value = r.color.hex;
    root.querySelector('#f-color').value = r.color.name;
  };
  root.querySelector('#photo').onclick = choose;
  root.querySelector('#change-photo').onclick = choose;
  root.querySelector('#bg').onchange = async (e) => {
    if (!lastFile) return;
    setPending(await processPhoto(lastFile, status, e.target.checked));
  };
  root.querySelector('#retouch').onclick = async () => {
    let orig, cut;
    if (pending) { orig = pending.original; cut = pending.cut; }
    else { orig = (await db.get('images', it.orig))?.blob; cut = (await db.get('images', it.cut))?.blob; }
    if (!orig || !cut) return;
    const nc = await retouch(orig, cut);
    if (!nc) return;
    setPending({ original: orig, cut: nc, finalBlob: await IT.trimTransparent(nc) });
    status.textContent = '';
  };
  root.querySelector('#f-hex').oninput = (e) => { root.querySelector('#f-color').value = IT.nearestColorName(e.target.value); };
  root.querySelector('#f-cat').onclick = (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    cat = c.dataset.c;
    root.querySelectorAll('#f-cat .chip').forEach((x) => x.classList.toggle('on', x === c));
  };
  root.querySelector('#f-seasons').onclick = (e) => { const c = e.target.closest('.chip'); if (c) c.classList.toggle('on'); };
  root.querySelector('#f-save').onclick = async () => {
    if (!it.img && !pending) { toast('Añade una foto primero'); return; }
    if (!cat) { toast('Elige una categoría'); return; }
    const btn = root.querySelector('#f-save'); btn.disabled = true;
    if (pending) {
      const old = [it.img, it.orig, it.cut];
      it.img = await saveImage(pending.finalBlob);
      it.orig = pending.cut ? await saveImage(pending.original) : null;
      it.cut = pending.cut ? await saveImage(pending.cut) : null;
      for (const o of old) if (o) await deleteImage(o);
    }
    const price = parseFloat(String(root.querySelector('#f-price').value).replace(',', '.'));
    Object.assign(it, {
      name: root.querySelector('#f-name').value.trim(),
      cat,
      color: { hex: root.querySelector('#f-hex').value, name: root.querySelector('#f-color').value },
      brand: root.querySelector('#f-brand').value.trim(),
      price: isNaN(price) ? null : price,
      buyDate: root.querySelector('#f-date').value || null,
      condition: root.querySelector('#f-cond').value,
      seasons: [...root.querySelectorAll('#f-seasons .chip.on')].map((x) => x.dataset.s),
      tags: root.querySelector('#f-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
      size: root.querySelector('#f-size').value.trim(),
      notes: root.querySelector('#f-notes').value.trim(),
    });
    if (!it.id) { it.id = uid(); it.created = Date.now(); it.wears = []; }
    await save('items', it);
    toast('Prenda guardada');
    onSaved(it);
  };
}

route(/^\/nueva$/, () => {
  setHeader('Nueva prenda', `<button class="icon-btn" onclick="history.back()" aria-label="Cerrar">${ICON.close}</button>`);
  $view.innerHTML = `<div class="form">${itemFormHTML({})}</div>`;
  mountItemForm($view, {}, (it) => { history.replaceState(null, '', '#/prenda/' + it.id); render(); });
});

route(/^\/prenda\/([^/]+)\/editar$/, (id) => {
  const it = itemById(id); if (!it) return go('/armario');
  setHeader('Editar prenda', `<button class="icon-btn" onclick="history.back()" aria-label="Cerrar">${ICON.close}</button>`);
  $view.innerHTML = `<div class="form">${itemFormHTML(it)}</div>`;
  mountItemForm($view, it, () => history.back());
});

route(/^\/prenda\/([^/]+)$/, (id) => {
  const it = itemById(id); if (!it) return go('/armario');
  setHeader('', `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  const inOutfits = S.outfits.filter((o) => o.items.includes(id));
  const last = (it.wears || []).slice(-1)[0];
  const age = it.buyDate ? daysBetween(it.buyDate, todayISO()) : null;
  $view.innerHTML = `
    <div class="detail-img">${img(it.img)}</div>
    <div class="pad">
      <div class="row between"><h2>${esc(it.name || catLabel(it.cat))}</h2><button class="icon-btn ${it.fav ? 'fav' : ''}" id="fav" aria-label="Favorito">${it.fav ? '♥' : '♡'}</button></div>
      <div class="tags">
        <span class="tag">${esc(catLabel(it.cat))}</span>
        ${it.color ? `<span class="tag"><i class="dot" style="background:${esc(it.color.hex)}"></i>${esc(it.color.name)}</span>` : ''}
        ${it.brand ? `<span class="tag">${esc(it.brand)}</span>` : ''}
        ${it.size ? `<span class="tag">Talla ${esc(it.size)}</span>` : ''}
        <span class="tag">${it.condition === 'segunda' ? 'Segunda mano' : 'Nuevo'}</span>
        ${(it.seasons || []).map((s) => `<span class="tag">${s}</span>`).join('')}
        ${(it.tags || []).map((s) => `<span class="tag">#${esc(s)}</span>`).join('')}
      </div>
      <div class="stats4">
        <div><b>${wears(it)}</b><span>usos</span></div>
        <div><b>${money(it.price)}</b><span>precio</span></div>
        <div><b>${it.price ? money(cpw(it)) : '—'}</b><span>coste por uso</span></div>
        <div><b>${last ? fmtDate(last) : 'Nunca'}</b><span>último uso</span></div>
      </div>
      ${age != null ? `<p class="muted">La tienes desde hace ${age} días${it.buyDate ? ` (${fmtDate(it.buyDate)})` : ''}.</p>` : ''}
      ${it.notes ? `<p>${esc(it.notes)}</p>` : ''}
      <button class="btn block" id="wear">Me lo he puesto hoy</button>
      ${it.orig && it.cut ? `<button class="btn ghost block mt" id="rt">${ICON.brush} Retocar recorte</button>` : ''}
      <div class="row gap mt">
        <a class="btn ghost grow" href="#/prenda/${it.id}/editar">Editar</a>
        <button class="btn ghost grow" id="arch">${it.archived ? 'Recuperar' : 'Archivar'}</button>
        <button class="btn ghost danger-text grow" id="del">Borrar</button>
      </div>
      ${inOutfits.length ? `<h3 class="mt">En ${inOutfits.length} outfit${inOutfits.length > 1 ? 's' : ''}</h3><div class="hscroll">${inOutfits.map((o) => `<button class="mini-outfit" data-o="${o.id}">${img(o.preview)}</button>`).join('')}</div>` : ''}
      ${wears(it) ? `<h3 class="mt">Historial</h3><div class="history">${[...it.wears].reverse().slice(0, 30).map((d) => `<span class="tag">${fmtDate(d)} <button class="x" data-unwear="${d}">×</button></span>`).join('')}</div>` : ''}
    </div>`;
  $view.querySelector('#fav').onclick = async () => { it.fav = !it.fav; await save('items', it); render(); };
  const rtb = $view.querySelector('#rt');
  if (rtb) rtb.onclick = async () => {
    const orig = (await db.get('images', it.orig))?.blob, cut = (await db.get('images', it.cut))?.blob;
    if (!orig || !cut) return;
    const nc = await retouch(orig, cut); if (!nc) return;
    const old = [it.img, it.cut];
    it.cut = await saveImage(nc); it.img = await saveImage(await IT.trimTransparent(nc));
    for (const o of old) await deleteImage(o);
    await save('items', it);
    for (const o of S.outfits.filter((x) => x.items.includes(it.id))) await createOutfit(o.name, o.layout || stackLayout(o.items.map(itemById).filter(Boolean)), o);
    toast('Recorte actualizado'); render();
  };
  $view.querySelector('#wear').onclick = async () => {
    const t = todayISO();
    if ((it.wears || []).includes(t)) { toast('Ya estaba apuntado hoy'); return; }
    await logWear([it.id]); toast('¡Apuntado!'); render();
  };
  $view.querySelector('#arch').onclick = async () => {
    it.archived = !it.archived; it.archivedAt = it.archived ? todayISO() : null;
    await save('items', it); toast(it.archived ? 'Archivada' : 'Recuperada'); render();
  };
  $view.querySelector('#del').onclick = async () => {
    if (!(await confirmBox('¿Borrar esta prenda para siempre?'))) return;
    await deleteImage(it.img); await deleteImage(it.orig); await deleteImage(it.cut); await remove('items', it.id);
    for (const o of S.outfits) if (o.items.includes(it.id)) { o.items = o.items.filter((x) => x !== it.id); if (o.layout) o.layout = o.layout.filter((l) => l.itemId !== it.id); await save('outfits', o); }
    go('/armario');
  };
  $view.querySelectorAll('[data-unwear]').forEach((b) => b.onclick = async () => { await unlogWear([it.id], b.dataset.unwear); render(); });
  $view.querySelectorAll('[data-o]').forEach((b) => b.onclick = () => outfitSheet(b.dataset.o));
});

// ================== ESTILISMO ==================
const OUTFIT_TABS = [['visteme', 'Vísteme'], ['lienzo', 'Lienzo'], ['moodboards', 'Moodboards']];
function outfitTabs(cur) {
  return `<div class="utabs">${OUTFIT_TABS.map(([id, l]) => `<a class="${cur === id ? 'on' : ''}" href="#/outfits/${id}">${l}</a>`).join('')}</div>`;
}
route(/^\/outfits$/, () => go('/outfits/visteme'));
route(/^\/outfits\/guardados$/, () => { ui.ptab = 'outfits'; go('/armario'); });
route(/^\/outfits\/lookbooks$/, () => { ui.ptab = 'lookbooks'; go('/armario'); });

// ---------- Vísteme (carruseles) ----------
const LAYOUTS = {
  2: ['vestidos', 'zapatos'],
  3: ['arriba', 'abajo', 'zapatos'],
  4: ['abrigos', 'arriba', 'abajo', 'zapatos'],
};
function dressState() {
  if (!ui.dress) ui.dress = { idx: {}, locked: new Set(), layout: 3, extras: new Set(), season: '' };
  return ui.dress;
}
const dressRows = (st) => [...LAYOUTS[st.layout], ...['bolsos', 'accesorios'].filter((x) => st.extras.has(x))];
const rowItems = (cat, st) => active().filter((i) => i.cat === cat && (!st.season || !(i.seasons || []).length || i.seasons.includes(st.season)));
const layoutIcon = (n) => sv(Array.from({ length: n }, (_, k) => { const h = 16 / n; return `<rect x="5" y="${4 + k * h + 0.8}" width="14" height="${h - 1.6}" rx="1.2"/>`; }).join(''));

route(/^\/outfits\/visteme$/, () => {
  const st = dressState();
  setHeader('Estilismo');
  const rows = dressRows(st);
  $view.innerHTML = `${outfitTabs('visteme')}
    <div class="row between dm-top"><button class="icon-btn sq dark" id="filters" aria-label="Filtros">${ICON.sliders}</button><button class="pill-save" id="save-dm">Guardar</button></div>
    <div class="dm2">${rows.map((r) => {
      const L = rowItems(r, st);
      if (!L.length) return `<div class="car-empty" data-row="${r}"><span>Añade ${esc(catLabel(r).toLowerCase())} para verlas aquí</span><a href="#/nueva" class="btn ghost small">+ Añadir</a></div>`;
      return `<div class="car-wrap ${['zapatos', 'bolsos', 'accesorios'].includes(r) ? 'short' : ''}" data-row="${r}">
        <div class="car">${L.map((i) => `<div class="car-item" data-id="${i.id}">${img(i.img)}</div>`).join('')}</div>
        <button class="pin ${st.locked.has(r) ? 'on' : ''}" data-lock="${r}" aria-label="Fijar">${ICON.pin}</button>
      </div>`;
    }).join('')}</div>
    <div class="dm-tools">
      ${[2, 3, 4].map((n) => `<button class="lay ${st.layout === n ? 'on' : ''}" data-lay="${n}" aria-label="${n} filas">${layoutIcon(n)}</button>`).join('')}
      <button class="lay dice" id="dice" aria-label="Aleatorio">${ICON.dice}</button>
      <button class="lay" id="wear-dm" aria-label="Me lo pongo hoy">${ICON.check}</button>
    </div>`;
  hydrate($view);

  const cars = [...$view.querySelectorAll('.car-wrap')];
  const itemW = (car) => car.querySelector('.car-item')?.offsetWidth || 1;
  const mark = (wrap) => {
    const car = wrap.querySelector('.car'); const r = wrap.dataset.row;
    const n = car.children.length; const i = Math.max(0, Math.min(n - 1, Math.round(car.scrollLeft / itemW(car))));
    st.idx[r] = i;
    [...car.children].forEach((c, k) => c.classList.toggle('center', k === i));
  };
  cars.forEach((wrap) => {
    const car = wrap.querySelector('.car'); const r = wrap.dataset.row;
    const n = car.children.length;
    const i = ((st.idx[r] || 0) % n + n) % n;
    requestAnimationFrame(() => { car.scrollLeft = i * itemW(car); mark(wrap); });
    let t; car.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => mark(wrap), 80); }, { passive: true });
    car.addEventListener('click', (e) => { const it = e.target.closest('.car-item'); if (!it) return; const k = [...car.children].indexOf(it); car.scrollTo({ left: k * itemW(car), behavior: 'smooth' }); });
    wrap.querySelector('.pin').onclick = (e) => { st.locked.has(r) ? st.locked.delete(r) : st.locked.add(r); e.currentTarget.classList.toggle('on', st.locked.has(r)); };
  });
  $view.querySelectorAll('[data-lay]').forEach((b) => b.onclick = () => { st.layout = Number(b.dataset.lay); render(); });
  $view.querySelector('#dice').onclick = () => {
    cars.forEach((wrap) => {
      if (st.locked.has(wrap.dataset.row)) return;
      const car = wrap.querySelector('.car'); const n = car.children.length; if (n < 2) return;
      let k; do { k = Math.floor(Math.random() * n); } while (k === st.idx[wrap.dataset.row] && n > 1);
      car.scrollTo({ left: k * itemW(car), behavior: 'smooth' });
    });
  };
  $view.querySelector('#filters').onclick = () => {
    sheet(`<h3>Filtros</h3>
      <label class="lbl">Temporada</label>
      <div class="chips wrap" id="fs">${['', ...SEASONS].map((s) => `<button class="chip ${st.season === s ? 'on' : ''}" data-s="${s}">${s || 'Todas'}</button>`).join('')}</div>
      <label class="lbl">Filas extra</label>
      <div class="chips wrap" id="fx">${[['bolsos', 'Bolso'], ['accesorios', 'Accesorio']].map(([id, l]) => `<button class="chip ${st.extras.has(id) ? 'on' : ''}" data-x="${id}">${l}</button>`).join('')}</div>
      <button class="btn block mt" data-ok>Aplicar</button>`, (b, close) => {
      b.querySelector('#fs').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; st.season = c.dataset.s; b.querySelectorAll('#fs .chip').forEach((x) => x.classList.toggle('on', x === c)); };
      b.querySelector('#fx').onclick = (e) => { const c = e.target.closest('.chip'); if (!c) return; const id = c.dataset.x; st.extras.has(id) ? st.extras.delete(id) : st.extras.add(id); c.classList.toggle('on'); };
      b.querySelector('[data-ok]').onclick = () => { close(); render(); };
    });
  };
  const current = () => cars.map((wrap) => { const car = wrap.querySelector('.car'); const el = car.children[st.idx[wrap.dataset.row] || 0]; return el ? itemById(el.dataset.id) : null; }).filter(Boolean);
  $view.querySelector('#save-dm').onclick = async () => {
    const cur = current(); if (!cur.length) { toast('Añade prendas primero'); return; }
    const name = await promptBox('Nombre del outfit', '', 'Ej: Cena del viernes'); if (name === null) return;
    const o = await createOutfit(name || 'Outfit', stackLayout(cur));
    toast('Outfit guardado'); outfitSheet(o.id);
  };
  $view.querySelector('#wear-dm').onclick = async () => {
    const cur = current(); if (!cur.length) return;
    await logWear(cur.map((c) => c.id)); toast('Apuntado como usado hoy');
  };
});

// coloca prendas apiladas verticalmente (para outfits creados en Vísteme)
function stackLayout(items) {
  const order = ['accesorios', 'abrigos', 'arriba', 'vestidos', 'abajo', 'bolsos', 'zapatos', 'deporte', 'otros'];
  const its = [...items].sort((a, b) => order.indexOf(a.cat) - order.indexOf(b.cat));
  const side = its.filter((i) => ['bolsos', 'accesorios', 'abrigos'].includes(i.cat));
  const main = its.filter((i) => !side.includes(i));
  const L = [];
  main.forEach((it, k) => {
    const n = main.length;
    L.push({ itemId: it.id, x: side.length ? 0.4 : 0.5, y: (k + 0.5) / n, w: it.cat === 'zapatos' ? 0.32 : (n > 2 ? 0.42 : 0.5), rot: 0, z: k });
  });
  side.forEach((it, k) => L.push({ itemId: it.id, x: 0.8, y: 0.2 + k * 0.3, w: 0.3, rot: 0, z: 10 + k }));
  return L;
}

async function renderPreview(layout) {
  const layers = [];
  for (const l of layout) { const it = itemById(l.itemId); if (it) layers.push({ ...l, url: await imageURL(it.img) }); }
  return IT.composeOutfit(layers);
}

async function createOutfit(name, layout, existing = null) {
  const blob = await renderPreview(layout);
  const o = existing || { id: uid(), created: Date.now(), lookbooks: [] };
  if (o.preview) await deleteImage(o.preview);
  o.preview = await saveImage(blob);
  o.name = name; o.layout = layout; o.items = [...new Set(layout.map((l) => l.itemId))];
  await save('outfits', o);
  return o;
}

// ---------- Lienzo ----------
route(/^\/outfits\/lienzo(?:\/([^/]+))?$/, (editId) => {
  setHeader('Estilismo');
  if (editId) {
    const o = S.outfits.find((x) => x.id === editId);
    if (o && ui.canvasEditing !== editId) { ui.canvas = JSON.parse(JSON.stringify(o.layout || stackLayout(o.items.map(itemById).filter(Boolean)))); ui.canvasEditing = editId; }
  } else if (ui.canvasEditing) { ui.canvas = null; ui.canvasEditing = null; }
  if (!ui.canvas) ui.canvas = [];
  const layers = ui.canvas;
  let selected = null;
  $view.innerHTML = `${outfitTabs('lienzo')}
    ${editId ? '<p class="muted center">Editando outfit guardado</p>' : ''}
    <div class="stage" id="stage"></div>
    <div class="tools" id="tools">
      <button class="btn ghost small" data-t="add">${ICON.plus} Prenda</button>
      <button class="btn ghost small sel-only" data-t="bigger">＋</button>
      <button class="btn ghost small sel-only" data-t="smaller">－</button>
      <button class="btn ghost small sel-only" data-t="rotl">⟲</button>
      <button class="btn ghost small sel-only" data-t="rotr">⟳</button>
      <button class="btn ghost small sel-only" data-t="front">Delante</button>
      <button class="btn ghost small sel-only" data-t="back">Detrás</button>
      <button class="btn ghost small sel-only danger-text" data-t="del">Quitar</button>
    </div>
    <div class="row gap mt"><button class="btn ghost grow" id="clear">Vaciar</button><button class="btn grow" id="save-cv">${editId ? 'Guardar cambios' : 'Guardar outfit'}</button></div>
    <p class="muted center small">Arrastra para mover. Con dos dedos: agrandar y girar.</p>`;
  const stage = $view.querySelector('#stage');
  const draw = () => {
    stage.innerHTML = layers.length ? layers.map((l, k) => {
      const it = itemById(l.itemId); if (!it) return '';
      return `<div class="layer ${selected === k ? 'sel' : ''}" data-k="${k}" style="left:${l.x * 100}%;top:${l.y * 100}%;width:${l.w * 100}%;z-index:${l.z || 0};transform:translate(-50%,-50%) rotate(${l.rot || 0}deg)">${img(it.img)}</div>`;
    }).join('') : `<div class="stage-empty">Pulsa “+ Prenda” para empezar</div>`;
    $view.querySelectorAll('.sel-only').forEach((b) => b.disabled = selected == null);
    hydrate(stage);
  };
  const place = (k) => {
    const el = stage.querySelector(`.layer[data-k="${k}"]`); const l = layers[k]; if (!el) return;
    el.style.left = l.x * 100 + '%'; el.style.top = l.y * 100 + '%'; el.style.width = l.w * 100 + '%';
    el.style.zIndex = l.z || 0; el.style.transform = `translate(-50%,-50%) rotate(${l.rot || 0}deg)`;
  };
  const pts = new Map(); let start = null;
  const snap = () => {
    const P = [...pts.values()];
    const l = layers[selected];
    return { l: { ...l }, p: P.map((p) => ({ ...p })), dist: P.length > 1 ? Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y) : 0, ang: P.length > 1 ? Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x) : 0 };
  };
  stage.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.layer');
    if (el && pts.size === 0) { selected = Number(el.dataset.k); stage.querySelectorAll('.layer').forEach((x) => x.classList.toggle('sel', x === el)); $view.querySelectorAll('.sel-only').forEach((b) => b.disabled = false); }
    else if (!el && pts.size === 0) { selected = null; draw(); return; }
    if (selected == null) return;
    stage.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    start = snap();
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || selected == null || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect(); const l = layers[selected]; const P = [...pts.values()];
    if (P.length === 1 && start.p.length === 1) {
      l.x = Math.min(1, Math.max(0, start.l.x + (P[0].x - start.p[0].x) / r.width));
      l.y = Math.min(1, Math.max(0, start.l.y + (P[0].y - start.p[0].y) / r.height));
    } else if (P.length > 1 && start.dist) {
      const d = Math.hypot(P[0].x - P[1].x, P[0].y - P[1].y);
      const a = Math.atan2(P[1].y - P[0].y, P[1].x - P[0].x);
      l.w = Math.min(1.2, Math.max(0.08, start.l.w * (d / start.dist)));
      l.rot = start.l.rot + ((a - start.ang) * 180) / Math.PI;
    }
    place(selected);
  });
  const up = (e) => { pts.delete(e.pointerId); start = pts.size ? snap() : null; };
  stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  $view.querySelector('#tools').onclick = async (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t; const l = layers[selected];
    if (t === 'add') {
      const ids = await pickItems({ title: 'Añadir al lienzo' });
      const maxZ = Math.max(0, ...layers.map((x) => x.z || 0));
      ids.forEach((id, k) => { const n = layers.length; layers.push({ itemId: id, x: 0.3 + (n % 3) * 0.2, y: 0.25 + (Math.floor(n / 3) % 3) * 0.25, w: 0.4, rot: 0, z: maxZ + k + 1 }); });
      selected = layers.length - 1; draw(); return;
    }
    if (!l) return;
    if (t === 'bigger') l.w = Math.min(1.2, l.w * 1.12);
    if (t === 'smaller') l.w = Math.max(0.08, l.w / 1.12);
    if (t === 'rotl') l.rot = (l.rot || 0) - 10;
    if (t === 'rotr') l.rot = (l.rot || 0) + 10;
    if (t === 'front') l.z = Math.max(...layers.map((x) => x.z || 0)) + 1;
    if (t === 'back') l.z = Math.min(...layers.map((x) => x.z || 0)) - 1;
    if (t === 'del') { layers.splice(selected, 1); selected = null; draw(); return; }
    place(selected);
  };
  $view.querySelector('#clear').onclick = () => { layers.length = 0; selected = null; draw(); };
  $view.querySelector('#save-cv').onclick = async () => {
    if (!layers.length) { toast('El lienzo está vacío'); return; }
    const existing = editId ? S.outfits.find((x) => x.id === editId) : null;
    const name = await promptBox('Nombre del outfit', existing?.name || '', 'Ej: Look de domingo'); if (name === null) return;
    const o = await createOutfit(name || 'Outfit', JSON.parse(JSON.stringify(layers)), existing);
    ui.canvas = null; ui.canvasEditing = null;
    toast('Outfit guardado'); ui.ptab = 'outfits'; go('/armario'); setTimeout(() => outfitSheet(o.id), 50);
  };
  draw();
});

function outfitSheet(id) {
  const o = S.outfits.find((x) => x.id === id); if (!o) return;
  const its = o.items.map(itemById).filter(Boolean);
  const total = its.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const timesWorn = S.plans.filter((p) => p.outfitId === o.id && p.worn).length;
  sheet(`<div class="row between"><h3>${esc(o.name)}</h3><button class="icon-btn" data-ren aria-label="Renombrar">${ICON.edit}</button></div>
    <div class="outfit-big">${img(o.preview)}</div>
    <p class="muted">${its.length} prendas · valor ${money(total)} · usado ${timesWorn} ${timesWorn === 1 ? 'vez' : 'veces'}</p>
    <div class="hscroll">${its.map((i) => `<a class="mini" href="#/prenda/${i.id}">${img(i.img)}</a>`).join('')}</div>
    <button class="btn block mt" data-wear>Me lo he puesto hoy</button>
    <div class="row gap mt"><button class="btn ghost grow" data-plan>Planificar</button><button class="btn ghost grow" data-lb>A lookbook</button></div>
    <div class="row gap mt"><button class="btn ghost grow" data-edit>Editar en lienzo</button><button class="btn ghost danger-text grow" data-del>Borrar</button></div>`,
  (b, close) => {
    b.querySelectorAll('a.mini').forEach((a) => a.onclick = () => close());
    b.querySelector('[data-ren]').onclick = async () => { const n = await promptBox('Nombre del outfit', o.name); if (n) { o.name = n; await save('outfits', o); close(); render(); } };
    b.querySelector('[data-wear]').onclick = async () => {
      const d = todayISO();
      const p = S.plans.find((x) => x.id === d) || { id: d, date: d, note: '' };
      p.outfitId = o.id; p.worn = true; await save('plans', p);
      await logWear(o.items, d); toast('¡Apuntado en el plan de hoy!'); close();
    };
    b.querySelector('[data-plan]').onclick = async () => {
      const d = await promptDate('¿Para qué día?'); if (!d) return;
      const p = S.plans.find((x) => x.id === d) || { id: d, date: d, note: '' };
      p.outfitId = o.id; await save('plans', p); toast('Planificado para ' + fmtDate(d)); close();
    };
    b.querySelector('[data-lb]').onclick = async () => { close(); await addToLookbook(o); };
    b.querySelector('[data-edit]').onclick = () => { close(); go('/outfits/lienzo/' + o.id); };
    b.querySelector('[data-del]').onclick = async () => {
      if (!(await confirmBox('¿Borrar este outfit?'))) return;
      await deleteImage(o.preview); await remove('outfits', o.id);
      for (const lb of S.lookbooks) if (lb.outfits.includes(o.id)) { lb.outfits = lb.outfits.filter((x) => x !== o.id); await save('lookbooks', lb); }
      close(); render();
    };
  }, { full: true });
}

function promptDate(title) {
  return new Promise((res) => {
    sheet(`<h3>${esc(title)}</h3><input type="date" class="input" id="d" value="${todayISO()}"><div class="row gap mt"><button class="btn ghost grow" data-no>Cancelar</button><button class="btn grow" data-yes>Aceptar</button></div>`,
      (b, close) => { b.querySelector('[data-no]').onclick = () => { close(); res(null); }; b.querySelector('[data-yes]').onclick = () => { close(); res(b.querySelector('#d').value); }; });
  });
}

async function addToLookbook(o) {
  sheet(`<h3>Añadir a lookbook</h3><div class="list">${S.lookbooks.map((lb) => `<button class="list-row" data-lb="${lb.id}"><span>${esc(lb.name)}</span><span class="muted">${lb.outfits.includes(o.id) ? '✓' : lb.outfits.length}</span></button>`).join('')}</div><button class="btn ghost block mt" data-new>+ Nuevo lookbook</button>`,
    (b, close) => {
      b.querySelectorAll('[data-lb]').forEach((x) => x.onclick = async () => {
        const lb = S.lookbooks.find((l) => l.id === x.dataset.lb);
        if (!lb.outfits.includes(o.id)) lb.outfits.push(o.id);
        await save('lookbooks', lb); toast('Añadido a ' + lb.name); close();
      });
      b.querySelector('[data-new]').onclick = async () => {
        close();
        const n = await promptBox('Nombre del lookbook', '', 'Ej: Verano 2027'); if (!n) return;
        await save('lookbooks', { id: uid(), name: n, outfits: [o.id], created: Date.now() }); toast('Lookbook creado');
      };
    });
}

route(/^\/lookbook\/([^/]+)$/, (id) => {
  const lb = S.lookbooks.find((x) => x.id === id); if (!lb) return go('/outfits/lookbooks');
  setHeader(lb.name, `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  const outs = lb.outfits.map((x) => S.outfits.find((o) => o.id === x)).filter(Boolean);
  $view.innerHTML = `<div class="row gap"><button class="btn ghost grow" id="add">+ Añadir outfit</button><button class="btn ghost grow" id="ren">Renombrar</button><button class="btn ghost danger-text grow" id="del">Borrar</button></div>
    <div class="grid two-col mt">${outs.map((o) => `<div class="card"><div class="thumb tall" data-o="${o.id}">${img(o.preview)}</div><div class="cap"><span>${esc(o.name)}</span><button class="x" data-rm="${o.id}">Quitar</button></div></div>`).join('') || '<div class="empty"><p>Lookbook vacío.</p></div>'}</div>`;
  $view.querySelector('#add').onclick = async () => { const oid = await pickOutfit(); if (oid && !lb.outfits.includes(oid)) { lb.outfits.push(oid); await save('lookbooks', lb); render(); } };
  $view.querySelector('#ren').onclick = async () => { const n = await promptBox('Nombre', lb.name); if (n) { lb.name = n; await save('lookbooks', lb); render(); } };
  $view.querySelector('#del').onclick = async () => { if (await confirmBox('¿Borrar el lookbook? (los outfits no se borran)')) { await remove('lookbooks', lb.id); ui.ptab = 'lookbooks'; go('/armario'); } };
  $view.querySelectorAll('[data-o]').forEach((x) => x.onclick = () => outfitSheet(x.dataset.o));
  $view.querySelectorAll('[data-rm]').forEach((x) => x.onclick = async () => { lb.outfits = lb.outfits.filter((o) => o !== x.dataset.rm); await save('lookbooks', lb); render(); });
});

// ================== PLANIFICADOR ==================
route(/^\/plan$/, () => {
  setHeader('Planificador');
  if (!ui.month) { const d = new Date(); ui.month = new Date(d.getFullYear(), d.getMonth(), 1); }
  const m = ui.month;
  const first = new Date(m.getFullYear(), m.getMonth(), 1);
  const startDow = (first.getDay() + 6) % 7; // lunes primero
  const daysIn = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
  const t = todayISO();
  let cells = '';
  for (let i = 0; i < startDow; i++) cells += '<div class="day blank"></div>';
  for (let d = 1; d <= daysIn; d++) {
    const iso = isoOf(new Date(m.getFullYear(), m.getMonth(), d));
    const p = S.plans.find((x) => x.id === iso);
    const o = p && S.outfits.find((x) => x.id === p.outfitId);
    cells += `<button class="day ${iso === t ? 'today' : ''} ${p?.worn ? 'worn' : ''}" data-d="${iso}"><span class="n">${d}</span>${o ? img(o.preview, 'day-img') : ''}${p?.note ? '<span class="evt"></span>' : ''}</button>`;
  }
  const upcoming = S.plans.filter((p) => p.date >= t && (p.outfitId || p.note)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  $view.innerHTML = `
    <div class="row between month-nav"><button class="icon-btn" id="prev">${ICON.back}</button><h2>${(() => { const t = m.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); return t[0].toUpperCase() + t.slice(1); })()}</h2><button class="icon-btn flip" id="next">${ICON.back}</button></div>
    <div class="cal-head">${['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="cal">${cells}</div>
    <h3 class="mt">Próximos</h3>
    <div class="list">${upcoming.length ? upcoming.map((p) => { const o = S.outfits.find((x) => x.id === p.outfitId); return `<button class="list-row" data-d="${p.date}"><span>${o ? img(o.preview, 'ico-img') : ''}<b>${fmtDate(p.date)}</b> ${esc(p.note || '')}</span><span class="muted">${o ? esc(o.name) : ''}</span></button>`; }).join('') : '<p class="muted">Nada planificado. Toca un día del calendario.</p>'}</div>`;
  $view.querySelector('#prev').onclick = () => { ui.month = new Date(m.getFullYear(), m.getMonth() - 1, 1); render(); };
  $view.querySelector('#next').onclick = () => { ui.month = new Date(m.getFullYear(), m.getMonth() + 1, 1); render(); };
  $view.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => daySheet(b.dataset.d));
});

function daySheet(date) {
  const p = S.plans.find((x) => x.id === date) || { id: date, date, note: '', outfitId: null, worn: false };
  const o = S.outfits.find((x) => x.id === p.outfitId);
  sheet(`<h3>${fmtDate(date)}</h3>
    <label class="lbl">Evento / nota</label><input class="input" id="note" value="${esc(p.note || '')}" placeholder="Cumple de Laura, entrevista…">
    <label class="lbl">Outfit</label>
    <div class="day-outfit" id="pick">${o ? `${img(o.preview)}<span>${esc(o.name)} · cambiar</span>` : '<span class="muted">+ Elegir outfit</span>'}</div>
    <label class="switch mt"><input type="checkbox" id="worn" ${p.worn ? 'checked' : ''}><span>Me lo puse (suma usos a las prendas)</span></label>
    <div class="row gap mt"><button class="btn ghost grow danger-text" id="clear">Quitar</button><button class="btn grow" id="ok">Guardar</button></div>`,
  (b, close) => {
    let outfitId = p.outfitId;
    b.querySelector('#pick').onclick = async () => {
      const id = await pickOutfit(); if (!id) return;
      outfitId = id; const no = S.outfits.find((x) => x.id === id);
      b.querySelector('#pick').innerHTML = `${img(no.preview)}<span>${esc(no.name)} · cambiar</span>`; hydrate(b);
    };
    b.querySelector('#ok').onclick = async () => {
      const wasWorn = p.worn, prevOutfit = S.outfits.find((x) => x.id === p.outfitId);
      p.note = b.querySelector('#note').value.trim(); p.outfitId = outfitId; p.worn = b.querySelector('#worn').checked;
      const now = S.outfits.find((x) => x.id === p.outfitId);
      if (wasWorn && prevOutfit) await unlogWear(prevOutfit.items, date);
      if (p.worn && now) await logWear(now.items, date);
      await save('plans', p); close(); render();
    };
    b.querySelector('#clear').onclick = async () => {
      if (p.worn && o) await unlogWear(o.items, date);
      if (S.plans.find((x) => x.id === date)) await remove('plans', date);
      close(); render();
    };
  });
}

// ================== ESTADÍSTICAS ==================
route(/^\/stats$/, () => {
  setHeader('Estadísticas');
  const A = active();
  if (!A.length) { $view.innerHTML = '<div class="empty"><p>Añade prendas para ver tus estadísticas.</p></div>'; return; }
  const t = todayISO();
  const totalValue = A.reduce((s, i) => s + (Number(i.price) || 0), 0);
  const totalWears = A.reduce((s, i) => s + wears(i), 0);
  const priced = A.filter((i) => i.price);
  const avgCpw = priced.length ? priced.reduce((s, i) => s + cpw(i), 0) / priced.length : null;
  const recent = A.filter((i) => (i.wears || []).some((d) => daysBetween(d, t) <= 90)).length;
  const never = A.filter((i) => !wears(i));
  const top = [...A].sort((a, b) => wears(b) - wears(a)).filter((i) => wears(i)).slice(0, 5);
  const bestCpw = [...priced].sort((a, b) => cpw(a) - cpw(b)).slice(0, 5);
  const worstCpw = [...priced].sort((a, b) => cpw(b) - cpw(a)).slice(0, 5);
  const forgotten = A.filter((i) => wears(i) && daysBetween(i.wears[i.wears.length - 1], t) > 90);
  const byColor = {}; A.forEach((i) => { const k = i.color?.name || 'Sin color'; byColor[k] = byColor[k] || { n: 0, hex: i.color?.hex || '#ccc' }; byColor[k].n++; });
  const colors = Object.entries(byColor).sort((a, b) => b[1].n - a[1].n);
  const byCat = CATS.map((c) => ({ c, n: A.filter((i) => i.cat === c.id).length })).filter((x) => x.n);
  const maxCat = Math.max(...byCat.map((x) => x.n));
  const second = A.filter((i) => i.condition === 'segunda').length;
  const withDate = A.filter((i) => i.buyDate);
  const avgAge = withDate.length ? Math.round(withDate.reduce((s, i) => s + daysBetween(i.buyDate, t), 0) / withDate.length) : null;
  // adiciones netas últimos 6 meses
  const months = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - k);
    const key = isoOf(d).slice(0, 7);
    const added = S.items.filter((i) => (i.buyDate || isoOf(new Date(i.created || 0))).slice(0, 7) === key).length;
    const out = S.items.filter((i) => i.archived && (i.archivedAt || '').slice(0, 7) === key).length;
    months.push({ label: d.toLocaleDateString('es-ES', { month: 'short' }), added, out });
  }
  const maxM = Math.max(1, ...months.map((m) => Math.max(m.added, m.out)));
  const spentYear = S.items.filter((i) => i.buyDate && i.buyDate.slice(0, 4) === t.slice(0, 4)).reduce((s, i) => s + (Number(i.price) || 0), 0);
  const list = (arr, val) => arr.length ? arr.map((i) => `<a class="list-row" href="#/prenda/${i.id}"><span>${img(i.img, 'ico-img')}${esc(i.name || catLabel(i.cat))}</span><b>${val(i)}</b></a>`).join('') : '<p class="muted">—</p>';
  $view.innerHTML = `
    <div class="kpis">
      <div><b>${A.length}</b><span>prendas</span></div>
      <div><b>${money(totalValue)}</b><span>valor del armario</span></div>
      <div><b>${avgCpw != null ? money(avgCpw) : '—'}</b><span>coste medio por uso</span></div>
      <div><b>${Math.round((recent / A.length) * 100)}%</b><span>usado (90 días)</span></div>
      <div><b>${totalWears}</b><span>usos totales</span></div>
      <div><b>${money(spentYear)}</b><span>gastado este año</span></div>
    </div>
    <section class="box"><h3>Paleta de colores</h3>
      <div class="palette">${colors.map(([n, v]) => `<span style="flex:${v.n};background:${esc(v.hex)}" title="${esc(n)}"></span>`).join('')}</div>
      <div class="legend">${colors.map(([n, v]) => `<span><i class="dot" style="background:${esc(v.hex)}"></i>${esc(n)} ${Math.round((v.n / A.length) * 100)}%</span>`).join('')}</div>
      ${(() => { const have = new Set(colors.map((c) => c[0])); const gaps = ['Negro', 'Blanco', 'Beige', 'Azul marino', 'Gris'].filter((c) => !have.has(c)); return gaps.length ? `<p class="muted small">Básicos que no tienes: ${gaps.join(', ')}</p>` : ''; })()}
    </section>
    <section class="box"><h3>Por categoría</h3>${byCat.map((x) => `<div class="bar"><span>${esc(x.c.label)}</span><div><i style="width:${(x.n / maxCat) * 100}%"></i></div><b>${x.n}</b></div>`).join('')}</section>
    <section class="box"><h3>Más usadas</h3><div class="list">${list(top, (i) => wears(i) + '×')}</div></section>
    <section class="box"><h3>Mejor coste por uso</h3><p class="muted small">Tus mejores inversiones</p><div class="list">${list(bestCpw, (i) => money(cpw(i)))}</div></section>
    <section class="box"><h3>Peor coste por uso</h3><p class="muted small">Ponte más estas prendas</p><div class="list">${list(worstCpw, (i) => money(cpw(i)))}</div></section>
    <section class="box"><h3>Nunca usadas (${never.length})</h3><div class="hscroll">${never.map((i) => `<a class="mini" href="#/prenda/${i.id}">${img(i.img)}</a>`).join('') || '<p class="muted">¡Todo usado!</p>'}</div></section>
    <section class="box"><h3>Olvidadas (+90 días sin usar)</h3><div class="hscroll">${forgotten.map((i) => `<a class="mini" href="#/prenda/${i.id}">${img(i.img)}</a>`).join('') || '<p class="muted">Nada olvidado.</p>'}</div></section>
    <section class="box"><h3>Nuevo vs segunda mano</h3>
      <div class="split"><span style="flex:${A.length - second}">Nuevo ${Math.round(((A.length - second) / A.length) * 100)}%</span><span style="flex:${Math.max(second, 0.0001)}" class="alt">${second ? `2ª mano ${Math.round((second / A.length) * 100)}%` : ''}</span></div>
    </section>
    <section class="box"><h3>Durabilidad del armario</h3>
      <p>${avgAge != null ? `Edad media de tus prendas: <b>${avgAge} días</b> (${(avgAge / 365).toFixed(1)} años).` : 'Pon la fecha de compra a tus prendas para ver su vida útil.'}</p>
      <p class="muted small">Altas y bajas (archivadas) de los últimos 6 meses</p>
      <div class="months">${months.map((m) => `<div><div class="mbars"><i class="in" style="height:${(m.added / maxM) * 100}%"></i><i class="out" style="height:${(m.out / maxM) * 100}%"></i></div><span>${m.label}</span></div>`).join('')}</div>
      <div class="legend"><span><i class="dot in"></i>Nuevas</span><span><i class="dot out"></i>Retiradas</span></div>
    </section>`;
});

// ================== MÁS ==================
route(/^\/mas$/, () => {
  setHeader('Más');
  $view.innerHTML = `<div class="list big-list">
    <a class="list-row" href="#/maletas"><span>${ICON.bag} Maletas y viajes</span><span class="muted">${S.trips.length}</span></a>
    <a class="list-row" href="#/deseos"><span>${ICON.heart} Lista de deseos</span><span class="muted">${S.wishes.length}</span></a>
    <a class="list-row" href="#/outfits/moodboards"><span>${ICON.board} Moodboards</span><span class="muted">${S.boards.length}</span></a>
    <a class="list-row" href="#/ajustes"><span>${ICON.gear} Ajustes y copia de seguridad</span><span></span></a>
  </div>`;
});

// ---------- Maletas ----------
route(/^\/maletas$/, () => {
  setHeader('Maletas', `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  $view.innerHTML = `<button class="btn block" id="new">+ Nuevo viaje</button>
    <div class="list mt">${[...S.trips].sort((a, b) => (a.start || '').localeCompare(b.start || '')).map((tr) => {
      const tot = tr.items.length + tr.extras.length; const done = tr.items.filter((x) => x.packed).length + tr.extras.filter((x) => x.done).length;
      return `<a class="list-row" href="#/maleta/${tr.id}"><span><b>${esc(tr.name)}</b><br><span class="muted small">${tr.start ? fmtDate(tr.start) : ''}${tr.end ? ' → ' + fmtDate(tr.end) : ''}</span></span><span class="muted">${done}/${tot}</span></a>`;
    }).join('') || '<p class="muted">Sin viajes todavía.</p>'}</div>`;
  $view.querySelector('#new').onclick = async () => {
    const n = await promptBox('¿A dónde vas?', '', 'Ej: París'); if (!n) return;
    const tr = { id: uid(), name: n, start: null, end: null, items: [], extras: [{ text: 'Cargador del móvil', done: false }, { text: 'Neceser', done: false }, { text: 'Pijama', done: false }, { text: 'Documentación', done: false }] };
    await save('trips', tr); go('/maleta/' + tr.id);
  };
});
route(/^\/maleta\/([^/]+)$/, (id) => {
  const tr = S.trips.find((x) => x.id === id); if (!tr) return go('/maletas');
  setHeader(tr.name, `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  const tot = tr.items.length + tr.extras.length; const done = tr.items.filter((x) => x.packed).length + tr.extras.filter((x) => x.done).length;
  const days = tr.start && tr.end ? daysBetween(tr.start, tr.end) + 1 : null;
  $view.innerHTML = `
    <div class="two"><div><label class="lbl">Ida</label><input type="date" class="input" id="s" value="${esc(tr.start || '')}"></div><div><label class="lbl">Vuelta</label><input type="date" class="input" id="e" value="${esc(tr.end || '')}"></div></div>
    ${days ? `<p class="muted">${days} días · ${tr.items.length} prendas${tr.items.length ? ` (${(tr.items.length / days).toFixed(1)} por día)` : ''}</p>` : ''}
    <div class="progress"><i style="width:${tot ? (done / tot) * 100 : 0}%"></i></div><p class="muted small">${done} de ${tot} en la maleta</p>
    <div class="row gap"><button class="btn ghost grow" id="add">+ Prendas</button><button class="btn ghost grow" id="fromplan">Del planificador</button></div>
    <h3 class="mt">Ropa</h3>
    <div class="list">${tr.items.map((x, k) => { const it = itemById(x.itemId); if (!it) return ''; return `<div class="list-row check ${x.packed ? 'done' : ''}" data-k="${k}"><span>${img(it.img, 'ico-img')}${esc(it.name || catLabel(it.cat))}</span><span><button class="x" data-rm="${k}">×</button><input type="checkbox" ${x.packed ? 'checked' : ''}></span></div>`; }).join('') || '<p class="muted">Añade la ropa que te llevas.</p>'}</div>
    <h3 class="mt">Otras cosas</h3>
    <div class="list">${tr.extras.map((x, k) => `<div class="list-row check ${x.done ? 'done' : ''}" data-x="${k}"><span>${esc(x.text)}</span><span><button class="x" data-rmx="${k}">×</button><input type="checkbox" ${x.done ? 'checked' : ''}></span></div>`).join('')}</div>
    <div class="row gap mt"><input class="input grow" id="extra" placeholder="Añadir (ej: gafas de sol)"><button class="btn" id="addx">+</button></div>
    <button class="btn ghost danger-text block mt" id="del">Borrar viaje</button>`;
  const persist = async () => { await save('trips', tr); render(); };
  $view.querySelector('#s').onchange = (e) => { tr.start = e.target.value || null; persist(); };
  $view.querySelector('#e').onchange = (e) => { tr.end = e.target.value || null; persist(); };
  $view.querySelector('#add').onclick = async () => {
    const ids = await pickItems({ selected: tr.items.map((x) => x.itemId), title: 'Ropa para el viaje' });
    const keep = tr.items.filter((x) => ids.includes(x.itemId));
    ids.forEach((i) => { if (!keep.find((x) => x.itemId === i)) keep.push({ itemId: i, packed: false }); });
    tr.items = keep; persist();
  };
  $view.querySelector('#fromplan').onclick = () => {
    if (!tr.start || !tr.end) { toast('Pon primero las fechas'); return; }
    const ps = S.plans.filter((p) => p.date >= tr.start && p.date <= tr.end && p.outfitId);
    let n = 0;
    for (const p of ps) { const o = S.outfits.find((x) => x.id === p.outfitId); if (!o) continue; for (const i of o.items) if (!tr.items.find((x) => x.itemId === i)) { tr.items.push({ itemId: i, packed: false }); n++; } }
    toast(n ? `${n} prendas añadidas desde el plan` : 'No hay outfits planificados en esas fechas'); persist();
  };
  $view.querySelectorAll('[data-k]').forEach((r) => r.onclick = (e) => { if (e.target.closest('[data-rm]')) return; const x = tr.items[Number(r.dataset.k)]; x.packed = !x.packed; persist(); });
  $view.querySelectorAll('[data-x]').forEach((r) => r.onclick = (e) => { if (e.target.closest('[data-rmx]')) return; const x = tr.extras[Number(r.dataset.x)]; x.done = !x.done; persist(); });
  $view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => { tr.items.splice(Number(b.dataset.rm), 1); persist(); });
  $view.querySelectorAll('[data-rmx]').forEach((b) => b.onclick = () => { tr.extras.splice(Number(b.dataset.rmx), 1); persist(); });
  const addExtra = () => { const v = $view.querySelector('#extra').value.trim(); if (!v) return; tr.extras.push({ text: v, done: false }); persist(); };
  $view.querySelector('#addx').onclick = addExtra;
  $view.querySelector('#extra').onkeydown = (e) => { if (e.key === 'Enter') addExtra(); };
  $view.querySelector('#del').onclick = async () => { if (await confirmBox('¿Borrar este viaje?')) { await remove('trips', tr.id); go('/maletas'); } };
});

// ---------- Lista de deseos ----------
route(/^\/deseos$/, () => {
  setHeader('Lista de deseos', `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  const total = S.wishes.reduce((s, w) => s + (Number(w.price) || 0), 0);
  $view.innerHTML = `<button class="btn block" id="new">+ Añadir deseo</button>
    <p class="muted">${S.wishes.length} cosas · ${money(total)} en total</p>
    <div class="grid two-col">${[...S.wishes].sort((a, b) => (b.priority || 0) - (a.priority || 0)).map((w) => `<button class="card" data-w="${w.id}"><div class="thumb">${img(w.img)}</div><div class="cap"><span>${esc(w.name)}</span><span class="muted">${w.price ? money(w.price) : ''}</span></div></button>`).join('')}</div>`;
  $view.querySelector('#new').onclick = () => wishSheet({});
  $view.querySelectorAll('[data-w]').forEach((b) => b.onclick = () => wishDetail(b.dataset.w));
});

function wishSheet(w) {
  sheet(`<h3>${w.id ? 'Editar deseo' : 'Nuevo deseo'}</h3>
    <div class="photo-box small" id="photo">${w.img ? img(w.img) : `<div class="photo-empty">${ICON.camera}<span>Foto (captura de la tienda, por ejemplo)</span></div>`}</div>
    <label class="switch"><input type="checkbox" id="bg" ${S.settings.autoBg ? 'checked' : ''}><span>Quitar fondo</span></label>
    <p class="status" id="status"></p>
    <label class="lbl">Nombre</label><input class="input" id="n" value="${esc(w.name || '')}">
    <label class="lbl">Categoría</label><select class="input" id="c">${CATS.map((c) => `<option value="${c.id}" ${w.cat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}</select>
    <div class="two"><div><label class="lbl">Precio</label><input class="input" id="p" inputmode="decimal" value="${esc(w.price ?? '')}"></div>
    <div><label class="lbl">Prioridad</label><select class="input" id="pr">${[[3, 'Lo quiero ya'], [2, 'Me gusta mucho'], [1, 'Algún día']].map(([v, l]) => `<option value="${v}" ${w.priority == v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <label class="lbl">Enlace de la tienda</label><input class="input" id="l" value="${esc(w.link || '')}" placeholder="https://…">
    <label class="lbl">Notas</label><input class="input" id="no" value="${esc(w.notes || '')}">
    <button class="btn block mt" id="ok">Guardar</button>`,
  (b, close) => {
    let pending = null, color = w.color;
    const choose = async () => {
      const [f] = await pickFile(); if (!f) return;
      const r = await processPhoto(f, b.querySelector('#status'), b.querySelector('#bg').checked);
      pending = r.finalBlob; color = r.color;
      b.querySelector('#photo').innerHTML = `<img src="${URL.createObjectURL(pending)}" alt="">`;
    };
    b.querySelector('#photo').onclick = choose;
    b.querySelector('#ok').onclick = async () => {
      if (!b.querySelector('#n').value.trim()) { toast('Ponle un nombre'); return; }
      if (pending) { if (w.img) await deleteImage(w.img); w.img = await saveImage(pending); }
      const price = parseFloat(String(b.querySelector('#p').value).replace(',', '.'));
      Object.assign(w, { name: b.querySelector('#n').value.trim(), cat: b.querySelector('#c').value, price: isNaN(price) ? null : price, priority: Number(b.querySelector('#pr').value), link: b.querySelector('#l').value.trim(), notes: b.querySelector('#no').value.trim(), color });
      if (!w.id) { w.id = uid(); w.created = Date.now(); }
      await save('wishes', w); close(); render();
    };
  }, { full: true });
}

function wishDetail(id) {
  const w = S.wishes.find((x) => x.id === id); if (!w) return;
  const similar = active().filter((i) => i.cat === w.cat && (!w.color || i.color?.name === w.color.name));
  const sameCat = active().filter((i) => i.cat === w.cat);
  sheet(`${w.img ? `<div class="outfit-big">${img(w.img)}</div>` : ''}<h3>${esc(w.name)}</h3>
    <p class="muted">${esc(catLabel(w.cat))} · ${money(w.price)}${w.notes ? ' · ' + esc(w.notes) : ''}</p>
    ${w.link && /^https?:\/\//i.test(w.link) ? `<a class="btn ghost block" href="${esc(w.link)}" target="_blank" rel="noopener">Abrir tienda</a>` : ''}
    <section class="box mt"><h3>Antes de comprar…</h3>
      <p class="muted small">Ya tienes ${sameCat.length} ${sameCat.length === 1 ? 'prenda' : 'prendas'} de esta categoría${similar.length && w.color ? `, ${similar.length} en ${esc(w.color.name.toLowerCase())}` : ''}.</p>
      <div class="hscroll">${(similar.length ? similar : sameCat).slice(0, 12).map((i) => `<a class="mini" href="#/prenda/${i.id}">${img(i.img)}</a>`).join('')}</div>
    </section>
    <button class="btn block mt" data-buy>¡Lo compré! Pasar al armario</button>
    <div class="row gap mt"><button class="btn ghost grow" data-edit>Editar</button><button class="btn ghost danger-text grow" data-del>Borrar</button></div>`,
  (b, close) => {
    b.querySelectorAll('a.mini').forEach((a) => a.onclick = () => close());
    b.querySelector('[data-edit]').onclick = () => { close(); wishSheet(w); };
    b.querySelector('[data-del]').onclick = async () => { if (await confirmBox('¿Borrar de la lista de deseos?')) { await deleteImage(w.img); await remove('wishes', w.id); close(); render(); } };
    b.querySelector('[data-buy]').onclick = async () => {
      const it = { id: uid(), created: Date.now(), wears: [], name: w.name, cat: w.cat, img: w.img, price: w.price, buyDate: todayISO(), condition: 'nuevo', color: w.color || null, seasons: [], tags: [], notes: w.notes || '' };
      await save('items', it); await remove('wishes', w.id);
      close(); toast('¡A tu armario!'); go('/prenda/' + it.id);
    };
  }, { full: true });
}

// ---------- Moodboards ----------
route(/^\/moodboards$/, () => go('/outfits/moodboards'));
route(/^\/outfits\/moodboards$/, () => {
  setHeader('Estilismo');
  $view.innerHTML = `${outfitTabs('moodboards')}<button class="btn block" id="new">+ Nuevo moodboard</button>
    <div class="grid two-col mt">${S.boards.map((bd) => {
      const ims = bd.cards.filter((c) => c.img || c.outfit).slice(0, 4).map((c) => c.img || S.outfits.find((o) => o.id === c.outfit)?.preview).filter(Boolean);
      return `<a class="card" href="#/moodboard/${bd.id}"><div class="thumb collage">${ims.map((i) => img(i)).join('') || '<div class="noimg"></div>'}</div><div class="cap"><span>${esc(bd.name)}</span><span class="muted">${bd.cards.length}</span></div></a>`;
    }).join('')}</div>`;
  $view.querySelector('#new').onclick = async () => {
    const n = await promptBox('Nombre del moodboard', '', 'Ej: Estilo coquette'); if (!n) return;
    const bd = { id: uid(), name: n, cards: [], created: Date.now() }; await save('boards', bd); go('/moodboard/' + bd.id);
  };
});
route(/^\/moodboard\/([^/]+)$/, (id) => {
  const bd = S.boards.find((x) => x.id === id); if (!bd) return go('/moodboards');
  setHeader(bd.name, `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  $view.innerHTML = `<div class="row gap wrap-row"><button class="btn ghost small" id="ph">+ Fotos</button><button class="btn ghost small" id="ou">+ Outfit</button><button class="btn ghost small" id="it">+ Prendas</button><button class="btn ghost small" id="nt">+ Nota</button><button class="btn ghost small danger-text" id="del">Borrar</button></div>
    <div class="masonry mt">${bd.cards.map((c, k) => {
      if (c.note != null) return `<div class="mcard note" data-k="${k}">${esc(c.note)}</div>`;
      const im = c.img || S.outfits.find((o) => o.id === c.outfit)?.preview || itemById(c.item)?.img;
      return `<div class="mcard ${c.item ? 'item' : ''}" data-k="${k}">${img(im)}</div>`;
    }).join('') || '<p class="muted">Añade fotos de inspiración, outfits o prendas.</p>'}</div>`;
  const persist = async () => { await save('boards', bd); render(); };
  $view.querySelector('#ph').onclick = async () => {
    const files = await pickFile(true); if (!files.length) return;
    toast('Añadiendo…');
    for (const f of files) bd.cards.push({ img: await saveImage(await IT.shrink(f, 1400)) });
    persist();
  };
  $view.querySelector('#ou').onclick = async () => { const o = await pickOutfit(); if (o) { bd.cards.push({ outfit: o }); persist(); } };
  $view.querySelector('#it').onclick = async () => { const ids = await pickItems({ title: 'Prendas para el moodboard' }); ids.forEach((i) => bd.cards.push({ item: i })); if (ids.length) persist(); };
  $view.querySelector('#nt').onclick = async () => { const t = await promptBox('Nota', '', 'Idea, frase, colores…'); if (t) { bd.cards.push({ note: t }); persist(); } };
  $view.querySelector('#del').onclick = async () => {
    if (!(await confirmBox('¿Borrar el moodboard?'))) return;
    for (const c of bd.cards) if (c.img) await deleteImage(c.img);
    await remove('boards', bd.id); go('/moodboards');
  };
  $view.querySelectorAll('.mcard').forEach((el) => el.onclick = async () => {
    const k = Number(el.dataset.k); const c = bd.cards[k];
    if (c.outfit) { outfitSheet(c.outfit); return; }
    sheet(`<div class="row gap"><button class="btn ghost grow" data-l>← Mover</button><button class="btn ghost grow" data-r>Mover →</button></div><button class="btn ghost danger-text block mt" data-x>Quitar del moodboard</button>${c.item ? '<a class="btn ghost block mt" data-go>Ver prenda</a>' : ''}`,
      (b, close) => {
        b.querySelector('[data-l]').onclick = () => { if (k > 0) { [bd.cards[k - 1], bd.cards[k]] = [bd.cards[k], bd.cards[k - 1]]; } close(); persist(); };
        b.querySelector('[data-r]').onclick = () => { if (k < bd.cards.length - 1) { [bd.cards[k + 1], bd.cards[k]] = [bd.cards[k], bd.cards[k + 1]]; } close(); persist(); };
        b.querySelector('[data-x]').onclick = async () => { if (c.img) await deleteImage(c.img); bd.cards.splice(k, 1); close(); persist(); };
        const g = b.querySelector('[data-go]'); if (g) g.onclick = () => { close(); go('/prenda/' + c.item); };
      });
  });
});

// ---------- Ajustes / copia de seguridad ----------
route(/^\/ajustes$/, async () => {
  setHeader('Ajustes', `<button class="icon-btn" onclick="history.back()" aria-label="Volver">${ICON.back}</button>`);
  let est = '';
  try { const e = await navigator.storage?.estimate?.(); if (e) est = `Usando ${(e.usage / 1048576).toFixed(1)} MB`; } catch {}
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  $view.innerHTML = `
    <section class="box"><h3>Preferencias</h3>
      <label class="lbl">Moneda</label><select class="input" id="cur">${['€', '$', '£', 'MXN', 'COP', 'ARS', 'CLP'].map((c) => `<option ${S.settings.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <label class="switch mt"><input type="checkbox" id="bg" ${S.settings.autoBg ? 'checked' : ''}><span>Quitar fondo automáticamente al añadir</span></label>
    </section>
    <section class="box"><h3>Copia de seguridad</h3>
      <p class="muted small">Todo se guarda solo en este móvil. Haz una copia de vez en cuando (por ejemplo, guárdala en iCloud Drive) para no perder nada si cambias de móvil.</p>
      <p class="muted small">${est}${persisted ? ' · almacenamiento protegido ✓' : ''}</p>
      <button class="btn block" id="exp">Exportar copia</button>
      <button class="btn ghost block mt" id="imp">Importar copia</button>
    </section>
    <section class="box"><h3>Zona peligrosa</h3><button class="btn ghost danger-text block" id="wipe">Borrar todo</button></section>
    <p class="muted center small">Armario Virtual de Moni · v3</p>`;
  $view.querySelector('#cur').onchange = async (e) => { S.settings.currency = e.target.value; await db.put('meta', { id: 'settings', ...S.settings }); };
  $view.querySelector('#bg').onchange = async (e) => { S.settings.autoBg = e.target.checked; await db.put('meta', { id: 'settings', ...S.settings }); };
  $view.querySelector('#exp').onclick = exportBackup;
  $view.querySelector('#imp').onclick = importBackup;
  $view.querySelector('#wipe').onclick = async () => {
    if (!(await confirmBox('Se borrará TODO el armario de este móvil. ¿Seguro?'))) return;
    for (const s of STORES) await db.clear(s);
    location.hash = '#/armario'; location.reload();
  };
});

async function exportBackup() {
  toast('Preparando copia…');
  const data = { app: 'armario-moni', version: 1, date: new Date().toISOString(), stores: {} };
  for (const s of STORES) {
    if (s === 'images') continue;
    data.stores[s] = await db.all(s);
  }
  const imgs = await db.all('images');
  data.images = [];
  for (const r of imgs) data.images.push({ id: r.id, data: await IT.blobToDataURL(r.blob) });
  const file = new File([JSON.stringify(data)], `armario-moni-${todayISO()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Copia del armario' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
}

async function importBackup() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
  i.onchange = async () => {
    const f = i.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'armario-moni') throw new Error('formato');
      if (!(await confirmBox('Esto reemplaza lo que hay ahora por la copia. ¿Continuar?', 'Sí, importar'))) return;
      for (const s of STORES) await db.clear(s);
      for (const [s, rows] of Object.entries(data.stores)) if (STORES.includes(s)) for (const r of rows) await db.put(s, r);
      for (const im of data.images || []) await db.put('images', { id: im.id, blob: await IT.dataURLToBlob(im.data) });
      toast('Copia importada'); setTimeout(() => location.reload(), 600);
    } catch (e) { console.error(e); toast('Ese archivo no es una copia válida'); }
  };
  i.click();
}

// ================== iconos ==================
const sv = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${extra}>${p}</svg>`;
const ICON = {
  plus: sv('<path d="M12 5v14M5 12h14"/>'),
  close: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
  back: sv('<path d="M15 5l-7 7 7 7"/>'),
  search: sv('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  camera: sv('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  lock: sv('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  unlock: sv('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>'),
  dice: sv('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r=".8" fill="currentColor"/><circle cx="15" cy="15" r=".8" fill="currentColor"/><circle cx="15" cy="9" r=".8" fill="currentColor"/><circle cx="9" cy="15" r=".8" fill="currentColor"/><circle cx="12" cy="12" r=".8" fill="currentColor"/>'),
  check: sv('<path d="m5 12 4.5 4.5L19 7"/>'),
  edit: sv('<path d="M4 20h4L19 9l-4-4L4 16z"/>'),
  bag: sv('<rect x="4" y="7" width="16" height="13" rx="2"/><path d="M9 7V5h6v2M8 11v5M16 11v5"/>'),
  heart: sv('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>'),
  board: sv('<rect x="4" y="4" width="7" height="9" rx="1"/><rect x="13" y="4" width="7" height="5" rx="1"/><rect x="13" y="11" width="7" height="9" rx="1"/><rect x="4" y="15" width="7" height="5" rx="1"/>'),
  sliders: sv('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  pin: sv('<path d="M9 4h6l-1 5 3 3H7l3-3z"/><path d="M12 12v8"/>'),
  brush: sv('<path d="M14 4l6 6-8 8H6v-6z"/><path d="M11 7l6 6"/>'),
  heartFill: sv('<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" fill="currentColor"/>'),
  gear: sv('<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>'),
};

// ================== arranque ==================
async function boot() {
  for (const s of STORES) {
    if (s === 'images' || s === 'meta') continue;
    S[s] = await db.all(s);
  }
  const st = await db.get('meta', 'settings');
  if (st) { delete st.id; Object.assign(S.settings, st); }
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
}
boot();
