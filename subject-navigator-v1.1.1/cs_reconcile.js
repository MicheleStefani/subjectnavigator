// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 5/7): worker bridge, URL builders — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';

// ═══════════════════════════════════════════
// WORKER BRIDGE
// Since v1.1.0 reconcile() and getHierarchy() run in the background
// service worker (bg_reconcile.js), which holds the single shared copy of
// the unified index. These wrappers keep the v1.0.x call signatures so the
// rendering code is untouched, and mirror results into the per-record
// RC/HC maps for the synchronous scans done by rDynHier/recoverAuthIds.
// ═══════════════════════════════════════════
async function reconcile(term, gndId, idrefId, vocabSource, termType) {
  const k = rck(term, gndId, idrefId);
  if (RC.has(k)) {
    const cached = RC.get(k);
    // If termType was not set before but is now provided, update it
    if (termType && !cached.termType) cached.termType = termType;
    return cached;
  }
  const result = await bgMsg({
    type: 'reconcile', term,
    gndId: gndId || null, idrefId: idrefId || null,
    vocabSource: vocabSource || null, termType: termType || null
  });
  RC.set(k, result);
  return result;
}

async function getHierarchy(qid, entity, nsUri, gndId, idrefId) {
  // `entity` stays in the signature for call-site compatibility; the
  // worker resolves the entity itself (EC-cached) from the QID.
  const k = (qid || '') + '|' + (nsUri || '') + '|' + (gndId || '') + '|' + (idrefId || '');
  if (HC.has(k)) return HC.get(k);
  let nodes = [];
  try {
    nodes = await bgMsg({
      type: 'hierarchy',
      qid: qid || null, nsUri: nsUri || null,
      gndId: gndId || null, idrefId: idrefId || null
    }) || [];
  } catch (e) { logDebug('getHierarchy bridge', e); }
  HC.set(k, nodes);
  return nodes;
}

// Recover the GND/IdRef IDs of a term from already-reconciled cache
// entries (same QID or same label). Replaces three hand-rolled copies of
// this loop (drill, nav-chip handler, auto-navigate) that re-parsed RC keys.
function recoverAuthIds(label, qid, gi, ii) {
  if (!gi || !ii) {
    for (const [k, v] of RC.entries()) {
      if ((qid && v.qid === qid) || (label && k.startsWith(label.toLowerCase().trim() + '|'))) {
        if (!gi) gi = v.gndId || (v.lobidData ? v.lobidData.gndIdentifier : null) || k.split('|')[1] || null;
        if (!ii) ii = v.idrefId || k.split('|')[2] || null;
        break;
      }
    }
  }
  return { gi: gi || null, ii: ii || null };
}

// reconcile() with a fallback: never throws, returns a minimal result on
// unexpected errors (including worker messaging failures). Used by paths
// that do not go through renderTermDetailSafe (SBT chips, subdivisions,
// auto-navigation).
async function safeReconcile(term, gndId, idrefId, vocabSource, termType) {
  try {
    return await reconcile(term, gndId, idrefId, vocabSource, termType);
  } catch (e) {
    logDebug('safeReconcile', term, e);
    return { qid: null, entity: null, route: [], nsData: null, dewey: null,
             controlledLabels: {}, label: term, termType: termType || null,
             gndId: gndId || null, idrefId: idrefId || null };
  }
}

// ═══════════════════════════════════════════
// URL BUILDERS
// ═══════════════════════════════════════════
function buildSearchUrl(q, mode) {
  const idx = mode === 'broad' ? 'any' : 'sub';
  return 'https://' + searchCtx.host + '/discovery/search?query=' + idx + ',contains,' + encodeURIComponent(q) + '&tab=' + encodeURIComponent(searchCtx.tab) + '&search_scope=' + encodeURIComponent(searchCtx.scope) + '&vid=' + encodeURIComponent(searchCtx.vid);
}
function buildCatUrl(e, nsL, cl, mode) {
  const labels = new Set();
  if (cl) Object.values(cl).forEach(l => { if (l) labels.add(l); });
  if (nsL) labels.add(nsL);
  if (e) LANGS.forEach(l => { if (!cl || !cl[l]) { const lb = getLabel(e, l); if (lb) labels.add(lb); } });
  if (!labels.size) return null;
  return buildSearchUrl([...labels].map(l => '"' + l + '"').join(' OR '), mode);
}
function buildCrossAndUrl(selectedTerms, mode) {
  const langGroups = {};
  LANGS.forEach(l => { langGroups[l] = []; });
  for (const t of selectedTerms) {
    const cl = t.mergedLabels || t.controlledLabels || {};
    const e = t.entity;
    LANGS.forEach(l => { const label = getPrefLabel(cl, e, l); if (label) langGroups[l].push('"' + label + '"'); });
  }
  const parts = [];
  Object.entries(langGroups).forEach(([l, terms]) => { if (terms.length >= 2) parts.push('(' + terms.join(' AND ') + ')'); });
  if (!parts.length) {
    const allLabels = selectedTerms.map(t => { const cl = t.mergedLabels || t.controlledLabels || {}; return cl.it || cl.de || cl.fr || cl.en || cl.es || t.nsData?.label || ''; }).filter(Boolean);
    if (allLabels.length >= 2) parts.push('(' + allLabels.map(l => '"' + l + '"').join(' AND ') + ')');
  }
  if (!parts.length) return null;
  return buildSearchUrl(parts.join(' OR '), mode);
}

// ═══════════════════════════════════════════
// MERGED LABELS (cross-vocab QID dedup)
// ═══════════════════════════════════════════
function mergeByQid(allResults) {
  const qidMap = new Map();
  for (const r of allResults) {
    if (!r.qid) continue;
    if (!qidMap.has(r.qid)) qidMap.set(r.qid, {});
    const merged = qidMap.get(r.qid);
    const cl = r.controlledLabels || {};
    for (const [lang, label] of Object.entries(cl)) {
      if (label && !merged[lang]) merged[lang] = label;
    }
  }
  for (const r of allResults) {
    if (r.qid && qidMap.has(r.qid)) r.mergedLabels = qidMap.get(r.qid);
  }
}
