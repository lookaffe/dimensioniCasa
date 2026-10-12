'use strict';

// Tutte le misure sono in centimetri; y cresce verso il basso (come in SVG).

const STORE = 'dimensioniCasa.v1';
const GRID = 5;     // passo dello snap, cm
const WALL = 20;    // spessore dei muri disegnato (verso l'esterno), cm
const MAGNET = 8;   // distanza entro cui un mobile "si attacca" a un muro, cm
const PRESETS = [
  ['Letto matrimoniale', 160, 200], ['Letto singolo', 90, 200], ['Comodino', 40, 40],
  ['Armadio', 100, 60], ['Divano 3 posti', 200, 90], ['Tavolo', 140, 80], ['Sedia', 45, 45],
  ['Scrivania', 140, 70], ['Libreria', 80, 30], ['Frigorifero', 60, 65], ['Lavatrice', 60, 60],
];
const COLORS = ['#8fb8de', '#e6b17e', '#a8d5a2', '#d9a7c7', '#f2d57e', '#b5a9e0', '#9ad1cf'];

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8);
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const snapTo = (v, s = GRID) => Math.round(v / s) * s;
const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- stato ---------- */

const rectPts = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
const newRoom = (name, w, d) => ({ id: uid(), name, pts: rectPts(w, d), openings: [], furniture: [] });

function defaultState() {
  const r = newRoom('Stanza 1', 400, 350);
  return { rooms: [r], current: r.id };
}

function valid(s) {
  return !!s && Array.isArray(s.rooms) && s.rooms.length > 0 && s.rooms.every((r) =>
    r && Array.isArray(r.pts) && r.pts.length >= 3 && Array.isArray(r.openings) && Array.isArray(r.furniture));
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    return valid(s) ? s : null;
  } catch { return null; }
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage non disponibile */ }
}

let state = load() || defaultState();
const ui = { view: { x: 0, y: 0, k: 0.5 }, sel: null, drag: null, open: {}, draft: {} };
const history = [];

const room = () => state.rooms.find((r) => r.id === state.current) || state.rooms[0];

function snap() {
  history.push(JSON.stringify(state));
  if (history.length > 100) history.shift();
}

function undo() {
  const s = history.pop();
  if (!s) return;
  state = JSON.parse(s);
  ui.sel = null;
  commit();
}

/* ---------- geometria ---------- */

function signedArea(p) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

// Parete i: dal vertice i al vertice i+1. n = normale verso l'esterno della stanza.
function edge(r, i) {
  const n = r.pts.length, a = r.pts[i % n], b = r.pts[(i + 1) % n];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const u = len ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
  const o = signedArea(r.pts) > 0 ? 1 : -1;
  return { a, b, len, u, n: { x: u.y * o, y: -u.x * o } };
}

function inPoly(p, pts) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function corners(f, shrink = 0) {
  const hw = f.w / 2 - shrink, hd = f.d / 2 - shrink, t = (f.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, y]) => ({ x: f.x + x * c - y * s, y: f.y + x * s + y * c }));
}

function outside(f, r) {
  if (corners(f, 0.5).some((p) => !inPoly(p, r.pts))) return true;
  // un vertice rientrante della stanza non deve cadere dentro il mobile
  const t = (-f.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return r.pts.some((p) => {
    const dx = p.x - f.x, dy = p.y - f.y;
    return Math.abs(dx * c - dy * s) < f.w / 2 - 0.5 && Math.abs(dx * s + dy * c) < f.d / 2 - 0.5;
  });
}

function overlap(a, b) {
  const A = corners(a), B = corners(b);
  for (const P of [A, B]) {
    for (let i = 0; i < 2; i++) {
      const ex = P[i + 1].x - P[i].x, ey = P[i + 1].y - P[i].y, l = Math.hypot(ex, ey) || 1;
      const ax = -ey / l, ay = ex / l;
      const pr = (Q) => { const v = Q.map((p) => p.x * ax + p.y * ay); return [Math.min(...v), Math.max(...v)]; };
      const [a0, a1] = pr(A), [b0, b1] = pr(B);
      if (a1 <= b0 + 0.5 || b1 <= a0 + 0.5) return false;
    }
  }
  return true;
}

function furnStatus(r) {
  const m = {};
  for (const f of r.furniture) m[f.id] = { out: outside(f, r), ov: false };
  for (let i = 0; i < r.furniture.length; i++) {
    for (let j = i + 1; j < r.furniture.length; j++) {
      if (overlap(r.furniture[i], r.furniture[j])) { m[r.furniture[i].id].ov = true; m[r.furniture[j].id].ov = true; }
    }
  }
  return m;
}

// "Calamita": se un lato del mobile è vicino a un muro verticale/orizzontale, lo appoggia.
function magnet(f, r) {
  const cs = corners(f), xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  let bx = null, by = null;
  for (let i = 0; i < r.pts.length; i++) {
    const { a, b } = edge(r, i);
    if (Math.abs(a.x - b.x) < 0.01 && Math.min(a.y, b.y) < maxy && Math.max(a.y, b.y) > miny) {
      for (const d of [a.x - minx, a.x - maxx]) if (Math.abs(d) <= MAGNET && (bx === null || Math.abs(d) < Math.abs(bx))) bx = d;
    }
    if (Math.abs(a.y - b.y) < 0.01 && Math.min(a.x, b.x) < maxx && Math.max(a.x, b.x) > minx) {
      for (const d of [a.y - miny, a.y - maxy]) if (Math.abs(d) <= MAGNET && (by === null || Math.abs(d) < Math.abs(by))) by = d;
    }
  }
  if (bx !== null) f.x += bx;
  if (by !== null) f.y += by;
}

function bbox(r) {
  const pts = [...r.pts, ...r.furniture.flatMap((f) => corners(f))];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/* ---------- operazioni sulla forma della stanza ---------- */

// Un'apertura è ancorata all'inizio o alla fine della sua parete (o.from).
// offset = distanza dal lato di ancoraggio al bordo più vicino dell'apertura.
const opStart = (o, len) => (o.from === 'end' ? len - o.offset - o.width : o.offset);
const setOpStart = (o, len, s) => { o.offset = o.from === 'end' ? len - s - o.width : s; };

function insertPt(r, i, d) {
  const e = edge(r, i), rest = e.len - d;
  const olds = r.openings.map((o) => ({ o, w: o.wall, s: o.wall < r.pts.length ? opStart(o, edge(r, o.wall).len) : o.offset }));
  r.pts.splice(i + 1, 0, { x: e.a.x + e.u.x * d, y: e.a.y + e.u.y * d });
  for (const { o, w, s } of olds) {
    if (w === i) { if (s >= d) { o.wall = i + 1; setOpStart(o, rest, s - d); } else setOpStart(o, d, s); }
    else if (w > i) o.wall = w + 1;
  }
}

function deletePt(r, j) {
  const n = r.pts.length;
  if (n <= 3) return;
  const prev = (j - 1 + n) % n, prevLen = edge(r, prev).len, merged = j > 0 ? j - 1 : n - 2;
  const olds = r.openings.map((o) => ({ o, w: o.wall, s: o.wall < n ? opStart(o, edge(r, o.wall).len) : o.offset }));
  r.pts.splice(j, 1);
  const newLen = edge(r, merged).len;
  for (const { o, w, s } of olds) {
    if (w === prev) { o.wall = merged; setOpStart(o, newLen, s); }
    else if (w === j) { o.wall = merged; setOpStart(o, newLen, s + prevLen); }
    else if (w > j) o.wall = w - 1;
  }
}

// Rientro (nicchia nel muro) o sporgenza (pilastro) sulla parete i: 4 nuovi vertici.
// s = start dalla parte iniziale della parete, w = larghezza, h = profondità, out = true verso l'esterno.
function addNotch(r, i, s, w, h, out) {
  const e = edge(r, i), sg = out ? 1 : -1;
  const P = (t, dep) => ({ x: e.a.x + e.u.x * t + e.n.x * sg * dep, y: e.a.y + e.u.y * t + e.n.y * sg * dep });
  const olds = r.openings.map((o) => ({ o, w: o.wall, s: o.wall < r.pts.length ? opStart(o, edge(r, o.wall).len) : o.offset }));
  r.pts.splice(i + 1, 0, P(s, 0), P(s, h), P(s + w, h), P(s + w, 0));
  const first = edge(r, i).len, last = edge(r, i + 4).len;
  for (const { o, w: ow, s: os } of olds) {
    if (ow === i) {
      if (os >= s + w) { o.wall = i + 4; setOpStart(o, last, os - (s + w)); } else setOpStart(o, first, os);
    } else if (ow > i) o.wall = ow + 4;
  }
}

/* ---------- vista ---------- */

const svg = $('#plan');

function toWorld(e) {
  const b = svg.getBoundingClientRect(), { x, y, k } = ui.view;
  return { x: (e.clientX - b.left - x) / k, y: (e.clientY - b.top - y) / k };
}

function fit() {
  const W = svg.clientWidth || 800, H = svg.clientHeight || 600, b = bbox(room()), pad = WALL * 2 + 40;
  const k = Math.min((W - 60) / (b.x1 - b.x0 + pad), (H - 60) / (b.y1 - b.y0 + pad), 3);
  ui.view = { k, x: W / 2 - ((b.x0 + b.x1) / 2) * k, y: H / 2 - ((b.y0 + b.y1) / 2) * k };
}

/* ---------- disegno della pianta ---------- */

function renderCanvas() {
  const r = room(), { x, y, k } = ui.view, sel = ui.sel, st = furnStatus(r);
  const pts = r.pts.map((p) => `${p.x},${p.y}`).join(' ');
  let s = `<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#g100)"/>`;
  s += `<polygon class="walls" points="${pts}" stroke-width="${WALL * 2}"/>`;
  s += `<polygon class="floor" points="${pts}"/>`;

  r.pts.forEach((_, i) => {
    const e = edge(r, i);
    s += `<line class="edge" x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"/>`;
  });

  for (const o of r.openings) {
    if (o.wall >= r.pts.length) continue;
    const e = edge(r, o.wall), n = e.n, u = e.u;
    const st = opStart(o, e.len), a = { x: e.a.x + u.x * st, y: e.a.y + u.y * st };
    const b = { x: a.x + u.x * o.width, y: a.y + u.y * o.width };
    const bad = st < 0 || st + o.width > e.len + 0.01;
    const on = sel && sel.t === 'open' && sel.id === o.id ? ' on' : '';
    const P = (p, d) => `${p.x + n.x * d},${p.y + n.y * d}`;
    const poly = `${P(a, -2)} ${P(b, -2)} ${P(b, WALL)} ${P(a, WALL)}`;
    if (o.type === 'door') {
      s += `<polygon class="gap${bad ? ' bad' : ''}${on}" data-t="open" data-id="${o.id}" points="${poly}"/>`;
      const hingeStart = o.hinge !== 'end', h = hingeStart ? a : b, c = hingeStart ? b : a;
      const sg = o.swing === 'out' ? 1 : -1;
      const tip = { x: h.x + n.x * sg * o.width, y: h.y + n.y * sg * o.width };
      const cross = (tip.x - h.x) * (c.y - h.y) - (tip.y - h.y) * (c.x - h.x);
      s += `<line class="closed" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/>`;
      s += `<line class="leaf" x1="${h.x}" y1="${h.y}" x2="${tip.x}" y2="${tip.y}"/>`;
      s += `<path class="swing" d="M${tip.x} ${tip.y} A${o.width} ${o.width} 0 0 ${cross > 0 ? 1 : 0} ${c.x} ${c.y}"/>`;
    } else {
      s += `<polygon class="gap${bad ? ' bad' : ''}" points="${poly}"/>`;
      s += `<polygon class="glass${on}" data-t="open" data-id="${o.id}" points="${P(a, 0)} ${P(b, 0)} ${P(b, WALL)} ${P(a, WALL)}"/>`;
      s += `<line class="closed" x1="${a.x + n.x * WALL / 2}" y1="${a.y + n.y * WALL / 2}" x2="${b.x + n.x * WALL / 2}" y2="${b.y + n.y * WALL / 2}"/>`;
    }
  }

  r.pts.forEach((_, i) => {
    const e = edge(r, i), m = { x: (e.a.x + e.b.x) / 2 + e.n.x * (WALL + 14 / k), y: (e.a.y + e.b.y) / 2 + e.n.y * (WALL + 14 / k) };
    s += `<line class="hit" data-t="wall" data-i="${i}" x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke-width="${16 / k}"/>`;
    s += `<text class="wl" font-size="${11 / k}" x="${m.x}" y="${m.y}">P${i + 1} · ${Math.round(e.len)}</text>`;
  });

  for (const f of r.furniture) {
    const bad = st[f.id].out || st[f.id].ov, on = sel && sel.t === 'furn' && sel.id === f.id;
    const fs = Math.max(Math.min(13 / k, f.d / 3, f.w / Math.max(6, f.name.length * 0.62)), 4), dims = f.d >= fs * 3;
    s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot})">`
      + `<rect class="fr${on ? ' sel' : ''}${bad ? ' bad' : ''}" data-t="furn" data-id="${f.id}" x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" fill="${esc(f.color)}"/>`
      + `<text class="ft" font-size="${fs}" y="${dims ? -fs * 0.15 : fs * 0.35}">${esc(f.name)}</text>`
      + (dims ? `<text class="ft" font-size="${fs * 0.8}" y="${fs}">${r1(f.w)}×${r1(f.d)}</text>` : '')
      + `</g>`;
  }

  r.pts.forEach((p, i) => {
    const on = sel && sel.t === 'pt' && sel.i === i ? ' on' : '';
    s += `<circle class="vtx${on}" data-t="pt" data-i="${i}" cx="${p.x}" cy="${p.y}" r="${6 / k}"/>`;
  });

  $('#world').setAttribute('transform', `translate(${x} ${y}) scale(${k})`);
  $('#world').innerHTML = s;
  const H = svg.clientHeight;
  $('#overlay').innerHTML = `<g transform="translate(16 ${H - 34})"><line class="sb" x1="0" y1="0" x2="${100 * k}" y2="0"/>`
    + `<line class="sb" x1="0" y1="-4" x2="0" y2="4"/><line class="sb" x1="${100 * k}" y1="-4" x2="${100 * k}" y2="4"/>`
    + `<text class="sbt" x="0" y="-8">1 m</text></g>`;
}

/* ---------- pannello laterale ---------- */

function inp(act, o = {}) {
  const k = [act, o.id ?? o.i ?? '', o.p ?? ''].join(':');
  const text = o.type === 'text';
  return `<input data-act="${act}" data-k="${esc(k)}"${o.id != null ? ` data-id="${o.id}"` : ''}${o.i != null ? ` data-i="${o.i}"` : ''}${o.p ? ` data-p="${o.p}"` : ''}`
    + ` type="${o.type || 'number'}"${text ? '' : ' step="any"'} value="${esc(text || o.type === 'color' ? o.val : r1(o.val))}">`;
}

function sel(act, id, p, value, options) {
  return `<select data-act="${act}" data-id="${id}" data-p="${p}" data-k="${act}:${id}:${p}">`
    + options.map(([v, label]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('')
    + `</select>`;
}

const section = (id, title, body) =>
  `<details data-sec="${id}"${ui.open[id] === false ? '' : ' open'}><summary>${title}</summary><div class="body">${body}</div></details>`;

function renderPanel() {
  const r = room(), st = furnStatus(r), area = Math.abs(signedArea(r.pts)) / 10000;
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const d = (k, def) => esc(ui.draft[k] ?? def);

  const rooms = `
    <div class="chips">${state.rooms.map((x) =>
      `<button class="chip${x.id === r.id ? ' on' : ''}" data-act="selroom" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="row"><label>Nome ${inp('rname', { id: r.id, val: r.name, type: 'text' })}</label></div>
    <div class="row"><button data-act="duproom">Duplica</button>
      <button data-act="delroom"${state.rooms.length < 2 ? ' disabled' : ''}>Elimina stanza</button></div>
    <div class="sub">Nuova stanza rettangolare (cm)</div>
    <div class="row"><input id="nr-name" type="text" placeholder="Nome" value="${d('nr-name', '')}">
      <input id="nr-w" type="number" value="${d('nr-w', 400)}"> <span>×</span> <input id="nr-d" type="number" value="${d('nr-d', 300)}">
      <button data-act="addroom">Aggiungi</button></div>`;

  const shape = `
    <p class="muted">Area: ${area.toFixed(2)} m² · misure interne in cm, y verso il basso.
      La lunghezza di una parete sposta il vertice successivo. Doppio clic su una parete: nuovo vertice (rientro).</p>
    <table><thead><tr><th>V</th><th>x</th><th>y</th><th>parete →</th><th></th></tr></thead><tbody>
    ${r.pts.map((p, i) => `<tr${ui.sel && ui.sel.t === 'pt' && ui.sel.i === i ? ' class="on"' : ''}>
      <td>${i + 1}</td><td>${inp('ptx', { i, val: p.x })}</td><td>${inp('pty', { i, val: p.y })}</td>
      <td>${inp('wlen', { i, val: edge(r, i).len })}</td>
      <td><button data-act="delpt" data-i="${i}" title="Elimina vertice"${r.pts.length <= 3 ? ' disabled' : ''}>✕</button></td></tr>`).join('')}
    </tbody></table>
    <div class="sub">Rientro o sporgenza su una parete</div>
    <div class="grid2">
      <label>Parete <select id="nn-wall">${r.pts.map((_, i) => `<option value="${i}"${+d('nn-wall', 0) === i ? ' selected' : ''}>Parete ${i + 1} (${Math.round(edge(r, i).len)} cm)</option>`).join('')}</select></label>
      <label>Tipo <select id="nn-type"><option value="niche"${d('nn-type', 'niche') === 'niche' ? ' selected' : ''}>Rientro (nicchia nel muro)</option><option value="pillar"${d('nn-type', 'niche') === 'pillar' ? ' selected' : ''}>Sporgenza (pilastro)</option></select></label>
      <label>Misura da <select id="nn-from"><option value="start"${d('nn-from', 'start') === 'start' ? ' selected' : ''}>Inizio parete</option><option value="end"${d('nn-from', 'start') === 'end' ? ' selected' : ''}>Fine parete</option></select></label>
      <label>Distanza (cm) <input id="nn-s" type="number" value="${d('nn-s', 100)}"></label>
      <label>Larghezza (cm) <input id="nn-w" type="number" value="${d('nn-w', 100)}"></label>
      <label>Profondità (cm) <input id="nn-h" type="number" value="${d('nn-h', 30)}"></label>
    </div>
    <div class="row"><button data-act="addnotch">Aggiungi</button></div>`;

  const openings = `
    <div class="row"><button data-act="addopen" data-k="door">+ Porta</button><button data-act="addopen" data-k="window">+ Finestra</button></div>
    ${r.openings.length ? '' : '<p class="muted">Nessuna apertura.</p>'}
    ${r.openings.map((o) => {
      const on = ui.sel && ui.sel.t === 'open' && ui.sel.id === o.id;
      const walls = r.pts.map((_, i) => [i, `Parete ${i + 1} (${Math.round(edge(r, i).len)} cm)`]);
      return `<div class="card${on ? ' on' : ''}"><div class="row"><b data-act="selopen" data-id="${o.id}">${o.type === 'door' ? 'Porta' : 'Finestra'}</b>
        <button data-act="delopen" data-id="${o.id}" title="Elimina">✕</button></div>
        <div class="grid2">
          <label>Parete ${sel('oset', o.id, 'wall', o.wall, walls)}</label>
          <label>Misura da ${sel('oset', o.id, 'from', o.from === 'end' ? 'end' : 'start', [['start', 'Inizio parete'], ['end', 'Fine parete']])}</label>
          <label>Distanza (cm) ${inp('oset', { id: o.id, p: 'offset', val: o.offset })}</label>
          <label>Larghezza (cm) ${inp('oset', { id: o.id, p: 'width', val: o.width })}</label>
          ${o.type === 'door' ? `<label>Cardine ${sel('oset', o.id, 'hinge', o.hinge, [['start', 'All\'inizio'], ['end', 'Alla fine']])}</label>
          <label>Apertura ${sel('oset', o.id, 'swing', o.swing, [['in', 'Verso l\'interno'], ['out', 'Verso l\'esterno']])}</label>` : ''}
        </div></div>`;
    }).join('')}`;

  const f = ui.sel && ui.sel.t === 'furn' ? r.furniture.find((x) => x.id === ui.sel.id) : null;
  const furniture = `
    <div class="row"><select data-act="preset"><option value="">Preset…</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])} ${p[1]}×${p[2]}</option>`).join('')}</select></div>
    <div class="row"><input id="nf-name" type="text" placeholder="Nome" value="${d('nf-name', '')}" size="12">
      <input id="nf-w" type="number" placeholder="largh." value="${d('nf-w', '')}"> <span>×</span>
      <input id="nf-d" type="number" placeholder="prof." value="${d('nf-d', '')}">
      <button data-act="addfurn">Aggiungi</button></div>
    <p class="muted">⚠ = fuori dalla stanza o sovrapposto a un altro mobile. Le porte non sono ancora considerate.</p>
    <div class="chips">${r.furniture.map((x) => `<button class="chip${f && f.id === x.id ? ' on' : ''}" data-act="selfurn" data-id="${x.id}">${st[x.id].out || st[x.id].ov ? '⚠ ' : ''}${esc(x.name)} <small>${r1(x.w)}×${r1(x.d)}</small></button>`).join('')}</div>
    ${f ? `<div class="card on"><div class="grid2">
        <label>Nome ${inp('fset', { id: f.id, p: 'name', val: f.name, type: 'text' })}</label>
        <label>Colore ${inp('fset', { id: f.id, p: 'color', val: f.color, type: 'color' })}</label>
        <label>Larghezza (cm) ${inp('fset', { id: f.id, p: 'w', val: f.w })}</label>
        <label>Profondità (cm) ${inp('fset', { id: f.id, p: 'd', val: f.d })}</label>
        <label>Centro x (cm) ${inp('fset', { id: f.id, p: 'x', val: f.x })}</label>
        <label>Centro y (cm) ${inp('fset', { id: f.id, p: 'y', val: f.y })}</label>
        <label>Rotazione (°) ${inp('fset', { id: f.id, p: 'rot', val: f.rot })}</label>
      </div>
      <div class="row"><button data-act="rotf" data-d="-90">⟲ 90°</button><button data-act="rotf" data-d="90">⟳ 90°</button>
        <button data-act="dupf">Duplica</button><button data-act="delf">Elimina</button></div></div>` : ''}`;

  const panel = $('#panel');
  const scroll = panel.scrollTop;
  panel.innerHTML = section('rooms', 'Stanze', rooms) + section('shape', 'Forma e muri', shape)
    + section('open', `Porte e finestre (${r.openings.length})`, openings) + section('furn', `Mobili (${r.furniture.length})`, furniture);
  panel.scrollTop = scroll;
  if (focusKey) {
    const el = panel.querySelector(`[data-k="${CSS.escape(focusKey)}"]`);
    if (el) { el.focus(); if (el.select && el.type !== 'color') el.select(); }
  }
}

let panelTimer = 0;
const queuePanel = () => { clearTimeout(panelTimer); panelTimer = setTimeout(renderPanel, 0); };
function renderAll() { renderCanvas(); renderPanel(); }
function commit() { save(); renderAll(); }

/* ---------- azioni dal pannello ---------- */

const panel = $('#panel');

panel.addEventListener('toggle', (e) => {
  if (e.target.dataset && e.target.dataset.sec) ui.open[e.target.dataset.sec] = e.target.open;
}, true);

function keepDraft(e) {
  const id = e.target.id;
  if (id && /^(nf|nr|nn)-/.test(id)) ui.draft[id] = e.target.value;
}
panel.addEventListener('input', keepDraft);
panel.addEventListener('change', keepDraft);

panel.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const a = el.dataset.act, id = el.dataset.id, i = +el.dataset.i, r = room();
  const f = ui.sel && ui.sel.t === 'furn' ? r.furniture.find((x) => x.id === ui.sel.id) : null;
  switch (a) {
    case 'selroom': state.current = id; ui.sel = null; fit(); break;
    case 'addroom': {
      snap();
      const w = Math.max(50, num(ui.draft['nr-w'], 400)), d = Math.max(50, num(ui.draft['nr-d'], 300));
      const nr = newRoom((ui.draft['nr-name'] || '').trim() || `Stanza ${state.rooms.length + 1}`, w, d);
      state.rooms.push(nr); state.current = nr.id; ui.sel = null; ui.draft['nr-name'] = ''; fit(); break;
    }
    case 'duproom': {
      snap();
      const c = JSON.parse(JSON.stringify(r));
      c.id = uid(); c.name += ' (copia)';
      c.openings.forEach((o) => { o.id = uid(); }); c.furniture.forEach((x) => { x.id = uid(); });
      state.rooms.push(c); state.current = c.id; ui.sel = null; break;
    }
    case 'delroom':
      if (state.rooms.length < 2 || !confirm(`Eliminare "${r.name}" con tutti i suoi mobili?`)) return;
      snap(); state.rooms = state.rooms.filter((x) => x !== r); state.current = state.rooms[0].id; ui.sel = null; fit(); break;
    case 'delpt': snap(); deletePt(r, i); ui.sel = null; break;
    case 'addopen': {
      snap();
      const door = el.dataset.k === 'door';
      const o = { id: uid(), type: door ? 'door' : 'window', wall: 0, from: 'start', offset: 50, width: door ? 80 : 120, hinge: 'start', swing: 'in' };
      r.openings.push(o); ui.sel = { t: 'open', id: o.id }; break;
    }
    case 'addnotch': {
      const wi = Math.min(r.pts.length - 1, Math.max(0, Math.round(num(ui.draft['nn-wall'], 0))));
      const len = edge(r, wi).len, w = num(ui.draft['nn-w'], 100), h = num(ui.draft['nn-h'], 30), dist = num(ui.draft['nn-s'], 100);
      const s0 = (ui.draft['nn-from'] || 'start') === 'end' ? len - dist - w : dist;
      if (w < 1 || h < 1 || s0 < 1 || s0 + w > len - 1) { alert(`Non entra nella parete ${wi + 1} (${Math.round(len)} cm): controlla distanza e larghezza.`); return; }
      snap(); addNotch(r, wi, s0, w, h, ui.draft['nn-type'] !== 'pillar'); ui.sel = null; break;
    }
    case 'selopen': ui.sel = { t: 'open', id }; break;
    case 'delopen': snap(); r.openings = r.openings.filter((o) => o.id !== id); ui.sel = null; break;
    case 'addfurn': {
      snap();
      const b = bbox({ pts: r.pts, furniture: [] });
      const nf = {
        id: uid(), name: (ui.draft['nf-name'] || '').trim() || 'Mobile',
        w: Math.max(1, num(ui.draft['nf-w'], 100)), d: Math.max(1, num(ui.draft['nf-d'], 50)),
        x: snapTo((b.x0 + b.x1) / 2), y: snapTo((b.y0 + b.y1) / 2), rot: 0, color: COLORS[r.furniture.length % COLORS.length],
      };
      r.furniture.push(nf); ui.sel = { t: 'furn', id: nf.id };
      ui.draft['nf-name'] = ''; ui.draft['nf-w'] = ''; ui.draft['nf-d'] = ''; break;
    }
    case 'selfurn': ui.sel = { t: 'furn', id }; break;
    case 'rotf': if (!f) return; snap(); f.rot = (((f.rot + num(el.dataset.d)) % 360) + 360) % 360; break;
    case 'dupf': {
      if (!f) return;
      snap();
      const c = { ...f, id: uid(), x: f.x + 20, y: f.y + 20 };
      r.furniture.push(c); ui.sel = { t: 'furn', id: c.id }; break;
    }
    case 'delf': if (!f) return; snap(); r.furniture = r.furniture.filter((x) => x !== f); ui.sel = null; break;
    default: return;
  }
  commit();
});

panel.addEventListener('change', (e) => {
  const el = e.target, a = el.dataset.act;
  if (!a) return;
  const r = room(), id = el.dataset.id, i = +el.dataset.i, p = el.dataset.p;
  if (a === 'preset') {
    const pr = PRESETS[+el.value];
    if (!pr) return;
    [ui.draft['nf-name'], ui.draft['nf-w'], ui.draft['nf-d']] = pr;
    $('#nf-name').value = pr[0]; $('#nf-w').value = pr[1]; $('#nf-d').value = pr[2];
    return;
  }
  snap();
  switch (a) {
    case 'rname': r.name = el.value.trim() || r.name; break;
    case 'ptx': r.pts[i].x = num(el.value, r.pts[i].x); break;
    case 'pty': r.pts[i].y = num(el.value, r.pts[i].y); break;
    case 'wlen': {
      const e2 = edge(r, i);
      if (e2.len > 0) { const L = Math.max(1, num(el.value, e2.len)); e2.b.x = e2.a.x + e2.u.x * L; e2.b.y = e2.a.y + e2.u.y * L; }
      break;
    }
    case 'oset': {
      const o = r.openings.find((x) => x.id === id);
      if (!o) return;
      if (p === 'hinge' || p === 'swing') o[p] = el.value;
      else if (p === 'from') { const len = edge(r, o.wall).len, st = opStart(o, len); o.from = el.value; setOpStart(o, len, st); }
      else if (p === 'wall') o.wall = +el.value;
      else o[p] = p === 'width' ? Math.max(10, num(el.value, o.width)) : num(el.value, o[p]);
      break;
    }
    case 'fset': {
      const f = r.furniture.find((x) => x.id === id);
      if (!f) return;
      if (p === 'name') f.name = el.value.trim() || f.name;
      else if (p === 'color') f.color = el.value;
      else if (p === 'w' || p === 'd') f[p] = Math.max(1, num(el.value, f[p]));
      else if (p === 'rot') f.rot = ((num(el.value, f.rot) % 360) + 360) % 360;
      else f[p] = num(el.value, f[p]);
      break;
    }
    default: return;
  }
  save();
  renderCanvas();
  queuePanel(); // dopo che il focus è passato al campo successivo
});

/* ---------- interazione sulla pianta ---------- */

function addVertexOnWall(r, i, p, free) {
  const ed = edge(r, i);
  let d = (p.x - ed.a.x) * ed.u.x + (p.y - ed.a.y) * ed.u.y;
  if (!free) d = snapTo(d);
  if (d < 5 || d > ed.len - 5) return;
  snap(); insertPt(r, i, d); ui.sel = { t: 'pt', i: i + 1 }; commit();
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const t = e.target.closest('[data-t]'), p = toWorld(e), r = room();
  svg.setPointerCapture(e.pointerId);
  const base = { sx: e.clientX, sy: e.clientY, moved: false };
  if (t && t.dataset.t === 'furn') {
    const f = r.furniture.find((x) => x.id === t.dataset.id);
    ui.sel = { t: 'furn', id: f.id };
    ui.drag = { ...base, kind: 'furn', f, ox: p.x - f.x, oy: p.y - f.y };
  } else if (t && t.dataset.t === 'pt') {
    ui.sel = { t: 'pt', i: +t.dataset.i };
    ui.drag = { ...base, kind: 'pt', pt: r.pts[+t.dataset.i] };
  } else if (t && t.dataset.t === 'wall') {
    // doppio clic fatto a mano: il ridisegno al primo clic distrugge l'elemento e il browser non emette 'dblclick'
    const now = Date.now(), last = ui.lastWall;
    ui.lastWall = { i: +t.dataset.i, at: now, x: e.clientX, y: e.clientY };
    if (last && last.i === +t.dataset.i && now - last.at < 400 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 6) {
      ui.lastWall = null;
      addVertexOnWall(r, +t.dataset.i, p, e.altKey);
      return;
    }
    ui.sel = null;
    ui.drag = { ...base, kind: 'pan', vx: ui.view.x, vy: ui.view.y };
  } else if (t && t.dataset.t === 'open') {
    ui.sel = { t: 'open', id: t.dataset.id };
    ui.drag = null;
  } else {
    ui.sel = null;
    ui.drag = { ...base, kind: 'pan', vx: ui.view.x, vy: ui.view.y };
  }
  renderAll();
});

svg.addEventListener('pointermove', (e) => {
  const d = ui.drag;
  if (!d) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    if (d.kind !== 'pan') snap();
  }
  const p = toWorld(e), free = e.altKey;
  if (d.kind === 'pan') {
    ui.view.x = d.vx + e.clientX - d.sx; ui.view.y = d.vy + e.clientY - d.sy;
  } else if (d.kind === 'pt') {
    d.pt.x = free ? p.x : snapTo(p.x); d.pt.y = free ? p.y : snapTo(p.y);
  } else {
    d.f.x = p.x - d.ox; d.f.y = p.y - d.oy;
    if (!free) { d.f.x = snapTo(d.f.x); d.f.y = snapTo(d.f.y); magnet(d.f, room()); }
  }
  renderCanvas();
});

function endDrag() {
  const d = ui.drag;
  ui.drag = null;
  if (d && d.moved && d.kind !== 'pan') save();
  renderPanel();
}
svg.addEventListener('pointerup', endDrag);
svg.addEventListener('pointercancel', endDrag);

svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const b = svg.getBoundingClientRect(), mx = e.clientX - b.left, my = e.clientY - b.top, v = ui.view;
  const k = Math.min(5, Math.max(0.05, v.k * Math.exp(-e.deltaY * 0.0015)));
  v.x = mx - ((mx - v.x) / v.k) * k; v.y = my - ((my - v.y) / v.k) * k; v.k = k;
  renderCanvas();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  const r = room(), f = ui.sel && ui.sel.t === 'furn' ? r.furniture.find((x) => x.id === ui.sel.id) : null;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') { ui.sel = null; renderAll(); return; }
  if (!f) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { snap(); r.furniture = r.furniture.filter((x) => x !== f); ui.sel = null; }
  else if (e.key.toLowerCase() === 'r') { snap(); f.rot = (f.rot + (e.shiftKey ? 270 : 90)) % 360; }
  else if (e.key.startsWith('Arrow')) {
    e.preventDefault(); snap();
    const s = e.shiftKey ? 1 : GRID;
    f.x += e.key === 'ArrowRight' ? s : e.key === 'ArrowLeft' ? -s : 0;
    f.y += e.key === 'ArrowDown' ? s : e.key === 'ArrowUp' ? -s : 0;
  } else return;
  commit();
});

/* ---------- barra superiore ---------- */

$('#b-undo').addEventListener('click', undo);
$('#b-fit').addEventListener('click', () => { fit(); renderCanvas(); });
$('#b-export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }));
  a.download = `dimensioniCasa-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#b-import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const s = JSON.parse(await file.text());
    if (!valid(s)) throw new Error('formato non valido');
    if (!confirm('Importare il file sostituisce tutte le stanze attuali. Continuare?')) return;
    snap();
    state = s;
    if (!state.rooms.some((r) => r.id === state.current)) state.current = state.rooms[0].id;
    ui.sel = null; fit(); commit();
  } catch (err) { alert(`Impossibile importare il file: ${err.message}`); }
});

window.addEventListener('resize', () => { fit(); renderCanvas(); });

fit();
renderAll();
