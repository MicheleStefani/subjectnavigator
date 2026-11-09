// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: unified index
// Loads the packaged index/label/hierarchy JSON files and answers the
// synchronous lookups used by bg_reconcile.js. There is exactly ONE parsed
// copy of these ~35 MB shared by every tab (not one per tab). MV3 kills the worker after ~30 s idle and this module state with
// it; ensureIndex() reloads lazily on the next message (~200-500 ms), and
// the content script sends 'warmIndex' as soon as a record page opens so
// the reload overlaps with the MARC fetch.
// No IndexedDB cache on purpose: a content script's IndexedDB belongs to
// the *page* origin (poisonable by the site), and structured-clone reads
// are not faster than JSON.parse of a local packaged file anyway.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, LRUMap, clId, timingEvent, own } from './bg_util.js';

// ── Shared LRU caches (also used by bg_reconcile.js) ──
// Reconciliation is deterministic per input, so bounded cross-tab LRUs
// keep results across records instead of clearing them per record.
export const RC = new LRUMap(500);  // reconciliation results
export const HC = new LRUMap(200);  // hierarchy node lists
export const EC = new LRUMap(300);  // Wikidata entities

export let nsIndex = null; // { concepts: {tid: {..., cl:{...}}}, labels: {label_lower: tid}, reverse: {gnd:{}, bnf:{}, lcsh:{}, wd:{}} }
let nsIndexStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
export let langLabels = {}; // { de: {gnd_id: label}, en: {lcsh_id: label}, es: {bne_id: label} }
let langLabelsStatus = {}; // { de: 'unloaded'|'loading'|'ready', ... }
const langLabelPromises = {};
let frLabelReverse = null; // { label_lower: [bnf_id] } — only headings the NS index uses (IdRef→RAMEAU matching)
// RAMEAU and IdRef as ONE table (rameau_idref.json, written by
// the generator): e = {ark: [label, ppn, bt, nt, rt]}, pc = {ppn: ark} for the
// PPNs several headings declare, pl = {ppn: IdRef's own wording}. Thesaurus
// terms only (+ the headings the NS index uses). Replaces labels_fr.json and
// hierarchy_bnf.json: one load gives the French label and the hierarchy from
// either id, with no comparison between the two systems at run time.
let rameau = null;
let rameauByPpn = null;

// Pre-built hierarchy indexes: {id: {bt: [...ids], nt: [...ids]}}
// Loaded lazily after NS index ready; replace most Lobid/IdRef API calls for navigation.
let gndHierarchy = null;
let gndHierarchyStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let gndHierarchyPromise = null;

// ── Loading ──
let indexPromise = null;

// Idempotent: first caller triggers the load, everyone else awaits it.
// Resolves with { status } once the compact core index settles. Language
// labels are awaited only when reconciliation needs them; each hierarchy is
// loaded only when the user opens navigation for that source.
export function ensureIndex() {
  if (!indexPromise) indexPromise = loadAll();
  return indexPromise;
}

async function loadAll() {
  const t0 = Date.now();
  try {
    const resp = await fetch(chrome.runtime.getURL('unified_index_core.json'));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    nsIndex = await resp.json();
    nsIndexStatus = 'ready';
  } catch (e) {
    logDebug('ensureIndex', e);
    nsIndexStatus = 'error';
  }
  // Cold load of the local index (worker started or restarted after idle).
  timingEvent({ src: 'worker', type: 'indexLoad', ms: Date.now() - t0, outcome: nsIndexStatus });
  loadLangLabels('de');
  loadLangLabels('fr');
  loadLangLabels('en');
  loadLangLabels('es');
  return { status: nsIndexStatus };
}

function loadLangLabels(lang) {
  if (langLabelsStatus[lang] === 'ready') return Promise.resolve();
  if (langLabelPromises[lang]) return langLabelPromises[lang];
  langLabelsStatus[lang] = 'loading';
  langLabelPromises[lang] = (async () => { try {
    // EN and ES use slim files (only IDs present in NS clusters, ~17k vs
    // ~270k for LCSH). DE and FR use the full files: any GND/BnF ID may
    // appear in catalog MARC records.
    const isSlim = lang === 'en' || lang === 'es';
    if (lang === 'fr') {
      const resp = await fetch(chrome.runtime.getURL('rameau_idref.json'));
      if (resp.ok) setRameauTable(await resp.json());
    } else {
      const resp = await fetch(chrome.runtime.getURL('labels_' + lang + (isSlim ? '_slim' : '') + '.json'));
      if (resp.ok) langLabels[lang] = await resp.json();
    }
    langLabelsStatus[lang] = 'ready';
  } catch (e) {
    logDebug('loadLangLabels', lang, e);
    langLabelsStatus[lang] = 'error';
  } })();
  return langLabelPromises[lang];
}

function setRameauTable(t) {
  rameau = t && t.e ? t : null;
  rameauByPpn = {};
  frLabelReverse = null;
  if (!rameau) return;
  for (const [ark, e] of Object.entries(rameau.e)) {
    if (e[1] && !(e[1] in rameauByPpn)) rameauByPpn[e[1]] = ark;
  }
  Object.assign(rameauByPpn, rameau.pc || {});
}

// RAMEAU/IdRef lookups (table loaded with the French labels)
export function rameauArkByPpn(ppn) { return (ppn && own(rameauByPpn, ppn)) || null; }
export function rameauPpn(ark) { return own(rameau?.e, ark)?.[1] || null; }

export function ensureLabels(langs = ['de', 'fr', 'en', 'es']) {
  return Promise.all(langs.map(loadLangLabels));
}

function loadGndHierarchy() {
  if (gndHierarchyStatus === 'ready') return Promise.resolve();
  if (gndHierarchyPromise) return gndHierarchyPromise;
  gndHierarchyStatus = 'loading';
  gndHierarchyPromise = (async () => { try {
    const resp = await fetch(chrome.runtime.getURL('hierarchy_gnd.json'));
    if (resp.ok) gndHierarchy = await resp.json();
    gndHierarchyStatus = 'ready';
  } catch (e) {
    logDebug('loadGndHierarchy', e);
    gndHierarchyStatus = 'error';
  } })();
  return gndHierarchyPromise;
}

// Notes of the GND and RAMEAU headings (GND definition,
// RAMEAU skos:note), each in a file of its own, loaded the first time a
// card needs one — not at start-up.
const authNotes = {}, authNotePromises = {};
function loadAuthNotes(vocab) {
  if (authNotePromises[vocab]) return authNotePromises[vocab];
  authNotePromises[vocab] = (async () => { try {
    const resp = await fetch(chrome.runtime.getURL('notes_' + vocab + '.json'));
    authNotes[vocab] = resp.ok ? await resp.json() : {};
  } catch (e) {
    logDebug('loadAuthNotes', vocab, e);
    authNotes[vocab] = {};
  } })();
  return authNotePromises[vocab];
}
export async function getAuthNote(vocab, id) {
  if (!id || (vocab !== 'gnd' && vocab !== 'rameau')) return null;
  await loadAuthNotes(vocab);
  return own(authNotes[vocab], id) || null;
}

// Exact links of GND and IdRef headings WITHOUT an NS concept
// (exact_links.json, written by the generator): the other vocabularies'
// headings declared exact — directly or through one Wikidata item both
// sources declare. Loaded the first time such a heading is reconciled.
let exactLinks = null, exactLinksPromise = null;
function loadExactLinks() {
  if (exactLinksPromise) return exactLinksPromise;
  exactLinksPromise = (async () => { try {
    const resp = await fetch(chrome.runtime.getURL('exact_links.json'));
    exactLinks = resp.ok ? await resp.json() : {};
  } catch (e) {
    logDebug('loadExactLinks', e);
    exactLinks = {};
  } })();
  return exactLinksPromise;
}
export async function getExactLinks(vocab, id) {
  if (!id || (vocab !== 'gnd' && vocab !== 'idref')) return null;
  await loadExactLinks();
  return own(exactLinks?.[vocab], id) || null;
}

// The RAMEAU hierarchy is part of the RAMEAU/IdRef table.
function loadBnfHierarchy() { return loadLangLabels('fr'); }

export function ensureHierarchy(source) {
  if (source === 'gnd') return loadGndHierarchy();
  if (source === 'bnf' || source === 'idref') return loadBnfHierarchy();
  return Promise.resolve();
}

// Hierarchy lookups — return {bt: [...ids], nt: [...ids]} or null
export function getGndBroaderNarrower(gndId) { return own(gndHierarchy, gndId) || null; }
export function getBnfBroaderNarrower(bnfId) {
  const e = own(rameau?.e, bnfId);
  if (!e || !(e[2].length || e[3].length || e[4].length)) return null;
  const h = {};
  if (e[2].length) h.bt = e[2];
  if (e[3].length) h.nt = e[3];
  if (e[4].length) h.rt = e[4];   // RAMEAU "voir aussi"
  return h;
}

// Local label lookups from pre-loaded lang files
export function getAuthLabel(vocab, id) {
  if (vocab === 'gnd') return own(langLabels.de, id) || null;
  if (vocab === 'bnf') return own(rameau?.e, id)?.[0] || null;
  if (vocab === 'lcsh') return own(langLabels.en, id) || null;
  if (vocab === 'bne') return own(langLabels.es, id) || null;
  return null;
}

// Reverse lookup: find NS concept from a French label (IdRef→RAMEAU bridge)
export function nsLookupByFrLabel(frLabel) {
  if (!rameau || !nsIndex?.reverse?.bnf) return null;
  if (!frLabelReverse) {
    // Only the headings the NS index uses can lead to a concept.
    frLabelReverse = {};
    for (const bnfId of Object.keys(nsIndex.reverse.bnf)) {
      const label = rameau.e[bnfId]?.[0];
      if (!label) continue;
      const key = label.toLowerCase();
      (own(frLabelReverse, key) || (frLabelReverse[key] = [])).push(bnfId);
    }
  }
  const bnfIds = own(frLabelReverse, String(frLabel || '').toLowerCase()) || [];
  const candidates = bnfIds.flatMap(id => nsLookupByAuthorityCandidates('bnf', id));
  const unique = [...new Map(candidates.map(c => [c.tid, c])).values()];
  return unique.length === 1 ? unique[0] : null;
}

// NS index lookups
function asTidList(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function conceptsForTids(value) {
  return asTidList(value).map(nsGetConcept).filter(Boolean);
}

export function nsLookupCandidates(label) {
  if (!nsIndex) return null;
  return conceptsForTids(own(nsIndex.labels, label.toLowerCase().trim()));
}

export function nsLookup(label, preferredSource = null) {
  const candidates = nsLookupCandidates(label) || [];
  if (!candidates.length) return null;
  if (preferredSource === 'sbt') return candidates.find(c => c.tid.startsWith('SBT_')) || candidates[0];
  return candidates.find(c => !c.tid.startsWith('SBT_')) || candidates[0];
}

export function nsGetConcept(tid) {
  const c = own(nsIndex?.concepts, tid);
  if (!c) return null;
  return { tid, ...c };
}

export function nsGetLabel(tid) {
  const c = own(nsIndex?.concepts, tid);
  return c?.l || null;
}

// Build a normalised nsData object from any NS-or-SBT concept returned by nsLookup/nsGetConcept.
// SBT concepts (tid starts with 'SBT_') get a different source URL and a 'sbt' src marker.
export function makeNsData(ns) {
  if (!ns) return null;
  const isSBT = ns.tid.startsWith('SBT_');
  if (isSBT) {
    const numId = ns.tid.slice(4); // 'SBT_4405' → '4405'
    return { id: ns.tid, label: ns.l, uri: 'https://www2.sbt.ti.ch/soggettario/index.jsp?termine=' + numId, src: 'sbt', scopeNote: null, ddc: null, definition: null };
  }
  return { id: ns.tid, label: ns.l, uri: 'http://purl.org/bncf/tid/' + ns.tid, src: null, scopeNote: ns.sn || null, ddc: ns.d || null, definition: ns.df || null };
}

// Reverse lookups: find NS concept by external ID (using unified reverse index)
export function nsLookupByAuthorityCandidates(authority, id) {
  const reverse = own(nsIndex?.reverse, authority);
  return reverse && id ? conceptsForTids(own(reverse, id)) : [];
}

export function nsLookupByQid(qid) {
  return nsLookupByAuthorityCandidates('wd', qid)[0] || null;
}

export function nsLookupByGnd(gndId) {
  return nsLookupByAuthorityCandidates('gnd', gndId)[0] || null;
}

export function nsLookupByBnf(bnfId) {
  return nsLookupByAuthorityCandidates('bnf', bnfId)[0] || null;
}

export function nsLookupByLcsh(lcshId) {
  return nsLookupByAuthorityCandidates('lcsh', lcshId)[0] || null;
}

export function nsLookupByIdref(idrefId) {
  return nsLookupByAuthorityCandidates('idref', idrefId)[0] || null;
}

// Resolve all labels for a cluster from pre-loaded lang files
export function resolveClusterLabels(cl) {
  const labels = {};
  if (!cl) return labels;
  const gndId = clId(cl.gnd);
  if (gndId) { const lbl = getAuthLabel('gnd', gndId); if (lbl) labels.de = lbl; }
  const bnfId = clId(cl.bnf);
  if (bnfId) { const lbl = getAuthLabel('bnf', bnfId); if (lbl) labels.fr = lbl; }
  const lcshId = clId(cl.lcsh);
  if (lcshId) { const lbl = getAuthLabel('lcsh', lcshId); if (lbl) labels.en = lbl; }
  const bneId = clId(cl.bne);
  if (bneId) { const lbl = getAuthLabel('bne', bneId); if (lbl) labels.es = lbl; }
  return labels;
}
