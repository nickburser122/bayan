'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmt2 = n => n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
const fmt0 = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US');
const pct = r => r == null || !isFinite(r) ? '—' : (r * 100).toFixed(1) + '%';
const nsp = t => '<span class="num">' + t + '</span>';
const sum = (a, f) => a.reduce((s, r) => s + (f(r) || 0), 0);
const byCost = (a, b) => b.cost - a.cost;
const today = () => iso(new Date());
const ORG = 'الهيئة العامة للتأمين الصحى';
const NA = 'غير محدد';

const DIMS = { specialty:'التخصص', doctor:'الطبيب', type:'نوع التذكرة', pharmacy:'الصيدلية', area:'المنطقة' };
const MEAS = { cost:'التكلفة', tickets:'التذاكر', unit:'تكلفة التذكرة' };
const OPS = {
  sum:      { label:'مجموع', f:'num' },
  avg:      { label:'متوسط', f:'num' },
  median:   { label:'وسيط', f:'num' },
  min:      { label:'أدنى', f:'num' },
  max:      { label:'أعلى', f:'num' },
  stdev:    { label:'انحراف معياري', f:'num' },
  share:    { label:'نسبة من الإجمالي', f:'num' },
  ratio:    { label:'تكلفة/تذكرة مرجّحة', f:'none' },
  count:    { label:'عدد الصفوف', f:'none' },
  distinct: { label:'عدد القيم المميزة', f:'all' },
  list:     { label:'قائمة القيم', f:'dim' }
};
const fieldLabel = f => DIMS[f] || MEAS[f] || '';
const autoLabel = a => {
  if (a.op === 'ratio') return 'تكلفة/تذكرة';
  if (a.op === 'count') return 'البنود';
  if (a.op === 'share') return 'حصة ' + fieldLabel(a.field);
  if (a.op === 'distinct') return 'عدد ' + ({ specialty:'التخصصات', doctor:'الأطباء', type:'الأنواع', pharmacy:'الصيدليات', area:'المناطق' }[a.field] || fieldLabel(a.field));
  if (a.op === 'list') return fieldLabel(a.field);
  if (a.op === 'sum') return fieldLabel(a.field);
  return OPS[a.op].label + ' ' + fieldLabel(a.field);
};
const kindOf = a => {
  if (a.op === 'count' || a.op === 'distinct') return 'int';
  if (a.op === 'share') return 'pct';
  if (a.op === 'list') return 'text';
  if (a.field === 'tickets' && (a.op === 'sum' || a.op === 'min' || a.op === 'max')) return 'int';
  return 'dec';
};
const fmtKind = (v, k) => k === 'int' ? fmt0(v) : k === 'pct' ? pct(v) : k === 'dec' ? fmt2(v) : (v == null || v === '' ? '' : String(v));
const rawKind = (v, k) => {
  if (v == null || v === '' || (typeof v === 'number' && !isFinite(v))) return '';
  if (k === 'int') return String(Math.round(v));
  if (k === 'dec') return v.toFixed(2);
  if (k === 'pct') return (v * 100).toFixed(1) + '%';
  return String(v);
};

let aggUid = 0;
const mkAgg = (op, field, label) => { const a = { id:'a' + (++aggUid), op, field, auto:!label }; a.label = label || autoLabel(a); return a; };
const DEFAULT_AGGS = () => [mkAgg('sum','cost'), mkAgg('sum','tickets'), mkAgg('ratio',null), mkAgg('share','cost'), mkAgg('count',null)];

const state = {
  pharmacies: [],
  isSample: true,
  source: null,
  prev: null,
  group: { keys:['specialty'], aggs: DEFAULT_AGGS(), subtotals:false, sort:null }
};
let pid = 0;

(function loadPrefs(){
  try {
    const g = JSON.parse(localStorage.getItem('bayan.group') || 'null');
    if (g && Array.isArray(g.keys) && Array.isArray(g.aggs) && g.aggs.length){
      state.group.keys = g.keys.filter(k => DIMS[k]);
      state.group.aggs = g.aggs.filter(a => OPS[a.op]).map(a => ({ ...mkAgg(a.op, a.field, a.label), auto: !!a.auto }));
      state.group.subtotals = !!g.subtotals;
    }
  } catch (e) {}
})();
const savePrefs = () => {
  try { localStorage.setItem('bayan.group', JSON.stringify({ keys:state.group.keys, aggs:state.group.aggs.map(a => ({ op:a.op, field:a.field, label:a.label, auto:a.auto })), subtotals:state.group.subtotals })); } catch (e) {}
};

const includedPh = () => state.pharmacies.filter(p => p.included);
const phCost = p => sum(p.rows, r => r.cost);
const phTickets = p => sum(p.rows, r => r.tickets);
const phLabel = n => n === 1 ? 'صيدلية واحدة' : n === 2 ? 'صيدليتان' : n + ' صيدليات';
const areaOf = p => (p.area || '').trim() || 'غير محددة';

function dataset(){
  const out = [];
  includedPh().forEach(p => p.rows.forEach(r => out.push({
    ...r, pharmacy:p.name, area:areaOf(p), pid:p.id,
    unit: r.tickets > 0 ? r.cost / r.tickets : null
  })));
  return out;
}

function groupBy(rows, key){
  const m = new Map();
  rows.forEach(r => { const k = r[key] || NA; if (!m.has(k)) m.set(k, []); m.get(k).push(r); });
  return [...m.entries()].map(([name, rs]) => ({ name, rows:rs, cost:sum(rs, r => r.cost), tickets:sum(rs, r => r.tickets) })).sort(byCost);
}

function compute(a, rows, totals){
  const f = a.field;
  if (a.op === 'count') return rows.length;
  if (a.op === 'ratio'){ const t = sum(rows, r => r.tickets); return t ? sum(rows, r => r.cost) / t : null; }
  if (a.op === 'distinct') return new Set(rows.map(r => r[f])).size;
  if (a.op === 'list') return [...new Set(rows.map(r => r[f]))].join('، ');
  const vals = rows.map(r => r[f]).filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const s = vals.reduce((x, y) => x + y, 0);
  switch (a.op){
    case 'sum': return s;
    case 'avg': return s / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'median': { const v = vals.slice().sort((x, y) => x - y), m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }
    case 'stdev': { if (vals.length < 2) return null; const mu = s / vals.length; return Math.sqrt(vals.reduce((x, v) => x + (v - mu) ** 2, 0) / (vals.length - 1)); }
    case 'share': { const t = totals[f]; return t ? s / t : null; }
  }
  return null;
}

function cmp(a, b){
  const an = typeof a === 'number', bn = typeof b === 'number';
  if (an && bn) return a - b;
  if (a == null || a === '') return 1;
  if (b == null || b === '') return -1;
  if (an) return -1;
  if (bn) return 1;
  return String(a).localeCompare(String(b), 'ar');
}

function groupModel(){
  const rows = dataset();
  const g = state.group;
  const keys = g.keys.slice();
  const aggs = g.aggs;
  const totals = { cost:sum(rows, r => r.cost), tickets:sum(rows, r => r.tickets), unit:sum(rows, r => r.unit) };
  const cols = keys.map(k => ({ label:DIMS[k], kind:'text', key:true })).concat(aggs.map(a => ({ label:a.label, kind:kindOf(a), op:a.op })));
  const vals = rs => aggs.map(a => compute(a, rs, totals));
  const buckets = new Map();
  rows.forEach(r => {
    const kv = keys.map(k => r[k] || NA);
    const id = kv.join('\u0001');
    if (!buckets.has(id)) buckets.set(id, { kv, rows:[] });
    buckets.get(id).rows.push(r);
  });
  let list = [...buckets.values()].map(b => ({ type:'row', cells:b.kv.concat(vals(b.rows)), n:b.rows.length, k0:b.kv[0] }));
  let sc = g.sort ? g.sort.col : -1, dir = g.sort ? g.sort.dir : -1;
  if (sc < 0 || sc >= cols.length){
    sc = cols.findIndex(c => !c.key && c.kind !== 'text');
    dir = -1;
    if (sc < 0){ sc = 0; dir = 1; }
  }
  const sorter = (x, y) => dir * cmp(x.cells[sc], y.cells[sc]) || cmp(x.cells[0], y.cells[0]);
  let out = [];
  if (g.subtotals && keys.length > 1){
    const lv = new Map();
    list.forEach(r => { if (!lv.has(r.k0)) lv.set(r.k0, []); lv.get(r.k0).push(r); });
    const tops = [...lv.entries()].map(([k0, children]) => {
      const rs = rows.filter(r => (r[keys[0]] || NA) === k0);
      return { type:'sub', cells:[k0].concat(keys.slice(1).map(() => '')).concat(vals(rs)), n:rs.length, children };
    });
    const topSort = sc < keys.length ? (x, y) => (sc === 0 ? dir : 1) * cmp(x.cells[0], y.cells[0]) : sorter;
    tops.sort(topSort).forEach(t => { out.push(t); t.children.sort(sorter).forEach(c => out.push({ ...c, type:'child' })); });
  } else {
    out = list.sort(sorter);
  }
  const total = keys.map((k, i) => i === 0 ? 'الإجمالي' : '').concat(vals(rows));
  if (!keys.length) total[0] = undefined;
  return { title:'التجميع' + (keys.length ? ': ' + keys.map(k => DIMS[k]).join(' › ') : ''), cols, rows:out, total: keys.length ? total : null, sort:{ col:sc, dir }, nRows:rows.length };
}

function pharmModel(){
  const list = state.pharmacies.filter(p => p.included);
  const G = sum(list, phCost);
  const cols = [
    { label:'الصيدلية', kind:'text' }, { label:'المنطقة', kind:'text' }, { label:'الموازنة', kind:'dec' },
    { label:'التذاكر', kind:'int' }, { label:'التكلفة', kind:'dec' }, { label:'تكلفة/تذكرة', kind:'dec' },
    { label:'الحصة', kind:'pct' }, { label:'تنفيذ الموازنة', kind:'pct' }
  ];
  const rows = list.map(p => {
    const c = phCost(p), t = phTickets(p);
    return { type:'row', cells:[p.name, p.area || '', p.budget, t, c, t ? c / t : null, G ? c / G : null, p.budget ? c / p.budget : null] };
  });
  const tb = sum(list, p => p.budget), tt = sum(list, phTickets);
  const withB = list.filter(p => p.budget);
  const total = ['الإجمالي', '', tb || null, tt, G, tt ? G / tt : null, G ? 1 : null, withB.length ? sum(withB, phCost) / sum(withB, p => p.budget) : null];
  return { title:'الصيدليات', cols, rows, total };
}

function detailModel(){
  const rows = dataset().sort(byCost);
  const T = sum(rows, r => r.cost);
  const multi = includedPh().length > 1;
  const cols = [{ label:'التخصص', kind:'text' }, { label:'الطبيب', kind:'text' }, { label:'نوع التذكرة', kind:'text' }]
    .concat(multi ? [{ label:'الصيدلية', kind:'text' }, { label:'المنطقة', kind:'text' }] : [])
    .concat([{ label:'التذاكر', kind:'int' }, { label:'التكلفة', kind:'dec' }, { label:'تكلفة/تذكرة', kind:'dec' }, { label:'الحصة', kind:'pct' }]);
  const out = rows.map(r => ({ type:'row', cells:[r.specialty, r.doctor, r.type].concat(multi ? [r.pharmacy, r.area] : []).concat([r.tickets, r.cost, r.unit, T ? r.cost / T : null]) }));
  const tt = sum(rows, r => r.tickets);
  const total = ['الإجمالي', '', ''].concat(multi ? ['', ''] : []).concat([tt, T, tt ? T / tt : null, T ? 1 : null]);
  return { title:'البنود التفصيلية', cols, rows:out, total };
}

function mixModel(){
  const rows = dataset();
  const T = sum(rows, r => r.cost), TT = sum(rows, r => r.tickets);
  const gs = groupBy(rows, 'type');
  return {
    title:'التوزيع حسب نوع التذكرة',
    cols:[{ label:'نوع التذكرة', kind:'text' }, { label:'التذاكر', kind:'int' }, { label:'التكلفة', kind:'dec' }, { label:'حصة التكلفة', kind:'pct' }, { label:'حصة التذاكر', kind:'pct' }, { label:'تكلفة/تذكرة', kind:'dec' }],
    rows: gs.map(g => ({ type:'row', cells:[g.name, g.tickets, g.cost, T ? g.cost / T : null, TT ? g.tickets / TT : null, g.tickets ? g.cost / g.tickets : null] })),
    total:['الإجمالي', TT, T, T ? 1 : null, TT ? 1 : null, TT ? T / TT : null]
  };
}

function kpiModel(){
  const rows = dataset();
  const inc = includedPh();
  const C = sum(rows, r => r.cost), TK = sum(rows, r => r.tickets);
  const hasT = rows.some(r => r.tickets != null);
  const units = rows.filter(r => r.tickets > 0).map(r => r.cost / r.tickets);
  const out = [
    { id:'cost', label:'إجمالي التكلفة', raw:C, kind:'dec', unit:'ج.م', foot: phLabel(inc.length) },
    { id:'tickets', label:'إجمالي التذاكر', raw:hasT ? TK : null, kind:'int', unit:hasT ? 'تذكرة' : '', foot: hasT ? new Set(rows.map(r => r.type)).size + ' أنواع' : 'لا يوجد عمود للعدد' },
    { id:'unit', label:'تكلفة التذكرة', raw:TK ? C / TK : null, kind:'dec', unit:TK ? 'ج.م' : '', foot: units.length ? 'المدى ' + fmt2(Math.min(...units)) + ' – ' + fmt2(Math.max(...units)) : '' },
    { id:'rows', label:'البنود', raw:rows.length, kind:'int', unit:'بند', foot: new Set(rows.map(r => r.specialty)).size + ' تخصصات · ' + new Set(rows.map(r => r.doctor)).size + ' أطباء' }
  ];
  const withB = inc.filter(p => p.budget);
  if (withB.length){
    const tb = sum(withB, p => p.budget), tc = sum(withB, phCost);
    out.push({ id:'budget', label:'تنفيذ الموازنة', raw:tb ? tc / tb : null, kind:'pct', unit:'', foot:'من ' + fmt2(tb) + ' ج.م', warn: tc > tb });
  }
  return out;
}

function factsModel(){
  const rows = dataset();
  const C = sum(rows, r => r.cost), TK = sum(rows, r => r.tickets);
  const out = [];
  if (!rows.length || !C) return out;
  const top = rows.slice().sort(byCost)[0];
  out.push({ k:'أعلى بند', v: top.doctor + ' · ' + top.type + ' · ' + top.specialty, n: fmt2(top.cost), s: pct(top.cost / C) });
  const sp = groupBy(rows, 'specialty');
  if (sp.length > 1) out.push({ k:'أعلى تخصص', v: sp[0].name, n: fmt2(sp[0].cost), s: pct(sp[0].cost / C) });
  const ty = groupBy(rows, 'type');
  if (ty.length > 1) out.push({ k:'أعلى نوع تذكرة', v: ty[0].name, n: fmt2(ty[0].cost), s: pct(ty[0].cost / C) });
  if (TK){
    const avg = C / TK;
    const u = ty.filter(g => g.tickets > 0).map(g => ({ ...g, u: g.cost / g.tickets })).sort((a, b) => b.u - a.u);
    if (u.length > 1) out.push({ k:'أعلى تكلفة/تذكرة', v: u[0].name, n: fmt2(u[0].u), s: '×' + (u[0].u / avg).toFixed(1) + ' من المتوسط' });
  }
  if (rows.length > 4){
    const k = Math.max(1, Math.ceil(rows.length * 0.2));
    const s = sum(rows.slice().sort(byCost).slice(0, k), r => r.cost);
    out.push({ k:'التركّز', v: 'أعلى ' + k + ' من ' + rows.length + ' بنود', n: pct(s / C), s: 'من التكلفة' });
  }
  const ph = groupBy(rows, 'pharmacy');
  if (ph.length > 1) out.push({ k:'أعلى صيدلية', v: ph[0].name, n: fmt2(ph[0].cost), s: pct(ph[0].cost / C) });
  const ar = groupBy(rows, 'area').filter(g => g.name !== 'غير محددة');
  if (ar.length > 1) out.push({ k:'أعلى منطقة', v: ar[0].name, n: fmt2(ar[0].cost), s: pct(ar[0].cost / C) });
  const withB = includedPh().filter(p => p.budget);
  if (withB.length){
    const over = withB.filter(p => phCost(p) > p.budget);
    if (over.length) out.push({ k:'تجاوز الموازنة', v: over.map(p => p.name).join('، '), n: String(over.length), s: 'من ' + withB.length, warn:true });
    else out.push({ k:'الموازنة', v:'كل الصيدليات ضمن الموازنة', n: pct(sum(withB, phCost) / sum(withB, p => p.budget)), s:'تنفيذ' });
  }
  return out;
}

function metaInfo(){
  const inc = includedPh();
  const multi = inc.length > 1;
  const from = inc.map(p => p.from).filter(Boolean).sort()[0];
  const to = inc.map(p => p.to).filter(Boolean).sort().pop();
  const printed = inc.map(p => p.printed).filter(Boolean).sort().pop();
  const areas = [...new Set(inc.map(p => (p.area || '').trim()).filter(Boolean))];
  const title = multi ? 'التكلفة الموحدة بالتخصص' : 'التكلفة الشهرية بالتخصص';
  const sub = multi ? phLabel(inc.length) + (areas.length ? ' · ' + areas.length + (areas.length === 1 ? ' منطقة' : ' مناطق') : '') : (inc[0] ? inc[0].name + (inc[0].area ? ' · ' + inc[0].area : '') : '');
  return { title, sub, from, to, printed, source:state.source, multi };
}

function tsvOf(m){
  const line = cells => cells.map((v, i) => rawKind(v, m.cols[i].kind).replace(/[\t\n\r]+/g, ' ')).join('\t');
  const out = [m.cols.map(c => c.label).join('\t')];
  m.rows.forEach(r => out.push(line(r.cells)));
  if (m.total) out.push(line(m.total));
  return out.join('\n');
}

function renderHero(){
  const mi = metaInfo();
  const meta = [];
  if (mi.from && mi.to) meta.push('<span>' + nsp(esc(mi.from)) + ' ← ' + nsp(esc(mi.to)) + '</span>');
  if (mi.printed) meta.push('<span>طُبع ' + nsp(esc(mi.printed)) + '</span>');
  if (mi.source) meta.push('<span>' + esc(mi.source) + '</span>');
  $('#hero').innerHTML = '<div class="hero-main"><p class="org">' + esc(ORG) + '</p><h1>' + esc(mi.title) + '</h1><p class="sub">' + esc(mi.sub) + '</p>' +
    (meta.length ? '<p class="meta">' + meta.join('<span class="dotsep"></span>') + '</p>' : '') + '</div>';
}

const ICON_COPY = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

function renderStats(){
  $('#stats').innerHTML = kpiModel().map(c =>
    '<button class="card stat" data-kpi="' + c.id + '" title="نسخ">' +
      '<span class="cp">' + ICON_COPY + '</span>' +
      '<span class="label">' + esc(c.label) + '</span>' +
      '<span class="value"><span class="num">' + fmtKind(c.raw, c.kind) + '</span>' + (c.unit ? '<span class="unit">' + esc(c.unit) + '</span>' : '') + '</span>' +
      '<span class="foot">' + (c.foot ? '<span class="num">' + esc(c.foot) + '</span>' : '') + (c.warn ? '<span class="chip warn">تجاوز</span>' : '') + '</span>' +
    '</button>'
  ).join('');
}

function renderFacts(){
  const f = factsModel();
  $('#facts').innerHTML = f.length ? f.map((x, i) =>
    '<div class="fact' + (x.warn ? ' warn' : '') + '" data-fact="' + i + '" title="نسخ"><span class="k">' + esc(x.k) + '</span><span class="v">' + esc(x.v) + '</span>' +
    '<span class="n">' + nsp(esc(x.n)) + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</span></div>'
  ).join('') : '<div class="empty">لا توجد بيانات مشمولة.</div>';
}

const MIX_COLORS = ['#44729f','#7ba7d4','#a9c6e4','#8d9db1','#c9d9ea','#5f86ad','#b5c3d2'];
function renderMix(){
  const rows = dataset();
  const T = sum(rows, r => r.cost);
  if (!T){ $('#mix').innerHTML = ''; return; }
  const segs = groupBy(rows, 'type').map((g, i) => ({ name:g.name, p:g.cost / T * 100, c:MIX_COLORS[i % MIX_COLORS.length] }));
  $('#mix').innerHTML = '<h3>التكلفة حسب نوع التذكرة</h3><div class="mixbar">' +
    segs.map(s => '<span style="width:' + s.p.toFixed(2) + '%;background:' + s.c + '" title="' + esc(s.name) + '"></span>').join('') +
    '</div><div class="mixlegend">' + segs.map(s => '<span class="it"><span class="dot" style="background:' + s.c + '"></span>' + esc(s.name) + ' <b>' + nsp(s.p.toFixed(1) + '%') + '</b></span>').join('') + '</div>';
}

const shareCell = r => {
  const p = r == null || !isFinite(r) ? 0 : Math.max(0, Math.min(100, r * 100));
  return '<span class="share"><span class="share-track"><span class="share-fill" style="width:' + p.toFixed(1) + '%"></span></span><span class="share-val num">' + pct(r) + '</span></span>';
};

function renderPharmacies(){
  const list = state.pharmacies;
  $('#pharm-card').style.display = list.length ? '' : 'none';
  if (!list.length) return;
  const G = sum(includedPh(), phCost);
  const changed = list.some(p => p.name !== p.origName || (p.area || '') !== (p.origArea || ''));
  $('#btn-restore-all').hidden = !changed;
  $('#ph-body').innerHTML = list.map(p => {
    const c = phCost(p), t = phTickets(p);
    const over = p.budget && c > p.budget;
    const nCh = p.name !== p.origName, aCh = (p.area || '') !== (p.origArea || '');
    return '<tr class="row' + (p.included ? '' : ' excluded') + '">' +
      '<td><span class="cellx"><span class="edit" contenteditable="true" spellcheck="false" data-p="' + p.id + '" data-f="name">' + esc(p.name) + '</span>' +
        (nCh || aCh ? '<button class="icon-btn sm plain" data-restore="' + p.id + '" title="استعادة الأصل">↺</button>' : '') + '</span>' +
        (nCh ? '<span class="orig">الأصل: ' + esc(p.origName) + '</span>' : '') + '</td>' +
      '<td><span class="edit" contenteditable="true" spellcheck="false" data-p="' + p.id + '" data-f="area">' + esc(p.area) + '</span>' +
        (aCh ? '<span class="orig">الأصل: ' + esc(p.origArea || '—') + '</span>' : '') + '</td>' +
      '<td class="td-num"><span class="edit" contenteditable="true" spellcheck="false" data-p="' + p.id + '" data-f="budget">' + (p.budget != null ? fmt2(p.budget) : '') + '</span>' +
        (p.budget ? '<span class="bmeta">' + pct(c / p.budget) + (over ? ' · تجاوز' : '') + '</span>' : '') + '</td>' +
      '<td class="td-num">' + fmt0(t) + '</td>' +
      '<td class="td-num">' + fmt2(c) + '</td>' +
      '<td class="td-num">' + (t ? fmt2(c / t) : '—') + '</td>' +
      '<td class="td-num">' + (p.included && G ? shareCell(c / G) : '<span style="color:var(--faint)">—</span>') + '</td>' +
      '<td><button class="switch ' + (p.included ? 'on' : 'off') + '" data-toggle="' + p.id + '">' + (p.included ? 'مشمولة' : 'مستبعدة') + '</button></td>' +
    '</tr>';
  }).join('');
}

function renderBuilder(){
  const g = state.group;
  const free = Object.keys(DIMS).filter(k => !g.keys.includes(k));
  $('#keys').innerHTML = g.keys.map((k, i) =>
    '<span class="key"><span class="ord num">' + (i + 1) + '</span>' + esc(DIMS[k]) +
    (i > 0 ? '<button class="chip-btn" data-kmove="' + i + '" data-d="-1" title="تقديم">›</button>' : '') +
    (i < g.keys.length - 1 ? '<button class="chip-btn" data-kmove="' + i + '" data-d="1" title="تأخير">‹</button>' : '') +
    '<button class="chip-btn" data-kdel="' + i + '" title="إزالة">✕</button></span>'
  ).join('') + (free.length ? '<select class="sel" id="key-add" aria-label="إضافة عمود"><option value="">+ عمود</option>' + free.map(k => '<option value="' + k + '">' + DIMS[k] + '</option>').join('') + '</select>' : '') +
    (g.keys.length ? '' : '<span class="hint">بدون تجميع: صف إجمالي واحد</span>');

  $('#aggs').innerHTML = g.aggs.map(a => {
    const spec = OPS[a.op].f;
    const fields = spec === 'num' ? MEAS : spec === 'dim' ? DIMS : spec === 'all' ? { ...DIMS, ...MEAS } : null;
    return '<div class="agg" data-agg="' + a.id + '">' +
      '<input class="inp" data-af="label" value="' + esc(a.label) + '" aria-label="اسم العمود">' +
      '<select data-af="op" aria-label="العملية">' + Object.entries(OPS).map(([k, o]) => '<option value="' + k + '"' + (k === a.op ? ' selected' : '') + '>' + o.label + '</option>').join('') + '</select>' +
      '<select data-af="field" aria-label="الحقل"' + (fields ? '' : ' disabled') + '>' + (fields ? Object.entries(fields).map(([k, l]) => '<option value="' + k + '"' + (k === a.field ? ' selected' : '') + '>' + l + '</option>').join('') : '<option>—</option>') + '</select>' +
      '<button class="chip-btn" data-adel="' + a.id + '" title="حذف"' + (g.aggs.length < 2 ? ' disabled style="visibility:hidden"' : '') + '>✕</button>' +
    '</div>';
  }).join('');

  const multi = includedPh().length > 1;
  const areas = new Set(includedPh().map(areaOf)).size > 1;
  const presets = [
    ['التخصص', ['specialty']],
    ['الطبيب', ['doctor']],
    ['النوع', ['type']],
    ['التخصص › الطبيب', ['specialty', 'doctor']],
    ['الطبيب › النوع', ['doctor', 'type']]
  ];
  if (multi) presets.push(['الصيدلية', ['pharmacy']], ['الصيدلية › التخصص', ['pharmacy', 'specialty']]);
  if (areas) presets.push(['المنطقة', ['area']], ['المنطقة › الصيدلية', ['area', 'pharmacy']]);
  presets.push(['تفصيلي', ['specialty', 'doctor', 'type'].concat(multi ? ['pharmacy'] : [])]);
  $('#presets').innerHTML = '<span class="lbl">جاهز:</span>' + presets.map((p, i) => '<button class="pill" data-preset="' + esc(JSON.stringify(p[1])) + '">' + esc(p[0]) + '</button>').join('') +
    '<button class="pill" id="btn-reset-aggs" title="العمليات الافتراضية">↺ العمليات</button>';
  $('#opt-sub').checked = g.subtotals;
  $('#sub-toggle').style.display = g.keys.length > 1 ? '' : 'none';
}

let lastGroup = null;
function renderGroup(){
  const m = groupModel();
  lastGroup = m;
  const nk = state.group.keys.length;
  $('#g-head').innerHTML = m.cols.map((c, i) =>
    '<th class="sortable' + (c.kind !== 'text' ? ' th-num' : '') + '" data-sort="' + i + '">' + esc(c.label) +
    (m.sort.col === i ? '<span class="arr">' + (m.sort.dir < 0 ? '▼' : '▲') + '</span>' : '') + '</th>'
  ).join('');
  const cell = (v, c, i, row) => {
    if (c.kind === 'text'){
      const blank = row.type === 'child' && i === 0;
      return '<td' + (blank ? ' style="color:var(--faint)"' : '') + '>' + (blank ? '' : esc(v)) + (row.type === 'sub' && i === 0 ? '<span class="gcount">' + row.n + '</span>' : '') + '</td>';
    }
    if (c.op === 'share') return '<td class="td-num" data-raw="' + esc(rawKind(v, c.kind)) + '">' + shareCell(v) + '</td>';
    return '<td class="td-num" data-raw="' + esc(rawKind(v, c.kind)) + '">' + fmtKind(v, c.kind) + '</td>';
  };
  if (!m.nRows){
    $('#g-body').innerHTML = '<tr><td colspan="' + m.cols.length + '"><div class="empty">لا توجد بنود مشمولة.</div></td></tr>';
    $('#g-foot').innerHTML = '';
  } else {
    const body = nk ? m.rows : [{ type:'row', cells:groupModelAllRow(m) }];
    $('#g-body').innerHTML = body.map(r => '<tr class="' + (r.type === 'sub' ? 'sub' : 'row' + (r.type === 'child' ? ' child' : '')) + '">' + r.cells.map((v, i) => cell(v, m.cols[i], i, r)).join('') + '</tr>').join('');
    $('#g-foot').innerHTML = m.total ? m.total.map((v, i) => {
      const c = m.cols[i];
      if (c.kind === 'text') return '<td>' + esc(v || '') + '</td>';
      if (c.op === 'list') return '<td></td>';
      return '<td class="td-num" data-raw="' + esc(rawKind(v, c.kind)) + '">' + fmtKind(v, c.kind) + '</td>';
    }).join('') : '';
  }
  const groups = m.rows.filter(r => r.type !== 'sub').length;
  $('#g-meta').textContent = nk ? groups + ' مجموعة من ' + m.nRows + ' بند · انقر رأس العمود للفرز وأي رقم لنسخه' : m.nRows + ' بند';
}
const groupModelAllRow = m => m.rows.length ? m.rows[0].cells : [];

function renderAll(){
  renderHero();
  renderStats();
  renderFacts();
  renderMix();
  renderPharmacies();
  renderBuilder();
  renderGroup();
}

let toastTimer;
function toast(msg){
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1600);
}

let noticeTimer;
function notify(msg, isErr, withUndo){
  clearTimeout(noticeTimer);
  $('#notice-slot').innerHTML = '<div class="notice' + (isErr ? ' err' : '') + '"><span>' + esc(msg) + '</span>' + (withUndo ? '<button class="undo" id="btn-undo">تراجع</button>' : '') + '</div>';
  const u = $('#btn-undo');
  if (u) u.addEventListener('click', () => {
    if (state.prev){ Object.assign(state, state.prev); state.prev = null; renderAll(); }
    $('#notice-slot').innerHTML = '';
  });
  noticeTimer = setTimeout(() => { $('#notice-slot').innerHTML = ''; }, 7000);
}

function fallbackCopy(text, html){
  const ok = (() => {
    if (html){
      const d = document.createElement('div');
      d.contentEditable = 'true';
      d.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      d.innerHTML = html;
      document.body.appendChild(d);
      const r = document.createRange(); r.selectNodeContents(d);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      let res = false; try { res = document.execCommand('copy'); } catch (e) {}
      s.removeAllRanges(); d.remove();
      return res;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let res = false; try { res = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return res;
  })();
  return ok;
}
async function copy(text, html, msg){
  let ok = false;
  try {
    if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type:'text/plain' }), 'text/html': new Blob([html], { type:'text/html' }) })]);
      ok = true;
    } else if (navigator.clipboard && navigator.clipboard.writeText){
      await navigator.clipboard.writeText(text);
      ok = true;
    }
  } catch (e) {}
  if (!ok) ok = fallbackCopy(text, html);
  toast(ok ? (msg || 'تم النسخ') : 'تعذر النسخ');
  return ok;
}
function flash(btn){
  if (!btn) return;
  btn.classList.add('done');
  setTimeout(() => btn.classList.remove('done'), 1200);
}

const factLine = f => f.k + ': ' + f.v + ' — ' + f.n + (f.s ? ' (' + f.s + ')' : '');
const kpiLine = c => c.label + ': ' + fmtKind(c.raw, c.kind) + (c.unit ? ' ' + c.unit : '');

const SECTIONS = [
  { id:'kpis', label:'المؤشرات', desc:'الأرقام الرئيسية' },
  { id:'facts', label:'الملاحظات', desc:'نقاط مختصرة' },
  { id:'mix', label:'نوع التذكرة', desc:'التوزيع والحصص' },
  { id:'pharm', label:'الصيدليات', desc:'لكل صيدلية' },
  { id:'group', label:'التجميع', desc:'حسب الإعداد الحالي' },
  { id:'detail', label:'البنود', desc:'كل الصفوف' }
];
const FORMATS = [
  { id:'print', label:'طباعة / PDF', desc:'تقرير منسق A4' },
  { id:'xlsx', label:'Excel', desc:'ورقة لكل قسم' },
  { id:'copy', label:'نسخ', desc:'يُلصق منسقًا في Word والبريد' },
  { id:'html', label:'ملف HTML', desc:'للمشاركة والأرشفة' }
];
let exportPrefs = { format:'print', sections:['kpis', 'facts', 'pharm', 'group'], title:'' };
try { const e = JSON.parse(localStorage.getItem('bayan.export') || 'null'); if (e && e.format) exportPrefs = { ...exportPrefs, ...e, title:'' }; } catch (e) {}

function sectionModels(ids){
  const out = {};
  ids.forEach(id => {
    if (id === 'kpis') out.kpis = kpiModel();
    if (id === 'facts') out.facts = factsModel();
    if (id === 'mix') out.mix = mixModel();
    if (id === 'pharm') out.pharm = pharmModel();
    if (id === 'group') out.group = groupModel();
    if (id === 'detail') out.detail = detailModel();
  });
  return out;
}

function reportText(ids, title){
  const mi = metaInfo();
  const S = sectionModels(ids);
  const L = [title || mi.title, [mi.sub, mi.from && mi.to ? mi.from + ' → ' + mi.to : ''].filter(Boolean).join(' · ')];
  if (S.kpis){ L.push('', 'المؤشرات'); S.kpis.forEach(c => L.push(kpiLine(c))); }
  if (S.facts && S.facts.length){ L.push('', 'الملاحظات'); S.facts.forEach(f => L.push('• ' + factLine(f))); }
  ['mix', 'pharm', 'group', 'detail'].forEach(k => { if (S[k] && S[k].rows.length){ L.push('', S[k].title, tsvOf(S[k])); } });
  return L.join('\n');
}

const RS = {
  wrap:'font-family:\'IBM Plex Sans Arabic\',\'Segoe UI\',Tahoma,Arial,sans-serif;color:#22364a;direction:rtl;text-align:right;font-size:10.5pt;line-height:1.55',
  org:'font-size:9pt;color:#687d93;margin:0',
  h1:'font-size:17pt;font-weight:700;margin:2px 0 0;color:#22364a',
  sub:'font-size:10.5pt;color:#44729f;margin:2px 0 0;font-weight:600',
  meta:'font-size:9pt;color:#687d93;margin:4px 0 0',
  rule:'border:none;border-top:2px solid #44729f;margin:10px 0 12px',
  h2:'font-size:11.5pt;font-weight:700;margin:16px 0 6px;color:#22364a',
  table:'width:100%;border-collapse:collapse;font-size:9.5pt',
  th:'background:#edf3f9;color:#43586e;font-weight:600;text-align:right;padding:5px 8px;border-bottom:1px solid #c3d7ec;white-space:nowrap',
  td:'padding:4px 8px;border-bottom:1px solid #e6ecf3;text-align:right',
  num:'text-align:left;direction:ltr;white-space:nowrap',
  subrow:'background:#f6f9fc;font-weight:600',
  foot:'background:#edf3f9;font-weight:700;border-top:1px solid #c3d7ec',
  kpiCell:'border:1px solid #dfe7f0;padding:7px 10px;vertical-align:top;width:20%',
  kpiL:'font-size:8.5pt;color:#687d93;display:block',
  kpiV:'font-size:13pt;font-weight:700;color:#44729f;direction:ltr;unicode-bidi:isolate',
  kpiU:'font-size:8.5pt;color:#687d93;font-weight:500',
  end:'margin-top:14px;font-size:8pt;color:#9fb0c2;text-align:center'
};

function tableHTML(m){
  const td = (v, c, extra) => '<td style="' + RS.td + ';' + (c.kind !== 'text' ? RS.num : '') + (extra ? ';' + extra : '') + '">' + esc(fmtKind(v, c.kind)) + '</td>';
  return '<table style="' + RS.table + '"><thead><tr>' + m.cols.map(c => '<th style="' + RS.th + (c.kind !== 'text' ? ';text-align:left' : '') + '">' + esc(c.label) + '</th>').join('') + '</tr></thead><tbody>' +
    m.rows.map(r => '<tr>' + r.cells.map((v, i) => td(v, m.cols[i], r.type === 'sub' ? RS.subrow : '')).join('') + '</tr>').join('') + '</tbody>' +
    (m.total ? '<tfoot><tr>' + m.total.map((v, i) => td(m.cols[i].op === 'list' ? '' : v, m.cols[i], RS.foot)).join('') + '</tr></tfoot>' : '') + '</table>';
}

function reportHTML(ids, title){
  const mi = metaInfo();
  const S = sectionModels(ids);
  const meta = [mi.from && mi.to ? 'الفترة ' + mi.from + ' ← ' + mi.to : '', mi.printed ? 'طُبع ' + mi.printed : '', 'أُعدّ ' + today()].filter(Boolean).join(' · ');
  let h = '<div style="' + RS.wrap + '" dir="rtl">' +
    '<p style="' + RS.org + '">' + esc(ORG) + '</p><h1 style="' + RS.h1 + '">' + esc(title || mi.title) + '</h1>' +
    (mi.sub ? '<p style="' + RS.sub + '">' + esc(mi.sub) + '</p>' : '') + '<p style="' + RS.meta + '">' + esc(meta) + '</p><hr style="' + RS.rule + '">';
  if (S.kpis){
    h += '<table style="' + RS.table + ';border-collapse:separate;border-spacing:6px 0;margin:0 -6px"><tr>' + S.kpis.map(c =>
      '<td style="' + RS.kpiCell + '"><span style="' + RS.kpiL + '">' + esc(c.label) + '</span><span style="' + RS.kpiV + '">' + esc(fmtKind(c.raw, c.kind)) + '</span> <span style="' + RS.kpiU + '">' + esc(c.unit || '') + '</span></td>'
    ).join('') + '</tr></table>';
  }
  if (S.facts && S.facts.length){
    h += '<h2 style="' + RS.h2 + '">الملاحظات</h2><table style="' + RS.table + '">' + S.facts.map(f =>
      '<tr><td style="' + RS.td + ';color:#687d93;width:22%">' + esc(f.k) + '</td><td style="' + RS.td + '">' + esc(f.v) + '</td><td style="' + RS.td + ';' + RS.num + ';font-weight:600;color:' + (f.warn ? '#a8604a' : '#44729f') + '">' + esc(f.n) + (f.s ? ' <span style="color:#687d93;font-weight:500">' + esc(f.s) + '</span>' : '') + '</td></tr>'
    ).join('') + '</table>';
  }
  ['mix', 'pharm', 'group', 'detail'].forEach(k => {
    if (S[k] && S[k].rows.length) h += '<h2 style="' + RS.h2 + '">' + esc(S[k].title) + '</h2>' + tableHTML(S[k]);
  });
  h += '<p style="' + RS.end + '">بيان · ' + esc(today()) + '</p></div>';
  return h;
}

function doPrint(ids, title){
  const r = $('#report');
  r.innerHTML = reportHTML(ids, title);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); r.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => { window.print(); setTimeout(done, 500); }, 60);
}

function download(name, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

function doHTML(ids, title){
  const mi = metaInfo();
  const doc = '<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title || mi.title) + '</title>' +
    '<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">' +
    '<style>body{margin:0;background:#eef2f7;padding:24px}main{max-width:960px;margin:0 auto;background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 10px 28px rgba(23,48,77,.06)}@media print{body{background:#fff;padding:0}main{box-shadow:none;padding:0}}</style>' +
    '</head><body><main>' + reportHTML(ids, title) + '</main></body></html>';
  download('بيان-' + today() + '.html', new Blob([doc], { type:'text/html;charset=utf-8' }));
}

function doXLSX(ids, title){
  if (typeof XLSX === 'undefined'){ notify('مكتبة Excel غير محملة.', true); return; }
  const mi = metaInfo();
  const S = sectionModels(ids);
  const wb = XLSX.utils.book_new();
  const font = 'Arial';
  const st = {
    title:{ font:{ name:font, sz:14, bold:true, color:{ rgb:'22364A' } }, alignment:{ horizontal:'right' } },
    sub:{ font:{ name:font, sz:10, color:{ rgb:'687D93' } }, alignment:{ horizontal:'right' } },
    head:{ font:{ name:font, sz:10, bold:true, color:{ rgb:'43586E' } }, fill:{ fgColor:{ rgb:'EDF3F9' } }, border:{ bottom:{ style:'thin', color:{ rgb:'C3D7EC' } } }, alignment:{ horizontal:'right', vertical:'center' } },
    cell:{ font:{ name:font, sz:10, color:{ rgb:'22364A' } }, border:{ bottom:{ style:'hair', color:{ rgb:'E6ECF3' } } }, alignment:{ horizontal:'right' } },
    sub2:{ font:{ name:font, sz:10, bold:true, color:{ rgb:'22364A' } }, fill:{ fgColor:{ rgb:'F6F9FC' } }, alignment:{ horizontal:'right' } },
    foot:{ font:{ name:font, sz:10, bold:true, color:{ rgb:'44729F' } }, fill:{ fgColor:{ rgb:'EDF3F9' } }, border:{ top:{ style:'thin', color:{ rgb:'C3D7EC' } } }, alignment:{ horizontal:'right' } },
    key:{ font:{ name:font, sz:10, color:{ rgb:'687D93' } }, alignment:{ horizontal:'right' } },
    val:{ font:{ name:font, sz:11, bold:true, color:{ rgb:'44729F' } }, alignment:{ horizontal:'right' } }
  };
  const Z = { int:'#,##0', dec:'#,##0.00', pct:'0.0%' };
  const mk = (v, kind, s) => {
    if (kind !== 'text' && typeof v === 'number' && isFinite(v)) return { v, t:'n', z:Z[kind], s };
    return { v: v == null ? '' : String(v), t:'s', s };
  };
  const addSheet = (name, aoa, widths) => {
    const ws = {};
    let maxC = 0;
    aoa.forEach((row, r) => { row.forEach((c, ci) => { if (c) ws[XLSX.utils.encode_cell({ r, c:ci })] = c; }); maxC = Math.max(maxC, row.length); });
    ws['!ref'] = XLSX.utils.encode_range({ s:{ r:0, c:0 }, e:{ r:Math.max(0, aoa.length - 1), c:Math.max(0, maxC - 1) } });
    ws['!cols'] = widths.map(w => ({ wch:w }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };
  const head = () => [[mk(title || mi.title, 'text', st.title)], [mk([mi.sub, mi.from && mi.to ? mi.from + ' → ' + mi.to : ''].filter(Boolean).join(' · '), 'text', st.sub)], []];
  const tableAoa = m => {
    const aoa = head();
    aoa.push(m.cols.map(c => mk(c.label, 'text', st.head)));
    m.rows.forEach(r => aoa.push(r.cells.map((v, i) => mk(v, m.cols[i].kind, r.type === 'sub' ? st.sub2 : st.cell))));
    if (m.total) aoa.push(m.total.map((v, i) => mk(m.cols[i].op === 'list' ? '' : v, m.cols[i].kind, st.foot)));
    return aoa;
  };
  const widthsOf = m => m.cols.map((c, i) => {
    const longest = Math.max(c.label.length, ...m.rows.map(r => String(fmtKind(r.cells[i], c.kind)).length));
    return Math.min(48, Math.max(10, longest + 3));
  });
  if (S.kpis || (S.facts && S.facts.length)){
    const aoa = head();
    if (S.kpis){ aoa.push([mk('المؤشر', 'text', st.head), mk('القيمة', 'text', st.head), mk('الوحدة', 'text', st.head)]); S.kpis.forEach(c => aoa.push([mk(c.label, 'text', st.key), mk(c.raw, c.kind, st.val), mk(c.unit || '', 'text', st.key)])); aoa.push([]); }
    if (S.facts && S.facts.length){ aoa.push([mk('الملاحظة', 'text', st.head), mk('البيان', 'text', st.head), mk('القيمة', 'text', st.head), mk('', 'text', st.head)]); S.facts.forEach(f => aoa.push([mk(f.k, 'text', st.key), mk(f.v, 'text', st.cell), mk(f.n, 'text', st.val), mk(f.s || '', 'text', st.key)])); }
    addSheet('الملخص', aoa, [22, 44, 16, 18]);
  }
  [['mix', 'نوع التذكرة'], ['pharm', 'الصيدليات'], ['group', 'التجميع'], ['detail', 'البنود']].forEach(([k, n]) => {
    if (S[k]) addSheet(n, tableAoa(S[k]), widthsOf(S[k]));
  });
  if (!wb.SheetNames.length){ notify('لم يتم اختيار أي قسم.', true); return; }
  wb.Workbook = { Views:[{ RTL:true }] };
  XLSX.writeFile(wb, 'بيان-' + today() + '.xlsx');
}

function runExport(fmt, ids, title){
  if (!ids.length){ toast('اختر قسمًا واحدًا على الأقل'); return; }
  if (fmt === 'print') doPrint(ids, title);
  else if (fmt === 'xlsx') doXLSX(ids, title);
  else if (fmt === 'html') doHTML(ids, title);
  else copy(reportText(ids, title), reportHTML(ids, title), 'تم نسخ التقرير');
}

function openOverlay(id){ $(id).classList.add('show'); }
function closeOverlay(el){ (el || $$('.overlay.show').pop())?.classList.remove('show'); }

function renderExport(){
  $('#ex-format').innerHTML = FORMATS.map(f => '<label class="ex-opt' + (exportPrefs.format === f.id ? ' on' : '') + '"><input type="radio" name="exf" value="' + f.id + '"' + (exportPrefs.format === f.id ? ' checked' : '') + '><div><b>' + f.label + '</b><span>' + f.desc + '</span></div></label>').join('');
  $('#ex-sections').innerHTML = SECTIONS.map(s => { const on = exportPrefs.sections.includes(s.id); return '<label class="ex-opt' + (on ? ' on' : '') + '"><input type="checkbox" value="' + s.id + '"' + (on ? ' checked' : '') + '><div><b>' + s.label + '</b><span>' + s.desc + '</span></div></label>'; }).join('');
  $('#ex-go').textContent = exportPrefs.format === 'copy' ? 'نسخ' : exportPrefs.format === 'print' ? 'طباعة' : 'تنزيل';
}
$('#btn-export').addEventListener('click', () => {
  $('#ex-title').value = exportPrefs.title || metaInfo().title;
  renderExport();
  openOverlay('#ov-export');
});
$('#ex-format').addEventListener('change', e => { exportPrefs.format = e.target.value; renderExport(); });
$('#ex-sections').addEventListener('change', () => { exportPrefs.sections = $$('#ex-sections input:checked').map(i => i.value); renderExport(); });
$('#ex-go').addEventListener('click', () => {
  const title = $('#ex-title').value.trim();
  exportPrefs.title = title !== metaInfo().title ? title : '';
  try { localStorage.setItem('bayan.export', JSON.stringify({ format:exportPrefs.format, sections:exportPrefs.sections })); } catch (e) {}
  const fmt = exportPrefs.format;
  if (fmt !== 'copy') closeOverlay($('#ov-export'));
  runExport(fmt, SECTIONS.map(s => s.id).filter(id => exportPrefs.sections.includes(id)), title);
});
$('#btn-copy-report').addEventListener('click', e => {
  const ids = SECTIONS.map(s => s.id).filter(id => exportPrefs.sections.includes(id));
  copy(reportText(ids.length ? ids : ['kpis', 'facts', 'group']), reportHTML(ids.length ? ids : ['kpis', 'facts', 'group']), 'تم نسخ التقرير');
  flash(e.currentTarget);
});

document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (b){
    const k = b.dataset.copy;
    if (k === 'facts'){ const f = factsModel(); copy(f.map(factLine).join('\n'), null, 'تم نسخ الملاحظات'); }
    if (k === 'pharm') copy(tsvOf(pharmModel()), tableHTML(pharmModel()), 'تم نسخ الجدول');
    if (k === 'group'){ const m = groupModel(); copy(tsvOf(m), tableHTML(m), 'تم نسخ الجدول'); }
    flash(b);
    return;
  }
  const kpi = e.target.closest('[data-kpi]');
  if (kpi){ const c = kpiModel().find(x => x.id === kpi.dataset.kpi); if (c) copy(kpiLine(c)); return; }
  const fact = e.target.closest('[data-fact]');
  if (fact){ const f = factsModel()[+fact.dataset.fact]; if (f) copy(factLine(f)); return; }
  if (e.target.closest('[data-close]')){ closeOverlay(e.target.closest('.overlay')); return; }
});
$$('.overlay').forEach(o => o.addEventListener('click', e => { if (e.target === o) closeOverlay(o); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });

$('#keys').addEventListener('click', e => {
  const g = state.group;
  const mv = e.target.closest('[data-kmove]');
  const dl = e.target.closest('[data-kdel]');
  if (mv){ const i = +mv.dataset.kmove, j = i + +mv.dataset.d; [g.keys[i], g.keys[j]] = [g.keys[j], g.keys[i]]; }
  else if (dl) g.keys.splice(+dl.dataset.kdel, 1);
  else return;
  g.sort = null; savePrefs(); renderBuilder(); renderGroup();
});
$('#keys').addEventListener('change', e => {
  if (e.target.id !== 'key-add' || !e.target.value) return;
  state.group.keys.push(e.target.value);
  state.group.sort = null; savePrefs(); renderBuilder(); renderGroup();
});
$('#aggs').addEventListener('input', e => {
  if (e.target.dataset.af !== 'label') return;
  const a = state.group.aggs.find(x => x.id === e.target.closest('[data-agg]').dataset.agg);
  a.label = e.target.value || autoLabel(a);
  a.auto = !e.target.value;
  savePrefs(); renderGroup();
});
$('#aggs').addEventListener('change', e => {
  const af = e.target.dataset.af;
  if (af !== 'op' && af !== 'field') return;
  const a = state.group.aggs.find(x => x.id === e.target.closest('[data-agg]').dataset.agg);
  a[af] = e.target.value;
  const spec = OPS[a.op].f;
  if (spec === 'num' && !MEAS[a.field]) a.field = 'cost';
  if (spec === 'dim' && !DIMS[a.field]) a.field = 'doctor';
  if (spec === 'all' && !MEAS[a.field] && !DIMS[a.field]) a.field = 'doctor';
  if (spec === 'none') a.field = null;
  if (a.auto) a.label = autoLabel(a);
  savePrefs(); renderBuilder(); renderGroup();
});
$('#aggs').addEventListener('click', e => {
  const d = e.target.closest('[data-adel]');
  if (!d) return;
  state.group.aggs = state.group.aggs.filter(a => a.id !== d.dataset.adel);
  state.group.sort = null; savePrefs(); renderBuilder(); renderGroup();
});
$('#btn-add-agg').addEventListener('click', () => {
  state.group.aggs.push(mkAgg('avg', 'cost'));
  savePrefs(); renderBuilder(); renderGroup();
  const ins = $$('#aggs .agg select[data-af="op"]'); ins[ins.length - 1]?.focus();
});
$('#presets').addEventListener('click', e => {
  const p = e.target.closest('[data-preset]');
  if (p){ state.group.keys = JSON.parse(p.dataset.preset); state.group.sort = null; }
  else if (e.target.closest('#btn-reset-aggs')){ state.group.aggs = DEFAULT_AGGS(); state.group.sort = null; }
  else return;
  savePrefs(); renderBuilder(); renderGroup();
});
$('#opt-sub').addEventListener('change', e => { state.group.subtotals = e.target.checked; savePrefs(); renderGroup(); });
$('#g-head').addEventListener('click', e => {
  const th = e.target.closest('[data-sort]');
  if (!th) return;
  const col = +th.dataset.sort;
  const cur = lastGroup ? lastGroup.sort : null;
  const isText = lastGroup.cols[col].kind === 'text';
  state.group.sort = { col, dir: cur && cur.col === col ? -cur.dir : (isText ? 1 : -1) };
  renderGroup();
});
$('#g-body').addEventListener('click', e => {
  const td = e.target.closest('td[data-raw]');
  if (td && td.dataset.raw) copy(td.dataset.raw, null, 'نُسخ ' + td.dataset.raw);
});
$('#g-foot').addEventListener('click', e => {
  const td = e.target.closest('td[data-raw]');
  if (td && td.dataset.raw) copy(td.dataset.raw, null, 'نُسخ ' + td.dataset.raw);
});

$('#ph-body').addEventListener('focusout', e => {
  const el = e.target.closest('.edit');
  if (!el) return;
  const p = state.pharmacies.find(x => x.id === el.dataset.p);
  if (!p) return;
  const f = el.dataset.f;
  if (f === 'budget'){ const n = toNum(el.textContent); p.budget = n != null && n >= 0 ? n : null; }
  else {
    const v = norm(el.textContent).replace(/\s+/g, ' ').slice(0, 140);
    p[f] = f === 'name' ? (v || p.origName) : v;
  }
  renderAll();
});
$('#ph-body').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.edit')){ e.preventDefault(); e.target.blur(); } });
$('#ph-body').addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  const r = e.target.closest('[data-restore]');
  if (t){ const p = state.pharmacies.find(x => x.id === t.dataset.toggle); if (p){ p.included = !p.included; renderAll(); } }
  if (r){ const p = state.pharmacies.find(x => x.id === r.dataset.restore); if (p){ p.name = p.origName; p.area = p.origArea || ''; renderAll(); toast('تمت الاستعادة'); } }
});
$('#btn-restore-all').addEventListener('click', () => {
  state.pharmacies.forEach(p => { p.name = p.origName; p.area = p.origArea || ''; });
  renderAll();
  toast('تمت استعادة الأسماء الأصلية');
});

const stage = { mode:'import', items:[], nameSrc:'orig', load:'replace', label:'' };
const baseName = f => String(f || '').replace(/\.[^.]+$/, '').trim();

function renderStage(){
  const areas = [...new Set(state.pharmacies.map(p => p.area).concat(stage.items.map(i => i.area)).filter(Boolean))];
  const imp = stage.mode === 'import';
  $('#stage-title').textContent = imp ? 'مراجعة قبل التحميل' : 'الأسماء والمناطق';
  $('#stage-sub').textContent = imp ? stage.items.length + ' ورقة من ' + stage.label : 'عدّل الاسم والمنطقة أو استعد الأصل.';
  $('#stage-ok').textContent = imp ? 'تحميل' : 'حفظ';
  $('#stage-mode-wrap').style.display = imp && !state.isSample && state.pharmacies.length ? '' : 'none';
  $$('#stage-namesrc button').forEach(b => b.classList.toggle('active', b.dataset.v === stage.nameSrc));
  $$('#stage-mode button').forEach(b => b.classList.toggle('active', b.dataset.v === stage.load));
  $('#stage-namesrc button[data-v="orig"]').textContent = imp ? 'المكتشف' : 'الأصلي';
  $('#stage-body').innerHTML = stage.items.map((it, i) =>
    '<tr data-i="' + i + '">' +
      '<td><input type="checkbox" data-sf="sel"' + (it.sel ? ' checked' : '') + ' aria-label="تحديد"></td>' +
      '<td class="src"><b title="' + esc(it.fileName) + '">' + esc(it.fileName) + '</b>' + esc(it.sheetName) + '</td>' +
      '<td><input class="inp' + (it.name !== it.origName ? ' changed' : '') + '" data-sf="name" value="' + esc(it.name) + '" title="الأصل: ' + esc(it.origName) + '"></td>' +
      '<td><input class="inp' + ((it.area || '') !== (it.origArea || '') ? ' changed' : '') + '" data-sf="area" value="' + esc(it.area) + '" list="areas-list" placeholder="—"></td>' +
      '<td class="td-num">' + it.rows.length + '</td>' +
      '<td class="td-num">' + fmt2(sum(it.rows, r => r.cost)) + '</td>' +
    '</tr>'
  ).join('') + '';
  let dl = $('#areas-list');
  if (!dl){ dl = document.createElement('datalist'); dl.id = 'areas-list'; document.body.appendChild(dl); }
  dl.innerHTML = areas.map(a => '<option value="' + esc(a) + '">').join('');
  const n = stage.items.filter(i => i.sel).length;
  $('#stage-all').checked = n === stage.items.length;
  $('#stage-all').indeterminate = n > 0 && n < stage.items.length;
  $('#stage-count').textContent = n + ' / ' + stage.items.length + ' محددة';
  $('#stage-ok').disabled = imp && !n;
}

function openStage(mode, items, label){
  stage.mode = mode;
  stage.items = items;
  stage.label = label || '';
  stage.nameSrc = 'orig';
  stage.load = 'replace';
  $('#stage-area').value = '';
  renderStage();
  openOverlay('#ov-stage');
}

$('#stage-body').addEventListener('input', e => {
  const f = e.target.dataset.sf;
  const it = stage.items[+e.target.closest('tr').dataset.i];
  if (!it || !f) return;
  if (f === 'sel'){ it.sel = e.target.checked; renderStage(); return; }
  it[f] = e.target.value;
  e.target.classList.toggle('changed', f === 'name' ? it.name !== it.origName : (it.area || '') !== (it.origArea || ''));
});
$('#stage-all').addEventListener('change', e => { stage.items.forEach(i => { i.sel = e.target.checked; }); renderStage(); });
$('#stage-namesrc').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  stage.nameSrc = b.dataset.v;
  stage.items.forEach(it => {
    if (!it.sel) return;
    it.name = stage.nameSrc === 'file' ? baseName(it.fileName) || it.origName : stage.nameSrc === 'sheet' ? it.sheetName || it.origName : it.origName;
    if (stage.nameSrc === 'orig') it.area = it.origArea || '';
  });
  renderStage();
});
$('#stage-area-apply').addEventListener('click', () => {
  const v = $('#stage-area').value.trim();
  stage.items.forEach(it => { if (it.sel) it.area = v; });
  renderStage();
});
$('#stage-area').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); $('#stage-area-apply').click(); } });
$('#stage-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b){ stage.load = b.dataset.v; renderStage(); } });
$('#stage-ok').addEventListener('click', () => {
  if (stage.mode === 'edit'){
    stage.items.forEach(it => {
      const p = state.pharmacies.find(x => x.id === it.pid);
      if (p){ p.name = (it.name || '').trim() || p.origName; p.area = (it.area || '').trim(); }
    });
    closeOverlay($('#ov-stage'));
    renderAll();
    toast('تم الحفظ');
    return;
  }
  const chosen = stage.items.filter(i => i.sel);
  if (!chosen.length) return;
  const append = stage.load === 'append' && !state.isSample;
  commit(chosen.map(it => ({
    id:'p' + (++pid), name:(it.name || '').trim() || it.origName, area:(it.area || '').trim(),
    origName:it.origName, origArea:it.origArea || '', fileName:it.fileName, sheetName:it.sheetName,
    budget:it.meta.budget, from:it.meta.from, to:it.meta.to, printed:it.meta.printed, rows:it.rows, included:true
  })), stage.label, append);
  closeOverlay($('#ov-stage'));
});
$('#btn-edit-names').addEventListener('click', () => {
  openStage('edit', state.pharmacies.map(p => ({
    sel:true, pid:p.id, fileName:p.fileName || '—', sheetName:p.sheetName || '', origName:p.origName, origArea:p.origArea || '',
    name:p.name, area:p.area || '', rows:p.rows, meta:{}
  })));
});

function commit(list, label, append){
  state.prev = { pharmacies:state.pharmacies, isSample:state.isSample, source:state.source };
  state.pharmacies = append ? state.pharmacies.concat(list) : list;
  state.isSample = false;
  state.source = append && state.source ? state.source + ' + ' + label : label;
  renderAll();
  notify('تم تحميل ' + phLabel(list.length) + (append ? ' (إضافة)' : '') + '.', false, true);
}

function readFiles(input){
  const files = [...input].filter(f => /\.(xlsx|xls|xlsm)$/i.test(f.name));
  if (!files.length){ if ([...input].length) notify('الصيغ المدعومة: xlsx · xls · xlsm', true); return; }
  if (typeof XLSX === 'undefined'){ notify('مكتبة Excel غير محملة. استخدم «لصق».', true); return; }
  Promise.all(files.map(readOne)).then(out => {
    const items = [], failed = [];
    let skipped = 0;
    out.forEach(o => {
      if (o.error){ failed.push(o.name); return; }
      o.sheets.forEach(s => {
        if (!s.ok){ skipped++; return; }
        items.push({ sel:true, fileName:o.name, sheetName:s.sheetName, origName:s.meta.name, origArea:s.meta.area || '', name:s.meta.name, area:s.meta.area || '', rows:s.rows, meta:s.meta });
      });
    });
    if (!items.length){ notify('لم يُعثر على جدول مطابق' + (failed.length ? ' · تعذر قراءة: ' + failed.join('، ') : '') + '.', true); return; }
    const label = files.length === 1 ? files[0].name : files.length + ' ملفات';
    openStage('import', items, label);
    if (failed.length || skipped) notify([failed.length ? 'تعذر قراءة: ' + failed.join('، ') : '', skipped ? 'تم تجاهل ' + skipped + ' ورقة غير مطابقة' : ''].filter(Boolean).join(' · '), !!failed.length);
  });
}

$('#btn-file').addEventListener('click', () => $('#file-input').click());
$('#file-input').addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; readFiles(fs); });

$('#btn-paste').addEventListener('click', () => { openOverlay('#ov-paste'); setTimeout(() => $('#paste-area').focus(), 100); });
$('#paste-area').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const t = e.target, s = t.selectionStart;
  t.value = t.value.slice(0, s) + '\t' + t.value.slice(t.selectionEnd);
  t.selectionStart = t.selectionEnd = s + 1;
});
$('#btn-parse').addEventListener('click', () => {
  const res = parsePasteText($('#paste-area').value);
  const err = $('#paste-err');
  if (!res || !res.ok){
    err.textContent = !res ? 'لا توجد بيانات.' : res.reason === 'no-table' ? 'لم يُعثر على صف العناوين (التخصص / الطبيب / نوع التذكرة).' : res.reason === 'no-numeric' ? 'لا توجد أعمدة رقمية للتكلفة.' : 'لا توجد صفوف بيانات.';
    err.style.display = 'block';
    return;
  }
  err.style.display = 'none';
  closeOverlay($('#ov-paste'));
  $('#paste-area').value = '';
  openStage('import', [{ sel:true, fileName:'لصق', sheetName:'', origName:res.meta.name, origArea:res.meta.area || '', name:res.meta.name, area:res.meta.area || '', rows:res.rows, meta:res.meta }], 'بيانات ملصوقة');
});

let dragDepth = 0;
document.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')){ dragDepth++; document.body.classList.add('dragging'); } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0){ dragDepth = 0; document.body.classList.remove('dragging'); } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging'); if (e.dataTransfer) readFiles(e.dataTransfer.files); });

(function boot(){
  const s = parseMatrix(SAMPLE_MATRIX, 'عيادة طلاب الرحمانية');
  state.pharmacies = [{ id:'p' + (++pid), name:s.meta.name, area:s.meta.area || '', origName:s.meta.name, origArea:s.meta.area || '', fileName:'نموذج', sheetName:s.sheetName,
    budget:s.meta.budget, from:s.meta.from, to:s.meta.to, printed:s.meta.printed, rows:s.rows, included:true }];
  state.isSample = true;
  state.source = 'نموذج';
  renderAll();
})();
