// ═══════════════════════════════════════════
// Audit: which MARC subfields does the extension read, and which does it
// leave out?
//
//   node scripts/audit_marc_fields.js <MARCXML file> [--limit N] [--out report.md] [--json data.json]
//
// The file can be a whole catalogue dump (<collection><record>…) or one SRU
// answer. Each record goes through the extension's own code — parseMarcXML
// (worker) and extractAll (content script), then the components of the
// subject strings (subjectC / nameC, as cs_main.js does) — with every
// subfield value watched: a value the code never reads is a value the panel
// cannot show or search.
//
// The report has two parts:
//   1. fields left out as a whole (by tag and $2): usually a rule — no $0,
//      a vocabulary the extension does not handle;
//   2. inside the fields that are used, the subfields never read: these are
//      the ones to look at (a part of a name, a qualifier, a subdivision …).
// The dump is only read; nothing is sent anywhere.
// ═══════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && !['--out', '--json'].includes(args[i - 1]));
const limit = Number((args[args.indexOf('--limit') + 1]) || 0) || Infinity;
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const jsonIdx = args.indexOf('--json');
const jsonPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
if (!file) { console.error('usage: node scripts/audit_marc_fields.js <MARCXML> [--limit N] [--out report.md]'); process.exit(2); }

// ── The extension's code, in two sandboxes (as tests/run_tests.js) ──
const chromeStub = { runtime: { getURL: p => p, getManifest: () => ({ version: 'audit' }), sendMessage: () => {}, onMessage: { addListener() {} }, lastError: null },
  storage: { local: { get: () => Promise.resolve({}), set() {} } } };
const W = vm.createContext({ console, URL, chrome: chromeStub, setTimeout, clearTimeout, TextDecoder });
for (const f of ['bg_util.js', 'bg_site.js', 'bg_net.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
    .filter(l => !l.startsWith('import ')).map(l => l.replace(/^export /, '')).join('\n');
  vm.runInContext(src, W, { filename: f });
}
const C = vm.createContext({ console, URL, URLSearchParams, chrome: chromeStub, setTimeout, clearTimeout,
  window: { location: { search: '', href: 'https://swisscovery.ch/', hostname: 'swisscovery.ch' }, addEventListener() {} },
  document: { addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {}, setAttribute() {} }), createTextNode: () => ({}), body: { appendChild() {} } } });
for (const f of ['cs_site.js', 'cs_core.js', 'cs_index.js', 'cs_marc.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), C, { filename: f });
const parseMarcXML = vm.runInContext('parseMarcXML', W);
const extractAll = vm.runInContext('extractAll', C);
const subjectC = vm.runInContext('subjectC', C);
const nameC = vm.runInContext('nameC', C);
const marcLinkedTag = vm.runInContext('marcLinkedTag', C);

// ── Statistics ──
const RELEVANT = new Set(['082', '100', '110', '111', '600', '610', '611', '630', '648', '650', '651', '655', '691', '700', '710', '711']);
const TECHNICAL = new Set(['0', '1', '2', '5', '6', '8', '9']);   // ids, source, linkage, local
const fieldStats = new Map();   // tag → { total, used, ignoredBy2: Map }
const subStats = new Map();     // tag|code → { total, unread, examples: [] }
let records = 0;

function watch(fields) {
  return fields.map(f => {
    const subs = f.subs.map(s => {
      const o = { c: s.c, read: false, raw: s.v };
      Object.defineProperty(o, 'v', { enumerable: true, get() { o.read = true; return s.v; } });
      return o;
    });
    return { tag: f.tag, ind: f.ind, subs };
  });
}

function fieldText(f, mark) {
  return f.subs.map(s => (s === mark ? '»$' + s.c + ' ' + s.raw + '«' : '$' + s.c + ' ' + s.raw)).join(' ').slice(0, 220);
}

function audit(recordXml) {
  const id = (recordXml.match(/<controlfield tag="001">([^<]*)</) || [])[1] || '?';
  const fields = watch(parseMarcXML(recordXml));
  const out = extractAll(fields);
  // the components of the subject strings are built later, in cs_main.js
  for (const item of out.sbt) item.isName ? nameC(item.subs, item.kind || 'person') : subjectC(item.subs, item.tag);
  for (const f of fields) {
    const tag = marcLinkedTag(f).tag;
    if (!RELEVANT.has(tag)) continue;
    const label = f.tag === '880' ? '880→' + tag : tag;
    const fs_ = fieldStats.get(label) || { total: 0, used: 0, ignoredBy2: new Map() };
    fieldStats.set(label, fs_);
    fs_.total++;
    const used = f.subs.some(s => s.read && !TECHNICAL.has(s.c));
    if (!used) {
      const v2 = (f.subs.find(s => s.c === '2') || {}).raw || '(senza $2)';
      const ig = fs_.ignoredBy2.get(v2) || { n: 0, examples: [] };
      fs_.ignoredBy2.set(v2, ig);
      ig.n++;
      if (ig.examples.length < 3) ig.examples.push(id + ': ' + fieldText(f, null));
      continue;
    }
    fs_.used++;
    for (const s of f.subs) {
      const k = label + '|' + s.c;
      const st = subStats.get(k) || { total: 0, unread: 0, examples: [] };
      subStats.set(k, st);
      st.total++;
      if (!s.read) {
        st.unread++;
        if (st.examples.length < 3) st.examples.push(id + ': ' + fieldText(f, s));
      }
    }
  }
}

// ── Streaming read: one <record>…</record> at a time ──
async function run() {
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 1 << 20 });
  let buf = '';
  const t0 = Date.now();
  for await (const chunk of stream) {
    buf += chunk;
    let end;
    while ((end = buf.indexOf('</record>')) >= 0) {
      const start = buf.lastIndexOf('<record', end);
      const rec = buf.slice(start, end + 9);
      buf = buf.slice(end + 9);
      if (start < 0 || !rec.includes('<datafield')) continue;
      audit(rec);
      if (++records % 50000 === 0) console.error('  … ' + records + ' records, ' + Math.round((Date.now() - t0) / 1000) + ' s');
      if (records >= limit) { stream.destroy(); break; }
    }
    if (records >= limit) break;
  }
  report();
}

function report() {
  const L = [];
  const pct = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '—');
  L.push('# Sottocampi MARC letti e non letti — Subject Navigator');
  L.push('');
  L.push('Generato da `scripts/audit_marc_fields.js` su `' + path.basename(file) + '` (' + records + ' record), ' + new Date().toISOString().slice(0, 10) + '.');
  L.push('Solo i campi che l\'estensione tratta: 082, 1XX, 600–655, 691, 7XX (e i loro 880).');
  L.push('');
  L.push('## 1. Campi ignorati per intero');
  L.push('');
  L.push('| Campo | Totale | Usati | Ignorati | Ignorati, per $2 (i più frequenti) |');
  L.push('|---|---:|---:|---:|---|');
  for (const [tag, s] of [...fieldStats].sort()) {
    const by2 = [...s.ignoredBy2].sort((a, b) => b[1].n - a[1].n).slice(0, 5).map(([k, v]) => '`' + k + '` ' + v.n).join(', ');
    L.push('| ' + tag + ' | ' + s.total + ' | ' + s.used + ' | ' + (s.total - s.used) + ' | ' + by2 + ' |');
  }
  L.push('');
  L.push('## 2. Sottocampi mai letti dentro i campi usati');
  L.push('');
  L.push('I codici tecnici ($0 $1 $2 $5 $6 $8 $9) sono elencati a parte. Esempi: il sottocampo non letto è tra »«.');
  L.push('');
  const rows = [...subStats].filter(([, s]) => s.unread > 0)
    .map(([k, s]) => ({ tag: k.split('|')[0], code: k.split('|')[1], ...s }))
    .sort((a, b) => a.tag.localeCompare(b.tag) || a.code.localeCompare(b.code));
  for (const technical of [false, true]) {
    L.push(technical ? '### Codici tecnici' : '### Codici di contenuto');
    L.push('');
    L.push('| Campo | $ | Occorrenze | Non lette | % | Esempi |');
    L.push('|---|---|---:|---:|---:|---|');
    for (const r of rows.filter(r => TECHNICAL.has(r.code) === technical))
      L.push('| ' + r.tag + ' | $' + r.code + ' | ' + r.total + ' | ' + r.unread + ' | ' + pct(r.unread, r.total) + ' | ' + r.examples.map(e => e.replace(/\|/g, '\\|')).join('<br>') + ' |');
    L.push('');
  }
  if (jsonPath) {
    fs.writeFileSync(jsonPath, JSON.stringify({ file: path.basename(file), records,
      fields: Object.fromEntries([...fieldStats].map(([t, s]) => [t, { total: s.total, used: s.used,
        ignored: Object.fromEntries(s.ignoredBy2) }])),
      subfields: [...subStats].map(([k, s]) => ({ tag: k.split('|')[0], code: k.split('|')[1], ...s })) }, null, 1));
    console.error('json: ' + jsonPath);
  }
  const text = L.join('\n') + '\n';
  if (outPath) { fs.writeFileSync(outPath, text); console.error('report: ' + outPath); }
  else process.stdout.write(text);
}

run().catch(e => { console.error(e); process.exit(1); });
