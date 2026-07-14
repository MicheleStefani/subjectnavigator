// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — BACKGROUND SERVICE WORKER (entry) — v1.1.0
//
// v1.1.0 architecture: the unified index AND the whole reconciliation /
// hierarchy engine live here, in ES modules (manifest: "type": "module").
//
//   bg_util.js       shared constants, LRU cache, small helpers
//   bg_net.js        the only module that touches the network (whitelists)
//   bg_index.js      packaged-index loading + synchronous lookups
//   bg_reconcile.js  reconcile() + getHierarchy() engine
//
// Why: with the engine in the worker there is ONE parsed copy of the ~35 MB
// of index data shared by every tab (v1.0.x parsed it per tab), and the
// content script no longer needs any network bridge at all — the message
// surface shrinks to four typed requests with no URL-shaped input:
//
//   warmIndex               → starts/awaits index loading, returns status
//   reconcile {term, ids…}  → full reconciliation result for one term
//   hierarchy {qid, nsUri…} → BT/NT/RT nodes for one concept
//   fetchMarc {mmsId…}      → MARC fields via SRU
//
// MV3 note: the worker is killed after ~30 s idle and module state is lost.
// ensureIndex() reloads lazily on the next message (~200-500 ms cold), and
// the content script sends warmIndex as soon as a record page opens so the
// reload overlaps with the MARC fetch.
// ═══════════════════════════════════════════
'use strict';

import { logDebug } from './bg_util.js';
import { fetchMarcViaSRU } from './bg_net.js';
import { ensureIndex } from './bg_index.js';
import { reconcile, getHierarchy } from './bg_reconcile.js';

// ── Message router ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'warmIndex') {
    ensureIndex()
      .then(st => sendResponse({ data: st }))
      .catch(e => {
        logDebug('warmIndex error', e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  if (msg.type === 'reconcile') {
    // Sanity caps on the only free-text input crossing the message boundary.
    const term = String(msg.term || '').slice(0, 400);
    if (!term) { sendResponse({ error: 'empty term' }); return true; }
    (async () => {
      await ensureIndex();
      const data = await reconcile(term, msg.gndId || null, msg.idrefId || null,
        msg.vocabSource || null, msg.termType || null);
      return { data };
    })().then(sendResponse).catch(e => {
      logDebug('reconcile error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'hierarchy') {
    (async () => {
      await ensureIndex();
      const data = await getHierarchy(msg.qid || null, msg.nsUri || null,
        msg.gndId || null, msg.idrefId || null);
      return { data };
    })().then(sendResponse).catch(e => {
      logDebug('hierarchy error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'fetchMarc') {
    const { mmsId, instCode, pageHost } = msg;
    (async () => {
      if (mmsId) {
        const r = await fetchMarcViaSRU(mmsId, instCode, pageHost);
        if (r) return r;
      }
      return { error: 'Could not fetch MARC data' };
    })().then(sendResponse).catch(e => {
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
  'cs_core.js', 'cs_index.js', 'cs_marc.js', 'cs_class.js',
  'cs_reconcile.js', 'cs_render.js', 'cs_main.js'
];

export function isTargetUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return h === 'reperio.usi.ch' || h === 'explore.lib.unige.ch'
      || h === 'swisscovery.ch' || h.endsWith('.swisscovery.ch')
      || h.endsWith('.swisscovery.slsp.ch')
      || h === 'swisscovery.org' || h.endsWith('.swisscovery.org');
  } catch (e) {
    return false;
  }
}

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
// what replaced the 800 ms polling of v1.0.0. Without the "tabs" permission
// tab.url is still populated for hosts granted in host_permissions.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!isTargetUrl(tab.url)) return;
  if (info.url || info.status === 'complete') {
    chrome.tabs.sendMessage(tabId, { type: 'checkUrl' }).catch(() => {});
  }
});
