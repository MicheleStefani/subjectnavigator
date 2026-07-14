// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: reconciliation + hierarchy engine — v1.1.0
// Moved verbatim from the v1.0.x content script (where it ran per tab):
// same routes, same fallback chains, same cluster-grade semantics. The
// only changes are (a) the v1.0.x message bridges became direct calls into
// bg_net.js, and (b) getHierarchy resolves the Wikidata entity itself
// instead of receiving it from the content script.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, LANGS, VOCAB_LANG, IDREF_TYPES, WD_API, WD_SPARQL, AAT_SPARQL, NS_SPARQL, clId, clGrade, sparqlLiteral, rck, cleanName, invertName, getClaim } from './bg_util.js';
import { sparql, fetchJSON, lobid, idrefJSON, idrefSolr, fetchBNE, fetchLCSH, fetchBnfLabelRemote } from './bg_net.js';
import { RC, HC, EC, nsIndex, langLabels, nsLookup, nsGetConcept, nsGetLabel, makeNsData, nsLookupByQid, nsLookupByGnd, nsLookupByBnf, nsLookupByLcsh, nsLookupByIdref, resolveClusterLabels, getAuthLabel, getGndBroaderNarrower, getBnfBroaderNarrower, nsLookupByFrLabel } from './bg_index.js';

// ═══════════════════════════════════════════
// RECONCILIATION (with NS local index + authoritative labels)
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// RESOLVE NAMES/PLACES/ENTITIES via live API (v3.2)
// For MARC 600/610/651/700/710 with $0 identifiers
// ═══════════════════════════════════════════

async function resolveViaLobid(gndId) {
  try {
    const ld = await lobid(gndId);
    if (!ld?.preferredName) return null;
    const types = (ld.type || []).filter(t => t !== 'AuthorityResource');
    let cat = 'other';
    if (types.some(t => t.includes('Person'))) cat = 'name';
    else if (types.some(t => t.includes('PlaceOrGeographic'))) cat = 'place';
    else if (types.some(t => t.includes('CorporateBody'))) cat = 'name';
    else if (types.some(t => t.includes('SubjectHeading'))) cat = 'subject';
    else if (types.some(t => t.includes('Family'))) cat = 'name';
    else if (types.some(t => t.includes('Work'))) cat = 'title';
    // Extract useful IDs from sameAs
    let wikidataId = null, viafId = null, bnfArk = null, locId = null;
    for (const sa of (ld.sameAs || [])) {
      const id = (sa && sa.id) ? sa.id : (typeof sa === 'string' ? sa : '');
      if (id.includes('wikidata.org/entity/')) wikidataId = id.split('/').pop();
      else if (id.includes('viaf.org/viaf/')) viafId = (id.match(/viaf\/(\d+)/) || [])[1] || null;
      else if (id.includes('catalogue.bnf.fr/ark:') || id.includes('data.bnf.fr/ark:')) {
        bnfArk = (id.match(/ark:\/12148\/(cb\w+)/) || [])[1] || null;
      }
      else if (id.includes('id.loc.gov/')) locId = (id.match(/agents\/(\w+)/) || [])[1] || null;
    }
    return { label: ld.preferredName, variants: ld.variantName || [], types, category: cat,
      wikidataId, viafId, bnfArk, locId, lobidData: ld };
  } catch (e) { return null; }
}

async function resolveViaIdRefSolr(ppn) {
  try {
    const doc = await idrefSolr(ppn);
    if (!doc?.affcourt_z) return null;
    const rtype = doc.recordtype_z || '';
    const typeInfo = IDREF_TYPES[rtype] || { desc: 'Altro', cat: 'other' };
    return { label: doc.affcourt_z, variants: doc.affcourt_r || [], type: rtype,
      typeDesc: typeInfo.desc, category: typeInfo.cat,
      isSubject: typeInfo.cat === 'subject' };
  } catch (e) { return null; }
}

// Resolve a Wikidata QID through authority-ID backlinks, in reliability
// order (v1.1.1). Systematic version of the old P227-only lookup: ANY
// authority ID we hold — from the MARC record or from the cluster — can
// anchor the concept to Wikidata before the error-prone text search is
// attempted. Note: WD stores BnF ARKs without the 'cb' prefix (P268).
const WD_BACKLINK_PROPS = [
  ['gnd',   'P227', 'GND→WD'],
  ['idref', 'P269', 'IdRef→WD'],
  ['lcsh',  'P244', 'LCSH→WD'],
  ['bnf',   'P268', 'BnF→WD'],
  ['bne',   'P950', 'BNE→WD'],
  ['viaf',  'P214', 'VIAF→WD'],
  ['isni',  'P213', 'ISNI→WD'],
];
async function qidViaBacklinks(ids, route) {
  for (const [key, prop, tag] of WD_BACKLINK_PROPS) {
    let v = ids[key];
    if (!v) continue;
    if (key === 'bnf') v = String(v).replace(/^cb/, '');
    // WD stores ISNIs in spaced groups of four (P213 format constraint)
    if (key === 'isni') v = String(v).replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
    try {
      const r = await sparql(WD_SPARQL, 'SELECT ?i WHERE{?i wdt:' + prop + ' ' + sparqlLiteral(v) + '}LIMIT 1');
      if (r?.results?.bindings?.length) {
        route.push(tag);
        return r.results.bindings[0].i.value.split('/').pop();
      }
    } catch (e) { logDebug('backlink', prop, e); }
  }
  return null;
}

// Mine co-references from a raw IdRef record (UNIMARC-A JSON): ISNI (010),
// BnF ark (033), VIAF (035). Person records often carry them even when
// Wikidata lacks the PPN backlink, so they anchor the person
// deterministically before any text search (C1, v1.1.1).
function idrefCorefs(ir) {
  const out = {};
  const fields = ir?.record?.datafield || [];
  for (const f of fields) {
    const tag = String(f.tag);
    const subs = Array.isArray(f.subfield) ? f.subfield : (f.subfield ? [f.subfield] : []);
    for (const s of subs) {
      const val = String(s?.content || '');
      if (tag === '010' && String(s?.code) === 'a' && !out.isni) out.isni = val;
      if (tag === '033' && !out.bnf) {
        const m = val.match(/ark:\/12148\/(cb\w+)/);
        if (m) out.bnf = m[1];
      }
      if (tag === '035' && !out.viaf) {
        const m = val.match(/viaf\.org\/viaf\/(\d+)/) || val.match(/^\(VIAF\)(\d+)/i);
        if (m) out.viaf = m[1];
      }
    }
  }
  return out;
}

// Person-name compatibility between the MARC form ("Bär, Oskar") and a WD
// entity's labels + aliases, diacritics-folded: the main family-name token
// must appear in at least one of them. Guards the text fallback (B1) —
// wbsearchentities matches fuzzily, e.g. "Oskar Bär" → "Oskar Barnack".
function foldName(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function personNameMatches(term, entity) {
  if (!entity) return false;
  const surname = foldName(cleanName(term).split(',')[0].trim());
  const sTokens = surname.split(/\s+/).filter(t => t.length > 1);
  const key = sTokens[sTokens.length - 1];
  if (!key) return false;
  const hay = [];
  for (const l of LANGS) {
    const lb = entity.labels?.[l]?.value;
    if (lb) hay.push(lb);
    for (const al of (entity.aliases?.[l] || [])) {
      if (al?.value) hay.push(al.value);
    }
  }
  return hay.some(h => foldName(h).split(/[\s,.'-]+/).includes(key));
}

// ═══════════════════════════════════════════
// CONSOLIDATED HELPERS
// ═══════════════════════════════════════════


// Resolve the authoritative labels of a cluster: local label files first,
// HTTP fallback second. Fills cl.{de,fr,en,es} in place; async fallbacks
// are queued onto `promises`. `onLobid` receives the raw Lobid record when
// the DE fallback loaded it. opts.overwriteDE: true on the NS-local path,
// where the authoritative GND label replaces the MARC term (v1.0.0
// behaviour). Replaces ~80 lines duplicated across three reconcile() spots.
function queueClusterLabels(cluster, cl, gndIdFallback, promises, onLobid, opts) {
  opts = opts || {};
  if ((cluster.gnd || gndIdFallback) && (opts.overwriteDE || !cl.de)) {
    const gi = cluster.gnd ? clId(cluster.gnd) : gndIdFallback;
    const localDE = getAuthLabel('gnd', gi);
    if (localDE) {
      cl.de = localDE;
    } else {
      promises.push(lobid(gi).then(ld => {
        if (ld?.preferredName) {
          if (onLobid) onLobid(ld);
          if (opts.overwriteDE || !cl.de) cl.de = ld.preferredName;
        }
      }).catch(() => {}));
    }
  }
  if (!cl.fr && cluster.bnf) {
    const bi = clId(cluster.bnf);
    const localFR = getAuthLabel('bnf', bi);
    if (localFR) cl.fr = localFR;
    else promises.push(fetchBnfLabelRemote(bi).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; }));
  }
  if (!cl.en && cluster.lcsh) {
    const li = clId(cluster.lcsh);
    const localEN = getAuthLabel('lcsh', li);
    if (localEN) cl.en = localEN;
    else promises.push(fetchLCSH(li).then(h => { if (h && !cl.en) cl.en = h; }).catch(() => {}));
  }
  if (!cl.es && cluster.bne) {
    const bi = clId(cluster.bne);
    const localES = getAuthLabel('bne', bi);
    if (localES) cl.es = localES;
    else promises.push(fetchBNE(bi).then(lb => { if (lb && !cl.es) cl.es = lb; }).catch(() => {}));
  }
}

// Load a Wikidata entity (EC-cached). In v1.0.x the content script shipped
// the entity object over the message bridge for hierarchy calls; the
// worker now resolves it locally from the QID.
async function loadEntity(qid) {
  if (!/^Q\d{1,12}$/.test(String(qid))) return null;
  if (EC.has(qid)) return EC.get(qid);
  try {
    const d = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
    if (d?.entities?.[qid]) { EC.set(qid, d.entities[qid]); return d.entities[qid]; }
  } catch (e) { logDebug('loadEntity', qid, e); }
  return null;
}

export async function reconcile(term, gndId, idrefId, vocabSource, termType) {
  const k = rck(term, gndId, idrefId);
  if (RC.has(k)) {
    const cached = RC.get(k);
    // If termType was not set before but is now provided, update it
    if (termType && !cached.termType) cached.termType = termType;
    return cached;
  }
  let qid = null, entity = null, route = [], nsData = null, dewey = null;
  let viaText = false;                 // qid found by the WD text search (B1)
  let wdMatch = null, wdDiscarded = null; // A1 verdict + rejected candidate
  let nsClusterGrade = null; // 1-4 grade from pre-computed cluster, null if no NS anchor found
  const cl = {};
  const homeLang = VOCAB_LANG[vocabSource] || null;
  if (homeLang) cl[homeLang] = term;
  let lobidData = null, idrefData = null;

  // ── NS local index lookup (always try, regardless of vocabSource) ──
  {
    const ns = nsLookup(term);
    if (ns) {
      nsData = makeNsData(ns);
      cl.it = ns.l;
      route.push('NS-local');

      // Use pre-computed cluster (replaces old mx-based approach)
      const cluster = ns.cl || {};
      nsClusterGrade = clGrade(cluster); // capture cluster confidence grade

      // GND from cluster
      if (cluster.gnd && !gndId) { gndId = clId(cluster.gnd); route.push('NS→GND'); }

      // QID from cluster
      if (cluster.wd) { qid = clId(cluster.wd); route.push('NS→WD'); }

      // Authoritative labels: local files first, HTTP fallback (consolidated)
      const labelPromises = [];
      queueClusterLabels(cluster, cl, gndId, labelPromises,
        ld => { lobidData = ld; }, { overwriteDE: true });
      if (labelPromises.length) await Promise.all(labelPromises);

      // If no QID yet, try the Wikidata backlinks for EVERY authority ID
      // the record or the cluster provides — not only GND/P227 (v1.1.1:
      // clusters without GND and without a precomputed QID used to fall
      // through to the text search).
      if (!qid) {
        qid = await qidViaBacklinks({
          gnd: gndId,
          idref: idrefId || clId(cluster.idref),
          lcsh: clId(cluster.lcsh),
          bnf: clId(cluster.bnf),
          bne: clId(cluster.bne),
        }, route);
      }

      // Use WD as hub to discover missing IDs for authoritative labels
      if (qid && (!cl.de || !cl.fr || !cl.en || !cl.es)) {
        // Load entity to discover IDs
        if (!entity) {
          try {
            const d = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
            if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
          } catch (e) { logDebug('net fallback', e); }
        }
        if (entity) {
          const hubPromises = [];
          // Discover GND via P227 if missing
          if (!cl.de) {
            const gi = getClaim(entity, 'P227');
            if (gi) hubPromises.push(lobid(gi).then(ld => { if (ld?.preferredName) { lobidData = ld; cl.de = ld.preferredName; } }).catch(() => {}));
          }
          // Discover RAMEAU via P268 (or IdRef via P269) if FR is missing —
          // v1.1.1: the hub previously recovered DE/EN/ES but skipped French.
          if (!cl.fr) {
            const bi = getClaim(entity, 'P268');
            const ii = getClaim(entity, 'P269');
            if (bi) hubPromises.push(fetchBnfLabelRemote('cb' + bi).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; }).catch(() => {}));
            else if (ii) hubPromises.push(idrefSolr(ii).then(doc => { if (doc?.affcourt_z && !cl.fr) cl.fr = doc.affcourt_z; }).catch(() => {}));
          }
          // Discover LCSH via P244 if missing
          if (!cl.en) {
            const li = getClaim(entity, 'P244');
            if (li) hubPromises.push(fetchLCSH(li).then(h => { if (h) cl.en = h; }).catch(() => {}));
          }
          // Discover BNE via P950 if missing
          if (!cl.es) {
            const bi = getClaim(entity, 'P950');
            if (bi) hubPromises.push(fetchBNE(bi).then(lb => { if (lb) cl.es = lb; }).catch(() => {}));
          }
          await Promise.all(hubPromises);
        }
      }
    }
  }

  // ── GND path (non-SBT terms): try reverse index first, then WD ──
  if (!nsData && gndId) {
    // Try direct reverse lookup by GND ID (instant, no API call)
    const nsFromGnd = nsLookupByGnd(gndId);
    if (nsFromGnd) {
      nsData = makeNsData(nsFromGnd);
      cl.it = nsFromGnd.l;
      route.push('GND→NS-reverse');
      // Resolve cluster labels
      const cluster = nsFromGnd.cl || {};
      nsClusterGrade = clGrade(cluster);
      if (cluster.wd) { qid = clId(cluster.wd); route.push('cl→WD'); }
      const clLabels = resolveClusterLabels(cluster);
      if (clLabels.de) cl.de = clLabels.de;
      if (clLabels.fr) cl.fr = clLabels.fr;
      if (clLabels.en) cl.en = clLabels.en;
      if (clLabels.es) cl.es = clLabels.es;
    }
    // v1.1.1: names (1xx/7xx) can carry BOTH a GND and an IdRef ID — try
    // both backlinks here, not only P227.
    if (!qid) {
      qid = await qidViaBacklinks({ gnd: gndId, idref: idrefId }, route);
    }
    if (!qid || !cl.de) {
      // Use enhanced Lobid resolution (extracts sameAs with WD, VIAF, BnF)
      const lobidRes = await resolveViaLobid(gndId);
      if (lobidRes) {
        lobidData = lobidRes.lobidData;
        if (!cl.de) cl.de = lobidRes.label;
        route.push('Lobid:' + gndId);
        // Use Lobid sameAs to discover QID and BnF
        if (!qid && lobidRes.wikidataId) { qid = lobidRes.wikidataId; route.push('Lobid→WD'); }
        // If Lobid has BnF ARK, try to get French label via consolidated helper
        if (!cl.fr && lobidRes.bnfArk) {
          const lbl = await fetchBnfLabelRemote(lobidRes.bnfArk);
          if (lbl) { cl.fr = lbl; route.push('Lobid→BnF'); }
        }
        // Fallback: WD via VIAF if still no QID
        if (!qid && lobidRes.viafId) {
          try {
            const wr = await sparql(WD_SPARQL, 'SELECT ?i WHERE{?i wdt:P214 ' + sparqlLiteral(lobidRes.viafId) + '}LIMIT 1');
            if (wr?.results?.bindings?.length) { qid = wr.results.bindings[0].i.value.split('/').pop(); route.push('VIAF\u2192WD'); }
          } catch (e) { logDebug('net fallback', e); }
        }
      }
    }
  }

  // ── IdRef path ──
  if (!nsData && idrefId) {
    // Step 1: direct reverse lookup by IdRef PPN (instant, no network)
    const nsFromIdref = nsLookupByIdref(idrefId);
    if (nsFromIdref) {
      nsData = makeNsData(nsFromIdref);
      cl.it = nsFromIdref.l;
      route.push('IdRef→NS-direct');
      const cluster = nsFromIdref.cl || {};
      nsClusterGrade = clGrade(cluster);
      if (cluster.wd) { qid = clId(cluster.wd); }
      const clLabels = resolveClusterLabels(cluster);
      if (clLabels.de && !cl.de) cl.de = clLabels.de;
      // cl.fr: use original MARC term (homeLang), fall back to cluster label only if term not set
      if (!cl.fr) cl.fr = clLabels.fr || null;
      if (clLabels.en && !cl.en) cl.en = clLabels.en;
      if (clLabels.es && !cl.es) cl.es = clLabels.es;
    }

    // Step 2: IdRef Solr for type info (needed for hierarchy) — always run to get termType
    // but only use label/NS matching if direct lookup above failed
    const solrRes = await resolveViaIdRefSolr(idrefId);
    if (solrRes) {
      route.push('IdRefSolr:' + idrefId + '(' + (solrRes.typeDesc || solrRes.type) + ')');
      // Only use Solr label if cl.fr not already set by MARC term or cluster
      if (!cl.fr) cl.fr = solrRes.label;
      // If direct lookup failed, try FR label → NS as fallback
      if (!nsData && solrRes.isSubject) {
        const nsFromFr = nsLookupByFrLabel(solrRes.label);
        if (nsFromFr) {
          nsData = makeNsData(nsFromFr);
          cl.it = nsFromFr.l;
          route.push('IdRef→FR→NS');
          const cluster = nsFromFr.cl || {};
          nsClusterGrade = clGrade(cluster);
          const clLabels = resolveClusterLabels(cluster);
          if (clLabels.de && !cl.de) cl.de = clLabels.de;
          if (clLabels.fr && !cl.fr) cl.fr = clLabels.fr;
          if (clLabels.en && !cl.en) cl.en = clLabels.en;
          if (cluster.wd) { qid = clId(cluster.wd); }
        }
      }
    }

    // Step 2b (v1.1.1): resolve WD via the IdRef PPN backlink (P269) —
    // mirrors the GND path's P227 lookup. Without this, records carrying
    // only an IdRef ID fell through to the error-prone text search even
    // when Wikidata holds the exact backlink (e.g. the place heading
    // "Suisse" matched the French commune Q22036 instead of Q39).
    if (!qid) {
      qid = await qidViaBacklinks({ idref: idrefId }, route);
    }

    // Step 3: load full IdRef JSON for hierarchy data (only if still no QID)
    if (!qid || !idrefData) {
      try {
        const ir = await idrefJSON(idrefId);
        if (ir) { idrefData = ir; route.push('IdRef:' + idrefId); }
      } catch (e) { logDebug('net fallback', e); }
    }

    // Step 3c (v1.1.1, C1): mine co-references from the IdRef record —
    // VIAF (035), ISNI (010), BnF ark (033) — and try their WD backlinks.
    // Reaches persons whose Wikidata item lacks the PPN but carries VIAF or
    // ISNI, before falling back to the text search.
    if (!qid && idrefData) {
      const corefs = idrefCorefs(idrefData);
      const found = Object.keys(corefs);
      if (found.length) {
        // Make the attempt visible in the route even when Wikidata has no
        // item for these IDs: the tag lists what was mined; a following
        // …→WD tag appears only on a hit. (Diagnosability: without this,
        // a fruitless VIAF/ISNI lookup is indistinguishable from a skip.)
        route.push('coref:' + found.map(k => k.toUpperCase()).join('+'));
        qid = await qidViaBacklinks(corefs, route);
      }
    }
  }

  // ── NS SPARQL fallback REMOVED in v3.3 ──
  // The local unified index contains the complete NS vocabulary.
  // If nsLookup() didn't find the term, it either doesn't exist in NS
  // or is misspelled — in both cases the remote SPARQL would not help
  // and only adds ~500ms-1s latency per term.

  // ── Text fallback (WD) ──
  if (!qid) {
    route.push('WD-text');
    let searchTerm = term, searchLang = 'it';
    if (cl.fr && vocabSource === 'idref') { searchTerm = cl.fr; searchLang = 'fr'; }
    else if (cl.de && vocabSource === 'gnd') { searchTerm = cl.de; searchLang = 'de'; }
    else if (cl.it) { searchTerm = cl.it; }
    if (searchTerm.includes(',')) searchTerm = invertName(searchTerm);
    else searchTerm = cleanName(searchTerm);
    try {
      const r = await fetchJSON(WD_API + '?action=wbsearchentities&search=' + encodeURIComponent(searchTerm) + '&language=' + searchLang + '&uselang=' + searchLang + '&type=item&limit=1&format=json&origin=*');
      if (r?.search?.length) { qid = r.search[0].id; viaText = true; }
    } catch (e) { logDebug('net fallback', e); }
  }

  // ── Load WD entity ──
  if (qid) {
    if (EC.has(qid)) { entity = EC.get(qid); }
    else {
      try {
        const d = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
        if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
      } catch (e) { logDebug('net fallback', e); }
    }
  }
  // ── B1 (v1.1.1): validate candidates found via the text fallback ──
  // wbsearchentities matches fuzzily and we take its first hit, so a person
  // found by name alone must be corroborated before its IDs are adopted:
  //  · confirmed  — the entity shares an authority ID with the record;
  //  · conflict   — person whose family name appears nowhere among the
  //                 entity's names → discard the entity entirely (the case
  //                 "Bär, Oskar" → Q61109 "Oskar Barnack");
  //  · unverified — kept, but flagged for the UI banner. ID *difference*
  //                 alone never rejects: authorities legitimately hold
  //                 several PPNs for one concept (RAMEAU "Géographie").
  if (viaText && qid && entity) {
    const eGnd = getClaim(entity, 'P227');
    const eIdref = getClaim(entity, 'P269');
    const sharesId = (gndId && eGnd && String(eGnd) === String(gndId))
                  || (idrefId && eIdref && String(eIdref) === String(idrefId));
    if (sharesId) {
      wdMatch = 'confirmed';
    } else if (termType === 'person' && !personNameMatches(term, entity)) {
      wdMatch = 'conflict';
      const wdLabel = entity.labels?.it?.value || entity.labels?.en?.value
        || entity.labels?.de?.value || entity.labels?.fr?.value || '';
      wdDiscarded = { qid, label: wdLabel };
      route.push('WD-text✗');
      qid = null;
      entity = null;
    } else {
      wdMatch = 'unverified';
    }
  } else if (viaText && qid) {
    wdMatch = 'unverified'; // entity failed to load: nothing to judge with
  }

  if (entity) {
    const cs = entity?.claims?.P1036;
    if (cs?.length) {
      dewey = [];
      for (const x of cs) {
        const n = x.mainsnak?.datavalue?.value;
        if (n) { let ed = null; if (x.qualifiers?.P393) ed = x.qualifiers.P393[0]?.datavalue?.value; dewey.push({ number: n, edition: ed }); }
      }
      if (!dewey.length) dewey = null;
    }
  }

  // ── NS reverse lookup: if we have QID or GND but no nsData, find the NS concept ──
  if (!nsData && nsIndex) {
    let nsReverse = null;
    if (qid) nsReverse = nsLookupByQid(qid);
    if (!nsReverse && gndId) nsReverse = nsLookupByGnd(gndId);
    if (!nsReverse && idrefId) nsReverse = nsLookupByIdref(idrefId);
    if (!nsReverse && entity) {
      const gi = getClaim(entity, 'P227');
      if (gi) nsReverse = nsLookupByGnd(gi);
      if (!nsReverse) {
        const li = getClaim(entity, 'P244');
        if (li) nsReverse = nsLookupByLcsh(li);
      }
      if (!nsReverse) {
        const ii = getClaim(entity, 'P269');
        if (ii) nsReverse = nsLookupByIdref(ii);
      }
    }
    if (nsReverse) {
      nsData = makeNsData(nsReverse);
      if (!cl.it) cl.it = nsReverse.l;
      if (!dewey && nsReverse.d) dewey = [{ number: nsReverse.d, edition: null }];
      route.push('NS-reverse');
      // Recover authoritative labels from pre-computed cluster (local first, HTTP fallback)
      const cluster = nsReverse.cl || {};
      nsClusterGrade = clGrade(cluster);
      const reversePromises = [];
      queueClusterLabels(cluster, cl, gndId, reversePromises, ld => { lobidData = ld; });
      if (reversePromises.length) await Promise.all(reversePromises);
    }
  }

  // ── Enrichment for places/persons: use WD entity to fill missing authoritative labels ──
  // Only for terms that are NOT thesaurus concepts (no nsData) but have a WD entity,
  // AND whose termType is explicitly 'place' or 'person' (from MARC structure).
  // This avoids false positives from the WD text fallback on misspelled thesaurus terms.
  if (!nsData && entity && (termType === 'place' || termType === 'person')) {
    const enrichPromises = [];
    // GND label via Lobid (only if cl.de is still empty)
    if (!cl.de) {
      const gi = gndId || getClaim(entity, 'P227');
      if (gi) {
        enrichPromises.push(
          lobid(gi).then(ld => {
            if (ld?.preferredName) { if (!lobidData) lobidData = ld; if (!cl.de) cl.de = ld.preferredName; }
          }).catch(() => {})
        );
      }
    }
    // IdRef/FR label via IdRef Solr (only if cl.fr is still empty)
    if (!cl.fr) {
      const ii = idrefId || getClaim(entity, 'P269');
      if (ii) {
        enrichPromises.push(
          resolveViaIdRefSolr(ii).then(solr => {
            if (solr?.label && !cl.fr) cl.fr = solr.label;
          }).catch(() => {})
        );
      }
    }
    // EN label via LCSH (only if cl.en is still empty)
    if (!cl.en) {
      const li = getClaim(entity, 'P244');
      if (li) {
        enrichPromises.push(
          fetchLCSH(li).then(h => { if (h && !cl.en) cl.en = h; }).catch(() => {})
        );
      }
    }
    // ES label via BNE (only if cl.es is still empty)
    if (!cl.es) {
      const bi = getClaim(entity, 'P950');
      if (bi) {
        enrichPromises.push(
          fetchBNE(bi).then(lb => { if (lb && !cl.es) cl.es = lb; }).catch(() => {})
        );
      }
    }
    if (enrichPromises.length) {
      route.push('enrich-' + termType);
      await Promise.all(enrichPromises);
    }
  }

  const result = { qid, entity, route, nsData, dewey, controlledLabels: cl, vocabSource: vocabSource || null, lobidData, idrefData, termType: termType || null, gndId: gndId || null, idrefId: idrefId || null, nsClusterGrade, wdMatch, wdDiscarded };
  RC.set(k, result);
  return result;
}

// ═══════════════════════════════════════════
// HIERARCHY (with NS local index)
// ═══════════════════════════════════════════
export async function getHierarchy(qid, nsUri, gndId, idrefId) {
  const k = (qid || '') + '|' + (nsUri || '') + '|' + (gndId || '') + '|' + (idrefId || '');
  if (HC.has(k)) return HC.get(k);
  const nodes = [];

  function addNode(type, label, src, uri, langs, extras) {
    const ex = nodes.find(n => n.label.toLowerCase() === label.toLowerCase() && n.type === type);
    if (ex) {
      if (!ex.srcs.includes(src)) ex.srcs.push(src);
      if (langs) Object.entries(langs).forEach(([k, v]) => { if (v) ex.langs[k] = ex.langs[k] || v; });
      if (extras) { if (extras.gndId) ex.gndId = ex.gndId || extras.gndId; if (extras.idrefId) ex.idrefId = ex.idrefId || extras.idrefId; if (extras.nsTid) ex.nsTid = ex.nsTid || extras.nsTid; }
    } else {
      nodes.push({ type, label, srcs: [src], uri: uri || '', langs: langs || {}, gndId: extras?.gndId || null, idrefId: extras?.idrefId || null, nsTid: extras?.nsTid || null });
    }
  }

  // NS local hierarchy (instant) — enriched with cluster labels
  if (nsUri && nsIndex) {
    const tid = nsUri.split('/').pop();
    const concept = nsGetConcept(tid);
    if (concept) {
      // Recover GND ID from cluster if not provided (crucial for GND hierarchy)
      if (!gndId && concept.cl?.gnd) {
        gndId = clId(concept.cl.gnd);
      }
      // Recover IdRef-compatible BnF for IdRef hierarchy enrichment
      if (!idrefId && concept.cl?.bnf) {
        // We don't have IdRef ID directly, but we note the BnF for reference
      }
      const addNsNode = (type, relTid) => {
        const lbl = nsGetLabel(relTid);
        if (!lbl) return;
        const cluster = nsIndex.concepts[relTid]?.cl || {};
        const clLabels = resolveClusterLabels(cluster);
        const langs = { it: lbl };
        if (clLabels.de) langs.de = clLabels.de;
        if (clLabels.fr) langs.fr = clLabels.fr;
        if (clLabels.en) langs.en = clLabels.en;
        addNode(type, lbl, 'NS', 'http://purl.org/bncf/tid/' + relTid, langs, { nsTid: relTid, gndId: cluster.gnd ? (clId(cluster.gnd)) : null });
      };
      if (concept.bt) concept.bt.forEach(btId => addNsNode('bt', btId));
      if (concept.nt) concept.nt.forEach(ntId => addNsNode('nt', ntId));
      if (concept.rt) concept.rt.forEach(rtId => addNsNode('rt', rtId));
    }
  } else if (nsUri) {
    // Fallback: SPARQL
    try {
      const r = await sparql(NS_SPARQL, 'PREFIX skos:<http://www.w3.org/2004/02/skos/core#> SELECT ?type ?r ?l WHERE{{BIND("bt" AS ?type) <' + nsUri + '> skos:broader ?r. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}UNION{BIND("nt" AS ?type) ?r skos:broader <' + nsUri + '>. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}UNION{BIND("rt" AS ?type) <' + nsUri + '> skos:related ?r. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}} ORDER BY ?type ?l LIMIT 50');
      if (r?.results?.bindings) r.results.bindings.forEach(b => { addNode(b.type.value, b.l.value, 'NS', b.r.value, {}); });
    } catch (e) { logDebug('net fallback', e); }
  }

  // GND hierarchy — local index first, Lobid API as fallback for related terms
  // or when the GND ID is absent from hierarchy_gnd.json (non-topic entities).
  if (gndId) {
    const localHier = getGndBroaderNarrower(gndId);
    if (localHier) {
      const addGndLocal = (type, ids) => {
        if (!ids) return;
        ids.forEach(relGndId => {
          const nsConcept = nsLookupByGnd(relGndId);
          if (nsConcept) {
            const cluster = nsConcept.cl || {};
            const clLabels = resolveClusterLabels(cluster);
            const deLabel = langLabels.de?.[relGndId];
            const langs = { it: nsConcept.l, de: deLabel || nsConcept.l };
            if (clLabels.fr) langs.fr = clLabels.fr;
            if (clLabels.en) langs.en = clLabels.en;
            addNode(type, nsConcept.l, 'GND', 'https://d-nb.info/gnd/' + relGndId, langs, { gndId: relGndId, nsTid: nsConcept.tid });
          } else {
            const deLabel = langLabels.de?.[relGndId];
            if (deLabel) addNode(type, deLabel, 'GND', 'https://d-nb.info/gnd/' + relGndId, { de: deLabel }, { gndId: relGndId });
          }
        });
      };
      addGndLocal('bt', localHier.bt);
      addGndLocal('nt', localHier.nt);
      // related terms (rt) are not in the local hierarchy file — skip API call
      // to avoid the latency; they can be re-enabled below if needed.
    } else {
      // Fallback: Lobid API (covers non-topic GND entities and missing entries)
      try {
        const ld = await lobid(gndId);
        if (ld) {
          const addGndNodes = (type, items) => {
            if (!items) return;
            items.forEach(b => {
              if (!b.label) return;
              const gi = b.id?.match?.(/gnd\/([^/]+)$/)?.[1] || b.gndIdentifier;
              const nsConcept = gi ? nsLookupByGnd(gi) : null;
              if (nsConcept) {
                const cluster = nsConcept.cl || {};
                const clLabels = resolveClusterLabels(cluster);
                const langs = { it: nsConcept.l, de: b.label };
                if (clLabels.fr) langs.fr = clLabels.fr;
                if (clLabels.en) langs.en = clLabels.en;
                addNode(type, nsConcept.l, 'GND', b.id, langs, { gndId: gi, nsTid: nsConcept.tid });
              } else {
                addNode(type, b.label, 'GND', b.id, { de: b.label }, { gndId: gi });
              }
            });
          };
          addGndNodes('bt', ld.broaderTermGeneral);
          addGndNodes('nt', ld.narrowerTermGeneral);
          addGndNodes('rt', ld.relatedTerm);
        }
      } catch (e) { logDebug('gnd lobid fallback', e); }
    }
  }

  // IdRef hierarchy — resolve to BnF ID via NS cluster, then use local BnF
  // hierarchy index. Falls back to IdRef API when no local data is available.
  if (idrefId) {
    // Find the BnF/RAMEAU ID for this IdRef term via the NS cluster reverse index
    const idrefNsConcept = nsLookupByIdref(idrefId);
    const idrefBnfId = idrefNsConcept?.cl?.bnf ? clId(idrefNsConcept.cl.bnf) : null;
    const localBnfHier = idrefBnfId ? getBnfBroaderNarrower(idrefBnfId) : null;

    if (localBnfHier) {
      const addBnfLocal = (type, ids) => {
        if (!ids) return;
        ids.forEach(relBnfId => {
          const relNsConcept = nsLookupByBnf(relBnfId);
          if (relNsConcept) {
            const cluster = relNsConcept.cl || {};
            const clLabels = resolveClusterLabels(cluster);
            const frLabel = langLabels.fr?.[relBnfId];
            const langs = { it: relNsConcept.l, fr: frLabel || relNsConcept.l };
            if (clLabels.de) langs.de = clLabels.de;
            if (clLabels.en) langs.en = clLabels.en;
            // Use IdRef ID from cluster if available, else leave blank
            const relIdrefId = relNsConcept.cl?.idref ? clId(relNsConcept.cl.idref) : null;
            const relUri = relIdrefId ? 'https://www.idref.fr/' + relIdrefId : '';
            addNode(type, relNsConcept.l, 'IdRef', relUri, langs, { idrefId: relIdrefId, nsTid: relNsConcept.tid });
          } else {
            const frLabel = langLabels.fr?.[relBnfId];
            if (frLabel) addNode(type, frLabel, 'IdRef', '', { fr: frLabel }, {});
          }
        });
      };
      addBnfLocal('bt', localBnfHier.bt);
      addBnfLocal('nt', localBnfHier.nt);
    } else {
      // Fallback: IdRef API (covers terms not in NS clusters or missing from hierarchy_bnf)
      try {
        const ir = await idrefJSON(idrefId);
        if (ir?.record?.datafield) {
          ir.record.datafield.forEach(f => {
            const tag = String(f.tag);
            if (tag !== '550' && tag !== '551') return;
            const subs = Array.isArray(f.subfield) ? f.subfield : [f.subfield];
            const label = subs.find(s => s.code === 'a')?.content;
            const code5 = subs.find(s => String(s.code) === '5')?.content || '';
            const refId = String(subs.find(s => String(s.code) === '3')?.content || '');
            if (!label) return;
            let type = 'rt';
            if (code5.startsWith('g')) type = 'bt';
            else if (code5.startsWith('h')) type = 'nt';
            const nsConcept = nsLookupByFrLabel(label);
            if (nsConcept) {
              const cluster = nsConcept.cl || {};
              const clLabels = resolveClusterLabels(cluster);
              const langs = { it: nsConcept.l, fr: label };
              if (clLabels.de) langs.de = clLabels.de;
              if (clLabels.en) langs.en = clLabels.en;
              addNode(type, nsConcept.l, 'IdRef', refId ? 'https://www.idref.fr/' + refId : '', langs, { idrefId: refId || null, nsTid: nsConcept.tid });
            } else {
              addNode(type, label, 'IdRef', refId ? 'https://www.idref.fr/' + refId : '', { fr: label }, { idrefId: refId || null });
            }
          });
        }
      } catch (e) { logDebug('idref api fallback', e); }
    }
  }

  // AAT hierarchy — since v1.1.0 the entity is resolved here (EC-cached):
  // the content script no longer ships entity objects across the bridge.
  const entity = qid ? await loadEntity(qid) : null;
  const aatId = entity ? getClaim(entity, 'P1014') : null;
  if (aatId) {
    try {
      const r = await sparql(AAT_SPARQL, 'PREFIX gvp:<http://vocab.getty.edu/ontology#> PREFIX xl:<http://www.w3.org/2008/05/skos-xl#> PREFIX dct:<http://purl.org/dc/terms/> SELECT ?type ?uri ?labelEn ?labelIt ?labelDe ?labelFr WHERE{{BIND("bt" AS ?type)<http://vocab.getty.edu/aat/' + aatId + '> gvp:broaderGeneric ?uri.?uri xl:prefLabel ?xlEn.?xlEn dct:language <http://vocab.getty.edu/aat/300388277>;gvp:term ?labelEn.OPTIONAL{?uri xl:prefLabel ?xlIt.?xlIt dct:language <http://vocab.getty.edu/aat/300388474>;gvp:term ?labelIt}OPTIONAL{?uri xl:prefLabel ?xlDe.?xlDe dct:language <http://vocab.getty.edu/aat/300388344>;gvp:term ?labelDe}OPTIONAL{?uri xl:prefLabel ?xlFr.?xlFr dct:language <http://vocab.getty.edu/aat/300388306>;gvp:term ?labelFr}}UNION{BIND("nt" AS ?type)?uri gvp:broaderGeneric <http://vocab.getty.edu/aat/' + aatId + '>.?uri xl:prefLabel ?xlEn.?xlEn dct:language <http://vocab.getty.edu/aat/300388277>;gvp:term ?labelEn.OPTIONAL{?uri xl:prefLabel ?xlIt.?xlIt dct:language <http://vocab.getty.edu/aat/300388474>;gvp:term ?labelIt}OPTIONAL{?uri xl:prefLabel ?xlDe.?xlDe dct:language <http://vocab.getty.edu/aat/300388344>;gvp:term ?labelDe}OPTIONAL{?uri xl:prefLabel ?xlFr.?xlFr dct:language <http://vocab.getty.edu/aat/300388306>;gvp:term ?labelFr}}}LIMIT 20');
      if (r?.results?.bindings) r.results.bindings.forEach(b => {
        const lbl = b.labelIt?.value || b.labelEn?.value || '';
        const langs = { en: b.labelEn?.value, it: b.labelIt?.value, de: b.labelDe?.value, fr: b.labelFr?.value };
        addNode(b.type.value, lbl, 'AAT', b.uri.value, langs);
      });
    } catch (e) { logDebug('net fallback', e); }
  }

  // WD hierarchy (P279) — match to NS cluster when possible
  if (qid) {
    try {
      const r = await sparql(WD_SPARQL, 'SELECT ?type ?item ?lIt ?lDe ?lFr ?lEn WHERE{{BIND("bt" AS ?type)wd:' + qid + ' wdt:P279 ?item}UNION{BIND("nt" AS ?type)?item wdt:P279 wd:' + qid + '}OPTIONAL{?item rdfs:label ?lIt FILTER(LANG(?lIt)="it")}OPTIONAL{?item rdfs:label ?lDe FILTER(LANG(?lDe)="de")}OPTIONAL{?item rdfs:label ?lFr FILTER(LANG(?lFr)="fr")}OPTIONAL{?item rdfs:label ?lEn FILTER(LANG(?lEn)="en")}}LIMIT 20');
      if (r?.results?.bindings) r.results.bindings.forEach(b => {
        const lbl = b.lIt?.value || b.lEn?.value || '';
        if (!lbl) return;
        const langs = { it: b.lIt?.value, de: b.lDe?.value, fr: b.lFr?.value, en: b.lEn?.value };
        const wdQid = b.item?.value?.split('/').pop() || null;
        const nsConcept = wdQid ? nsLookupByQid(wdQid) : null;
        if (nsConcept) {
          const cluster = nsConcept.cl || {};
          const clLabels = resolveClusterLabels(cluster);
          const mergedLangs = { it: nsConcept.l, ...clLabels, ...langs };
          addNode(b.type.value, nsConcept.l, 'WD', b.item.value, mergedLangs, { nsTid: nsConcept.tid });
        } else {
          addNode(b.type.value, lbl, 'WD', b.item.value, langs);
        }
      });
    } catch (e) { logDebug('net fallback', e); }
  }

  // ── Cluster-based fusion: merge nodes sharing the same nsTid ──
  const fused = [];
  const tidMap = new Map();
  for (const n of nodes) {
    if (n.nsTid) {
      const fusionKey = n.type + ':' + n.nsTid;
      if (tidMap.has(fusionKey)) {
        const target = fused[tidMap.get(fusionKey)];
        n.srcs.forEach(s => { if (!target.srcs.includes(s)) target.srcs.push(s); });
        Object.entries(n.langs).forEach(([k, v]) => { if (v) target.langs[k] = target.langs[k] || v; });
        if (n.gndId) target.gndId = target.gndId || n.gndId;
        if (n.idrefId) target.idrefId = target.idrefId || n.idrefId;
      } else {
        tidMap.set(fusionKey, fused.length);
        fused.push({ ...n });
      }
    } else {
      const existing = fused.find(f => f.type === n.type && f.label.toLowerCase() === n.label.toLowerCase());
      if (existing) {
        n.srcs.forEach(s => { if (!existing.srcs.includes(s)) existing.srcs.push(s); });
        Object.entries(n.langs).forEach(([k, v]) => { if (v) existing.langs[k] = existing.langs[k] || v; });
        if (n.gndId) existing.gndId = existing.gndId || n.gndId;
        if (n.idrefId) existing.idrefId = existing.idrefId || n.idrefId;
      } else {
        fused.push({ ...n });
      }
    }
  }

  // Sort within types: clustered nodes first, then AAT, then WD-only
  fused.sort((a, b) => {
    if (a.type !== b.type) return 0;
    const aScore = a.nsTid ? 0 : a.srcs.includes('AAT') ? 1 : 2;
    const bScore = b.nsTid ? 0 : b.srcs.includes('AAT') ? 1 : 2;
    return aScore - bScore;
  });

  HC.set(k, fused);
  return fused;
}
