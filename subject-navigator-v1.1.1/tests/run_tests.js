// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — TEST SUITE v1.1.0
// Run with:  node tests/run_tests.js   (from the extension folder)
//
// Two sandboxes, three levels:
//  1. smoke test — the 7 content scripts load in a Node `vm` sandbox with
//     minimal chrome/DOM stubs; the 4 worker ES modules + entry are loaded
//     in a second sandbox (imports/exports stripped, concatenated in
//     dependency order — they are written in a strip-friendly style).
//     Any top-level breakage or dangling cross-module reference fails here.
//  2. unit tests — pure functions (UDC parsing, MARC formatting, URL
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
  v: 6, primary: 'ns', count: 3,
  concepts: {
    '100': { l: 'calcestruzzo', bt: ['200'], d: '620.136',
             cl: { gnd: { id: '4005184-2', c: 0 }, wd: { id: 'Q40089', c: 0 }, _g: 1 } },
    '200': { l: 'materiali da costruzione', nt: ['100'] },
    // LCSH-only cluster (no GND, no precomputed QID): exercises the
    // generalized WD backlink chain (P244) added in v1.1.1.
    '300': { l: 'paesaggio culturale', cl: { lcsh: { id: 'sh99005095', c: 0 }, _g: 3 } }
  },
  labels: { 'calcestruzzo': '100', 'materiali da costruzione': '200', 'paesaggio culturale': '300' },
  reverse: { gnd: { '4005184-2': '100' }, bnf: {}, lcsh: { 'sh99005095': '300' }, wd: { 'Q40089': '100' }, idref: {}, bne: {} }
};
const FIX_DE = { '4005184-2': 'Beton', '4056795-3': 'Baustoff' };
const FIX_HG = { '4005184-2': { bt: ['4056795-3'] } };
const PACKAGED = {
  'unified_index_core.json': FIX_INDEX,
  'labels_de.json': FIX_DE,
  'labels_fr.json': {},
  'labels_en_slim.json': { 'sh99005095': 'Cultural landscapes' },
  'labels_es_slim.json': {},
  'hierarchy_gnd.json': FIX_HG,
  'hierarchy_bnf.json': {}
};

// ── Stubs ────────────────────────────────────────────────────
function chromeStubBase() {
  return {
    runtime: {
      getURL: p => 'chrome-extension://test/' + p,
      sendMessage: () => {},
      onMessage: { addListener: () => {} },
      lastError: null
    },
    storage: { local: { get: (k, cb) => { if (cb) cb({}); return Promise.resolve({}); }, set: () => {} } },
    tabs: { sendMessage: async () => {}, onUpdated: { addListener: () => {} } },
    action: { onClicked: { addListener: () => {} } },
    scripting: { executeScript: async () => {} }
  };
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
  for (const f of ['cs_core.js', 'cs_index.js', 'cs_marc.js', 'cs_class.js', 'cs_reconcile.js', 'cs_render.js', 'cs_main.js']) {
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
    fetch: async (url) => {
      const u = String(url);
      if (u.startsWith('chrome-extension://test/')) {
        const data = PACKAGED[u.slice('chrome-extension://test/'.length)];
        if (data === undefined) return { ok: false, status: 404 };
        return { ok: true, json: async () => JSON.parse(JSON.stringify(data)) };
      }
      // Canned Wikidata SPARQL backlinks for the regression tests; every
      // other query gets an empty result set. Responses go through
      // fetchWithTimeout + readTextCapped, hence the headers/text shape.
      if (u.startsWith('https://query.wikidata.org/sparql')) {
        const CANNED = [
          ['P269', '"027249654"', 'Q39'],                 // "Suisse" → Switzerland
          ['P244', '"sh99005095"', 'Q1655072'],           // LCSH-only cluster
          ['P214', '"45191303"', 'Q1000001'],             // VIAF mined from IdRef (C1)
          ['P213', '"0000 0000 1658 3504"', 'Q1000002'],  // ISNI, spaced form (C1)
        ];
        const m = CANNED.find(([p, v]) => u.includes(p) && u.includes(encodeURIComponent(v)));
        const payload = { results: { bindings: m ? [{ i: { type: 'uri', value: 'http://www.wikidata.org/entity/' + m[2] } }] : [] } };
        return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(payload), json: async () => payload };
      }
      // Canned Wikidata API for the B1 gate test: the fuzzy text search
      // returns the WRONG person (Oskar Barnack) for "Oskar Bär".
      if (u.startsWith('https://www.wikidata.org/w/api.php')) {
        if (u.includes('wbsearchentities') && u.includes('Oskar')) {
          const payload = { search: [{ id: 'Q61109' }] };
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
      // Canned IdRef person record carrying co-references (C1): VIAF in 035
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
  for (const f of ['bg_util.js', 'bg_net.js', 'bg_index.js', 'bg_reconcile.js', 'background.js']) {
    vm.runInContext(stripModule(fs.readFileSync(path.join(ROOT, f), 'utf8')), ctx, { filename: f });
  }
  return ctx;
}

// ── 1. Smoke tests ───────────────────────────────────────────
section('smoke test: module loading');
let C, W;
try { C = makeContentContext(); check('7 content scripts load without errors', true); }
catch (e) { check('7 content scripts load without errors', false, e.message); }
try { W = makeWorkerContext(); check('5 worker modules load without errors', true); }
catch (e) { check('5 worker modules load without errors', false, e.message); }
if (!C || !W) { console.error('\nSmoke test failed, unit tests skipped.'); process.exit(1); }

const $ = expr => vm.runInContext(expr, C);
const $w = expr => vm.runInContext(expr, W);

(async () => {

  // ── 2. UDC number parsing (content) ────────────────────────
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
  check('namD with dates', $(`namD([{c:'a',v:'Botta, Mario,'},{c:'d',v:'1943-'}])`) === 'Botta, Mario, (1943-)');
  check('cleanName', $(`cleanName('Botta, Mario (1943- )')`) === 'Botta, Mario');
  check('invertName', $(`invertName('Botta, Mario')`) === 'Mario Botta');
  check('initials', $(`initials('Botta, Mario')`) === 'BM');
  check('exG', $(`exG([{c:'0',v:'(DE-588)118514768'}])`) === '118514768');
  check('exI', $(`exI([{c:'0',v:'(IDREF)027290905'}])`) === '027290905');

  // ── 4. Content-side security & URL building ────────────────
  section('content security & URLs');
  check('isAllowedOpenUrl https', $(`isAllowedOpenUrl('https://example.org/x')`) === true);
  check('isAllowedOpenUrl http', $(`isAllowedOpenUrl('http://example.org/x')`) === false);
  check('isAllowedOpenUrl javascript:', $(`isAllowedOpenUrl('javascript:alert(1)')`) === false);
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
  check('clId string (v5)', $w(`clId('4005184-2')`) === '4005184-2');
  check('clId object (v6)', $w(`clId({ id: 'x', c: 2 })`) === 'x');
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

  section('worker: IdRef→WD backlink (P269 regression, v1.1.1)');
  // A place heading carrying only an IdRef PPN must resolve its QID via the
  // P269 backlink instead of falling through to the text search (which
  // matched "Suisse" to the French commune Q22036 instead of Q39).
  r = await $w(`reconcile('Suisse', null, '027249654', 'idref', 'place')`);
  check('QID resolved via P269 backlink', r.qid === 'Q39', r.qid);
  check('route documents IdRef→WD', r.route.includes('IdRef→WD'), r.route);
  check('text fallback not reached', !r.route.includes('WD-text'), r.route);

  section('worker: LCSH→WD backlink for GND-less clusters (v1.1.1)');
  // An NS concept whose cluster has only an LCSH id (no GND, no stored QID)
  // must reach Wikidata via P244 instead of the text fallback.
  r = await $w(`reconcile('paesaggio culturale', null, null, 'sbt', 'topic')`);
  check('QID resolved via P244 backlink', r.qid === 'Q1655072', r.qid);
  check('route documents LCSH→WD', r.route.includes('LCSH→WD'), r.route);
  check('text fallback not reached', !r.route.includes('WD-text'), r.route);
  check('EN label from local slim file', r.controlledLabels.en === 'Cultural landscapes', r.controlledLabels);

  section('worker: B1 — text-fallback person gate (v1.1.1)');
  // The fuzzy WD text search returns "Oskar Barnack" for "Bär, Oskar": no
  // shared ID and a different family name → the candidate must be discarded
  // and recorded, with no wrong enrichment left in the result.
  r = await $w(`reconcile('Bär, Oskar', null, '200738925', 'idref', 'person')`);
  check('wrong homonym discarded (qid null)', r.qid === null, r.qid);
  check('entity dropped (no wrong enrichment)', r.entity === null);
  check('verdict conflict + candidate recorded', r.wdMatch === 'conflict' && r.wdDiscarded && r.wdDiscarded.qid === 'Q61109', r.wdDiscarded);
  check('route shows the discard', r.route.includes('WD-text✗'), r.route);

  section('worker: C1 — IdRef co-references (VIAF/ISNI backlinks)');
  r = await $w(`reconcile('Rossi, Mario', null, 'PPNVIAF1', 'idref', 'person')`);
  check('QID via VIAF mined from the IdRef record', r.qid === 'Q1000001', { qid: r.qid, route: r.route });
  check('route documents VIAF→WD', r.route.includes('VIAF→WD'), r.route);
  check('route lists the mined co-references', r.route.includes('coref:VIAF+ISNI'), r.route);
  check('not marked as text-found', r.wdMatch === null, r.wdMatch);
  r = await $w(`qidViaBacklinks({ isni: '0000000016583504' }, [])`);
  check('ISNI normalised to the spaced P213 form', r === 'Q1000002', r);

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

  // ── 8. Packaged data ────────────────────────────────────────
  section('packaged data');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  check('manifest version 1.1.1', manifest.version === '1.1.1');
  check('module service worker', manifest.background.type === 'module');
  check('no tabs/activeTab permission', !(manifest.permissions || []).some(p => p === 'tabs' || p === 'activeTab'), manifest.permissions);
  check('7 content scripts declared', manifest.content_scripts[0].js.length === 7);
  check('web_accessible_resources slimmed to CSS + vocab files', manifest.web_accessible_resources[0].resources.length === 4, manifest.web_accessible_resources[0].resources);
  const vocabCdu = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab_cdu.json'), 'utf8'));
  check('vocab_cdu._macros present', !!vocabCdu._macros && vocabCdu._macros.groups.length === 9);
  check('vocab_cdu._macros quadrilingual labels', vocabCdu._macros.groups.every(g => g.label.it && g.label.de && g.label.fr && g.label.en));

  console.log('\n══════════════════════════');
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nUNCAUGHT:', e); process.exit(1); });
