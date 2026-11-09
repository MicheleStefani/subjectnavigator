// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 1/8): site adapter
// Everything the panel knows about the catalogue it runs on — Primo VE on
// Alma (swisscovery, reperio, explore.lib.unige.ch) — lives in this file and
// in its worker counterpart, bg_site.js. The rest of the extension asks only
// the functions below; another catalogue would ship its own cs_site.js /
// bg_site.js with the same functions (and its own manifest hosts).
//
//   parsePageUrl(url)        → the page: record id, language, view …
//   isRecordPage(page)       → is it a record's detail page?
//   siteSearchContext(page)  → what a search link needs (host, view, scope)
//   marcRequestParams(page)  → the worker's 'fetchMarc' message parameters
//   buildSearchUrl(q, mode)  → a subject ('subject') or keyword ('broad') search
//   classFieldSearchUrl(ctx, field, value) → a search in one catalogue field
//   CLASS_SEARCH_FIELDS      → the catalogue fields holding BAAM and DDC numbers
//
// Loaded first (manifest: content_scripts.js), before cs_core.js: it has no
// load-time dependency, and cs_core.js takes its default search context.
// ═══════════════════════════════════════════
'use strict';

// Primo: the network-zone view, used until a record page sets the real one.
const DEFAULT_SEARCH_CTX = { host: 'swisscovery.ch', vid: '41SLSP_NETWORK:VU1_UNION', tab: '41SLSP_NETWORK', scope: 'DN_and_CI' };

// Primo record page: /discovery/fulldisplay?docid=alma<MMS id>&vid=<inst>:<view>&lang=…
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
  return { recordId: docId, docId, vid, instCode, mmsId: m ? m[1] : '', isFullDisplay: u.pathname.includes('/fulldisplay'), lang,
    host: u.hostname, tab: p.get('tab'), scope: p.get('search_scope') };
}

function isRecordPage(page) {
  return Boolean(page && page.isFullDisplay && page.docId);
}

// The tab and scope of the page win; otherwise the defaults of the view
// (network zone or institution).
function siteSearchContext(page) {
  const vid = page.vid || '';
  return {
    host: page.host,
    vid: vid || DEFAULT_SEARCH_CTX.vid,
    tab: page.tab || (vid.includes('NETWORK') ? '41SLSP_NETWORK' : page.instCode + '_MyInst_and_CI'),
    scope: page.scope || (vid.includes('NETWORK') ? 'DN_and_CI' : 'MyInst_and_CI')
  };
}

// MARC comes from Alma's SRU, asked by the worker (bg_site.js, marcSources).
function marcRequestParams(page) {
  return { docId: page.docId, mmsId: page.mmsId, vid: page.vid, instCode: page.instCode, pageHost: page.host };
}

// Primo search links on the catalogue the page belongs to (searchCtx, set
// for each record by cs_main.js): 'sub' = subject index, 'any' = keywords.
function buildSearchUrl(q, mode) {
  const idx = mode === 'broad' ? 'any' : 'sub';
  return 'https://' + searchCtx.host + '/discovery/search?query=' + idx + ',contains,' + encodeURIComponent(q) + '&tab=' + encodeURIComponent(searchCtx.tab) + '&search_scope=' + encodeURIComponent(searchCtx.scope) + '&vid=' + encodeURIComponent(searchCtx.vid);
}

// BAAM and DDC numbers are in local Primo fields of the catalogue:
// lds49 (BAAM local classification), lds56 (Dewey reduced, 23sdnb).
const CLASS_SEARCH_FIELDS = { baam: 'lds49', cdd: 'lds56' };
function classFieldSearchUrl(ctx, field, value) {
  return 'https://' + ctx.host + '/discovery/search?query=' + field + ',contains,'
    + encodeURIComponent(value)
    + '&tab=' + encodeURIComponent(ctx.tab) + '&search_scope=' + encodeURIComponent(ctx.scope) + '&vid=' + encodeURIComponent(ctx.vid) + '&mode=advanced';
}
