// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: shared utilities — v1.1.0
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

// ── LRU cache ──
// The v1.0.x content script cleared its caches on every record change to
// bound memory. In the worker the caches are shared across all tabs and
// records (reconciliation results are deterministic for a given input), so
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
export const WD_SPARQL = 'https://query.wikidata.org/sparql';
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
  h: { desc: 'Autore-titolo', cat: 'title' },
  f: { desc: 'Serie', cat: 'title' },
};

// ── Cluster ID helpers — adapt v5 (string) and v6 ({id,c}) index formats ──
export function clId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;          // v5 format
  if (typeof val === 'object' && val.id) return val.id;  // v6 format {id, c}
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

// ── SPARQL safe literal (security: prevent injection) ──
export function sparqlLiteral(s) {
  if (!s) return '""';
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

// ── Small pure helpers (duplicated in cs_index.js, see header note) ──
export function rck(t, g, i) { return (t || '').toLowerCase().trim() + '|' + (g || '') + '|' + (i || ''); }
export function cleanName(n) { return n.replace(/\s*\(.*?\)/g, '').replace(/,\s*$/, '').replace(/\s*:\s*/g, ' ').replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
export function invertName(n) { const c = cleanName(n); const p = c.split(/\s*,\s*/); return p.length >= 2 ? p.slice(1).join(' ') + ' ' + p[0] : c; }
export function getClaim(e, p) { const c = e?.claims?.[p]; return c?.length ? c[0].mainsnak?.datavalue?.value : null; }
