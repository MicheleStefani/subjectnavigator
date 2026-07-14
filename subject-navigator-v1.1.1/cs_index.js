// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 2/7): index status, cache mirrors, URL/name helpers — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';

// ═══════════════════════════════════════════
// INDEX STATUS + WORKER WARM-UP
// Since v1.1.0 the unified index lives in the background service worker
// (one parsed copy shared by every tab — see bg_index.js). The content
// script keeps only the status flag that drives the "NS" indicator in the
// header, per-record mirrors of the worker caches, and small pure helpers.
// ═══════════════════════════════════════════
let nsIndexStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let _warmPromise = null;

// Ask the worker to (re)load the index. Idempotent per page; the wait loop
// in cs_main.js polls nsIndexStatus exactly as in v1.0.x.
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
function rck(t, g, i) { return (t || '').toLowerCase().trim() + '|' + (g || '') + '|' + (i || ''); }

// Get the current interface language code (2-letter)
function getInterfaceLang() {
  const pp = new URLSearchParams(window.location.search);
  return pp.get('lang')?.substring(0, 2) || 'it';
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function cleanName(n) { return n.replace(/\s*\(.*?\)/g, '').replace(/,\s*$/, '').replace(/\s*:\s*/g, ' ').replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function invertName(n) { const c = cleanName(n); const p = c.split(/\s*,\s*/); return p.length >= 2 ? p.slice(1).join(' ') + ' ' + p[0] : c; }
function initials(n) { const c = cleanName(n).replace(/,/g, ''); const w = c.split(/\s+/).filter(x => x.length > 1); return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : c.substring(0, 2).toUpperCase(); }
function getClaim(e, p) { const c = e?.claims?.[p]; return c?.length ? c[0].mainsnak?.datavalue?.value : null; }
function getLabel(e, l) { return e?.labels?.[l]?.value || null; }
function getDesc(e, l) { return e?.descriptions?.[l]?.value || null; }
function getPrefLabel(cl, e, l) { if (cl && cl[l]) return cl[l]; return e ? getLabel(e, l) : null; }
function parsePageUrl(url) {
  const u = new URL(url || window.location.href);
  const p = u.searchParams;
  const docId = p.get('docid') || p.get('docId') || '';
  const vid = p.get('vid') || '';
  // Security: whitelist language against the set we actually support,
  // so that a malformed ?lang=… query string cannot leak into DOM attributes
  // or into data-* keys downstream. Falls back to Italian (primary audience).
  const rawLang = (p.get('lang') || 'it').substring(0, 5).toLowerCase();
  const lang = ['it', 'de', 'fr', 'en', 'es'].includes(rawLang.substring(0, 2))
    ? rawLang.substring(0, 2) : 'it';
  const m = docId.match(/alma(\d+)/);
  const rawInstCode = vid.split(':')[0] || '';
  const instCode = /^[\w-]{1,50}$/.test(rawInstCode) ? rawInstCode : '';
  return { docId, vid, instCode, mmsId: m ? m[1] : '', isFullDisplay: u.pathname.includes('/fulldisplay'), lang };
}
