'use strict';
const AR_DIGITS = {'٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9','۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9'};
const pad2 = n => String(n).padStart(2, '0');

function norm(v){
  if (v == null) return '';
  return String(v).replace(/[٠-٩۰-۹]/g, d => AR_DIGITS[d]).trim();
}
function toNum(v){
  if (v == null || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  const s = norm(v).replace(/[,\u060C\u066C\s]/g, '').replace(/\u066B/g, '.').replace(/[^\d.\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}
const RE_DATE_YMD = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/;
const RE_DATE_DMY = /^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/;
function parseDateStr(t){
  let m = RE_DATE_YMD.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = RE_DATE_DMY.exec(t);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
const iso = d => d ? d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) : null;
const isBlank = v => v == null || norm(v) === '';

const RE_PAIR = /^([-+]?\d[\d,]*(?:\.\d+)?)\s+([-+]?\d[\d,]*(?:\.\d+)?)$/;
function pairParts(v){
  if (v == null || typeof v === 'number' || v instanceof Date) return null;
  const s = norm(v).replace(/\u066B/g, '.').replace(/[\u066C\u060C]/g, ',');
  const m = RE_PAIR.exec(s);
  if (!m) return null;
  const a = parseFloat(m[1].replace(/,/g, '')), b = parseFloat(m[2].replace(/,/g, ''));
  if (!isFinite(a) || !isFinite(b)) return null;
  return { a, b, da: m[1].includes('.'), db: m[2].includes('.') };
}
function splitPair(v, countFirst){
  const p = pairParts(v);
  if (!p) return null;
  const first = p.da !== p.db ? !p.da : countFirst;
  return first ? { count: p.a, cost: p.b } : { count: p.b, cost: p.a };
}
const pairCell = (n, c) => String(n).padEnd(32) + c.toFixed(4).padEnd(22);

const SAMPLE_MATRIX = [
  ['الهيئة العامة للتأمين الصحى'],
  ['تاريخ الطباعة', null, '2026-10-20'],
  ['صيدلية (مواليد) عيادة طلاب الرحمانية'],
  ['التكلفة الشهرية بالتخصص في الفتره من', '2026-7-1', 'الي', '2026-9-30'],
  ['التخصص', 'اسم الطبيب', 'تكلفة التذاكر / عدد تذاكر', 'نوع التذكرة'],
  ['اسنان', 'اخصائي خارجي', pairCell(14, 816.2), 'مواليد'],
  ['اطفال', 'اخصائي خارجي', pairCell(2, 119.621), 'طلبة'],
  [null, null, pairCell(9, 1861.263), 'طلبه مزمن'],
  [null, null, pairCell(12, 619.295), 'مواليد'],
  [null, null, pairCell(10, 7318.13), 'مواليد مزمن'],
  [null, 'استشاري خارجي', pairCell(24, 465.451), 'طلبة'],
  [null, null, pairCell(7, 225.893), 'طلبه مزمن'],
  [null, null, pairCell(30, 921.314), 'مواليد'],
  [null, null, pairCell(10, 650.739), 'مواليد مزمن']
];

function trimEdges(M){
  let first = Infinity, last = -1;
  M.forEach(row => (row || []).forEach((v, c) => {
    if (!isBlank(v)) { if (c < first) first = c; if (c > last) last = c; }
  }));
  if (last < 0) return [];
  return M.map(r => (r || []).slice(first, last + 1));
}

const ROLE_RE = {
  spec: /التخصص|القسم|العيادة/,
  doc: /الطبيب|طبيب|الدكتور|دكتور|الأخصائي|الاخصائي/,
  type: /نوع|التذكرة|الفئة/,
  count: /عدد|الكمية|العدد/,
  cost: /التكلفة|تكلفة|القيمة|المبلغ/
};
const META_ROW = /(الفترة|الفتره|الطباعة|الهيئة|منطقة|الموازنة)/;
const LABEL_WORDS = /^(الي|إلى|من|فترة|الفترة|تاريخ|الطباعة|اسم|الصيدلية|المنطقة|صيدلية|جنيه|ج\.م)$/;
const RE_NAME_LABEL = /اسم\s*الصيدلية|^الصيدلية$|^صيدلية$/;
const RE_AREA_LABEL = /المنطقة|منطقة/;
const RE_NAMEISH = /صيدلية|عيادة|مركز|وحدة صحية/;
const RE_NOISE = /التكلفة|الفترة|الفتره|الطباعة|الهيئة/;
const RE_TOTAL = /(إجمالي|اجمالي|الإجمالي|الاجمالي)/;
const NEIGHBOR_SPAN = 6;

const isDateText = t => RE_DATE_YMD.test(t) || RE_DATE_DMY.test(t);
const isNumberText = t => /^[+\-]?[\d.,\u066B\u066C\u060C\s]+$/.test(t);

function headerScore(row){
  const cells = (row || []).map(norm);
  const has = re => cells.some(c => c && re.test(c));
  const roles = { spec: has(ROLE_RE.spec), doc: has(ROLE_RE.doc), type: has(ROLE_RE.type), count: has(ROLE_RE.count), cost: has(ROLE_RE.cost) };
  const main = (roles.spec ? 1 : 0) + (roles.doc ? 1 : 0) + (roles.type ? 1 : 0);
  const num = (roles.count ? 1 : 0) + (roles.cost ? 1 : 0);
  return { main, num, score: main * 2 + num, filled: cells.filter(Boolean).length };
}

function findHeaderRows(M){
  const out = [];
  for (let r = 0; r < Math.min(M.length, 60); r++){
    const row = M[r] || [];
    const text = row.map(norm).join(' ');
    if (META_ROW.test(text) && !/نوع\s*التذكرة/.test(text)) continue;
    const s = headerScore(row);
    const ok = s.main >= 2 || (s.main >= 1 && s.num >= 1 && s.filled >= 3);
    if (!ok) continue;
    const cols = mapColumns(M, r);
    if (cols.cost == null && cols.pair == null) continue;
    out.push({ r, score: s.score });
  }
  return out.sort((a, b) => b.score - a.score || a.r - b.r);
}

function findHeaderRow(M){
  const list = findHeaderRows(M);
  return list.length ? list[0].r : -1;
}

function splitLabel(t){
  const m = /^([^:：]{1,40})[:：]\s*(.+)$/.exec(t);
  return m ? { label: m[1].trim(), value: m[2].trim() } : null;
}

function neighborText(row, c){
  for (let d = 1; d <= NEIGHBOR_SPAN; d++){
    for (const x of [row[c + d], row[c - d]]){
      if (x == null || x instanceof Date || typeof x === 'number') continue;
      const t = norm(x);
      if (t && !LABEL_WORDS.test(t) && !isDateText(t) && !isNumberText(t)) return t;
    }
  }
  return null;
}

function pushCand(list, v, src){
  if (v == null || v === '' || list.some(x => x.v === v)) return;
  list.push({ v, src });
}

function scanLabels(M, r0, r1, out){
  for (let r = r0; r < r1; r++){
    const row = M[r] || [];
    for (let c = 0; c < row.length; c++){
      const v = row[c];
      if (isBlank(v) || v instanceof Date || typeof v === 'number') continue;
      const t = norm(v);
      const sl = splitLabel(t);
      const lab = sl ? sl.label : t;
      if (!sl && t.length > 30) continue;
      if (RE_NAME_LABEL.test(lab)) pushCand(out.names, (sl && sl.value) || neighborText(row, c), lab);
      else if (RE_AREA_LABEL.test(lab) && !/صيدلية|عيادة/.test(lab)) pushCand(out.areas, (sl && sl.value) || neighborText(row, c), lab);
    }
  }
}

const fallbackName = sheetName => sheetName && !/^(sheet|ورقة|ورقه)/i.test(sheetName) ? sheetName : 'صيدلية بدون اسم';

function scanMeta(M, hdr, sheetName){
  const meta = { org: null, printed: null, from: null, to: null };
  const found = { names: [], areas: [] };
  scanLabels(M, 0, hdr, found);
  const nameish = [], genericDates = [];
  for (let r = 0; r < hdr; r++){
    const row = M[r] || [];
    const rowText = row.map(norm).join(' ');
    for (let c = 0; c < row.length; c++){
      const v = row[c];
      if (isBlank(v)) continue;
      if (v instanceof Date){
        if (/الطباعة/.test(rowText)) { if (!meta.printed) meta.printed = v; }
        else genericDates.push(v);
        continue;
      }
      if (typeof v === 'number') continue;
      const t = norm(v);
      if (isDateText(t)){
        const d = parseDateStr(t);
        if (d){
          if (/الطباعة/.test(rowText)) { if (!meta.printed) meta.printed = d; }
          else genericDates.push(d);
        }
        continue;
      }
      if (!meta.org && /الهيئة|وزارة|مديرية/.test(t) && !/التكلفة/.test(t)) { meta.org = t; continue; }
      const sl = splitLabel(t);
      const lab = sl ? sl.label : t;
      if (RE_NAME_LABEL.test(lab) || (RE_AREA_LABEL.test(lab) && !/صيدلية|عيادة/.test(lab))) continue;
      if (t.length > 5 && RE_NAMEISH.test(t) && !RE_NOISE.test(t) && !/^(اسم|المنطقة)/.test(t)) pushCand(nameish, t, 'الترويسة');
    }
  }
  if (genericDates.length){
    const ds = genericDates.slice().sort((a, b) => a - b);
    if (ds.length >= 2){ meta.from = ds[0]; meta.to = ds[ds.length - 1]; }
    else if (!meta.printed) meta.printed = ds[0];
  }
  const nameCands = [];
  found.names.forEach(c => pushCand(nameCands, c.v, c.src));
  nameish.forEach(c => pushCand(nameCands, c.v, c.src));
  return {
    org: meta.org,
    name: nameCands.length ? nameCands[0].v : fallbackName(sheetName),
    area: found.areas.length ? found.areas[0].v : null,
    printed: iso(meta.printed), from: iso(meta.from), to: iso(meta.to),
    nameCands, areaCands: found.areas
  };
}

function pairOrder(M, hdr, col){
  let first = 0, second = 0;
  for (let r = hdr + 1; r < M.length; r++){
    const p = pairParts((M[r] || [])[col]);
    if (p && p.da !== p.db){ if (p.da) second++; else first++; }
  }
  return first >= second;
}

function mapColumns(M, hdr){
  const hrow = M[hdr] || [];
  const find = re => hrow.findIndex(c => re.test(norm(c)));
  const spec = find(ROLE_RE.spec);
  const doc = find(ROLE_RE.doc);
  const type = find(ROLE_RE.type);
  const excl = new Set([spec, doc, type].filter(i => i >= 0));
  let pair = -1, pairHits = 0;
  for (let c = 0; c < hrow.length; c++){
    if (excl.has(c)) continue;
    let hits = 0, filled = 0;
    for (let r = hdr + 1; r < M.length; r++){
      const v = (M[r] || [])[c];
      if (isBlank(v)) continue;
      filled++;
      if (pairParts(v)) hits++;
    }
    if (hits && hits * 2 >= filled && hits > pairHits){ pair = c; pairHits = hits; }
  }
  if (pair >= 0) return { spec, doc, type, cost: null, count: null, pair, countFirst: pairOrder(M, hdr, pair) };
  const anchor = doc >= 0 ? doc : (type >= 0 ? type : 0);
  const cand = [];
  for (let c = 0; c < hrow.length; c++){
    if (excl.has(c)) continue;
    const vals = [];
    for (let r = hdr + 1; r < Math.min(M.length, hdr + 80); r++){
      const v = toNum((M[r] || [])[c]);
      if (v != null) vals.push(v);
    }
    if (vals.length) cand.push({
      c, n: vals.length,
      frac: vals.filter(v => Math.abs(v - Math.round(v)) > 1e-9).length / vals.length,
      total: vals.reduce((s, v) => s + Math.abs(v), 0)
    });
  }
  if (!cand.length) return { spec, doc, type, cost: null, count: null, pair: null };
  const inCand = i => cand.some(x => x.c === i);
  const costH = hrow.findIndex((c, i) => inCand(i) && ROLE_RE.cost.test(norm(c)) && !ROLE_RE.count.test(norm(c)));
  const countH = hrow.findIndex((c, i) => inCand(i) && ROLE_RE.count.test(norm(c)) && !ROLE_RE.cost.test(norm(c)));
  if (costH >= 0 && countH >= 0) return { spec, doc, type, cost: costH, count: countH, pair: null };
  cand.sort((a, b) => b.n - a.n || Math.abs(a.c - anchor) - Math.abs(b.c - anchor));
  const picked = cand.slice(0, 2);
  let cost = null, count = null;
  if (picked.length === 2){
    const [a, b] = picked;
    if (a.frac > b.frac + 0.15) { cost = a.c; count = b.c; }
    else if (b.frac > a.frac + 0.15) { cost = b.c; count = a.c; }
    else if (a.total >= b.total) { cost = a.c; count = b.c; }
    else { cost = b.c; count = a.c; }
  } else cost = picked[0].c;
  return { spec, doc, type, cost, count, pair: null };
}

function finishCols(M, hdr, c){
  const g = v => v == null || v < 0 ? -1 : v;
  if (c.pair != null && c.pair >= 0) return { spec: g(c.spec), doc: g(c.doc), type: g(c.type), cost: null, count: null, pair: c.pair, countFirst: pairOrder(M, hdr, c.pair) };
  return { spec: g(c.spec), doc: g(c.doc), type: g(c.type), cost: c.cost != null && c.cost >= 0 ? c.cost : null, count: c.count != null && c.count >= 0 ? c.count : null, pair: null };
}

function extractRows(M, hdr, cols){
  const rows = [];
  let fs = '', fd = '', ft = '';
  for (let r = hdr + 1; r < M.length; r++){
    const row = M[r] || [];
    const present = row.filter(v => !isBlank(v));
    if (!present.length){ fs = fd = ft = ''; continue; }
    const joined = row.map(norm).join(' ');
    if (RE_TOTAL.test(joined)) continue;
    if (/التخصص/.test(joined) && /التذكرة/.test(joined)){ fs = fd = ft = ''; continue; }
    const sp = cols.spec >= 0 ? norm(row[cols.spec]) : '';
    const dc = cols.doc >= 0 ? norm(row[cols.doc]) : '';
    const ty = cols.type >= 0 ? norm(row[cols.type]) : '';
    if (sp){ if (sp !== fs){ fd = ''; ft = ''; } fs = sp; }
    if (dc){ if (dc !== fd) ft = ''; fd = dc; }
    if (ty) ft = ty;
    let cost = null, tk = null;
    if (cols.pair != null){
      const pr = splitPair(row[cols.pair], cols.countFirst);
      if (!pr) continue;
      cost = pr.cost;
      tk = pr.count;
    } else {
      cost = cols.cost != null ? toNum(row[cols.cost]) : null;
      tk = cols.count != null ? toNum(row[cols.count]) : null;
    }
    if (cost == null && tk == null) continue;
    rows.push({
      specialty: fs || 'غير محدد',
      doctor: fd || 'غير محدد',
      type: ft || 'غير محدد',
      tickets: tk,
      cost: cost || 0
    });
  }
  return rows;
}

function parseMatrix(rawM, sheetName, ov){
  const M = trimEdges(rawM || []);
  const base = { sheetName, M };
  if (!M.length) return { ok: false, reason: 'empty', hdr: -1, cols: null, ...base };
  const hdr = ov && ov.hdr != null ? ov.hdr : findHeaderRow(M);
  if (hdr < 0 || hdr >= M.length) return { ok: false, reason: 'no-table', hdr: -1, cols: null, ...base };
  const cols = ov && ov.cols ? finishCols(M, hdr, ov.cols) : mapColumns(M, hdr);
  if (cols.cost == null && cols.pair == null) return { ok: false, reason: 'no-numeric', hdr, cols, ...base };
  const rows = extractRows(M, hdr, cols);
  if (!rows.length) return { ok: false, reason: 'no-rows', hdr, cols, ...base };
  return { ok: true, hdr, cols, meta: scanMeta(M, hdr, sheetName), rows, paired: cols.pair != null, manual: !!ov, ...base };
}

function filledMatrix(ws){
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, cellDates: true });
  const M = m.map(r => (r || []).slice());
  const origin = ws['!ref'] ? XLSX.utils.decode_range(ws['!ref']).s : { r: 0, c: 0 };
  (ws['!merges'] || []).forEach(mg => {
    const sr = mg.s.r - origin.r, sc = mg.s.c - origin.c;
    const er = mg.e.r - origin.r, ec = mg.e.c - origin.c;
    if (sr < 0 || sc < 0) return;
    const anchor = (m[sr] || [])[sc];
    if (anchor == null) return;
    for (let r = sr; r <= er; r++){
      if (!M[r]) M[r] = [];
      for (let c = sc; c <= ec; c++) M[r][c] = anchor;
    }
  });
  return M;
}

function parseWorkbook(wb){
  const res = wb.SheetNames.map(sn => parseMatrix(filledMatrix(wb.Sheets[sn]), sn));
  if (!res.some(r => r.ok && r.paired)) return res;
  return res.map(r => r.ok && !r.paired ? { ...r, ok: false, reason: 'derived' } : r);
}

function readOne(file){
  return new Promise(resolve => {
    const fr = new FileReader();
    fr.onload = ev => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array', cellDates: true });
        resolve({ name: file.name, sheets: parseWorkbook(wb) });
      } catch (err) {
        resolve({ name: file.name, error: true });
      }
    };
    fr.onerror = () => resolve({ name: file.name, error: true });
    fr.readAsArrayBuffer(file);
  });
}

function parsePasteText(text){
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return null;
  const sep = lines.some(l => l.includes('\t')) ? '\t' : /\s{2,}/;
  const M = lines.map(l => l.split(sep).map(s => (s == null ? null : String(s).trim() === '' ? null : s)));
  return parseMatrix(M, 'بيانات ملصوقة');
}
