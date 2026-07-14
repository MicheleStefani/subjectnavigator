// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 7/7): orchestration and lifecycle — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
// ═══ SHADOW HOST SETUP ═══
// See cs_core.js for the rationale (closed shadow root). The CSS is read
// once from the package and injected as a <style> inside the shadow root.
let snCssText = null;
async function ensureHost() {
  if (snRoot && snHost && snHost.isConnected) return;
  if (snHost && !snHost.isConnected) { document.body.appendChild(snHost); return; }
  snHost = document.createElement('div');
  snHost.id = 'sn-host';
  snRoot = snHost.attachShadow({ mode: 'closed' });
  if (snCssText === null) {
    try {
      const resp = await fetch(chrome.runtime.getURL('sidebar.css'));
      snCssText = resp.ok ? await resp.text() : '';
    } catch (e) { logDebug('css load', e); snCssText = ''; }
  }
  const style = document.createElement('style');
  style.textContent = snCssText;
  snRoot.appendChild(style);
  document.body.appendChild(snHost);
}

let isLoading = false;
let pendingUrl = null; // URL that arrived while a load was in progress

// Wrapper: guarantees the isLoading reset even on unexpected exceptions
// (previously the extension stayed stuck until a page reload) and retries
// the last URL that arrived while a load was in progress (previously a
// navigation during a slow load was lost).
async function loadRecord(url) {
  const pre = parsePageUrl(url);
  if (!pre.isFullDisplay || !pre.docId) { removeSidebar(); return; }
  if (pre.docId === currentDocId) return;
  if (isLoading) { pendingUrl = url; return; }
  isLoading = true;
  try {
    await ensureHost();
    await loadRecordInner(url);
  } catch (e) {
    logDebug('loadRecord', e);
    removeSidebar();
  } finally {
    isLoading = false;
    const u = pendingUrl;
    pendingUrl = null;
    if (u && u !== url) loadRecord(u);
  }
}

async function loadRecordInner(url) {
  const { docId, vid, instCode, mmsId, isFullDisplay, lang } = parsePageUrl(url);
  if (!isFullDisplay || !docId) { removeSidebar(); return; }
  if (docId === currentDocId) return;
  currentDocId = docId;
  setLang(lang);
  RC.clear(); HC.clear();
  navState = { history: [], currentIndex: -1 };
  allReconciledResults = [];
  removeSidebar();

  // Load theme preference
  try { const stored = await chrome.storage.local.get('snTheme'); if (stored.snTheme) themeMode = stored.snTheme; } catch (e) { logDebug('storage.get snTheme', e); }

  // Start loading NS index in background
  loadNSIndex();

  // Search context
  const pageHost = window.location.hostname;
  const pp = new URLSearchParams(window.location.search);
  searchCtx = {
    host: pageHost,
    vid: vid || '41SLSP_NETWORK:VU1_UNION',
    tab: pp.get('tab') || (vid.includes('NETWORK') ? '41SLSP_NETWORK' : instCode + '_MyInst_and_CI'),
    scope: pp.get('search_scope') || (vid.includes('NETWORK') ? 'DN_and_CI' : 'MyInst_and_CI')
  };

  // Build sidebar DOM (no innerHTML!)
  const sidebar = el('div', { id: 'sn-sidebar', className: 'sn-hidden' });
  const header = el('div', { className: 'sn-header' });
  const headerLeft = el('div');
  headerLeft.appendChild(el('span', { className: 'sn-title', textContent: 'Subject Navigator' }));
  headerLeft.appendChild(el('span', { className: 'sn-version', textContent: 'v1.1.1' }));

  // NS index status indicator
  const nsStatusEl = el('span', { className: 'ns-status' + (nsIndexStatus === 'ready' ? '' : ' loading'), textContent: nsIndexStatus === 'ready' ? L.nsIndex : L.nsLoading, style: { marginLeft: '6px' } });
  headerLeft.appendChild(nsStatusEl);

  const headerRight = el('div', { style: { display: 'flex', gap: '4px' } });
  // Feedback link — shown only when a real URL has been configured.
  // Replace the placeholder below with the real form URL before publishing.
  const FEEDBACK_URL = 'https://forms.gle/YOUR_FORM_ID_HERE';
  const feedbackEnabled = FEEDBACK_URL && !FEEDBACK_URL.includes('YOUR_FORM_ID_HERE');
  if (feedbackEnabled) {
    headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'openurl', 'data-url': FEEDBACK_URL, title: 'Feedback', 'aria-label': 'Invia feedback', textContent: '\u2709' }));
  }
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'toggleabout', title: 'About & data sources', 'aria-label': 'About', textContent: '\u24d8' }));
  headerRight.appendChild(el('button', { className: 'sn-theme-btn', 'data-action': 'cycletheme', title: 'Theme', 'aria-label': 'Cambia tema', textContent: themeMode === 'auto' ? L.themeAuto : themeMode === 'light' ? L.themeLight : L.themeDark }));
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'togglewide', title: L.widen, 'aria-label': L.widen, textContent: '\u2922' }));
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'close', title: L.close, 'aria-label': L.close, textContent: '\u2715' }));
  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  // About / data sources popover (appended to header so it positions relative to it)
  const aboutPopover = el('div', { className: 'sn-about-popover' });
  aboutPopover.appendChild(el('div', { className: 'sn-about-title', textContent: 'Data sources' }));
  const srcLine = el('div', { className: 'sn-about-sources' });
  [
    ['NS',        'BNCF',                          'https://thes.bncf.firenze.sbn.it'],
    ['GND',           'DNB \u2013 CC0',                 'https://explore.gnd.network/en/'],
    ['RAMEAU/IdRef',  'BnF/ABES \u2013 Licence Ouverte 2.0', 'https://data.bnf.fr'],
    ['LCSH',          'Library of Congress',            'https://id.loc.gov'],
    ['BNE',           'Bibl. Nacional de Espa\u00f1a',  'https://datos.bne.es'],
    ['Wikidata',      'CC0',                            'https://www.wikidata.org'],
  ].forEach(([name, detail, url], i) => {
    if (i > 0) srcLine.appendChild(txt(' \u00b7 '));
    srcLine.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: detail, textContent: name }));
  });
  aboutPopover.appendChild(srcLine);
  aboutPopover.appendChild(el('div', { className: 'sn-about-lic', textContent: 'Subject Navigator \u2014 MIT License' }));
  aboutPopover.appendChild(el('div', { className: 'sn-about-lic', textContent: 'Privacy: nessun dato personale \u00e8 raccolto; i termini dei record consultati sono inviati alle fonti elencate per l\u2019arricchimento.' }));
  header.appendChild(aboutPopover);

  sidebar.appendChild(header);

  const body = el('div', { className: 'sn-body', id: 'sn-body' });
  body.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.fetchingMarc }));
  sidebar.appendChild(body);
  snRoot.appendChild(sidebar);
  applyTheme();
  setupDelegation(sidebar);

  // Wait for NS index if still loading (3 s cap — the first load is from
  // the packaged JSON, successive loads hit IndexedDB and complete in tens
  // of ms; 3 s is plenty to cover the cold-start case)
  if (nsIndexStatus === 'loading') {
    const waitStart = Date.now();
    while (nsIndexStatus === 'loading' && Date.now() - waitStart < 3000) {
      await new Promise(r => setTimeout(r, 100));
    }
    nsStatusEl.textContent = nsIndexStatus === 'ready' ? L.nsIndex : 'NS \u2717';
    nsStatusEl.className = 'ns-status' + (nsIndexStatus === 'ready' ? '' : ' error');
  }

  let marcFields;
  try {
    const result = await bgFetchMarc({ docId, mmsId, vid, instCode, pageHost });
    if (!result?.fields?.length) { removeSidebar(); return; }
    marcFields = result.fields;
  } catch (e) { removeSidebar(); return; }

  const { sbt, gnd, idr, names, cduClasses, cddClasses } = extractAll(marcFields);
  const subjCount = sbt.length + gnd.length + idr.length;
  const classCount = cduClasses.length + cddClasses.length;
  if (!subjCount && !names.length && !classCount) { removeSidebar(); return; }
  createBadge(subjCount + names.length);

  // Guard: if the sidebar was removed while awaiting the MARC fetch (URL change
  // or navigation during the async wait), abort gracefully instead of crashing.
  const bodyEl = byId('sn-body');
  if (!bodyEl) return;
  clearEl(bodyEl);

  // Tabs — role=tablist with role=tab for accessibility
  const mtabs = el('div', { className: 'mtabs', role: 'tablist',
    'aria-label': L.subjects + ' / ' + L.navigate });
  const tab0 = el('div', { className: 'mt on', 'data-action': 'switchmt', 'data-idx': '0',
    role: 'tab', tabindex: '0', 'aria-selected': 'true', id: 'sn-mt-0' });
  tab0.appendChild(txt(L.subjects + ' '));
  tab0.appendChild(el('span', { className: 'badge', textContent: String(subjCount) }));
  mtabs.appendChild(tab0);
  mtabs.appendChild(el('div', { className: 'mt', 'data-action': 'switchmt', 'data-idx': '1',
    role: 'tab', tabindex: '-1', 'aria-selected': 'false', id: 'sn-mt-1',
    textContent: L.navigate }));
  if (names.length) {
    const tab2 = el('div', { className: 'mt', 'data-action': 'switchmt', 'data-idx': '2',
      role: 'tab', tabindex: '-1', 'aria-selected': 'false', id: 'sn-mt-2' });
    tab2.appendChild(txt(L.people + ' '));
    tab2.appendChild(el('span', { className: 'badge', textContent: String(names.length) }));
    mtabs.appendChild(tab2);
  }
  if (classCount) {
    const clsIdx = names.length ? '3' : '2';
    const tabCls = el('div', { className: 'mt', 'data-action': 'switchmt',
      'data-idx': clsIdx,
      role: 'tab', tabindex: '-1', 'aria-selected': 'false', id: 'sn-mt-' + clsIdx });
    tabCls.appendChild(txt(L.classification + ' '));
    tabCls.appendChild(el('span', { className: 'badge', textContent: String(classCount) }));
    mtabs.appendChild(tabCls);
  }
  bodyEl.appendChild(mtabs);

  // TAB 0: Subjects
  const tab0Body = el('div', { className: 'mtb on', role: 'tabpanel',
    'aria-labelledby': 'sn-mt-0' });
  const vocTabs = [];
  if (sbt.length) vocTabs.push({ id: 'sbt', label: 'SBT/NS', count: sbt.length });
  if (gnd.length) vocTabs.push({ id: 'gnd', label: 'GND', count: gnd.length });
  if (idr.length) vocTabs.push({ id: 'idr', label: 'IdRef', count: idr.length });

  if (vocTabs.length > 1) {
    const vtabs = el('div', { className: 'vtabs', role: 'tablist',
      'aria-label': 'Vocabolari' });
    vocTabs.forEach((vt, i) => {
      const vtEl = el('div', { className: 'vt' + (i === 0 ? ' on' : ''),
        'data-action': 'switchvt', 'data-idx': String(i),
        role: 'tab', tabindex: i === 0 ? '0' : '-1',
        'aria-selected': i === 0 ? 'true' : 'false',
        id: 'sn-vt-' + i });
      vtEl.appendChild(txt(vt.label + ' '));
      vtEl.appendChild(el('span', { className: 'cnt', textContent: String(vt.count) }));
      vtabs.appendChild(vtEl);
    });
    tab0Body.appendChild(vtabs);
  }

  vocTabs.forEach((vt, i) => {
    const vtb = el('div', { className: 'vtb' + (i === 0 ? ' on' : ''),
      role: 'tabpanel', 'aria-labelledby': 'sn-vt-' + i });
    const items = vt.id === 'sbt' ? sbt : vt.id === 'gnd' ? gnd : idr;
    items.forEach((item, j) => {
      const vc = vt.id === 'sbt' ? 'v-ns' : vt.id === 'gnd' ? 'v-gnd' : 'v-idr';
      const sc = el('div', { className: 'sc' });
      const scHead = el('div', { className: 'sc-head' });
      scHead.appendChild(el('div', { className: 'sc-label', textContent: item.display }));
      scHead.appendChild(el('span', { className: 'sc-voc ' + vc, textContent: item.vocab || vt.label }));
      sc.appendChild(scHead);
      if (vt.id === 'sbt') {
        sc.appendChild(el('div', { className: 'chips', id: 'sn-chips-' + i + '-' + j }));
        sc.appendChild(el('div', { id: 'sn-and-' + i + '-' + j }));
      }
      sc.appendChild(el('div', { id: 'sn-det-' + vt.id + '-' + j }));
      vtb.appendChild(sc);
    });
    tab0Body.appendChild(vtb);
  });
  bodyEl.appendChild(tab0Body);

  // TAB 1: Navigate + AND Builder
  const tab1Body = el('div', { className: 'mtb', role: 'tabpanel',
    'aria-labelledby': 'sn-mt-1' });
  tab1Body.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--sn-t2)', marginBottom: '6px' }, textContent: L.navHint }));
  tab1Body.appendChild(el('div', { className: 'nav-sel', id: 'sn-navSel' }));
  tab1Body.appendChild(el('div', { id: 'sn-navTree' }));
  const crossAndDiv = el('div', { id: 'sn-crossAnd', style: { marginTop: '12px', paddingTop: '8px', borderTop: '0.5px solid var(--sn-bl)' } });
  tab1Body.appendChild(crossAndDiv);
  bodyEl.appendChild(tab1Body);

  // TAB 2: People
  if (names.length) {
    const tab2Body = el('div', { className: 'mtb', role: 'tabpanel',
      'aria-labelledby': 'sn-mt-2' });
    names.forEach((n, i) => {
      const kind = n.kind || 'person';
      // Role label: persons keep the existing logic (Author/Editor/Contributor).
      // For corporate bodies and meetings we lead with the kind name so the
      // user immediately sees what this responsibility represents; the raw
      // $e/$4 relator code (if any) follows after an em-dash.
      let roleL;
      if (kind === 'corporate') {
        roleL = n.role ? (L.kindCorporate + ' \u2014 ' + n.role) : L.kindCorporate;
      } else if (kind === 'meeting') {
        roleL = n.role ? (L.kindMeeting + ' \u2014 ' + n.role) : L.kindMeeting;
      } else {
        roleL = n.role === 'edt' ? L.editor : n.tag === '100' ? L.author : L.contributor;
      }
      const pcard = el('div', { className: 'pcard pcard-' + kind });
      // Avatar: initials for persons, first letter for corporate bodies,
      // "§" glyph for meetings. Palette stays uniform; only border-radius
      // and glyph size change (see sidebar.css .p-av-corporate / .p-av-meeting).
      let avatarText;
      if (kind === 'person') avatarText = initials(n.name);
      else if (kind === 'corporate') avatarText = (cleanName(n.name).trim()[0] || '?').toUpperCase();
      else avatarText = '\u00A7';
      pcard.appendChild(el('div', { className: 'p-av p-av-' + kind, textContent: avatarText }));
      const pinfo = el('div', { className: 'p-info' });
      pinfo.appendChild(el('div', { className: 'p-name', textContent: n.display }));
      pinfo.appendChild(el('div', { className: 'p-role', textContent: roleL + ' (' + n.tag + ')' }));
      pinfo.appendChild(el('div', { id: 'sn-det-name-' + i }));
      pcard.appendChild(pinfo);
      tab2Body.appendChild(pcard);
    });
    bodyEl.appendChild(tab2Body);
  }

  // TAB Classificazione
  if (classCount) {
    const clsTabIdx = names.length ? 3 : 2;
    const clsBody = el('div', { className: 'mtb', id: 'sn-clsBody',
      role: 'tabpanel', 'aria-labelledby': 'sn-mt-' + clsTabIdx });
    const lang = L === I18N.de ? 'de' : L === I18N.fr ? 'fr' : L === I18N.en ? 'en' : 'it';

    // UDC and DDC sections — as vtabs
    const clsVtabs = (cduClasses.length && cddClasses.length)
      ? el('div', { className: 'vtabs' }) : null;

    if (clsVtabs) {
      const vt0 = el('div', { className: 'vt cls-vt on', 'data-action': 'switchvt-cls', 'data-idx': '0' });
      vt0.appendChild(txt('CDU '));
      vt0.appendChild(el('span', { className: 'cnt', textContent: String(cduClasses.length) }));
      const vt1 = el('div', { className: 'vt cls-vt', 'data-action': 'switchvt-cls', 'data-idx': '1' });
      vt1.appendChild(txt('CDD '));
      vt1.appendChild(el('span', { className: 'cnt', textContent: String(cddClasses.length) }));
      clsVtabs.appendChild(vt0);
      clsVtabs.appendChild(vt1);
      clsBody.appendChild(clsVtabs);
    }

    // UDC section — 'on' when it is the first visible section (with or without vtabs)
    var cduBodyEl = null;
    if (cduClasses.length) {
      cduBodyEl = el('div', { className: 'vtb cls-vtb on' });
      clsBody.appendChild(cduBodyEl);
    }

    // DDC section — 'on' only when there is no UDC (then it is the first section)
    var cddBodyEl = null;
    if (cddClasses.length) {
      cddBodyEl = el('div', { className: 'cls-vtb vtb' + (cduClasses.length ? '' : ' on') });
      clsBody.appendChild(cddBodyEl);
    }

    // Capture the variables explicitly for the async closure
    var _cduItems = cduClasses.slice();
    var _cddItems = cddClasses.slice();
    var _cduTarget = cduBodyEl;
    var _cddTarget = cddBodyEl;
    var _ctx = searchCtx;
    var _lang = lang;

    // Always populate the sections asynchronously (setTimeout guarantees a stable DOM)
    function _populateClassCards() {
      if (_cduTarget) {
        _cduItems.forEach(function(item) {
          try {
            var card = renderClassCard(item.num, VOCAB_CDU, VOCAB_GEO, _ctx, 'cdu', _lang);
            _cduTarget.appendChild(card);
          } catch(e) {
            console.error('CDU renderClassCard error for', item.num, e);
          }
        });
      }
      if (_cddTarget) {
        _cddItems.forEach(function(item) {
          try {
            var card = renderClassCard(item.num, VOCAB_CDD, VOCAB_GEO, _ctx, 'cdd', _lang);
            _cddTarget.appendChild(card);
          } catch(e) {
            console.error('CDD renderClassCard error for', item.num, e);
          }
        });
      }
    }
    // Always async: if vocabReady fires immediately, setTimeout(0) defers
    // by one tick, guaranteeing the DOM is fully built and appended
    onVocabReady(function() { setTimeout(_populateClassCards, 0); });

    bodyEl.appendChild(clsBody);

    // vtabs switching for the classification tab (scoped to clsBody)
    if (clsVtabs) {
      clsVtabs.addEventListener('click', e => {
        const vt = e.target.closest('[data-action="switchvt-cls"]');
        if (!vt) return;
        const idx = parseInt(vt.dataset.idx);
        clsVtabs.querySelectorAll('.vt').forEach((v,i) => v.classList.toggle('on', i===idx));
        // Only the vtb direct children of clsBody
        clsBody.querySelectorAll('.cls-vtb')
          .forEach((v,i) => v.classList.toggle('on', i===idx));
      });
    }
  }

  // ═══ POPULATE (parallel blocks) ═══
  const sbtIdx = vocTabs.findIndex(v => v.id === 'sbt');

  // Each block runs as an async function, returns { terms, names } arrays.
  // Blocks write to their own DOM containers (no conflicts) and local arrays.
  // After all complete, results are merged for nav chips and AND builder.

  // ── SBT block ──
  async function populateSBT() {
    const localTerms = [], localNames = [];
    for (let j = 0; j < sbt.length; j++) {
      const item = sbt[j];
      const detEl = byId('sn-det-sbt-' + j);
      if (!detEl) continue;
      if (item.isName) {
        // Name-as-subject (600/610/611): the root name is reconciled as a
        // person, corporate body or meeting, and any subdivisions ($x, $z,
        // $y, $v) are emitted as additional chips following the same semantic
        // typing used for regular subject strings (650/651). This way an
        // entry like "Picasso, Pablo — Cataloghi di esposizioni" exposes
        // both Picasso and "Cataloghi di esposizioni" as navigable terms,
        // the latter with its full NS/GND/RAMEAU/LCSH multilingual cluster.
        const comps = nameC(item.subs, item.kind || 'person');
        const mainComps = comps.filter(c => c.type !== 'v');
        const formComps = comps.filter(c => c.type === 'v');
        const orderedComps = [...mainComps, ...formComps];
        const chipsEl = byId('sn-chips-' + sbtIdx + '-' + j);
        const andEl = byId('sn-and-' + sbtIdx + '-' + j);
        if (chipsEl && orderedComps.length) {
          const cr = [];
          orderedComps.forEach((comp, ci) => {
            const isForm = comp.type === 'v';
            const chip = el('span', { className: 'chip' + (ci === 0 ? ' on' : '') + (isForm ? ' chip-form' : ''), role: isForm ? undefined : 'button', tabindex: isForm ? undefined : '0', 'aria-pressed': (ci === 0 && !isForm) ? 'true' : (isForm ? undefined : 'false') });
            const cc = { a: 'ct-a', x: 'ct-x', z: 'ct-z', y: 'ct-y', v: 'ct-v' }[comp.type] || 'ct-x';
            chip.appendChild(el('span', { className: 'chip-type ' + cc, textContent: '$' + comp.type }));
            chip.appendChild(txt(comp.t));
            if (!isForm) {
              chip.addEventListener('click', async () => {
                chipsEl.querySelectorAll('.chip').forEach(c => {
                  c.classList.remove('on');
                  if (c.hasAttribute('aria-pressed')) c.setAttribute('aria-pressed', 'false');
                });
                chip.classList.add('on');
                if (chip.hasAttribute('aria-pressed')) chip.setAttribute('aria-pressed', 'true');
                // Root chip (type 'a') reconciles as a person (via the
                // configured kind); subdivisions use the regular semantic
                // typing: $x = topic, $z = place, $y = period.
                const clickTT = ci === 0 ? 'person'
                              : comp.type === 'z' ? 'place'
                              : comp.type === 'y' ? 'period'
                              : 'topic';
                await renderTermDetailSafe(detEl, comp.t, null, null, 'sbt', clickTT);
              });
            } else {
              chip.title = L.typeForm || 'form';
            }
            if (!isForm) {
              chip.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); chip.click(); }
              });
            }
            chipsEl.appendChild(chip);
          });
          // Auto-render the root chip: reconciled as person for all name
          // kinds (shared authority file, as discussed) — the specific
          // kind is carried on the item for any downstream rendering.
          const fr = await renderTermDetailSafe(detEl, orderedComps[0].t, null, null, 'sbt', 'person');
          fr.label = orderedComps[0].t;
          fr.termType = 'person';
          cr.push(fr);
          localNames.push(fr);
          // Reconcile the subdivisions and add them to localTerms so they
          // are available in the Naviga tab and in the combined-search
          // builder. Periods and forms are added without reconciliation,
          // mirroring the 650/651 path.
          for (let ci = 1; ci < orderedComps.length; ci++) {
            if (orderedComps[ci].type === 'y') {
              const pr = { label: orderedComps[ci].t, qid: null, entity: null, controlledLabels: { it: orderedComps[ci].t }, nsData: null, dewey: null, termType: 'period', vocabSource: 'sbt' };
              cr.push(pr);
              localTerms.push(pr);
            } else if (orderedComps[ci].type === 'v') {
              const pr = { label: orderedComps[ci].t, qid: null, entity: null, controlledLabels: { it: orderedComps[ci].t }, nsData: null, dewey: null, termType: 'form', vocabSource: 'sbt' };
              cr.push(pr);
              localTerms.push(pr);
            } else {
              const compTT = orderedComps[ci].type === 'z' ? 'place' : 'topic';
              const r = await safeReconcile(orderedComps[ci].t, null, null, 'sbt', compTT);
              r.label = orderedComps[ci].t;
              r.termType = compTT;
              cr.push(r);
              localTerms.push(r);
            }
          }
          // Per-string AND button: combines the root name with the
          // non-period non-form subdivisions. A search like
          // "Picasso, Pablo" AND "Cataloghi di esposizioni" in all
          // available languages is exactly what the user asked for.
          const sc = orderedComps.filter((c, ci) => c.type !== 'y' && c.type !== 'v' && cr[ci]);
          if (sc.length >= 2 && andEl) {
            const lgG = {};
            LANGS.forEach(l => { lgG[l] = []; });
            orderedComps.forEach((c, ci) => {
              if (c.type === 'y' || c.type === 'v') return;
              const r = cr[ci];
              if (!r) return;
              const cl = r.controlledLabels || {};
              const e = r.entity;
              LANGS.forEach(l => { const lb = getPrefLabel(cl, e, l); if (lb) lgG[l].push('"' + lb + '"'); });
            });
            const parts = [];
            Object.entries(lgG).forEach(([l, terms]) => { if (terms.length >= 2) parts.push('(' + terms.join(' AND ') + ')'); });
            if (parts.length) {
              const url = buildSearchUrl(parts.join(' OR '), 'subject');
              const acts = el('div', { className: 'acts', style: { marginTop: '4px' } });
              acts.appendChild(el('button', { className: 'act act-and', 'data-action': 'openurl', 'data-url': url, textContent: 'AND: ' + sc.map(c => c.t).join(' + ') }));
              andEl.appendChild(acts);
            }
          }
        } else {
          // Fallback for degenerate cases (no components extracted): behave
          // like before — reconcile the display string as a person.
          const r = await renderTermDetailSafe(detEl, item.display, null, null, 'sbt', 'person');
          r.label = cleanName(item.display);
          r.termType = 'person';
          localNames.push(r);
        }
      } else {
        const comps = sbtC(item.subs);
        // Reorder components so that form subfields ($v) appear at the end,
        // preserving the original order within each group. The primary term
        // (first $a/$x/$z/$y) must remain the first chip because it drives
        // the initial auto-rendered detail.
        const mainComps = comps.filter(c => c.type !== 'v');
        const formComps = comps.filter(c => c.type === 'v');
        const orderedComps = [...mainComps, ...formComps];
        const chipsEl = byId('sn-chips-' + sbtIdx + '-' + j);
        const andEl = byId('sn-and-' + sbtIdx + '-' + j);
        if (chipsEl) {
          const cr = [];
          orderedComps.forEach((comp, ci) => {
            const isForm = comp.type === 'v';
            const chip = el('span', { className: 'chip' + (ci === 0 ? ' on' : '') + (isForm ? ' chip-form' : ''), role: isForm ? undefined : 'button', tabindex: isForm ? undefined : '0', 'aria-pressed': (ci === 0 && !isForm) ? 'true' : (isForm ? undefined : 'false') });
            const cc = { a: 'ct-a', x: 'ct-x', z: 'ct-z', y: 'ct-y', v: 'ct-v' }[comp.type] || 'ct-x';
            chip.appendChild(el('span', { className: 'chip-type ' + cc, textContent: '$' + comp.type }));
            chip.appendChild(txt(comp.t));
            // Form subfields ($v) are shown but NOT individually searchable:
            // a standalone search for "Guide" or "Manuali" would return noise.
            // They remain available in the combined-search builder (Naviga tab).
            if (!isForm) {
              chip.addEventListener('click', async () => {
                chipsEl.querySelectorAll('.chip').forEach(c => {
                  c.classList.remove('on');
                  if (c.hasAttribute('aria-pressed')) c.setAttribute('aria-pressed', 'false');
                });
                chip.classList.add('on');
                if (chip.hasAttribute('aria-pressed')) chip.setAttribute('aria-pressed', 'true');
                const clickTT = comp.type === 'z' ? 'place' : (comp.type === 'a' && item.tag === '651') ? 'place' : comp.type === 'y' ? 'period' : 'topic';
                await renderTermDetailSafe(detEl, comp.t, null, null, 'sbt', clickTT);
              });
            } else {
              chip.title = L.typeForm || 'form';
            }
            if (!isForm) {
              chip.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); chip.click(); }
              });
            }
            chipsEl.appendChild(chip);
          });
          const firstTT = orderedComps[0].type === 'z' ? 'place' : (orderedComps[0].type === 'a' && item.tag === '651') ? 'place' : orderedComps[0].type === 'y' ? 'period' : 'topic';
          const fr = await renderTermDetailSafe(detEl, orderedComps[0].t, null, null, 'sbt', firstTT);
          fr.label = orderedComps[0].t;
          fr.termType = firstTT;
          cr.push(fr);
          localTerms.push(fr);
          for (let ci = 1; ci < orderedComps.length; ci++) {
            if (orderedComps[ci].type === 'y') {
              const pr = { label: orderedComps[ci].t, qid: null, entity: null, controlledLabels: { it: orderedComps[ci].t }, nsData: null, dewey: null, termType: 'period', vocabSource: 'sbt' };
              cr.push(pr);
              localTerms.push(pr);
            } else if (orderedComps[ci].type === 'v') {
              // Form subfield: add as a lightweight entry so it is available
              // in the combined-search builder, but without reconciliation
              // (no WD/NS lookup — it is a document form, not a subject).
              const pr = { label: orderedComps[ci].t, qid: null, entity: null, controlledLabels: { it: orderedComps[ci].t }, nsData: null, dewey: null, termType: 'form', vocabSource: 'sbt' };
              cr.push(pr);
              localTerms.push(pr);
            } else {
              const compTT = orderedComps[ci].type === 'z' ? 'place' : orderedComps[ci].type === 'y' ? 'period' : 'topic';
              const r = await safeReconcile(orderedComps[ci].t, null, null, 'sbt', compTT);
              r.label = orderedComps[ci].t;
              r.termType = compTT;
              cr.push(r);
              if (orderedComps[ci].type === 'a' || orderedComps[ci].type === 'z' || orderedComps[ci].type === 'x') localTerms.push(r);
            }
          }
          // SBT-level AND button: excludes period ($y) and form ($v).
          // Period-only terms do not translate across vocabularies.
          // Form ($v) is a document genre, not a subject: including it in the
          // per-string AND would produce a search that is mostly useless on its own.
          const sc = orderedComps.filter((c, ci) => c.type !== 'y' && c.type !== 'v' && cr[ci]);
          if (sc.length >= 2 && andEl) {
            const lgG = {};
            LANGS.forEach(l => { lgG[l] = []; });
            orderedComps.forEach((c, ci) => {
              if (c.type === 'y' || c.type === 'v') return;
              const r = cr[ci];
              if (!r) return;
              const cl = r.controlledLabels || {};
              const e = r.entity;
              LANGS.forEach(l => { const lb = getPrefLabel(cl, e, l); if (lb) lgG[l].push('"' + lb + '"'); });
            });
            const parts = [];
            Object.entries(lgG).forEach(([l, terms]) => { if (terms.length >= 2) parts.push('(' + terms.join(' AND ') + ')'); });
            if (parts.length) {
              const url = buildSearchUrl(parts.join(' OR '), 'subject');
              const acts = el('div', { className: 'acts', style: { marginTop: '4px' } });
              acts.appendChild(el('button', { className: 'act act-and', 'data-action': 'openurl', 'data-url': url, textContent: 'AND: ' + sc.map(c => c.t).join(' + ') }));
              andEl.appendChild(acts);
            }
          }
        }
      }
    }
    return { terms: localTerms, names: localNames };
  }

  // ── Concurrency limiter: max N parallel reconciliations per block ──
  // Avoids hammering external endpoints (lobid, idref, WD SPARQL) simultaneously.
  async function runWithConcurrency(tasks, limit) {
    const results = new Array(tasks.length);
    let idx = 0;
    async function worker() {
      while (idx < tasks.length) {
        const i = idx++;
        results[i] = await tasks[i]();
      }
    }
    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  // ── Render with error fallback: shows localised message on network failure ──
  async function renderTermDetailSafe(container, term, gndId, idrefId, vocabSource, termType) {
    try {
      return await renderTermDetail(container, term, gndId, idrefId, vocabSource, termType);
    } catch (e) {
      clearEl(container);
      const isTimeout = e.message === 'TIMEOUT' || e.message?.includes('timeout') || e.message?.includes('aborted');
      container.appendChild(el('div', {
        className: 'status err',
        role: 'alert',
        'aria-live': 'assertive',
        textContent: L.fetchError + (isTimeout ? '' : ' (' + (e.message || '') + ')')
      }));
      // Return a minimal result so callers don't crash
      return { qid: null, entity: null, route: [], nsData: null, dewey: null,
               controlledLabels: {}, gndId: gndId || null, idrefId: idrefId || null,
               label: term, termType: termType || null };
    }
  }

  // ── GND block ──
  async function populateGND() {
    const localTerms = [], localNames = [];
    const tasks = gnd.map((item, j) => async () => {
      const el2 = byId('sn-det-gnd-' + j);
      if (!el2) return;
      const gndTT = item.isName ? 'person' : item.tag === '651' ? 'place' : item.tag === '648' ? 'period' : 'topic';
      const r = await renderTermDetailSafe(el2, item.term || item.display, item.gndId, null, 'gnd', gndTT);
      r.label = item.display;
      r.termType = gndTT;
      if (item.isName) { localNames.push(r); } else { localTerms.push(r); }
    });
    await runWithConcurrency(tasks, 3);
    return { terms: localTerms, names: localNames };
  }

  // ── IdRef block ──
  async function populateIdRef() {
    const localTerms = [], localNames = [];
    const tasks = idr.map((item, j) => async () => {
      const el2 = byId('sn-det-idr-' + j);
      if (!el2) return;
      const idrTT = item.isName ? 'person' : item.tag === '651' ? 'place' : 'topic';
      const r = await renderTermDetailSafe(el2, item.term || item.display, null, item.idrefId, 'idref', idrTT);
      r.label = item.display;
      r.termType = idrTT;
      if (item.isName) { localNames.push(r); } else { localTerms.push(r); }
    });
    await runWithConcurrency(tasks, 3);
    return { terms: localTerms, names: localNames };
  }

  // ── Names block ──
  async function populateNames() {
    const tasks = names.map((n, j) => async () => {
      const el2 = byId('sn-det-name-' + j);
      if (!el2) return;
      await renderTermDetailSafe(el2, n.name, n.gndId, n.idrefId, n.gndId ? 'gnd' : n.idrefId ? 'idref' : null, 'person');
    });
    await runWithConcurrency(tasks, 3);
    return { terms: [], names: [] };
  }

  // Run all blocks in parallel
  const [sbtRes, gndRes, idrRes] = await Promise.all([
    populateSBT(),
    populateGND(),
    populateIdRef(),
    populateNames()
  ]);

  // Merge results from all blocks
  const rTerms = [...sbtRes.terms, ...gndRes.terms, ...idrRes.terms];
  allNameResults = [...sbtRes.names, ...gndRes.names, ...idrRes.names];

  // Merge and build
  allReconciledResults = rTerms;
  mergeByQid([...allReconciledResults, ...allNameResults]);

  const crossAndEl = byId('sn-crossAnd');
  if (crossAndEl && (rTerms.length + allNameResults.length) >= 2) renderAndBuilder(crossAndEl);

  // Nav chips — dedup by label, QID, and NS tid to avoid duplicates
  const navSelEl = byId('sn-navSel');
  if (navSelEl && rTerms.length) {
    // Clear any residual chips from previous populate cycles (defensive:
    // should already be empty because loadRecord() rebuilds the DOM, but
    // belt-and-suspenders — ensures no chip duplication across races).
    clearEl(navSelEl);
    const unique = [];
    const seenLabels = new Set();
    const seenQids = new Set();
    const seenNsTids = new Set();
    rTerms.forEach(t => {
      const labelKey = (t.label || '').toLowerCase().trim();
      const qid = t.qid || null;
      const nsTid = t.nsData?.id || null;
      // Skip if we've seen this label, QID, or NS tid before
      if (labelKey && seenLabels.has(labelKey)) return;
      if (qid && seenQids.has(qid)) return;
      if (nsTid && seenNsTids.has(nsTid)) return;
      if (labelKey) seenLabels.add(labelKey);
      if (qid) seenQids.add(qid);
      if (nsTid) seenNsTids.add(nsTid);
      unique.push(t);
    });
    unique.forEach((term, i) => {
      const chip = el('span', { className: 'nav-chip' + (i === 0 ? ' on' : ''),
        role: 'button', tabindex: '0',
        'aria-label': L.navigate + ': ' + term.label,
        'aria-pressed': i === 0 ? 'true' : 'false',
        textContent: term.label });
      const handler = async () => {
        navSelEl.querySelectorAll('.nav-chip').forEach(c => {
          c.classList.remove('on');
          c.setAttribute('aria-pressed', 'false');
        });
        chip.classList.add('on');
        chip.setAttribute('aria-pressed', 'true');
        navState = { history: [], currentIndex: -1 };
        const navEl = byId('sn-navTree');
        if (!navEl) return;
        clearEl(navEl);
        navEl.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.loading }));
        let q = term.qid, e = term.entity, u = term.nsData?.uri;
        if (!q && !u) { const r = await safeReconcile(term.label, null, null, null, term.termType || null); q = r.qid; e = r.entity; u = r.nsData?.uri; }
        const rec = recoverAuthIds(term.label, q, getGndFromEntity(e), getIdrefFromEntity(e));
        const gi = rec.gi, ii = rec.ii;
        navPush(term.label, q, e, u, gi, ii);
        const h = await getHierarchy(q, e, u, gi, ii);
        rDynHier(byId('sn-navTree'), h, term.label, q, e, gi, ii);
      };
      chip.addEventListener('click', handler);
      chip.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handler(); }
      });
      navSelEl.appendChild(chip);
    });
    // Auto-navigate first term
    if (unique[0]) {
      const t = unique[0];
      let q = t.qid, e = t.entity, u = t.nsData?.uri;
      if (!q && !u) { const r = await safeReconcile(t.label, null, null, null, t.termType || null); q = r.qid; e = r.entity; u = r.nsData?.uri; }
      const rec = recoverAuthIds(t.label, q, getGndFromEntity(e), getIdrefFromEntity(e));
      const gi = rec.gi, ii = rec.ii;
      navPush(t.label, q, e, u, gi, ii);
      const h = await getHierarchy(q, e, u, gi, ii);
      rDynHier(byId('sn-navTree'), h, t.label, q, e, gi, ii);
    }
  }
}

// ═══════════════════════════════════════════
// SPA + MESSAGES
// ═══════════════════════════════════════════
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'toggleSidebar') {
    const sb = byId('sn-sidebar');
    if (sb) { if (sb.classList.contains('sn-hidden')) expandSidebar(); else collapseSidebar(); }
    else loadRecord(window.location.href);
  }
  if (msg.type === 'checkUrl') checkUrl();
});

function onUrlChange(url) {
  const p = parsePageUrl(url);
  if (p.isFullDisplay && p.docId) loadRecord(url);
  else removeSidebar();
}

let lastUrl = '';
function checkUrl() { const url = window.location.href; if (url !== lastUrl) { lastUrl = url; onUrlChange(url); } }

// URL-change detection (no polling since v1.0.1): the background service
// worker forwards chrome.tabs.onUpdated — which also fires on the SPA's
// history.pushState transitions — as 'checkUrl' messages (see
// background.js). The listeners below cover the residual cases (worker
// cold-start, bfcache restore, back/forward).
window.addEventListener('popstate', checkUrl);
window.addEventListener('hashchange', checkUrl);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkUrl();
});

// Close the about popover when the user clicks outside the extension UI.
// The shadow boundary retargets inner clicks to the host element, so any
// target other than the host is genuinely outside the panel.
document.addEventListener('click', e => {
  if (snHost && e.target !== snHost && !snHost.contains(e.target)) {
    const pop = snRoot ? snRoot.querySelector('.sn-about-popover') : null;
    if (pop) pop.classList.remove('on');
  }
});

checkUrl();
