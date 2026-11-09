// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 7/8): rendering and navigation
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// RENDERING (DOM-based, no innerHTML)
// ═══════════════════════════════════════════
function rBadges(e, q, ns, knownIds, wdMatch) {
  const container = el('span');
  const mkBadge = (info, v) => {
    const a = el('a', { href: info.u(v), target: '_blank', textContent: info.l + ':' + v });
    return el('span', { className: 'id ' + info.c }, a);
  };
  let nsBadge = null;
  if (ns) {
    if (ns.src === 'sbt') {
      const numId = ns.id.slice(4); // 'SBT_4405' → '4405'
      const a = el('a', { href: 'https://www2.sbt.ti.ch/soggettario/index.jsp?termine=' + numId, target: '_blank', textContent: 'SBT:' + numId });
      nsBadge = el('span', { className: 'id id-sbt' }, a);
    } else {
      const a = el('a', { href: ID_PROPS.P508.u(ns.id), target: '_blank', textContent: 'NS:' + ns.id });
      nsBadge = el('span', { className: 'id id-ns' }, a);
    }
  }

  // When the WD entity is an unconfirmed text match, split the
  // badges by provenance — IDs the record/thesauri vouch for vs IDs that
  // stand only on the Wikidata hypothesis (dashed group).
  if (wdMatch === 'unverified') {
    const rec = el('span');
    if (nsBadge) rec.appendChild(nsBadge);
    if (knownIds?.gndId) rec.appendChild(mkBadge(ID_PROPS.P227, knownIds.gndId));
    if (knownIds?.idrefId) rec.appendChild(mkBadge(ID_PROPS.P269, knownIds.idrefId));
    const hyp = el('span', { className: 'ids-hyp' });
    if (q) {
      const a = el('a', { href: 'https://www.wikidata.org/wiki/' + q, target: '_blank', textContent: q });
      hyp.appendChild(el('span', { className: 'id id-wd' }, a));
    }
    if (e) {
      for (const [p, info] of Object.entries(ID_PROPS)) {
        if (p === 'P508' && ns) continue;
        const v = getClaim(e, p);
        if (v) hyp.appendChild(mkBadge(info, v));
      }
    }
    if (rec.childNodes.length) {
      container.appendChild(el('span', { className: 'ids-glabel', textContent: L.idsFromRecord }));
      container.appendChild(rec);
    }
    if (hyp.childNodes.length) {
      container.appendChild(el('span', { className: 'ids-glabel', textContent: L.idsFromWd }));
      container.appendChild(hyp);
    }
    return container;
  }

  if (nsBadge) container.appendChild(nsBadge);
  if (q) {
    const a = el('a', { href: 'https://www.wikidata.org/wiki/' + q, target: '_blank', textContent: q });
    container.appendChild(el('span', { className: 'id id-wd' }, a));
  }
  // Track which IDs have been shown (from WD entity)
  const shownProps = new Set();
  if (e) {
    for (const [p, info] of Object.entries(ID_PROPS)) {
      if (p === 'P508' && ns) continue;
      const v = getClaim(e, p);
      if (v) {
        const a = el('a', { href: info.u(v), target: '_blank', textContent: info.l + ':' + v });
        container.appendChild(el('span', { className: 'id ' + info.c }, a));
        shownProps.add(p);
      }
    }
  }
  // Show MARC-known IDs that WD didn't have — or that DIFFER from the WD
  // claim: authorities may hold several PPNs for the same concept
  // (e.g. RAMEAU "Géographie" 027534510 vs the PPN Wikidata links,
  // 027534499). The record's own ID is the one the catalog actually uses,
  // so it must stay visible alongside the entity's.
  if (knownIds) {
    const claimIdref = e ? getClaim(e, 'P269') : null;
    if (knownIds.idrefId && (!shownProps.has('P269') || (claimIdref && String(claimIdref) !== String(knownIds.idrefId)))) {
      const info = ID_PROPS.P269;
      const a = el('a', { href: info.u(knownIds.idrefId), target: '_blank', textContent: info.l + ':' + knownIds.idrefId });
      container.appendChild(el('span', { className: 'id ' + info.c }, a));
    }
    const claimGnd = e ? getClaim(e, 'P227') : null;
    if (knownIds.gndId && (!shownProps.has('P227') || (claimGnd && String(claimGnd) !== String(knownIds.gndId)))) {
      const info = ID_PROPS.P227;
      const a = el('a', { href: info.u(knownIds.gndId), target: '_blank', textContent: info.l + ':' + knownIds.gndId });
      container.appendChild(el('span', { className: 'id ' + info.c }, a));
    }
  }
  return container;
}

function rDewey(d) {
  if (!d?.length) return null;
  const row = el('div', { className: 'ddc-row' });
  d.forEach(x => {
    row.appendChild(el('span', { className: 'ddc-num', textContent: 'DDC ' + x.number }));
    if (x.edition) row.appendChild(el('span', { className: 'ddc-label', textContent: 'ed.' + x.edition }));
  });
  return row;
}

function rLangs(entity, cl, vocabSource) {
  if (!entity && (!cl || !Object.keys(cl).length)) return null;
  const container = el('div', { className: 'langs' });
  const homeLang = VOCAB_LANG[vocabSource] || null;
  let hasAny = false;
  LANGS.forEach(l => {
    const c = cl?.[l];
    const w = entity ? getLabel(entity, l) : null;
    const lb = c || w;
    if (lb) {
      hasAny = true;
      const mark = (c && homeLang === l) ? ' \u2713' : '';
      const span = el('span', { className: 'lng' });
      span.appendChild(el('b', { textContent: l.toUpperCase() }));
      span.appendChild(txt(' ' + lb + mark));
      container.appendChild(span);
    }
  });
  return hasAny ? container : null;
}

// «IdRefSolr:<ppn>(<type code>)» → the IdRef type named in
// the interface language.
function routeLabel(r) {
  const m = /^(IdRefSolr:[^(]*)\((\w*)\)$/.exec(r);
  if (!m) return r;
  return m[1] + '(' + ((L.idrefTypes || {})[m[2]] || L.idrefTypeOther || m[2]) + ')';
}

// The line under the card header. NS heading: the term and,
// in another interface language, its translation «(FR: …)». GND or IdRef
// heading: the header already holds the record's term, so only the
// translation in the interface language, when it says something else —
// no longer the Italian NS label in bold (it stays in the IT language chip).
function cardTitle(vocabSource, term, nsLabel, iLang, iLabel) {
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  if (vocabSource === 'gnd' || vocabSource === 'idref') {
    return { main: null, translation: iLabel && !same(iLabel, term) ? iLabel : null };
  }
  const main = nsLabel || term;
  return { main, translation: iLang !== 'it' && iLabel && !same(iLabel, main) ? iLabel : null };
}

// Which notes a subject card shows — those of the heading's
// own vocabulary: NS scope note and definition under an NS heading, GND
// definition under a GND heading, RAMEAU note under an IdRef heading.
function cardNotes(vocabSource, nsData, authNote) {
  const out = [];
  const nsHeading = vocabSource !== 'gnd' && vocabSource !== 'idref';
  if (nsHeading && nsData?.scopeNote) out.push({ label: L.noteNS, text: nsData.scopeNote, lang: 'it', italic: true });
  if (nsHeading && nsData?.definition) out.push({ label: L.noteNSDef, text: nsData.definition, lang: 'it', italic: false });
  if (authNote?.src === 'gnd' && vocabSource === 'gnd') out.push({ label: L.noteGND, text: authNote.text, lang: 'de', italic: true });
  if (authNote?.src === 'rameau' && vocabSource === 'idref') out.push({ label: L.noteRAMEAU, text: authNote.text, lang: 'fr', italic: true });
  return out;
}

function rRoute(rt) {
  if (!rt.length) return null;
  const container = el('div', { className: 'route' });
  rt.forEach((r, i) => {
    if (i > 0) container.appendChild(txt(' \u2192 '));
    const c = r.startsWith('NS') ? 'p-ns' : r.includes('GND') ? 'p-gnd' : r.includes('IdRef') ? 'p-idr' : r.includes('AAT') ? 'p-aat' : 'p-wd';
    container.appendChild(el('span', { className: 'pill ' + c, textContent: routeLabel(r) }));
  });
  return container;
}

// Cards drawn for the current record, so that a heading
// confirmed by the record once every subject is ready can be drawn again.
const SN_CARDS = new Map();   // container → { args, result }
async function renderTermDetail(container, term, gndId, idrefId, vocabSource, termType) {
  clearEl(container);
  container.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.reconciling }));
  const result = await reconcile(term, gndId, idrefId, vocabSource, termType);
  SN_CARDS.set(container, { args: [term, gndId, idrefId, vocabSource, termType], result });
  const { qid, entity, route, nsData, dewey, controlledLabels: cl, nsClusterGrade } = result;
  clearEl(container);

  const det = el('div', { className: 'det' });
  const iLang = getInterfaceLang();
  const iLabel = cl[iLang] || (entity ? getLabel(entity, iLang) : null);
  const t = cardTitle(vocabSource, term, nsData?.label, iLang, iLabel);
  if (t.main || t.translation) {
    const titleDiv = el('div', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '2px' } });
    if (t.main) titleDiv.appendChild(txt(t.main));
    if (t.translation && t.main) {
      titleDiv.appendChild(txt(' '));
      titleDiv.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--sn-t2)' }, textContent: '(' + iLang.toUpperCase() + ': ' + t.translation + ')' }));
    } else if (t.translation) {
      titleDiv.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--sn-t2)' }, textContent: iLang.toUpperCase() + ': ' }));
      titleDiv.appendChild(txt(t.translation));
    }
    det.appendChild(titleDiv);
  }

  // Description: interface language only (an Italian or English description under a French interface confused more
  // than it helped; without one, nothing is shown).
  const desc = entity ? (getDesc(entity, iLang) || '') : '';
  if (desc) det.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--sn-t2)', marginBottom: '3px' }, textContent: desc }));

  // The note of the heading's own vocabulary, in its own
  // language, named by source: NS scope note under an NS heading only, GND
  // definition under a GND heading, RAMEAU note under an IdRef heading.
  // Under a GND or IdRef heading the NS note (another term's note, in
  // Italian) is no longer shown.
  const noteEl = (label, text, lang, italic) => {
    const d = el('div', { lang, style: { fontSize: '10px', color: 'var(--sn-t2)', marginTop: '2px', fontStyle: italic ? 'italic' : 'normal' } });
    d.appendChild(el('span', { style: { fontStyle: 'normal', fontWeight: '500' }, textContent: label + ': ' }));
    d.appendChild(txt(text));
    return d;
  };
  for (const n of cardNotes(vocabSource, nsData, result.authNote)) det.appendChild(noteEl(n.label, n.text, n.lang, n.italic));

  const routeEl = rRoute(route);
  if (routeEl) det.appendChild(routeEl);

  // Verdict for candidates found via the WD text fallback —
  // a discarded wrong match is explained, an unconfirmed one is flagged.
  if (result.wdMatch === 'conflict' && result.wdDiscarded) {
    det.appendChild(el('div', { className: 'match-note match-reject', role: 'note',
      textContent: '⚠ ' + L.wdRejected + ': «' + (result.wdDiscarded.label || result.wdDiscarded.qid) + '» (' + result.wdDiscarded.qid + ') — ' + L.wdRejectedWhy }));
  } else if (result.wdMatch === 'unverified') {
    det.appendChild(el('div', { className: 'match-note match-warn', role: 'note',
      textContent: '⚠ ' + L.wdUnverified + ' ' + L.wdUnverifiedSearch }));
  } else if (result.wdMatch === 'record' && result.wdConfirmedBy) {
    const c = result.wdConfirmedBy;
    det.appendChild(el('div', { className: 'match-note match-record', role: 'note',
      textContent: '✓ ' + (c.author ? L.wdRecordAuthor : L.wdRecord) + ': ' + c.vocab + ' «' + c.label + '» (' + c.id + ')' }));
  }
  // A service that did not answer (time-out, server error) —
  // what is missing may exist; the result is not kept, the next record asks again.
  if (result.netFail?.length) {
    det.appendChild(el('div', { className: 'match-note match-warn net-fail', role: 'note',
      textContent: '\u23F1 ' + L.netFail + ': ' + result.netFail.join(', ') + ' \u2014 ' + L.netFailWhy }));
  }
  if (result.nsAmbiguity?.candidates?.length) {
    det.appendChild(el('div', { className: 'match-note match-warn', role: 'note',
      textContent: '⚠ Ambiguous local mapping (' + result.nsAmbiguity.authority + '): '
        + result.nsAmbiguity.candidates.map(c => c.label + ' [' + c.tid + ']').join('; ') }));
  }

  // Cluster confidence grade (only when the term is anchored to an NS concept)
  if (nsClusterGrade && nsData) {
    const gradeColors = { 1: '#4caf50', 2: '#7cb342', 3: '#f57c00', 4: '#e53935' };
    const gradeHints = {
      1: 'Grado 1 – triangolazione completa (NS ↔ GND ↔ BnF)',
      2: 'Grado 2 – due thesauri si confermano',
      3: 'Grado 3 – evidenza debole, unidirezionale o solo hub esterno',
      4: 'Grado 4 – nessuna conferma inter-thesaurus'
    };
    const filled = 4 - (nsClusterGrade - 1);  // g1→4 dots, g4→1 dot
    const dots = '●'.repeat(filled) + '○'.repeat(4 - filled);
    det.appendChild(el('span', {
      className: 'cl-grade',
      title: gradeHints[nsClusterGrade] || '',
      style: {
        display: 'inline-block',
        fontSize: '9px',
        color: gradeColors[nsClusterGrade] || 'var(--sn-t2)',
        marginTop: '2px',
        marginBottom: '1px',
        letterSpacing: '2px',
        cursor: 'help'
      },
      textContent: dots + ' g' + nsClusterGrade
    }));
  }

  const badges = rBadges(entity, qid, nsData, { idrefId: idrefId || null, gndId: gndId || null }, result.wdMatch);
  if (badges.childNodes.length) {
    const idsDiv = el('div', { className: 'ids' });
    idsDiv.appendChild(badges);
    det.appendChild(idsDiv);
  }

  // DDC: prefer NS, fallback WD
  if (nsData?.ddc) {
    const ddcRow = el('div', { className: 'ddc-row' });
    ddcRow.appendChild(el('span', { className: 'ddc-num', textContent: 'DDC ' + nsData.ddc }));
    ddcRow.appendChild(el('span', { className: 'ddc-label', textContent: '(NS)' }));
    det.appendChild(ddcRow);
  } else if (dewey) {
    const ddcEl = rDewey(dewey);
    if (ddcEl) det.appendChild(ddcEl);
  }

  const langsEl = rLangs(entity, cl, vocabSource);
  if (langsEl) det.appendChild(langsEl);

  if (!entity && !nsData) det.appendChild(el('div', { className: 'empty', textContent: L.notFound }));

  const unverifiedWd = result.wdMatch === 'unverified';
  const searchEntity = unverifiedWd ? null : entity;
  const searchLabels = unverifiedWd ? { record: term } : cl;
  const catUrlSub = buildCatUrl(searchEntity, nsData?.label || (unverifiedWd ? term : null), searchLabels, 'subject');
  const catUrlAny = buildCatUrl(searchEntity, nsData?.label || (unverifiedWd ? term : null), searchLabels, 'broad');
  if (catUrlSub) {
    const acts = el('div', { className: 'acts' });
    const btn1 = el('button', { className: 'act act-pri', 'data-action': 'openurl', 'data-url': catUrlSub, textContent: L.search });
    const btn2 = el('button', { className: 'act', 'data-action': 'openurl', 'data-url': catUrlAny, textContent: L.searchBroad });
    acts.appendChild(btn1);
    acts.appendChild(btn2);
    det.appendChild(acts);
  }

  container.appendChild(det);
  return result;
}

// ═══════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════
let navState = { history: [], currentIndex: -1 };
function navPush(l, q, e, u, gi, ii, sel) {
  if (navState.currentIndex < navState.history.length - 1) navState.history = navState.history.slice(0, navState.currentIndex + 1);
  navState.history.push({ label: l, qid: q, entity: e, nsUri: u, gndId: gi || null, idrefId: ii || null, sel: sel || null });
  navState.currentIndex = navState.history.length - 1;
}
function getGndFromEntity(e) { return e ? getClaim(e, 'P227') : null; }
function getIdrefFromEntity(e) { return e ? getClaim(e, 'P269') : null; }

async function drill(label, nodeGndId, nodeIdrefId) {
  const navEl = byId('sn-navTree');
  if (!navEl) return;
  clearEl(navEl);
  navEl.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: label }));
  const r = await safeReconcile(label, nodeGndId || null, nodeIdrefId || null, nodeGndId ? 'gnd' : nodeIdrefId ? 'idref' : null);
  // The node's own ids first, Wikidata only when confirmed.
  const id = navIdentity(r);
  let gi = nodeGndId || id.gi || (r.lobidData ? r.lobidData.gndIdentifier : null);
  let ii = nodeIdrefId || id.ii;
  if (!id.u && !gi && !ii) { const rec = recoverAuthIds(label, id.q, gi, ii); gi = rec.gi; ii = rec.ii; }
  navPush(label, id.q, id.e, id.u, gi, ii, r);
  const h = await getHierarchy(id.q, id.e, id.u, gi, ii);
  rDynHier(byId('sn-navTree'), h, label, id.q, id.e, gi, ii, r);
}

async function navTo(idx) {
  if (idx < 0 || idx >= navState.history.length) return;
  navState.currentIndex = idx;
  const e = navState.history[idx];
  const navEl = byId('sn-navTree');
  if (!navEl) return;
  clearEl(navEl);
  navEl.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.loading }));
  const h = await getHierarchy(e.qid, e.entity, e.nsUri, e.gndId, e.idrefId);
  rDynHier(navEl, h, e.label, e.qid, e.entity, e.gndId, e.idrefId, e.sel);
}

function rBreadcrumb() {
  if (navState.history.length <= 1) return null;
  const bc = el('div', { className: 'breadcrumb' });
  navState.history.forEach((e, i) => {
    if (i > 0) bc.appendChild(el('span', { className: 'bc-sep', textContent: '\u25B8' }));
    const cur = i === navState.currentIndex;
    if (cur) {
      bc.appendChild(el('span', { className: 'bc-item current', textContent: e.label }));
    } else {
      bc.appendChild(el('span', { className: 'bc-item', 'data-action': 'navto', 'data-idx': String(i),
        role: 'button', tabindex: '0', 'aria-label': L.navigate + ': ' + e.label,
        textContent: e.label }));
    }
  });
  return bc;
}

// Forms and ids of the record's GND and IdRef headings worded like `title`
// (and leading to the same NS concept as `base`), for the SELECTED card.
function recordHeadingForms(title, base) {
  const out = { labels: {}, gndId: null, idrefId: null };
  const prefix = String(title || '').toLowerCase().trim() + '|';
  const baseNs = base?.nsData?.id || null;
  for (const [k, r] of RC.entries()) {
    if (!k.startsWith(prefix) || !r) continue;
    if ((r.nsData?.id || null) !== baseNs) continue;
    const cl = r.controlledLabels || {};
    if (r.vocabSource === 'gnd' && cl.de && !out.labels.de) { out.labels.de = cl.de; out.gndId = r.gndId || null; }
    if (r.vocabSource === 'idref' && cl.fr && !out.labels.fr) { out.labels.fr = cl.fr; out.idrefId = r.idrefId || null; }
  }
  return out;
}

function rDynHier(container, nodes, curTitle, qid, entity, navGndId, navIdrefId, selected) {
  // A Wikidata/AAT term without an Italian, German or
  // French label is not drawn — three empty cards with only «en …» below.
  const drawn = n => n.nsTid || (n.srcs || []).some(s => s === 'NS' || s === 'GND' || s === 'IdRef')
    || n.langs?.it || n.langs?.de || n.langs?.fr;
  const bt = nodes.filter(n => n.type === 'bt' && drawn(n));
  const nt = nodes.filter(n => n.type === 'nt' && drawn(n));
  const rt = nodes.filter(n => n.type === 'rt' && drawn(n));
  clearEl(container);

  const bcEl = rBreadcrumb();
  if (bcEl) container.appendChild(bcEl);

  // ── Helper: build a vocab card (NS/GND/IdRef) inside a cluster row ──
  function vocabCard(vocabLabel, cssClass, label) {
    const card = el('div', { className: 'vc ' + cssClass });
    card.appendChild(el('div', { className: 'vc-tag', textContent: vocabLabel }));
    if (label) {
      card.appendChild(el('div', { className: 'vc-lbl', textContent: label }));
    } else {
      card.appendChild(el('div', { className: 'vc-lbl vc-empty', textContent: '\u2014' }));
    }
    return card;
  }

  // ── Helper: secondary lang chips (EN, ES — not NS/GND/IdRef) ──
  function langChips(n) {
    const chips = [];
    if (n.langs.en) chips.push({ k: 'en', v: n.langs.en });
    if (n.langs.es) chips.push({ k: 'es', v: n.langs.es });
    if (!chips.length) return null;
    const row = el('div', { className: 'vc-langs' });
    chips.forEach(c => {
      row.appendChild(el('span', { className: 'vc-lang', textContent: c.k + ' ' + c.v }));
    });
    return row;
  }

  // ── Helper: build a cluster row (the box with side-by-side vocab cards) ──
  function clusterRow(n, extraClass) {
    const hasAuthVocab = n.nsTid || n.srcs.some(s => s === 'NS' || s === 'GND' || s === 'IdRef');

    if (hasAuthVocab) {
      // Clustered node: show NS + GND + IdRef cards
      const row = el('div', { className: 'cl-row' + (extraClass ? ' ' + extraClass : ''), 'data-action': 'drill', 'data-label': n.label });
      if (n.gndId) row.setAttribute('data-gndid', n.gndId);
      if (n.idrefId) row.setAttribute('data-idrefid', String(n.idrefId));

      const cards = el('div', { className: 'cl-cards' });
      cards.appendChild(vocabCard('NS', 'vc-ns', n.langs.it || (n.nsTid ? n.label : null)));
      cards.appendChild(vocabCard('GND', 'vc-gnd', n.langs.de || null));
      cards.appendChild(vocabCard('IdRef', 'vc-idr', n.langs.fr || null));
      row.appendChild(cards);

      const lc = langChips(n);
      if (lc) row.appendChild(lc);

      return row;
    } else {
      // WD/AAT-only node. Italian, German and French
      // side by side like the other terms, English below — cards named by
      // LANGUAGE, not NS/GND/IdRef: these are Wikidata or Getty labels, not
      // thesaurus headings (only the Italian one was shown).
      const row = el('div', { className: 'cl-row cl-secondary', 'data-action': 'drill', 'data-label': n.label });
      if (n.gndId) row.setAttribute('data-gndid', n.gndId);
      const inner = el('div', { className: 'cl-wd-inner' });
      const srcBadge = n.srcs.includes('AAT') ? 'AAT' : 'WD';
      const srcCls = n.srcs.includes('AAT') ? 'vc-aat' : 'vc-wd';
      inner.appendChild(el('span', { className: 'vc-tag ' + srcCls, textContent: srcBadge }));
      row.appendChild(inner);
      const cards = el('div', { className: 'cl-cards' });
      for (const lang of ['it', 'de', 'fr']) cards.appendChild(vocabCard(lang.toUpperCase(), srcCls, n.langs[lang] || null));
      row.appendChild(cards);
      const lc = langChips(n);
      if (lc) row.appendChild(lc);
      return row;
    }
  }

  // ── Helper: narrower card (compact, for grid) ──
  function ntCard(n) {
    const hasAuthVocab = n.nsTid || n.srcs.some(s => s === 'NS' || s === 'GND' || s === 'IdRef');
    const card = el('div', { className: 'cl-nt-card', 'data-action': 'drill', 'data-label': n.label });
    if (n.gndId) card.setAttribute('data-gndid', n.gndId);
    if (n.idrefId) card.setAttribute('data-idrefid', String(n.idrefId));

    if (hasAuthVocab) {
      const cards = el('div', { className: 'cl-nt-cards' });
      if (n.langs.it || n.nsTid) {
        const c = el('div', { className: 'vc-sm vc-ns' });
        c.appendChild(el('div', { className: 'vc-tag', textContent: 'NS' }));
        c.appendChild(el('div', { className: 'vc-lbl', textContent: n.langs.it || n.label }));
        cards.appendChild(c);
      }
      if (n.langs.de) {
        const c = el('div', { className: 'vc-sm vc-gnd' });
        c.appendChild(el('div', { className: 'vc-tag', textContent: 'GND' }));
        c.appendChild(el('div', { className: 'vc-lbl', textContent: n.langs.de }));
        cards.appendChild(c);
      }
      if (n.langs.fr) {
        const c = el('div', { className: 'vc-sm vc-idr' });
        c.appendChild(el('div', { className: 'vc-tag', textContent: 'IdRef' }));
        c.appendChild(el('div', { className: 'vc-lbl', textContent: n.langs.fr }));
        cards.appendChild(c);
      }
      if (!cards.childNodes.length) {
        const c = el('div', { className: 'vc-sm vc-ns' });
        c.appendChild(el('div', { className: 'vc-lbl', textContent: n.label }));
        cards.appendChild(c);
      }
      card.appendChild(cards);
    } else {
      // The languages present, named by language (see clusterRow).
      const srcBadge = n.srcs.includes('AAT') ? 'AAT' : 'WD';
      const srcCls = n.srcs.includes('AAT') ? 'vc-aat' : 'vc-wd';
      card.appendChild(el('span', { className: 'vc-tag ' + srcCls, textContent: srcBadge }));
      const cards = el('div', { className: 'cl-nt-cards' });
      for (const lang of ['it', 'de', 'fr']) {
        if (!n.langs[lang]) continue;
        const c = el('div', { className: 'vc-sm ' + srcCls });
        c.appendChild(el('div', { className: 'vc-tag', textContent: lang.toUpperCase() }));
        c.appendChild(el('div', { className: 'vc-lbl', textContent: n.langs[lang] }));
        cards.appendChild(c);
      }
      if (!cards.childNodes.length) cards.appendChild(el('div', { className: 'vc-lbl', style: { marginTop: '2px' }, textContent: n.label }));
      card.appendChild(cards);
    }
    card.appendChild(el('span', { className: 'nt-expand', textContent: L.explore }));
    return card;
  }

  // ── BROADER ──
  if (bt.length) {
    // All these are direct broader terms, from different
    // vocabularies. getHierarchy sorts them best first (NS concepts, then
    // GND/IdRef, AAT, Wikidata; more languages first). They are drawn the
    // other way round, so the best ones sit right above the selected term;
    // beyond BT_SHOWN the others fold behind \u00ABShow all (n)\u00BB, which opens
    // upwards (Industrialisierung has six).
    container.appendChild(el('div', { className: 'sect-lbl', textContent: '\u25B2 ' + L.broader }));
    const BT_SHOWN = 3;
    const foldBt = bt.length > BT_SHOWN + 1;   // never fold a single term
    if (foldBt) {
      container.appendChild(el('div', { className: 'show-more', 'data-action': 'showmore', 'data-group': 'bt',
        textContent: L.showAll + ' (' + bt.length + ')' }));
    }
    [...bt].reverse().forEach((n, j) => {
      const i = bt.length - 1 - j;   // rank in the sorted list
      const row = clusterRow(n, 'cl-clickable');
      const conn = el('div', { className: 'cl-conn' });
      if (foldBt && i >= BT_SHOWN) {
        for (const x of [row, conn]) { x.style.display = 'none'; x.setAttribute('data-sn-extra', 'bt'); }
      }
      container.appendChild(row);
      container.appendChild(conn);
    });
  }

  // ── SELECTED ──
  container.appendChild(el('div', { className: 'sect-lbl', textContent: L.selected }));
  {
    const selRow = el('div', { className: 'cl-row cl-selected' });
    // Build vocab cards from reconciled data
    // Try exact match with known IDs first (fixes IdRef↔NS mismatch when same label maps to different concepts)
    // The heading that was navigated, when known; the lookup
    // by wording picked the first cached heading with that word (Design: the
    // GND «Design» under the hierarchy of the NS «Design»).
    let cached = selected || RC.get(rck(curTitle, navGndId || null, navIdrefId || null));
    // Fallback: try without IDs
    if (!cached) cached = RC.get(rck(curTitle, null, null));
    // Fallback: try matching by term prefix in cache keys (catches cases where IDs differ)
    if (!cached) {
      const prefix = curTitle.toLowerCase().trim() + '|';
      for (const [k, v] of RC.entries()) {
        if (k.startsWith(prefix)) { cached = v; break; }
      }
    }
    // Fallback: match by QID
    if (!cached && qid) { for (const v of RC.values()) { if (v.qid === qid && hasTrustedQid(v)) { cached = v; break; } } }
    // The record's own headings with this wording keep their form and
    // id in their home language (GND → DE, IdRef → FR), whichever cached
    // result was found first: GND «Eucharistie» (a secondary mapping of
    // Eucaristia) was shown as the slot holder «Abendmahl» when the IdRef
    // «Eucharistie» of the same record answered first.
    const own = recordHeadingForms(curTitle, cached);
    const cl = { ...(cached?.controlledLabels || {}), ...own.labels };
    const nsData = cached?.nsData;
    const cachedTT = cached?.termType || null;
    // An unverified Wikidata hypothesis gives no description,
    // no ids and no search forms here either (as in the Subjects tab): the
    // party «Renaissance» was shown as the description of the period.
    const wdUntrusted = cached?.wdMatch === 'unverified' || cached?.wdMatch === 'conflict';
    const cachedEntity = wdUntrusted ? null : (cached?.entity || entity);

    // Extract authority IDs for clickable cards — the record's and its
    // concept's first, the Wikidata item's only to fill a gap.
    const nsId = nsData?.id || null;
    const gndIdSel  = own.gndId || cached?.gndId || (cachedEntity ? getClaim(cachedEntity, 'P227') : null) || null;
    const idrefIdSel = own.idrefId || cached?.idrefId || (cachedEntity ? (cached?.idrefWd || getClaim(cachedEntity, 'P269')) : null) || cached?.idrefTwin || null;
    const sbnIdSel = cachedEntity ? getClaim(cachedEntity, 'P396') : null;

    // Helper: build a clickable vocab card (links to authority record if ID available)
    function vocabCardLinked(vocabLabel, cssClass, label, url, note, failed) {
      const card = el('div', { className: 'vc ' + cssClass + (url ? ' vc-link' : '') });
      card.appendChild(el('div', { className: 'vc-tag', textContent: vocabLabel }));
      if (label) {
        const lbl = card.appendChild(el('div', { className: 'vc-lbl', textContent: label }));
        if (note) lbl.appendChild(el('span', { className: 'vc-prov', textContent: ' ' + note }));
      } else {
        const lbl = card.appendChild(el('div', { className: 'vc-lbl vc-empty', textContent: '\u2014' }));
        // Empty because the service did not answer, not because
        // there is nothing: a clock, named on hover.
        if (failed) {
          const why = L.netFailBox.replace('{s}', failed);
          lbl.appendChild(el('span', { className: 'vc-fail', role: 'img', 'aria-label': why, title: why, textContent: ' \u23F1' }));
        }
      }
      if (url) {
        card.style.cursor = 'pointer';
        card.title = vocabLabel + ' \u2192 ' + (label || '');
        card.addEventListener('click', () => openUrlSafe(url));
      }
      return card;
    }

    // Determine the first card: NS (found in thesaurus), SBN (place/person), or empty NS
    const hasNS = !!nsData;
    const isSBN = !nsData && (cachedTT === 'place' || cachedTT === 'person');
    const hasAnyAuth = hasNS || isSBN || gndIdSel || idrefIdSel;

    // ── Always show selected term title at top of SELEZIONATO ──
    const selTitle = el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '4px', color: 'var(--sn-t1)' } });
    // The navigated heading with its qualifier (Architektur <Motiv>).
    selTitle.appendChild(txt(selected?.qualifier ? qualifiedLabel(curTitle, selected.qualifier, selected.vocabSource) : curTitle));
    // If the heading in the interface language differs from the title, show
    // it too, in the interface language only, no fallback — under a
    // French interface «Photographie» must not show «→ Fotografia».
    const arrowLang = getInterfaceLang();
    const resolvedLabel = arrowLang === 'it' ? (nsData?.label || cl.it) : cl[arrowLang];
    if (resolvedLabel && resolvedLabel.toLowerCase() !== curTitle.toLowerCase()) {
      selTitle.appendChild(txt('  '));
      selTitle.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--sn-t2)' }, textContent: '→ ' + resolvedLabel }));
    }
    selRow.appendChild(selTitle);

    if (hasAnyAuth) {
      // Standard layout: NS/GND/IdRef cards
      const firstCardLabel = isSBN ? 'SBN' : 'NS';
      const firstCardClass = isSBN ? 'vc-sbn' : 'vc-ns';
      const nsUrl = nsId ? ID_PROPS.P508.u(nsId) : null;
      const sbnPlaceIdSel = cachedEntity ? getClaim(cachedEntity, 'P10397') : null;
      // Places and names are not in NS and SBN publishes no
      // service: when the Wikidata item (reached through an id: cachedEntity
      // is null for a text-search hypothesis) carries an SBN id, its Italian
      // label names the SBN link, marked as coming from Wikidata.
      const sbnWdLabel = isSBN && !cl.it && cachedEntity && (sbnPlaceIdSel || sbnIdSel)
        ? (cachedEntity.labels?.it?.value || null) : null;
      const firstCardValue = hasNS ? (nsData.label || cl.it || null)
                           : isSBN ? (cl.it || sbnWdLabel || null)
                           : null;
      const sbnUrl = isSBN ? (
        cachedTT === 'place' && sbnPlaceIdSel ? ID_PROPS.P10397.u(sbnPlaceIdSel)
        : sbnIdSel ? ID_PROPS.P396.u(sbnIdSel)
        : sbnPlaceIdSel ? ID_PROPS.P10397.u(sbnPlaceIdSel)
        : null
      ) : null;
      const gndUrl = gndIdSel ? ID_PROPS.P227.u(gndIdSel) : null;
      const idrefUrl = idrefIdSel ? ID_PROPS.P269.u(idrefIdSel) : null;

      const cards = el('div', { className: 'cl-cards' });
      // Which empty card a silent service explains (the SBN
      // name comes from Wikidata; the French form from IdRef or data.bnf.fr).
      const nf = cached?.netFail || [];
      const failedOf = (...svcs) => svcs.find(x => nf.includes(x)) || null;
      cards.appendChild(vocabCardLinked(firstCardLabel, firstCardClass, firstCardValue, hasNS ? nsUrl : sbnUrl,
        sbnWdLabel && firstCardValue === sbnWdLabel ? '(Wikidata)' : null, isSBN ? failedOf('Wikidata') : null));
      cards.appendChild(vocabCardLinked('GND', 'vc-gnd', cl.de || null, gndUrl, null, failedOf('GND', 'Wikidata')));
      cards.appendChild(vocabCardLinked('IdRef', 'vc-idr', cl.fr || null, idrefUrl, null, failedOf('IdRef', 'BnF', 'Wikidata')));
      selRow.appendChild(cards);
    } else {
      // AAT/WD-only concept: show source card(s) instead of empty NS/GND/IdRef
      const cards = el('div', { className: 'cl-cards' });
      const aatId = cachedEntity ? getClaim(cachedEntity, 'P1014') : null;
      if (aatId) {
        cards.appendChild(vocabCardLinked('AAT', 'vc-aat', curTitle, ID_PROPS.P1014.u(aatId)));
      }
      if (cached?.qid) {
        const wdLabel = cachedEntity ? (getLabel(cachedEntity, getInterfaceLang()) || getLabel(cachedEntity, 'en') || curTitle) : curTitle;
        cards.appendChild(vocabCardLinked('WD', 'vc-wd', wdLabel, 'https://www.wikidata.org/wiki/' + cached.qid));
      }
      if (!aatId && !cached?.qid) {
        // Truly unknown — show a simple label
        cards.appendChild(el('div', { className: 'vc vc-wd', style: { flex: '1' } },
          el('div', { className: 'vc-lbl', textContent: curTitle })));
      }
      selRow.appendChild(cards);
    }

    // Description: the Wikidata one in the interface language only (not
    // Italian, else English, whatever the interface);
    // for a term outside NS with provenance.
    const desc = cachedEntity ? (getDesc(cachedEntity, getInterfaceLang()) || '') : '';
    if (desc) {
      const descDiv = el('div', { className: 'cl-desc' });
      descDiv.appendChild(txt(desc));
      // If term is NOT in NS thesaurus but has a WD entity, show provenance hint
      if (!hasNS && cached?.qid) {
        descDiv.appendChild(txt(' '));
        const wdLink = el('a', { href: 'https://www.wikidata.org/wiki/' + cached.qid, target: '_blank',
          className: 'vc-prov', textContent: '(Wikidata)' });
        descDiv.appendChild(wdLink);
      }
      selRow.appendChild(descDiv);
    } else if (!hasNS && cached?.qid && !wdUntrusted) {
      // No description but still show WD provenance for non-NS terms
      const provDiv = el('div', { className: 'cl-desc' });
      const wdLink = el('a', { href: 'https://www.wikidata.org/wiki/' + cached.qid, target: '_blank',
        className: 'vc-prov', textContent: 'Wikidata: ' + cached.qid });
      provDiv.appendChild(wdLink);
      selRow.appendChild(provDiv);
    }

    const ddcVal = nsData?.ddc || null;
    if (ddcVal) {
      const ddcRow = el('div', { className: 'ddc-row', style: { margin: '4px 0 2px 2px' } });
      ddcRow.appendChild(el('span', { className: 'ddc-num', textContent: 'DDC ' + ddcVal }));
      selRow.appendChild(ddcRow);
    }

    // Secondary langs
    const secLangs = el('div', { className: 'vc-langs' });
    if (cl.en) secLangs.appendChild(el('span', { className: 'vc-lang', textContent: 'en ' + cl.en }));
    if (cl.es) secLangs.appendChild(el('span', { className: 'vc-lang', textContent: 'es ' + cl.es }));
    if (secLangs.childNodes.length) selRow.appendChild(secLangs);

    // Search buttons
    const catUrlS = buildCatUrl(cachedEntity, nsData?.label || curTitle, cl, 'subject');
    const catUrlA = buildCatUrl(cachedEntity, nsData?.label || curTitle, cl, 'broad');
    if (catUrlS) {
      const acts = el('div', { className: 'acts', style: { margin: '6px 0 0 2px' } });
      acts.appendChild(el('button', { className: 'act act-pri', 'data-action': 'openurl', 'data-url': catUrlS, textContent: L.search }));
      acts.appendChild(el('button', { className: 'act', 'data-action': 'openurl', 'data-url': catUrlA, textContent: L.searchBroad }));
      selRow.appendChild(acts);
    }

    container.appendChild(selRow);
  }

  // ── NARROWER ──
  if (nt.length) {
    container.appendChild(el('div', { className: 'cl-conn' }));
    container.appendChild(el('div', { className: 'sect-lbl', textContent: '\u25BC ' + L.narrower }));
    const grid = el('div', { className: 'cl-nt-grid' });
    const SH = 8;
    const showAllNt = nt.length <= SH + 2;
    nt.forEach((n, i) => {
      const card = ntCard(n);
      if (!showAllNt && i >= SH) { card.style.display = 'none'; card.setAttribute('data-sn-extra', 'nt'); }
      grid.appendChild(card);
    });
    container.appendChild(grid);
    if (!showAllNt) {
      container.appendChild(el('div', { className: 'show-more', 'data-action': 'showmore', 'data-group': 'nt', textContent: L.showAll + ' (' + nt.length + ')' }));
    }
  }

  // ── RELATED ──
  if (rt.length) {
    container.appendChild(el('div', { className: 'sect-lbl', style: { marginTop: '6px' }, textContent: '\u2194 ' + L.related }));
    const chips = el('div', { className: 'rt-chips' });
    rt.forEach(n => {
      // Determine source-based CSS class for chip color
      const srcCls = n.nsTid ? 'rtc-ns'
        : n.srcs?.includes('GND') ? 'rtc-gnd'
        : n.srcs?.includes('IdRef') ? 'rtc-idr'
        : n.srcs?.includes('AAT') ? 'rtc-aat'
        : 'rtc-wd';
      const chip = el('span', { className: 'rtc ' + srcCls, 'data-action': 'drill', 'data-label': n.label,
        role: 'button', tabindex: '0', 'aria-label': L.related + ': ' + n.label });
      if (n.gndId) chip.setAttribute('data-gndid', n.gndId);
      if (n.idrefId) chip.setAttribute('data-idrefid', String(n.idrefId));
      chip.textContent = n.label;
      if (n.nsTid && n.langs.de) {
        chip.title = 'DE: ' + n.langs.de + (n.langs.fr ? ' · FR: ' + n.langs.fr : '');
      }
      chips.appendChild(chip);
    });
    container.appendChild(chips);
  }

  if (!bt.length && !nt.length && !rt.length) {
    container.appendChild(el('div', { className: 'empty', textContent: L.noHierarchy }));
  }
}

// ═══════════════════════════════════════════
// CROSS-VOCAB AND BUILDER
// ═══════════════════════════════════════════
let allReconciledResults = [];
let allNameResults = [];

// One combined-search chip per concept; see addUnique below.
function andChipItems(results) {
  const allItems = [];
  const seenKeys = new Map();
  // A form the record also has as a subject (SBT «Arte —
  // Periodici» and the 655 «Periodici») joins that subject's chip instead of
  // searching the same word twice; its official wordings go in OR.
  const topicByWord = new Map();
  const wordsOf = r => [r.label, (r.controlledLabels || {}).it]
    .map(w => (w || '').toLowerCase().trim()).filter(Boolean);
  // Identity = MARC type + thesaurus id. Two NS concepts sharing
  // a QID, or a topic and a form with the same wording, stay separate; a
  // verified QID only merges results that have no thesaurus id of their own.
  // A heading merged into an earlier chip is kept on it
  // (andSiblings): its wording is shown and searched, not dropped.
  function addUnique(r) {
    const tt = r.termType || 'topic';
    const keys = [];
    if (r.nsData?.id) keys.push(tt + '|n:' + r.nsData.id);
    else if (hasTrustedQid(r)) keys.push(tt + '|q:' + r.qid);
    else if (r.formKey) keys.push(tt + '|f:' + r.formKey);   // one row of the forms table
    else if (r.label) keys.push(tt + '|l:' + r.label.toLowerCase().trim());
    let owner = keys.map(k => seenKeys.get(k)).find(Boolean);
    if (!owner && tt === 'form') {
      owner = wordsOf(r).map(w => topicByWord.get(w)).find(Boolean);
      if (owner) keys.forEach(k => seenKeys.set(k, owner));
    }
    if (owner) {
      const wording = (r.label || '').toLowerCase().trim();
      if (wording && ![owner, ...owner.andSiblings].some(x => (x.label || '').toLowerCase().trim() === wording)) owner.andSiblings.push(r);
      return;
    }
    r.andSiblings = [];
    keys.forEach(k => seenKeys.set(k, r));
    if (r.nsData?.id && hasTrustedQid(r)) seenKeys.set(tt + '|q:' + r.qid, r);
    if (tt === 'topic') wordsOf(r).forEach(w => { if (!topicByWord.has(w)) topicByWord.set(w, r); });
    allItems.push(r);
  }
  for (const r of results) addUnique(r);
  return allItems;
}

function renderAndBuilder(container) {
  const allItems = andChipItems([...allReconciledResults, ...allNameResults]);
  if (allItems.length < 2) { clearEl(container); return; }

  const typeLabels = { topic: L.typeTopic, person: L.typePerson, period: L.typePeriod, place: L.typePlace, form: L.typeForm };
  const typeCss = { topic: 'ct-a', person: 'ct-z', period: 'ct-y', place: 'ct-x', form: 'ct-v' };

  clearEl(container);
  const builder = el('div', { className: 'and-builder' });
  builder.appendChild(el('div', { className: 'sect-lbl', textContent: L.selectTerms }));

  const chipsDiv = el('div', { className: 'and-chips' });
  const iLang = getInterfaceLang();
  // Sort items so that form subfields ($v) appear at the end of the list:
  // they refine a combined search but are not useful on their own, so we
  // want them visible but out of the way of the primary subject terms.
  const orderedItems = [
    ...allItems.filter(r => (r.termType || 'topic') !== 'form'),
    ...allItems.filter(r => (r.termType || 'topic') === 'form')
  ];
  orderedItems.forEach((r, i) => {
    const tt = r.termType || 'topic';
    const badge = typeLabels[tt] || tt;
    const badgeCls = typeCss[tt] || 'ct-a';
    // Default checked: topical subjects and places (what a user most often wants
    // to combine). Form ($v) is off by default — it's a refinement, not a subject.
    const checked = (tt === 'topic' || tt === 'place') ? ' checked' : '';

    // Original MARC term (the form chosen by the cataloguer)
    const origLabel = [r.label || '?', ...r.andSiblings.map(x => x.label)].join(' · ');
    // Translation in interface language from controlled labels (if different and available)
    const clAll = r.mergedLabels || r.controlledLabels || {};
    const transLabel = clAll[iLang] || null;
    const showTrans = transLabel && transLabel.toLowerCase() !== origLabel.toLowerCase();

    const chip = el('span', { className: 'and-chip' + checked, 'data-action': 'togglecheck', 'data-idx': String(i),
      role: 'checkbox', tabindex: '0',
      'aria-checked': checked ? 'true' : 'false', 'aria-pressed': checked ? 'true' : 'false' });
    chip.appendChild(el('span', { className: 'chip-type ' + badgeCls, textContent: badge }));
    chip.appendChild(txt(' '));
    chip.appendChild(el('b', { textContent: origLabel }));
    if (showTrans) {
      chip.appendChild(el('br'));
      chip.appendChild(el('span', { style: { fontSize: '10px', fontStyle: 'italic', color: 'var(--sn-t2)' }, textContent: transLabel }));
    }
    chipsDiv.appendChild(chip);
  });
  builder.appendChild(chipsDiv);
  builder.appendChild(el('div', { className: 'and-result', id: 'sn-and-result' }));
  container.appendChild(builder);
  // The chips are drawn from orderedItems, so their data-idx
  // must be read against the same order (against the unsorted list,
  // ticking a chip could search a different term).
  container._allItems = orderedItems;
  updateAndBuilder();
}

function updateAndBuilder() {
  const sidebar = byId('sn-sidebar');
  if (!sidebar) return;
  const container = byId('sn-crossAnd');
  if (!container) return;
  const allItems = container._allItems;
  if (!allItems) return;

  const chips = sidebar.querySelectorAll('.and-chip');
  const selected = [];
  chips.forEach((chip, i) => { if (chip.classList.contains('checked') && allItems[i]) selected.push(allItems[i]); });
  const resultEl = byId('sn-and-result');
  if (!resultEl) return;
  clearEl(resultEl);

  if (selected.length < 1) {
    resultEl.appendChild(el('div', { className: 'empty', style: { padding: '6px', fontSize: '10px' }, textContent: '(' + L.selectTerms + ')' }));
    return;
  }

  const single = selected.length === 1 ? andSearchForms(selected[0]) : null;
  const singleUrl = mode => buildCatUrl(single.entity, selected[0].nsData?.label || (single.entity ? null : single.record),
    Object.keys(andChipLabels(selected[0])).length ? andChipLabels(selected[0]) : { record: single.record }, mode);
  const urlSub = selected.length >= 2 ? buildCrossAndUrl(selected, 'subject') : singleUrl('subject');
  const urlAny = selected.length >= 2 ? buildCrossAndUrl(selected, 'broad') : singleUrl('broad');

  const terms = selected.map(r => r.controlledLabels?.it || r.controlledLabels?.de || r.controlledLabels?.fr || r.label || '?').join(' + ');
  const acts = el('div', { className: 'acts', style: { marginTop: '4px' } });
  if (urlSub) acts.appendChild(el('button', { className: 'act act-pri', 'data-action': 'runand', 'data-url': urlSub, textContent: L.buildQuery + ': ' + terms }));
  if (urlAny) acts.appendChild(el('button', { className: 'act', 'data-action': 'runand', 'data-url': urlAny, textContent: L.buildQueryBroad }));
  if (acts.childNodes.length) resultEl.appendChild(acts);
}

// ═══════════════════════════════════════════
// SIDEBAR MANAGEMENT
// ═══════════════════════════════════════════
function removeSidebar() {
  const sb = byId('sn-sidebar');
  if (sb) sb.remove();
  const badge = byId('sn-badge');
  if (badge) badge.remove();
  sidebarState = 'none';
  currentDocId = null;
}

function createBadge(count) {
  let badge = byId('sn-badge');
  if (!badge) {
    badge = el('div', { id: 'sn-badge' });
    badge.addEventListener('click', () => expandSidebar());
    snRoot.appendChild(badge);
  }
  clearEl(badge);
  badge.appendChild(el('span', { className: 'sn-badge-icon', textContent: 'S' }));
  badge.appendChild(el('span', { className: 'sn-badge-count', textContent: String(count) }));
  sidebarState = 'badge';
}

function expandSidebar() {
  const sb = byId('sn-sidebar');
  if (sb) { sb.classList.remove('sn-hidden', 'sn-wide'); sidebarState = 'open'; const badge = byId('sn-badge'); if (badge) badge.style.display = 'none'; }
}

function collapseSidebar() {
  const sb = byId('sn-sidebar');
  if (sb) sb.classList.add('sn-hidden');
  const badge = byId('sn-badge');
  if (badge) badge.style.display = '';
  sidebarState = 'badge';
}

// ═══════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════
function applyTheme() {
  const sb = byId('sn-sidebar');
  if (!sb) return;
  sb.classList.remove('sn-theme-light', 'sn-theme-dark');
  if (themeMode === 'light') sb.classList.add('sn-theme-light');
  else if (themeMode === 'dark') sb.classList.add('sn-theme-dark');
  // Save preference
  try { chrome.storage.local.set({ snTheme: themeMode }); } catch (e) { logDebug('storage.set snTheme', e); }
}

function cycleTheme() {
  if (themeMode === 'auto') themeMode = 'light';
  else if (themeMode === 'light') themeMode = 'dark';
  else themeMode = 'auto';
  applyTheme();
  // Update button text
  const btn = snRoot ? snRoot.querySelector('.sn-theme-btn') : null;
  if (btn) btn.textContent = themeMode === 'auto' ? L.themeAuto : themeMode === 'light' ? L.themeLight : L.themeDark;
}

// ═══════════════════════════════════════════
// EVENT DELEGATION
// ═══════════════════════════════════════════
function setupDelegation(sidebar) {
  // Shared "execute action" function so that both click and keyboard
  // (Enter/Space on interactive elements) route through the same logic.
  function executeAction(t) {
    const a = t.dataset.action;
    if (a === 'close') collapseSidebar();
    else if (a === 'togglewide') { const sb = byId('sn-sidebar'); sb.classList.toggle('sn-wide'); }
    else if (a === 'switchmt') {
      const n = +t.dataset.idx;
      const tabs = sidebar.querySelectorAll('.mt');
      const panels = sidebar.querySelectorAll('.mtb');
      tabs.forEach((x, i) => {
        const selected = i === n;
        x.classList.toggle('on', selected);
        // Keep ARIA state in sync with visual state
        if (x.getAttribute('role') === 'tab') {
          x.setAttribute('aria-selected', selected ? 'true' : 'false');
          x.setAttribute('tabindex', selected ? '0' : '-1');
        }
      });
      panels.forEach((x, i) => x.classList.toggle('on', i === n));
    }
    else if (a === 'switchvt') {
      const n = +t.dataset.idx;
      // Only .vt/.vtb that are NOT .cls-vt (classification has its own handler)
      const vts = sidebar.querySelectorAll('.vt:not(.cls-vt)');
      const vtbs = sidebar.querySelectorAll('.vtb:not(.cls-vtb)');
      vts.forEach((x, i) => {
        const selected = i === n;
        x.classList.toggle('on', selected);
        if (x.getAttribute('role') === 'tab') {
          x.setAttribute('aria-selected', selected ? 'true' : 'false');
          x.setAttribute('tabindex', selected ? '0' : '-1');
        }
      });
      vtbs.forEach((x, i) => x.classList.toggle('on', i === n));
    }
    else if (a === 'openurl' || a === 'runand') {
      const url = t.dataset.url;
      if (url) openUrlSafe(url);
    }
    else if (a === 'drill') drill(t.dataset.label, t.dataset.gndid || null, t.dataset.idrefid || null);
    else if (a === 'navto') navTo(+t.dataset.idx);
    else if (a === 'showmore') {
      // Each «Show all» opens only its own group (bt / nt).
      t.style.display = 'none';
      const g = t.getAttribute('data-group');
      sidebar.querySelectorAll(g ? '[data-sn-extra="' + g + '"]' : '[data-sn-extra]').forEach(el => el.style.display = '');
    }
    else if (a === 'togglecheck') {
      t.classList.toggle('checked');
      const pressed = t.classList.contains('checked');
      if (t.hasAttribute('aria-pressed')) t.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (t.hasAttribute('aria-checked')) t.setAttribute('aria-checked', pressed ? 'true' : 'false');
      updateAndBuilder();
    }
    else if (a === 'cycletheme') cycleTheme();
    else if (a === 'toggleabout') {
      sidebar.querySelector('.sn-about-popover')?.classList.toggle('on');
    }
  }

  sidebar.addEventListener('click', e => {
    // Close the about popover on any sidebar click outside it; clicks
    // outside the whole panel are handled by the document-level listener in
    // cs_main.js (the shadow boundary retargets them to the host element).
    if (!e.target.closest('.sn-about-popover') && !e.target.closest('[data-action="toggleabout"]')) {
      sidebar.querySelector('.sn-about-popover')?.classList.remove('on');
    }
    const t = e.target.closest('[data-action]');
    if (!t) return;
    executeAction(t);
  });

  // Keyboard navigation:
  //   Enter / Space   → activate action on any [data-action] element with
  //                     role=tab, role=button, or non-native tabindex
  //   ArrowLeft/Right → when focus is on a role=tab, move focus across the
  //                     sibling tabs in the same tablist (tab roving focus)
  sidebar.addEventListener('keydown', e => {
    const t = e.target.closest('[data-action]');
    if (!t) return;
    const key = e.key;

    // Enter / Space: activate
    if ((key === 'Enter' || key === ' ') && t.getAttribute('role') !== undefined) {
      // For <button> elements, browsers already trigger click on Enter/Space
      // — don't double-fire.
      if (t.tagName === 'BUTTON') return;
      e.preventDefault();
      executeAction(t);
      return;
    }

    // Arrow navigation within a tablist
    if ((key === 'ArrowLeft' || key === 'ArrowRight' || key === 'Home' || key === 'End')
        && t.getAttribute('role') === 'tab') {
      const tablist = t.closest('[role="tablist"]');
      if (!tablist) return;
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      const curIdx = tabs.indexOf(t);
      if (curIdx < 0) return;
      let nextIdx;
      if (key === 'ArrowRight') nextIdx = (curIdx + 1) % tabs.length;
      else if (key === 'ArrowLeft') nextIdx = (curIdx - 1 + tabs.length) % tabs.length;
      else if (key === 'Home') nextIdx = 0;
      else nextIdx = tabs.length - 1;
      e.preventDefault();
      tabs[nextIdx].focus();
      // Activate tab on arrow (WAI-ARIA pattern for automatic activation)
      executeAction(tabs[nextIdx]);
    }
  });
}
