'use strict';

// Tutte le misure sono in centimetri; y cresce verso il basso (come in SVG).
//
// Modello: una stanza ha i suoi angoli (r.pts, pareti = lati fra angoli consecutivi) e, sopra,
// delle "sezioni" (r.features: nicchie e pilastri) e delle aperture (r.openings: porte e finestre).
// Sezioni e aperture sono ancorate a una parete (dall'inizio o dalla fine), quindi non dipendono
// da vertici: il contorno vero della stanza si calcola da pareti + sezioni (vedi outline()).

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
const PERSON = { w: 63, d: 30 }; // omino visto dall'alto: larghezza spalle, profondità
const FEAT_NAME = { niche: 'Nicchia', pillar: 'Pilastro' };
const OPEN_NAME = { door: 'Porta', window: 'Finestra' };

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8);
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : d; };
const snapTo = (v, s = GRID) => Math.round(v / s) * s;
const r1 = (v) => Math.round(v * 10) / 10;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- stato ---------- */

const rectPts = (w, d) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }];
const newRoom = (name, pts) => ({ id: uid(), name, pts, features: [], openings: [], furniture: [] });

// Rettangolo, oppure rettangolo a L (un angolo tagliato: br/bl/tr/tl = basso/alto, destra/sinistra).
function shapePts(shape, w, d, corner, cw, cd) {
  if (shape !== 'L') return rectPts(w, d);
  let p = [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d - cd }, { x: w - cw, y: d - cd }, { x: w - cw, y: d }, { x: 0, y: d }];
  if (corner[1] === 'l') p = p.map((q) => ({ x: w - q.x, y: q.y }));
  if (corner[0] === 't') p = p.map((q) => ({ x: q.x, y: d - q.y }));
  return p;
}

function defaultState() {
  const r = newRoom('Stanza 1', rectPts(400, 350));
  return { rooms: [r], current: r.id };
}

function valid(s) {
  return !!s && Array.isArray(s.rooms) && s.rooms.length > 0 && s.rooms.every((r) =>
    r && Array.isArray(r.pts) && r.pts.length >= 3 && Array.isArray(r.openings) && Array.isArray(r.furniture));
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    return valid(s) ? migrate(s) : null;
  } catch { return null; }
}

function save() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* storage non disponibile */ }
}

let state = null; // caricato in fondo al file, quando tutte le funzioni sono definite
const ui = { view: { x: 0, y: 0, k: 0.5 }, sel: null, drag: null, open: { adv: false }, draft: {}, quotes: true };
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

// Parete i: dall'angolo i all'angolo i+1. n = normale verso l'esterno della stanza.
function edge(r, i) {
  const n = r.pts.length, a = r.pts[i % n], b = r.pts[(i + 1) % n];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const u = len ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
  const o = signedArea(r.pts) > 0 ? 1 : -1;
  return { a, b, len, u, n: { x: u.y * o, y: -u.x * o } };
}

// Sezioni e aperture sono ancorate all'inizio o alla fine della parete (o.from).
// offset = distanza dal lato di ancoraggio al bordo più vicino.
const opStart = (o, len) => (o.from === 'end' ? len - o.offset - o.width : o.offset);
const setOpStart = (o, len, s) => { o.offset = o.from === 'end' ? len - s - o.width : s; };
const items = (r) => [...r.features, ...r.openings];
const findItem = (r, id) => items(r).find((x) => x.id === id);

function span(r, o) {
  const e = edge(r, o.wall), s = opStart(o, e.len);
  return { e, s, t: s + o.width };
}

// Sezione valida: dentro la parete, misure positive.
function featFits(r, f) {
  if (f.wall >= r.pts.length || !(f.width > 0) || !(f.depth > 0)) return false;
  const { e, s, t } = span(r, f);
  return s >= -0.01 && t <= e.len + 0.01;
}

// Mappa id -> true per sezioni che non entrano o che si sovrappongono a un'altra sulla stessa parete.
function featProblems(r) {
  const bad = {};
  for (const f of r.features) {
    if (!featFits(r, f)) { bad[f.id] = true; continue; }
    const a = span(r, f);
    for (const g of r.features) {
      if (g === f || g.wall !== f.wall || !featFits(r, g)) continue;
      const b = span(r, g);
      if (a.s < b.t - 0.01 && b.s < a.t - 0.01) { bad[f.id] = true; bad[g.id] = true; }
    }
  }
  return bad;
}

// Contorno reale della stanza: angoli + sezioni applicate alle pareti.
function outline(r) {
  const ring = [], bad = featProblems(r);
  r.pts.forEach((p, i) => {
    ring.push(p);
    const e = edge(r, i);
    const fs = r.features.filter((f) => f.wall === i && !bad[f.id]).map((f) => ({ f, s: opStart(f, e.len) })).sort((a, b) => a.s - b.s);
    for (const { f, s } of fs) {
      const sg = f.type === 'niche' ? 1 : -1;
      const P = (t, dep) => ({ x: e.a.x + e.u.x * t + e.n.x * sg * dep, y: e.a.y + e.u.y * t + e.n.y * sg * dep });
      ring.push(P(s, 0), P(s, f.depth), P(s + f.width, f.depth), P(s + f.width, 0));
    }
  });
  return ring;
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

function outside(f, ring) {
  if (corners(f, 0.5).some((p) => !inPoly(p, ring))) return true;
  // un angolo rientrante del contorno non deve cadere dentro il mobile
  const t = (-f.rot * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return ring.some((p) => {
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
  const ring = outline(r), m = {};
  for (const f of r.furniture) m[f.id] = { out: outside(f, ring), ov: false };
  const solid = r.furniture.filter((f) => !f.person); // l'omino può stare ovunque: niente avviso di sovrapposizione
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      if (overlap(solid[i], solid[j])) { m[solid[i].id].ov = true; m[solid[j].id].ov = true; }
    }
  }
  return m;
}

// Distanza dalla mezzeria di ciascun lato del mobile al primo ostacolo davanti a quel lato
// (muro del contorno reale oppure un altro mobile), misurata perpendicolarmente al lato.
function rayHit(o, d, a, b) {
  const ex = b.x - a.x, ey = b.y - a.y, den = d.x * ey - d.y * ex;
  if (Math.abs(den) < 1e-9) return null;
  const wx = a.x - o.x, wy = a.y - o.y;
  const t = (wx * ey - wy * ex) / den, u = (wx * d.y - wy * d.x) / den;
  return t >= -1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? Math.max(0, t) : null;
}

function quotes(r, f) {
  const ring = outline(r), c = Math.cos((f.rot * Math.PI) / 180), sn = Math.sin((f.rot * Math.PI) / 180), segs = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 0.01) segs.push([a, b, 'wall']);
  }
  for (const g of r.furniture) {
    if (g === f) continue;
    const q = corners(g);
    for (let i = 0; i < 4; i++) segs.push([q[i], q[(i + 1) % 4], 'furn']);
  }
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].map(([lx, ly]) => {
    const dir = { x: lx * c - ly * sn, y: lx * sn + ly * c }, half = lx ? f.w / 2 : f.d / 2;
    const o = { x: f.x + dir.x * half, y: f.y + dir.y * half };
    let best = null;
    for (const [a, b, kind] of segs) {
      const h = rayHit(o, dir, a, b);
      if (h !== null && (best === null || h < best.d)) best = { d: h, kind };
    }
    return best && { a: o, b: { x: o.x + dir.x * best.d, y: o.y + dir.y * best.d }, d: best.d, kind: best.kind };
  }).filter(Boolean);
}

// "Calamita": se un lato del mobile è vicino a un muro verticale/orizzontale, lo appoggia.
function magnet(f, ring) {
  const cs = corners(f), xs = cs.map((p) => p.x), ys = cs.map((p) => p.y);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  let bx = null, by = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
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
  const pts = [...outline(r), ...r.furniture.flatMap((f) => corners(f))];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/* ---------- operazioni sulla forma della stanza ---------- */

// Cambia la lunghezza della parete i. Se la parete successiva è perpendicolare si sposta anche
// l'angolo dopo (cioè tutto il lato opposto), così gli angoli retti restano retti.
function setWallLen(r, i, L) {
  const n = r.pts.length, e = edge(r, i);
  if (!(e.len > 0)) return;
  const e2 = edge(r, (i + 1) % n), d = { x: e.u.x * (L - e.len), y: e.u.y * (L - e.len) };
  const move = (k) => { r.pts[k].x += d.x; r.pts[k].y += d.y; };
  move((i + 1) % n);
  if (e2.len > 0 && Math.abs(e.u.x * e2.u.x + e.u.y * e2.u.y) < 1e-6) move((i + 2) % n);
}

// Elimina l'angolo j (le due pareti attorno si fondono) senza perdere sezioni e aperture.
function deletePt(r, j) {
  const n = r.pts.length;
  if (n <= 3) return;
  const prev = (j - 1 + n) % n, prevLen = edge(r, prev).len, merged = j > 0 ? j - 1 : n - 2;
  const olds = items(r).map((o) => ({ o, w: o.wall, s: o.wall < n ? opStart(o, edge(r, o.wall).len) : o.offset }));
  r.pts.splice(j, 1);
  const newLen = edge(r, merged).len;
  for (const { o, w, s } of olds) {
    if (w === prev) { o.wall = merged; setOpStart(o, newLen, s); }
    else if (w === j) { o.wall = merged; setOpStart(o, newLen, s + prevLen); }
    else if (w > j) o.wall = w - 1;
  }
}

// Dati salvati prima dell'introduzione delle sezioni: i rientri erano gruppi di 4 vertici sciolti.
// Li riconosce e li trasforma in nicchie/pilastri; ciò che non riconosce resta com'è (angoli in più).
function migrate(s) {
  for (const r of s.rooms) {
    if (Array.isArray(r.features)) continue;
    r.features = [];
    legacyNotches(r);
  }
  return s;
}

function legacyNotches(r) {
  const eq = (a, b) => Math.abs(a - b) < 0.01;
  for (let again = true; again;) {
    again = false;
    // angoli allineati (nati dal vecchio "doppio clic sulla parete")
    for (let j = 0; j < r.pts.length && !again && r.pts.length > 3; j++) {
      const n = r.pts.length, a = r.pts[(j - 1 + n) % n], p = r.pts[j], b = r.pts[(j + 1) % n];
      const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
      if (eq(ux * vy - uy * vx, 0) && ux * vx + uy * vy > 0) { deletePt(r, j); again = true; }
    }
    if (again) continue;
    const n = r.pts.length, o = signedArea(r.pts) > 0 ? 1 : -1;
    for (let i = 0; i + 4 < n && n - 4 >= 3 && !again; i++) {
      const [A, P1, P2, P3, P4] = r.pts.slice(i, i + 5), B = r.pts[(i + 5) % n];
      const L1 = Math.hypot(P1.x - A.x, P1.y - A.y);
      if (L1 < 0.01) continue;
      const u = { x: (P1.x - A.x) / L1, y: (P1.y - A.y) / L1 };
      const along = (p, q) => (q.x - p.x) * u.x + (q.y - p.y) * u.y;
      const across = (p, q) => (q.x - p.x) * u.y - (q.y - p.y) * u.x;
      const w = along(P1, P4), h = Math.hypot(P2.x - P1.x, P2.y - P1.y);
      const ok = eq(across(A, P4), 0) && eq(across(P4, B), 0) && w > 0.01 && along(P4, B) > 0.01 && h > 0.01
        && eq(along(P1, P2), 0) && eq(P3.x, P2.x + P4.x - P1.x) && eq(P3.y, P2.y + P4.y - P1.y);
      if (!ok || r.openings.some((op) => op.wall > i && op.wall < i + 4)) continue;
      const nrm = { x: u.y * o, y: -u.x * o }, outward = (P2.x - P1.x) * nrm.x + (P2.y - P1.y) * nrm.y > 0;
      const olds = items(r).map((it) => ({ it, w: it.wall, s: opStart(it, edge(r, it.wall).len) }));
      r.pts.splice(i + 1, 4);
      const L = edge(r, i).len, t4 = along(A, P4);
      for (const { it, w: iw, s } of olds) {
        if (iw === i) { setOpStart(it, L, s); } else if (iw === i + 4) { it.wall = i; setOpStart(it, L, s + t4); } else if (iw > i + 4) it.wall = iw - 4;
      }
      r.features.push({ id: uid(), type: outward ? 'niche' : 'pillar', wall: i, from: 'start', offset: along(A, P1), width: w, depth: h });
      again = true;
    }
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

// Numeri "Nicchia 1", "Porta 2"…: contano per tipo, nell'ordine di creazione.
function names(r) {
  const cnt = {}, m = {};
  for (const it of items(r)) { cnt[it.type] = (cnt[it.type] || 0) + 1; m[it.id] = `${FEAT_NAME[it.type] || OPEN_NAME[it.type]} ${cnt[it.type]}`; }
  return m;
}

/* ---------- disegno della pianta ---------- */

function renderCanvas() {
  const r = room(), { x, y, k } = ui.view, sel = ui.sel, st = furnStatus(r), nm = names(r), fbad = featProblems(r);
  const ring = outline(r), pts = ring.map((p) => `${p.x},${p.y}`).join(' ');
  const isSel = (t, key, v) => sel && sel.t === t && sel[key] === v;
  let s = `<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#g100)"/>`;
  s += `<polygon class="walls" points="${pts}" stroke-width="${WALL * 2}"/>`;
  s += `<polygon class="floor" points="${pts}"/>`;
  s += `<polygon class="edge" points="${pts}"/>`;

  for (const o of r.openings) {
    if (o.wall >= r.pts.length) continue;
    const { e, s: st0 } = span(r, o), n = e.n, u = e.u;
    const a = { x: e.a.x + u.x * st0, y: e.a.y + u.y * st0 };
    const b = { x: a.x + u.x * o.width, y: a.y + u.y * o.width };
    const hitsFeat = r.features.some((f) => f.wall === o.wall && featFits(r, f) && (() => { const q = span(r, f); return st0 < q.t - 0.01 && q.s < st0 + o.width - 0.01; })());
    const bad = st0 < -0.01 || st0 + o.width > e.len + 0.01 || hitsFeat;
    const on = isSel('open', 'id', o.id) ? ' on' : '';
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

  // pareti: linea evidenziata se selezionata, area sensibile al clic, etichetta
  r.pts.forEach((_, i) => {
    const e = edge(r, i), m = { x: (e.a.x + e.b.x) / 2 + e.n.x * (WALL + 14 / k), y: (e.a.y + e.b.y) / 2 + e.n.y * (WALL + 14 / k) };
    if (isSel('wall', 'i', i)) s += `<line class="wsel" x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}"/>`;
    s += `<line class="hit" data-t="wall" data-i="${i}" x1="${e.a.x}" y1="${e.a.y}" x2="${e.b.x}" y2="${e.b.y}" stroke-width="${16 / k}"/>`;
    s += `<text class="wl" font-size="${11 / k}" x="${m.x}" y="${m.y}">P${i + 1} · ${Math.round(e.len)}</text>`;
  });

  // sezioni (nicchie e pilastri): area cliccabile + etichetta
  for (const f of r.features) {
    if (f.wall >= r.pts.length) continue;
    const e = edge(r, f.wall), a = opStart(f, e.len), sg = f.type === 'niche' ? 1 : -1;
    const P = (t, dep) => `${e.a.x + e.u.x * t + e.n.x * sg * dep},${e.a.y + e.u.y * t + e.n.y * sg * dep}`;
    const cx = e.a.x + e.u.x * (a + f.width / 2) + e.n.x * sg * f.depth / 2, cy = e.a.y + e.u.y * (a + f.width / 2) + e.n.y * sg * f.depth / 2;
    const on = isSel('feat', 'id', f.id) ? ' on' : '', bad = fbad[f.id] ? ' bad' : '';
    s += `<polygon class="feat${on}${bad}" data-t="feat" data-id="${f.id}" points="${P(a, 0)} ${P(a, f.depth)} ${P(a + f.width, f.depth)} ${P(a + f.width, 0)}"/>`;
    if (!bad) s += `<text class="wl" font-size="${10 / k}" x="${cx}" y="${cy}">${esc(nm[f.id].replace('Nicchia ', 'N').replace('Pilastro ', 'Pil'))}</text>`;
  }

  for (const f of r.furniture) {
    const bad = st[f.id].out || st[f.id].ov, on = isSel('furn', 'id', f.id);
    const cls = `${on ? ' sel' : ''}${bad ? ' bad' : ''}`;
    if (f.person) {
      // vista dall'alto: spalle (ellisse), testa (cerchio) e naso che indica dove guarda (verso l'alto a rotazione 0)
      const hr = Math.min(9, f.d * 0.3);
      s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot})">`
        + `<ellipse class="fr${cls}" data-t="furn" data-id="${f.id}" cx="0" cy="0" rx="${f.w / 2}" ry="${f.d / 2}" fill="${esc(f.color)}"/>`
        + `<circle class="head" cx="0" cy="0" r="${hr}"/>`
        + `<path class="head" d="M${-hr * 0.35} ${-hr * 0.9} L0 ${-hr - 4} L${hr * 0.35} ${-hr * 0.9}"/></g>`;
      continue;
    }
    const fs = Math.max(Math.min(13 / k, f.d / 3, f.w / Math.max(6, f.name.length * 0.62)), 4), dims = f.d >= fs * 3;
    s += `<g transform="translate(${f.x} ${f.y}) rotate(${f.rot})">`
      + `<rect class="fr${cls}" data-t="furn" data-id="${f.id}" x="${-f.w / 2}" y="${-f.d / 2}" width="${f.w}" height="${f.d}" fill="${esc(f.color)}"/>`
      + `<text class="ft" font-size="${fs}" y="${dims ? -fs * 0.15 : fs * 0.35}">${esc(f.name)}</text>`
      + (dims ? `<text class="ft" font-size="${fs * 0.8}" y="${fs}">${r1(f.w)}×${r1(f.d)}</text>` : '')
      + `</g>`;
  }

  // quote e maniglia di rotazione del mobile selezionato
  const cur = sel && sel.t === 'furn' ? r.furniture.find((x) => x.id === sel.id) : null;
  if (cur) {
    if (ui.quotes) {
      for (const q of quotes(r, cur)) {
        const m = { x: (q.a.x + q.b.x) / 2, y: (q.a.y + q.b.y) / 2 };
        s += `<line class="q${q.kind === 'furn' ? ' qf' : ''}" x1="${q.a.x}" y1="${q.a.y}" x2="${q.b.x}" y2="${q.b.y}"/>`
          + `<circle class="qd${q.kind === 'furn' ? ' qf' : ''}" cx="${q.b.x}" cy="${q.b.y}" r="${2.5 / k}"/>`
          + `<text class="wl ql" font-size="${11 / k}" x="${m.x}" y="${m.y}">${Math.round(q.d)}</text>`;
      }
    }
    const rad = (cur.rot * Math.PI) / 180, near = cur.d / 2, far = cur.d / 2 + 24 / k;
    const hx = cur.x + Math.sin(rad) * far, hy = cur.y - Math.cos(rad) * far;
    s += `<line class="rline" x1="${cur.x + Math.sin(rad) * near}" y1="${cur.y - Math.cos(rad) * near}" x2="${hx}" y2="${hy}"/>`
      + `<circle class="rot" data-t="rot" cx="${hx}" cy="${hy}" r="${7 / k}"/>`;
  }

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

function select(act, id, p, value, options) {
  return `<select data-act="${act}" data-id="${id}" data-p="${p}" data-k="${act}:${id}:${p}">`
    + options.map(([v, label]) => `<option value="${v}"${String(v) === String(value) ? ' selected' : ''}>${esc(label)}</option>`).join('')
    + `</select>`;
}

const section = (id, title, body) =>
  `<details data-sec="${id}"${ui.open[id] === false ? '' : ' open'}><summary>${title}</summary><div class="body">${body}</div></details>`;

// Campi comuni a sezioni e aperture: parete, ancoraggio, distanza, larghezza.
function placement(r, o) {
  const walls = r.pts.map((_, i) => [i, `Parete ${i + 1} (${Math.round(edge(r, i).len)} cm)`]);
  return `<label>Parete ${select('oset', o.id, 'wall', o.wall, walls)}</label>
    <label>Misura da ${select('oset', o.id, 'from', o.from === 'end' ? 'end' : 'start', [['start', 'Inizio parete'], ['end', 'Fine parete']])}</label>
    <label>Distanza (cm) ${inp('oset', { id: o.id, p: 'offset', val: o.offset })}</label>
    <label>Larghezza (cm) ${inp('oset', { id: o.id, p: 'width', val: o.width })}</label>`;
}

function renderPanel() {
  const r = room(), st = furnStatus(r), nm = names(r), fbad = featProblems(r), area = Math.abs(signedArea(outline(r))) / 10000;
  const focusKey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
  const d = (k, def) => esc(ui.draft[k] ?? def);
  const isSel = (t, key, v) => ui.sel && ui.sel.t === t && ui.sel[key] === v;
  const shapeL = d('nr-shape', 'R') === 'L';

  const rooms = `
    <div class="chips">${state.rooms.map((x) =>
      `<button class="chip${x.id === r.id ? ' on' : ''}" data-act="selroom" data-id="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="row"><label>Nome ${inp('rname', { id: r.id, val: r.name, type: 'text' })}</label></div>
    <p class="muted">Area: ${area.toFixed(2)} m²</p>
    <div class="row"><button data-act="duproom">Duplica</button>
      <button data-act="delroom"${state.rooms.length < 2 ? ' disabled' : ''}>Elimina stanza</button></div>
    <div class="sub">Nuova stanza (cm)</div>
    <div class="row"><input id="nr-name" type="text" placeholder="Nome" value="${d('nr-name', '')}">
      <select id="nr-shape"><option value="R"${shapeL ? '' : ' selected'}>Rettangolo</option><option value="L"${shapeL ? ' selected' : ''}>Forma a L</option></select></div>
    <div class="row"><input id="nr-w" type="number" value="${d('nr-w', 400)}"> <span>×</span> <input id="nr-d" type="number" value="${d('nr-d', 300)}"></div>
    ${shapeL ? `<div class="row"><span class="muted">Angolo tagliato</span>
      <select id="nr-corner">${[['br', 'in basso a destra'], ['bl', 'in basso a sinistra'], ['tr', 'in alto a destra'], ['tl', 'in alto a sinistra']]
        .map(([v, l]) => `<option value="${v}"${d('nr-corner', 'br') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input id="nr-cw" type="number" value="${d('nr-cw', 150)}"> <span>×</span> <input id="nr-cd" type="number" value="${d('nr-cd', 150)}"></div>` : ''}
    <div class="row"><button data-act="addroom">Aggiungi stanza</button></div>`;

  const walls = `
    <p class="muted">Lunghezza di ogni parete, misurata da angolo ad angolo (anche sopra nicchie e pilastri). Cambiarla sposta anche il lato opposto, così gli angoli restano retti. Clic sul nome per evidenziarla.</p>
    <table><tbody>${r.pts.map((_, i) => `<tr${isSel('wall', 'i', i) ? ' class="on"' : ''}>
      <td><b data-act="selwall" data-i="${i}" class="lnk">Parete ${i + 1}</b></td>
      <td>${inp('wlen', { i, val: edge(r, i).len })}</td><td class="muted">cm</td></tr>`).join('')}</tbody></table>`;

  const feats = `
    <div class="row"><button data-act="addfeat" data-k="niche">+ Nicchia</button><button data-act="addfeat" data-k="pillar">+ Pilastro</button></div>
    <p class="muted">Nicchia = rientro nel muro (la stanza guadagna spazio). Pilastro = sporgenza verso l'interno.</p>
    ${r.features.length ? '' : '<p class="muted">Nessuna nicchia o pilastro.</p>'}
    ${r.features.map((f) => `<div class="card${isSel('feat', 'id', f.id) ? ' on' : ''}"><div class="row"><b data-act="selfeat" data-id="${f.id}" class="lnk">${nm[f.id]}</b>
        <button data-act="delfeat" data-id="${f.id}">Elimina</button></div>
        <div class="grid2">${placement(r, f)}
          <label>Profondità (cm) ${inp('oset', { id: f.id, p: 'depth', val: f.depth })}</label>
          <label>Tipo ${select('oset', f.id, 'type', f.type, [['niche', 'Nicchia'], ['pillar', 'Pilastro']])}</label>
        </div>${fbad[f.id] ? '<p class="muted">⚠ Non entra nella parete o si sovrappone a un\'altra sezione: non viene disegnata.</p>' : ''}</div>`).join('')}`;

  const openings = `
    <div class="row"><button data-act="addopen" data-k="door">+ Porta</button><button data-act="addopen" data-k="window">+ Finestra</button></div>
    ${r.openings.length ? '' : '<p class="muted">Nessuna apertura.</p>'}
    ${r.openings.map((o) => `<div class="card${isSel('open', 'id', o.id) ? ' on' : ''}"><div class="row"><b data-act="selopen" data-id="${o.id}" class="lnk">${nm[o.id]}</b>
        <button data-act="delopen" data-id="${o.id}">Elimina</button></div>
        <div class="grid2">${placement(r, o)}
          ${o.type === 'door' ? `<label>Cardine ${select('oset', o.id, 'hinge', o.hinge, [['start', 'Lato inizio parete'], ['end', 'Lato fine parete']])}</label>
          <label>Apertura ${select('oset', o.id, 'swing', o.swing, [['in', 'Verso l\'interno'], ['out', 'Verso l\'esterno']])}</label>` : ''}
        </div></div>`).join('')}`;

  const f = ui.sel && ui.sel.t === 'furn' ? r.furniture.find((x) => x.id === ui.sel.id) : null;
  const furniture = `
    <div class="row"><select data-act="preset"><option value="">Preset…</option>${PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])} ${p[1]}×${p[2]}</option>`).join('')}</select></div>
    <div class="row"><input id="nf-name" type="text" placeholder="Nome" value="${d('nf-name', '')}" size="12">
      <input id="nf-w" type="number" placeholder="largh." value="${d('nf-w', '')}"> <span>×</span>
      <input id="nf-d" type="number" placeholder="prof." value="${d('nf-d', '')}">
      <button data-act="addfurn">Aggiungi</button></div>
    <div class="row"><button data-act="addperson">+ Omino (spalle ${PERSON.w} × ${PERSON.d} cm)</button></div>
    <p class="muted">⚠ = fuori dalla stanza o sovrapposto a un altro mobile (l'omino non conta come ingombro). Le porte non sono ancora considerate. Le quote del mobile selezionato si accendono dal pulsante «Quote» in alto.</p>
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

  const adv = `
    <p class="muted">Coordinate degli angoli della stanza (senza nicchie e pilastri). Serve solo per forme particolari: di norma bastano le lunghezze delle pareti. Eliminando un angolo le due pareti vicine si fondono.</p>
    <table><thead><tr><th>Angolo</th><th>x</th><th>y</th><th></th></tr></thead><tbody>
    ${r.pts.map((p, i) => `<tr><td>${i + 1}</td><td>${inp('ptx', { i, val: p.x })}</td><td>${inp('pty', { i, val: p.y })}</td>
      <td><button data-act="delpt" data-i="${i}" title="Elimina angolo"${r.pts.length <= 3 ? ' disabled' : ''}>✕</button></td></tr>`).join('')}
    </tbody></table>`;

  const panel = $('#panel');
  const scroll = panel.scrollTop;
  panel.innerHTML = section('rooms', 'Stanze', rooms) + section('walls', `Pareti (${r.pts.length})`, walls)
    + section('feat', `Nicchie e pilastri (${r.features.length})`, feats) + section('open', `Porte e finestre (${r.openings.length})`, openings)
    + section('furn', `Mobili (${r.furniture.length})`, furniture) + section('adv', 'Angoli (avanzato)', adv);
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
  if (!id || !/^(nf|nr)-/.test(id)) return;
  ui.draft[id] = e.target.value;
  if (id === 'nr-shape' && e.type === 'change') renderPanel();
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
      const w = num(ui.draft['nr-w'], 400), d = num(ui.draft['nr-d'], 300), L = ui.draft['nr-shape'] === 'L';
      const cw = num(ui.draft['nr-cw'], 150), cd = num(ui.draft['nr-cd'], 150);
      if (w < 50 || d < 50) { alert('La stanza deve essere almeno 50 × 50 cm.'); return; }
      if (L && (cw < 10 || cd < 10 || cw > w - 10 || cd > d - 10)) { alert('Il taglio dell\'angolo deve stare dentro il rettangolo (lasciando almeno 10 cm).'); return; }
      snap();
      const nr = newRoom((ui.draft['nr-name'] || '').trim() || `Stanza ${state.rooms.length + 1}`, shapePts(L ? 'L' : 'R', w, d, ui.draft['nr-corner'] || 'br', cw, cd));
      state.rooms.push(nr); state.current = nr.id; ui.sel = null; ui.draft['nr-name'] = ''; fit(); break;
    }
    case 'duproom': {
      snap();
      const c = JSON.parse(JSON.stringify(r));
      c.id = uid(); c.name += ' (copia)';
      for (const it of [...c.openings, ...c.features, ...c.furniture]) it.id = uid();
      state.rooms.push(c); state.current = c.id; ui.sel = null; break;
    }
    case 'delroom':
      if (state.rooms.length < 2 || !confirm(`Eliminare "${r.name}" con tutti i suoi mobili?`)) return;
      snap(); state.rooms = state.rooms.filter((x) => x !== r); state.current = state.rooms[0].id; ui.sel = null; fit(); break;
    case 'selwall': ui.sel = { t: 'wall', i }; break;
    case 'delpt':
      if (r.pts.length <= 3 || !confirm('Eliminare questo angolo? Le due pareti vicine si fonderanno in una.')) return;
      snap(); deletePt(r, i); ui.sel = null; break;
    case 'addfeat': {
      snap();
      const len = edge(r, 0).len, w = Math.min(100, Math.round(len * 0.4));
      const nf = { id: uid(), type: el.dataset.k, wall: 0, from: 'start', offset: Math.round(Math.max(0, (len - w) / 2)), width: w, depth: 30 };
      r.features.push(nf); ui.sel = { t: 'feat', id: nf.id }; break;
    }
    case 'selfeat': ui.sel = { t: 'feat', id }; break;
    case 'delfeat': snap(); r.features = r.features.filter((x) => x.id !== id); ui.sel = null; break;
    case 'addopen': {
      snap();
      const door = el.dataset.k === 'door';
      const o = { id: uid(), type: door ? 'door' : 'window', wall: 0, from: 'start', offset: 50, width: door ? 80 : 120, hinge: 'start', swing: 'in' };
      r.openings.push(o); ui.sel = { t: 'open', id: o.id }; break;
    }
    case 'selopen': ui.sel = { t: 'open', id }; break;
    case 'delopen': snap(); r.openings = r.openings.filter((o) => o.id !== id); ui.sel = null; break;
    case 'addfurn': {
      snap();
      const b = bbox({ pts: r.pts, features: [], furniture: [] });
      const nf = {
        id: uid(), name: (ui.draft['nf-name'] || '').trim() || 'Mobile',
        w: Math.max(1, num(ui.draft['nf-w'], 100)), d: Math.max(1, num(ui.draft['nf-d'], 50)),
        x: snapTo((b.x0 + b.x1) / 2), y: snapTo((b.y0 + b.y1) / 2), rot: 0, color: COLORS[r.furniture.length % COLORS.length],
      };
      r.furniture.push(nf); ui.sel = { t: 'furn', id: nf.id };
      ui.draft['nf-name'] = ''; ui.draft['nf-w'] = ''; ui.draft['nf-d'] = ''; break;
    }
    case 'addperson': {
      snap();
      const b = bbox({ pts: r.pts, features: [], furniture: [] });
      const np = { id: uid(), name: 'Omino', person: true, w: PERSON.w, d: PERSON.d, x: Math.round((b.x0 + b.x1) / 2), y: Math.round((b.y0 + b.y1) / 2), rot: 0, color: '#f2b896' };
      r.furniture.push(np); ui.sel = { t: 'furn', id: np.id }; break;
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
    case 'wlen': setWallLen(r, i, Math.max(1, num(el.value, edge(r, i).len))); break;
    case 'oset': { // vale sia per aperture sia per sezioni
      const o = findItem(r, id);
      if (!o) return;
      const isOpening = o.type === 'door' || o.type === 'window';
      if (p === 'hinge' || p === 'swing' || p === 'type') o[p] = el.value;
      else if (p === 'from') { const len = edge(r, o.wall).len, s0 = opStart(o, len); o.from = el.value; setOpStart(o, len, s0); }
      else if (p === 'wall') o.wall = +el.value;
      else if (p === 'width') o.width = Math.max(isOpening ? 10 : 1, num(el.value, o.width));
      else if (p === 'depth') o.depth = Math.max(1, num(el.value, o.depth));
      else o[p] = num(el.value, o[p]);
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

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const t = e.target.closest('[data-t]'), p = toWorld(e), r = room();
  svg.setPointerCapture(e.pointerId);
  const base = { sx: e.clientX, sy: e.clientY, moved: false };
  const pan = { ...base, kind: 'pan', vx: ui.view.x, vy: ui.view.y };
  ui.drag = null;
  if (t && t.dataset.t === 'furn') {
    const f = r.furniture.find((x) => x.id === t.dataset.id);
    ui.sel = { t: 'furn', id: f.id };
    ui.drag = { ...base, kind: 'furn', f, ox: p.x - f.x, oy: p.y - f.y };
  } else if (t && t.dataset.t === 'rot' && ui.sel && ui.sel.t === 'furn') {
    ui.drag = { ...base, kind: 'rot', f: r.furniture.find((x) => x.id === ui.sel.id) };
  } else if (t && t.dataset.t === 'feat') {
    ui.sel = { t: 'feat', id: t.dataset.id }; ui.drag = pan;
  } else if (t && t.dataset.t === 'open') {
    ui.sel = { t: 'open', id: t.dataset.id }; ui.drag = pan;
  } else if (t && t.dataset.t === 'wall') {
    ui.sel = { t: 'wall', i: +t.dataset.i }; ui.drag = pan;
  } else {
    ui.sel = null; ui.drag = pan;
  }
  renderAll();
});

svg.addEventListener('pointermove', (e) => {
  const d = ui.drag;
  if (!d) return;
  if (!d.moved) {
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 3) return;
    d.moved = true;
    if (d.kind === 'furn' || d.kind === 'rot') snap();
  }
  if (d.kind === 'pan') {
    ui.view.x = d.vx + e.clientX - d.sx; ui.view.y = d.vy + e.clientY - d.sy;
  } else if (d.kind === 'rot') {
    const p = toWorld(e), deg = (Math.atan2(p.y - d.f.y, p.x - d.f.x) * 180) / Math.PI + 90;
    const step = e.altKey || d.f.person ? 1 : 5; // l'omino si gira liberamente
    d.f.rot = ((snapTo(deg, step) % 360) + 360) % 360;
  } else {
    const p = toWorld(e), free = e.altKey || d.f.person; // l'omino si muove liberamente: niente snap né calamita
    d.f.x = p.x - d.ox; d.f.y = p.y - d.oy;
    if (!free) { d.f.x = snapTo(d.f.x); d.f.y = snapTo(d.f.y); magnet(d.f, outline(room())); }
  }
  renderCanvas();
});

function endDrag() {
  const d = ui.drag;
  ui.drag = null;
  if (d && d.moved && (d.kind === 'furn' || d.kind === 'rot')) save();
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
  const r = room(), sel = ui.sel, f = sel && sel.t === 'furn' ? r.furniture.find((x) => x.id === sel.id) : null;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') { ui.sel = null; renderAll(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel && (sel.t === 'feat' || sel.t === 'open')) {
    snap();
    if (sel.t === 'feat') r.features = r.features.filter((x) => x.id !== sel.id); else r.openings = r.openings.filter((x) => x.id !== sel.id);
    ui.sel = null; commit(); return;
  }
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
$('#b-quotes').addEventListener('click', (e) => {
  ui.quotes = !ui.quotes;
  e.currentTarget.classList.toggle('active', ui.quotes);
  e.currentTarget.setAttribute('aria-pressed', ui.quotes);
  renderCanvas();
});
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
    state = migrate(s);
    if (!state.rooms.some((r) => r.id === state.current)) state.current = state.rooms[0].id;
    ui.sel = null; fit(); commit();
  } catch (err) { alert(`Impossibile importare il file: ${err.message}`); }
});

window.addEventListener('resize', () => { fit(); renderCanvas(); });

state = load() || defaultState();
fit();
renderAll();
