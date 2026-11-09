// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 6/8): worker bridge, URL builders
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';

// ═══════════════════════════════════════════
// WORKER BRIDGE
// reconcile() and getHierarchy() run in the background
// service worker (bg_reconcile.js), which holds the single shared copy of
// the unified index. These wrappers mirror results into the per-record
// RC/HC maps for the synchronous scans done by rDynHier/recoverAuthIds.
// ═══════════════════════════════════════════
async function reconcile(term, gndId, idrefId, vocabSource, termType) {
  const k = rck(term, gndId, idrefId, vocabSource, termType);
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
// buildSearchUrl (the catalogue's search link): in cs_site.js.
// A double quote inside a label would end the Primo phrase early; URL
// encoding alone does not protect the query grammar.
function quotePhrase(l) { return '"' + String(l).replace(/"/g, ' ').replace(/\s+/g, ' ').trim() + '"'; }
function buildCatUrl(e, nsL, cl, mode) {
  const labels = new Set();
  if (cl) Object.values(cl).forEach(l => { if (l) labels.add(l); });
  if (nsL) labels.add(nsL);
  if (e) LANGS.forEach(l => { if (!cl || !cl[l]) { const lb = getLabel(e, l); if (lb) labels.add(lb); } });
  if (!labels.size) return null;
  return buildSearchUrl([...labels].map(quotePhrase).join(' OR '), mode);
}
function hasTrustedQid(r) { return Boolean(r.qid) && r.wdMatch !== 'unverified' && r.wdMatch !== 'conflict'; }
// A Wikidata item found by NAME is confirmed by the record when
// another heading of the same record reaches the very same item through an
// id (SBT «Europa» by name → Q46; GND «Europa» 4015701-5 → Q46). Conditions
//: same item; the other heading anchored by a GND or
// IdRef id with a trusted item; same kind (topic / place / name); the
// confirmation is stated on the card. Wording may differ (Europa / Europe).
// Rare false case: the name reaches the wrong item and that item is another
// heading of the same record (SBT «Mercurio», the god, → the planet, with GND
// «Merkur (Planet)» in the record).
function termKind(t) {
  const tt = t.termType || 'topic';
  return ['person', 'corporate', 'meeting'].includes(tt) ? 'name' : tt === 'place' ? 'place' : 'topic';
}
function confirmByRecord(results) {
  const confirmed = [];
  for (const r of results) {
    if (r.wdMatch !== 'unverified' || !r.qid || r.nsData) continue;
    const o = results.find(x => x !== r && x.qid === r.qid && (x.gndId || x.idrefId)
      && hasTrustedQid(x) && termKind(x) === termKind(r));
    if (!o) continue;
    r.wdMatch = 'record';
    r.wdConfirmedBy = { vocab: o.vocabSource === 'idref' ? 'IdRef' : 'GND', id: o.gndId || o.idrefId, label: o.label || '' };
    confirmed.push(r);
  }
  return confirmed;
}
// A work found by its TITLE (a hypothesis, see
// bestWorkCandidate in bg_reconcile.js) is confirmed when one of its authors
// (author, creator, architect, composer) is the very item a person, body or
// meeting of the record reaches through a GND or IdRef id — a confirmation
// through an id, not through text. Stated on the card («by its author»).
function confirmWorkByAuthor(results) {
  const confirmed = [];
  const named = results.filter(x => ['person', 'corporate', 'meeting'].includes(x.termType || '')
    && (x.gndId || x.idrefId) && hasTrustedQid(x));
  for (const r of results) {
    if (r.termType !== 'work' || r.wdMatch !== 'unverified' || !r.qid || !r.entity) continue;
    const authors = ['P50', 'P170', 'P84', 'P86'].flatMap(p => getClaims(r.entity, p).map(v => v?.id)).filter(Boolean);
    const o = named.find(x => authors.includes(x.qid));
    if (!o) continue;
    r.wdMatch = 'record';
    r.wdConfirmedBy = { vocab: o.vocabSource === 'idref' ? 'IdRef' : 'GND', id: o.gndId || o.idrefId, label: o.label || '', author: true };
    confirmed.push(r);
  }
  return confirmed;
}
// A Wikidata item with more than one IdRef id — the one an
// IdRef heading of the same record uses wins (GND «Italien» → Q38 → 026389908
// the State, 027235408 the place; the record's «Italie» is 027235408), with
// that heading's French form. Before the choice by kind made in the worker.
function preferRecordIdref(results) {
  const own = new Map();
  for (const r of results) if (r.vocabSource === 'idref' && r.idrefId) own.set(String(r.idrefId), r);
  for (const r of results) {
    if (r.idrefId || !r.entity || !hasTrustedQid(r)) continue;
    const ids = getClaims(r.entity, 'P269').map(String);
    if (ids.length < 2) continue;
    const hit = ids.find(i => own.has(i));
    if (!hit) continue;
    r.idrefWd = hit;
    const fr = own.get(hit).controlledLabels?.fr;
    if (fr && r.controlledLabels) r.controlledLabels.fr = fr;
  }
}
// What a term navigates with. The record's own ids (and its
// concept's, set by the reconciliation) come first; the QID, entity and ids
// of a Wikidata item only when it is confirmed. An unverified text-search
// hypothesis must not steer the hierarchy: IdRef «Renaissance» (the period)
// navigated with the ids of the French party Q23731823, and the NS «Design»
// with the GND id of Industriedesign taken from Wikidata.
function navIdentity(t) {
  t = t || {};
  const trusted = hasTrustedQid(t);
  const e = trusted ? (t.entity || null) : null;
  return {
    q: trusted ? t.qid : null, e, u: t.nsData?.uri || null,
    gi: t.gndId || (e ? getClaim(e, 'P227') : null),
    ii: t.idrefId || (e ? (t.idrefWd || getClaim(e, 'P269')) : null),
  };
}
// The forms a selected term may contribute to a combined search. As for the
// single-term search, an unverified Wikidata hypothesis contributes nothing
// but the record's own form.
function andSearchForms(t) {
  const cl = t.mergedLabels || t.controlledLabels || {};
  const record = t.label || cl.it || cl.de || cl.fr || cl.en || cl.es || t.nsData?.label || '';
  if (t.wdMatch === 'unverified') return { labels: {}, entity: null, record };
  return { labels: cl, entity: t.entity, record };
}
// Every language branch contains EVERY selected concept. A
// concept without a label in that language keeps its record form, so no
// branch silently drops a concept — (A_it AND B_it) OR (A_de AND C_de) used
// to lose B or C.
// One chip may stand for several headings of the record that lead
// to the same concept (SBT «Organi di senso» + GND «Sinne»: the others are
// in t.andSiblings). Each language searches all their forms in OR, so no
// heading of the record is dropped and none is chosen over another.
function andSearchAlternatives(t, l) {
  const out = [];
  for (const x of [t, ...(t.andSiblings || [])]) {
    const f = andSearchForms(x);
    const label = getPrefLabel(f.labels, f.entity, l);
    if (label && !out.some(o => o.toLowerCase() === label.toLowerCase())) out.push(label);
  }
  return out;
}
// All the labels of a chip and its siblings, for the single-term search.
function andChipLabels(t) {
  const out = {};
  [t, ...(t.andSiblings || [])].forEach((x, i) => {
    const f = andSearchForms(x);
    for (const [l, v] of Object.entries(f.labels)) if (v) out[i ? l + '#' + i : l] = v;
    if (i && f.record) out['record#' + i] = f.record;
  });
  return out;
}
// The per-string AND button of a subject string (one copy for
// subjects, one for names-as-subject before). The searchable components —
// not periods ($y) nor forms ($v), and only those with a result — are
// combined with AND in every language where at least two of them have a
// label, and the languages with OR. Labels go through quotePhrase, like the
// other builders: before, a quote inside a label ended the phrase early.
// Returns { url, label } or null when fewer than two components qualify.
// Nor the author chip of a work — the work already names its author.
function componentAndSearch(orderedComps, cr) {
  const skip = c => c.type === 'y' || c.type === 'v' || c.type === 'author';
  const sc = orderedComps.filter((c, ci) => !skip(c) && cr[ci]);
  if (sc.length < 2) return null;
  const byLang = {};
  LANGS.forEach(l => { byLang[l] = []; });
  orderedComps.forEach((c, ci) => {
    if (skip(c) || !cr[ci]) return;
    const cl = cr[ci].controlledLabels || {};
    LANGS.forEach(l => { const lb = getPrefLabel(cl, cr[ci].entity, l); if (lb) byLang[l].push(quotePhrase(lb)); });
  });
  const parts = Object.values(byLang).filter(t => t.length >= 2).map(t => '(' + t.join(' AND ') + ')');
  if (!parts.length) return null;
  return { url: buildSearchUrl(parts.join(' OR '), 'subject'), label: 'AND: ' + sc.map(c => c.t).join(' + ') };
}
function appendComponentAndButton(andEl, orderedComps, cr) {
  const s = andEl ? componentAndSearch(orderedComps, cr) : null;
  if (!s) return;
  const acts = el('div', { className: 'acts', style: { marginTop: '4px' } });
  acts.appendChild(el('button', { className: 'act act-and', 'data-action': 'openurl', 'data-url': s.url, textContent: s.label }));
  andEl.appendChild(acts);
}
function buildCrossAndUrl(selectedTerms, mode) {
  const forms = selectedTerms.map(andSearchForms);
  if (forms.length < 2 || forms.some(f => !f.record)) return null;
  const branches = new Set();
  const phrase = alts => (alts.length > 1 ? '(' + alts.map(quotePhrase).join(' OR ') + ')' : quotePhrase(alts[0]));
  LANGS.forEach(l => {
    let own = 0;
    const terms = selectedTerms.map((t, i) => {
      const alts = andSearchAlternatives(t, l);
      if (alts.length) own++;
      return alts.length ? alts : [forms[i].record];
    });
    if (own) branches.add('(' + terms.map(phrase).join(' AND ') + ')');
  });
  if (!branches.size) branches.add('(' + forms.map(f => quotePhrase(f.record)).join(' AND ') + ')');
  return buildSearchUrl([...branches].join(' OR '), mode);
}

// ═══════════════════════════════════════════
// MERGED LABELS (cross-vocab QID dedup)
// ═══════════════════════════════════════════
// Results sharing a QID complete each other's missing languages,
// but two DIFFERENT thesaurus concepts that point at the same Wikidata item
// stay distinct, and a result's own labels are never overwritten.
function mergeByQid(allResults) {
  for (const r of allResults) {
    if (!hasTrustedQid(r)) continue;
    const merged = { ...(r.controlledLabels || {}) };
    const ownNs = r.nsData?.id || null;
    for (const o of allResults) {
      if (o === r || o.qid !== r.qid || !hasTrustedQid(o)) continue;
      const otherNs = o.nsData?.id || null;
      if (ownNs && otherNs && ownNs !== otherNs) continue;
      for (const [lang, label] of Object.entries(o.controlledLabels || {})) {
        if (label && !merged[lang]) merged[lang] = label;
      }
    }
    r.mergedLabels = merged;
  }
}
