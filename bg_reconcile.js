// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: reconciliation + hierarchy engine
// Runs in the worker, once for every tab: network access through direct
// calls into bg_net.js; getHierarchy resolves the Wikidata entity itself
// instead of receiving it from the content script.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, LRUMap, LANGS, VOCAB_LANG, IDREF_TYPES, WD_API, WD_SPARQL, AAT_SPARQL, NS_SPARQL, clId, clConf, clGrade, sparqlLiteral, rck, cleanName, invertName, getClaim, getClaims, own } from './bg_util.js';
import { sparql, fetchJSON, lobid, idrefJSON, idrefSolr, idrefSolrByArk, idrefSolrMany, fetchBNE, fetchLCSH, fetchBnfLabelRemote, isTemporaryFailure } from './bg_net.js';
import { RC, HC, EC, nsIndex, langLabels, ensureLabels, ensureHierarchy, nsLookup, nsGetConcept, nsGetLabel, makeNsData, nsLookupByAuthorityCandidates, nsLookupByQid, nsLookupByGnd, nsLookupByBnf, nsLookupByLcsh, nsLookupByIdref, resolveClusterLabels, getAuthLabel, getGndBroaderNarrower, getBnfBroaderNarrower, nsLookupByFrLabel, rameauArkByPpn, rameauPpn, getAuthNote, getExactLinks } from './bg_index.js';

// ═══════════════════════════════════════════
// RECONCILIATION (with NS local index + authoritative labels)
// ═══════════════════════════════════════════

// A candidate reached through a SECONDARY mapping (the record's id is
// declared for the concept but another id holds its single slot) has no
// slot confidence of its own: reading the slot holder's would be wrong.
function slotConfidence(c, authority, ids) {
  const auths = authority === 'gnd+idref' ? ['gnd', 'idref'] : [authority];
  let best = -1;
  for (const a of auths) {
    if (ids?.[a] && clId(c.cl?.[a]) === ids[a]) best = Math.max(best, clConf(c.cl?.[a]));
  }
  return best;
}

function chooseLocalCandidate(candidates, authority, term, ids) {
  if (!candidates?.length) return { concept: null, ambiguous: null };
  if (candidates.length === 1) return { concept: candidates[0], ambiguous: null };
  // The concept whose slot holds the record's id outranks secondary mappings.
  const holders = candidates.filter(c => slotConfidence(c, authority, ids) >= 0);
  if (holders.length === 1) return { concept: holders[0], ambiguous: null };
  if (holders.length > 1) candidates = holders;
  const maxConfidence = Math.max(...candidates.map(c => slotConfidence(c, authority, ids)));
  const strongest = candidates.filter(c => slotConfidence(c, authority, ids) === maxConfidence);
  if (strongest.length === 1 && maxConfidence > 0) return { concept: strongest[0], ambiguous: null };
  const normalised = String(term || '').toLowerCase().trim();
  const exact = strongest.filter(c => String(c.l || '').toLowerCase().trim() === normalised);
  if (exact.length === 1) return { concept: exact[0], ambiguous: null };
  const nonSbt = strongest.filter(c => !c.tid.startsWith('SBT_'));
  if (nonSbt.length === 1 && strongest.some(c => c.tid.startsWith('SBT_'))) {
    return { concept: nonSbt[0], ambiguous: null };
  }
  return {
    concept: null,
    ambiguous: {
      authority,
      candidates: strongest.map(c => ({ tid: c.tid, label: c.l, confidence: slotConfidence(c, authority, ids), grade: clGrade(c.cl) })),
    },
  };
}

function identifierCandidates(gndId, idrefId) {
  const gnd = gndId ? nsLookupByAuthorityCandidates('gnd', gndId) : [];
  const idref = idrefId ? nsLookupByAuthorityCandidates('idref', idrefId) : [];
  if (gnd.length && idref.length) {
    const idrefTids = new Set(idref.map(c => c.tid));
    const intersection = gnd.filter(c => idrefTids.has(c.tid));
    if (intersection.length) return { candidates: intersection, authority: 'gnd+idref' };
    return { candidates: [...gnd, ...idref.filter(c => !gnd.some(g => g.tid === c.tid))], authority: 'gnd+idref' };
  }
  return gnd.length ? { candidates: gnd, authority: 'gnd' }
       : idref.length ? { candidates: idref, authority: 'idref' }
       : { candidates: [], authority: gndId ? 'gnd' : idrefId ? 'idref' : null };
}
// ═══════════════════════════════════════════
// RESOLVE NAMES/PLACES/ENTITIES via live API
// For MARC 600/610/651/700/710 with $0 identifiers
// ═══════════════════════════════════════════

// A catch that notes which service did not answer (only a
// failure that may pass: see isTemporaryFailure). `fails` is the Set of one
// reconciliation; absent, nothing is noted.
function noteFail(fails, service) {
  return e => { if (fails && isTemporaryFailure(e)) fails.add(service); };
}

async function resolveViaLobid(gndId, fails) {
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
      // Checked like every other QID — it goes into the
      // Wikidata API address and into the card's link.
      if (id.includes('wikidata.org/entity/')) { const q = id.split('/').pop(); if (/^Q\d{1,12}$/.test(q)) wikidataId = q; }
      else if (id.includes('viaf.org/viaf/')) viafId = (id.match(/viaf\/(\d+)/) || [])[1] || null;
      else if (id.includes('catalogue.bnf.fr/ark:') || id.includes('data.bnf.fr/ark:')) {
        bnfArk = (id.match(/ark:\/12148\/(cb\w+)/) || [])[1] || null;
      }
      else if (id.includes('id.loc.gov/')) locId = (id.match(/agents\/(\w+)/) || [])[1] || null;
    }
    return { label: ld.preferredName, variants: ld.variantName || [], types, category: cat,
      wikidataId, viafId, bnfArk, locId, lobidData: ld };
  } catch (e) { noteFail(fails, 'GND')(e); return null; }
}

// IdRef record type of each kind of name heading (IDREF_TYPES in bg_util).
const IDREF_KIND = { place: 'c', person: 'a', corporate: 'b', meeting: 's' };

async function resolveViaIdRefSolr(ppn, fails) {
  try {
    const doc = await idrefSolr(ppn);
    if (!doc?.affcourt_z) return null;
    const rtype = doc.recordtype_z || '';
    const typeInfo = own(IDREF_TYPES, rtype) || { desc: 'Altro', cat: 'other' };
    return { label: doc.affcourt_z, variants: doc.affcourt_r || [], type: rtype,
      typeDesc: typeInfo.desc, category: typeInfo.cat,
      isSubject: typeInfo.cat === 'subject' };
  } catch (e) { noteFail(fails, 'IdRef')(e); return null; }
}

// Resolve a Wikidata QID through authority-ID backlinks, in reliability
// order. Systematic version of the old P227-only lookup: ANY
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
// ONE query for all the ids instead of one query per id, in turn
// (up to seven round trips before a card could be shown). The priority order
// above still decides which item wins when several ids answer.
//
// (1) one fixed property per block — with the property inside
// VALUES, QLever (the engine Wikimedia is moving to) reads every triple and
// fails; this form works on both engines. (2) The answers are kept per id
// (item or «no item»): the content script asks for every id of a record in
// ONE query when the record opens (prefetchQids), the headings then find
// their answer here instead of sending one query each (15-20 per record,
// while Wikidata allows 5 at a time). An id still unknown is asked as before.
const QID_BY_ID = new LRUMap(3000);  // 'P227|4030702-5' → 'Q…' or null (no item)
const QID_PENDING = new Map();       // same key → promise of the query asking it
const WD_PREFIXES = 'PREFIX wd:<http://www.wikidata.org/entity/> PREFIX wdt:<http://www.wikidata.org/prop/direct/> PREFIX rdfs:<http://www.w3.org/2000/01/rdf-schema#> ';

function backlinkValue(key, v) {
  if (key === 'bnf') return String(v).replace(/^cb/, '');
  // WD stores ISNIs in spaced groups of four (P213 format constraint)
  if (key === 'isni') return String(v).replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
  return String(v);
}

export function backlinkQuery(pairs) {
  const byProp = new Map();
  for (const [prop, v] of pairs) (byProp.get(prop) || byProp.set(prop, []).get(prop)).push(sparqlLiteral(v));
  const blocks = [...byProp].map(([prop, vals]) =>
    '{VALUES ?v{' + vals.join(' ') + '}?i wdt:' + prop + ' ?v BIND("' + prop + '" AS ?p)}');
  return WD_PREFIXES + 'SELECT ?i ?v ?p WHERE{' + blocks.join('UNION') + '}';
}

// Several items may carry the same id (GND Wandmalerei: Q219423 and Q118495704,
// the item the NS declares for Pittura murale), and the engines return them
// in different orders. Fixed rule: an item the NS index knows, else the
// lowest number.
function pickItem(qids) {
  if (!qids || !qids.length) return null;
  const num = q => parseInt(q.slice(1), 10);
  const sorted = [...new Set(qids)].sort((a, b) => num(a) - num(b));
  return sorted.find(q => nsLookupByQid(q)) || sorted[0];
}

// Ask the ids not yet known (one query); wait for those another query is asking.
// false when a query did not answer for a reason that may pass.
async function askBacklinks(pairs) {
  const waits = [], fresh = [];
  for (const pv of pairs) {
    const k = pv[0] + '|' + pv[1];
    if (QID_BY_ID.has(k)) continue;
    if (QID_PENDING.has(k)) waits.push(QID_PENDING.get(k));
    else if (!fresh.some(f => f[0] === pv[0] && f[1] === pv[1])) fresh.push(pv);
  }
  if (fresh.length) {
    const job = (async () => {
      try {
        const r = await sparql(WD_SPARQL, backlinkQuery(fresh));
        const found = new Map();
        for (const b of r?.results?.bindings || []) {
          const k = b.p?.value + '|' + b.v?.value;
          const q = String(b.i?.value || '').split('/').pop();
          if (/^Q\d+$/.test(q)) (found.get(k) || found.set(k, []).get(k)).push(q);
        }
        for (const [prop, v] of fresh) QID_BY_ID.set(prop + '|' + v, pickItem(found.get(prop + '|' + v)));
        return true;
      } catch (e) {
        logDebug('backlink', e);   // nothing kept: the id is asked again next time
        return !isTemporaryFailure(e);
      } finally {
        for (const [prop, v] of fresh) QID_PENDING.delete(prop + '|' + v);
      }
    })();
    for (const [prop, v] of fresh) QID_PENDING.set(prop + '|' + v, job);
    waits.push(job);
  }
  return (await Promise.all(waits)).every(ok => ok !== false);
}

// Content script, when a record opens: every GND/IdRef id of the record in one
// query, with the RAMEAU twin of each IdRef id (P268: asked later through the
// IdRef record's BnF ark). Ids whose NS concept already has its Wikidata item
// are not asked.
export async function prefetchQids(ids) {
  await ensureLabels(['fr']);   // the RAMEAU/IdRef table gives the twin ark
  const pairs = [];
  for (const { gnd, idref } of ids || []) {
    if (gnd && !nsLookupByGnd(gnd)?.cl?.wd) pairs.push(['P227', backlinkValue('gnd', gnd)]);
    if (idref && !nsLookupByIdref(idref)?.cl?.wd) {
      pairs.push(['P269', backlinkValue('idref', idref)]);
      const ark = rameauArkByPpn(idref);
      if (ark) pairs.push(['P268', backlinkValue('bnf', ark)]);
    }
  }
  for (let i = 0; i < pairs.length; i += 100) await askBacklinks(pairs.slice(i, i + 100));
  return pairs.length;
}

async function qidViaBacklinks(ids, route, fails) {
  const pairs = [];
  for (const [key, prop] of WD_BACKLINK_PROPS) {
    if (ids[key]) pairs.push([prop, backlinkValue(key, ids[key])]);
  }
  if (!pairs.length) return null;
  if (!(await askBacklinks(pairs)) && fails) fails.add('Wikidata');
  for (const [key, prop, tag] of WD_BACKLINK_PROPS) {
    if (!ids[key]) continue;
    const qid = QID_BY_ID.get(prop + '|' + backlinkValue(key, ids[key]));
    if (qid) {
      route.push(tag);
      return qid;
    }
  }
  return null;
}

// Mine co-references from a raw IdRef record (UNIMARC-A JSON): ISNI (010),
// BnF ark (033), VIAF (035). Person records often carry them even when
// Wikidata lacks the PPN backlink, so they anchor the person
// deterministically before any text search.
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
// must appear in at least one of them. Guards the text fallback —
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

function entityTypeCompatible(termType, entity) {
  if (!termType || !entity) return null;
  const p31 = (entity.claims?.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  if (termType === 'person') return p31.includes('Q5');
  if (termType === 'place') return Boolean(entity.claims?.P625 || entity.claims?.P131 || entity.claims?.P17);
  if (termType === 'meeting') return Boolean(entity.claims?.P580 || entity.claims?.P585 || entity.claims?.P276)
    || p31.some(id => ['Q1656682', 'Q2020153', 'Q27968055', 'Q464980'].includes(id));
  if (termType === 'corporate') {
    if (p31.includes('Q5')) return false;
    return Boolean(entity.claims?.P159 || entity.claims?.P1128 || entity.claims?.P452 || entity.claims?.P749)
      || p31.some(id => ['Q43229', 'Q4830453', 'Q79913', 'Q163740', 'Q1664720'].includes(id));
  }
  if (termType === 'period') return Boolean(entity.claims?.P580 || entity.claims?.P582)
    || p31.some(id => ['Q186081', 'Q11514315'].includes(id));
  return null;
}

function entityNameScore(term, entity) {
  const wanted = foldName(cleanName(term)).replace(/\s+/g, ' ').trim();
  if (!wanted) return 0;
  const names = [];
  for (const l of LANGS) {
    if (entity.labels?.[l]?.value) names.push(entity.labels[l].value);
    (entity.aliases?.[l] || []).forEach(a => { if (a?.value) names.push(a.value); });
  }
  return names.some(n => foldName(cleanName(n)).replace(/\s+/g, ' ').trim() === wanted) ? 3 : 0;
}

// Wikidata classes (P31) that are never the concept a
// topical heading means: Wikimedia pages, names, works and publications.
// «Schacht» → the family name, «Imagination (philosophie)» → an album.
const WD_NON_CONCEPT = new Set([
  'Q4167410', 'Q4167836', 'Q13406463', 'Q11266439', 'Q17633526',   // disambiguation, category, list, template, Wikinews
  'Q101352', 'Q202444', 'Q10856962', 'Q11879590', 'Q12308941', 'Q3409032', // family / given / human names
  'Q13442814', 'Q1298668', 'Q7725634', 'Q571', 'Q47461344',        // article, research project, literary work, book, written work
  'Q11424', 'Q506240', 'Q5398426', 'Q482994', 'Q169930', 'Q134556', 'Q7366', 'Q105543609', 'Q215380', 'Q7889', // films, TV, music, games
  'Q838948', 'Q464980',                                            // work of art, exhibition
]);
function isNonConcept(entity) {
  return (entity?.claims?.P31 || []).some(c => WD_NON_CONCEPT.has(c.mainsnak?.datavalue?.value?.id));
}

async function bestWikidataTextCandidate(searchTerm, searchLang, termType, gndId, idrefId) {
  const search = await fetchJSON(WD_API + '?action=wbsearchentities&search=' + encodeURIComponent(searchTerm)
    + '&language=' + searchLang + '&uselang=' + searchLang + '&type=item&limit=5&format=json&origin=*');
  const qids = (search?.search || []).map(x => x.id).filter(q => /^Q\d+$/.test(q));
  if (!qids.length) return null;
  const batch = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qids.join('|')
    + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
  const ranked = qids.map((qid, position) => {
    const candidate = batch?.entities?.[qid];
    if (!candidate) return null;
    const sharesId = (gndId && getClaim(candidate, 'P227') === gndId)
      || (idrefId && getClaim(candidate, 'P269') === idrefId);
    const compatible = entityTypeCompatible(termType, candidate);
    const score = (sharesId ? 100 : 0) + entityNameScore(searchTerm, candidate)
      + (compatible === true ? 3 : compatible === false ? -6 : 0) - position * 0.01;
    return { qid, entity: candidate, score, sharesId, exact: sharesId || entityNameScore(searchTerm, candidate) > 0 };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  // A topical term takes only an item whose label or alias is
  // the heading itself. In a sample of 200 catalogue topics the 12 hits
  // without it were all wrong («Découverte et exploration» → discovery of
  // America, «Sinopie» → a butterfly, research projects named after it).
  // A topical term also refuses an item that is not a concept (name, work,
  // Wikimedia page), and then takes nothing rather than the next item: in
  // 520 catalogue topics the 26 such hits were all wrong, and the next item
  // was wrong in 8 cases out of 19.
  if (termType === 'topic') {
    const best = ranked.find(c => c.exact);
    return best && (best.sharesId || !isNonConcept(best.entity)) ? best : null;
  }
  return ranked[0] || null;
}

// A work without an identifier. Its heading is «Author:
// Title. Parts (qualifiers)» (workD in cs_marc.js): Wikidata is searched by
// the TITLE, and an item is kept only if its label or alias IS the title and
// one of its authors (author, creator, architect, composer) matches the
// author of the heading. The result stays a hypothesis (wdMatch
// 'unverified'); the panel confirms it only through an id (the author's item
// reached by a GND/IdRef id of the record: confirmWorkByAuthor). A heading
// without an author part (a 630) is not searched: a title alone is too
// ambiguous («Lettere», «Opere», translations).
const WORK_AUTHOR_PROPS = ['P50', 'P170', 'P84', 'P86'];
const AUTHOR_TITLE_WORDS = new Set(['papa', 'papst', 'pape', 'pope', 'santo', 'santa', 'saint', 'sainte', 'heiliger', 'heilige', 'sankt']);
export function splitWorkHeading(term) {
  const m = String(term || '').match(/^(.*?\S): (.+)$/);
  return m ? { author: m[1], title: m[2] } : null;
}
// The author of a heading and an author item: the family name (before the
// comma) as for persons; without a comma («Dante Alighieri», «Johannes
// Paulus 2 papa») any word of four letters or more, titles left aside.
function workAuthorMatches(author, entity) {
  if (!entity) return false;
  if (cleanName(author).includes(',')) return personNameMatches(author, entity);
  const words = foldName(cleanName(author)).split(/[\s,.'-]+/).filter(w => w.length >= 4 && !AUTHOR_TITLE_WORDS.has(w));
  if (!words.length) return false;
  const hay = new Set();
  for (const l of LANGS) {
    const names = [entity.labels?.[l]?.value, ...(entity.aliases?.[l] || []).map(a => a?.value)];
    for (const n of names) if (n) foldName(n).split(/[\s,.'-]+/).forEach(w => hay.add(w));
  }
  return words.some(w => hay.has(w));
}
export function workAuthorQids(entity) {
  return [...new Set(WORK_AUTHOR_PROPS.flatMap(p => getClaims(entity, p).map(v => v?.id).filter(id => /^Q\d+$/.test(id || ''))))];
}
async function bestWorkCandidate(heading, searchLang) {
  const parts = splitWorkHeading(heading);
  if (!parts) return null;
  const title = parts.title.replace(/\s*\([^)]*\)/g, '').trim();
  if (!title) return null;
  const search = await fetchJSON(WD_API + '?action=wbsearchentities&search=' + encodeURIComponent(title)
    + '&language=' + searchLang + '&uselang=' + searchLang + '&type=item&limit=5&format=json&origin=*');
  const qids = (search?.search || []).map(x => x.id).filter(q => /^Q\d+$/.test(q));
  if (!qids.length) return null;
  const batch = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qids.join('|')
    + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
  const exact = qids.map(q => batch?.entities?.[q]).filter(e => e && entityNameScore(title, e) > 0);
  const authorIds = [...new Set(exact.flatMap(workAuthorQids))].slice(0, 20);
  if (!authorIds.length) return null;
  const authors = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + authorIds.join('|')
    + '&languages=' + LANGS.join('|') + '&props=labels|aliases&format=json&origin=*');
  for (const e of exact) {
    if (workAuthorQids(e).some(a => workAuthorMatches(parts.author, authors?.entities?.[a]))) return { qid: e.id, entity: e };
  }
  return null;
}

// ═══════════════════════════════════════════
// CONSOLIDATED HELPERS
// ═══════════════════════════════════════════


// Resolve the authoritative labels of a cluster: local label files first,
// HTTP fallback second. Fills cl.{de,fr,en,es} in place; async fallbacks
// are queued onto `promises`. `onLobid` receives the raw Lobid record when
// the DE fallback loaded it. opts.overwriteDE: true on the NS-local path,
// where the authoritative GND label replaces the MARC term. Shared by
// three places of reconcile().
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
      }).catch(noteFail(opts.fails, 'GND')));
    }
  }
  if (!cl.fr && cluster.bnf) {
    const bi = clId(cluster.bnf);
    const localFR = getAuthLabel('bnf', bi);
    if (localFR) cl.fr = localFR;
    else promises.push(fetchBnfLabelRemote(bi, opts.fails).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; }));
  }
  if (!cl.en && cluster.lcsh) {
    const li = clId(cluster.lcsh);
    const localEN = getAuthLabel('lcsh', li);
    if (localEN) cl.en = localEN;
    else promises.push(fetchLCSH(li, opts.fails).then(h => { if (h && !cl.en) cl.en = h; }).catch(() => {}));
  }
  if (!cl.es && cluster.bne) {
    const bi = clId(cluster.bne);
    const localES = getAuthLabel('bne', bi);
    if (localES) cl.es = localES;
    else promises.push(fetchBNE(bi).then(lb => { if (lb && !cl.es) cl.es = lb; }).catch(() => {}));
  }
}

// Load a Wikidata entity (EC-cached): the worker resolves it from the QID
// (the content script never ships entity objects).
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
  const k = rck(term, gndId, idrefId, vocabSource, termType);
  if (RC.has(k)) {
    const cached = RC.get(k);
    // If termType was not set before but is now provided, update it
    if (termType && !cached.termType) cached.termType = termType;
    return cached;
  }
  await ensureLabels();
  let qid = null, entity = null, route = [], nsData = null, dewey = null;
  let viaText = false;                 // qid found by the WD text search
  let wdMatch = null, wdDiscarded = null; // verdict + rejected candidate
  let nsClusterGrade = null; // 1-4 grade from pre-computed cluster, null if no NS anchor found
  let nsAmbiguity = null;
  const cl = {};
  const homeLang = VOCAB_LANG[vocabSource] || null;
  if (homeLang) cl[homeLang] = term;
  // The controlled label of a work is its title — the
  // author has a chip of its own; «Author: Title» put the author in every
  // search of the work. The full heading stays the term (author check).
  if (homeLang && termType === 'work') { const p = splitWorkHeading(term); if (p) cl[homeLang] = p.title; }
  let lobidData = null, idrefData = null;
  let idrefTwin = null;   // IdRef id reached through the BnF ark (link only)
  let idrefWd = null;     // The IdRef id chosen among several of the Wikidata item
  const fails = new Set(); // Services that did not answer (time-out, server error)

  // ── Local lookup: stable MARC identifiers outrank lexical labels ──
  {
    const idLookup = identifierCandidates(gndId, idrefId);
    const chosen = chooseLocalCandidate(idLookup.candidates, idLookup.authority, term, { gnd: gndId, idref: idrefId });
    nsAmbiguity = chosen.ambiguous;
    // A label alone may anchor only a topic or a place to the
    // thesaurus. A person, body, meeting, work, period or form that merely
    // shares its wording with a topical concept is not that concept.
    const lexicalOk = !termType || termType === 'topic' || termType === 'place';
    const ns = chosen.concept || ((!gndId && !idrefId && lexicalOk) ? nsLookup(term) : null);
    if (ns) {
      nsData = makeNsData(ns);
      cl.it = ns.l;
      // Use pre-computed cluster (replaces old mx-based approach)
      const cluster = ns.cl || {};
      nsClusterGrade = clGrade(cluster); // capture cluster confidence grade
      // Reached through a secondary mapping — the record's GND id is
      // declared for this concept but is not the one holding its GND slot.
      const recordGndId = gndId;
      const viaSecondary = Boolean(chosen.concept && recordGndId && cluster.gnd && clId(cluster.gnd) !== recordGndId);
      route.push(chosen.concept ? (viaSecondary ? 'ID→NS-local(secondary)' : 'ID→NS-local') : 'NS-local');

      // GND from cluster
      if (cluster.gnd && !gndId) { gndId = clId(cluster.gnd); route.push('NS→GND'); }

      // QID from cluster
      if (cluster.wd) { qid = clId(cluster.wd); route.push('NS→WD'); }

      // Authoritative labels: local files first, HTTP fallback (consolidated)
      const labelPromises = [];
      // The German form comes from the cluster's GND term only when that IS the
      // record's term; otherwise the cataloguer's form (e.g. Seelengewinnung,
      // not the slot holder Evangelisation) is kept for display and searches.
      queueClusterLabels(cluster, cl, gndId, labelPromises,
        ld => { lobidData = ld; }, { overwriteDE: !viaSecondary, fails });
      if (labelPromises.length) await Promise.all(labelPromises);

      // If no QID yet, try the Wikidata backlinks for EVERY authority ID
      // the record or the cluster provides — not only GND/P227 (clusters
      // without GND and without a precomputed QID would otherwise fall
      // through to the text search).
      if (!qid) {
        qid = await qidViaBacklinks({
          gnd: gndId,
          idref: idrefId || clId(cluster.idref),
          lcsh: clId(cluster.lcsh),
          bnf: clId(cluster.bnf),
          bne: clId(cluster.bne),
        }, route, fails);
      }

      // Use WD as hub to discover missing IDs for authoritative labels
      if (qid && (!cl.de || !cl.fr || !cl.en || !cl.es)) {
        // Load entity to discover IDs
        if (!entity) {
          try {
            const d = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
            if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
          } catch (e) { logDebug('net fallback', e); noteFail(fails, 'Wikidata')(e); }
        }
        if (entity) {
          const hubPromises = [];
          // The ids Wikidata gives are looked up in the local label
          // files first (as for the cluster's own ids); the network only for
          // labels the files lack. Fotografie (NS 1578) waited 6 s for
          // data.bnf.fr and lost «Photographie», which the local table has.
          // Discover GND via P227 if missing
          if (!cl.de) {
            const gi = getClaim(entity, 'P227');
            const localDE = gi ? getAuthLabel('gnd', gi) : null;
            if (localDE) cl.de = localDE;
            else if (gi) hubPromises.push(lobid(gi).then(ld => { if (ld?.preferredName) { lobidData = ld; cl.de = ld.preferredName; } }).catch(noteFail(fails, 'GND')));
          }
          // Discover RAMEAU via P268 (or IdRef via P269) if FR is missing —
          // The hub previously recovered DE/EN/ES but skipped French.
          if (!cl.fr) {
            const bi = getClaim(entity, 'P268');
            const ii = getClaim(entity, 'P269');
            const localFR = bi ? getAuthLabel('bnf', 'cb' + bi) : null;
            if (localFR) cl.fr = localFR;
            else if (bi) hubPromises.push(fetchBnfLabelRemote('cb' + bi, fails).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; }).catch(() => {}));
            else if (ii) hubPromises.push(idrefSolr(ii).then(doc => { if (doc?.affcourt_z && !cl.fr) cl.fr = doc.affcourt_z; }).catch(noteFail(fails, 'IdRef')));
          }
          // Discover LCSH via P244 if missing
          if (!cl.en) {
            const li = getClaim(entity, 'P244');
            const localEN = li ? getAuthLabel('lcsh', li) : null;
            if (localEN) cl.en = localEN;
            else if (li) hubPromises.push(fetchLCSH(li, fails).then(h => { if (h) cl.en = h; }).catch(() => {}));
          }
          // Discover BNE via P950 if missing
          if (!cl.es) {
            const bi = getClaim(entity, 'P950');
            const localES = bi ? getAuthLabel('bne', bi) : null;
            if (localES) cl.es = localES;
            else if (bi) hubPromises.push(fetchBNE(bi).then(lb => { if (lb) cl.es = lb; }).catch(() => {}));
          }
          await Promise.all(hubPromises);
        }
      }
    }
  }

  // ── GND path (non-SBT terms): try reverse index first, then WD ──
  if (!nsData && gndId) {
    // Try direct reverse lookup by GND ID (instant, no API call)
    const nsFromGnd = nsAmbiguity ? null : nsLookupByGnd(gndId);
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
    // Names (1xx/7xx) can carry BOTH a GND and an IdRef ID — try
    // both backlinks here, not only P227.
    if (!qid) {
      qid = await qidViaBacklinks({ gnd: gndId, idref: idrefId }, route, fails);
    }
    if (!qid || !cl.de) {
      // Use enhanced Lobid resolution (extracts sameAs with WD, VIAF, BnF)
      const lobidRes = await resolveViaLobid(gndId, fails);
      if (lobidRes) {
        lobidData = lobidRes.lobidData;
        if (!cl.de) cl.de = lobidRes.label;
        route.push('Lobid:' + gndId);
        // Use Lobid sameAs to discover QID and BnF
        if (!qid && lobidRes.wikidataId) { qid = lobidRes.wikidataId; route.push('Lobid→WD'); }
        // If Lobid has BnF ARK, try to get French label via consolidated helper
        if (!cl.fr && lobidRes.bnfArk) {
          const lbl = await fetchBnfLabelRemote(lobidRes.bnfArk, fails);
          if (lbl) { cl.fr = lbl; route.push('Lobid→BnF'); }
        }
        // Fallback: WD via VIAF if still no QID
        if (!qid && lobidRes.viafId) {
          try {
            const wr = await sparql(WD_SPARQL, WD_PREFIXES + 'SELECT ?i WHERE{?i wdt:P214 ' + sparqlLiteral(lobidRes.viafId) + '}LIMIT 1');
            if (wr?.results?.bindings?.length) { qid = wr.results.bindings[0].i.value.split('/').pop(); route.push('VIAF\u2192WD'); }
          } catch (e) { logDebug('net fallback', e); noteFail(fails, 'Wikidata')(e); }
        }
      }
    }
  }

  // ── IdRef path ──
  if (!nsData && idrefId) {
    // Step 1: direct reverse lookup by IdRef PPN (instant, no network)
    const nsFromIdref = nsAmbiguity ? null : nsLookupByIdref(idrefId);
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
    const solrRes = await resolveViaIdRefSolr(idrefId, fails);
    if (solrRes) {
      // The type CODE; the content script names it in the
      // interface language (the Italian description showed in every language).
      route.push('IdRefSolr:' + idrefId + '(' + (solrRes.type || '') + ')');
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

    // Step 2b: resolve WD via the IdRef PPN backlink (P269) —
    // mirrors the GND path's P227 lookup. Without this, records carrying
    // only an IdRef ID fell through to the error-prone text search even
    // when Wikidata holds the exact backlink (e.g. the place heading
    // "Suisse" matched the French commune Q22036 instead of Q39).
    if (!qid) {
      qid = await qidViaBacklinks({ idref: idrefId }, route, fails);
    }

    // Step 3: load full IdRef JSON for hierarchy data (only if still no QID)
    if (!qid || !idrefData) {
      try {
        const ir = await idrefJSON(idrefId);
        if (ir) { idrefData = ir; route.push('IdRef:' + idrefId); }
      } catch (e) { logDebug('net fallback', e); noteFail(fails, 'IdRef')(e); }
    }

    // Step 3c: mine co-references from the IdRef record —
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
        qid = await qidViaBacklinks(corefs, route, fails);
      }
    }
  }

  // ── No NS SPARQL fallback ──
  // The local unified index contains the complete NS vocabulary.
  // If nsLookup() didn't find the term, it either doesn't exist in NS
  // or is misspelled — in both cases the remote SPARQL would not help
  // and only adds ~500ms-1s latency per term.

  // ── Text fallback (WD) ──
  // Never for a form/genre or a period — a guess on "Festschrift" or
  // "Geschichte 1921-2012" adds noise, not information.
  // A work goes its own way (bestWorkCandidate: title + author).
  if (!qid && termType === 'work' && splitWorkHeading(term)) {
    route.push('WD-text');
    try {
      const candidate = await bestWorkCandidate(term, VOCAB_LANG[vocabSource] || 'it');
      if (candidate) {
        qid = candidate.qid;
        entity = candidate.entity;
        EC.set(qid, entity);
        viaText = true;
      }
    } catch (e) { logDebug('net fallback', e); noteFail(fails, 'Wikidata')(e); }
  }
  if (!qid && termType !== 'form' && termType !== 'period' && termType !== 'work') {
    route.push('WD-text');
    let searchTerm = term, searchLang = 'it';
    if (cl.fr && vocabSource === 'idref') { searchTerm = cl.fr; searchLang = 'fr'; }
    else if (cl.de && vocabSource === 'gnd') { searchTerm = cl.de; searchLang = 'de'; }
    else if (cl.it) { searchTerm = cl.it; }
    if (searchTerm.includes(',')) searchTerm = invertName(searchTerm);
    else searchTerm = cleanName(searchTerm);
    try {
      const candidate = await bestWikidataTextCandidate(searchTerm, searchLang, termType, gndId, idrefId);
      if (candidate) {
        qid = candidate.qid;
        entity = candidate.entity;
        EC.set(qid, entity);
        viaText = true;
      }
    } catch (e) { logDebug('net fallback', e); noteFail(fails, 'Wikidata')(e); }
  }

  // ── Load WD entity ──
  if (qid) {
    if (entity) { EC.set(qid, entity); }
    else if (EC.has(qid)) { entity = EC.get(qid); }
    else {
      try {
        const d = await fetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims|aliases&format=json&origin=*');
        if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
      } catch (e) { logDebug('net fallback', e); noteFail(fails, 'Wikidata')(e); }
    }
  }
  // ── validate candidates found via the text fallback ──
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
    const typeCompatibility = entityTypeCompatible(termType, entity);
    const sharesId = (gndId && eGnd && String(eGnd) === String(gndId))
                  || (idrefId && eIdref && String(eIdref) === String(idrefId));
    if (sharesId) {
      wdMatch = 'confirmed';
    } else if (typeCompatibility === false || (termType === 'person' && !personNameMatches(term, entity))) {
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
    // A QID found only by the text search and not confirmed by a
    // shared authority ID is a hypothesis — it must not anchor the record to
    // a thesaurus concept, neither directly nor through the entity's claims.
    const trustedWd = !viaText || wdMatch === 'confirmed';
    let nsReverse = null;
    if (qid && trustedWd) nsReverse = nsLookupByQid(qid);
    if (!nsReverse && gndId) nsReverse = nsLookupByGnd(gndId);
    if (!nsReverse && idrefId) nsReverse = nsLookupByIdref(idrefId);
    if (!nsReverse && entity && trustedWd) {
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
      queueClusterLabels(cluster, cl, gndId, reversePromises, ld => { lobidData = ld; }, { fails });
      if (reversePromises.length) await Promise.all(reversePromises);
    }
  }

  // ── exact links outside NS ──
  // A GND or IdRef heading without an NS concept gets the headings of the
  // other vocabularies that the sources declare exact (generator file
  // exact_links.json), from the local label files: authority wordings
  // instead of nothing, and also when Wikidata does not answer. Only the
  // languages still missing; the record's own wording stays.
  if (!nsData && !['person', 'corporate', 'meeting'].includes(termType)) {
    const vocab = vocabSource === 'gnd' ? 'gnd' : vocabSource === 'idref' ? 'idref' : null;
    const links = vocab ? await getExactLinks(vocab, vocab === 'gnd' ? gndId : idrefId) : null;
    if (links) {
      let added = 0;
      for (const [auth, lang] of [['gnd', 'de'], ['bnf', 'fr'], ['lcsh', 'en'], ['bne', 'es']]) {
        const lbl = links[auth] && !cl[lang] ? getAuthLabel(auth, links[auth]) : null;
        if (lbl) { cl[lang] = lbl; added++; }
      }
      if (added) route.push('exact-links');
    }
  }

  // ── Enrichment for places/persons: use WD entity to fill missing authoritative labels ──
  // Only for terms that are NOT thesaurus concepts (no nsData) but have a WD entity,
  // AND whose termType is explicitly an authority entity type from MARC.
  // This avoids false positives from the WD text fallback on misspelled thesaurus terms.
  if (!nsData && entity && ['place', 'person', 'corporate', 'meeting'].includes(termType)) {
    const enrichPromises = [];
    let enrichedLocally = false;   // Local label files first
    // GND label via Lobid (only if cl.de is still empty)
    if (!cl.de) {
      const gi = gndId || getClaim(entity, 'P227');
      const localDE = gi ? getAuthLabel('gnd', gi) : null;
      if (localDE) { cl.de = localDE; enrichedLocally = true; }
      else if (gi) {
        enrichPromises.push(
          lobid(gi).then(ld => {
            if (ld?.preferredName) { if (!lobidData) lobidData = ld; if (!cl.de) cl.de = ld.preferredName; }
          }).catch(noteFail(fails, 'GND'))
        );
      }
    }
    // Wikidata gives more than one IdRef id (Italia: the State
    // as a body, 026389908, type b, before the place, 027235408, type c). The
    // one of the heading's kind is chosen, all asked in one request; if none
    // or several fit, the first, as before. Its label fills the IdRef card.
    const wdIdrefs = idrefId ? [] : getClaims(entity, 'P269');
    if (wdIdrefs.length > 1) {
      enrichPromises.push(
        idrefSolrMany(wdIdrefs).then(docs => {
          const fit = docs.filter(d => d.recordtype_z === IDREF_KIND[termType]);
          const doc = fit.length === 1 ? fit[0] : docs.find(d => d.ppn_z === String(wdIdrefs[0]));
          if (doc) { idrefWd = doc.ppn_z; if (doc.affcourt_z && !cl.fr) cl.fr = doc.affcourt_z; }
        }).catch(noteFail(fails, 'IdRef'))
      );
    } else if (!cl.fr) {
    // IdRef/FR label via IdRef Solr (only if cl.fr is still empty)
      const ii = idrefId || getClaim(entity, 'P269');
      // (only for an item reached through an id, never a text-search hypothesis)
      const bi = ii || wdMatch === 'unverified' ? null : getClaim(entity, 'P268');
      if (ii) {
        enrichPromises.push(
          resolveViaIdRefSolr(ii, fails).then(solr => {
            if (solr?.label && !cl.fr) cl.fr = solr.label;
          }).catch(() => {})
        );
      } else if (bi) {
        // No IdRef id in Wikidata, but the BnF ark — its IdRef
        // twin (GND Europa: Q46 has only the ark → IdRef «Europe»).
        enrichPromises.push(
          idrefSolrByArk('cb' + String(bi).replace(/^cb/, '')).then(doc => {
            if (doc?.affcourt_z && !cl.fr) { cl.fr = doc.affcourt_z; idrefTwin = doc.ppn_z || null; }
          }).catch(noteFail(fails, 'IdRef'))
        );
      }
    }
    // EN label via LCSH (only if cl.en is still empty)
    if (!cl.en) {
      const li = getClaim(entity, 'P244');
      const localEN = li ? getAuthLabel('lcsh', li) : null;
      if (localEN) { cl.en = localEN; enrichedLocally = true; }
      else if (li) {
        enrichPromises.push(
          fetchLCSH(li, fails).then(h => { if (h && !cl.en) cl.en = h; }).catch(() => {})
        );
      }
    }
    // ES label via BNE (only if cl.es is still empty)
    if (!cl.es) {
      const bi = getClaim(entity, 'P950');
      const localES = bi ? getAuthLabel('bne', bi) : null;
      if (localES) { cl.es = localES; enrichedLocally = true; }
      else if (bi) {
        enrichPromises.push(
          fetchBNE(bi).then(lb => { if (lb && !cl.es) cl.es = lb; }).catch(() => {})
        );
      }
    }
    if (enrichPromises.length || enrichedLocally) {
      route.push('enrich-' + termType);
      await Promise.all(enrichPromises);
    }
  }

  // The note of the record's own vocabulary — GND definition
  // under a GND heading, RAMEAU note under an IdRef heading. The NS scope
  // note belongs to NS headings only (the card decides).
  let authNote = null;
  if (vocabSource === 'gnd' && gndId) {
    const text = await getAuthNote('gnd', gndId);
    if (text) authNote = { src: 'gnd', text };
  } else if (vocabSource === 'idref' && idrefId) {
    await ensureLabels(['fr']);   // the RAMEAU/IdRef table maps the PPN to its ark
    const ark = rameauArkByPpn(idrefId);
    const text = ark ? await getAuthNote('rameau', ark) : null;
    if (text) authNote = { src: 'rameau', text };
  }
  const result = { qid, entity, route, nsData, dewey, controlledLabels: cl, vocabSource: vocabSource || null, lobidData, idrefData, termType: termType || null, gndId: gndId || null, idrefId: idrefId || null, nsClusterGrade, nsAmbiguity, wdMatch, wdDiscarded, authNote, idrefTwin, idrefWd,
    netFail: fails.size ? [...fails].sort() : null };
  // A result with a service that did not answer is not kept:
  // the next record asks again (GND Italien stayed without its French form
  // for the whole session after an IdRef time-out).
  if (!fails.size) RC.set(k, result);
  return result;
}

// ═══════════════════════════════════════════
// HIERARCHY (with NS local index)
// ═══════════════════════════════════════════
const HIER_TYPE_ORDER = { bt: 0, nt: 1, rt: 2 };
export function sortHierarchyNodes(nodes) {
  const rank = n => n.nsTid ? 0 : (n.srcs.includes('GND') || n.srcs.includes('IdRef')) ? 1 : n.srcs.includes('AAT') ? 2 : 3;
  const nLangs = n => Object.values(n.langs || {}).filter(Boolean).length;
  return nodes.sort((a, b) => ((HIER_TYPE_ORDER[a.type] ?? 3) - (HIER_TYPE_ORDER[b.type] ?? 3))
    || (rank(a) - rank(b)) || (nLangs(b) - nLangs(a)));
}

// The network parts of the Navigate hierarchies — Wikidata
// subclasses (P279) and the AAT hierarchy — asked for SEVERAL terms in one
// query and kept per term (first 20 rows, as the single-term LIMIT 20 did).
// When the subjects are ready the content script has every Navigate term
// prepared at once (prefetchHierarchies): one query to Wikidata and one to
// Getty for the whole record, instead of two queries at each change of term.
// A batch that fails leaves nothing behind: the term is asked again alone.
const WD_SUB_ROWS = new LRUMap(500), WD_SUB_PENDING = new Map();
const AAT_ROWS = new LRUMap(500), AAT_PENDING = new Map();

async function batchRows(cache, pending, keys, ask, groupVar, rank) {
  const fresh = [...new Set(keys)].filter(key => !cache.has(key) && !pending.has(key));
  if (fresh.length) {
    const job = (async () => {
      try {
        const r = await ask(fresh);
        const by = new Map(fresh.map(key => [key, []]));
        for (const b of r?.results?.bindings || []) {
          const rows = by.get(String(b[groupVar]?.value || '').split('/').pop());
          if (rows) rows.push(b);
        }
        for (const [key, rows] of by) {
          if (rank) rows.sort((x, y) => { const a = rank(x), b = rank(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; });
          cache.set(key, rows.slice(0, 20));
        }
      } catch (e) {
        logDebug('hierarchy batch', e);
      } finally {
        for (const key of fresh) pending.delete(key);
      }
    })();
    for (const key of fresh) pending.set(key, job);
  }
  await Promise.all(keys.map(key => pending.get(key)).filter(Boolean));
  return keys.map(key => cache.get(key) || null);
}

export function wdSubclassQuery(qids) {
  return WD_PREFIXES + 'SELECT ?q ?type ?item ?lIt ?lDe ?lFr ?lEn WHERE{VALUES ?q{' + qids.map(q => 'wd:' + q).join(' ')
    + '}{BIND("bt" AS ?type)?q wdt:P279 ?item}UNION{BIND("nt" AS ?type)?item wdt:P279 ?q}'
    + 'OPTIONAL{?item rdfs:label ?lIt FILTER(LANG(?lIt)="it")}OPTIONAL{?item rdfs:label ?lDe FILTER(LANG(?lDe)="de")}'
    + 'OPTIONAL{?item rdfs:label ?lFr FILTER(LANG(?lFr)="fr")}OPTIONAL{?item rdfs:label ?lEn FILTER(LANG(?lEn)="en")}}';
}
// Which 20 subclasses when there are more (Architettura: 144): broader terms
// first (they were at risk of being cut), then items of an NS concept, then
// those with more languages, then the lowest number — the same on every
// engine (the single-term LIMIT 20 kept whatever came first).
function wdRowRank(b) {
  const q = String(b.item?.value || '').split('/').pop();
  return [b.type?.value === 'bt' ? 0 : 1, nsLookupByQid(q) ? 0 : 1,
    -['lIt', 'lDe', 'lFr', 'lEn'].filter(v => b[v]?.value).length, parseInt(q.slice(1), 10) || 0];
}
function wdSubclassRows(qids) {
  return batchRows(WD_SUB_ROWS, WD_SUB_PENDING, qids.filter(q => /^Q\d{1,12}$/.test(q)), qs => sparql(WD_SPARQL, wdSubclassQuery(qs)), 'q', wdRowRank);
}

const AAT_LABEL = (v, lang) => 'OPTIONAL{?uri xl:prefLabel ?xl' + v + '.?xl' + v + ' dct:language <http://vocab.getty.edu/aat/' + lang + '>;gvp:term ?label' + v + '}';
export function aatHierarchyQuery(ids) {
  const labels = '?uri xl:prefLabel ?xlEn.?xlEn dct:language <http://vocab.getty.edu/aat/300388277>;gvp:term ?labelEn.'
    + AAT_LABEL('It', '300388474') + AAT_LABEL('De', '300388344') + AAT_LABEL('Fr', '300388306');
  return 'PREFIX gvp:<http://vocab.getty.edu/ontology#> PREFIX xl:<http://www.w3.org/2008/05/skos-xl#> PREFIX dct:<http://purl.org/dc/terms/> '
    + 'SELECT ?a ?type ?uri ?labelEn ?labelIt ?labelDe ?labelFr WHERE{VALUES ?a{'
    + ids.map(id => '<http://vocab.getty.edu/aat/' + id + '>').join(' ')
    + '}{BIND("bt" AS ?type)?a gvp:broaderGeneric ?uri.' + labels + '}UNION{BIND("nt" AS ?type)?uri gvp:broaderGeneric ?a.' + labels + '}}';
}
function aatHierarchyRows(ids) {
  return batchRows(AAT_ROWS, AAT_PENDING, ids.filter(id => /^\d{1,12}$/.test(String(id))), xs => sparql(AAT_SPARQL, aatHierarchyQuery(xs)), 'a');
}

// Content script, when the subjects are ready: every Navigate term of the
// record, with the parameters a click would use.
export async function prefetchHierarchies(terms) {
  const list = (terms || []).slice(0, 40);
  const qids = [...new Set(list.map(t => t.qid).filter(q => /^Q\d{1,12}$/.test(q || '')))];
  const chunks = xs => { const out = []; for (let i = 0; i < xs.length; i += 30) out.push(xs.slice(i, i + 30)); return out; };
  const wdJob = Promise.all(chunks(qids).map(wdSubclassRows));
  const ents = await Promise.all(qids.map(loadEntity));
  const aatIds = [...new Set(ents.map(e => (e ? getClaim(e, 'P1014') : null)).filter(Boolean).map(String))];
  const aatJob = Promise.all(chunks(aatIds).map(aatHierarchyRows));
  await Promise.all([wdJob, aatJob]);
  // Only the terms whose network parts arrived: after a failed batch the
  // click asks again, instead of N single queries now.
  const aatOf = new Map(qids.map((q, i) => [q, ents[i] ? getClaim(ents[i], 'P1014') : null]));
  const ready = list.filter(t => !t.qid || (WD_SUB_ROWS.has(t.qid) && (!aatOf.get(t.qid) || AAT_ROWS.has(String(aatOf.get(t.qid))))));
  await Promise.all(ready.map(t => getHierarchy(t.qid || null, t.nsUri || null, t.gndId || null, t.idrefId || null).catch(() => null)));
  return ready.length;
}

// A hierarchy being prepared (prefetchHierarchies) is awaited,
// not computed a second time.
const HIER_PENDING = new Map();
export function getHierarchy(qid, nsUri, gndId, idrefId) {
  const k = (qid || '') + '|' + (nsUri || '') + '|' + (gndId || '') + '|' + (idrefId || '');
  if (HC.has(k)) return Promise.resolve(HC.get(k));
  if (HIER_PENDING.has(k)) return HIER_PENDING.get(k);
  const job = computeHierarchy(k, qid, nsUri, gndId, idrefId).finally(() => HIER_PENDING.delete(k));
  HIER_PENDING.set(k, job);
  return job;
}

async function computeHierarchy(k, qid, nsUri, gndId, idrefId) {
  await Promise.all([
    gndId ? ensureHierarchy('gnd') : Promise.resolve(),
    idrefId ? ensureHierarchy('idref') : Promise.resolve(),
  ]);
  const nodes = [];
  // The term itself is never its own neighbour. A GND or
  // RAMEAU hierarchy read from another id of the same concept used to show
  // it as broader than itself (NS «Design» above «Design»).
  const selfTids = new Set([nsUri ? nsUri.split('/').pop() : null,
    gndId ? nsLookupByGnd(gndId)?.tid : null, idrefId ? nsLookupByIdref(idrefId)?.tid : null].filter(Boolean));
  const selfGnd = gndId, selfIdref = idrefId;

  function addNode(type, label, src, uri, langs, extras) {
    if ((extras?.nsTid && selfTids.has(extras.nsTid))
        || (extras?.gndId && extras.gndId === selfGnd)
        || (extras?.idrefId && extras.idrefId === selfIdref)) return;
    const stableId = extras?.nsTid ? 'ns:' + extras.nsTid
      : extras?.gndId ? 'gnd:' + extras.gndId
      : extras?.idrefId ? 'idref:' + extras.idrefId
      : uri ? 'uri:' + uri
      : 'label:' + label.toLowerCase();
    const identityKey = type + '|' + src + '|' + stableId;
    const ex = nodes.find(n => n.identityKey === identityKey);
    if (ex) {
      if (!ex.srcs.includes(src)) ex.srcs.push(src);
      if (langs) Object.entries(langs).forEach(([k, v]) => { if (v) ex.langs[k] = ex.langs[k] || v; });
      if (extras) { if (extras.gndId) ex.gndId = ex.gndId || extras.gndId; if (extras.idrefId) ex.idrefId = ex.idrefId || extras.idrefId; if (extras.nsTid) ex.nsTid = ex.nsTid || extras.nsTid; }
    } else {
      nodes.push({ type, label, srcs: [src], uri: uri || '', langs: langs || {}, gndId: extras?.gndId || null, idrefId: extras?.idrefId || null, nsTid: extras?.nsTid || null, identityKey });
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
        const cluster = own(nsIndex.concepts, relTid)?.cl || {};
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
            const deLabel = own(langLabels.de, relGndId);
            const langs = { it: nsConcept.l, de: deLabel || nsConcept.l };
            if (clLabels.fr) langs.fr = clLabels.fr;
            if (clLabels.en) langs.en = clLabels.en;
            addNode(type, nsConcept.l, 'GND', 'https://d-nb.info/gnd/' + relGndId, langs, { gndId: relGndId, nsTid: nsConcept.tid });
          } else {
            const deLabel = own(langLabels.de, relGndId);
            if (deLabel) addNode(type, deLabel, 'GND', 'https://d-nb.info/gnd/' + relGndId, { de: deLabel }, { gndId: relGndId });
          }
        });
      };
      addGndLocal('bt', localHier.bt);
      addGndLocal('nt', localHier.nt);
      addGndLocal('rt', localHier.rt);
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

  // IdRef hierarchy — from the RAMEAU/IdRef table: the NS
  // cluster's RAMEAU heading, else the RAMEAU twin of the PPN itself (also
  // for IdRef terms the NS does not have). IdRef API only when the table has
  // no hierarchy for it (places, names, terms of other thesauri).
  if (idrefId) {
    const idrefNsConcept = nsLookupByIdref(idrefId);
    const idrefBnfId = (idrefNsConcept?.cl?.bnf ? clId(idrefNsConcept.cl.bnf) : null) || rameauArkByPpn(idrefId);
    const localBnfHier = idrefBnfId ? getBnfBroaderNarrower(idrefBnfId) : null;

    if (localBnfHier) {
      const addBnfLocal = (type, ids) => {
        if (!ids) return;
        ids.forEach(relBnfId => {
          const relNsConcept = nsLookupByBnf(relBnfId);
          if (relNsConcept) {
            const cluster = relNsConcept.cl || {};
            const clLabels = resolveClusterLabels(cluster);
            const frLabel = getAuthLabel('bnf', relBnfId);
            const langs = { it: relNsConcept.l, fr: frLabel || relNsConcept.l };
            if (clLabels.de) langs.de = clLabels.de;
            if (clLabels.en) langs.en = clLabels.en;
            // IdRef ID from the cluster, else the twin from the table
            const relIdrefId = (relNsConcept.cl?.idref ? clId(relNsConcept.cl.idref) : null) || rameauPpn(relBnfId);
            const relUri = relIdrefId ? 'https://www.idref.fr/' + relIdrefId : '';
            addNode(type, relNsConcept.l, 'IdRef', relUri, langs, { idrefId: relIdrefId, nsTid: relNsConcept.tid });
          } else {
            const frLabel = getAuthLabel('bnf', relBnfId);
            // The neighbour keeps its IdRef id, so its link and
            // a further navigation stay in IdRef.
            const relIdrefId = rameauPpn(relBnfId);
            if (frLabel) addNode(type, frLabel, 'IdRef', relIdrefId ? 'https://www.idref.fr/' + relIdrefId : '',
              { fr: frLabel }, relIdrefId ? { idrefId: relIdrefId } : {});
          }
        });
      };
      addBnfLocal('bt', localBnfHier.bt);
      addBnfLocal('nt', localBnfHier.nt);
      addBnfLocal('rt', localBnfHier.rt);   // RAMEAU "voir aussi"
    } else {
      // Fallback: IdRef API (covers terms not in NS clusters or missing from the RAMEAU/IdRef table)
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

  // The Wikidata subclasses and the AAT hierarchy are asked
  // at the same time (they were asked one after the other: ~0.3 s + ~0.3 s
  // at every change of term in Navigate). The nodes are added in the same
  // order as before, AAT first, so the result does not change.
  const wdAsk = qid ? wdSubclassRows([qid]).then(x => x[0]) : Promise.resolve(null);
  // AAT hierarchy — the entity is resolved here (EC-cached): the content
  // script never ships entity objects across the bridge.
  const entity = qid ? await loadEntity(qid) : null;
  const aatId = entity ? getClaim(entity, 'P1014') : null;
  const aatAsk = aatId ? aatHierarchyRows([aatId]).then(x => x[0]) : Promise.resolve(null);
  const [aatRows, wdRows] = await Promise.all([aatAsk, wdAsk]);
  // A hierarchy missing a network part (query failed) is
  // shown but not kept: the next request asks again.
  const incomplete = (qid && !wdRows) || (aatId && !aatRows);
  {
    const r = aatRows ? { results: { bindings: aatRows } } : null;
    if (r?.results?.bindings) r.results.bindings.forEach(b => {
      const lbl = b.labelIt?.value || b.labelEn?.value || '';
      const langs = { en: b.labelEn?.value, it: b.labelIt?.value, de: b.labelDe?.value, fr: b.labelFr?.value };
      addNode(b.type.value, lbl, 'AAT', b.uri.value, langs);
    });
  }

  // WD hierarchy (P279) — match to NS cluster when possible
  {
    const r = wdRows ? { results: { bindings: wdRows } } : null;
    if (r?.results?.bindings) r.results.bindings.forEach(b => {
      const lbl = b.lIt?.value || b.lEn?.value || '';
      if (!lbl) return;
      const langs = { it: b.lIt?.value, de: b.lDe?.value, fr: b.lFr?.value, en: b.lEn?.value };
      const wdQid = b.item?.value?.split('/').pop() || null;
      const nsConcept = wdQid ? nsLookupByQid(wdQid) : null;
      if (nsConcept) {
        // An item of an NS concept shows the concept's
        // authority headings only, as when it is selected. The Wikidata labels
        // overrode them and filled the GND/IdRef cards: NS 11705 «Discipline
        // umanistiche» (no GND, no RAMEAU) showed «Humanities» and «humanités»
        // as GND and IdRef headings above Genealogia, and lost them once
        // selected. Wikidata labels still feed the searches (buildCatUrl).
        const cluster = nsConcept.cl || {};
        const authLangs = { ...resolveClusterLabels(cluster), it: nsConcept.l };
        addNode(b.type.value, nsConcept.l, 'WD', b.item.value, authLangs, { nsTid: nsConcept.tid });
      } else {
        addNode(b.type.value, lbl, 'WD', b.item.value, langs);
      }
    });
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
    } else fused.push({ ...n });
  }

  // Sort within types: NS concepts first, then GND/IdRef-only terms, then
  // AAT, then Wikidata-only; within each, the terms with more languages.
  // The comparator returned 0 across types, which is not a
  // consistent order — the broader terms came out in an arbitrary order
  // (Industrialisierung: NS-only and GND-only above the full clusters).
  sortHierarchyNodes(fused);

  if (!incomplete) HC.set(k, fused);
  return fused;
}
