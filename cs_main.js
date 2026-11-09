// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 8/8): orchestration and lifecycle
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
// «Data sources» box: [name, owner – licence (tooltip), link]. NS is
// CC BY 4.0 and the DNB mappings (GND–NS, GND–LCSH–RAMEAU) CC BY 4.0,
// both need attribution; Getty AAT (Navigate hierarchies) is ODC-By 1.0.
// See DATA_LICENSES.md.
// Feedback button (✉ in the header): the Microsoft Forms form, https only;
// the button is hidden while this holds a placeholder. See PRIVACY.md.
const FEEDBACK_URL = 'https://forms.cloud.microsoft/e/hWzFc2Yc3Y';
const DATA_SOURCES = [
  ['NS',           'BNCF \u2013 CC BY 4.0',                                  'https://thes.bncf.firenze.sbn.it'],
  ['GND',          'DNB \u2013 CC0; GND mappings CC BY 4.0',                 'https://explore.gnd.network/en/'],
  ['RAMEAU/IdRef', 'BnF/ABES \u2013 Licence Ouverte 2.0',                    'https://data.bnf.fr'],
  ['LCSH',         'Library of Congress \u2013 public domain',               'https://id.loc.gov'],
  ['BNE',          'Bibl. Nacional de Espa\u00f1a',                          'https://datos.bne.es'],
  ['Wikidata',     'CC0',                                                    'https://www.wikidata.org'],
  ['Getty AAT',    'J. Paul Getty Trust \u2013 ODC-By 1.0',                  'https://www.getty.edu/research/tools/vocabularies/'],
];
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
      snCssText = await bgResource('sidebar.css');
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
  if (!isRecordPage(pre)) { removeSidebar(); return; }
  if (pre.recordId === currentDocId) return;
  if (isLoading) { pendingUrl = url; return; }
  isLoading = true;
  snRecordT0 = Date.now();
  snRecordId = pre.mmsId || pre.recordId;
  snTiming('record-start', { what: window.location.hostname });
  let outcome = 'ok';
  try {
    await ensureHost();
    await loadRecordInner(url);
  } catch (e) {
    logDebug('loadRecord', e);
    outcome = 'error';
    removeSidebar();
  } finally {
    snTiming('record-end', { ms: Date.now() - snRecordT0, outcome: byId('sn-body') ? outcome : outcome + ', no panel' });
    isLoading = false;
    const u = pendingUrl;
    pendingUrl = null;
    if (u && u !== url) loadRecord(u);
  }
}

async function loadRecordInner(url) {
  const page = parsePageUrl(url);
  if (!isRecordPage(page)) { removeSidebar(); return; }
  const docId = page.recordId, lang = page.lang;
  if (docId === currentDocId) return;
  currentDocId = docId;
  setLang(lang);
  RC.clear(); HC.clear(); SN_CARDS.clear();
  navState = { history: [], currentIndex: -1 };
  allReconciledResults = [];
  removeSidebar();

  // Load theme preference
  try { const stored = await chrome.storage.local.get('snTheme'); if (stored.snTheme) themeMode = stored.snTheme; } catch (e) { logDebug('storage.get snTheme', e); }

  // Start loading NS index in background
  loadNSIndex();

  // Search context (site adapter, cs_site.js)
  searchCtx = siteSearchContext(page);

  // Build sidebar DOM (no innerHTML!)
  const sidebar = el('div', { id: 'sn-sidebar', className: 'sn-hidden' });
  const header = el('div', { className: 'sn-header' });
  const headerLeft = el('div');
  headerLeft.appendChild(el('span', { className: 'sn-title', textContent: 'Subject Navigator' }));
  // Read from the manifest, never written by hand.
  let snVersion = '';
  try { snVersion = chrome.runtime.getManifest().version; } catch (e) { logDebug('manifest version', e); }
  headerLeft.appendChild(el('span', { className: 'sn-version', textContent: snVersion ? 'v' + snVersion : '' }));

  // NS index status indicator
  const nsStatusEl = el('span', { className: 'ns-status' + (nsIndexStatus === 'ready' ? '' : ' loading'), textContent: nsIndexStatus === 'ready' ? L.nsIndex : L.nsLoading, style: { marginLeft: '6px' } });
  headerLeft.appendChild(nsStatusEl);

  const headerRight = el('div', { style: { display: 'flex', gap: '4px' } });
  // Feedback link — shown only when a real URL has been configured.
  const feedbackEnabled = FEEDBACK_URL && !FEEDBACK_URL.includes('YOUR_FORM_ID_HERE');
  if (feedbackEnabled) {
    headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'openurl', 'data-url': FEEDBACK_URL, title: L.sendFeedback, 'aria-label': L.sendFeedback, textContent: '\u2709' }));
  }
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'toggleabout', title: L.aboutSources, 'aria-label': L.about, textContent: '\u24d8' }));
  headerRight.appendChild(el('button', { className: 'sn-theme-btn', 'data-action': 'cycletheme', title: L.theme, 'aria-label': L.changeTheme, textContent: themeMode === 'auto' ? L.themeAuto : themeMode === 'light' ? L.themeLight : L.themeDark }));
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'togglewide', title: L.widen, 'aria-label': L.widen, textContent: '\u2922' }));
  headerRight.appendChild(el('button', { className: 'sn-close', 'data-action': 'close', title: L.close, 'aria-label': L.close, textContent: '\u2715' }));
  header.appendChild(headerLeft);
  header.appendChild(headerRight);

  // About / data sources popover (appended to header so it positions relative to it)
  const aboutPopover = el('div', { className: 'sn-about-popover' });
  aboutPopover.appendChild(el('div', { className: 'sn-about-title', textContent: L.dataSources }));
  const srcLine = el('div', { className: 'sn-about-sources' });
  DATA_SOURCES.forEach(([name, detail, url], i) => {
    if (i > 0) srcLine.appendChild(txt(' \u00b7 '));
    srcLine.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: detail, textContent: name }));
  });
  aboutPopover.appendChild(srcLine);
  aboutPopover.appendChild(el('div', { className: 'sn-about-lic', textContent: 'Subject Navigator \u2014 MIT License' }));
  aboutPopover.appendChild(el('div', { className: 'sn-about-lic', textContent: L.privacyNote }));
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
    const result = await bgFetchMarc(marcRequestParams(page));
    if (!result?.fields?.length) { removeSidebar(); return; }
    marcFields = result.fields;
  } catch (e) { removeSidebar(); return; }

  const { sbt, gnd, idr, names, forms, baamClasses, cddClasses } = extractAll(marcFields);
  // Every GND/IdRef id of the record to Wikidata in one query,
  // before the headings are reconciled one by one (fire-and-forget).
  const wdIds = [...gnd, ...idr, ...names].map(x => ({ gnd: x.gndId || null, idref: x.idrefId || null }))
    .filter(x => x.gnd || x.idref);
  if (wdIds.length) bgMsg({ type: 'prefetchQids', ids: wdIds }).catch(() => {});
  const subjCount = sbt.length + gnd.length + idr.length;
  const classCount = baamClasses.length + cddClasses.length;
  if (!subjCount && !names.length && !classCount && !forms.length) { removeSidebar(); return; }
  createBadge(subjCount + names.length);
  snTiming('panel-visible', { ms: Date.now() - snRecordT0, subjects: subjCount, names: names.length, forms: forms.length });

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
      'aria-label': L.vocabularies });
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
      scHead.appendChild(el('div', { className: 'sc-label', textContent: qualifiedLabel(item.display, item.qual, vt.id) }));
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
  // form/genre (655) as a compact row, apart from the subjects.
  if (forms.length) {
    const fsec = el('div', { className: 'forms-sec' });
    fsec.appendChild(el('div', { className: 'sect-lbl', textContent: L.formsTitle }));
    // badges are added by populateForms(), once the forms table is loaded
    fsec.appendChild(el('div', { className: 'chips', id: 'sn-forms-row' }));
    tab0Body.appendChild(fsec);
  }
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
      const relation = responsibilityLabel(n);
      const roleL = kind === 'corporate' ? L.kindCorporate + ' \u2014 ' + relation
                  : kind === 'meeting' ? L.kindMeeting + ' \u2014 ' + relation
                  : relation;
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
      pinfo.appendChild(el('div', { className: 'p-role', textContent: roleL + ' (' + (n.tags || [n.tag]).join(', ') + ')' }));
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

    // BAAM and DDC sections — as vtabs
    const clsVtabs = (baamClasses.length && cddClasses.length)
      ? el('div', { className: 'vtabs' }) : null;

    if (clsVtabs) {
      const vt0 = el('div', { className: 'vt cls-vt on', 'data-action': 'switchvt-cls', 'data-idx': '0', title: L.classBaamName });
      vt0.appendChild(txt('BAAM '));
      vt0.appendChild(el('span', { className: 'cnt', textContent: String(baamClasses.length) }));
      const vt1 = el('div', { className: 'vt cls-vt', 'data-action': 'switchvt-cls', 'data-idx': '1' });
      vt1.appendChild(txt('CDD '));
      vt1.appendChild(el('span', { className: 'cnt', textContent: String(cddClasses.length) }));
      clsVtabs.appendChild(vt0);
      clsVtabs.appendChild(vt1);
      clsBody.appendChild(clsVtabs);
    }

    // BAAM section — 'on' when it is the first visible section (with or without vtabs)
    var baamBodyEl = null;
    if (baamClasses.length) {
      baamBodyEl = el('div', { className: 'vtb cls-vtb on' });
      clsBody.appendChild(baamBodyEl);
    }

    // DDC section — 'on' only when there is no BAAM class (then it is the first section)
    var cddBodyEl = null;
    if (cddClasses.length) {
      cddBodyEl = el('div', { className: 'cls-vtb vtb' + (baamClasses.length ? '' : ' on') });
      clsBody.appendChild(cddBodyEl);
    }

    // Capture the variables explicitly for the async closure
    var _baamItems = baamClasses.slice();
    var _cddItems = cddClasses.slice();
    var _baamTarget = baamBodyEl;
    var _cddTarget = cddBodyEl;
    var _ctx = searchCtx;
    var _lang = lang;

    // Always populate the sections asynchronously (setTimeout guarantees a stable DOM)
    function _populateClassCards() {
      if (_baamTarget) {
        _baamItems.forEach(function(item) {
          try {
            var card = renderClassCard(item.num, VOCAB_BAAM, VOCAB_GEO, _ctx, 'baam', _lang);
            _baamTarget.appendChild(card);
          } catch(e) {
            console.error('BAAM renderClassCard error for', item.num, e);
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
        const comps = nameC(item.subs, item.kind || 'person', item.workOf);
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
            const cc = { a: 'ct-a', x: 'ct-x', z: 'ct-z', y: 'ct-y', v: 'ct-v', author: 'ct-a' }[comp.type] || 'ct-x';
            // The author chip of a work is named, not coded.
            const typeText = comp.type === 'author' ? (L.author || 'author').toLowerCase() : '$' + comp.type;
            chip.appendChild(el('span', { className: 'chip-type ' + cc, textContent: typeText }));
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
                // typing: $x = topic, $z = place, $y = period. The author
                // chip of a work as a person, body or meeting.
                const clickTT = ci === 0 ? (item.kind || 'person')
                              : comp.type === 'author' ? comp.kind
                              : comp.type === 'z' ? 'place'
                              : comp.type === 'y' ? 'period'
                              : 'topic';
                await renderTermDetailSafe(detEl, comp.term || comp.t, null, null, 'sbt', clickTT);
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
          const rootType = item.kind || 'person';
          const fr = await renderTermDetailSafe(detEl, orderedComps[0].term || orderedComps[0].t, null, null, 'sbt', rootType);
          fr.label = orderedComps[0].t;
          fr.termType = rootType;
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
            } else if (orderedComps[ci].type === 'author') {
              // The author of a work, a name of the record (Naviga,
              // combined search), reconciled as the person/body it is.
              const r = await safeReconcile(orderedComps[ci].t, null, null, 'sbt', orderedComps[ci].kind);
              r.label = orderedComps[ci].t;
              r.termType = orderedComps[ci].kind;
              cr.push(r);
              localNames.push(r);
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
          appendComponentAndButton(andEl, orderedComps, cr);
        } else {
          // Fallback for degenerate cases (no components extracted): behave
          // like before — reconcile the display string as a person.
          const rootType = item.kind || 'person';
          const r = await renderTermDetailSafe(detEl, item.display, null, null, 'sbt', rootType);
          r.label = cleanName(item.display);
          r.termType = rootType;
          localNames.push(r);
        }
      } else {
        const comps = subjectC(item.subs, item.tag);
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
                const clickTT = subjectComponentTermType(comp, item.tag);
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
          const firstTT = subjectComponentTermType(orderedComps[0], item.tag);
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
              const compTT = subjectComponentTermType(orderedComps[ci], item.tag);
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
          appendComponentAndButton(andEl, orderedComps, cr);
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

  // ── GND and IdRef blocks ──
  // One routine for both (two identical copies before); the
  // vocabulary only changes the items, the card ids and the source passed on.
  async function populateAuthority(items, idPrefix, vocabSource) {
    const localTerms = [], localNames = [];
    const tasks = items.map((item, j) => async () => {
      const el2 = byId(idPrefix + j);
      if (!el2) return;
      const tt = item.isName ? (item.kind || 'person') : subjectComponentTermType({ type: 'a' }, item.tag);
      const r = await renderTermDetailSafe(el2, item.term || item.display, item.gndId || null, item.idrefId || null, vocabSource, tt);
      // A work is labelled by its title (its author is another heading).
      r.label = item.workTitle || item.display;
      r.qualifier = item.qual || null;   // shown, never searched
      r.termType = tt;
      if (item.isName) { localNames.push(r); } else { localTerms.push(r); }
    });
    await runWithConcurrency(tasks, 3);
    return { terms: localTerms, names: localNames };
  }
  const populateGND = () => populateAuthority(gnd, 'sn-det-gnd-', 'gnd');
  const populateIdRef = () => populateAuthority(idr, 'sn-det-idr-', 'idref');

  // ── Names block ──
  // The people of the record are kept apart (not in the combined
  // search): only to confirm a work through its author's id.
  async function populateNames() {
    const people = [];
    const tasks = names.map((n, j) => async () => {
      const el2 = byId('sn-det-name-' + j);
      if (!el2) return;
      const r = await renderTermDetailSafe(el2, n.name, n.gndId, n.idrefId, n.gndId ? 'gnd' : n.idrefId ? 'idref' : null, n.kind || 'person');
      if (r) { r.label = r.label || n.display; people.push(r); }
    });
    await runWithConcurrency(tasks, 3);
    return { terms: [], names: [], people };
  }

  // ── Forms block (655): equivalents from the reviewed SLSP table only ──
  // No network: a form in vocab_forms.json gets its official DE/FR/IT(/EN/ES)
  // wordings; any other form stays the record's wording, untranslated.
  // The forms of one table row (one 655 per vocabulary) are
  // one badge and, through formKey, one chip of the combined search.
  async function populateForms() {
    await new Promise(res => onVocabReady(res));
    const row = byId('sn-forms-row');
    const results = [];
    formGroups(forms, VOCAB_FORMS).forEach((g, k) => {
      const v = formGroupView(g);
      if (row) {
        const chip = el('span', { className: 'chip chip-form', title: L.typeForm });
        chip.appendChild(el('b', { textContent: v.title }));
        chip.appendChild(el('span', { className: 'form-voc', textContent: v.vocabs.join(' · ') }));
        if (v.other.length) {
          chip.appendChild(el('span', { className: 'form-tr',
            textContent: v.other.map(([lang, w]) => lang.toUpperCase() + ' ' + w).join(' · ') }));
        }
        row.appendChild(chip);
      }
      for (const f of g.forms) {
        results.push({ label: f.term, termType: 'form', controlledLabels: v.cl, qid: null, entity: null,
                       nsData: null, dewey: null, route: [g.eq ? 'form-table:' + g.eq.status : 'form-literal'],
                       formKey: g.eq ? 'g' + k : null,
                       vocabSource: f.source, gndId: f.gndId || null, idrefId: f.idrefId || null });
      }
    });
    return { terms: results, names: [] };
  }

  // Run all blocks in parallel
  const [sbtRes, gndRes, idrRes, namesRes, formRes] = await Promise.all([
    populateSBT(),
    populateGND(),
    populateIdRef(),
    populateNames(),
    populateForms()
  ]);

  snTiming('subjects-ready', { ms: Date.now() - snRecordT0 });

  // Merge results from all blocks (forms last: refinements, not subjects)
  const rTerms = [...sbtRes.terms, ...gndRes.terms, ...idrRes.terms, ...formRes.terms];
  allNameResults = [...sbtRes.names, ...gndRes.names, ...idrRes.names];

  // name-found Wikidata items confirmed by another heading of
  // the record (same item through an id); their cards are drawn again.
  const recordConfirmed = confirmByRecord([...rTerms, ...allNameResults]);
  // Works found by title, confirmed through their author's id.
  recordConfirmed.push(...confirmWorkByAuthor([...rTerms, ...allNameResults, ...(namesRes.people || [])]));
  // Several IdRef ids in Wikidata — the record's one first.
  preferRecordIdref([...rTerms, ...allNameResults]);
  if (recordConfirmed.length) {
    for (const [c, x] of [...SN_CARDS]) {
      if (recordConfirmed.includes(x.result)) renderTermDetailSafe(c, ...x.args);
    }
  }

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
    const unique = navChipTerms(rTerms);
    unique.forEach((term, i) => {
      const tag = unique.tags?.get(term);
      const chipText = navLabel(term) + (tag ? ' · ' + tag : '');
      const chip = el('span', { className: 'nav-chip' + (i === 0 ? ' on' : ''),
        role: 'button', tabindex: '0',
        'aria-label': L.navigate + ': ' + chipText,
        'aria-pressed': i === 0 ? 'true' : 'false',
        textContent: chipText });
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
        const navT0 = Date.now();
        const sel = term;
        const { q, e, u, gi, ii } = navTarget(term);
        navPush(term.label, q, e, u, gi, ii, sel);
        const h = await getHierarchy(q, e, u, gi, ii);
        rDynHier(byId('sn-navTree'), h, term.label, q, e, gi, ii, sel);
        snTiming('navigate', { what: term.label, ms: Date.now() - navT0 });
      };
      chip.addEventListener('click', handler);
      chip.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); handler(); }
      });
      navSelEl.appendChild(chip);
    });
    // Every Navigate term prepared in the worker now, with the
    // parameters a click uses (one Wikidata and one Getty query for the
    // record); a later click finds its hierarchy ready (fire-and-forget).
    const prep = [];
    for (const t of unique) {
      const { q, u, gi, ii } = navTarget(t);
      if (q || u || gi || ii) prep.push({ qid: q || null, nsUri: u || null, gndId: gi || null, idrefId: ii || null });
    }
    if (prep.length) bgMsg({ type: 'prefetchHierarchies', terms: prep }).catch(() => {});
    // Auto-navigate first term
    if (unique[0]) {
      const t = unique[0];
      const sel = t;
      const { q, e, u, gi, ii } = navTarget(t);
      navPush(t.label, q, e, u, gi, ii, sel);
      const h = await getHierarchy(q, e, u, gi, ii);
      rDynHier(byId('sn-navTree'), h, t.label, q, e, gi, ii, sel);
    }
  }
}

// Navigation chips: one per distinct heading of the record. Only
// identical wordings are merged. Merging by NS concept and QID too would
// hide a heading from another vocabulary when it led to the same
// concept (IdRef «Église» hidden behind GND «Kirche», both NS 767 Chiesa).
// Identical wordings are merged only when they lead to the
// same NS concept (or both to none). The NS «Design» (industrial design) and
// the GND/IdRef «Design» (design in general) are two chips; when a wording
// shows more than once, each chip names its vocabularies (unique.tags).
const NAV_VOCAB = { sbt: 'NS', gnd: 'GND', idref: 'IdRef' };
// What a Navigate chip navigates with — the term's own
// identity, else the ids of the record's headings with the same wording.
// The term is already reconciled (Subjects): it is not reconciled again at
// the click (SBT «Europa» was searched by name a second time, 2.8 s, to
// reach the same unverified hypothesis).
function navTarget(t) {
  let { q, e, u, gi, ii } = navIdentity(t);
  if (!u && !gi && !ii) { const rec = recoverAuthIds(t.label, q, gi, ii); gi = rec.gi; ii = rec.ii; }
  return { q, e, u, gi, ii };
}

// Headings merged into one chip — the chip carries the most
// anchored one: NS concept, then an id of the record, then a confirmed
// Wikidata item, then the rest (SBT «Europa», found by name only, came first
// and hid GND «Europa», reached through its id).
function navAnchor(t) {
  return t.nsData?.id ? 3 : (t.gndId || t.idrefId) ? 2 : hasTrustedQid(t) ? 1 : 0;
}

// The wording shown for a Navigate term: the heading with its qualifier.
function navLabel(t) { return qualifiedLabel(t?.label || '', t?.qualifier, t?.vocabSource); }

function navChipTerms(rTerms) {
  const unique = [];
  const groups = new Map();
  for (const t of rTerms) {
    if (t.termType === 'form') continue;   // a form/genre is not navigated
    // A qualified heading (GND «Architektur <Motiv>») is
    // another word, with its own chip named by its qualifier.
    const word = navLabel(t).toLowerCase().trim();
    const key = word + '|' + (t.nsData?.id || '');
    const voc = NAV_VOCAB[t.vocabSource] || null;
    if (word && groups.has(key)) {
      const g = groups.get(key);
      if (voc) g.vocabs.add(voc);
      if (navAnchor(t) > navAnchor(g.term)) { unique[unique.indexOf(g.term)] = t; g.term = t; }
      continue;
    }
    const g = { term: t, word, vocabs: new Set(voc ? [voc] : []) };
    if (word) groups.set(key, g);
    unique.push(t);
  }
  const perWord = {};
  for (const g of groups.values()) perWord[g.word] = (perWord[g.word] || 0) + 1;
  unique.tags = new Map();
  for (const g of groups.values()) {
    if (perWord[g.word] > 1 && g.vocabs.size) {
      unique.tags.set(g.term, ['NS', 'GND', 'IdRef'].filter(v => g.vocabs.has(v)).join('/'));
    }
  }
  return unique;
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
  if (isRecordPage(p)) loadRecord(url);
  else removeSidebar();
}

let lastUrl = '';
function checkUrl() { const url = window.location.href; if (url !== lastUrl) { lastUrl = url; onUrlChange(url); } }

// URL-change detection (no polling): the background service
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
