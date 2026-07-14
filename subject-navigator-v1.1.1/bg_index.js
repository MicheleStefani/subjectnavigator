// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: unified index — v1.1.0
// Loads the packaged index/label/hierarchy JSON files and answers the
// synchronous lookups used by bg_reconcile.js. There is exactly ONE parsed
// copy of these ~35 MB shared by every tab (in v1.0.x each tab parsed its
// own). MV3 kills the worker after ~30 s idle and this module state with
// it; ensureIndex() reloads lazily on the next message (~200-500 ms), and
// the content script sends 'warmIndex' as soon as a record page opens so
// the reload overlaps with the MARC fetch.
// No IndexedDB cache on purpose: a content script's IndexedDB belongs to
// the *page* origin (poisonable by the site), and structured-clone reads
// are not faster than JSON.parse of a local packaged file anyway.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, LRUMap, clId } from './bg_util.js';

// ── Shared LRU caches (also used by bg_reconcile.js) ──
// v1.0.x cleared per record; reconciliation is deterministic per input, so
// bounded cross-tab LRUs replace the clearing.
export const RC = new LRUMap(500);  // reconciliation results
export const HC = new LRUMap(200);  // hierarchy node lists
export const EC = new LRUMap(300);  // Wikidata entities

export let nsIndex = null; // { concepts: {tid: {..., cl:{...}}}, labels: {label_lower: tid}, reverse: {gnd:{}, bnf:{}, lcsh:{}, wd:{}} }
let nsIndexStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
export let langLabels = {}; // { de: {gnd_id: label}, fr: {bnf_id: label}, en: {lcsh_id: label} }
let langLabelsStatus = {}; // { de: 'unloaded'|'loading'|'ready', ... }
let frLabelReverse = null; // { label_lower: bnf_id } — built from labels_fr.json for IdRef→RAMEAU matching

// Pre-built hierarchy indexes: {id: {bt: [...ids], nt: [...ids]}}
// Loaded lazily after NS index ready; replace most Lobid/IdRef API calls for navigation.
let gndHierarchy = null;
let bnfHierarchy = null;
let gndHierarchyStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let bnfHierarchyStatus = 'unloaded';

// ── Loading ──
let indexPromise = null;

// Idempotent: first caller triggers the load, everyone else awaits it.
// Resolves with { status } once the core index settles (label/hierarchy
// files keep loading in the background; lookups fall back to HTTP until
// they are ready — same behaviour as v1.0.x).
export function ensureIndex() {
  if (!indexPromise) indexPromise = loadAll();
  return indexPromise;
}

export function getIndexStatus() { return nsIndexStatus; }

async function loadAll() {
  try {
    const resp = await fetch(chrome.runtime.getURL('unified_index_core.json'));
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    nsIndex = await resp.json();
    nsIndexStatus = 'ready';
  } catch (e) {
    logDebug('ensureIndex', e);
    nsIndexStatus = 'error';
  }
  loadLangLabels('de');
  loadLangLabels('fr');
  loadLangLabels('en');
  loadLangLabels('es');
  loadGndHierarchy();
  loadBnfHierarchy();
  return { status: nsIndexStatus };
}

async function loadLangLabels(lang) {
  if (langLabelsStatus[lang] === 'ready' || langLabelsStatus[lang] === 'loading') return;
  langLabelsStatus[lang] = 'loading';
  try {
    // EN and ES use slim files (only IDs present in NS clusters, ~17k vs
    // ~270k for LCSH). DE and FR use the full files: any GND/BnF ID may
    // appear in catalog MARC records.
    const isSlim = lang === 'en' || lang === 'es';
    const resp = await fetch(chrome.runtime.getURL('labels_' + lang + (isSlim ? '_slim' : '') + '.json'));
    if (resp.ok) langLabels[lang] = await resp.json();
    langLabelsStatus[lang] = 'ready';
    // French reverse label index (for IdRef→RAMEAU label matching)
    if (lang === 'fr' && langLabels.fr && !frLabelReverse) {
      frLabelReverse = {};
      for (const [bnfId, label] of Object.entries(langLabels.fr)) {
        frLabelReverse[label.toLowerCase()] = bnfId;
      }
    }
  } catch (e) {
    logDebug('loadLangLabels', lang, e);
    langLabelsStatus[lang] = 'error';
  }
}

async function loadGndHierarchy() {
  if (gndHierarchyStatus === 'ready' || gndHierarchyStatus === 'loading') return;
  gndHierarchyStatus = 'loading';
  try {
    const resp = await fetch(chrome.runtime.getURL('hierarchy_gnd.json'));
    if (resp.ok) gndHierarchy = await resp.json();
    gndHierarchyStatus = 'ready';
  } catch (e) {
    logDebug('loadGndHierarchy', e);
    gndHierarchyStatus = 'error';
  }
}

async function loadBnfHierarchy() {
  if (bnfHierarchyStatus === 'ready' || bnfHierarchyStatus === 'loading') return;
  bnfHierarchyStatus = 'loading';
  try {
    const resp = await fetch(chrome.runtime.getURL('hierarchy_bnf.json'));
    if (resp.ok) bnfHierarchy = await resp.json();
    bnfHierarchyStatus = 'ready';
  } catch (e) {
    logDebug('loadBnfHierarchy', e);
    bnfHierarchyStatus = 'error';
  }
}

// Hierarchy lookups — return {bt: [...ids], nt: [...ids]} or null
export function getGndBroaderNarrower(gndId) { return gndHierarchy?.[gndId] || null; }
export function getBnfBroaderNarrower(bnfId) { return bnfHierarchy?.[bnfId] || null; }

// Local label lookups from pre-loaded lang files
export function getAuthLabel(vocab, id) {
  if (vocab === 'gnd') return langLabels.de?.[id] || null;
  if (vocab === 'bnf') return langLabels.fr?.[id] || null;
  if (vocab === 'lcsh') return langLabels.en?.[id] || null;
  if (vocab === 'bne') return langLabels.es?.[id] || null;
  return null;
}

// Reverse lookup: find NS concept from a French label (IdRef→RAMEAU bridge)
export function nsLookupByFrLabel(frLabel) {
  if (!frLabelReverse || !nsIndex?.reverse?.bnf) return null;
  const bnfId = frLabelReverse[frLabel.toLowerCase()];
  if (!bnfId) return null;
  return nsLookupByBnf(bnfId);
}

// NS index lookups
export function nsLookup(label) {
  if (!nsIndex) return null;
  const tid = nsIndex.labels[label.toLowerCase().trim()];
  if (!tid) return null;
  const c = nsIndex.concepts[tid];
  if (!c) return null;
  return { tid, ...c };
}

export function nsGetConcept(tid) {
  if (!nsIndex || !nsIndex.concepts[tid]) return null;
  return { tid, ...nsIndex.concepts[tid] };
}

export function nsGetLabel(tid) {
  const c = nsIndex?.concepts?.[tid];
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
export function nsLookupByQid(qid) {
  if (!nsIndex?.reverse?.wd) return null;
  const tid = nsIndex.reverse.wd[qid];
  return tid ? nsGetConcept(tid) : null;
}

export function nsLookupByGnd(gndId) {
  if (!nsIndex?.reverse?.gnd) return null;
  const tid = nsIndex.reverse.gnd[gndId];
  return tid ? nsGetConcept(tid) : null;
}

export function nsLookupByBnf(bnfId) {
  if (!nsIndex?.reverse?.bnf) return null;
  const tid = nsIndex.reverse.bnf[bnfId];
  return tid ? nsGetConcept(tid) : null;
}

export function nsLookupByLcsh(lcshId) {
  if (!nsIndex?.reverse?.lcsh) return null;
  const tid = nsIndex.reverse.lcsh[lcshId];
  return tid ? nsGetConcept(tid) : null;
}

export function nsLookupByIdref(idrefId) {
  if (!nsIndex?.reverse?.idref) return null;
  const tid = nsIndex.reverse.idref[idrefId];
  return tid ? nsGetConcept(tid) : null;
}

// Get cluster data for a concept (pre-computed equivalences)
export function nsGetCluster(tid) {
  const c = nsIndex?.concepts?.[tid];
  return c?.cl || null;
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
