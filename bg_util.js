// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: shared utilities
// Constants, debug logging, LRU cache, small pure helpers shared by the
// service-worker modules. A few tiny helpers (cleanName, getClaim, rck)
// are intentionally duplicated between the worker and the content scripts:
// they are one-liners, and sharing them would require web-accessible module
// gymnastics that is not worth the coupling.
// ═══════════════════════════════════════════
'use strict';

// ── Debug flag ──
// Enable with chrome.storage.local.set({snDebug: true}). Silent by default.
let SN_DEBUG = false;
try {
  chrome.storage.local.get('snDebug', r => { if (r && r.snDebug) SN_DEBUG = true; });
} catch (e) { /* storage unavailable, keep default */ }
export function logDebug(...args) {
  if (SN_DEBUG) console.debug('[SN-bg]', ...args);
}

// ── Timing log (Chrome testing only) ──
// Records how long each step takes: network requests (bg_net.js), worker
// requests (background.js) and the record/panel marks sent by the content
// script. Kept only in chrome.storage.local ('snTiming', last 5,000
// events). Off in a release: the viewer used during testing is not part
// of the published extension.
export const TIMING_LOG = false;
const TIMING_KEY = 'snTiming';
const TIMING_MAX = 5000;
let timingBuf = [];
let timingTimer = null;
let timingChain = Promise.resolve();
export function timingEvent(ev) {
  if (!TIMING_LOG) return;
  timingBuf.push({ t: Date.now(), ...ev });
  if (!timingTimer) timingTimer = setTimeout(flushTiming, 500);
}
// Serialised read-append-write, so overlapping flushes never drop events.
function flushTiming() {
  timingTimer = null;
  const batch = timingBuf;
  timingBuf = [];
  timingChain = timingChain.then(async () => {
    const r = await chrome.storage.local.get(TIMING_KEY);
    const all = ((r && r[TIMING_KEY]) || []).concat(batch);
    await chrome.storage.local.set({ [TIMING_KEY]: all.slice(-TIMING_MAX) });
  }).catch(e => logDebug('timing flush', e));
}

// ── LRU cache ──
// In the worker the caches are shared across all tabs and records (reconciliation results are deterministic for a given input), so
// a size-bounded LRU replaces per-record clearing.
export class LRUMap {
  constructor(max) { this.max = max; this.map = new Map(); }
  has(k) { return this.map.has(k); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k);
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, v);
  }
  get size() { return this.map.size; }
  entries() { return this.map.entries(); }
  values() { return this.map.values(); }
  clear() { this.map.clear(); }
}

// ── Constants ──
export const LANGS = ['it', 'de', 'fr', 'en', 'es'];
export const VOCAB_LANG = { sbt: 'it', ns: 'it', gnd: 'de', idref: 'fr' };
export const WD_API = 'https://www.wikidata.org/w/api.php';
// Wikidata SPARQL. Wikimedia is moving query.wikidata.org
// (Blazegraph, overloaded) to QLever; the new endpoints are announced for
// November 2026. Until then, the public QLever endpoint of the University
// of Freiburg — same answers, measured faster — with query.wikidata.org
// as fallback.
// When the official endpoint opens, only these two lines change.
export const WD_SPARQL = 'https://qlever.dev/api/wikidata';
export const WD_SPARQL_FALLBACK = 'https://query.wikidata.org/sparql';
// Wikimedia User-Agent policy: a client running in the browser names itself
// in Api-User-Agent (the browser owns User-Agent): name/version (contact).
// The version is the manifest's, not written here a second time.
function manifestVersion() {
  try { return chrome.runtime.getManifest().version || '0'; } catch (e) { return '0'; }
}
export const API_USER_AGENT = 'SubjectNavigator/' + manifestVersion() + ' (https://github.com/MicheleStefani/subjectnavigator)';
export const WIKIMEDIA_HOSTS = new Set(['www.wikidata.org', 'query.wikidata.org']);
export const AAT_SPARQL = 'https://vocab.getty.edu/sparql';
export const NS_SPARQL = 'https://digitale.bncf.firenze.sbn.it/openrdf-sesame/repositories/NS';

// IdRef recordtype_z mapping (confirmed 25.03.2026)
export const IDREF_TYPES = {
  a: { desc: 'Persona', cat: 'name' },
  b: { desc: 'Ente', cat: 'name' },
  s: { desc: 'Congresso', cat: 'name' },
  c: { desc: 'Luogo', cat: 'place' },
  e: { desc: 'Famiglia', cat: 'name' },
  j: { desc: 'Soggetto RAMEAU', cat: 'subject' },
  u: { desc: 'Forma RAMEAU', cat: 'subject' },
  v: { desc: 'Genere RAMEAU', cat: 'subject' },
  // RAMEAU chronological descriptors (XXe siècle, 1976-2000,
  // Renaissance, Moyen âge). Unlisted, they fell into "Altro" and skipped the
  // French-label route to the NS: IdRef «Renaissance» (the period) never
  // reached NS Rinascimento and the text search proposed the French party.
  x: { desc: 'Descrittore cronologico RAMEAU', cat: 'subject' },
  h: { desc: 'Autore-titolo', cat: 'title' },
  f: { desc: 'Serie', cat: 'title' },
};

// ── Cluster ID helpers — the three index formats of a cluster id:
// string, {id,c} and {id,c,d} ──
export function clId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;          // plain string
  if (typeof val === 'object' && val.id) return val.id;  // {id, c}
  if (Array.isArray(val)) return val[0];            // legacy array
  return null;
}
export function clConf(val) {
  if (!val || typeof val !== 'object') return 0;
  return val.c || 0;
}
export function clGrade(cl) {
  return cl?._g || 4;
}

// ── Own-key lookup ──
// The index tables are plain objects and some keys come from outside (a
// heading, an IdRef label or type, an id read on Wikidata). A key such as
// «constructor» or «__proto__» would find what every object inherits (a
// function, the prototype) instead of nothing; own() answers only for the
// table's own keys.
export function own(obj, key) {
  return obj != null && key != null && Object.hasOwn(obj, key) ? obj[key] : undefined;
}

// ── SPARQL safe literal (security: prevent injection) ──
export function sparqlLiteral(s) {
  if (!s) return '""';
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

// ── Small pure helpers (duplicated in cs_index.js, see header note) ──
export function rck(t, g, i, source, entityType) {
  return [(t || '').toLowerCase().trim(), g || '', i || '', source || '', entityType || ''].join('|');
}
export function cleanName(n) { return n.replace(/\s*\(.*?\)/g, '').replace(/,\s*$/, '').replace(/\s*:\s*/g, ' ').replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
export function invertName(n) { const c = cleanName(n); const p = c.split(/\s*,\s*/); return p.length >= 2 ? p.slice(1).join(' ') + ' ' + p[0] : c; }
export function getClaim(e, p) { const c = e?.claims?.[p]; return c?.length ? c[0].mainsnak?.datavalue?.value : null; }
// Every value of a property (deprecated ones left out).
export function getClaims(e, p) { return (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(v => v != null); }
