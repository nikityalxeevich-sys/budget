import { firebaseConfig, SDK_BASE } from './config.js';

const MONTHS = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const GP = [
  { k: 'income', t: 'Доходы', add: 'Добавить доход', nw: 'Новый доход' },
  { k: 'expense', t: 'Расходы', add: 'Добавить статью расходов', nw: 'Новая статья' },
  { k: 'saving', t: 'Накопления', add: 'Добавить накопление', nw: 'Новая цель' },
  { k: 'invest', t: 'Инвестиции', add: 'Добавить вложение', nw: 'Новый актив' }
];
const GF = [
  { k: 'expense', t: 'Общие расходы', add: 'Добавить статью расходов', nw: 'Новая статья' },
  { k: 'saving', t: 'Общие накопления', add: 'Добавить накопление', nw: 'Новая цель' },
  { k: 'invest', t: 'Общие инвестиции', add: 'Добавить вложение', nw: 'Новый актив' }
];
const SHORTG = { income: 'Доходы', expense: 'Расходы', saving: 'Накопления', invest: 'Инвестиции' };
const DEF = {
  family: [
    { id: 'f-exp1', g: 'expense', n: 'Жильё и коммунальные', t: 1 }, { id: 'f-exp2', g: 'expense', n: 'Продукты', t: 2 },
    { id: 'f-exp3', g: 'expense', n: 'Транспорт', t: 3 }, { id: 'f-exp4', g: 'expense', n: 'Связь и подписки', t: 4 },
    { id: 'f-exp5', g: 'expense', n: 'Здоровье', t: 5 }, { id: 'f-exp6', g: 'expense', n: 'Отдых и развлечения', t: 6 },
    { id: 'f-sav1', g: 'saving', n: 'Подушка безопасности', t: 7 }, { id: 'f-sav2', g: 'saving', n: 'Вклад', t: 8 },
    { id: 'f-inv1', g: 'invest', n: 'Брокерский счёт', t: 9 }
  ],
  personal: [
    { id: 'p-inc1', g: 'income', n: 'Зарплата', t: 1 }, { id: 'p-inc2', g: 'income', n: 'Подработка', t: 2 },
    { id: 'p-exp1', g: 'expense', n: 'Взнос в семейный бюджет', t: 3 }, { id: 'p-exp2', g: 'expense', n: 'Личные траты', t: 4 },
    { id: 'p-exp3', g: 'expense', n: 'Подписки и хобби', t: 5 },
    { id: 'p-sav1', g: 'saving', n: 'Личная подушка', t: 6 }, { id: 'p-inv1', g: 'invest', n: 'Брокерский счёт', t: 7 }
  ]
};
const MODEKEY = 'moi-byudzhet-mode';

const now = new Date();
let YEAR = now.getFullYear();
let view = now.getMonth();
let mode = 'personal';
try { if (localStorage.getItem(MODEKEY) === 'family') mode = 'family'; } catch (e) {}

function blank(m) {
  return { lines: DEF[m].map(l => ({ ...l })), amt: {}, contrib: {}, open: {}, rate: { sav: 0, inv: 0 },
    metaExists: false, ready: false, pending: false, failed: false, denied: false };
}
const DATA = { family: blank('family'), personal: blank('personal') };
let fs = null, db = null, authM = null, auth = null, user = null, unsubs = [], lastSig = '';

const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const ym = (y, m) => y + '-' + pad(m + 1);
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
const parse = s => { const n = parseFloat(String(s).replace(/[\s ]/g, '').replace(',', '.')); return isFinite(n) ? n : 0; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const money = n => nf.format(Math.round(n)) + ' ₽';
const pct = x => Math.round(x * 100) + '%';
const uid = () => 'l' + Math.random().toString(36).slice(2, 8);
const cur = () => DATA[mode];
const groups = () => mode === 'family' ? GF : GP;

/* ---------- экраны-заглушки ---------- */
function gate(html) {
  $('gate').innerHTML = html; $('gate').hidden = false;
  $('login').hidden = true; $('app').hidden = true; $('topr').hidden = true;
}
function configured() {
  const c = firebaseConfig;
  return c && typeof c.apiKey === 'string' && c.apiKey && c.apiKey.indexOf('ВСТАВЬТЕ') < 0 && c.projectId && c.projectId.indexOf('ВСТАВЬТЕ') < 0;
}

/* ---------- путь в базе ---------- */
function basePath(m) { return m === 'family' ? ['families', 'main', 'budget'] : ['users', user.uid, 'budget']; }

/* ---------- запись ---------- */
function fw(m, docId, patch) {
  if (!fs || !user) return;
  DATA[m].failed = false;
  fs.setDoc(fs.doc(db, ...basePath(m), docId), patch, { merge: true }).catch(() => {
    DATA[m].failed = true; showSync();
  });
}
function metaPatch(m, patch) {
  const D = DATA[m];
  if (!D.metaExists) {
    const d = { lines: {}, open: {}, rate: { sav: 0, inv: 0 } };
    DEF[m].forEach(l => { d.lines[l.id] = { g: l.g, n: l.n, t: l.t }; });
    patch = deepMerge(d, patch);
    D.metaExists = true;
  }
  fw(m, 'meta', patch);
}
function deepMerge(a, b) {
  Object.keys(b).forEach(k => {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) a[k] = deepMerge((a[k] && typeof a[k] === 'object') ? a[k] : {}, v);
    else a[k] = v;
  });
  return a;
}
function setAmt(id, k, v) {
  const D = cur();
  if (v) { (D.amt[id] = D.amt[id] || {})[k] = v; } else if (D.amt[id]) { D.amt[id][k] = 0; }
  fw(mode, 'm-' + k, { amt: { [id]: v } });
}
function setContrib(k, v) {
  const D = DATA.family;
  if (v) D.contrib[k] = v; else delete D.contrib[k];
  fw('family', 'm-' + k, { contrib: v });
}
function addLine(g, nw) {
  const id = uid(), D = cur(), t = Date.now();
  D.lines.push({ id, g, n: nw, t });
  metaPatch(mode, { lines: { [id]: { g, n: nw, t } } });
  return id;
}
function renameLine(id, n) {
  const D = cur();
  for (let i = 0; i < D.lines.length; i++) { if (D.lines[i].id === id) { D.lines[i].n = n; break; } }
  metaPatch(mode, { lines: { [id]: { n } } });
}
function delLine(id) {
  const D = cur();
  D.lines = D.lines.filter(l => l.id !== id);
  metaPatch(mode, { lines: { [id]: { x: true } } });
}
function setOpen(field, val) {
  const D = cur(), o = D.open[YEAR] = D.open[YEAR] || { sav: null, inv: null };
  o[field] = val;
  metaPatch(mode, { open: { [YEAR]: { [field]: val } } });
}
function setRate(field, val) {
  cur().rate[field] = val;
  metaPatch(mode, { rate: { [field]: val } });
}

/* ---------- чтение ---------- */
function applySnap(m, snap) {
  const allowed = m === 'family' ? ['expense', 'saving', 'invest'] : ['income', 'expense', 'saving', 'invest'];
  const lines = [], amt = {}, contrib = {}, open = {}, rate = { sav: 0, inv: 0 };
  let meta = false;
  snap.docs.forEach(d => {
    const x = d.data() || {};
    if (d.id === 'meta') {
      meta = true;
      const L = (x.lines && typeof x.lines === 'object') ? x.lines : {};
      Object.keys(L).forEach(id => {
        const o = L[id];
        if (!o || o.x || allowed.indexOf(o.g) < 0 || typeof o.n !== 'string') return;
        lines.push({ id, g: o.g, n: o.n, t: num(o.t) });
      });
      if (x.open && typeof x.open === 'object') Object.keys(x.open).forEach(y => {
        const o = x.open[y] || {};
        open[y] = { sav: typeof o.sav === 'number' ? o.sav : null, inv: typeof o.inv === 'number' ? o.inv : null };
      });
      if (x.rate && typeof x.rate === 'object') { rate.sav = num(x.rate.sav); rate.inv = num(x.rate.inv); }
    } else if (d.id.indexOf('m-') === 0) {
      const k = d.id.slice(2), A = (x.amt && typeof x.amt === 'object') ? x.amt : {};
      Object.keys(A).forEach(id => { (amt[id] = amt[id] || {})[k] = num(A[id]); });
      if (num(x.contrib)) contrib[k] = num(x.contrib);
    }
  });
  const D = DATA[m];
  D.lines = meta ? lines : DEF[m].map(l => ({ ...l }));
  D.lines.sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : 1));
  D.amt = amt; D.contrib = contrib; D.open = open; D.rate = rate;
  D.metaExists = meta; D.ready = true; D.denied = false;
  D.pending = !!(snap.metadata && snap.metadata.hasPendingWrites);
}
function listen(m) {
  const col = fs.collection(db, ...basePath(m));
  return fs.onSnapshot(col, { includeMetadataChanges: true }, snap => {
    applySnap(m, snap);
    if (m === mode) onDataChange();
  }, () => {
    DATA[m].denied = true; DATA[m].ready = true;
    if (m === mode) { renderBanner(); showSync(); }
  });
}
function stopListening() { unsubs.forEach(u => { try { u(); } catch (e) {} }); unsubs = []; }

/* ---------- статус ---------- */
function showSync() {
  const D = cur(), el = $('sync');
  const who = mode === 'family' ? 'Общий бюджет, виден вам обоим' : 'Личный бюджет, виден только вам';
  let s, off = false;
  if (D.failed) { s = 'не удалось сохранить'; off = true; }
  else if (!navigator.onLine) { s = D.pending ? 'нет связи, изменения сохранятся позже' : 'нет связи, показаны сохранённые данные'; off = true; }
  else if (D.denied) { s = 'нет доступа'; off = true; }
  else if (!D.ready) s = 'загружаю…';
  else if (D.pending) s = 'сохраняю…';
  else s = 'сохранено';
  el.textContent = user ? who + ' · ' + s : '';
  el.className = 'sync' + (off ? ' off' : '');
}
window.addEventListener('online', showSync);
window.addEventListener('offline', showSync);

/* ---------- расчёты ---------- */
function sums(k) {
  const D = cur(), s = { income: 0, expense: 0, saving: 0, invest: 0 };
  D.lines.forEach(l => { const a = D.amt[l.id]; if (a) s[l.g] += num(a[k]); });
  if (mode === 'family') { s.contrib = num(D.contrib[k]); s.base = s.contrib * 2; } else { s.base = s.income; }
  s.out = s.expense + s.saving + s.invest;
  s.rest = s.base - s.out;
  return s;
}
function dataHas(y) {
  const D = cur(), p = y + '-';
  if (mode === 'family' && Object.keys(D.contrib).some(k => k.indexOf(p) === 0 && D.contrib[k])) return true;
  return Object.keys(D.amt).some(id => { const a = D.amt[id]; return Object.keys(a).some(k => k.indexOf(p) === 0 && a[k]); });
}
function getOpen(y, d) {
  const e = cur().open[y] || {};
  let sav = (e.sav != null) ? e.sav : null, inv = (e.inv != null) ? e.inv : null;
  if ((sav === null || inv === null) && d < 10 && dataHas(y - 1)) {
    const p = calcYear(y - 1, d + 1);
    if (sav === null) sav = p.end.sav;
    if (inv === null) inv = p.end.inv;
  }
  return { sav: sav || 0, inv: inv || 0 };
}
function calcYear(y, d) {
  d = d || 0;
  const D = cur(), op = getOpen(y, d);
  let cs = op.sav, ci = op.inv, gs = 0, gi = 0, active = 0;
  const rs = D.rate.sav / 1200, ri = D.rate.inv / 1200, rows = [], T = { base: 0, expense: 0, saving: 0, invest: 0 };
  for (let m = 0; m < 12; m++) {
    const s = sums(ym(y, m));
    gs += cs * rs; gi += ci * ri;
    cs = cs * (1 + rs) + s.saving; ci = ci * (1 + ri) + s.invest;
    s.cap = cs + ci;
    s.on = (s.base || s.expense || s.saving || s.invest) ? 1 : 0;
    active += s.on;
    T.base += s.base; T.expense += s.expense; T.saving += s.saving; T.invest += s.invest;
    rows.push(s);
  }
  T.rest = T.base - T.expense - T.saving - T.invest;
  return { rows, T, op, end: { sav: cs, inv: ci }, growth: { sav: gs, inv: gi }, n: active || 1 };
}

/* ---------- отрисовка: общее ---------- */
function renderModes() {
  $('modes').innerHTML =
    `<button type="button" role="tab" data-mode="family" aria-selected="${mode === 'family'}">Семейный</button>` +
    `<button type="button" role="tab" data-mode="personal" aria-selected="${mode === 'personal'}">Личный</button>`;
}
function renderTabs() {
  let h = '';
  for (let m = 0; m < 12; m++) h += `<button type="button" role="tab" data-tab="${m}" aria-selected="${view === m}">${SHORT[m]}</button>`;
  h += `<i class="sep"></i><button type="button" role="tab" data-tab="year" aria-selected="${view === 'year'}">Год</button>`;
  const t = $('tabs'); t.innerHTML = h;
  const a = t.querySelector('[aria-selected="true"]');
  if (a) t.scrollLeft = a.offsetLeft - (t.clientWidth - a.offsetWidth) / 2;
}
function renderBanner() {
  const D = cur(), b = $('banner');
  let h = '';
  if (D.denied) {
    h = '<div class="banner"><p>Нет доступа к этим данным. Проверьте, что ваша почта указана в правилах Firestore (файл firestore.rules, шаг 2 в README).</p></div>';
  } else if (D.ready && !D.metaExists && !Object.keys(D.amt).length && !Object.keys(D.contrib).length) {
    h = mode === 'family'
      ? '<div class="banner"><p>Общий бюджет пока пуст. Впишите, сколько каждый из вас вносит в месяц, и общие траты. Названия статей можно менять, их увидит и второй человек.</p></div>'
      : '<div class="banner"><p>Личный бюджет пока пуст. Впишите доходы и расходы за месяц. Названия статей можно менять, добавлять и удалять.</p></div>';
  }
  b.innerHTML = h;
}
function showApp() {
  $('gate').hidden = true; $('login').hidden = true; $('app').hidden = false; $('topr').hidden = false;
  renderAll();
}
function renderAll() {
  $('yLabel').textContent = YEAR;
  renderModes(); renderTabs(); renderBanner(); showSync();
  if (view === 'year') renderYear(); else renderMonth();
}

/* ---------- месяц ---------- */
function rowHtml(l, k) {
  const v = num((cur().amt[l.id] || {})[k]);
  return `<div class="row"><input class="nm" id="nm-${l.id}" type="text" maxlength="60" value="${esc(l.n)}" data-nm="${l.id}" aria-label="Название статьи">` +
    `<input class="amt" id="am-${l.id}" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${v ? v : ''}" data-am="${l.id}" aria-label="Сумма за месяц, ${esc(l.n)}">` +
    `<button type="button" class="x" data-del="${l.id}" aria-label="Удалить статью ${esc(l.n)}">×</button></div>`;
}
function renderMonth() {
  const D = cur(), fam = mode === 'family', k = ym(YEAR, view);
  let h = `<div class="mhead"><h2>${MONTHS[view]} ${YEAR}</h2><button type="button" class="btn" id="copyPrev">Взять суммы из прошлого месяца</button></div>`;
  h += '<div class="card" id="sum" style="margin-top:12px"></div>';
  h += '<div style="display:flex;flex-direction:column;gap:16px;margin-top:16px">';
  if (fam) {
    const c = num(D.contrib[k]);
    h += '<section class="grp"><div class="ghead"><span class="dot pot"></span><h3>Общий бюджет</h3><span class="gtot num" id="gt-pot"></span></div>' +
      '<div class="row"><label class="nm" for="contrib">Взнос каждого из вас</label>' +
      `<input class="amt" id="contrib" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="${c ? c : ''}" data-contrib="1" aria-label="Взнос каждого в общий бюджет за месяц"><span></span></div>` +
      '<p class="pnote">Вы вносите поровну. Сумма двух взносов идёт на общие расходы, накопления и инвестиции.</p></section>';
  }
  groups().forEach(g => {
    h += `<section class="grp"><div class="ghead"><span class="dot ${g.k}"></span><h3>${g.t}</h3><span class="gtot num" id="gt-${g.k}"></span></div><div>`;
    D.lines.forEach(l => { if (l.g === g.k) h += rowHtml(l, k); });
    h += `</div><button type="button" class="add" data-add="${g.k}">+ ${g.add}</button></section>`;
  });
  h += '</div>';
  $('view').innerHTML = h;
  lastSig = linesSig();
  refreshMonth();
}
function linesSig() { return mode + cur().lines.map(l => l.id + l.g + l.n).join('|'); }
function sumHtml(s) {
  const fam = mode === 'family', rest = s.rest, den = Math.max(s.base, s.out);
  const neg = rest < 0, empty = (s.base === 0 && s.out === 0);
  const hint = empty ? (fam ? 'Впишите взнос и общие траты месяца' : 'Впишите доходы и расходы месяца')
    : (neg ? (fam ? 'Общих трат больше, чем в общем бюджете' : 'Расходов и отложенного больше, чем дохода')
      : (fam ? 'Не потрачено и не отложено' : 'Не распределено'));
  const w = v => den > 0 ? (v / den * 100).toFixed(2) : 0;
  let h = `<div class="bal${neg ? ' neg' : ''}"><div><span class="lbl">${fam ? 'Остаток общего бюджета' : 'Остаток месяца'}</span><strong class="num big">${money(rest)}</strong><span class="hint">${hint}</span></div>` +
    `<div class="rate"><span class="lbl">Отложено</span><strong class="num">${s.base > 0 ? pct((s.saving + s.invest) / s.base) : '—'}</strong><span class="hint">${fam ? 'от общего бюджета' : 'от дохода'}</span></div></div>`;
  h += `<div class="split" role="img" aria-label="Куда ушли деньги"><i style="width:${w(s.expense)}%;background:var(--c-expense)"></i><i style="width:${w(s.saving)}%;background:var(--c-saving)"></i><i style="width:${w(s.invest)}%;background:var(--c-invest)"></i></div>`;
  h += `<div class="legend"><div><span class="dot ${fam ? 'pot' : 'income'}"></span>${fam ? 'Общий бюджет' : 'Доходы'}<b class="num">${money(s.base)}</b></div>`;
  ['expense', 'saving', 'invest'].forEach(g => { h += `<div><span class="dot ${g}"></span>${SHORTG[g]}<b class="num">${money(s[g])}</b></div>`; });
  return h + '</div>';
}
function refreshMonth() {
  const s = sums(ym(YEAR, view));
  groups().forEach(g => { const e = $('gt-' + g.k); if (e) e.textContent = money(s[g.k]); });
  const p = $('gt-pot'); if (p) p.textContent = money(s.base);
  $('sum').innerHTML = sumHtml(s);
}

/* ---------- год ---------- */
function nice(x) {
  if (x <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function compact(v) {
  if (v === 0) return '0';
  if (v >= 1e6) return (v / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' млн';
  if (v >= 1000) return (v / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' тыс';
  return String(Math.round(v));
}
function chartSvg(c) {
  const fam = mode === 'family', bl = fam ? 'общий бюджет' : 'доход';
  const W = 480, H = 250, L = 48, R = 6, T = 12, B = 24, pw = W - L - R, ph = H - T - B;
  let mx = 0;
  c.rows.forEach(r => { mx = Math.max(mx, r.base, r.out); });
  if (mx <= 0) return `<svg viewBox="0 0 ${W} 120" role="img" aria-label="Пока нет данных"><text class="empty" x="${W / 2}" y="60" text-anchor="middle">Графика пока нет: внесите суммы за месяцы</text></svg>`;
  const step = nice(mx / 4), top = step * Math.ceil(mx / step);
  const Y = v => T + ph - (v / top) * ph;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${fam ? 'Общий бюджет' : 'Доход'} и распределение по месяцам">`;
  for (let v = 0; v <= top + 1e-6; v += step) {
    s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`;
    s += `<text class="ax" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${compact(v)}</text>`;
  }
  const slot = pw / 12, bw = Math.min(24, slot * 0.62);
  c.rows.forEach((r, i) => {
    const cx = L + slot * i + slot / 2, x = cx - bw / 2;
    let base = 0;
    const parts = [['b-exp', r.expense], ['b-sav', r.saving], ['b-inv', r.invest]];
    const tip = `${SHORT[i]}: ${bl} ${money(r.base)}, расходы ${money(r.expense)}, накопления ${money(r.saving)}, инвестиции ${money(r.invest)}`;
    s += `<g><title>${esc(tip)}</title>`;
    parts.forEach(p => {
      if (p[1] <= 0) return;
      const y1 = Y(base + p[1]), y0 = Y(base);
      s += `<rect class="${p[0]}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}"/>`;
      base += p[1];
    });
    if (r.base > 0) s += `<line class="inc" x1="${(cx - bw / 2 - 3).toFixed(1)}" x2="${(cx + bw / 2 + 3).toFixed(1)}" y1="${Y(r.base).toFixed(1)}" y2="${Y(r.base).toFixed(1)}"/>`;
    s += `<text class="ax" x="${cx.toFixed(1)}" y="${H - 7}" text-anchor="middle">${SHORT[i]}</text></g>`;
  });
  return s + '</svg>';
}
function cell(v, cls) {
  return `<td class="num ${cls || ''}${v === 0 ? ' dim' : ''}${v < 0 ? ' neg' : ''}">${v === 0 ? '—' : money(v)}</td>`;
}
function yearOut() {
  const fam = mode === 'family', c = calcYear(YEAR), T = c.T, n = c.n;
  const st = (cls, lbl, val, sub, neg) => `<div class="stat"><span class="lbl">${cls ? `<span class="dot ${cls}"></span>` : ''}${lbl}</span><strong class="num val${neg ? ' neg' : ''}">${money(val)}</strong><span class="sub">${sub}</span></div>`;
  let h = '<div class="stats">' +
    (fam ? st('pot', 'Общий бюджет', T.base, 'по ' + money(T.base / 2) + ' от каждого') : st('income', 'Доходы', T.base, 'в среднем ' + money(T.base / n) + ' в месяц')) +
    st('expense', fam ? 'Общие расходы' : 'Расходы', T.expense, 'в среднем ' + money(T.expense / n) + ' в месяц') +
    st('', 'Отложено', T.saving + T.invest, T.base > 0 ? pct((T.saving + T.invest) / T.base) + (fam ? ' общего бюджета' : ' дохода') : 'нет данных') +
    st('', fam ? 'Остаток общего' : 'Остаток за год', T.rest, T.rest < 0 ? 'перерасход' : (fam ? 'не потрачено и не отложено' : 'не распределено'), T.rest < 0) + '</div>';
  h += `<section class="card sec chart"><h3>${fam ? 'Куда уходит общий бюджет' : 'Куда уходит доход'}</h3><div>${chartSvg(c)}</div><div class="legend">` +
    '<div><span class="dot expense"></span>Расходы</div><div><span class="dot saving"></span>Накопления</div><div><span class="dot invest"></span>Инвестиции</div>' +
    `<div><span class="dot" style="background:var(--fg);height:3px;border-radius:2px;width:14px"></span>${fam ? 'Общий бюджет' : 'Доход'}</div></div></section>`;
  h += `<section class="card sec"><h3>По месяцам</h3><div class="scroll"><table><thead><tr><th>Месяц</th><th>${fam ? 'Общий бюджет' : 'Доход'}</th><th>Расходы</th><th>Накопл.</th><th>Инвест.</th><th>Остаток</th><th>Капитал</th></tr></thead><tbody>`;
  c.rows.forEach((r, i) => {
    h += `<tr><td>${MONTHS[i]}</td>${cell(r.base)}${cell(r.expense)}${cell(r.saving)}${cell(r.invest)}${cell(r.on ? r.rest : 0)}<td class="num">${money(r.cap)}</td></tr>`;
  });
  h += `</tbody><tfoot><tr><td>Итого</td>${cell(T.base)}${cell(T.expense)}${cell(T.saving)}${cell(T.invest)}${cell(T.rest)}<td class="num">${money(c.end.sav + c.end.inv)}</td></tr></tfoot></table></div></section>`;
  const gS = c.growth.sav, gI = c.growth.inv;
  h += `<section class="card sec"><h3>Капитал на конец года</h3><p class="note">${fam ? 'Общие накопления' : 'Накопления'} и инвестиции: сколько было на 1 января, сколько добавлено и сколько прибавила доходность.</p><div class="scroll"><table><thead><tr><th></th><th>Было</th><th>Взносы</th><th>Доходность</th><th>Стало</th></tr></thead><tbody>` +
    `<tr><td>Накопления</td>${cell(c.op.sav)}${cell(T.saving)}${cell(gS)}<td class="num">${money(c.end.sav)}</td></tr>` +
    `<tr><td>Инвестиции</td>${cell(c.op.inv)}${cell(T.invest)}${cell(gI)}<td class="num">${money(c.end.inv)}</td></tr></tbody>` +
    `<tfoot><tr><td>Всего</td>${cell(c.op.sav + c.op.inv)}${cell(T.saving + T.invest)}${cell(gS + gI)}<td class="num">${money(c.end.sav + c.end.inv)}</td></tr></tfoot></table></div></section>`;
  return h;
}
function renderYear() {
  const D = cur(), e = D.open[YEAR] || {}, auto = getOpen(YEAR, 0);
  const sv = (e.sav != null) ? e.sav : '', iv = (e.inv != null) ? e.inv : '';
  let h = `<div class="mhead"><h2>Итоги за ${YEAR} год</h2></div><div id="yout" style="display:flex;flex-direction:column;gap:16px;margin-top:12px">${yearOut()}</div>`;
  h += `<section class="card sec" style="margin-top:16px"><h3>Остатки и доходность</h3><p class="note">Накопления и инвестиции на 1 января ${YEAR}. Если оставить поле пустым и в прошлом году есть данные, остаток возьмётся из его итога. Доходность 0 означает, что деньги не растут.</p><div class="set">` +
    `<div class="field"><label for="openSav">Накопления на 1 января, ₽</label><input class="r" id="openSav" type="text" inputmode="decimal" data-set="openSav" placeholder="${nf.format(Math.round(auto.sav))}" value="${sv}"></div>` +
    `<div class="field"><label for="openInv">Инвестиции на 1 января, ₽</label><input class="r" id="openInv" type="text" inputmode="decimal" data-set="openInv" placeholder="${nf.format(Math.round(auto.inv))}" value="${iv}"></div>` +
    `<div class="field"><label for="rateSav">Доходность накоплений, % годовых</label><input class="r" id="rateSav" type="text" inputmode="decimal" data-set="rateSav" placeholder="0" value="${D.rate.sav || ''}"></div>` +
    `<div class="field"><label for="rateInv">Доходность инвестиций, % годовых</label><input class="r" id="rateInv" type="text" inputmode="decimal" data-set="rateInv" placeholder="0" value="${D.rate.inv || ''}"></div>` +
    '</div></section>';
  $('view').innerHTML = h;
}
function refreshYear() { const e = $('yout'); if (e) e.innerHTML = yearOut(); }

/* ---------- обновление при изменении данных (свои и чужие) ---------- */
function onDataChange() {
  renderBanner(); showSync();
  if (view === 'year') { if ($('yout')) refreshYear(); else renderYear(); return; }
  const foc = document.activeElement;
  const inView = !!(foc && foc.tagName === 'INPUT' && $('view').contains(foc));
  if (!$('sum') || (linesSig() !== lastSig && !inView)) { renderMonth(); return; }
  const k = ym(YEAR, view), D = cur();
  Array.prototype.forEach.call(document.querySelectorAll('[data-am]'), inp => {
    if (inp !== foc) { const v = num((D.amt[inp.dataset.am] || {})[k]); inp.value = v ? v : ''; }
  });
  const c = $('contrib');
  if (c && c !== foc) { const cv = num(DATA.family.contrib[k]); c.value = cv ? cv : ''; }
  refreshMonth();
}

/* ---------- события ---------- */
document.addEventListener('input', e => {
  const t = e.target;
  if (!user) return;
  if (t.dataset.am) { setAmt(t.dataset.am, ym(YEAR, view), parse(t.value)); refreshMonth(); }
  else if (t.dataset.contrib) { setContrib(ym(YEAR, view), parse(t.value)); refreshMonth(); }
  else if (t.dataset.nm) { renameLine(t.dataset.nm, t.value); }
  else if (t.dataset.set) {
    const key = t.dataset.set, raw = t.value.trim(), val = parse(raw);
    if (key === 'openSav') setOpen('sav', raw === '' ? null : val);
    else if (key === 'openInv') setOpen('inv', raw === '' ? null : val);
    else setRate(key === 'rateSav' ? 'sav' : 'inv', val);
    refreshYear();
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('amt')) {
    const all = Array.prototype.slice.call(document.querySelectorAll('.amt')), i = all.indexOf(e.target);
    if (all[i + 1]) { e.preventDefault(); all[i + 1].focus(); all[i + 1].select(); }
  }
});
document.addEventListener('click', e => {
  const el = e.target.closest('button');
  if (!el || !user) return;
  if (el.dataset.mode) {
    mode = el.dataset.mode === 'family' ? 'family' : 'personal';
    try { localStorage.setItem(MODEKEY, mode); } catch (x) {}
    renderAll(); return;
  }
  if (el.dataset.tab !== undefined) { view = el.dataset.tab === 'year' ? 'year' : parseInt(el.dataset.tab, 10); renderAll(); return; }
  if (el.id === 'yPrev' || el.id === 'yNext') { YEAR += (el.id === 'yNext' ? 1 : -1); renderAll(); return; }
  if (el.id === 'signout') {
    if (el.dataset.armed) { stopListening(); authM.signOut(auth); }
    else {
      el.dataset.armed = '1'; el.textContent = navigator.onLine ? 'Выйти?' : 'Офлайн: войти снова не выйдет';
      el.classList.add('armed');
      setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = 'Выйти'; el.classList.remove('armed'); } }, 3000);
    }
    return;
  }
  if (el.id === 'copyPrev') {
    const D = cur(); let py = YEAR, pm = view - 1; if (pm < 0) { pm = 11; py--; }
    const pk = ym(py, pm), k = ym(YEAR, view); let n = 0;
    D.lines.slice().forEach(l => { const a = D.amt[l.id]; if (!a || !a[pk] || a[k]) return; setAmt(l.id, k, a[pk]); n++; });
    if (mode === 'family' && D.contrib[pk] && !D.contrib[k]) { setContrib(k, D.contrib[pk]); n++; }
    if (n) renderMonth();
    else { el.textContent = 'Нечего копировать'; setTimeout(() => { if (el.isConnected) el.textContent = 'Взять суммы из прошлого месяца'; }, 2000); }
    return;
  }
  if (el.dataset.add) {
    const g = groups().filter(x => x.k === el.dataset.add)[0];
    const id = addLine(g.k, g.nw);
    renderMonth();
    const inp = $('nm-' + id); if (inp) { inp.focus(); inp.select(); }
    return;
  }
  if (el.dataset.del) {
    if (el.dataset.armed) { delLine(el.dataset.del); renderMonth(); }
    else {
      el.dataset.armed = '1'; el.textContent = 'Удалить?'; el.classList.add('armed');
      setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = '×'; el.classList.remove('armed'); } }, 2500);
    }
  }
});

/* ---------- вход ---------- */
function loginError(code) {
  switch (code) {
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': case 'auth/invalid-email':
      return 'Неверная почта или пароль.';
    case 'auth/network-request-failed': return 'Нет связи. Для первого входа нужен интернет.';
    case 'auth/too-many-requests': return 'Слишком много попыток. Подождите несколько минут.';
    default: return 'Не удалось войти. Попробуйте ещё раз.';
  }
}
$('login').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('loginErr'), btn = $('loginBtn');
  err.hidden = true; btn.disabled = true; btn.textContent = 'Вхожу…';
  try { await authM.signInWithEmailAndPassword(auth, $('email').value.trim(), $('pass').value); }
  catch (x) { err.textContent = loginError(x && x.code); err.hidden = false; }
  btn.disabled = false; btn.textContent = 'Войти';
});

/* ---------- запуск ---------- */
async function boot() {
  if (!configured()) {
    gate('<p><strong>Сайт ещё не подключён к базе.</strong></p><p>Откройте файл config.js и вставьте настройки Firebase. Подробно написано в README.md, шаг 3.</p>');
    return;
  }
  try {
    const [appM, a, f] = await Promise.all([
      import(SDK_BASE + 'firebase-app.js'),
      import(SDK_BASE + 'firebase-auth.js'),
      import(SDK_BASE + 'firebase-firestore.js')
    ]);
    authM = a; fs = f;
    const app = appM.initializeApp(firebaseConfig);
    auth = a.getAuth(app);
    try {
      db = f.initializeFirestore(app, { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) });
    } catch (x) { db = f.getFirestore(app); }
    a.onAuthStateChanged(auth, u => {
      stopListening();
      user = u || null;
      DATA.family = blank('family'); DATA.personal = blank('personal');
      if (!user) { $('gate').hidden = true; $('app').hidden = true; $('topr').hidden = true; $('login').hidden = false; showSync(); return; }
      showApp();
      unsubs.push(listen('family'), listen('personal'));
    });
  } catch (x) {
    gate('<p><strong>Не удалось загрузить библиотеку.</strong></p><p>При самом первом запуске нужен интернет: приложение один раз скачивает всё нужное и дальше работает без связи. Проверьте подключение и обновите страницу.</p>' +
      '<button type="button" class="btn primary" onclick="location.reload()">Обновить</button>');
  }
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
boot();
