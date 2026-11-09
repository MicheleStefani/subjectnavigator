// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 3/8): index status, cache mirrors, URL/name helpers
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';

// ═══════════════════════════════════════════
// INDEX STATUS + WORKER WARM-UP
// The unified index lives in the background service worker
// (one parsed copy shared by every tab — see bg_index.js). The content
// script keeps only the status flag that drives the "NS" indicator in the
// header, per-record mirrors of the worker caches, and small pure helpers.
// ═══════════════════════════════════════════
let nsIndexStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let _warmPromise = null;

// Ask the worker to (re)load the index. Idempotent per page; the wait loop
// in cs_main.js polls nsIndexStatus.
function loadNSIndex() {
  if (!_warmPromise) {
    nsIndexStatus = 'loading';
    _warmPromise = bgMsg({ type: 'warmIndex' })
      .then(st => { nsIndexStatus = (st && st.status) || 'error'; return st; })
      .catch(() => { nsIndexStatus = 'error'; return { status: 'error' }; });
  }
  return _warmPromise;
}

// ═══════════════════════════════════════════
// RESULT MIRRORS (cleared per record in cs_main.js)
// RC mirrors reconciliation results (same keying as the worker cache) so
// that rDynHier and recoverAuthIds can scan them synchronously; HC mirrors
// hierarchy node lists. The authoritative cross-tab LRU caches live in the
// worker (bg_index.js).
// ═══════════════════════════════════════════
const RC = new Map(), HC = new Map();
function rck(t, g, i, source, entityType) {
  return [(t || '').toLowerCase().trim(), g || '', i || '', source || '', entityType || ''].join('|');
}

// Get the current interface language code (2-letter)
// The same rule as parsePageUrl — only a supported
// language, otherwise Italian.
function getInterfaceLang() {
  const pp = new URLSearchParams(window.location.search);
  const l = (pp.get('lang') || '').substring(0, 2).toLowerCase();
  return ['it', 'de', 'fr', 'en', 'es'].includes(l) ? l : 'it';
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function cleanName(n) { return n.replace(/\s*\(.*?\)/g, '').replace(/,\s*$/, '').replace(/\s*:\s*/g, ' ').replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function invertName(n) { const c = cleanName(n); const p = c.split(/\s*,\s*/); return p.length >= 2 ? p.slice(1).join(' ') + ' ' + p[0] : c; }
function initials(n) { const c = cleanName(n).replace(/,/g, ''); const w = c.split(/\s+/).filter(x => x.length > 1); return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : c.substring(0, 2).toUpperCase(); }
function getClaim(e, p) { const c = e?.claims?.[p]; return c?.length ? c[0].mainsnak?.datavalue?.value : null; }
function getClaims(e, p) { return (e?.claims?.[p] || []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(v => v != null); }
function getLabel(e, l) { return e?.labels?.[l]?.value || null; }
function getDesc(e, l) { return e?.descriptions?.[l]?.value || null; }
function getPrefLabel(cl, e, l) { if (cl && cl[l]) return cl[l]; return e ? getLabel(e, l) : null; }
// parsePageUrl: in cs_site.js (site adapter).
