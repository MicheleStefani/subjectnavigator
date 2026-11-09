// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — BACKGROUND SERVICE WORKER (entry)
//
// Architecture: the unified index AND the whole reconciliation /
// hierarchy engine live here, in ES modules (manifest: "type": "module").
//
//   bg_util.js       shared constants, LRU cache, small helpers
//   bg_net.js        the only module that touches the network (whitelists)
//   bg_index.js      packaged-index loading + synchronous lookups
//   bg_reconcile.js  reconcile() + getHierarchy() engine
//
// Why: with the engine in the worker there is ONE parsed copy of the ~35 MB
// of index data shared by every tab (not one per tab), and the
// content script no longer needs any network bridge at all — the message
// surface shrinks to four typed requests with no URL-shaped input:
//
//   warmIndex               → starts/awaits index loading, returns status
//   prefetchQids {ids}      → Wikidata items of a record's ids, one query
//   prefetchHierarchies {terms} → the Navigate hierarchies of a record, prepared
//   reconcile {term, ids…}  → full reconciliation result for one term
//   hierarchy {qid, nsUri…} → BT/NT/RT nodes for one concept
//   fetchMarc {mmsId…}      → MARC fields via SRU
//   resource {name}         → a packaged vocabulary or the stylesheet, as text
//
// MV3 note: the worker is killed after ~30 s idle and module state is lost.
// ensureIndex() reloads lazily on the next message (~200-500 ms cold), and
// the content script sends warmIndex as soon as a record page opens so the
// reload overlaps with the MARC fetch.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, timingEvent } from './bg_util.js';
import { fetchMarcViaSRU } from './bg_net.js';
import { isTargetUrl, validMarcRequest } from './bg_site.js';
import { ensureIndex } from './bg_index.js';
import { reconcile, getHierarchy, prefetchQids, prefetchHierarchies } from './bg_reconcile.js';

const VOCAB_SOURCES = new Set(['sbt', 'gnd', 'idref']);
const ENTITY_TYPES = new Set(['topic', 'person', 'corporate', 'meeting', 'place', 'period', 'form', 'work']);
function validOptional(value, rx, max = 200) {
  return value == null || (typeof value === 'string' && value.length <= max && rx.test(value));
}
function validHierarchyParams(m) {
  return validOptional(m.qid, /^Q\d{1,12}$/)
    && validOptional(m.gndId, /^[0-9Xx-]+$/, 40)
    && validOptional(m.idrefId, /^[0-9Xx]+$/, 40)
    && validOptional(m.nsUri, /^(?:https?:\/\/purl\.org\/bncf\/tid\/\d+|https:\/\/www2\.sbt\.ti\.ch\/soggettario\/index\.jsp\?termine=\d+)$/, 200);
}

// Testing: time a worker request for the timing log (bg_util.js).
function timed(type, label, promise) {
  const t0 = Date.now();
  return promise.then(r => {
    timingEvent({ src: 'worker', type, what: label, ms: Date.now() - t0, outcome: r && r.error ? String(r.error).slice(0, 80) : 'ok' });
    return r;
  }, e => {
    timingEvent({ src: 'worker', type, what: label, ms: Date.now() - t0, outcome: (e && e.message || String(e)).slice(0, 80) });
    throw e;
  });
}
// The files the panel needs, served by the worker
// instead of being web-accessible (which let any catalog page detect the
// extension). Only these names, never a path.
const PANEL_RESOURCES = new Set(['sidebar.css', 'vocab_baam.json', 'vocab_cdd.json',
  'vocab_geo.json', 'vocab_relators.json', 'vocab_forms.json']);

// Marks the content script may send (record opened, panel visible, …).
const TIMING_MARKS = new Set(['record-start', 'panel-visible', 'subjects-ready', 'record-end', 'navigate']);

// ── Message router ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return false;
  if (sender?.tab?.url && !isTargetUrl(sender.tab.url)) {
    sendResponse({ error: 'message sender not allowed' });
    return false;
  }
  if (msg.type === 'timing') {
    const ev = msg.ev;
    if (ev && typeof ev === 'object' && TIMING_MARKS.has(ev.mark)) {
      const num = v => (Number.isFinite(v) ? Math.round(v) : undefined);
      timingEvent({ src: 'page', mark: ev.mark, rec: String(ev.rec || '').slice(0, 40),
        what: String(ev.what || '').slice(0, 120), ms: num(ev.ms), outcome: String(ev.outcome || '').slice(0, 40),
        subjects: num(ev.subjects), names: num(ev.names), forms: num(ev.forms) });
    }
    return false;
  }
  if (msg.type === 'resource') {
    if (!PANEL_RESOURCES.has(msg.name)) { sendResponse({ error: 'unknown resource' }); return true; }
    fetch(chrome.runtime.getURL(msg.name))
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(text => sendResponse({ data: text }))
      .catch(e => {
        logDebug('resource error', msg.name, e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  if (msg.type === 'warmIndex') {
    timed('warmIndex', '', ensureIndex())
      .then(st => sendResponse({ data: st }))
      .catch(e => {
        logDebug('warmIndex error', e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  // The GND/IdRef ids of the record just opened, asked to
  // Wikidata in one query; the headings' reconciliation then reuses the answers.
  if (msg.type === 'prefetchQids') {
    const ids = Array.isArray(msg.ids) ? msg.ids.slice(0, 200) : [];
    if (!ids.every(x => x && typeof x === 'object'
        && validOptional(x.gnd, /^[0-9Xx-]+$/, 40) && validOptional(x.idref, /^[0-9Xx]+$/, 40))) {
      sendResponse({ error: 'invalid ids' }); return true;
    }
    timed('prefetchQids', ids.length + ' ids', (async () => {
      await ensureIndex();
      return { data: await prefetchQids(ids) };
    })()).then(sendResponse).catch(e => {
      logDebug('prefetchQids error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  // Every Navigate term of the record, prepared when the
  // subjects are ready (one Wikidata and one Getty query for all of them).
  if (msg.type === 'prefetchHierarchies') {
    const terms = Array.isArray(msg.terms) ? msg.terms.slice(0, 40) : [];
    if (!terms.every(t => t && typeof t === 'object' && validHierarchyParams(t))) {
      sendResponse({ error: 'invalid terms' }); return true;
    }
    timed('prefetchHierarchies', terms.length + ' terms', (async () => {
      await ensureIndex();
      return { data: await prefetchHierarchies(terms) };
    })()).then(sendResponse).catch(e => {
      logDebug('prefetchHierarchies error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'reconcile') {
    // Sanity caps on the only free-text input crossing the message boundary.
    const term = String(msg.term || '').slice(0, 400);
    if (!term) { sendResponse({ error: 'empty term' }); return true; }
    if (!validOptional(msg.gndId, /^[0-9Xx-]+$/, 40)
        || !validOptional(msg.idrefId, /^[0-9Xx]+$/, 40)
        || (msg.vocabSource != null && !VOCAB_SOURCES.has(msg.vocabSource))
        || (msg.termType != null && !ENTITY_TYPES.has(msg.termType))) {
      sendResponse({ error: 'invalid reconciliation parameters' }); return true;
    }
    timed('reconcile', [msg.vocabSource, term, msg.gndId || msg.idrefId].filter(Boolean).join(' '), (async () => {
      await ensureIndex();
      const data = await reconcile(term, msg.gndId || null, msg.idrefId || null,
        msg.vocabSource || null, msg.termType || null);
      return { data };
    })()).then(sendResponse).catch(e => {
      logDebug('reconcile error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'hierarchy') {
    if (!validHierarchyParams(msg)) {
      sendResponse({ error: 'invalid hierarchy parameters' }); return true;
    }
    timed('hierarchy', [msg.nsUri, msg.qid, msg.gndId || msg.idrefId].filter(Boolean).join(' '), (async () => {
      await ensureIndex();
      const data = await getHierarchy(msg.qid || null, msg.nsUri || null,
        msg.gndId || null, msg.idrefId || null);
      return { data };
    })()).then(sendResponse).catch(e => {
      logDebug('hierarchy error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'fetchMarc') {
    const { mmsId, instCode, pageHost } = msg;
    if (!validMarcRequest(msg)) {
      sendResponse({ error: 'invalid MARC request parameters' }); return true;
    }
    timed('fetchMarc', mmsId, (async () => {
      if (mmsId) {
        const r = await fetchMarcViaSRU(mmsId, instCode, pageHost);
        if (r) return r;
      }
      return { error: 'Could not fetch MARC data' };
    })()).then(sendResponse).catch(e => {
      logDebug('fetchMarc error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }
});

// ── Content script lifecycle ──
// Content scripts are declared statically in the manifest: Chrome injects
// them exactly once per document. Programmatic injection remains ONLY as a
// fallback for tabs opened before install/update (static scripts are not
// retro-injected).
const CONTENT_FILES = [
  'cs_site.js', 'cs_core.js', 'cs_index.js', 'cs_marc.js', 'cs_class.js',
  'cs_reconcile.js', 'cs_render.js', 'cs_main.js'
];

// isTargetUrl (which tabs are the catalogue's): in bg_site.js.

chrome.action.onClicked.addListener(tab => {
  if (!tab.id || !isTargetUrl(tab.url)) return;
  chrome.tabs.sendMessage(tab.id, { type: 'toggleSidebar' }).catch(async () => {
    // No receiver: tab predates the install. One-shot injection; if the
    // scripts were already there this branch is never reached (the
    // sendMessage above would have succeeded).
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      chrome.tabs.sendMessage(tab.id, { type: 'toggleSidebar' }).catch(() => {});
    } catch (e) { logDebug('inject fallback', e); }
  });
});

// Forward URL changes to the content script: tabs.onUpdated also fires on
// the Primo SPA's history.pushState transitions (changeInfo.url), which is
// so no polling is needed. Without the "tabs" permission
// tab.url is still populated for hosts granted in host_permissions.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!isTargetUrl(tab.url)) return;
  if (info.url || info.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { type: 'checkUrl' }).catch(() => {});
  }
});
