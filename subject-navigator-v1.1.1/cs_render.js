// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 6/7): rendering and navigation — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
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

  // A2 (v1.1.1): when the WD entity is an unconfirmed text match, split the
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
  // claim (v1.1.1): authorities may hold several PPNs for the same concept
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

function rRoute(rt) {
  if (!rt.length) return null;
  const container = el('div', { className: 'route' });
  rt.forEach((r, i) => {
    if (i > 0) container.appendChild(txt(' \u2192 '));
    const c = r.startsWith('NS') ? 'p-ns' : r.includes('GND') ? 'p-gnd' : r.includes('IdRef') ? 'p-idr' : r.includes('AAT') ? 'p-aat' : 'p-wd';
    container.appendChild(el('span', { className: 'pill ' + c, textContent: r }));
  });
  return container;
}

async function renderTermDetail(container, term, gndId, idrefId, vocabSource, termType) {
  clearEl(container);
  container.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.reconciling }));
  const result = await reconcile(term, gndId, idrefId, vocabSource, termType);
  const { qid, entity, route, nsData, dewey, controlledLabels: cl, nsClusterGrade } = result;
  clearEl(container);

  const det = el('div', { className: 'det' });
  const title = nsData?.label || term;
  const iLang = getInterfaceLang();

  // Title: NS Italian label (primary) + interface language label if different
  const titleDiv = el('div', { style: { fontSize: '13px', fontWeight: '500', marginBottom: '2px' } });
  titleDiv.appendChild(txt(title));
  if (iLang !== 'it') {
    const iLabel = cl[iLang] || (entity ? getLabel(entity, iLang) : null);
    if (iLabel && iLabel.toLowerCase() !== title.toLowerCase()) {
      titleDiv.appendChild(txt(' '));
      titleDiv.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--sn-t2)' }, textContent: '(' + iLang.toUpperCase() + ': ' + iLabel + ')' }));
    }
  }
  det.appendChild(titleDiv);

  // Description: prefer interface language, fallback to Italian then English
  const desc = entity ? (getDesc(entity, iLang) || getDesc(entity, 'it') || getDesc(entity, 'en') || '') : '';
  if (desc) det.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--sn-t2)', marginBottom: '3px' }, textContent: desc }));

  // NS scope note
  if (nsData?.scopeNote) {
    const snEl = el('div', { style: { fontSize: '10px', color: 'var(--sn-t2)', marginTop: '2px', fontStyle: 'italic' }, textContent: 'SN: ' + nsData.scopeNote });
    det.appendChild(snEl);
  }
  // NS definition
  if (nsData?.definition) {
    const dfEl = el('div', { style: { fontSize: '10px', color: 'var(--sn-t2)', marginTop: '2px' }, textContent: nsData.definition });
    det.appendChild(dfEl);
  }

  const routeEl = rRoute(route);
  if (routeEl) det.appendChild(routeEl);

  // A1 (v1.1.1): verdict for candidates found via the WD text fallback —
  // a discarded wrong match is explained, an unconfirmed one is flagged.
  if (result.wdMatch === 'conflict' && result.wdDiscarded) {
    det.appendChild(el('div', { className: 'match-note match-reject', role: 'note',
      textContent: '⚠ ' + L.wdRejected + ': «' + (result.wdDiscarded.label || result.wdDiscarded.qid) + '» (' + result.wdDiscarded.qid + ') — ' + L.wdRejectedWhy }));
  } else if (result.wdMatch === 'unverified') {
    det.appendChild(el('div', { className: 'match-note match-warn', role: 'note',
      textContent: '⚠ ' + L.wdUnverified }));
  }

  // Cluster confidence grade (only when the term is anchored to an NS concept)
  if (nsClusterGrade && nsData) {
    const gradeColors = { 1: '#4caf50', 2: '#7cb342', 3: '#f57c00', 4: '#e53935' };
    const gradeHints = {
      1: 'Grado 1 – triangolazione completa (NS ↔ GND ↔ BnF)',
      2: 'Grado 2 – due thesauri si confermano',
      3: 'Grado 3 – collegamento unidirezionale',
      4: 'Grado 4 – solo via Wikidata'
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

  const catUrlSub = buildCatUrl(entity, nsData?.label, cl, 'subject');
  const catUrlAny = buildCatUrl(entity, nsData?.label, cl, 'broad');
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
function navPush(l, q, e, u, gi, ii) {
  if (navState.currentIndex < navState.history.length - 1) navState.history = navState.history.slice(0, navState.currentIndex + 1);
  navState.history.push({ label: l, qid: q, entity: e, nsUri: u, gndId: gi || null, idrefId: ii || null });
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
  const rec = recoverAuthIds(label, r.qid,
    nodeGndId || getGndFromEntity(r.entity) || (r.lobidData ? r.lobidData.gndIdentifier : null),
    nodeIdrefId || getIdrefFromEntity(r.entity));
  const gi = rec.gi, ii = rec.ii;
  navPush(label, r.qid, r.entity, r.nsData?.uri, gi, ii);
  const h = await getHierarchy(r.qid, r.entity, r.nsData?.uri, gi, ii);
  rDynHier(byId('sn-navTree'), h, label, r.qid, r.entity, gi, ii);
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
  rDynHier(navEl, h, e.label, e.qid, e.entity, e.gndId, e.idrefId);
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

function rDynHier(container, nodes, curTitle, qid, entity, navGndId, navIdrefId) {
  const bt = nodes.filter(n => n.type === 'bt');
  const nt = nodes.filter(n => n.type === 'nt');
  const rt = nodes.filter(n => n.type === 'rt');
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
      // WD/AAT-only node: compact, no empty vocab cards
      const row = el('div', { className: 'cl-row cl-secondary', 'data-action': 'drill', 'data-label': n.label });
      if (n.gndId) row.setAttribute('data-gndid', n.gndId);
      const inner = el('div', { className: 'cl-wd-inner' });
      const srcBadge = n.srcs.includes('AAT') ? 'AAT' : 'WD';
      const srcCls = n.srcs.includes('AAT') ? 'vc-aat' : 'vc-wd';
      inner.appendChild(el('span', { className: 'vc-tag ' + srcCls, textContent: srcBadge }));
      inner.appendChild(el('span', { className: 'cl-wd-lbl', textContent: n.label }));
      row.appendChild(inner);
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
      const srcBadge = n.srcs.includes('AAT') ? 'AAT' : 'WD';
      card.appendChild(el('span', { className: 'vc-tag vc-wd', textContent: srcBadge }));
      card.appendChild(el('div', { className: 'vc-lbl', style: { marginTop: '2px' }, textContent: n.label }));
    }
    card.appendChild(el('span', { className: 'nt-expand', textContent: L.explore }));
    return card;
  }

  // ── BROADER ──
  if (bt.length) {
    container.appendChild(el('div', { className: 'sect-lbl', textContent: '\u25B2 ' + L.broader }));
    bt.forEach(n => {
      container.appendChild(clusterRow(n, 'cl-clickable'));
      container.appendChild(el('div', { className: 'cl-conn' }));
    });
  }

  // ── SELECTED ──
  container.appendChild(el('div', { className: 'sect-lbl', textContent: L.selected }));
  {
    const selRow = el('div', { className: 'cl-row cl-selected' });
    // Build vocab cards from reconciled data
    // Try exact match with known IDs first (fixes IdRef↔NS mismatch when same label maps to different concepts)
    let cached = RC.get(rck(curTitle, navGndId || null, navIdrefId || null));
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
    if (!cached && qid) { for (const v of RC.values()) { if (v.qid === qid) { cached = v; break; } } }
    const cl = cached?.controlledLabels || {};
    const nsData = cached?.nsData;
    const cachedTT = cached?.termType || null;
    const cachedEntity = cached?.entity || entity;

    // Extract authority IDs for clickable cards
    const nsId = nsData?.id || null;
    const gndIdSel  = (cachedEntity ? getClaim(cachedEntity, 'P227') : null) || cached?.gndId || null;
    const idrefIdSel = (cachedEntity ? getClaim(cachedEntity, 'P269') : null) || cached?.idrefId || null;
    const sbnIdSel = cachedEntity ? getClaim(cachedEntity, 'P396') : null;

    // Helper: build a clickable vocab card (links to authority record if ID available)
    function vocabCardLinked(vocabLabel, cssClass, label, url) {
      const card = el('div', { className: 'vc ' + cssClass + (url ? ' vc-link' : '') });
      card.appendChild(el('div', { className: 'vc-tag', textContent: vocabLabel }));
      if (label) {
        card.appendChild(el('div', { className: 'vc-lbl', textContent: label }));
      } else {
        card.appendChild(el('div', { className: 'vc-lbl vc-empty', textContent: '\u2014' }));
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
    selTitle.appendChild(txt(curTitle));
    // If the cached result resolved to a different NS label, show it too
    const resolvedLabel = nsData?.label || cl.it;
    if (resolvedLabel && resolvedLabel.toLowerCase() !== curTitle.toLowerCase()) {
      selTitle.appendChild(txt('  '));
      selTitle.appendChild(el('span', { style: { fontSize: '11px', fontWeight: '400', color: 'var(--sn-t2)' }, textContent: '→ ' + resolvedLabel }));
    }
    selRow.appendChild(selTitle);

    if (hasAnyAuth) {
      // Standard layout: NS/GND/IdRef cards
      const firstCardLabel = isSBN ? 'SBN' : 'NS';
      const firstCardClass = isSBN ? 'vc-sbn' : 'vc-ns';
      const firstCardValue = hasNS ? (nsData.label || cl.it || null)
                           : isSBN ? (cl.it || null)
                           : null;

      const nsUrl = nsId ? ID_PROPS.P508.u(nsId) : null;
      const sbnPlaceIdSel = cachedEntity ? getClaim(cachedEntity, 'P10397') : null;
      const sbnUrl = isSBN ? (
        cachedTT === 'place' && sbnPlaceIdSel ? ID_PROPS.P10397.u(sbnPlaceIdSel)
        : sbnIdSel ? ID_PROPS.P396.u(sbnIdSel)
        : sbnPlaceIdSel ? ID_PROPS.P10397.u(sbnPlaceIdSel)
        : null
      ) : null;
      const gndUrl = gndIdSel ? ID_PROPS.P227.u(gndIdSel) : null;
      const idrefUrl = idrefIdSel ? ID_PROPS.P269.u(idrefIdSel) : null;

      const cards = el('div', { className: 'cl-cards' });
      cards.appendChild(vocabCardLinked(firstCardLabel, firstCardClass, firstCardValue, hasNS ? nsUrl : sbnUrl));
      cards.appendChild(vocabCardLinked('GND', 'vc-gnd', cl.de || null, gndUrl));
      cards.appendChild(vocabCardLinked('IdRef', 'vc-idr', cl.fr || null, idrefUrl));
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

    // Description: for NS terms, show NS description; for others, show WD description with provenance
    const desc = cachedEntity ? (getDesc(cachedEntity, 'it') || getDesc(cachedEntity, 'en') || '') : '';
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
    } else if (!hasNS && cached?.qid) {
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
      if (!showAllNt && i >= SH) { card.style.display = 'none'; card.setAttribute('data-sn-extra', ''); }
      grid.appendChild(card);
    });
    container.appendChild(grid);
    if (!showAllNt) {
      container.appendChild(el('div', { className: 'show-more', 'data-action': 'showmore', textContent: L.showAll + ' (' + nt.length + ')' }));
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

function renderAndBuilder(container) {
  const allItems = [];
  const seenKeys = new Set();
  function addUnique(r) {
    const keys = [];
    if (r.qid) keys.push('q:' + r.qid);
    if (r.nsData?.id) keys.push('n:' + r.nsData.id);
    if (r.label) keys.push('l:' + r.label.toLowerCase().trim());
    // If any key already seen, skip
    if (keys.some(k => seenKeys.has(k))) return;
    keys.forEach(k => seenKeys.add(k));
    allItems.push(r);
  }
  for (const r of allReconciledResults) addUnique(r);
  for (const r of allNameResults) addUnique(r);
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
    const origLabel = r.label || '?';
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
  container._allItems = allItems;
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

  const urlSub = selected.length >= 2 ? buildCrossAndUrl(selected, 'subject') : buildCatUrl(selected[0].entity, selected[0].nsData?.label, selected[0].mergedLabels || selected[0].controlledLabels, 'subject');
  const urlAny = selected.length >= 2 ? buildCrossAndUrl(selected, 'broad') : buildCatUrl(selected[0].entity, selected[0].nsData?.label, selected[0].mergedLabels || selected[0].controlledLabels, 'broad');

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
    else if (a === 'showmore') { t.style.display = 'none'; sidebar.querySelectorAll('[data-sn-extra]').forEach(el => el.style.display = ''); }
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
