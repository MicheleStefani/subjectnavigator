// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — TEST SUITE
// Run with:  node tests/run_tests.js   (from the extension folder)
//
// Two sandboxes, three levels:
//  1. smoke test — the 8 content scripts load in a Node `vm` sandbox with
//     minimal chrome/DOM stubs; the 5 worker ES modules + entry are loaded
//     in a second sandbox (imports/exports stripped, concatenated in
//     dependency order — they are written in a strip-friendly style).
//     Any top-level breakage or dangling cross-module reference fails here.
//  2. unit tests — pure functions (class number parsing, MARC formatting, URL
//     building, XML decoding) and the security validations (whitelists,
//     ID format checks, parameter encoding).
//  3. offline end-to-end — the worker sandbox gets a fixture index served
//     through the fetch stub, and reconcile()/getHierarchy() run for real
//     with the network stubbed out (external fetches throw, exercising the
//     fallback paths).
// ═══════════════════════════════════════════
'use strict';

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + name + (detail !== undefined ? '  → ' + JSON.stringify(detail) : '')); }
}
function section(title) { console.log('\n· ' + title); }

// ── Fixtures (mini unified index) ────────────────────────────
const FIX_INDEX = {
  v: 7, primary: 'ns', count: 3,
  concepts: {
    '100': { l: 'calcestruzzo', bt: ['200'], d: '620.136',
             cl: { gnd: { id: '4005184-2', c: 3, d: 'both' }, wd: { id: 'Q40089', c: 2, d: 'out' }, _g: 1 } },
    '200': { l: 'materiali da costruzione', nt: ['100'], cl: { gnd: { id: 'G-SLOT', c: 1, d: 'in' }, _g: 3 } },
    // LCSH-only cluster (no GND, no precomputed QID): exercises the
    // generalized WD backlink chain (P244).
    '300': { l: 'paesaggio culturale', cl: { lcsh: { id: 'sh99005095', c: 0 }, _g: 3 } },
    // NS 1578 Fotografie: no RAMEAU/BNE slot, the ids come from Wikidata
    // (hub); their labels are in the local files.
    '400': { l: 'fotografie', cl: { wd: { id: 'Q125191', c: 2, d: 'out' }, _g: 3 } },
    // NS Rinascimento: linked to the RAMEAU «Renaissance» common noun (cbREN),
    // not to the period heading of the same wording (cbPER, IdRef type x).
    '500': { l: 'rinascimento', cl: { bnf: { id: 'cbREN', c: 2, d: 'both' }, wd: { id: 'Q4692', c: 2, d: 'out' }, _g: 2 } }
  },
  labels: { 'calcestruzzo': ['100'], 'materiali da costruzione': ['200'], 'paesaggio culturale': ['300'], 'fotografie': ['400'], 'rinascimento': ['500'] },
  // Q61109 → '200' lets a test prove that an unverified text-search QID
  // never anchors a record to a thesaurus concept.
  // 'GND-SEC' is a secondary mapping of 100 (its slot holds 4005184-2);
  // 'G-SLOT' holds 200's slot and is ALSO declared, secondarily, for 100.
  reverse: { gnd: { '4005184-2': ['100'], 'GND-SEC': ['100'], 'G-SLOT': ['200', '100'] }, bnf: { 'cbREN': ['500'] }, lcsh: { 'sh99005095': ['300'] }, wd: { 'Q40089': ['100'], 'Q61109': ['200'] }, idref: {}, bne: {} }
};
const FIX_DE = { '4005184-2': 'Beton', '4056795-3': 'Baustoff', 'G-WB': 'Wörterbuch' };
const FIX_HG = { '4005184-2': { bt: ['4056795-3'] },
  // another GND id whose broader term is concept 100's own GND (self-loop case)
  'G-CHILD': { bt: ['4005184-2', '4056795-3'] } };
const PACKAGED = {
  'unified_index_core.json': FIX_INDEX,
  'labels_de.json': FIX_DE,
  // One RAMEAU/IdRef table — {ark: [label, ppn, bt, nt, rt]}.
  'rameau_idref.json': { v: 1, pc: { 'PPN_DUP': 'cbT' }, pl: {}, e: {
    'cb12010336g': ['Photographie', '', [], [], []],
    // «Dictionnaires»: an IdRef term the NS does not have.
    'cbT': ['Dictionnaires', 'PPN_T', ['cbB'], ['cbN'], ['cbR']],
    'cbB': ['Ouvrages de référence', 'PPN_B', [], ['cbT'], []],
    'cbN': ['Dictionnaires anglais', 'PPN_N', ['cbT'], [], []],
    'cbR': ['Lexicographie', '', [], [], ['cbT']],
    'cbT2': ['Dictionnaires (doublon)', 'PPN_DUP', [], [], []],
    'cbREN': ['Renaissance', 'PPN_REN_J', [], [], ['cbPER']],
    'cbPER': ['Renaissance', 'PPN_REN_X', [], [], ['cbREN']] } },
  'labels_en_slim.json': { 'sh99005095': 'Cultural landscapes', 'sh-dict': 'Dictionaries' },
  'labels_es_slim.json': { 'XX4343842': 'Fotografía' },
  'hierarchy_gnd.json': FIX_HG,
  // Notes of GND and RAMEAU headings, loaded on demand.
  'notes_gnd.json': { '4005184-2': 'Baustoff aus Zement, Gesteinskörnung und Wasser' },
  'notes_rameau.json': { 'cbT': 'Recueils de mots rangés dans un ordre convenu' },
  // Exact links of headings without an NS concept.
  'exact_links.json': { v: 1, gnd: { 'G-WB': { bnf: 'cbT', lcsh: 'sh-dict' } }, idref: { 'PPN_T': { gnd: 'G-WB' } } },
};

// ── Stubs ────────────────────────────────────────────────────
function chromeStubBase() {
  const stub = {
    runtime: {
      getURL: p => 'chrome-extension://test/' + p,
      getManifest: () => JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')),
      sendMessage: () => {},
      // The listener is kept, so the worker's message router can be tested.
      onMessage: { addListener: fn => { stub.__onMessage = fn; } },
      lastError: null
    },
    storage: { local: { get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); }, set: () => {} } },
    tabs: { sendMessage: async () => {}, onUpdated: { addListener: () => {} } },
    action: { onClicked: { addListener: () => {} } },
    scripting: { executeScript: async () => {} }
  };
  return stub;
}

// ── Content-script sandbox ───────────────────────────────────
let workerCalls = { reconcile: 0, hierarchy: 0, warmIndex: 0 };
function makeContentContext() {
  const chrome = chromeStubBase();
  // Canned worker responses for the bridge wrappers (cs_reconcile.js).
  chrome.runtime.sendMessage = (msg, cb) => {
    if (msg && msg.type === 'reconcile') {
      workerCalls.reconcile++;
      cb({ data: { qid: 'Q1', entity: null, route: ['NS-local'], dewey: null,
        nsData: { id: '100', label: msg.term, uri: 'http://purl.org/bncf/tid/100' },
        controlledLabels: { it: msg.term }, vocabSource: msg.vocabSource,
        termType: msg.termType, gndId: msg.gndId, idrefId: msg.idrefId, nsClusterGrade: 1 } });
    } else if (msg && msg.type === 'hierarchy') {
      workerCalls.hierarchy++;
      cb({ data: [{ type: 'bt', label: 'parent', srcs: ['NS'], uri: '', langs: { it: 'parent' } }] });
    } else if (msg && msg.type === 'warmIndex') {
      workerCalls.warmIndex++;
      cb({ data: { status: 'ready' } });
    } else if (msg && msg.type === 'resource') {
      // The panel's packaged files come from the worker.
      workerCalls.resource = (workerCalls.resource || []).concat([msg.name]);
      cb({ data: fs.readFileSync(path.join(ROOT, msg.name), 'utf8') });
    } else if (cb) {
      cb({ data: null });
    }
  };
  const sandbox = {
    console, URL, URLSearchParams, TextDecoder, setTimeout, clearTimeout,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    chrome,
    requestAnimationFrame: fn => fn(),
    window: {
      location: { search: '', href: 'https://swisscovery.slsp.ch/', hostname: 'swisscovery.slsp.ch' },
      addEventListener: () => {},
      open: () => {}
    },
    document: {
      addEventListener: () => {},
      visibilityState: 'hidden',
      createElement: () => ({ appendChild() {}, setAttribute() {}, remove() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
      createTextNode: () => ({}),
      body: { appendChild: () => {} },
      getElementById: () => null
    }
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['cs_site.js', 'cs_core.js', 'cs_index.js', 'cs_marc.js', 'cs_class.js', 'cs_reconcile.js', 'cs_render.js', 'cs_main.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

// ── Worker sandbox ───────────────────────────────────────────
// The ES modules are written in a strip-friendly style (single-line
// imports, `export` only as a declaration prefix) precisely so this loader
// can concatenate them as classic scripts without a bundler.
function stripModule(src) {
  return src.split('\n')
    .filter(l => !l.startsWith('import '))
    .map(l => l.replace(/^export /, ''))
    .join('\n');
}

function makeWorkerContext() {
  const sandbox = {
    console, URL, URLSearchParams, TextDecoder, setTimeout, clearTimeout, AbortController,
    chrome: chromeStubBase(),
    fetch: async (url, opts) => {
      // A long SPARQL query travels in the POST body
      const u = String(url) + (opts && opts.body ? '?' + opts.body : '');
      // data.bnf.fr redirects a replaced ark to its successor
      // over http, which the extension may not read (CORS).
      if (u.startsWith('https://data.bnf.fr/fr/ark:/12148/cbOLD')) {
        sandbox.__bnfRedirectMode = opts && opts.redirect;
        if (opts && opts.redirect === 'manual') return { type: 'opaqueredirect', ok: false, status: 0, headers: { get: () => null } };
        throw new TypeError('Failed to fetch (CORS)');
      }
      if (u.startsWith('chrome-extension://test/')) {
        const data = PACKAGED[u.slice('chrome-extension://test/'.length)];
        if (data === undefined) return { ok: false, status: 404 };
        return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
      }
      // Canned Wikidata SPARQL backlinks for the regression tests; every
      // other query gets an empty result set. Responses go through
      // fetchWithTimeout + readTextCapped, hence the headers/text shape.
      if (u.startsWith('https://qlever.dev/api/wikidata') || u.startsWith('https://query.wikidata.org/sparql')) {
        sandbox.__wdQueries = (sandbox.__wdQueries || []).concat([{ url: u, headers: (opts && opts.headers) || {} }]);
        if (sandbox.__wdDown && u.startsWith(sandbox.__wdDown)) throw new TypeError('Failed to fetch');
        const CANNED = [
          ['P269', '"027249654"', 'Q39'],                 // "Suisse" → Switzerland
          ['P244', '"sh99005095"', 'Q1655072'],           // LCSH-only cluster
          ['P214', '"45191303"', 'Q1000001'],             // VIAF mined from IdRef
          ['P213', '"0000 0000 1658 3504"', 'Q1000002'],  // ISNI, spaced form
          ['P227', '"4999999-9"', 'Q2000001'],            // priority test: GND …
          ['P269', '"029999999"', 'Q2000002'],            // … wins over IdRef
          ['P227', '"4888888-8"', 'Q3000001'],            // QLever down: fallback
          ['P227', '"4777777-7"', 'Q9'],                  // two items, one known to NS …
          ['P227', '"4777777-7"', 'Q40089'],              // … (calcestruzzo): it wins
          ['P227', '"4666666-6"', 'Q50'],                 // two items, none in NS …
          ['P227', '"4666666-6"', 'Q7'],                  // … the lowest number wins
        ];
        // One backlink query carries every id (one VALUES block per
        // property); each canned id present in it answers, with its value (?v)
        // and the property it matched (?p, a literal «P227»…).
        const ms = CANNED.filter(([p, v]) => u.includes(p) && u.includes(encodeURIComponent(v)));
        const payload = { results: { bindings: ms.map(m => ({ i: { type: 'uri', value: 'http://www.wikidata.org/entity/' + m[2] },
          v: { type: 'literal', value: m[1].slice(1, -1) }, p: { type: 'literal', value: m[0] } })) } };
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
      }
      // Canned Wikidata API for the person-gate test: the fuzzy text search
      // returns the WRONG person (Oskar Barnack) for "Oskar Bär".
      if (u.startsWith('https://www.wikidata.org/w/api.php')) {
        // «Schacht» → first the family name, then the shaft;
        // «Pferd» → the animal. Both items carry the heading as label.
        const WD_TEXT = {
          Schacht: [['Q17166770', 'Q101352'], ['Q556186', 'Q1149652']],
          Pferd: [['Q726', 'Q16521']],
        };
        const wt = Object.keys(WD_TEXT).find(k => u.includes('search=' + k));
        if (u.includes('wbsearchentities') && wt) {
          const payload = { search: WD_TEXT[wt].map(([id]) => ({ id })) };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        const wg = Object.keys(WD_TEXT).find(k => u.includes('wbgetentities') && WD_TEXT[k].some(([id]) => u.includes(id)));
        if (wg) {
          const entities = {};
          for (const [id, cls] of WD_TEXT[wg]) entities[id] = { labels: { de: { language: 'de', value: wg } }, aliases: {},
            claims: { P31: [{ mainsnak: { datavalue: { value: { id: cls } } } }] } };
          const payload = { entities };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        if (u.includes('wbsearchentities') && u.includes('Oskar')) {
          const payload = { search: [{ id: 'Q61109' }] };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        if (u.includes('wbgetentities') && u.includes('Q125191')) {
          const payload = { entities: { Q125191: { labels: {}, aliases: {},
            claims: { P268: [{ mainsnak: { datavalue: { value: '12010336g' } } }],
                      P950: [{ mainsnak: { datavalue: { value: 'XX4343842' } } }] } } } };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        if (u.includes('wbgetentities') && u.includes('Q61109')) {
          const payload = { entities: { Q61109: {
            labels: { it: { language: 'it', value: 'Oskar Barnack' }, en: { language: 'en', value: 'Oskar Barnack' } },
            aliases: {},
            claims: { P269: [{ mainsnak: { datavalue: { value: '148517846' } } }] }
          } } };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
        throw new Error('no network in tests: ' + u);
      }
      // Canned IdRef Solr types: the period «Renaissance» (x, chronological
      // descriptor) and a person heading with the same wording (a).
      if (u.startsWith('https://www.idref.fr/Sru/Solr')) {
        const SOLR = { PPN_REN_X: 'x', PPN_REN_A: 'a' };
        const ppn = Object.keys(SOLR).find(k => u.includes('ppn_z:' + k));
        if (ppn) {
          const payload = { response: { docs: [{ ppn_z: ppn, affcourt_z: 'Renaissance', recordtype_z: SOLR[ppn] }] } };
          return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
        }
      }
      // Canned IdRef person record carrying co-references: VIAF in 035
      // (single-subfield, non-array shape on purpose) and ISNI in 010.
      if (u === 'https://www.idref.fr/PPNVIAF1.json') {
        const payload = { record: { datafield: [
          { tag: '035', subfield: { code: 'a', content: '(VIAF)45191303' } },
          { tag: '010', subfield: [{ code: 'a', content: '0000000016583504' }] }
        ] } };
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
      }
      throw new Error('no network in tests: ' + u);
    }
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['bg_util.js', 'bg_site.js', 'bg_net.js', 'bg_index.js', 'bg_reconcile.js', 'background.js']) {
    vm.runInContext(stripModule(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  }
  return ctx;
}

// ── 1. Smoke tests ───────────────────────────────────────────
section('smoke test: module loading');
let C, W;
try { C = makeContentContext(); check('8 content scripts load without errors', true); }
catch (e) { check('8 content scripts load without errors', false, e.message); }
try { W = makeWorkerContext(); check('6 worker modules load without errors', true); }
catch (e) { check('6 worker modules load without errors', false, e.message); }
if (!C || !W) { console.error('\nSmoke test failed, unit tests skipped.'); process.exit(1); }

const $ = expr => vm.runInContext(expr, C);
const $w = expr => vm.runInContext(expr, W);

(async () => {

  // ── 2. BAAM class number parsing (content) ────────────────────────
  section('reduced DDC table: four languages');
  {
    const cdd = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab_cdd.json'), 'utf8'));
    const gaps = Object.entries(cdd).flatMap(([n, e]) => ['it', 'de', 'fr', 'en'].filter(l => !e.label[l]).map(l => n + ':' + l));
    check('every DDC group has it/de/fr/en labels', gaps.length === 0, gaps.slice(0, 10));
    check('French label from Annex D', cdd['060'].label.fr === 'Associations, organisations, muséologie', cdd['060'].label);
    check('Italian aligned to Annex D, its typos corrected', cdd['010'].label.it === 'Bibliografie' && cdd['004'].label.it === 'Informatica' && cdd['800'].label.it === 'Letteratura' && cdd['600'].label.it === 'Tecnologia, medicina, scienze applicate', [cdd['010'].label.it, cdd['004'].label.it, cdd['800'].label.it, cdd['600'].label.it]);
    check('German word breaks repaired', !Object.values(cdd).some(e => /[a-zäöü]-[a-zäöü]/.test(e.label.de)), Object.values(cdd).filter(e => /[a-zäöü]-[a-zäöü]/.test(e.label.de)).map(e => e.label.de));
  }

  section('classParseNum');
  let r = $(`classParseNum('720.011(494.51)(091)')`);
  check('compound base', r.base === '720.011' && r.rel === null && r.slash === null, r);
  check('auxiliaries extracted', JSON.stringify(r.aux) === '["(494.51)","(091)"]', r.aux);
  r = $(`classParseNum('720.017(450.52/494.4)')`);
  check('slash-compound auxiliary expanded', JSON.stringify(r.aux) === '["(450.52)","(494.4)"]', r.aux);
  check('rawAux preserved', JSON.stringify(r.rawAux) === '["(450.52/494.4)"]', r.rawAux);
  r = $(`classParseNum('016:700')`);
  check('colon relation', r.base === '016' && r.rel === '700', r);
  r = $(`classParseNum('400/500')`);
  check('slash range', r.base === '400' && JSON.stringify(r.slash) === '["400","500"]', r);

  section('geographic ranges');
  r = $(`classParseNum('730.033.5(450.2/.4)', { '(450.2/.4)': { label: { it: 'Italia settentrionale' } } }).aux`);
  check('a range with its own table entry stays whole', JSON.stringify(r) === '["(450.2/.4)"]', r);
  r = $(`classParseNum('725.822(461.1/.4)', {}).aux`);
  check('a range without entry is split, relative end rebuilt', JSON.stringify(r) === '["(461.1)","(461.4)"]', r);
  r = $(`classParseNum('720.034.7(46/8)', {}).aux`);
  check('a range of two full codes is split as written', JSON.stringify(r) === '["(46)","(8)"]', r);

  section('classBuildWildcard');
  check("'700' → '7*'", $(`classBuildWildcard('700')`) === '7*');
  check("'720' → '72*'", $(`classBuildWildcard('720')`) === '72*');
  check("'721' → '721*'", $(`classBuildWildcard('721')`) === '721*');
  check("'720.017' → '720.017*'", $(`classBuildWildcard('720.017')`) === '720.017*');

  // ── 3. MARC formatting (content) ───────────────────────────
  section('MARC formatting');
  r = $(`sbtC([{c:'a',v:'Architettura'},{c:'x',v:'Restauro'},{c:'v',v:'Guide.'}])`);
  check('sbtC typing', JSON.stringify(r) === JSON.stringify([{ t: 'Architettura', type: 'a' }, { t: 'Restauro', type: 'x' }, { t: 'Guide', type: 'v' }]), r);
  r = $(`sbtC([{c:'a',v:'Chiese [e] Conventi'}])`);
  check('sbtC bracket-connector split', JSON.stringify(r.map(x => x.t)) === '["Chiese","Conventi"]', r);
  check('sbtD', $(`sbtD([{c:'a',v:'Architettura'},{c:'x',v:'Restauro'},{c:'v',v:'Guide.'}])`) === 'Architettura — Restauro — Guide');
  check('corpD', $(`corpD([{c:'a',v:'Politecnico di Milano.'},{c:'b',v:'Dipartimento di architettura,'}])`) === 'Politecnico di Milano — Dipartimento di architettura');
  check('meetD', $(`meetD([{c:'a',v:'Biennale di Venezia.'},{c:'n',v:'18.'},{c:'d',v:'2023.'}])`) === 'Biennale di Venezia (18 : 2023)');
  check('meetD repeated subordinate units', $(`meetD([{c:'a',v:'Congresso internazionale.'},{c:'e',v:'Comitato organizzatore.'},{c:'e',v:'Programma culturale.'}])`) === 'Congresso internazionale — Comitato organizzatore — Programma culturale');
  check('630 uniform title keeps identity qualifiers', $(`uniformTitleD([{c:'a',v:'Bibbia.'},{c:'p',v:'Nuovo Testamento.'},{c:'l',v:'Italiano.'}])`) === 'Bibbia — Nuovo Testamento — Italiano');
  r = $(`extractAll([{tag:'630',subs:[{c:'a',v:'Bibbia.'},{c:'p',v:'Nuovo Testamento.'},{c:'0',v:'(IDREF)123'},{c:'2',v:'idref'}]},{tag:'655',subs:[{c:'a',v:'Ausstellungskatalog'},{c:'0',v:'(DE-588)4001'},{c:'2',v:'gnd-content'}]}])`);
  check('630 IdRef extracted as a work subject', r.idr.length === 1 && r.idr[0].tag === '630' && r.idr[0].term.includes('Nuovo Testamento'), r.idr);
  check('655 GND-content goes to forms, not to subjects', r.gnd.length === 0 && r.forms.length === 1 && r.forms[0].source === 'gnd' && r.forms[0].gndId === '4001', r);

  section('legacy headings without $0, forms apart');
  r = $(`extractAll([
    {tag:'650',subs:[{c:'a',v:'Geschichte'},{c:'0',v:'(DE-588)4020517-4'},{c:'2',v:'gnd'}]},
    {tag:'648',subs:[{c:'a',v:'Geschichte 1921-2012'},{c:'2',v:'gnd'}]},
    {tag:'650',subs:[{c:'a',v:'Kopfschmerz.'},{c:'2',v:'gnd'}]},
    {tag:'650',subs:[{c:'a',v:'18e siècle-20e siècle'},{c:'2',v:'idref'}]},
    {tag:'600',subs:[{c:'a',v:'Petrarca, Francesco'},{c:'2',v:'gnd'}]},
    {tag:'650',subs:[{c:'a',v:'Architettura'},{c:'2',v:'sbt12'}]},
    {tag:'655',subs:[{c:'a',v:'Festschrift'},{c:'2',v:'gnd-content'}]},
    {tag:'655',subs:[{c:'a',v:'DVD-Video'},{c:'2',v:'gnd-carrier'}]},
    {tag:'655',subs:[{c:'a',v:'Text'},{c:'2',v:'gnd'}]},
    {tag:'655',subs:[{c:'a',v:'Guides'},{c:'2',v:'idref'}]},
    {tag:'655',subs:[{c:'a',v:"Catalogues d'exposition"},{c:'0',v:'(IDREF)027241947'},{c:'2',v:'idref'}]},
    {tag:'655',subs:[{c:'a',v:'Cataloghi di esposizioni'},{c:'2',v:'sbt12-content'}]}
  ])`);
  check('GND/IdRef subjects without their $0 are left out (only Geschichte with id remains)',
    r.gnd.length === 1 && r.gnd[0].gndId === '4020517-4' && r.idr.length === 0, { gnd: r.gnd.map(x => x.term), idr: r.idr.map(x => x.term) });
  check('SBT subjects are unaffected (no $0 expected)', r.sbt.length === 1, r.sbt);
  check('forms: gnd-content, gnd-carrier and sbt-content kept without $0; IdRef and plain gnd need their id',
    JSON.stringify(r.forms.map(f => f.term)) === JSON.stringify(['Festschrift', 'DVD-Video', "Catalogues d'exposition", 'Cataloghi di esposizioni']),
    r.forms.map(f => f.term));
  r = $(`subjectC([{c:'a',v:'Bibbia.'},{c:'p',v:'Nuovo Testamento.'},{c:'x',v:'Critica'}], '630')`);
  check('630 component root preserves uniform-title identity', r[0].t === 'Bibbia — Nuovo Testamento' && r[1].type === 'x', r);
  check('MARC subject typing includes period, work and form', $(`subjectComponentTermType({type:'a'}, '648')`) === 'period' && $(`subjectComponentTermType({type:'a'}, '630')`) === 'work' && $(`subjectComponentTermType({type:'a'}, '655')`) === 'form');
  check('namD with dates', $(`namD([{c:'a',v:'Botta, Mario,'},{c:'d',v:'1943-'}])`) === 'Botta, Mario, (1943-)');
  // $b (numeration) is part of the name: «Johannes Paulus papa» lost its «2».
  check('namD with $b numeration', $(`namD([{c:'a',v:'Johannes Paulus'},{c:'b',v:'2'},{c:'c',v:'papa'},{c:'d',v:'1920-2005'}])`) === 'Johannes Paulus 2 papa (1920-2005)',
    $(`namD([{c:'a',v:'Johannes Paulus'},{c:'b',v:'2'},{c:'c',v:'papa'},{c:'d',v:'1920-2005'}])`));
  check('namD with $b, GND form', $(`namD([{c:'a',v:'Johannes Paul'},{c:'b',v:'II.'},{c:'c',v:'Papst'},{c:'d',v:'1920-2005'}])`) === 'Johannes Paul II. Papst (1920-2005)');
  check('nameC root chip keeps $b', $(`nameC([{c:'a',v:'Johannes Paul'},{c:'b',v:'II'},{c:'c',v:'pape'},{c:'x',v:'Critique et interprétation'}], 'person')[0].t`) === 'Johannes Paul II pape');
  check('cleanName', $(`cleanName('Botta, Mario (1943- )')`) === 'Botta, Mario');
  check('invertName', $(`invertName('Botta, Mario')`) === 'Mario Botta');
  check('initials', $(`initials('Botta, Mario')`) === 'BM');
  check('exG', $(`exG([{c:'0',v:'(DE-588)118514768'}])`) === '118514768');
  check('exI', $(`exI([{c:'0',v:'(IDREF)027290905'}])`) === '027290905');
  r = $(`extractAll([
    {tag:'100',subs:[{c:'6',v:'880-01/$1'},{c:'a',v:'Bruni, Francesca'},{c:'0',v:'(DE-588)123'},{c:'e',v:'author'},{c:'4',v:'aut'}]},
    {tag:'880',subs:[{c:'6',v:'100-01/$1'},{c:'a',v:'Francesca Bruni'},{c:'0',v:'(IDREF)456'},{c:'4',v:'cre'}]}
  ]).names[0]`);
  check('linked 880 name pair merged once', r && r.tags.length === 1 && r.tag === '100', r);
  check('linked 880 complementary IDs retained', r.gndId === '123' && r.idrefId === '456', r);
  check('linked 880 all relators retained', r.relators.length === 3 && r.relators.some(x => x.value === 'cre'), r.relators);
  check('linked 880 label variants retained', r.variants.length === 2, r.variants);
  $(`VOCAB_RELATORS = { aut: { label: 'Author', uri: 'http://id.loc.gov/vocabulary/relators/aut' }, cre: { label: 'Creator', uri: 'http://id.loc.gov/vocabulary/relators/cre' } }`);
  r = $(`responsibilityLabel({tag:'100',relators:[{source:'$4',value:'aut'},{source:'$4',value:'http://id.loc.gov/vocabulary/relators/aut'},{source:'$4',value:'cre'}]})`);
  check('LoC code and URI deduplicated, multiple roles displayed', r === 'Author [aut]; Creator [cre]', r);
  check('missing 100 relator gets primary-responsibility fallback', $(`responsibilityLabel({tag:'100',relators:[]})`) === $(`L.responsibilityPrimary`));
  check('missing 700 relator gets added-responsibility fallback', $(`responsibilityLabel({tag:'700',relators:[]})`) === $(`L.responsibilityAdded`));

  section('MARC 880 linkage');
  r = $(`extractAll([
    {tag:'880',subs:[{c:'6',v:'700-00/$1'},{c:'a',v:'Primo, Nome'}]},
    {tag:'880',subs:[{c:'6',v:'700-00/$1'},{c:'a',v:'Secondo, Nome'}]}
  ]).names`);
  check('880 occurrence 00 is not a merge key (two unlinked names stay two)', r.length === 2, r.map(n => n.name));
  r = $(`extractAll([
    {tag:'710',subs:[{c:'6',v:'880-07'},{c:'a',v:'Ente A'},{c:'0',v:'(DE-588)111'}]},
    {tag:'880',subs:[{c:'6',v:'710-07'},{c:'a',v:'Ente B'},{c:'0',v:'(DE-588)222'}]}
  ]).names`);
  check('linked pair with two different GND ids is not merged', r.length === 2 && r[0].gndId === '111' && r[1].gndId === '222', r);

  section('combined search');
  $(`searchCtx = { host: 'h.ch', vid: 'a:b', tab: 't', scope: 's' }`);
  const q = u => decodeURIComponent(u.split('query=sub,contains,')[1].split('&')[0]);
  r = q($(`buildCrossAndUrl([
    { label: 'A', controlledLabels: { it: 'A', de: 'A-de' } },
    { label: 'B', controlledLabels: { it: 'B' } },
    { label: 'C', controlledLabels: { it: 'C', de: 'C-de' } }
  ], 'subject')`));
  check('every language branch contains every selected concept',
    r === '("A" AND "B" AND "C") OR ("A-de" AND "B" AND "C-de")', r);
  r = q($(`buildCrossAndUrl([
    { label: 'Heiliger Geist', controlledLabels: { de: 'Heiliger Geist' } },
    { label: 'Saint-Esprit', controlledLabels: { fr: 'Saint-Esprit' } }
  ], 'subject')`));
  check('concept without a label in a language keeps its record form',
    r === '("Heiliger Geist" AND "Saint-Esprit")', r);
  r = q($(`buildCrossAndUrl([
    { label: 'Nome ipotetico', wdMatch: 'unverified', controlledLabels: { it: 'Nome ipotetico', de: 'WD-Label' },
      entity: { labels: { en: { value: 'WD English' } } } },
    { label: 'Architettura', controlledLabels: { it: 'Architettura', de: 'Architektur' } }
  ], 'subject')`));
  check('unverified Wikidata hypothesis adds no labels to the AND',
    !r.includes('WD-Label') && !r.includes('WD English') && r.includes('"Nome ipotetico" AND "Architektur"'), r);
  r = $(`(function(){
    const sbt = { label: 'Organi di senso', vocabSource: 'sbt', nsData: { id: '5222' }, controlledLabels: { it: 'Organi di senso', de: 'Sinnesorgan', fr: 'Organes des sens' } };
    const gnd = { label: 'Sinne', vocabSource: 'gnd', nsData: { id: '5222' }, controlledLabels: { it: 'Organi di senso', de: 'Sinne', fr: 'Organes des sens' } };
    const arte = { label: 'Arte', vocabSource: 'sbt', nsData: { id: '1' }, controlledLabels: { it: 'Arte', de: 'Kunst' } };
    const items = andChipItems([arte, sbt, gnd]);
    return { n: items.length, sib: items[1].andSiblings.map(x => x.label),
      url: buildCrossAndUrl([items[0], items[1]], 'subject'), single: andChipLabels(items[1]) };
  })()`);
  check('two headings of one concept: one chip that keeps both wordings',
    r.n === 2 && JSON.stringify(r.sib) === '["Sinne"]', r);
  check('combined search ORs the record forms of the same concept',
    q(r.url) === '("Arte" AND "Organi di senso") OR ("Kunst" AND ("Sinnesorgan" OR "Sinne")) OR ("Arte" AND "Organes des sens")', q(r.url));
  check('single-chip search includes the sibling heading', Object.values(r.single).includes('Sinne') && Object.values(r.single).includes('Sinnesorgan'), r.single);
  r = q($(`buildCatUrl(null, null, { it: 'Il "Grande" viaggio' }, 'subject')`));
  check('internal quotes cannot break the Primo phrase', r === '"Il Grande viaggio"', r);
  r = $(`(function(){ const a = { qid: 'Q9', nsData: { id: '1' }, controlledLabels: { it: 'uno' } };
    const b = { qid: 'Q9', nsData: { id: '2' }, controlledLabels: { it: 'due', de: 'Zwei' } };
    const c = { qid: 'Q9', controlledLabels: { fr: 'Neuf' } };
    mergeByQid([a, b, c]); return [a.mergedLabels, b.mergedLabels]; })()`);
  check('two NS concepts sharing a QID do not exchange labels', r[0].it === 'uno' && !r[0].de && r[1].it === 'due', r);
  check('a result without NS id still completes missing languages', r[0].fr === 'Neuf' && r[1].fr === 'Neuf', r);

  section('a name-found Wikidata item confirmed by the record');
  r = $(`(function(){
    const mk = (o) => Object.assign({ route: [], controlledLabels: {} }, o);
    const sbt = mk({ label: 'Europa', vocabSource: 'sbt', termType: 'place', qid: 'Q46', wdMatch: 'unverified' });
    const gnd = mk({ label: 'Europa', vocabSource: 'gnd', termType: 'place', qid: 'Q46', gndId: '4015701-5' });
    const idr = mk({ label: 'Europe', vocabSource: 'idref', termType: 'place', qid: 'Q46', idrefId: '027224651' });
    const topic = mk({ label: 'Mercurio', vocabSource: 'sbt', termType: 'topic', qid: 'Q308', wdMatch: 'unverified' });
    const planetName = mk({ label: 'Merkur', vocabSource: 'gnd', termType: 'person', qid: 'Q308', gndId: 'G-X' });
    const hyp2 = mk({ label: 'Roma', vocabSource: 'sbt', termType: 'place', qid: 'Q220', wdMatch: 'unverified' });
    const hyp3 = mk({ label: 'Rome', vocabSource: 'sbt', termType: 'place', qid: 'Q220', wdMatch: 'unverified' });
    const ns = mk({ label: 'Arte', vocabSource: 'sbt', termType: 'topic', qid: 'Q735', wdMatch: 'unverified', nsData: { id: '1' } });
    const nsTwin = mk({ label: 'Kunst', vocabSource: 'gnd', termType: 'topic', qid: 'Q735', gndId: '4114333-4' });
    const c = confirmByRecord([sbt, gnd, topic, planetName, hyp2, hyp3, ns, nsTwin]);
    const c2 = confirmByRecord([mk({ label: 'Europa', vocabSource: 'sbt', termType: 'place', qid: 'Q46', wdMatch: 'unverified' }), idr]);
    return { c: c.map(x => x.label), by: sbt.wdConfirmedBy, trusted: hasTrustedQid(sbt), c2: c2.map(x => x.wdConfirmedBy),
      chips: andChipItems([sbt, gnd]).length };
  })()`);
  check('SBT «Europa» by name → Q46 confirmed by GND «Europa» (4015701-5 → Q46), stated on the card',
    JSON.stringify(r.c) === '["Europa"]' && r.by.vocab === 'GND' && r.by.id === '4015701-5' && r.trusted, r);
  check('wording may differ: confirmed by IdRef «Europe»', r.c2.length === 1 && r.c2[0].vocab === 'IdRef' && r.c2[0].id === '027224651', r.c2);
  check('not confirmed: other kind (topic vs name), by another name-only hypothesis, or already an NS concept',
    !r.c.includes('Mercurio') && !r.c.includes('Roma') && !r.c.includes('Rome') && !r.c.includes('Arte'), r.c);
  check('confirmed: one combined-search chip with the GND heading (same item)', r.chips === 1, r.chips);
  check('the confirmation is named in the four interface languages',
    ['it', 'de', 'fr', 'en'].every(l => { $(`setLang('${l}')`); return typeof $(`L.wdRecord`) === 'string' && $(`L.wdRecord`).length > 10; }));
  $(`setLang('it')`);

  section('several IdRef ids in Wikidata — the record IdRef heading first');
  r = $(`(function(){
    const P = v => ({ mainsnak: { datavalue: { value: v } } });
    const italien = { label: 'Italien', vocabSource: 'gnd', gndId: '4027833-5', termType: 'place', qid: 'Q38',
      entity: { claims: { P269: [P('026389908'), P('027235408')] } }, controlledLabels: { de: 'Italien' } };
    const italie = { label: 'Italie', vocabSource: 'idref', idrefId: '027235408', termType: 'place', controlledLabels: { fr: 'Italie' } };
    const lone = { label: 'Japan', vocabSource: 'gnd', gndId: '4028495-5', termType: 'place', qid: 'Q17', idrefWd: '027262162',
      entity: { claims: { P269: [P('02648918X'), P('027262162')] } }, controlledLabels: { de: 'Japan' } };
    if (typeof preferRecordIdref === 'function') preferRecordIdref([italien, italie, lone]);
    return { it: navIdentity(italien).ii, fr: italien.controlledLabels.fr, jp: navIdentity(lone).ii };
  })()`);
  check('Italien: the IdRef id of the record heading «Italie» among the two of Q38, with its French form',
    r.it === '027235408' && r.fr === 'Italie', r);
  check('Japan (no IdRef heading in the record): the id chosen by kind in the worker', r.jp === '027262162', r);

  section('Wikidata labels still feed the search where the thesauri have no term');
  // Subject search is textual; NS «Discipline umanistiche» has no GND
  // or RAMEAU heading, so the Wikidata labels give the other languages.
  r = $(`decodeURIComponent(buildCatUrl({ labels: { de: { value: 'Humanities' }, fr: { value: 'humanités' } } }, 'Discipline umanistiche', { it: 'Discipline umanistiche', en: 'Humanities' }, 'subject'))`);
  check('search: NS term + Wikidata de/fr labels', r.includes('Discipline umanistiche') && r.includes('humanités'), r);

  section('navigation chips');
  r = $(`navChipTerms([
    { label: 'Kirche', qid: 'Q34651', nsData: { id: '767' } },
    { label: 'Église', qid: 'Q34651', nsData: { id: '767' } },
    { label: 'Eucharistie', nsData: { id: '6011' } },
    { label: 'Eucharistie', nsData: { id: '6011' } }
  ]).map(t => t.label)`);
  check('a heading leading to an already shown concept keeps its chip (Église after Kirche)',
    JSON.stringify(r) === '["Kirche","Église","Eucharistie"]', r);
  // Record 999688596905507: three «Design», two concepts.
  r = $(`(function(){ const u = navChipTerms([
    { label: 'Design', vocabSource: 'sbt', nsData: { id: '6075' } },
    { label: 'Design', vocabSource: 'gnd', nsData: null },
    { label: 'Design', vocabSource: 'idref', nsData: null },
    { label: 'Kirche', vocabSource: 'gnd', nsData: { id: '767' } } ]);
    return u.map(t => t.label + (u.tags.get(t) ? ' · ' + u.tags.get(t) : '')); })()`);
  check('same wording, different concepts: separate chips named by vocabulary (Design)',
    JSON.stringify(r) === '["Design · NS","Design · GND/IdRef","Kirche"]', r);
  // Record 990007025790205507 — GND «Architektur» (4002851-3,
  // NS Architettura) and «Architektur $g Motiv» (4112586-1): two chips that
  // both read «Architektur · GND». The qualifier is shown, never searched.
  r = $(`(function(){
    const x = extractAll([
      {tag:'650',subs:[{c:'a',v:'Architektur'},{c:'0',v:'(DE-588)4002851-3'},{c:'2',v:'gnd'}]},
      {tag:'650',subs:[{c:'a',v:'Architektur'},{c:'g',v:'Motiv'},{c:'0',v:'(DE-588)4112586-1'},{c:'2',v:'gnd'}]} ]);
    const terms = x.gnd.map(i => ({ label: i.display, qualifier: i.qual || null, vocabSource: 'gnd', gndId: i.gndId,
      nsData: i.gndId === '4002851-3' ? { id: '1234' } : null }));
    const u = navChipTerms(terms);
    return { terms: x.gnd.map(i => i.term), chips: u.map(t => (typeof navLabel === 'function' ? navLabel(t) : t.label) + (u.tags.get(t) ? ' · ' + u.tags.get(t) : '')) };
  })()`);
  check('GND $g qualifier: the searched word stays «Architektur», the chip reads «Architektur <Motiv>» (no twin «· GND» chips)',
    JSON.stringify(r.terms) === '["Architektur","Architektur"]' && JSON.stringify(r.chips) === '["Architektur","Architektur <Motiv>"]', r);
  check('qualifier written in the convention of each vocabulary',
    $(`typeof qualifiedLabel === 'function' && qualifiedLabel('Mercure', 'planète', 'idref') === 'Mercure (planète)' && qualifiedLabel('Architektur', null, 'gnd') === 'Architektur'`));
  r = $(`navChipTerms([{ label: 'Architettura' }, { label: 'Festschrift', termType: 'form' }]).map(t => t.label)`);
  check('forms get no navigation chip', JSON.stringify(r) === '["Architettura"]', r);
  // Record 990000557870205507 — SBT «Europa» (found by name,
  // unverified) comes before GND «Europa» (id → Q46): the chip carries the GND one.
  r = $(`(function(){
    const sbt = { label: 'Europa', vocabSource: 'sbt', termType: 'place', qid: 'Q46', wdMatch: 'unverified', route: ['WD-text'] };
    const gnd = { label: 'Europa', vocabSource: 'gnd', termType: 'place', qid: 'Q46', gndId: '4015701-5', route: ['GND→WD'] };
    const u = navChipTerms([sbt, gnd]);
    return { n: u.length, gnd: u[0] === gnd, target: navTarget(u[0]) };
  })()`);
  check('same wording, no NS concept: one chip, carrying the heading with an id (not the name-only hypothesis)',
    r.n === 1 && r.gnd && r.target.gi === '4015701-5' && r.target.q === 'Q46', r);
  r = $(`(function(){
    const calls = []; const orig = safeReconcile;
    safeReconcile = async (...a) => { calls.push(a); return {}; };
    RC.clear(); RC.set(rck('sec. 19.-20', null, null, 'sbt', 'period'), { label: 'Sec. 19.-20' });
    const t = navTarget({ label: 'Sec. 19.-20', vocabSource: 'sbt', termType: 'period', route: [] });
    safeReconcile = orig; RC.clear();
    return { calls: calls.length, t };
  })()`);
  check('a chip without identity is not reconciled again at the click (Subjects already did it)',
    r.calls === 0 && !r.t.q && !r.t.gi && !r.t.ii, r);

  section('chip order = searched order');
  {
    // Minimal DOM: renderAndBuilder draws chips; updateAndBuilder reads them back.
    const made = [];
    const mk = (tag) => {
      const node = { tag, children: [], attrs: {}, style: {}, textContent: '',
        classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
          contains(c) { return this._s.has(c); }, toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } },
        appendChild(ch) { this.children.push(ch); return ch; }, setAttribute(k, v) { this.attrs[k] = v; },
        remove() {}, get firstChild() { return this.children[0] || null; }, get childNodes() { return this.children; },
        removeChild(ch) { this.children = this.children.filter(x => x !== ch); },
        addEventListener() {}, querySelectorAll() { return []; } };
      Object.defineProperty(node, 'className', { set(v) { String(v).split(/\s+/).filter(Boolean).forEach(c => node.classList.add(c)); }, get() { return [...node.classList._s].join(' '); } });
      made.push(node); return node;
    };
    const container = mk('div'); container.id = 'sn-crossAnd';
    const resultBox = { value: null };
    const sidebar = { querySelectorAll: () => made.filter(n => n.classList.contains('and-chip')) };
    C.document.createElement = mk;
    C.document.createTextNode = t => ({ textContent: t });
    const origById = $(`byId`);
    C.__byId = id => id === 'sn-sidebar' ? sidebar : id === 'sn-crossAnd' ? container
      : id === 'sn-and-result' ? (resultBox.value || (resultBox.value = made.find(n => n.id === 'sn-and-result') || null)) : null;
    $(`byId = id => __byId(id)`);
    $(`allReconciledResults = [
      { label: 'Architettura', termType: 'topic', controlledLabels: { it: 'Architettura' } },
      { label: 'Cataloghi di esposizioni', termType: 'form', controlledLabels: { it: 'Cataloghi di esposizioni' } },
      { label: 'Italia', termType: 'place', controlledLabels: { it: 'Italia' } }
    ]; allNameResults = [];`);
    try {
      $(`renderAndBuilder(__byId('sn-crossAnd'))`);
      const btn = made.find(n => n.attrs && n.classList.contains('act-pri'));
      const url = btn ? (btn['data-url'] || btn.attrs['data-url'] || '') : '';
      const query = url ? q(url) : '';
      check('default AND = the two ticked chips (Architettura, Italia), not the form',
        query === '("Architettura" AND "Italia")', query || made.filter(n => n.classList.contains('and-chip')).length);
    } catch (e) {
      check('renderAndBuilder with minimal DOM', false, e.message);
    }
    // More than 3 broader terms are folded (Industrialisierung had 6).
    try {
      if (!C.Node) C.Node = function Node() {};   // el() checks `instanceof Node` for children
      const fold = n => {
        const box = mk('div');
        C.__box = box;
        // sorted best first, as getHierarchy returns them
        C.__bts = Array.from({ length: n }, (_, i) => ({ type: 'bt', label: 'B' + i, srcs: ['NS'], nsTid: 'T' + i, langs: { it: 'B' + i } }));
        $(`navState = { history: [], currentIndex: -1 }`);
        $(`rDynHier(__box, __bts, 'Industrialisierung', null, null, null, null, { label: 'Industrialisierung', controlledLabels: {} })`);
        const kids = box.children;
        const rows = kids.filter(k => k.classList.contains('cl-row') && !k.classList.contains('cl-selected'));
        const shown = rows.filter(k => k.attrs['data-sn-extra'] !== 'bt');
        return { rows: rows.length, hidden: rows.filter(k => k.attrs['data-sn-extra'] === 'bt').length,
                 more: kids.findIndex(k => k.classList.contains('show-more') && k.attrs['data-group'] === 'bt'),
                 firstRow: kids.findIndex(k => rows.includes(k)),
                 shown: shown.map(k => k.attrs['data-label']),
                 sel: kids.findIndex(k => k.classList.contains('cl-selected')) };
      };
      let f = fold(6);
      check('6 broader terms: the 3 best shown right above the selected term (best last), 3 folded above',
        f.rows === 6 && f.hidden === 3 && JSON.stringify(f.shown) === '["B2","B1","B0"]', f);
      check('«Show all» sits above the folded terms (opens upwards)', f.more > 0 && f.more < f.firstRow && f.firstRow < f.sel, f);
      f = fold(4);
      check('4 broader terms: nothing folded (never fold a single one)', f.rows === 4 && f.hidden === 0 && f.more === -1, f);
      // A Wikidata/AAT term shows IT, DE, FR side by side and EN
      // below, in cards named by language (it showed only the Italian label).
      {
        const box = mk('div'); C.__box = box;
        C.__bts = [{ type: 'bt', label: 'arti visive', srcs: ['AAT'], langs: { it: 'arti visive', de: 'bildende Kunst', fr: 'arts visuels', en: 'visual arts' } }];
        $(`navState = { history: [], currentIndex: -1 }`);
        $(`rDynHier(__box, __bts, 'Architektur', null, null, null, null, { label: 'Architektur', controlledLabels: {} })`);
        const tx = n => [n.textContent || ''].concat((n.children || []).map(tx)).join('|');
        const row = box.children.find(k => k.classList.contains('cl-secondary'));
        const t = row ? tx(row) : '';
        check('AAT term: IT/DE/FR cards and «en» below, no NS/GND/IdRef card',
          ['IT', 'arti visive', 'DE', 'bildende Kunst', 'FR', 'arts visuels', 'en visual arts'].every(w => t.includes(w)) && !/\|(NS|GND|IdRef)\|/.test(t), t);
      }
      // A Wikidata/AAT term without an
      // Italian, German or French label (only «en disciplines») is not drawn:
      // three empty cards say nothing.
      {
        const box = mk('div'); C.__box = box;
        C.__bts = [{ type: 'bt', label: 'disciplines', srcs: ['AAT'], langs: { en: 'disciplines' } },
                   { type: 'bt', label: 'scienze umane e sociali', srcs: ['WD'], langs: { it: 'scienze umane e sociali', en: 'social sciences and humanities' } }];
        $(`navState = { history: [], currentIndex: -1 }`);
        $(`rDynHier(__box, __bts, 'Discipline umanistiche', null, null, null, null, { label: 'Discipline umanistiche', controlledLabels: {} })`);
        const rows = box.children.filter(k => k.classList.contains('cl-secondary')).map(k => k.attrs['data-label']);
        check('WD/AAT term with only English: not drawn; with Italian: drawn', JSON.stringify(rows) === JSON.stringify(['scienze umane e sociali']), rows);
      }
    } catch (e) {
      check('rDynHier with minimal DOM', false, e.message);
    }
    // A place outside NS — the SBN link gets the Italian Wikidata
    // label (marked), the IdRef card the twin of the BnF ark; never from a
    // text-search hypothesis.
    try {
      const texts = n => [n.textContent || ''].concat((n.children || []).map(texts)).join('');
      const card = (box, cls) => { const found = []; const walk = n => { if (n.classList && n.classList.contains(cls)) found.push(n); (n.children || []).forEach(walk); }; walk(box); return found[0]; };
      const europa = wdMatch => {
        const box = mk('div'); C.__box = box;
        C.__sel = { label: 'Europa', termType: 'place', qid: 'Q46', wdMatch, gndId: '4015701-5', idrefTwin: '027224651',
          controlledLabels: { de: 'Europa', fr: 'Europe' },
          entity: { labels: { it: { value: 'Europa' } }, claims: { P10397: [{ mainsnak: { datavalue: { value: 'NAPL001016' } } }] } } };
        $(`navState = { history: [], currentIndex: -1 }`);
        $(`rDynHier(__box, [], 'Europa', 'Q46', null, '4015701-5', null, __sel)`);
        return { sbn: texts(card(box, 'vc-sbn') || {}), idrefLink: (card(box, 'vc-idr') || { classList: { contains: () => false } }).classList.contains('vc-link') };
      };
      let e = europa(null);
      check('place reached through an id: SBN card named «Europa (Wikidata)», IdRef card linked (twin of the ark)',
        e.sbn.includes('Europa') && e.sbn.includes('(Wikidata)') && e.idrefLink, e);
      e = europa('unverified');
      check('text-search hypothesis: no Wikidata name in the SBN card', !e.sbn.includes('Europa'), e);
      // The «Selected» title shows the qualifier of the heading.
      {
        const box = mk('div'); C.__box = box;
        C.__sel = { label: 'Architektur', qualifier: 'Motiv', vocabSource: 'gnd', gndId: '4112586-1', controlledLabels: { de: 'Architektur' } };
        $(`navState = { history: [], currentIndex: -1 }`);
        $(`rDynHier(__box, [], 'Architektur', null, null, '4112586-1', null, __sel)`);
        check('Selected title: «Architektur <Motiv>»', texts(box).includes('Architektur <Motiv>'), texts(box).slice(0, 120));
      }
      // The «→ …» next to the selected title is the heading in the
      // interface language, never the Italian one under another interface,
      // and nothing when there is no such heading or it is the title itself.
      {
        const arrow = (lang, title, labels) => {
          const box = mk('div'); C.__box = box;
          C.__sel = { label: title, controlledLabels: labels, nsData: labels.it ? { id: '1526', label: labels.it } : null };
          $(`window.location.search = '?lang=${lang}'`);
          $(`navState = { history: [], currentIndex: -1 }`);
          $(`rDynHier(__box, [], ${JSON.stringify(title)}, null, null, null, null, __sel)`);
          $(`window.location.search = ''`);
          return texts(box).includes('→ ') ? texts(box).split('→ ')[1].slice(0, 40) : null;
        };
        const PH = { it: 'Fotografia', de: 'Fotografie', fr: 'Photographie' };
        let a = arrow('fr', 'Photographie', PH);
        check('arrow, French interface, French title: none', a === null, a);
        a = arrow('fr', 'Fotografie', PH);
        check('arrow, French interface, German title: → Photographie', a && a.startsWith('Photographie'), a);
        a = arrow('it', 'Fotografie', PH);
        check('arrow, Italian interface, German title: → Fotografia (as before)', a && a.startsWith('Fotografia'), a);
        a = arrow('fr', 'Fotografie', { it: 'Fotografia', de: 'Fotografie' });
        check('arrow, French interface, no French heading: none (no Italian fallback)', a === null, a);
      }
      // The Wikidata description in the interface language
      // only, in both tabs (Italia under a French interface showed «stato
      // dell'Europa meridionale…»; Verzweiflung, without it/fr, the English one).
      {
        const ENT = { Q38: { descriptions: { it: { value: "stato dell'Europa meridionale" }, fr: { value: "pays d'Europe du Sud" }, en: { value: 'country in southern Europe' } } },
                      Q1747066: { descriptions: { de: { value: 'Zustand völliger Hoffnungslosigkeit' }, en: { value: 'feeling that there is no hope' } } } };
        const nav = (lang, q) => {
          $(`window.location.search = '?lang=${lang}'`);
          const box = mk('div'); C.__box = box;
          C.__sel = { label: 'X', termType: 'place', qid: q, gndId: 'G1', controlledLabels: { de: 'X' }, entity: ENT[q] };
          $(`navState = { history: [], currentIndex: -1 }`);
          $(`rDynHier(__box, [], 'X', '${q}', null, 'G1', null, __sel)`);
          return texts(box);
        };
        const subj = async (lang, q) => {
          $(`window.location.search = '?lang=${lang}'`);
          const box = mk('div'); C.__box = box; C.__ent = ENT[q];
          $(`(function(){ const o = reconcile; reconcile = async () => ({ qid: '${q}', entity: __ent, route: [], controlledLabels: {}, wdMatch: 'confirmed' }); __restore = () => { reconcile = o; }; })()`);
          await $(`renderTermDetail(__box, 'X', 'G1', null, 'gnd', 'place')`);
          $(`__restore()`);
          return texts(box);
        };
        const fr = nav('fr', 'Q38'), de = nav('de', 'Q1747066'), fr2 = nav('fr', 'Q1747066');
        check('Navigate: description in the interface language (fr), not the Italian one',
          fr.includes("pays d'Europe du Sud") && !fr.includes('meridionale'), fr.slice(0, 160));
        check('Navigate: no description in another language when the interface one is missing (Verzweiflung, fr)',
          !fr2.includes('no hope') && de.includes('Hoffnungslosigkeit'), { fr2: fr2.slice(0, 160), de: de.slice(0, 160) });
        const sfr = await subj('fr', 'Q1747066'), sit = await subj('it', 'Q38');
        check('Subjects: no Italian/English fallback either', !sfr.includes('no hope') && sit.includes('meridionale'), { sfr: sfr.slice(0, 160), sit: sit.slice(0, 160) });
        $(`window.location.search = ''`);
      }
      // An empty card because the service did not answer shows a clock.
      {
        const nav = netFail => {
          const box = mk('div'); C.__box = box;
          C.__sel = { label: 'Italien', termType: 'place', qid: 'Q38', gndId: '4027833-5', controlledLabels: { de: 'Italien' }, netFail,
            entity: { claims: { P269: [{ mainsnak: { datavalue: { value: '027235408' } } }] } } };
          $(`navState = { history: [], currentIndex: -1 }`);
          $(`rDynHier(__box, [], 'Italien', 'Q38', null, '4027833-5', null, __sel)`);
          const idr = card(box, 'vc-idr'), gnd = card(box, 'vc-gnd');
          return { idr: texts(idr || {}), gnd: texts(gnd || {}) };
        };
        let n = nav(['IdRef']);
        check('IdRef silent: clock in the empty IdRef card, not in the GND one', n.idr.includes('\u23F1') && !n.gnd.includes('\u23F1'), n);
        n = nav(null);
        check('IdRef answered with nothing: plain «—», no clock', !n.idr.includes('\u23F1'), n);
        const box = mk('div'); C.__box = box;
        $(`(function(){ const o = reconcile; reconcile = async () => ({ qid: null, entity: null, route: [], controlledLabels: { de: 'Italien' }, netFail: ['IdRef', 'Wikidata'] }); __restore = () => { reconcile = o; }; })()`);
        await $(`renderTermDetail(__box, 'Italien', '4027833-5', null, 'gnd', 'place')`);
        $(`__restore()`);
        check('Subjects card: one note naming the silent services', /\u23F1 .*IdRef, Wikidata/.test(texts(box)), texts(box).slice(0, 160));
      }
    } catch (e) {
      check('rDynHier SBN card with minimal DOM', false, e.message);
    }
    $(`byId = ${origById.toString()}`);
  }

  // ── 4. Content-side security & URL building ────────────────
  section('content security & URLs');
  check('isAllowedOpenUrl https', $(`isAllowedOpenUrl('https://example.org/x')`) === true);
  check('isAllowedOpenUrl http', $(`isAllowedOpenUrl('http://example.org/x')`) === false);
  check('isAllowedOpenUrl javascript:', $(`isAllowedOpenUrl('javascript:alert(1)')`) === false);
  // The «Data sources» box credits every source with
  // its licence — NS CC BY 4.0, DNB mappings CC BY 4.0, Getty AAT ODC-By.
  {
    const src = $(`JSON.stringify(DATA_SOURCES)`);
    const by = Object.fromEntries(JSON.parse(src).map(([n, d, u]) => [n, { d, u }]));
    check('data sources: NS credited with CC BY 4.0', /BNCF/.test(by.NS?.d) && /CC BY 4\.0/.test(by.NS?.d), by.NS);
    check('data sources: GND mappings CC BY 4.0', /CC0/.test(by.GND?.d) && /CC BY 4\.0/.test(by.GND?.d), by.GND);
    check('data sources: Getty AAT with ODC-By', /ODC-By/.test(by['Getty AAT']?.d) && /^https:\/\//.test(by['Getty AAT']?.u || ''), by['Getty AAT']);
    check('data sources: LCSH public domain', /public domain/.test(by.LCSH?.d), by.LCSH);
    check('data sources: every link https', JSON.parse(src).every(([, , u]) => $(`isAllowedOpenUrl(${JSON.stringify(u)})`)), src);
  }
  // Release: the feedback button points to the Microsoft Forms form (https).
  {
    const fb = $(`FEEDBACK_URL`);
    check('feedback: real form link, https, no placeholder', $(`isAllowedOpenUrl(FEEDBACK_URL)`) && !/YOUR_FORM_ID/.test(fb) && /^https:\/\/forms\.cloud\.microsoft\//.test(fb), fb);
  }
  r = $(`parsePageUrl('https://swisscovery.slsp.ch/discovery/fulldisplay?docid=alma991234&vid=41SLSP_USI:VU1&lang=fr')`);
  check('parsePageUrl mmsId', r.mmsId === '991234', r);
  check('parsePageUrl instCode', r.instCode === '41SLSP_USI', r);
  check('parsePageUrl lang whitelisted', r.lang === 'fr', r);
  r = $(`parsePageUrl('https://swisscovery.slsp.ch/discovery/fulldisplay?docid=alma1&vid=x:y&lang="><img>')`);
  check('parsePageUrl malicious lang → it', r.lang === 'it', r);
  r = $(`parsePageUrl('https://swisscovery.slsp.ch/discovery/fulldisplay?docid=alma1&vid=' + encodeURIComponent('ev il/../x:y'))`);
  check('parsePageUrl malicious instCode → empty', r.instCode === '', r);
  $(`searchCtx = { host: 'swisscovery.slsp.ch', vid: '41SLSP_USI:VU1', tab: 'a&evil=1', scope: 'DN and CI' }`);
  r = $(`buildSearchUrl('beton', 'subject')`);
  check('buildSearchUrl: tab encoded', r.includes('tab=a%26evil%3D1'), r);
  check('buildSearchUrl: scope encoded', r.includes('search_scope=DN%20and%20CI'), r);
  r = $(`classBuildSearchUrl('720', { host: 'h.ch', vid: 'a:b', tab: 't&x', scope: 's' }, 'broader', []).url`);
  check('classBuildSearchUrl: tab encoded', r.includes('tab=t%26x'), r);

  // ── 5. Worker bridge wrappers (content) ────────────────────
  section('worker bridge (content wrappers)');
  r = await $(`loadNSIndex()`);
  check('loadNSIndex → status ready', $(`nsIndexStatus`) === 'ready');
  check('warmIndex sent once', workerCalls.warmIndex === 1, workerCalls);
  r = await $(`reconcile('calcestruzzo', null, null, 'sbt', 'topic')`);
  check('reconcile wrapper returns worker result', r && r.qid === 'Q1' && r.nsData.label === 'calcestruzzo', r);
  check('result mirrored in RC', $(`RC.size`) === 1);
  r = await $(`reconcile('calcestruzzo', null, null, 'sbt', 'topic')`);
  check('second call served from mirror', workerCalls.reconcile === 1, workerCalls);
  check('cache key separates vocabulary source', $(`rck('term', null, null, 'sbt', 'topic')`) !== $(`rck('term', null, null, 'gnd', 'topic')`));
  check('cache key separates entity type', $(`rck('term', null, null, 'sbt', 'topic')`) !== $(`rck('term', null, null, 'sbt', 'person')`));
  r = await $(`getHierarchy(null, null, 'http://purl.org/bncf/tid/100', null, null)`);
  check('getHierarchy wrapper returns nodes', Array.isArray(r) && r[0].label === 'parent', r);
  check('nodes mirrored in HC', $(`HC.size`) === 1);
  r = $(`recoverAuthIds('calcestruzzo', null, null, null)`);
  check('recoverAuthIds reads the mirror', r.gi === null && r.ii === null, r);
  $(`RC.set(rck('beton', '4005184-2', 'X123'), { qid: 'Q40089', gndId: '4005184-2', idrefId: 'X123' })`);
  r = $(`recoverAuthIds('beton', null, null, null)`);
  check('recoverAuthIds by label', r.gi === '4005184-2' && r.ii === 'X123', r);
  r = $(`recoverAuthIds('altro', 'Q40089', null, null)`);
  check('recoverAuthIds by QID', r.gi === '4005184-2' && r.ii === 'X123', r);
  // Record 990002667070205507: IdRef «Eucharistie» (slot of NS 6011) and GND
  // «Eucharistie» (secondary; the slot holder is Abendmahl) — the IdRef
  // result is cached first, the SELECTED card must still show the GND form.
  $(`RC.set(rck('Eucharistie', null, '027532631', 'idref', 'topic'), { vocabSource: 'idref', idrefId: '027532631', gndId: '4000081-3', nsData: { id: '6011' }, controlledLabels: { fr: 'Eucharistie', de: 'Abendmahl', it: 'Eucaristia' } })`);
  $(`RC.set(rck('Eucharistie', '4015644-8', null, 'gnd', 'topic'), { vocabSource: 'gnd', gndId: '4015644-8', nsData: { id: '6011' }, controlledLabels: { de: 'Eucharistie', fr: 'Eucharistie', it: 'Eucaristia' } })`);
  $(`RC.set(rck('Eucharistie', '999', null, 'gnd', 'topic'), { vocabSource: 'gnd', gndId: '999', nsData: { id: '1' }, controlledLabels: { de: 'Andere' } })`);
  r = $(`recordHeadingForms('Eucharistie', RC.get(rck('Eucharistie', null, '027532631', 'idref', 'topic')))`);
  check('selected card: record GND form kept (Eucharistie, not Abendmahl)', r.labels.de === 'Eucharistie' && r.gndId === '4015644-8', r);
  check('selected card: record IdRef form and id kept', r.labels.fr === 'Eucharistie' && r.idrefId === '027532631', r);
  // Record 999688596905507: NS «Design» (industrial design) and GND «Design»
  // (another concept, no NS): the NS card must not take the GND wording.
  $(`RC.set(rck('Design', '4011510-0', null, 'gnd', 'topic'), { vocabSource: 'gnd', gndId: '4011510-0', nsData: null, controlledLabels: { de: 'Design' } })`);
  r = $(`recordHeadingForms('Design', { nsData: { id: '6075' } })`);
  check('selected card: a same-worded heading of another concept is not mixed in (Design)', !r.labels.de && !r.gndId, r);
  r = $(`recordHeadingForms('Design', { nsData: null })`);
  check('selected card: same-worded headings without concept still share their forms', r.labels.de === 'Design', r);

  section('navigation uses the record ids, Wikidata only when confirmed');
  // Record 990007025590205507: IdRef «Renaissance» (the period); the Wikidata
  // text search found the French party Q23731823 (unverified).
  r = $(`navIdentity({ label: 'Renaissance', idrefId: '028017641', qid: 'Q23731823', wdMatch: 'unverified',
    entity: { claims: { P227: [{ mainsnak: { datavalue: { value: '1139454706' } } }] } } })`);
  check('unverified Wikidata item: no QID, no entity, no GND from it', r.q === null && r.e === null && r.gi === null, r);
  check('unverified Wikidata item: the record IdRef id is used', r.ii === '028017641', r);
  r = $(`navIdentity({ label: 'Design', gndId: '4047340-5', qid: 'Q243606', nsData: { uri: 'http://purl.org/bncf/tid/6075' },
    entity: { claims: { P227: [{ mainsnak: { datavalue: { value: '4072788-9' } } }] } } })`);
  check('the concept GND id comes before the Wikidata one (Produktgestaltung, not Industriedesign)', r.gi === '4047340-5' && r.q === 'Q243606', r);
  r = $(`navIdentity({ label: 'X', qid: 'Q1', entity: { claims: { P269: [{ mainsnak: { datavalue: { value: 'PPN9' } } }] } } })`);
  check('a confirmed Wikidata item still fills missing ids', r.ii === 'PPN9' && r.q === 'Q1', r);

  // ── 6. Worker: utilities and parsers ───────────────────────
  section('worker: LRUMap');
  r = $w(`(function(){ const m = new LRUMap(2); m.set('a',1); m.set('b',2); m.get('a'); m.set('c',3); return { a: m.has('a'), b: m.has('b'), c: m.has('c'), size: m.size }; })()`);
  check('LRU evicts least-recently-used', r.a === true && r.b === false && r.c === true && r.size === 2, r);

  section('worker: decXML (ordering fix)');
  check('&amp;lt; → &lt; (not <)', $w(`decXML('&amp;lt;')`) === '&lt;');
  check('&lt;b&gt; → <b>', $w(`decXML('&lt;b&gt;')`) === '<b>');
  check('&#65;&#x42; → AB', $w(`decXML('&#65;&#x42;')`) === 'AB');
  check('plain &amp;', $w(`decXML('A &amp; B')`) === 'A & B');

  section('worker: parseMarcXML / parseSparqlResultsXML');
  r = $w(`parseMarcXML('<record><marc:datafield ind1=" " tag="650" ind2="7"><marc:subfield code="a">Architettura</marc:subfield><marc:subfield code="2">sbt12</marc:subfield></marc:datafield></record>')`);
  check('datafield extracted (any attribute order)', r.length === 1 && r[0].tag === '650' && r[0].ind === ' 7', r);
  check('subfields extracted', r[0].subs.length === 2 && r[0].subs[0].v === 'Architettura', r);
  r = $w(`parseSparqlResultsXML('<sparql><results><result><binding name="i"><uri>http://x/Q1</uri></binding><binding name="l"><literal>casa &amp; giardino</literal></binding></result></results></sparql>')`);
  check('uri+literal bindings', r.results.bindings.length === 1 && r.results.bindings[0].i.value === 'http://x/Q1', r);
  check('literal decoded', r.results.bindings[0].l.value === 'casa & giardino', r);

  section('worker: whitelists and validations');
  check('sparqlLiteral escaping', $w(`sparqlLiteral('a"b\\\\c')`) === '"a\\"b\\\\c"');
  check('clId plain string', $w(`clId('4005184-2')`) === '4005184-2');
  check('clId object {id,c,d}', $w(`clId({ id: 'x', c: 2, d: 'out' })`) === 'x');
  check('clConf preserves mapping evidence', $w(`clConf({ id: 'x', c: 3, d: 'both' })`) === 3);
  check('clGrade default', $w(`clGrade({})`) === 4);
  check('isAllowedUrl wikidata', $w(`isAllowedUrl('https://www.wikidata.org/w/api.php?x=1')`) === true);
  check('isAllowedUrl foreign host', $w(`isAllowedUrl('https://evil.example.com/x')`) === false);
  check('isAllowedUrl http', $w(`isAllowedUrl('http://www.wikidata.org/x')`) === false);
  check('isTargetUrl swisscovery IZ', $w(`isTargetUrl('https://usi.swisscovery.slsp.ch/discovery/search?x=1')`) === true);
  check('isTargetUrl reperio', $w(`isTargetUrl('https://reperio.usi.ch/discovery/fulldisplay?docid=alma1')`) === true);
  check('isTargetUrl lookalike host', $w(`isTargetUrl('https://swisscovery.evil.com/')`) === false);
  check('isTargetUrl http', $w(`isTargetUrl('http://swisscovery.ch/')`) === false);
  r = await $w(`sparql('https://evil.example/sparql', 'SELECT 1').catch(e => e.message)`);
  check('sparql endpoint whitelist', r === 'SPARQL endpoint not allowed', r);
  check('fetchBNE malicious id → null', (await $w(`fetchBNE('../../etc')`)) === null);
  check('fetchLCSH malicious id → null', (await $w(`fetchLCSH('../x')`)) === null);
  check('fetchBnfLabelRemote malicious ark → null', (await $w(`fetchBnfLabelRemote('../x')`)) === null);

  // ── 7. Worker: offline end-to-end on the fixture index ─────
  section('worker: ensureIndex + lookups (fixture)');
  r = await $w(`ensureIndex()`);
  check('ensureIndex → ready', r && r.status === 'ready', r);
  await new Promise(res => setTimeout(res, 30)); // let label/hierarchy files settle
  r = $w(`nsLookup('Calcestruzzo ')`);
  check('nsLookup case/space-insensitive', r && r.tid === '100' && r.l === 'calcestruzzo', r);
  check('nsLookupByGnd reverse', $w(`nsLookupByGnd('4005184-2')`).tid === '100');
  check('getAuthLabel from fixture labels', $w(`getAuthLabel('gnd', '4005184-2')`) === 'Beton');

  section('worker: reconcile end-to-end (offline)');
  r = await $w(`reconcile('calcestruzzo', null, null, 'sbt', 'topic')`);
  check('NS anchor found', r.nsData && r.nsData.label === 'calcestruzzo', r.nsData);
  check('DDC from NS concept', r.nsData.ddc === '620.136', r.nsData);
  check('QID from cluster', r.qid === 'Q40089', r.qid);
  check('cluster grade propagated', r.nsClusterGrade === 1, r.nsClusterGrade);
  check('DE label resolved locally (no network)', r.controlledLabels.de === 'Beton', r.controlledLabels);
  check('IT label set', r.controlledLabels.it === 'calcestruzzo', r.controlledLabels);
  check('route documents NS-local', r.route.includes('NS-local'), r.route);
  check('entity null offline (WD fetch stubbed out)', r.entity === null);
  check('worker RC populated', $w(`RC.size`) >= 1);

  section('exact links outside NS');
  r = await $w(`reconcile('Wörterbuch', 'G-WB', null, 'gnd', 'topic')`);
  check('GND heading without NS concept: French and English from its exact links, offline',
    !r.nsData && r.controlledLabels.de === 'Wörterbuch' && r.controlledLabels.fr === 'Dictionnaires'
    && r.controlledLabels.en === 'Dictionaries' && r.route.includes('exact-links'), r);
  r = await $w(`reconcile('Dictionnaires', null, 'PPN_T', 'idref', 'topic')`);
  check('IdRef heading without NS concept: German from its exact links, its own French kept',
    !r.nsData && r.controlledLabels.fr === 'Dictionnaires' && r.controlledLabels.de === 'Wörterbuch', r.controlledLabels);
  r = await $w(`reconcile('Wörterbuch, Hans', 'G-WB', null, 'gnd', 'person')`);
  check('exact links are not applied to a name', !r.controlledLabels.fr, r.controlledLabels);

  section('worker: IdRef→WD backlink (P269)');
  // A place heading carrying only an IdRef PPN must resolve its QID via the
  // P269 backlink instead of falling through to the text search (which
  // matched "Suisse" to the French commune Q22036 instead of Q39).
  r = await $w(`reconcile('Suisse', null, '027249654', 'idref', 'place')`);
  check('QID resolved via P269 backlink', r.qid === 'Q39', r.qid);
  check('route documents IdRef→WD', r.route.includes('IdRef→WD'), r.route);
  check('text fallback not reached', !r.route.includes('WD-text'), r.route);

  section('worker: IdRef chronological descriptor → NS by French label');
  // IdRef «Renaissance» 028017641 is type x (chronological descriptor). The
  // type was unlisted ("Altro"), so the French-label route to the NS was
  // skipped and the text search proposed the French political party.
  r = await $w(`reconcile('Renaissance', null, 'PPN_REN_X', 'idref', 'topic')`);
  check('type x reaches NS Rinascimento by its French label', r.nsData && r.nsData.label === 'rinascimento', r.nsData);
  check('route documents IdRef→FR→NS', r.route.includes('IdRef→FR→NS'), r.route);
  check('QID from the NS cluster', r.qid === 'Q4692', r.qid);
  check('text search not reached', !r.route.includes('WD-text'), r.route);
  check('route carries the IdRef type code, not a description', r.route.includes('IdRefSolr:PPN_REN_X(x)'), r.route);
  r = await $w(`reconcile('Renaissance', null, 'PPN_REN_A', 'idref', 'person')`);
  check('a name heading with the same wording is not linked', !r.nsData, r.nsData);

  section('worker: LCSH→WD backlink for GND-less clusters');
  // An NS concept whose cluster has only an LCSH id (no GND, no stored QID)
  // must reach Wikidata via P244 instead of the text fallback.
  r = await $w(`reconcile('paesaggio culturale', null, null, 'sbt', 'topic')`);
  check('QID resolved via P244 backlink', r.qid === 'Q1655072', r.qid);
  check('route documents LCSH→WD', r.route.includes('LCSH→WD'), r.route);
  check('text fallback not reached', !r.route.includes('WD-text'), r.route);
  check('EN label from local slim file', r.controlledLabels.en === 'Cultural landscapes', r.controlledLabels);

  section('Wikidata hub reads the local label files first');
  // «Fotografie» must not wait for data.bnf.fr and lose the French label
  // the local files have. Here data.bnf.fr and BNE are not
  // reachable at all (no network in tests): the labels must come locally.
  r = await $w(`reconcile('fotografie', null, null, 'sbt', 'topic')`);
  check('FR from the local file via the Wikidata ark (no data.bnf.fr)', r.controlledLabels.fr === 'Photographie', r.controlledLabels);
  check('ES from the local file via the Wikidata BNE id', r.controlledLabels.es === 'Fotografía', r.controlledLabels);

  section('a term is never its own neighbour');
  r = await $w(`getHierarchy(null, 'http://purl.org/bncf/tid/100', 'G-CHILD', null)`);
  check('the concept itself is not listed as broader (NS Design above Design)', !r.some(n => n.nsTid === '100'), r.map(n => n.type + ':' + n.label));
  check('the other broader terms stay', r.some(n => n.type === 'bt' && n.gndId === '4056795-3'), r.map(n => n.type + ':' + n.label));
  r = r.filter(n => n.type === 'bt').map(n => n.label);
  check('broader terms sorted: NS concept before a GND-only term', JSON.stringify(r) === '["materiali da costruzione","Baustoff"]', r);
  // Industrialisierung: NS-only, GND-only, AAT and full clusters mixed with
  // other types; the old comparator (0 across types) left them unsorted.
  r = $w(`sortHierarchyNodes([
    { type: 'bt', label: 'Processi', srcs: ['NS'], nsTid: '1', langs: { it: 'Processi' } },
    { type: 'nt', label: 'n1', srcs: ['WD'], langs: {} },
    { type: 'bt', label: 'Strukturwandel', srcs: ['GND'], langs: { de: 'Strukturwandel' } },
    { type: 'rt', label: 'r1', srcs: ['NS'], nsTid: '9', langs: {} },
    { type: 'bt', label: 'economic development', srcs: ['AAT'], langs: { en: 'x' } },
    { type: 'bt', label: 'sviluppo economico', srcs: ['NS', 'GND', 'IdRef'], nsTid: '2', langs: { it: 'a', de: 'b', fr: 'c', en: 'd', es: 'e' } }
  ]).filter(n => n.type === 'bt').map(n => n.label)`);
  check('broader terms sorted: full clusters, NS, GND/IdRef, AAT (Industrialisierung)',
    JSON.stringify(r) === '["sviluppo economico","Processi","Strukturwandel","economic development"]', r);

  section('RAMEAU/IdRef table — hierarchy of an IdRef term outside NS');
  // No network in tests: the hierarchy must come from the table alone.
  r = await $w(`getHierarchy(null, null, null, 'PPN_T')`);
  const byType = t => r.filter(n => n.type === t).map(n => n.label + '|' + (n.idrefId || ''));
  check('broader term from the table, with its IdRef id', byType('bt').join() === 'Ouvrages de référence|PPN_B', r);
  check('narrower term from the table, with its IdRef id', byType('nt').join() === 'Dictionnaires anglais|PPN_N', r);
  check("RAMEAU 'voir aussi' shown as related term", byType('rt').join() === 'Lexicographie|', r);
  check('neighbour links point to IdRef', r.find(n => n.type === 'bt')?.uri === 'https://www.idref.fr/PPN_B', r);
  r = $w(`[rameauArkByPpn('PPN_T'), rameauArkByPpn('PPN_DUP'), rameauPpn('cbB'), getAuthLabel('bnf', 'cbR')]`);
  check('table lookups: PPN → heading (conflict decided by the generator), heading → PPN, label',
        r.join() === 'cbT,cbT,PPN_B,Lexicographie', r);

  section('worker: text-fallback person gate');
  // The fuzzy WD text search returns "Oskar Barnack" for "Bär, Oskar": no
  // shared ID and a different family name → the candidate must be discarded
  // and recorded, with no wrong enrichment left in the result.
  r = await $w(`reconcile('Bär, Oskar', null, '200738925', 'idref', 'person')`);
  check('wrong homonym discarded (qid null)', r.qid === null, r.qid);
  check('entity dropped (no wrong enrichment)', r.entity === null);
  check('verdict conflict + candidate recorded', r.wdMatch === 'conflict' && r.wdDiscarded && r.wdDiscarded.qid === 'Q61109', r.wdDiscarded);
  check('route shows the discard', r.route.includes('WD-text✗'), r.route);

  section('worker: IdRef co-references (VIAF/ISNI backlinks)');
  r = await $w(`reconcile('Rossi, Mario', null, 'PPNVIAF1', 'idref', 'person')`);
  check('QID via VIAF mined from the IdRef record', r.qid === 'Q1000001', { qid: r.qid, route: r.route });
  check('route documents VIAF→WD', r.route.includes('VIAF→WD'), r.route);
  check('route lists the mined co-references', r.route.includes('coref:VIAF+ISNI'), r.route);
  check('not marked as text-found', r.wdMatch === null, r.wdMatch);
  r = await $w(`qidViaBacklinks({ isni: '0000000016583504' }, [])`);
  check('ISNI normalised to the spaced P213 form', r === 'Q1000002', r);
  r = await $w(`(async () => { const route = []; const q = await qidViaBacklinks({ idref: '029999999', gnd: '4999999-9' }, route); return { q, route }; })()`);
  check('backlinks: one query, GND answer wins over IdRef (priority kept)', r.q === 'Q2000001' && r.route.join() === 'GND→WD', r);

  section('Wikidata on QLever, one query per record');
  r = $w(`backlinkQuery([['P227', '4030702-5'], ['P269', '027249654'], ['P227', '4999999-9']])`);
  check('backlink query: fixed property per block (QLever), prefixes declared, no property inside VALUES',
    r.includes('PREFIX wdt:') && r.includes('?i wdt:P227 ?v') && r.includes('?i wdt:P269 ?v') && !/VALUES\s*\(\?p/.test(r)
    && r.includes('"4030702-5" "4999999-9"'), r);
  W.__wdQueries = [];
  r = await $w(`prefetchQids([{ gnd: '4999999-9' }, { idref: '027249654' }, { gnd: 'G-NONE' }])`);
  const afterPrefetch = W.__wdQueries.length;
  r = await $w(`(async () => { const a = await qidViaBacklinks({ gnd: '4999999-9' }, []);
    const b = await qidViaBacklinks({ idref: '027249654' }, []); const c = await qidViaBacklinks({ gnd: 'G-NONE' }, []);
    return [a, b, c]; })()`);
  check('the record ids go to Wikidata in ONE query', afterPrefetch === 1 && W.__wdQueries[0].url.startsWith('https://qlever.dev/api/wikidata'), W.__wdQueries.map(q => q.url.slice(0, 40)));
  check('the headings then reuse the answers (items and «no item»): no further query',
    JSON.stringify(r) === JSON.stringify(['Q2000001', 'Q39', null]) && W.__wdQueries.length === 1, { r, n: W.__wdQueries.length });
  r = await $w(`prefetchQids([{ gnd: '4005184-2' }])`);
  check('an id whose NS concept already has its Wikidata item is not asked', r === 0, r);
  W.__wdQueries = []; W.__wdDown = 'https://qlever.dev/';
  r = await $w(`qidViaBacklinks({ gnd: '4888888-8' }, [])`);
  W.__wdDown = null;
  check('QLever down: the same query goes to query.wikidata.org',
    r === 'Q3000001' && W.__wdQueries.length === 2 && W.__wdQueries[1].url.startsWith('https://query.wikidata.org/sparql'), W.__wdQueries.map(q => q.url.slice(0, 40)));
  check('Wikimedia services get Api-User-Agent (name and project page), QLever not',
    /^SubjectNavigator\/\d+\.\d+\.\d+ \(https:\/\/github\.com\/MicheleStefani\/subjectnavigator\)$/.test(W.__wdQueries[1].headers['Api-User-Agent'] || '')
    && !W.__wdQueries[0].headers['Api-User-Agent'], W.__wdQueries.map(q => q.headers));
  W.__wdQueries = []; W.__wdDown = 'https://';
  r = await $w(`qidViaBacklinks({ gnd: 'G-FAIL' }, [])`);
  W.__wdDown = null;
  r = await $w(`qidViaBacklinks({ gnd: 'G-FAIL' }, [])`);
  check('a failed query is not remembered as «no item»: the id is asked again', W.__wdQueries.length === 3, W.__wdQueries.length);
  r = await $w(`(async () => [await qidViaBacklinks({ gnd: '4777777-7' }, []), await qidViaBacklinks({ gnd: '4666666-6' }, [])])()`);
  check('several items with one id: the one the NS index knows, else the lowest number (same on both engines)',
    JSON.stringify(r) === '["Q40089","Q7"]', r);
  W.__wdQueries = [];
  await $w(`prefetchQids([{ idref: 'PPN_T' }])`);
  r = decodeURIComponent(W.__wdQueries.map(q => q.url).join(' '));
  // (PPN_T itself is already known from the exact-links test: only its twin is new)
  check('an IdRef id is asked with its RAMEAU twin (P268), in the same query',
    W.__wdQueries.length === 1 && r.includes('wdt:P268') && r.includes('"T"') && !r.includes('"PPN_T"'), r.slice(0, 300));
  r = await $w(`(async () => { const route = []; const q = await qidViaBacklinks({ gnd: '0000000-0', idref: '029999999' }, route); return { q, route }; })()`);
  check('backlinks: falls to the next id that answers', r.q === 'Q2000002' && r.route.join() === 'IdRef→WD', r);

  section('no anchoring by wording or by an unverified QID');
  r = await $w(`reconcile('calcestruzzo', null, null, 'sbt', 'corporate')`);
  check('a corporate body sharing a topic label is not anchored to NS', r.nsData === null, r.nsData);
  r = await $w(`reconcile('calcestruzzo', null, null, 'sbt', 'form')`);
  check('a form sharing a topic label is not anchored to NS', r.nsData === null, r.nsData);
  r = await $w(`reconcile('calcestruzzo', null, null, 'sbt', 'place')`);
  check('a place may still be anchored by its label', r.nsData && r.nsData.id === '100', r.nsData);
  r = await $w(`reconcile('Oskar Barnack', null, null, 'gnd', 'topic')`);
  check('text-search QID stays an unverified hypothesis', r.wdMatch === 'unverified' && r.qid === 'Q61109', { m: r.wdMatch, q: r.qid });
  check('unverified QID does not anchor the record to NS (reverse lookup)', r.nsData === null, r.nsData);

  section('a topical term takes only an item with its exact name');
  // «Découverte et exploration» → discovery of America: in the catalogue
  // sample every topical hit without the heading's own name was wrong.
  r = await $w(`reconcile('Oskar tema', null, null, 'gnd', 'topic')`);
  check('topic: item whose names do not match is not taken', !r.qid && r.route.includes('WD-text'), { q: r.qid, route: r.route });
  r = await $w(`reconcile('Oskar tema', null, null, 'gnd')`);
  check('untyped term: rule not applied (hypothesis kept)', r.qid === 'Q61109' && r.wdMatch === 'unverified', { q: r.qid, m: r.wdMatch });

  section('interface language in the route badge and the not-found line');
  $(`setLang('en')`);
  check('IdRef type named in the interface language', $(`routeLabel('IdRefSolr:028017641(x)')`) === 'IdRefSolr:028017641(RAMEAU chronological descriptor)', $(`routeLabel('IdRefSolr:028017641(x)')`));
  check('unknown IdRef type → «Other»', $(`routeLabel('IdRefSolr:1(l)')`) === 'IdRefSolr:1(Other)', $(`routeLabel('IdRefSolr:1(l)')`));
  check('other route steps unchanged', $(`routeLabel('IdRef→FR→NS')`) === 'IdRef→FR→NS');
  $(`setLang('de')`);
  check('German type name', $(`routeLabel('IdRefSolr:1(j)')`) === 'IdRefSolr:1(RAMEAU-Schlagwort)', $(`routeLabel('IdRefSolr:1(j)')`));
  check('not-found line names Wikidata in every language',
    ['it', 'de', 'fr', 'en'].every(l => $(`I18N.${l}.notFound`).includes('Wikidata')));
  $(`setLang('it')`);
  const uiKeys = ['sendFeedback', 'aboutSources', 'about', 'theme', 'changeTheme', 'dataSources', 'vocabularies', 'privacyNote', 'classAllClasses', 'classBaamName'];
  const missingUi = ['it', 'de', 'fr', 'en'].flatMap(l => uiKeys.filter(k => !$(`I18N.${l}.${k}`)).map(k => l + '.' + k));
  check('header, About box and class button strings exist in every language', missingUi.length === 0, missingUi);

  section('a replaced BnF ark is not followed to its successor');
  r = await $w(`fetchBnfLabelRemote('cbOLD1')`);
  check('redirected ark: no label, redirect not followed', r === null && $w(`__bnfRedirectMode`) === 'manual', { r, mode: $w(`__bnfRedirectMode`) });

  section('card title — term and translation, no repetition');
  const ct = (...a) => JSON.parse($(`JSON.stringify(cardTitle(${a.map(x => JSON.stringify(x)).join(',')}))`));
  let tt = ct('idref', 'Art italien', 'Arte italiana', 'fr', 'Art italien');
  check('IdRef heading, French interface: no line (it would repeat the header)', !tt.main && !tt.translation, tt);
  tt = ct('idref', 'Art italien', 'Arte italiana', 'it', 'Arte italiana');
  check('IdRef heading, Italian interface: only «IT: Arte italiana»', !tt.main && tt.translation === 'Arte italiana', tt);
  tt = ct('gnd', 'Islamische Kunst', 'Arte islamica', 'en', 'Islamic art');
  check('GND heading, English interface: only the English translation, no Italian in bold', !tt.main && tt.translation === 'Islamic art', tt);
  tt = ct('gnd', 'Kapitalmarkt', null, 'en', null);
  check('GND heading without a translation: no line', !tt.main && !tt.translation, tt);
  tt = ct('sbt', 'Cataloghi di esposizioni', 'Cataloghi di esposizioni', 'fr', "Catalogues d'exposition");
  check('NS heading, French interface: term + (FR: translation), as before', tt.main === 'Cataloghi di esposizioni' && tt.translation === "Catalogues d'exposition", tt);
  tt = ct('sbt', 'Cataloghi di esposizioni', 'Cataloghi di esposizioni', 'it', 'Cataloghi di esposizioni');
  check('NS heading, Italian interface: the term alone', tt.main === 'Cataloghi di esposizioni' && !tt.translation, tt);

  section('each heading shows the note of its own vocabulary');
  r = await $w(`reconcile('Beton', '4005184-2', null, 'gnd', 'topic')`);
  check('GND heading: GND definition from the local file', r.authNote && r.authNote.src === 'gnd' && r.authNote.text.startsWith('Baustoff'), r.authNote);
  r = await $w(`reconcile('Dictionnaires', null, 'PPN_T', 'idref', 'topic')`);
  check('IdRef heading: RAMEAU note through the PPN → ark table', r.authNote && r.authNote.src === 'rameau' && r.authNote.text.startsWith('Recueils'), r.authNote);
  r = await $w(`reconcile('calcestruzzo', null, null, 'sbt', 'topic')`);
  check('NS heading: no GND/RAMEAU note', r.authNote === null, r.authNote);
  $(`setLang('en')`);
  const ns = { scopeNote: 'Spazi e aree destinati alla pubblica circolazione' };
  let notes = JSON.parse($(`JSON.stringify(cardNotes('sbt', ${JSON.stringify(ns)}, null))`));
  check('NS heading: NS scope note shown, named in the interface language', notes.length === 1 && notes[0].label === 'NS scope note' && notes[0].lang === 'it', notes);
  notes = JSON.parse($(`JSON.stringify(cardNotes('gnd', ${JSON.stringify(ns)}, null))`));
  check('GND heading linked to NS, no GND definition: NS note not shown', notes.length === 0, notes);
  notes = JSON.parse($(`JSON.stringify(cardNotes('gnd', ${JSON.stringify(ns)}, { src: 'gnd', text: 'Öffentlich zugänglicher Raum' }))`));
  check('GND heading: only the GND definition, in German', notes.length === 1 && notes[0].label === 'GND definition' && notes[0].lang === 'de', notes);
  notes = JSON.parse($(`JSON.stringify(cardNotes('idref', ${JSON.stringify(ns)}, { src: 'rameau', text: 'Espaces publics' }))`));
  check('IdRef heading: only the RAMEAU note, in French', notes.length === 1 && notes[0].label === 'RAMEAU note' && notes[0].lang === 'fr', notes);
  $(`setLang('it')`);
  check('note labels in every language', ['it', 'de', 'fr', 'en'].every(l => ['noteNS', 'noteNSDef', 'noteGND', 'noteRAMEAU'].every(k => $(`I18N.${l}.${k}`))));

  section('a topical term refuses an item that is not a concept');
  // «Schacht» (GND, the mine shaft): the best exact item is the family name.
  // Prudent variant: no hypothesis at all, not the next item.
  r = await $w(`reconcile('Schacht', null, null, 'gnd', 'topic')`);
  check('topic: family name refused, next item not taken', !r.qid && r.route.includes('WD-text'), { q: r.qid, route: r.route });
  r = await $w(`reconcile('Pferd', null, null, 'gnd', 'topic')`);
  check('topic: a concept with the exact name is kept', r.qid === 'Q726' && r.wdMatch === 'unverified', { q: r.qid, m: r.wdMatch });
  r = await $w(`reconcile('Schacht', null, null, 'gnd')`);
  check('untyped term: non-concept rule not applied', r.qid === 'Q17166770', r.qid);

  section('no Wikidata text search for forms and periods');
  r = await $w(`reconcile('Oskar Festschrift', null, null, 'gnd', 'form')`);
  check('form: no text-search guess', r.qid === null && !r.route.includes('WD-text'), r.route);
  r = await $w(`reconcile('Oskar 1921-2012', null, null, 'gnd', 'period')`);
  check('period: no text-search guess', r.qid === null && !r.route.includes('WD-text'), r.route);

  section('secondary GND mappings');
  r = await $w(`reconcile('Seelengewinnung', 'GND-SEC', null, 'gnd', 'topic')`);
  check('record reaches the NS concept through a secondary mapping', r.nsData && r.nsData.id === '100', r.nsData);
  check('route marks the secondary mapping', r.route.includes('ID→NS-local(secondary)'), r.route);
  check("cataloguer's German form kept (not the slot holder's term)", r.controlledLabels.de === 'Seelengewinnung', r.controlledLabels);
  check('other languages still come from the NS concept', r.controlledLabels.it === 'calcestruzzo', r.controlledLabels);
  r = await $w(`reconcile('Termine titolare', 'G-SLOT', null, 'gnd', 'topic')`);
  check('the concept whose slot holds the id outranks a secondary mapping', r.nsData && r.nsData.id === '200' && !r.nsAmbiguity, { ns: r.nsData, amb: r.nsAmbiguity });
  r = await $w(`reconcile('calcestruzzo', '4005184-2', null, 'gnd', 'topic')`);
  check('slot holder: German label still from the cluster', r.controlledLabels.de === 'Beton' && r.route.includes('ID→NS-local'), r.controlledLabels);

  section('worker: personNameMatches');
  check('diacritics-folded surname match', $w(`personNameMatches('Bär, Oskar', { labels: { de: { value: 'Oskar Bär' } }, aliases: {} })`) === true);
  check('different surname rejected', $w(`personNameMatches('Bär, Oskar', { labels: { en: { value: 'Oskar Barnack' } }, aliases: {} })`) === false);
  check('match found via alias', $w(`personNameMatches('Jeanneret, Charles-Edouard', { labels: { en: { value: 'Le Corbusier' } }, aliases: { fr: [{ value: 'Charles-Edouard Jeanneret' }] } })`) === true);
  check('compound surname uses the main token', $w(`personNameMatches('De Rossi, Anna', { labels: { it: { value: 'Anna Rossi' } }, aliases: {} })`) === true);

  section('worker: getHierarchy end-to-end (offline)');
  r = await $w(`getHierarchy(null, 'http://purl.org/bncf/tid/100', '4005184-2', null)`);
  const bt = r.filter(n => n.type === 'bt');
  check('two broader nodes (NS + GND-local)', bt.length === 2, r);
  check('NS broader label', bt.some(n => n.label === 'materiali da costruzione' && n.srcs.includes('NS')), bt);
  check('GND broader from local hierarchy + DE label', bt.some(n => n.label === 'Baustoff' && n.srcs.includes('GND')), bt);

  section('Navigate asks AAT and Wikidata at the same time');
  {
    const log = [];
    const realFetch = W.fetch;
    W.fetch = async (url, opts) => {
      const u = String(url);
      const tag = u.startsWith('https://vocab.getty.edu') ? 'aat' : u.startsWith('https://qlever.dev') ? 'wd' : null;
      if (!tag) return realFetch(url, opts);
      log.push(tag + '>');
      await new Promise(res => setTimeout(res, 40));
      log.push('<' + tag);
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ results: { bindings: [] } }) };
    };
    $w(`EC.set('Q77', { claims: { P1014: [{ mainsnak: { datavalue: { value: '300000001' } } }] } })`);
    await $w(`getHierarchy('Q77', null, null, null)`);
    W.fetch = realFetch;
    check('both queries are sent before either answers (they were one after the other)',
      log.includes('aat>') && log.includes('wd>') && log.indexOf('aat>') < log.indexOf('<wd') && log.indexOf('wd>') < log.indexOf('<aat'), log);
  }

  section('a Wikidata item of an NS concept shows the authority headings only');
  {
    // Genealogia → Q80083 «discipline umanistiche» (NS 11705, no GND/RAMEAU):
    // its Wikidata labels «Humanities», «humanités» showed as GND and IdRef.
    const realFetch = W.fetch;
    const lit = (v, l) => v ? { value: v, 'xml:lang': l } : undefined;
    const row = (q, lIt, lDe, lFr, lEn) => ({ q: { value: 'http://www.wikidata.org/entity/Q900' }, type: { value: 'bt' },
      item: { value: 'http://www.wikidata.org/entity/' + q }, lIt: lit(lIt, 'it'), lDe: lit(lDe, 'de'), lFr: lit(lFr, 'fr'), lEn: lit(lEn, 'en') });
    W.fetch = async (url, opts) => {
      const u = String(url);
      if (u.startsWith('https://qlever.dev')) return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ results: { bindings: [
        row('Q40089', 'calcestruzzo (wd)', 'Beton (WD)', 'béton (wd)', 'concrete (wd)'),
        row('Q901', 'arti visive', 'bildende Kunst', 'arts visuels', 'visual arts') ] } }) };
      if (u.startsWith('https://vocab.getty.edu')) return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ results: { bindings: [] } }) };
      return realFetch(url, opts);
    };
    $w(`EC.set('Q900', { claims: {} })`);
    const h = await $w(`getHierarchy('Q900', null, null, null)`);
    W.fetch = realFetch;
    const ns = h.find(n => n.nsTid === '100') || {}, wd = h.find(n => n.label === 'arti visive') || {};
    check('item of an NS concept: NS label, no Wikidata label in the GND/IdRef slots',
      ns.langs && ns.langs.it === 'calcestruzzo' && ns.langs.de === 'Beton' && !ns.langs.fr && !ns.langs.en, ns.langs);
    check('item outside NS keeps its Wikidata labels (it/de/fr/en)',
      wd.langs && wd.langs.de === 'bildende Kunst' && wd.langs.fr === 'arts visuels' && wd.langs.en === 'visual arts', wd.langs);
  }

  section('Navigate hierarchies prepared for the whole record');
  {
    const asked = [];
    let down = false;
    const realFetch = W.fetch;
    W.fetch = async (url, opts) => {
      const u = decodeURIComponent(String(url) + ' ' + ((opts && opts.body) || ''));   // GET or POST
      const ok = payload => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload) });
      if (u.startsWith('https://qlever.dev')) {
        asked.push('wd');
        if (down) throw new TypeError('Failed to fetch');
        const qs = ((u.match(/VALUES \?q\{([^}]*)\}/) || [])[1] || '').match(/Q\d+/g) || [];
        const bindings = [];
        for (const q of qs) for (let i = 0; i < (q === 'Q801' ? 25 : 2); i++)
          bindings.push({ q: { value: 'http://www.wikidata.org/entity/' + q }, type: { value: 'nt' },
            item: { value: 'http://www.wikidata.org/entity/Q9' + q.slice(1) + i }, lIt: { value: 'sotto ' + q + ' ' + i } });
        return ok({ results: { bindings } });
      }
      if (u.startsWith('https://query.wikidata.org')) { asked.push('wd-fallback'); throw new TypeError('Failed to fetch'); }
      if (u.startsWith('https://vocab.getty.edu')) {
        asked.push('aat');
        const ids = ((u.match(/VALUES \?a\{([^}]*)\}/) || [])[1] || '').match(/aat\/(\d+)/g) || [];
        return ok({ results: { bindings: ids.map(x => ({ a: { value: 'http://vocab.getty.edu/' + x }, type: { value: 'bt' },
          uri: { value: 'http://vocab.getty.edu/aat/1' + x.slice(4) }, labelEn: { value: 'broader ' + x.slice(4) } })) } });
      }
      return realFetch(url, opts);
    };
    $w(`EC.set('Q801', { claims: { P1014: [{ mainsnak: { datavalue: { value: '300000801' } } }] } });
        EC.set('Q802', { claims: { P1014: [{ mainsnak: { datavalue: { value: '300000802' } } }] } });
        EC.set('Q803', { claims: {} }); EC.set('Q804', { claims: {} }); EC.set('Q805', { claims: {} })`);
    const n = await $w(`prefetchHierarchies([{ qid: 'Q801' }, { qid: 'Q802' }, { qid: 'Q803' }])`);
    const afterPrep = asked.slice();
    const h = await $w(`Promise.all([getHierarchy('Q801', null, null, null), getHierarchy('Q802', null, null, null), getHierarchy('Q803', null, null, null)])`);
    check('three terms prepared with ONE Wikidata and ONE Getty query',
      n === 3 && afterPrep.filter(x => x === 'wd').length === 1 && afterPrep.filter(x => x === 'aat').length === 1, afterPrep);
    check('a click on a prepared term asks nothing more', asked.length === afterPrep.length, asked);
    check('of 25 subclasses the 20 with the lowest numbers are kept (fixed rule, no NS item, same languages)',
      h[0].filter(x => x.srcs.includes('WD')).every(x => !/ (2[0-4])$/.test(x.label)), h[0].filter(x => x.srcs.includes('WD')).map(x => x.label).slice(-3));
    check('per term at most 20 Wikidata rows (as the single-term LIMIT 20)',
      h[0].filter(x => x.srcs.includes('WD')).length === 20 && h[1].some(x => x.srcs.includes('AAT')) && h[2].filter(x => x.srcs.includes('WD')).length === 2,
      h.map(x => x.length));
    asked.length = 0; down = true;
    await $w(`prefetchHierarchies([{ qid: 'Q804' }])`);
    down = false;
    const h4 = await $w(`getHierarchy('Q804', null, null, null)`);
    check('a failed preparation leaves nothing behind: the click asks again and gets the hierarchy',
      asked.join() === 'wd,wd-fallback,wd' && h4.filter(x => x.srcs.includes('WD')).length === 2, { asked, n: h4.length });
    asked.length = 0;
    await $w(`Promise.all([getHierarchy('Q805', null, null, null), getHierarchy('Q805', null, null, null)])`);
    check('two requests for the same hierarchy at the same time: one computation', asked.join() === 'wd', asked);
    W.fetch = realFetch;
  }

  section('a long SPARQL query goes by POST (Getty refuses long GET addresses)');
  {
    const seen = [];
    const realFetch = W.fetch;
    W.fetch = async (url, opts) => {
      seen.push({ url: String(url), method: (opts && opts.method) || 'GET', body: opts && opts.body, ct: opts && opts.headers && opts.headers['Content-Type'] });
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify({ results: { bindings: [] } }) };
    };
    await $w(`sparql(AAT_SPARQL, aatHierarchyQuery(['300026096']))`);
    await $w(`sparql(AAT_SPARQL, aatHierarchyQuery(Array.from({ length: 20 }, (_, i) => String(300026096 + i))))`);
    W.fetch = realFetch;
    check('short query: GET as before', seen[0].method === 'GET' && seen[0].url.includes('?query='), seen[0]);
    check('long query: POST, form-encoded, address without the query',
      seen[1].method === 'POST' && seen[1].url === 'https://vocab.getty.edu/sparql' && /^query=/.test(seen[1].body || '')
      && seen[1].ct === 'application/x-www-form-urlencoded', { method: seen[1].method, url: seen[1].url });
  }

  section('places — the IdRef twin of the BnF ark when Wikidata has no IdRef id');
  {
    const asked = [];
    const realFetch = W.fetch;
    const ok = payload => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload) });
    const ENT = {
      Q46: { labels: { it: { value: 'Europa' } }, claims: { P227: [{ mainsnak: { datavalue: { value: '4015701-5' } } }],
        P268: [{ mainsnak: { datavalue: { value: '11931301w' } } }] } },
      Q38: { labels: { it: { value: 'Italia' } }, claims: { P227: [{ mainsnak: { datavalue: { value: '4027833-5' } } }],
        P269: [{ mainsnak: { datavalue: { value: '027235408' } } }], P268: [{ mainsnak: { datavalue: { value: '11864655t' } } }] } },
      // Q17 as in Wikidata: the State as a body (b) first, the place (c) second.
      Q17: { labels: { it: { value: 'Giappone' } }, claims: { P227: [{ mainsnak: { datavalue: { value: '4028495-5' } } }],
        P269: [{ mainsnak: { datavalue: { value: '02648918X' } } }, { mainsnak: { datavalue: { value: '027262162' } } }] } },
    };
    W.fetch = async (url, opts) => {
      const u = decodeURIComponent(String(url) + ' ' + ((opts && opts.body) || ''));
      if (u.startsWith('https://qlever.dev')) {
        const map = { '4015701-5': 'Q46', '4027833-5': 'Q38', '4028495-5': 'Q17' };
        const bindings = Object.entries(map).filter(([g]) => u.includes('"' + g + '"'))
          .map(([g, q]) => ({ i: { value: 'http://www.wikidata.org/entity/' + q }, v: { value: g }, p: { value: 'P227' } }));
        return ok({ results: { bindings } });
      }
      if (u.includes('wbgetentities')) { const q = Object.keys(ENT).find(k => u.includes('ids=' + k)); return ok({ entities: q ? { [q]: ENT[q] } : {} }); }
      if (u.startsWith('https://www.idref.fr/Sru/Solr')) {
        asked.push(u.includes('idsext_s') ? 'ark' : u.includes(' OR ') ? 'many' : 'ppn');
        if (W.__idrefDown === 'timeout') throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
        if (W.__idrefDown === '404') return { ok: false, status: 404, headers: { get: () => null }, text: async () => '' };
        if (u.includes(' OR ')) return ok({ response: { docs: [
          { ppn_z: '02648918X', affcourt_z: 'Japon', recordtype_z: 'b' }, { ppn_z: '027262162', affcourt_z: 'Japon', recordtype_z: 'c' }] } });
        if (u.includes('cb11931301w')) return ok({ response: { docs: [{ ppn_z: '027224651', affcourt_z: 'Europe', recordtype_z: 'c' }] } });
        if (u.includes('027235408')) return ok({ response: { docs: [{ ppn_z: '027235408', affcourt_z: 'Italie', recordtype_z: 'c' }] } });
        return ok({ response: { docs: [] } });
      }
      return realFetch(url, opts);
    };
    let r = await $w(`reconcile('Europa', '4015701-5', null, 'gnd', 'place')`);
    check('GND Europa: Wikidata has only the BnF ark → IdRef twin «Europe», kept as the link',
      r.controlledLabels.fr === 'Europe' && r.idrefTwin === '027224651' && asked.includes('ark'), { fr: r.controlledLabels.fr, twin: r.idrefTwin, asked });
    asked.length = 0;
    r = await $w(`reconcile('Italien', '4027833-5', null, 'gnd', 'place')`);
    check('GND Italien: Wikidata has the IdRef id → that one, no ark search',
      r.controlledLabels.fr === 'Italie' && !r.idrefTwin && !asked.includes('ark'), { fr: r.controlledLabels.fr, asked });
    asked.length = 0;
    r = await $w(`reconcile('Japan', '4028495-5', null, 'gnd', 'place')`);
    check('GND Japan: two IdRef ids in Wikidata → the place (type c), not the State as a body (b), in one request',
      r.idrefWd === '027262162' && r.controlledLabels.fr === 'Japon' && JSON.stringify(asked) === '["many"]', { wd: r.idrefWd, fr: r.controlledLabels.fr, asked });

    // IdRef silent (time-outs): GND Italien must not stay without its
    // French form for the whole session.
    $w(`RC.clear()`);
    W.__idrefDown = 'timeout'; asked.length = 0;
    r = await $w(`reconcile('Italien', '4027833-5', null, 'gnd', 'place')`);
    check('IdRef time-out: the result names the silent service, no French form',
      JSON.stringify(r.netFail) === '["IdRef"]' && !r.controlledLabels.fr, { netFail: r.netFail, fr: r.controlledLabels.fr });
    W.__idrefDown = null; asked.length = 0;
    r = await $w(`reconcile('Italien', '4027833-5', null, 'gnd', 'place')`);
    check('the incomplete result is not kept: the next request asks IdRef again and gets «Italie»',
      asked.includes('ppn') && r.controlledLabels.fr === 'Italie' && !r.netFail, { asked, fr: r.controlledLabels.fr, netFail: r.netFail });
    $w(`RC.clear()`);
    W.__idrefDown = '404';
    r = await $w(`reconcile('Italien', '4027833-5', null, 'gnd', 'place')`);
    check('an answer (404) is not a silence: no clock, result kept', !r.netFail && $w(`RC.size`) > 0, { netFail: r.netFail });
    W.__idrefDown = null; $w(`RC.clear()`);
    check('temporary failures: time-out, 5xx, 429, network — not 403/404',
      ['TIMEOUT', 'HTTP 503', 'HTTP 429'].every(m => $w(`isTemporaryFailure(new Error('${m}'))`))
      && $w(`isTemporaryFailure(new TypeError('Failed to fetch'))`)
      && !['HTTP 403', 'HTTP 404', 'REDIRECT'].some(m => $w(`isTemporaryFailure(new Error('${m}'))`)));
    W.fetch = realFetch;
  }

  section('one request per BNE id');
  {
    const asked = [];
    const realFetch = W.fetch;
    W.fetch = async url => { asked.push(String(url)); return { ok: false, status: 403, headers: { get: () => null }, text: async () => '' }; };
    const answers = await Promise.all([$w(`fetchBNE('XX982981')`), $w(`fetchBNE('XX982981')`)]);
    const again = await $w(`fetchBNE('XX982981')`);
    await $w(`fetchBNE('XX1723261')`);
    W.fetch = realFetch;
    check('a refused BNE id is asked once, in flight or after the refusal',
      asked.filter(u => u.includes('XX982981')).length === 1 && answers.every(a => a === null) && again === null, asked);
    check('another BNE id is still asked', asked.some(u => u.includes('XX1723261')), asked);
  }

  // ── 8. Packaged data ────────────────────────────────────────
  section('LCSH name authorities');
  {
    const asked = [];
    const realFetch = W.fetch;
    W.fetch = async url => {
      const u = String(url); asked.push(u);
      const m = u.match(/^https:\/\/id\.loc\.gov\/authorities\/(names|subjects)\/(\w+)\.json$/);
      const payload = m ? [{ '@id': 'http://id.loc.gov/authorities/' + m[1] + '/' + m[2],
        'http://www.loc.gov/mads/rdf/v1#authoritativeLabel': [{ '@value': m[1] === 'names' ? 'Aristophanes' : 'Trinity' }] }] : [];
      return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
    };
    const name = await $w(`fetchLCSH('n79021783')`);
    const subj = await $w(`fetchLCSH('sh85137555')`);
    W.fetch = realFetch;
    check('name authority read from /authorities/names/ (was a 404 on /subjects/)',
      name === 'Aristophanes' && asked[0] === 'https://id.loc.gov/authorities/names/n79021783.json', asked[0]);
    check('subject heading still read from /authorities/subjects/',
      subj === 'Trinity' && asked[1] === 'https://id.loc.gov/authorities/subjects/sh85137555.json', asked[1]);
    check('timing log names the MARC SRU request', $w(`describeRequest('https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?version=1.2&query=alma.mms_id=1')`) === 'swisscovery.slsp.ch SRU (MARC)');
  }

  section('release: timing log off');
  {
    const stored = {};
    W.chrome.storage.local.get = async k => ({ [k]: stored[k] });
    W.chrome.storage.local.set = async o => { Object.assign(stored, o); };
    await $w(`fetchJSON('https://query.wikidata.org/sparql?query=x&format=json')`);
    await new Promise(res => setTimeout(res, 700));
    check('TIMING_LOG is off: nothing is written to chrome.storage', $w(`TIMING_LOG`) === false && stored.snTiming === undefined, stored);
  }

  section('packaged data');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  // Release: the first public version is 1.0.0.
  check('manifest version 1.0.0', manifest.version === '1.0.0', manifest.version);
  check('module service worker', manifest.background.type === 'module');
  check('no tabs/activeTab permission', !(manifest.permissions || []).some(p => p === 'tabs' || p === 'activeTab'), manifest.permissions);
  check('8 content scripts declared (cs_site.js first)', manifest.content_scripts[0].js.length === 8);
  // Nothing web-accessible — the catalog pages cannot probe for the extension.
  check('no web_accessible_resources', !('web_accessible_resources' in manifest), manifest.web_accessible_resources);
  const vocabForms = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab_forms.json'), 'utf8')).forms;
  check('forms table packaged: 12 SLSP triples, every row with DE/FR/IT', vocabForms.filter(f => f.status === 'slsp').length === 12
    && vocabForms.every(f => f.de && f.fr && f.it), vocabForms.length);
  C.__forms = vocabForms;
  r = $(`[
    formEquivalents({ term: 'Ausstellungskatalog', source: 'gnd' }, __forms),
    formEquivalents({ term: 'Libri illustrati', source: 'sbt', idrefId: '027320456' }, __forms),
    formEquivalents({ term: 'Catalogues d\\'exposition.', source: 'idref', idrefId: '027320456' }, __forms),
    formEquivalents({ term: 'Catalogue d\\'exposition', source: 'idref' }, __forms),
    formEquivalents({ term: 'Aufsatzsammlung', source: 'gnd' }, __forms)
  ]`);
  check('forms: gnd-content label → official DE/FR/IT', r[0] && r[0].labels.it === 'Cataloghi di esposizioni' && r[0].labels.fr === "Catalogues d'exposition", r[0]);
  check('forms: SBT label wins over a $0 copied from another form', r[1] && r[1].labels.de === 'Bildband', r[1]);
  check('forms: IdRef by label (trailing period ignored)', r[2] && r[2].labels.de === 'Ausstellungskatalog', r[2]);
  check('forms: RDA-table singular wording recognised as alias', r[3] && r[3].labels.it === 'Cataloghi di esposizioni', r[3]);
  check('forms: form outside the table stays untranslated', r[4] === null, r[4]);
  check('forms: Spanish and English from the 8 October choices (BNE Género/Forma)',
    vocabForms.filter(f => f.es).length === 27 && r[0].labels.es === 'Catálogos de exposiciones', r[0]);
  // One 655 per vocabulary (IdRef «Périodique» found by its id)
  r = $(`(function(){
    const forms = [
      { term: 'Zeitschrift', display: 'Zeitschrift', source: 'gnd' },
      { term: 'Périodique', display: 'Périodique', source: 'idref', idrefId: '02724640X' },
      { term: 'Periodici', display: 'Periodici', source: 'sbt' },
      { term: 'Aufsatzsammlung', display: 'Aufsatzsammlung', source: 'gnd' },
      { term: 'Raccolta di saggi', display: 'Raccolta di saggi', source: 'sbt' }
    ];
    const groups = formGroups(forms, __forms);
    const views = groups.map(formGroupView);
    const results = [];
    groups.forEach((g, i) => g.forms.forEach(f => results.push({ label: f.term, termType: 'form',
      controlledLabels: views[i].cl, formKey: g.eq ? 'g' + i : null })));
    const arte = { label: 'Arte', vocabSource: 'sbt', nsData: { id: '1' }, controlledLabels: { it: 'Arte', de: 'Kunst' } };
    const items = andChipItems([arte, ...results]);
    return { n: groups.length, view: views[0], chips: items.map(x => [x.label, ...x.andSiblings.map(s => s.label)].join(' · ')),
      url: buildCrossAndUrl([items[0], items[1]], 'subject') };
  })()`);
  check('forms: the three 655 of one table row make one badge; forms outside the table stay apart',
    r.n === 3 && r.view.title === 'Zeitschrift · Périodique · Periodici' && r.view.vocabs.join(' · ') === 'GND · IdRef · SBT/NS', r);
  check('forms: the badge lists only the official wordings the record lacks',
    JSON.stringify(r.view.other) === JSON.stringify([['fr', 'Périodiques'], ['en', 'Periodicals'], ['es', 'Revistas']]), r.view.other);
  check('forms: one combined-search chip for the row, record wordings kept',
    JSON.stringify(r.chips) === JSON.stringify(['Arte', 'Zeitschrift · Périodique · Periodici', 'Aufsatzsammlung', 'Raccolta di saggi']), r.chips);
  check('forms: the chip searches each official wording once per language',
    q(r.url) === '("Arte" AND "Periodici") OR ("Kunst" AND "Zeitschrift") OR ("Arte" AND "Périodiques") OR ("Arte" AND "Periodicals") OR ("Arte" AND "Revistas")', q(r.url));
  // SBT «Arte — Periodici» ($x Periodici, NS 2757) and the three 655 of the
  // Periodici row: the form joins the subject chip, no word searched twice.
  r = $(`(function(){
    const forms = [
      { term: 'Zeitschrift', display: 'Zeitschrift', source: 'gnd' },
      { term: 'Périodique', display: 'Périodique', source: 'idref', idrefId: '02724640X' },
      { term: 'Periodici', display: 'Periodici', source: 'sbt' }
    ];
    const g = formGroups(forms, __forms)[0], v = formGroupView(g);
    const fr = forms.map(f => ({ label: f.term, termType: 'form', controlledLabels: v.cl, formKey: 'g0' }));
    const arte = { label: 'Arte', vocabSource: 'sbt', nsData: { id: '1' }, controlledLabels: { it: 'Arte', de: 'Kunst', fr: 'Art', en: 'Art', es: 'Arte' } };
    const per = { label: 'Periodici', vocabSource: 'sbt', nsData: { id: '2757' },
      controlledLabels: { it: 'Periodici', de: 'Fachzeitschrift', fr: 'Périodique', en: 'Periodicals', es: 'Publicaciones periódicas' } };
    const items = andChipItems([arte, per, ...fr]);
    return { chips: items.map(x => [x.label, ...x.andSiblings.map(s => s.label)].join(' · ')),
      url: buildCrossAndUrl(items, 'subject') };
  })()`);
  check('forms: a form the record also has as a subject joins the subject chip',
    JSON.stringify(r.chips) === JSON.stringify(['Arte', 'Periodici · Zeitschrift · Périodique']), r.chips);
  check('forms: subject + form searched once, wordings in OR, no German in the Spanish branch',
    q(r.url) === '("Arte" AND "Periodici") OR ("Kunst" AND ("Fachzeitschrift" OR "Zeitschrift")) OR ("Art" AND ("Périodique" OR "Périodiques")) OR ("Art" AND "Periodicals") OR ("Arte" AND ("Publicaciones periódicas" OR "Revistas"))', q(r.url));
  const vocabBaam = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab_baam.json'), 'utf8'));
  check('vocab_baam._macros present', !!vocabBaam._macros && vocabBaam._macros.groups.length === 9);
  check('vocab_baam._macros quadrilingual labels', vocabBaam._macros.groups.every(g => g.label.it && g.label.de && g.label.fr && g.label.en));
  const baamKeys = Object.keys(vocabBaam).filter(k => !k.startsWith('_') && !vocabBaam[k].redirect);
  check('every BAAM class in IT/DE/FR/EN',
    baamKeys.length === 1326 && baamKeys.every(k => { const l = vocabBaam[k].label; return l && l.it && l.de && l.fr && l.en; }),
    baamKeys.filter(k => typeof vocabBaam[k].label === 'string').slice(0, 5));
  check('no BAAM class is its own parent; every parent exists',
    baamKeys.every(k => vocabBaam[k].parent !== k && (!vocabBaam[k].parent || vocabBaam[k].parent in vocabBaam)));
  check('reviewed BAAM classes (726.830, 791 Cinema, 688.770, 793.210)',
    vocabBaam['726.830'] && !vocabBaam['726.822'] && vocabBaam['726'].children.includes('726.830')
    && vocabBaam['791'].label.it === 'Cinema' && vocabBaam['791'].parent === '790'
    && !vocabBaam['791.700'] && !vocabBaam['791.800'] && vocabBaam['688.770'].parent === '688'
    && vocabBaam._macros.byGroup['7xx'].includes('793.210'));
  r = $(`(function(){ const f = classLookupFull('791.320', null, ${JSON.stringify(vocabBaam)});
    return classChain(f.key, ${JSON.stringify(vocabBaam)}, {}).map(c => c.key + ' ' + classLabel(c.entry, 'de')); })()`);
  check('BAAM chain shown in German: 790 > 791 > 791.320', JSON.stringify(r) ===
    JSON.stringify(['790 Unterhaltung, Zerstreuung, Spiele, Sport', '791 Film', '791.320 Theorie, Kritik, Philosophie des Films']), r);
  const relators = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab_relators.json'), 'utf8'));
  check('complete current LoC relator code list packaged', relators.count >= 300 && Object.keys(relators.relators).length === relators.count, relators.count);
  check('common LoC relators present', !!relators.relators.aut && !!relators.relators.cre && !!relators.relators.res);

  // ── security review fixes ──
  section('security fixes');
  {
    const okResp = (payload, extra = {}) => ({ ok: true, headers: { get: () => null },
      text: async () => JSON.stringify(payload), json: async () => payload, ...extra });
    const realFetch = W.fetch;

    // The QID lobid declares is accepted only as Q + digits
    W.fetch = async url => {
      const u = String(url);
      if (u.startsWith('https://lobid.org/gnd/B1-BAD')) return okResp({ preferredName: 'X', type: ['SubjectHeading'],
        sameAs: [{ id: 'https://www.wikidata.org/entity/Q1&action=wbeditentity' }] });
      if (u.startsWith('https://lobid.org/gnd/B1-GOOD')) return okResp({ preferredName: 'Y', type: ['SubjectHeading'],
        sameAs: [{ id: 'http://www.wikidata.org/entity/Q42' }] });
      return realFetch(url);
    };
    r = await $w(`resolveViaLobid('B1-BAD')`);
    check('malformed QID from lobid ignored', r && r.wikidataId === null, r && r.wikidataId);
    r = await $w(`resolveViaLobid('B1-GOOD')`);
    check('well-formed QID from lobid kept', r && r.wikidataId === 'Q42', r && r.wikidataId);

    // A redirect is followed only to a whitelisted host
    W.fetch = async () => okResp({ ok: 1 }, { redirected: true, url: 'https://evil.example/x' });
    r = await $w(`fetchJSON('https://lobid.org/gnd/X.json').then(() => 'read', e => e.message)`);
    check('redirect to a foreign host refused', r === 'REDIRECT', r);
    W.fetch = async () => okResp({ ok: 1 }, { redirected: true, url: 'https://www.wikidata.org/x' });
    r = await $w(`fetchJSON('https://lobid.org/gnd/X.json').then(() => 'read', e => e.message)`);
    check('redirect to a whitelisted host followed', r === 'read', r);

    // Panel files served by the worker, by name only
    W.fetch = async url => String(url).startsWith('chrome-extension://test/')
      ? { ok: true, text: async () => 'CONTENT:' + String(url).slice('chrome-extension://test/'.length) }
      : realFetch(url);
    const ask = (msg, url) => new Promise(res => {
      const ret = W.chrome.__onMessage(msg, { tab: { url: url || 'https://usi.swisscovery.slsp.ch/discovery/fulldisplay' } }, res);
      if (ret !== true && ret !== false) res({ error: 'no answer' });
    });
    r = await ask({ type: 'resource', name: 'vocab_cdd.json' });
    check('worker serves a panel file', r && r.data === 'CONTENT:vocab_cdd.json', r);
    // The local classification of the 691 field is the BAAM one, not UDC.
    r = await ask({ type: 'resource', name: 'vocab_baam.json' });
    check('worker serves the BAAM classification table', r && r.data === 'CONTENT:vocab_baam.json', r);
    r = await ask({ type: 'resource', name: 'vocab_cdu.json' });
    check('no table under the old UDC name', r && r.error === 'unknown resource', r);
    check('BAAM classification searched in its own field', $(`CLASS_SEARCH_FIELDS.baam`) === 'lds49' && $(`CLASS_SEARCH_FIELDS.cdu`) === undefined, $(`JSON.stringify(CLASS_SEARCH_FIELDS)`));
    check('BAAM classification named in every language', ['it', 'de', 'fr', 'en'].every(l => /BAAM/.test($(`I18N.${l}.classBaamName`) || '')));
    r = await ask({ type: 'resource', name: '../manifest.json' });
    check('worker refuses a path', r && r.error === 'unknown resource', r);
    r = await ask({ type: 'resource', name: 'unified_index_core.json' });
    check('worker refuses a file not meant for the panel', r && r.error === 'unknown resource', r);
    r = await ask({ type: 'resource', name: 'vocab_cdd.json' }, 'https://evil.example/');
    check('sender outside the catalogs refused', r && r.error === 'message sender not allowed', r);
    W.fetch = realFetch;
    check('panel vocabularies loaded through the worker',
      ['vocab_baam.json', 'vocab_cdd.json', 'vocab_geo.json', 'vocab_relators.json', 'vocab_forms.json']
        .every(n => (workerCalls.resource || []).includes(n)), workerCalls.resource);
    check('forms table arrived in the content script', $(`VOCAB_FORMS.length`) > 0);

    // Keys inherited from Object.prototype find nothing
    await $w(`ensureLabels(['de', 'fr'])`);
    check('own() ignores inherited keys', $w(`own({}, 'constructor')`) === undefined && $w(`own({ a: 1 }, 'a')`) === 1);
    check('NS label lookup «constructor» → none', $w(`(nsLookupCandidates('constructor') || []).length`) === 0);
    check('NS concept «__proto__» → null', $w(`nsGetConcept('__proto__')`) === null);
    r = $w(`(() => { try { return nsLookupByFrLabel('Constructor'); } catch (e) { return 'THROW ' + e.message; } })()`);
    check('French label «Constructor» → null, no error', r === null, r);
    check('authority label «toString» → null', $w(`getAuthLabel('gnd', 'toString')`) === null
      && $w(`getAuthLabel('bnf', 'constructor')`) === null);
    check('GND/RAMEAU hierarchy «constructor» → null', $w(`getGndBroaderNarrower('constructor')`) === null
      && $w(`getBnfBroaderNarrower('constructor')`) === null);

    // SRU requests only to the catalogs' SRU addresses
    check('SRU url swisscovery', $w(`isAllowedSruUrl('https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK?x=1')`) === true);
    check('SRU url reperio', $w(`isAllowedSruUrl('https://reperio.usi.ch/view/sru/41SLSP_USI')`) === true);
    check('SRU url foreign host', $w(`isAllowedSruUrl('https://evil.example/view/sru/x')`) === false);
    check('SRU url http', $w(`isAllowedSruUrl('http://swisscovery.ch/view/sru/x')`) === false);
    check('SRU url other path', $w(`isAllowedSruUrl('https://swisscovery.ch/discovery/search')`) === false);
    r = await $w(`fetchXML('https://evil.example/view/sru/x').then(() => 'fetched', e => e.message)`);
    check('fetchXML refuses a foreign host', String(r).startsWith('URL not allowed'), r);

    // Links only https
    check('javascript: link not set', $(`el('a', { href: 'javascript:alert(1)' }).href`) === undefined);
    check('data: link not set', $(`el('a', { href: 'data:text/html,x' }).href`) === undefined);
    check('https link set', $(`el('a', { href: 'https://www.wikidata.org/wiki/Q42' }).href`) === 'https://www.wikidata.org/wiki/Q42');

    // Interface language: supported ones only
    const loc = C.window.location;
    loc.search = '?lang=xx'; const l1 = $(`getInterfaceLang()`);
    loc.search = '?lang=DE'; const l2 = $(`getInterfaceLang()`);
    loc.search = '?lang=fr_FR'; const l3 = $(`getInterfaceLang()`);
    loc.search = '';
    check('unsupported language → it; DE → de; fr_FR → fr', l1 === 'it' && l2 === 'de' && l3 === 'fr', [l1, l2, l3]);
  }

  // ── refactoring, step 1 ──
  section('version in one place');
  {
    const utilSrc = fs.readFileSync(path.join(ROOT, 'bg_util.js'), 'utf8');
    check('no version written by hand in bg_util.js', !/SubjectNavigator\/\d/.test(utilSrc));
    check('Api-User-Agent carries the manifest version',
      $w(`API_USER_AGENT`) === 'SubjectNavigator/' + manifest.version + ' (https://github.com/MicheleStefani/subjectnavigator)',
      $w(`API_USER_AGENT`));
  }

  section('subfield components, pinned before the refactoring');
  {
    const COMPONENT_CASES = {"cases":{"sbt":[{"c":"a","v":"Chiese [e] conventi"},{"c":"x","v":"Storia."},{"c":"z","v":"Italia"},{"c":"y","v":"Sec. 19."},{"c":"v","v":"Guide."},{"c":"2","v":"nsbncf"},{"c":"0","v":"x123"},{"c":"x","v":" [e] "}],"subj630":[{"c":"a","v":"Bibbia"},{"c":"p","v":"Nuovo Testamento"},{"c":"l","v":"Latino"},{"c":"x","v":"Critica [e] interpretazione."},{"c":"y","v":"1500-1600."},{"c":"v","v":"Commenti."}],"subj650":[{"c":"a","v":"Arte"},{"c":"z","v":"Firenze"},{"c":"x","v":"Storia"}],"person":[{"c":"a","v":"Manzoni, Alessandro,"},{"c":"d","v":"1785-1873"},{"c":"x","v":"Critica e interpretazione."},{"c":"z","v":"Milano"},{"c":"v","v":"Bibliografie."}],"corporate":[{"c":"a","v":"Chiesa cattolica"},{"c":"b","v":"Papa"},{"c":"x","v":"Storia"},{"c":"y","v":"Sec. 20."}],"meeting":[{"c":"a","v":"Concilio Vaticano"},{"c":"n","v":"2."},{"c":"d","v":"1962-1965"},{"c":"c","v":"Città del Vaticano"},{"c":"x","v":"Documenti [e] atti"}]},"out":{"sbt":[{"t":"Chiese","type":"a"},{"t":"conventi","type":"a"},{"t":"Storia.","type":"x"},{"t":"Italia","type":"z"},{"t":"Sec. 19","type":"y"},{"t":"Guide","type":"v"}],"subj630":[{"t":"Bibbia — Nuovo Testamento — Latino","type":"a"},{"t":"Critica","type":"x"},{"t":"interpretazione.","type":"x"},{"t":"1500-1600","type":"y"},{"t":"Commenti","type":"v"}],"subj650":[{"t":"Arte","type":"a"},{"t":"Firenze","type":"z"},{"t":"Storia","type":"x"}],"person":[{"t":"Manzoni, Alessandro, (1785-1873)","type":"a"},{"t":"Critica e interpretazione.","type":"x"},{"t":"Milano","type":"z"},{"t":"Bibliografie","type":"v"}],"corporate":[{"t":"Chiesa cattolica — Papa","type":"a"},{"t":"Storia","type":"x"},{"t":"Sec. 20","type":"y"}],"meeting":[{"t":"Concilio Vaticano (2 : 1962-1965 : Città del Vaticano)","type":"a"},{"t":"Documenti","type":"x"},{"t":"atti","type":"x"}]}};
    const COMPONENT_CALLS = {"sbt":"sbtC(I)","subj630":"subjectC(I, '630')","subj650":"subjectC(I, '650')","person":"nameC(I, 'person')","corporate":"nameC(I, 'corporate')","meeting":"nameC(I, 'meeting')"};
    for (const k of Object.keys(COMPONENT_CALLS)) {
      const got = $(COMPONENT_CALLS[k].replace('I', JSON.stringify(COMPONENT_CASES.cases[k])));
      check(k + ' components unchanged', JSON.stringify(got) === JSON.stringify(COMPONENT_CASES.out[k]), got);
    }
  }

  section('per-string AND button (one function, quoted labels)');
  {
    const comps = [{ t: 'Chiese', type: 'a' }, { t: 'Storia', type: 'x' }, { t: 'Sec. 19', type: 'y' }, { t: 'Guide', type: 'v' }];
    const cr = [
      { controlledLabels: { it: 'Chiese', de: 'Kirche' } },
      { controlledLabels: { it: 'Storia', de: 'Geschichte', fr: 'Histoire' } },
      { controlledLabels: { it: 'Sec. 19' }, termType: 'period' },
      { controlledLabels: { it: 'Guide' }, termType: 'form' }
    ];
    const run = (c, r) => $('componentAndSearch(' + JSON.stringify(c) + ', ' + JSON.stringify(r) + ')');
    r = run(comps, cr);
    check('label names the searchable components', r && r.label === 'AND: Chiese + Storia', r);
    check('one AND group per language with 2+ labels, joined by OR; period and form left out',
      r && r.url === $('buildSearchUrl(' + JSON.stringify('("Chiese" AND "Storia") OR ("Kirche" AND "Geschichte")') + ", 'subject')"), r && r.url);
    check('a single searchable component gives no button', run(comps.slice(0, 1).concat(comps.slice(2)), [cr[0], cr[2], cr[3]]) === null);
    check('a component without a result is left out', run(comps, [cr[0], null, cr[2], cr[3]]) === null);
    r = run([{ t: 'Il "nuovo" cinema', type: 'a' }, { t: 'Storia', type: 'x' }],
      [{ controlledLabels: { it: 'Il "nuovo" cinema' } }, { controlledLabels: { it: 'Storia' } }]);
    check('a quote inside a label cannot break the query (quotePhrase)',
      r && r.url === $('buildSearchUrl(' + JSON.stringify('("Il nuovo cinema" AND "Storia")') + ", 'subject')"), r && r.url);
  }

  section('class search URLs, pinned before the refactoring');
  {
    const CLASS_URL_CASES = [["classBuildSearchUrl(\"72.033\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"exact\", [])",{"url":"https://swisscovery.ch/discovery/search?query=lds49,contains,72.033&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"72.033","onlyAux":false}],["classBuildSearchUrl(\"72.033\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", [])",{"url":"https://swisscovery.ch/discovery/search?query=lds49,contains,72.033*&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"72.033*","onlyAux":false}],["classBuildSearchUrl(\"720.000\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", [\"(450)\",\"\\\"19\\\"\"])",{"url":"https://swisscovery.ch/discovery/search?query=lds49,contains,720.000*%20(450)%20%2219%22&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"720.000* + (450) + \"19\"","onlyAux":false}],["classBuildSearchUrl(\"\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"exact\", [\"(450)\"])",{"url":"https://swisscovery.ch/discovery/search?query=lds49,contains,%20(450)&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":" + (450)","onlyAux":true}],["classBuildSearchUrl(\"945\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", null)",{"url":"https://swisscovery.ch/discovery/search?query=lds49,contains,945*&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"945*","onlyAux":false}],["classBuildCDDSearchUrl(\"72.033\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"exact\", [])",{"url":"https://swisscovery.ch/discovery/search?query=lds56,contains,72.033&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"72.033","onlyAux":false}],["classBuildCDDSearchUrl(\"72.033\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", [])",{"url":"https://swisscovery.ch/discovery/search?query=lds56,contains,72.033*&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"72.033*","onlyAux":false}],["classBuildCDDSearchUrl(\"720.000\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", [\"(450)\",\"\\\"19\\\"\"])",{"url":"https://swisscovery.ch/discovery/search?query=lds56,contains,720.000*%20(450)%20%2219%22&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"720.000* + (450) + \"19\"","onlyAux":false}],["classBuildCDDSearchUrl(\"\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"exact\", [\"(450)\"])",{"url":"https://swisscovery.ch/discovery/search?query=lds56,contains,%20(450)&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":" + (450)","onlyAux":true}],["classBuildCDDSearchUrl(\"945\", {\"host\":\"swisscovery.ch\",\"vid\":\"41SLSP_NETWORK:VU1_UNION\",\"tab\":\"41SLSP_NETWORK\",\"scope\":\"DN_and_CI&x=1\"}, \"broader\", null)",{"url":"https://swisscovery.ch/discovery/search?query=lds56,contains,945*&tab=41SLSP_NETWORK&search_scope=DN_and_CI%26x%3D1&vid=41SLSP_NETWORK%3AVU1_UNION&mode=advanced","pattern":"945*","onlyAux":false}]];
    CLASS_URL_CASES.forEach(([expr, want], i) => { const got = $(expr); check('class URL ' + (i + 1) + ' unchanged', JSON.stringify(got) === JSON.stringify(want), got); });
  }

  section('site adapter (Primo VE / Alma)');
  {
    const tryC = expr => { try { return $(expr); } catch (e) { return 'ERR ' + e.message; } };
    const tryW = expr => { try { return $w(expr); } catch (e) { return 'ERR ' + e.message; } };
    const NZ = 'https://swisscovery.ch/discovery/fulldisplay?docid=alma991&context=L&vid=41SLSP_NETWORK:VU1_UNION&lang=fr';
    const IZ = 'https://swisscovery.ch/discovery/fulldisplay?docid=alma992&vid=41SLSP_USI:VU1';
    check('a record page is recognised', tryC('isRecordPage(parsePageUrl(' + JSON.stringify(NZ) + '))') === true);
    check('a search page is not a record page',
      tryC("isRecordPage(parsePageUrl('https://swisscovery.ch/discovery/search?query=any,contains,x&vid=41SLSP_NETWORK:VU1_UNION'))") === false);
    check('the page gives a record id', tryC('parsePageUrl(' + JSON.stringify(NZ) + ').recordId') === 'alma991');
    r = tryC('siteSearchContext(parsePageUrl(' + JSON.stringify(NZ) + '))');
    check('search context, network view', JSON.stringify(r) === JSON.stringify({ host: 'swisscovery.ch', vid: '41SLSP_NETWORK:VU1_UNION', tab: '41SLSP_NETWORK', scope: 'DN_and_CI' }), r);
    r = tryC('siteSearchContext(parsePageUrl(' + JSON.stringify(IZ) + '))');
    check('search context, institution view', JSON.stringify(r) === JSON.stringify({ host: 'swisscovery.ch', vid: '41SLSP_USI:VU1', tab: '41SLSP_USI_MyInst_and_CI', scope: 'MyInst_and_CI' }), r);
    r = tryC('siteSearchContext(parsePageUrl(' + JSON.stringify(IZ + '&tab=T1&search_scope=S1') + '))');
    check('tab and scope of the page win', r && r.tab === 'T1' && r.scope === 'S1', r);
    r = tryC('marcRequestParams(parsePageUrl(' + JSON.stringify(IZ) + '))');
    check('MARC request parameters', JSON.stringify(r) === JSON.stringify({ docId: 'alma992', mmsId: '992', vid: '41SLSP_USI:VU1', instCode: '41SLSP_USI', pageHost: 'swisscovery.ch' }), r);

    // SRU addresses: swisscovery.ch first (swisscovery.slsp.ch is being retired)
    const q = '?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.mms_id=9912345';
    r = tryW("marcSources('9912345', '41SLSP_USI', 'reperio.usi.ch')");
    check('SRU order — network zone, then the institution, swisscovery.ch before slsp',
      JSON.stringify(r) === JSON.stringify([
        { url: 'https://swisscovery.ch/view/sru/41SLSP_NETWORK' + q, source: 'SRU-NZ' },
        { url: 'https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK' + q, source: 'SRU-NZ' },
        { url: 'https://reperio.usi.ch/view/sru/41SLSP_USI' + q, source: 'SRU-IZ' },
        { url: 'https://swisscovery.ch/view/sru/41SLSP_USI' + q, source: 'SRU-IZ' },
        { url: 'https://swisscovery.slsp.ch/view/sru/41SLSP_USI' + q, source: 'SRU-IZ' }]), r);
    r = tryW("marcSources('9912345', '41SLSP_USI', 'evil.example').map(s => s.url.split('/view/')[0])");
    check('an unknown page host is never an SRU base', Array.isArray(r) && !r.some(h => h.includes('evil')), r);
    check('network instCode → network zone only', tryW("marcSources('9912345', '41SLSP_NETWORK', '').length") === 2);
    check('malformed MMS id → no address', tryW("marcSources('12a', '', '').length") === 0);
    check('malformed instCode → network zone only', tryW("marcSources('9912345', 'a/../b', '').length") === 2);
    {
      const asked = [];
      const realFetch = W.fetch;
      const xml = '<record><datafield tag="650" ind1=" " ind2="7"><subfield code="a">Architettura</subfield></datafield></record>';
      W.fetch = async url => { asked.push(String(url));
        return String(url).startsWith('https://swisscovery.ch/view/sru/41SLSP_NETWORK')
          ? { ok: true, headers: { get: () => null }, text: async () => xml }
          : { ok: false, status: 404, headers: { get: () => null }, text: async () => '' }; };
      r = await $w("fetchMarcViaSRU('9912345', '41SLSP_USI', 'swisscovery.ch').catch(e => 'ERR ' + e.message)");
      W.fetch = realFetch;
      check('MARC read from swisscovery.ch at the first request',
        r && r.source === 'SRU-NZ' && r.fields && r.fields[0].tag === '650' && asked.length === 1, { r, asked });
    }
    check('MARC message validated by the adapter', tryW("validMarcRequest({ mmsId: '9912345', instCode: '41SLSP_USI', pageHost: 'swisscovery.ch' })") === true
      && tryW("validMarcRequest({ mmsId: '99x', instCode: '', pageHost: '' })") === false);

    // Loading order and isolation: only the two site files know Primo/Alma.
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
    check('cs_site.js is the first content script', man.content_scripts[0].js[0] === 'cs_site.js', man.content_scripts[0].js);
    check('fallback injection list = manifest list',
      JSON.stringify(tryW('CONTENT_FILES')) === JSON.stringify(man.content_scripts[0].js), tryW('CONTENT_FILES'));
    const PRIMO = /\/discovery\/|swisscovery|\/view\/sru\/|lds49|lds56|search_scope|alma\.mms|alma\(|41SLSP|MyInst|fulldisplay|'docid'|[?&]vid=/;
    const leaks = fs.readdirSync(ROOT).filter(f => /\.js$/.test(f) && !['cs_site.js', 'bg_site.js'].includes(f))
      .flatMap(f => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
        .map((l, i) => [f + ':' + (i + 1), l]).filter(([, l]) => !/^\s*\/\//.test(l) && PRIMO.test(l)).map(([w]) => w));
    check('no Primo/Alma detail outside cs_site.js and bg_site.js', leaks.length === 0, leaks);

    // The worker sandbox strips imports; Chrome links them. A name imported
    // but not exported, or an import cycle, would stop the whole worker.
    const workerMods = fs.readdirSync(ROOT).filter(f => /^(bg_.*|background)\.js$/.test(f));
    const exportsOf = f => new Set([...fs.readFileSync(path.join(ROOT, f), 'utf8')
      .matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(m => m[1]));
    const importProblems = [], deps = {};
    for (const f of workerMods) {
      deps[f] = [];
      for (const m of fs.readFileSync(path.join(ROOT, f), 'utf8').matchAll(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w.]+)';/gm)) {
        deps[f].push(m[2]);
        if (!fs.existsSync(path.join(ROOT, m[2]))) { importProblems.push(f + ' → ' + m[2]); continue; }
        const ex = exportsOf(m[2]);
        m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(n => { if (!ex.has(n)) importProblems.push(f + ' → ' + m[2] + ' ' + n); });
      }
    }
    const done = new Set(), onPath = new Set();
    const visit = f => { if (onPath.has(f)) { importProblems.push('cycle at ' + f); return; } if (done.has(f)) return;
      onPath.add(f); (deps[f] || []).forEach(visit); onPath.delete(f); done.add(f); };
    workerMods.forEach(visit);
    check('worker modules: every import exported, no cycle', importProblems.length === 0, importProblems);
  }

  section('complete names');
  {
    const S = pairs => JSON.stringify(pairs.map(([c, v]) => ({ c, v })));
    const eq = (name, expr, want) => { let got; try { got = $(expr); } catch (e) { got = 'ERR ' + e.message; } check(name, got === want, got); };
    // Persons: every $c, and $q — the parts added go in parentheses, which
    // cleanName() drops, so the Wikidata search term does not change.
    eq('person: second $c kept («Thomas Aquinas (santo)»)',
      'namD(' + S([['a', 'Thomas'], ['c', 'Aquinas'], ['c', 'santo'], ['d', '1225-1274']]) + ')', 'Thomas Aquinas (santo) (1225-1274)');
    eq('person: several $c', 'namD(' + S([['a', 'Berty, Adolphe Eugène Etienne'], ['c', 'Historien'], ['c', 'Architecte, archéologue'], ['d', '1818-1867']]) + ')',
      'Berty, Adolphe Eugène Etienne Historien (Architecte, archéologue) (1818-1867)');
    eq('person: $q fuller form', 'namD(' + S([['a', 'Lucas, F. L.'], ['q', 'Frank Laurence'], ['d', '1894-1967']]) + ')', 'Lucas, F. L. (Frank Laurence) (1894-1967)');
    eq('person: $q with its own brackets and comma', 'namD(' + S([['a', 'Halatsis, C.'], ['q', '(Costas),'], ['e', 'editor.']]) + ')', 'Halatsis, C. (Costas)');
    eq('person: the search term is unchanged by the added parts',
      'cleanName(namD(' + S([['a', 'Thomas'], ['c', 'Aquinas'], ['c', 'santo'], ['d', '1225-1274']]) + '))', 'Thomas Aquinas');
    // Corporate bodies: $g, and the meeting parts $n $d $c under a body (110/710 only)
    eq('body: $g qualifier', 'corpD(' + S([['a', "Musée de l'Ermitage"], ['g', 'Saint-Pétersbourg, Russie']]) + ')', "Musée de l'Ermitage (Saint-Pétersbourg, Russie)");
    eq('body: $g after each level', 'corpD(' + S([['a', 'Staatliche Museen'], ['g', 'Berlin, RDA'], ['b', 'Skulpturensammlung'], ['g', '....-1991']]) + ')',
      'Staatliche Museen (Berlin, RDA) — Skulpturensammlung (....-1991)');
    eq('body: meeting under a body (110/710)', 'corpD(' + S([['a', 'IEEE Power & Energy Society.'], ['b', 'General Meeting'], ['d', '(2017 :'], ['c', 'Chicago, Ill.),'], ['e', 'author.']]) + ', true)',
      'IEEE Power & Energy Society — General Meeting (2017 : Chicago, Ill)');
    eq('body: meeting parts in the order n : d : c', 'corpD(' + S([['a', 'Association for Machine Translation in the Americas.'], ['b', 'Conference'], ['n', '(5th :'], ['d', '2002 :'], ['c', 'Tiburon, Calif.),']]) + ', true)',
      'Association for Machine Translation in the Americas — Conference (5th : 2002 : Tiburon, Calif)');
    eq('body as subject (610): $d $c not read', 'corpD(' + S([['a', 'Vollard, Ambroise'], ['d', '1867-1939']]) + ')', 'Vollard, Ambroise');
    // Meetings: every $c
    eq('meeting: several $c', 'meetD(' + S([['a', 'International Symposium on Devices, Circuits and Systems'], ['n', '(4th :'], ['d', '2021 :'], ['c', 'Higashihiroshima-shi, Japan;'], ['c', 'Online)']]) + ')',
      'International Symposium on Devices, Circuits and Systems (4th : 2021 : Higashihiroshima-shi, Japan; Online)');
    // Through extractAll: 710 with a meeting, 610 without; 651 $b
    const fields = JSON.stringify([
      { tag: '710', ind: '2 ', subs: [{ c: 'a', v: 'IEEE Power & Energy Society.' }, { c: 'b', v: 'General Meeting' }, { c: 'd', v: '(2017 :' }, { c: 'c', v: 'Chicago, Ill.),' }] },
      { tag: '651', ind: ' 7', subs: [{ c: 'a', v: 'Katholische Kirche' }, { c: 'b', v: 'Diözese Spoleto' }, { c: '0', v: '(DE-588)1352526573' }, { c: '2', v: 'gnd' }] }
    ]);
    r = (() => { try { return $('extractAll(' + fields + ')'); } catch (e) { return { err: e.message }; } })();
    check('extractAll: 710 name with its meeting', r.names && r.names[0] && r.names[0].display === 'IEEE Power & Energy Society — General Meeting (2017 : Chicago, Ill)', r.names);
    check('extractAll: 651 $b in the GND heading', r.gnd && r.gnd[0] && r.gnd[0].term === 'Katholische Kirche — Diözese Spoleto', r.gnd);
  }

  section('name-title, body-title, meeting-title as works');
  {
    const S = pairs => JSON.stringify(pairs.map(([c, v]) => ({ c, v })));
    const val = expr => { try { return $(expr); } catch (e) { return 'ERR ' + e.message; } };
    const eq = (name, expr, want) => { const got = val(expr); check(name, JSON.stringify(got) === JSON.stringify(want), got); };
    // Heading form: «Author: Title. Parts (qualifiers)»
    eq('work: person + title', 'workD(' + S([['a', 'Dante Alighieri'], ['d', '1265-1321'], ['t', 'De vulgari eloquentia'], ['0', '(DE-588)4288905-4'], ['2', 'gnd']]) + ", 'person')",
      'Dante Alighieri (1265-1321): De vulgari eloquentia');
    eq('work: GND form of the name ($c)', 'workD(' + S([['a', 'Dante'], ['c', 'Alighieri'], ['d', '1265-1321'], ['t', 'De monarchia']]) + ", 'person')",
      'Dante Alighieri (1265-1321): De monarchia');
    eq('work: body + title + date', 'workD(' + S([['a', 'Katholische Kirche'], ['t', 'Codex Iuris Canonici'], ['f', '1983'], ['0', '(DE-588)4131491-8']]) + ", 'corporate')",
      'Katholische Kirche: Codex Iuris Canonici (1983)');
    eq('work: body + building', 'workD(' + S([['a', 'Studio KO (Studio di architettura)'], ['t', 'Yves Saint Laurent Museum (Marrakech)'], ['2', 'sbt12']]) + ", 'corporate')",
      'Studio KO (Studio di architettura): Yves Saint Laurent Museum (Marrakech)');
    eq('work: parts $p $n after the title', 'workD(' + S([['a', 'Catholic Church'], ['t', 'Missal (Ambrosian)'], ['p', 'Orations'], ['n', '2']]) + ", 'corporate')",
      'Catholic Church: Missal (Ambrosian). Orations. 2');
    eq('work: language and version in parentheses', 'workD(' + S([['a', 'Jean Paul'], ['b', 'II'], ['c', 'pape'], ['d', '1920-2005'], ['t', 'Ecclesia de Eucharistia.'], ['l', 'Français']]) + ", 'person')",
      'Jean Paul II pape (1920-2005): Ecclesia de Eucharistia (Français)');
    eq('work: meeting + title', 'workD(' + S([['a', 'Concile de Vatican 2'], ['d', '1962-1965'], ['t', 'Sacrosanctum Concilium']]) + ", 'meeting')",
      'Concile de Vatican 2 (1962-1965): Sacrosanctum Concilium');
    eq('work: subject subdivisions are not part of the title', 'workD(' + S([['a', 'Carroll, Lewis'], ['t', "Alice's adventures in Wonderland"], ['x', 'Illustrazioni'], ['2', 'sbt12']]) + ", 'person')",
      "Carroll, Lewis: Alice's adventures in Wonderland");
    // Chips of an SBT string: the title, then the author
    // (not repeated in the title chip), then the subdivisions. The title
    // chip keeps the full heading as the term it is reconciled with.
    eq('work: SBT chips — title, author, subdivisions',
      'nameC(' + S([['a', 'Carroll, Lewis'], ['t', "Alice's adventures in Wonderland"], ['x', 'Illustrazioni'], ['x', 'Cataloghi di esposizioni'], ['2', 'sbt12']]) + ", 'work', 'person').map(c => c.type + ':' + c.t)",
      ["a:Alice's adventures in Wonderland", 'author:Carroll, Lewis', 'x:Illustrazioni', 'x:Cataloghi di esposizioni']);
    eq('work: the title chip is reconciled with the full heading',
      'nameC(' + S([['a', 'Carroll, Lewis'], ['t', "Alice's adventures in Wonderland"], ['2', 'sbt12']]) + ", 'work', 'person')[0].term",
      "Carroll, Lewis: Alice's adventures in Wonderland");
    eq('work: the author chip of a body is a body',
      'nameC(' + S([['a', 'Studio KO (Studio di architettura)'], ['t', 'Yves Saint Laurent Museum (Marrakech)'], ['2', 'sbt12']]) + ", 'work', 'corporate').map(c => c.type + ':' + (c.kind || '') + ':' + c.t)",
      ['a::Yves Saint Laurent Museum (Marrakech)', 'author:corporate:Studio KO (Studio di architettura)']);
    // the per-string AND leaves the author out: the work already names it
    {
      const comps = [{ t: "Alice's adventures in Wonderland", type: 'a', term: "Carroll, Lewis: Alice's adventures in Wonderland" }, { t: 'Carroll, Lewis', type: 'author', kind: 'person' }, { t: 'Illustrazioni', type: 'x' }];
      const cr = [{ controlledLabels: { it: "Carroll, Lewis: Alice's adventures in Wonderland" } }, { controlledLabels: { it: 'Carroll, Lewis' } }, { controlledLabels: { it: 'Illustrazioni' } }];
      const got = val('componentAndSearch(' + JSON.stringify(comps) + ', ' + JSON.stringify(cr) + ')');
      check('work: per-string AND = the work + the subdivisions, not the author', got && got.label === "AND: Alice's adventures in Wonderland + Illustrazioni", got);
    }
    // extractAll: 600/610 with $t → kind 'work'; 7XX with $t → not shown
    const F = (tag, pairs) => ({ tag, ind: '  ', subs: pairs.map(([c, v]) => ({ c, v })) });
    const rec = JSON.stringify([
      F('600', [['a', 'Dante Alighieri'], ['d', '1265-1321'], ['t', 'De vulgari eloquentia'], ['0', '(DE-588)4288905-4'], ['2', 'gnd']]),
      F('600', [['a', 'Carroll, Lewis'], ['t', "Alice's adventures in Wonderland"], ['x', 'Illustrazioni'], ['2', 'sbt12']]),
      F('610', [['a', 'Schweiz'], ['t', 'Obligationenrecht'], ['0', '(DE-588)4121637-4'], ['2', 'gnd']]),
      F('600', [['a', 'Dante Alighieri'], ['d', '1265-1321'], ['0', '(DE-588)118523708'], ['2', 'gnd']]),
      F('700', [['a', 'Dante Alighieri'], ['d', '1265-1321'], ['t', "<<L'>>eloquenza volgare"]]),
      F('700', [['a', 'Stamm, Peter'], ['d', '1963-'], ['t', '<<Die>> sanfte Gleichgültigkeit der Welt'], ['0', '(DE-588)1155942388']]),
      F('700', [['a', 'Cottier, Georges'], ['d', '1922-2016'], ['0', '(DE-588)120314932']])
    ]);
    r = val('extractAll(' + rec + ')');
    const g = (r.gnd || []).map(x => x.kind + '|' + x.term + '|' + x.gndId);
    check('extractAll: a work keeps its title apart (combined-search label)',
      (r.gnd || []).some(x => x.kind === 'work' && x.workTitle === 'De vulgari eloquentia'), (r.gnd || []).map(x => x.workTitle));
    check('extractAll: 600 GND with $t is a work, with the work id',
      g.includes('work|Dante Alighieri (1265-1321): De vulgari eloquentia|4288905-4'), g);
    check('extractAll: 610 GND with $t is a work', g.includes('work|Schweiz: Obligationenrecht|4121637-4'), g);
    check('extractAll: 600 GND without $t stays a person', g.includes('person|Dante Alighieri (1265-1321)|118523708'), g);
    const sb = (r.sbt || [])[0] || {};
    check('extractAll: 600 SBT with $t is a work, with its subdivisions shown',
      sb.kind === 'work' && sb.workOf === 'person' && sb.display === "Carroll, Lewis: Alice's adventures in Wonderland — Illustrazioni", sb);
    check('extractAll: 700 with $t not shown, 700 without $t kept',
      JSON.stringify((r.names || []).map(n => n.name)) === JSON.stringify(['Cottier, Georges (1922-2016)']), (r.names || []).map(n => n.name));
  }
  // A work without an identifier is searched on Wikidata
  // by its TITLE, and an item is kept only if its author (P50, P170, P84,
  // P86) matches the author of the heading — a hypothesis, never confirmed
  // by text alone.
  {
    const realFetch = W.fetch;
    const asked = [];
    const lbl = (en) => ({ en: { language: 'en', value: en } });
    const ENT = {
      Q901: { id: 'Q901', labels: lbl("Alice's Adventures in Wonderland"), claims: { P57: [{ mainsnak: { datavalue: { value: { id: 'Q999' } } } }] } },   // the film (director)
      Q902: { id: 'Q902', labels: lbl("Alice's Adventures in Wonderland"), claims: { P50: [{ mainsnak: { datavalue: { value: { id: 'Q38082' } } } }] } }, // the book
      Q38082: { id: 'Q38082', labels: { en: { value: 'Lewis Carroll' }, it: { value: 'Lewis Carroll' } }, claims: {} },
      Q999: { id: 'Q999', labels: lbl('Clyde Geronimi'), claims: {} }
    };
    W.fetch = async (url, o) => {
      const u = String(url);
      asked.push(u);
      if (u.includes('action=wbsearchentities')) {
        const s = decodeURIComponent((u.match(/search=([^&]*)/) || [])[1] || '');
        const ids = /alice/i.test(s) ? ['Q901', 'Q902'] : [];
        const p = { search: ids.map(id => ({ id })) };
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(p), json: async () => p };
      }
      if (u.includes('action=wbgetentities')) {
        const ids = decodeURIComponent((u.match(/ids=([^&]*)/) || [])[1] || '').split('|');
        const p = { entities: Object.fromEntries(ids.filter(i => ENT[i]).map(i => [i, ENT[i]])) };
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(p), json: async () => p };
      }
      return realFetch(url, o);
    };
    r = await $w("reconcile('Carroll, Lewis: Alice\\'s adventures in Wonderland', null, null, 'sbt', 'work')");
    const searches = asked.filter(u => u.includes('wbsearchentities')).map(u => decodeURIComponent((u.match(/search=([^&]*)/) || [])[1] || ''));
    check('work without id: Wikidata searched by the title only', JSON.stringify(searches) === JSON.stringify(["Alice's adventures in Wonderland"]), searches);
    check('work without id: the item whose author matches (the book, not the film)', r && r.qid === 'Q902', r && r.qid);
    check('work without id: a hypothesis, not a confirmation', r && r.wdMatch === 'unverified', r && r.wdMatch);
    // The controlled label of a work is its
    // TITLE — the author is a chip of its own; «Author: Title» in the label
    // put the author in every search of the work.
    check('work: controlled label = the title only', r && r.controlledLabels && r.controlledLabels.it === "Alice's adventures in Wonderland", r && r.controlledLabels);
    asked.length = 0;
    r = await $w("reconcile('Rossi, Mario: Alice\\'s adventures in Wonderland', null, null, 'sbt', 'work')");
    check('work without id: wrong author → no item', r && !r.qid, r && r.qid);
    asked.length = 0;
    r = await $w("reconcile('Storia urbana (Periodico)', null, null, 'sbt', 'work')");
    check('work without an author part (630): no Wikidata text search', r && !r.qid && !asked.some(u => u.includes('wbsearchentities')), asked);
    W.fetch = realFetch;
  }
  // A work found by its title is CONFIRMED when its author
  // is the item a person of the record reaches through a GND or IdRef id.
  {
    const work = () => ({ label: "Carroll, Lewis: Alice's adventures in Wonderland", termType: 'work', vocabSource: 'sbt', qid: 'Q902', wdMatch: 'unverified',
      entity: { claims: { P50: [{ mainsnak: { datavalue: { value: { id: 'Q38082' } } } }] } } });
    const person = (o) => Object.assign({ label: 'Carroll, Lewis (1832-1898)', termType: 'person', vocabSource: 'gnd', gndId: '118519506', qid: 'Q38082', route: [] }, o);
    let w = work();
    let c;
    try { C.__r = [w, person()]; c = $('confirmWorkByAuthor(__r)'); } catch (e) { c = 'ERR ' + e.message; }
    check('work confirmed through its author with a GND id', Array.isArray(c) && c.length === 1 && w.wdMatch === 'record'
      && w.wdConfirmedBy && w.wdConfirmedBy.author === true && w.wdConfirmedBy.id === '118519506', { c, w });
    w = work();
    try { C.__r = [w, person({ gndId: null })]; c = $('confirmWorkByAuthor(__r)'); } catch (e) { c = 'ERR ' + e.message; }
    check('no confirmation by an author without id', Array.isArray(c) && c.length === 0 && w.wdMatch === 'unverified', c);
    w = work();
    try { C.__r = [w, person({ wdMatch: 'unverified' })]; c = $('confirmWorkByAuthor(__r)'); } catch (e) { c = 'ERR ' + e.message; }
    check('no confirmation by an author whose own item is a hypothesis', Array.isArray(c) && c.length === 0 && w.wdMatch === 'unverified', c);
    w = work();
    try { C.__r = [w, person({ qid: 'Q1' })]; c = $('confirmWorkByAuthor(__r)'); } catch (e) { c = 'ERR ' + e.message; }
    check('no confirmation by another person', Array.isArray(c) && c.length === 0, c);
  }

  section('one card per authority id');
  {
    const F = (tag, pairs) => ({ tag, ind: '1 ', subs: pairs.map(([c, v]) => ({ c, v })) });
    // the encyclical (alma991113960319705501): «II.» and «II» — before $b was
    // read both were «Johannes Paul Papst» and merged; they must stay one card
    const rec = JSON.stringify([
      F('700', [['a', 'Johannes Paul'], ['b', 'II.'], ['c', 'Papst'], ['d', '1920-2005'], ['0', '(DE-588)118558064']]),
      F('700', [['a', 'Johannes Paul'], ['b', 'II'], ['c', 'Papst'], ['d', '1920-2005'], ['0', '(DE-588)118558064']]),
      F('700', [['a', 'Cottier, Georges'], ['d', '1922-2016'], ['0', '(DE-588)120314932']])
    ]);
    let names;
    try { names = $('extractAll(' + rec + ').names'); } catch (e) { names = 'ERR ' + e.message; }
    const jp = Array.isArray(names) ? names.filter(n => n.gndId === '118558064') : [];
    check('same GND id, different wording: one card', jp.length === 1 && jp[0].variants.length === 2, names);
  }

  console.log('\n══════════════════════════');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nUNCAUGHT:', e); process.exit(1); });
