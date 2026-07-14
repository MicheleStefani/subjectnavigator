// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 4/7): UDC/DDC classification — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// CLASSIFICAZIONE — helper functions
// ═══════════════════════════════════════════

function classLabel(entry, lang) {
  if (!entry) return '';
  const lb = entry.label;
  if (typeof lb === 'string') return lb;
  return lb[lang] || lb['en'] || lb['it'] || lb['de'] || Object.values(lb)[0] || '';
}

function classLookup(num, vocab, geo) {
  const n = num.trim();
  if (vocab[n]) return vocab[n];
  const s = n.replace(/\.$/, '');
  if (vocab[s]) return vocab[s];
  return null;
}

function classLookupFull(base, rel, vocab) {
  // Try the combined base:rel key first (e.g. "711:504")
  if (rel) {
    const combined = base + ':' + rel;
    if (vocab[combined]) return { key: combined, entry: vocab[combined] };
  }
  // Then the base alone
  if (vocab[base]) return { key: base, entry: vocab[base] };
  // Then the longest prefix
  const candidates = Object.keys(vocab).filter(k => k.startsWith(base + ':') || k.startsWith(base));
  if (candidates.length) {
    const best = candidates.sort((a,b) => b.length - a.length)[0];
    return { key: best, entry: vocab[best] };
  }
  // Walk up to the parent
  let cur = base;
  while (cur.length > 2) {
    cur = cur.includes('.') ? cur.replace(/\.[^.]*$/, '') : cur.slice(0, -1);
    if (vocab[cur]) return { key: cur, entry: vocab[cur] };
  }
  return null;
}

function classChain(num, vocab, geo) {
  // Build the hierarchy chain by walking up the parents
  const chain = [];
  let current = num.trim().replace(/\.$/, '');
  const visited = new Set();
  while (current && !visited.has(current)) {
    visited.add(current);
    const entry = vocab[current];
    if (entry) {
      chain.unshift({ key: current, entry });
      current = entry.parent || null;
    } else break;
  }
  return chain;
}

function classParseNum(raw) {
  // Split a compound UDC number into all its parts:
  // "720.011(494.51)(091)"       -> base:"720.011", aux:["(494.51)","(091)"], rel:null, slash:null
  // "720.017(450.52/494.4)"      -> base:"720.017", aux:["(450.52)","(494.4)"], rel:null, slash:null
  //                                 (compound geo split + rawAux:["(450.52/494.4)"] preserved)
  // "016:700"                    -> base:"016",     aux:[],   rel:"700",      slash:null
  // "338.450:574"                -> base:"338.450", aux:[],   rel:"574",      slash:null
  // "400/500"                    -> base:"400",     aux:[],   rel:null,       slash:["400","500"]
  // "410.1/430"                  -> base:"410.1",   aux:[],   rel:null,       slash:["410.1","430"]
  const raw2 = raw.trim();
  // Extract all parenthesised auxiliaries (raw, before decomposition)
  const rawAux = (raw2.match(/\([^)]+\)/g) || []);
  // Expand slash-compound auxiliaries: (450.52/494.4) → (450.52) + (494.4)
  const aux = [];
  for (const a of rawAux) {
    const inner = a.slice(1, -1); // rimuovi ( e )
    if (inner.includes('/')) {
      // Split on slash: each part becomes a separate auxiliary
      const parts = inner.split('/').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => aux.push('(' + p + ')'));
    } else {
      aux.push(a);
    }
  }
  let noAux = raw2.replace(/\([^)]*\)/g, '').trim();
  // Handle slash ranges: "A/B" -> two separate geographic areas
  let slash = null;
  if (noAux.includes('/')) {
    slash = noAux.split('/').map(s => s.trim()).filter(Boolean);
    // the base is the first part
    return { base: slash[0], aux, rawAux, rel: null, slash };
  }
  // Handle the colon relation
  let base = noAux, rel = null;
  const colonIdx = noAux.indexOf(':');
  if (colonIdx > 0) {
    base = noAux.slice(0, colonIdx).trim();
    rel  = noAux.slice(colonIdx + 1).trim();
  }
  return { base, aux, rawAux, rel, slash: null };
}

// ═══════════════════════════════════════════
// Class search URL builders
//
// Returns { url, pattern, meta } where:
//   url     — the Primo search URL
//   pattern — a concise representation of what will be searched (used as
//             preview in the UI, e.g. "720.*" or "720 + (494.51)")
//   meta    — descriptive hint (used by aggregator warnings and the aux
//             filter explainers)
//
// Strategy for the wildcard:
//   - mode 'exact': search the class literally, plus any selected aux as
//     extra AND terms (the search is narrow: records that carry *exactly*
//     this class and that aux).
//   - mode 'broader': wildcard applies ONLY to the numeric base; selected
//     aux are still AND'd literally. This avoids the ambiguous
//     "720.017(494.51).*" pattern while preserving the aux filter.
//   - If the only "class" the user has is an aux (geographic area alone),
//     we let it through but mark meta so the UI can warn about noise.
// ═══════════════════════════════════════════

function classBuildWildcard(num) {
  // Produce the wildcard form for the broader mode, starting from the base
  // numeric part (no parentheses, no colon relations).
  // Rules mirror UDC conventions used in the BAAM profile:
  //   3-digit round classes (700, 720, 730) → "7*", "72*", "73*"
  //     (strip trailing zeros, append *)
  //   3-digit non-round classes (721, 725)  → "721*", "725*"
  //   decimal classes (720.017)             → "720.017*"
  const clean = num.replace(/\([^)]*\)/g, '').trim();
  if (/^\d{3}$/.test(clean)) {
    const trimmed = clean.replace(/0+$/, '');
    return (trimmed.length > 0 ? trimmed : clean) + '*';
  }
  return num + '*';
}

function classBuildSearchUrl(num, ctx, mode, selectedAux) {
  // CDU: Primo field 'lds49' (BAAM local UDC)
  const field = 'lds49';
  const auxList = Array.isArray(selectedAux) ? selectedAux.filter(Boolean) : [];
  const baseOnly = num; // caller passes the numeric base (no aux baked in)

  let baseVal, patternParts;
  if (mode === 'broader') {
    baseVal = classBuildWildcard(baseOnly);
    patternParts = [baseVal];
  } else {
    baseVal = baseOnly;
    patternParts = [baseVal];
  }

  // AND-combine selected aux (if any) as additional query clauses.
  // Primo advanced queries accept multiple 'query' params joined with AND.
  // For simplicity and to preserve a single query=… parameter, we rely on
  // the space-AND default behaviour within lds49,contains,…
  // (Primo tokenises whitespace as AND for the 'contains' operator.)
  for (const a of auxList) {
    patternParts.push(a);
  }
  const combinedVal = patternParts.join(' ');

  const url = 'https://' + ctx.host + '/discovery/search?query=' + field + ',contains,'
    + encodeURIComponent(combinedVal)
    + '&tab=' + encodeURIComponent(ctx.tab) + '&search_scope=' + encodeURIComponent(ctx.scope) + '&vid=' + encodeURIComponent(ctx.vid) + '&mode=advanced';

  // Pattern display: shown to the user as preview of the query
  const pattern = patternParts.join(' + ');
  const onlyAux = auxList.length > 0 && !baseOnly;

  return { url, pattern, onlyAux };
}

function classBuildCDDSearchUrl(num, ctx, mode, selectedAux) {
  // CDD: Primo field 'lds56' (BAAM local Dewey-reduced 23sdnb)
  const field = 'lds56';
  const auxList = Array.isArray(selectedAux) ? selectedAux.filter(Boolean) : [];
  const baseOnly = num;

  let baseVal, patternParts;
  if (mode === 'broader') {
    baseVal = baseOnly + '*';
    patternParts = [baseVal];
  } else {
    baseVal = baseOnly;
    patternParts = [baseVal];
  }
  for (const a of auxList) {
    patternParts.push(a);
  }
  const combinedVal = patternParts.join(' ');

  const url = 'https://' + ctx.host + '/discovery/search?query=' + field + ',contains,'
    + encodeURIComponent(combinedVal)
    + '&tab=' + encodeURIComponent(ctx.tab) + '&search_scope=' + encodeURIComponent(ctx.scope) + '&vid=' + encodeURIComponent(ctx.vid) + '&mode=advanced';

  const pattern = patternParts.join(' + ');
  const onlyAux = auxList.length > 0 && !baseOnly;

  return { url, pattern, onlyAux };
}

function showClassRoot(oldCard, vocab, geo, ctx, classType, lang) {
  // UDC: show the macro levels (000-999) as clickable virtual groups
  // DDC: show the 10 main classes directly
  // The UDC macro groups (keys, members, multilingual labels) are data,
  // not logic — they live in vocab_cdu.json under the "_macros" key.
  const macros = (VOCAB_CDU && VOCAB_CDU._macros) || { groups: [], byGroup: {} };
  const cddRoots = ['000','100','200','300','400','500','600','700','800','900'];
  const card = el('div', { className: 'cls-card' });
  const head = el('div', { className: 'cls-head' });
  head.appendChild(el('span', { className: 'cls-num', textContent: '⌂' }));
  head.appendChild(el('span', { className: 'cls-lbl', textContent: L.classAllClasses || 'Tutte le classi' }));
  head.appendChild(el('span', { className: 'cls-chip cls-chip-' + classType,
    textContent: classType === 'cdu' ? 'CDU' : 'CDD' }));
  card.appendChild(head);
  const list = el('ul', { className: 'cls-children' });

  if (classType === 'cdu') {
    macros.groups.forEach(m => {
      const li = el('li', { style: { cursor: 'pointer' } });
      li.appendChild(el('span', { className: 'cls-tree-key', textContent: m.num }));
      li.appendChild(el('span', { className: 'cls-tree-lbl', textContent: classLabel(m, lang) }));
      li.addEventListener('click', () => {
        showCduGroup(card, m.key, macros.byGroup[m.key] || [], vocab, geo, ctx, lang);
      });
      list.appendChild(li);
    });
  } else {
    cddRoots.forEach(rk => {
      const re = vocab[rk];
      if (!re) return;
      const li = el('li', { style: { cursor: 'pointer' } });
      li.appendChild(el('span', { className: 'cls-tree-key', textContent: rk }));
      li.appendChild(el('span', { className: 'cls-tree-lbl', textContent: classLabel(re, lang) }));
      li.addEventListener('click', () => replaceClassCard(card, rk, vocab, geo, ctx, classType, lang));
      list.appendChild(li);
    });
  }

  card.appendChild(list);
  card.style.opacity = '0';
  oldCard.parentElement.replaceChild(card, oldCard);
  requestAnimationFrame(() => { card.style.transition = 'opacity .15s'; card.style.opacity = '1'; });
}

function showCduGroup(oldCard, macroKey, keys, vocab, geo, ctx, lang) {
  const card = el('div', { className: 'cls-card' });
  const head = el('div', { className: 'cls-head' });
  const macroNum = macroKey.replace('xx','00');
  const grp = (((VOCAB_CDU || {})._macros || {}).groups || []).find(g => g.key === macroKey);
  head.appendChild(el('span', { className: 'cls-num', textContent: macroNum }));
  head.appendChild(el('span', { className: 'cls-lbl', textContent: grp ? classLabel(grp, lang) : macroNum }));
  head.appendChild(el('span', { className: 'cls-chip cls-chip-cdu', textContent: 'CDU' }));
  const rootBtn2 = el('button', { className: 'cls-root-btn', title: 'Tutte le classi', textContent: '⌂' });
  rootBtn2.addEventListener('click', () => showClassRoot(card, vocab, geo, ctx, 'cdu', lang));
  head.appendChild(rootBtn2);
  card.appendChild(head);
  const list = el('ul', { className: 'cls-children' });
  keys.forEach(k => {
    const e = vocab[k];
    if (!e) return;
    const li = el('li', { style: { cursor: 'pointer' } });
    li.appendChild(el('span', { className: 'cls-tree-key', textContent: k }));
    li.appendChild(el('span', { className: 'cls-tree-lbl', textContent: classLabel(e, lang) }));
    li.addEventListener('click', () => replaceClassCard(card, k, vocab, geo, ctx, 'cdu', lang));
    list.appendChild(li);
  });
  card.appendChild(list);
  card.style.opacity = '0';
  oldCard.parentElement.replaceChild(card, oldCard);
  requestAnimationFrame(() => { card.style.transition = 'opacity .15s'; card.style.opacity = '1'; });
}

// Render a single node of the tree explorer. Recursive, lazy: children
// are rendered the first time a node is expanded. Uses `data-key` to
// remember which vocab key a row represents.
// When the user clicks the row (not the toggle), the whole card is replaced
// by a full rendering of that class, mirroring the behaviour of the inline
// sottoclassi list.
function renderClassTreeNode(container, key, vocab, geo, ctx, classType, lang, cardRef, depth) {
  const entry = vocab[key];
  if (!entry) return;
  const childKeys = entry.children || [];

  const ul = el('ul', { role: 'group' });
  childKeys.forEach(ck => {
    const ce = vocab[ck];
    if (!ce) return;
    const hasChildren = (ce.children || []).length > 0;
    const li = el('li', { role: 'treeitem' });
    const row = el('div', {
      className: 'cls-tree-row',
      tabindex: '0',
      'data-key': ck,
      'aria-expanded': hasChildren ? 'false' : undefined
    });
    const toggle = el('span', {
      className: 'cls-tree-toggle' + (hasChildren ? '' : ' cls-tree-leaf'),
      'aria-hidden': 'true',
      textContent: hasChildren ? '\u25B8' : '\u00B7'
    });
    row.appendChild(toggle);
    row.appendChild(el('span', { className: 'cls-tree-key-mini', textContent: ck }));
    row.appendChild(el('span', { className: 'cls-tree-lbl-mini',
      textContent: classLabel(ce, lang) }));

    // Click on toggle: expand/collapse inline
    // Click on row (outside toggle): replace the full card with this class
    // Keyboard: Enter/Space on row = replace card; ArrowRight = expand;
    //          ArrowLeft = collapse
    let childrenContainer = null;
    function expand() {
      if (!hasChildren) return;
      if (!childrenContainer) {
        childrenContainer = el('div', { className: 'cls-tree-children-nested' });
        renderClassTreeNode(childrenContainer, ck, vocab, geo, ctx, classType, lang, cardRef, depth + 1);
        li.appendChild(childrenContainer);
      } else {
        childrenContainer.hidden = false;
      }
      row.setAttribute('aria-expanded', 'true');
      toggle.textContent = '\u25BE';
    }
    function collapse() {
      if (!childrenContainer) return;
      childrenContainer.hidden = true;
      row.setAttribute('aria-expanded', 'false');
      toggle.textContent = '\u25B8';
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (row.getAttribute('aria-expanded') === 'true') collapse();
      else expand();
    });
    row.addEventListener('click', (e) => {
      if (e.target === toggle) return;
      replaceClassCard(cardRef, ck, vocab, geo, ctx, classType, lang);
    });
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        replaceClassCard(cardRef, ck, vocab, geo, ctx, classType, lang);
      } else if (e.key === 'ArrowRight' && hasChildren) {
        e.preventDefault();
        expand();
      } else if (e.key === 'ArrowLeft' && hasChildren) {
        e.preventDefault();
        collapse();
      }
    });

    li.appendChild(row);
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

function replaceClassCard(oldCard, newKey, vocab, geo, ctx, classType, lang) {
  const newCard = renderClassCard(newKey, vocab, geo, ctx, classType, lang);
  newCard.style.opacity = '0';
  oldCard.parentElement.replaceChild(newCard, oldCard);
  requestAnimationFrame(() => { newCard.style.transition = 'opacity .15s'; newCard.style.opacity = '1'; });
}

function renderClassCard(num, vocab, geo, ctx, classType, lang) {
  const { base, aux, rawAux, rel, slash } = classParseNum(num);

  // Lookup: try combined base:rel, then base, then prefix, then parent
  const lookupResult = classLookupFull(base, rel, vocab);
  let entry = lookupResult ? lookupResult.entry : null;
  let resolvedBase = lookupResult ? lookupResult.key : base;

  const card = el('div', { className: 'cls-card' });

  // Number to display and to search with: prefer resolvedBase when it contains ':'
  const searchBase = (resolvedBase && resolvedBase !== base) ? resolvedBase : base;

  // Header: number + label + chip
  const head = el('div', { className: 'cls-head' });
  head.appendChild(el('span', { className: 'cls-num', textContent: searchBase }));
  if (entry) {
    head.appendChild(el('span', { className: 'cls-lbl', textContent: classLabel(entry, lang) }));
  } else {
    head.appendChild(el('span', { className: 'cls-lbl cls-lbl-unknown', textContent: base }));
  }
  head.appendChild(el('span', { className: 'cls-chip cls-chip-' + classType,
    textContent: classType === 'cdu' ? 'CDU' : 'CDD' }));
  // Root button (↑↑) when not already at root level
  const rootKeys = classType === 'cdu'
    ? ['001','002','003','004','007','008','010','011','012','016','020','030','061','069','070','090','100','200','300','400','500','600','700','800','900']
    : ['000','100','200','300','400','500','600','700','800','900'];
  // ⌂ button always visible
  const rootBtn = el('button', { className: 'cls-root-btn', title: L.classShowRoot || 'Classi principali',
    textContent: '⌂' });
  rootBtn.addEventListener('click', () => {
    showClassRoot(card, vocab, geo, ctx, classType, lang);
  });
  head.appendChild(rootBtn);
  card.appendChild(head);

  // Slash range: show all parts as separate tags
  if (slash && slash.length > 1) {
    const slashEl = el('div', { className: 'cls-aux' });
    slash.forEach(s => {
      const e = vocab[s] || geo['(' + s + ')'];
      const lbl = e ? classLabel(e, lang) : s;
      const tag = el('span', { className: 'cls-aux-tag cls-aux-slash' });
      tag.appendChild(el('span', { className: 'cls-aux-key', textContent: s }));
      tag.appendChild(el('span', { className: 'cls-aux-lbl', textContent: lbl }));
      slashEl.appendChild(tag);
    });
    card.appendChild(slashEl);
  }

  // Geographic / auxiliary subdivisions
  if (aux.length) {
    const auxEl = el('div', { className: 'cls-aux' });
    aux.forEach(a => {
      // Look up in the geographic vocabulary first, then fall back to the
      // classification vocabulary itself so that general form auxiliaries
      // like (03), (038), (084), (091) resolve to their labels too.
      const auxEntry = geo[a] || vocab[a];
      const geoLbl = auxEntry ? classLabel(auxEntry, lang) : a;
      const tag = el('span', { className: 'cls-aux-tag' });
      tag.appendChild(el('span', { className: 'cls-aux-key', textContent: a }));
      tag.appendChild(el('span', { className: 'cls-aux-lbl', textContent: geoLbl }));
      auxEl.appendChild(tag);
    });
    card.appendChild(auxEl);
  }

  // Colon relation (:) — shown only when the combined key is NOT in the vocabulary
  // (if it is, its label is already on the card; if not, we show the relation explicitly)
  if (rel && resolvedBase !== base + ':' + rel) {
    const relEl = el('div', { className: 'cls-aux' });
    const relEntry = vocab[rel] || geo[rel];
    const relLbl = relEntry ? classLabel(relEntry, lang) : rel;
    const tag = el('span', { className: 'cls-aux-tag cls-aux-rel' });
    tag.appendChild(el('span', { className: 'cls-aux-key', textContent: ':' + rel }));
    tag.appendChild(el('span', { className: 'cls-aux-lbl', textContent: relLbl }));
    relEl.appendChild(tag);
    card.appendChild(relEl);
  }

  // Hierarchy — indented tree with "All classes" as a clickable root
  if (entry) {
    const chain = classChain(resolvedBase, vocab, geo);
    if (chain.length >= 1) {
      const hier = el('div', { className: 'cls-hier' });
      hier.appendChild(el('div', { className: 'cls-section-title', textContent: L.classHierarchy }));
      const tree = el('div', { className: 'cls-tree-v2' });

      // Root: "All classes" — always clickable
      const rootItem = el('div', { className: 'cls-tree-node cls-tree-nav', style: { paddingLeft: '0px', cursor: 'pointer' } });
      rootItem.appendChild(el('span', { className: 'cls-tree-key', textContent: '⌂' }));
      rootItem.appendChild(el('span', { className: 'cls-tree-lbl', textContent: L.classAllClasses || 'Tutte le classi' }));
      rootItem.addEventListener('click', () => showClassRoot(card, vocab, geo, ctx, classType, lang));
      tree.appendChild(rootItem);

      chain.forEach((node, i) => {
        const isCur = i === chain.length - 1;
        const indent = (i + 1) * 16; // Progressive indentation
        const nodeEl = el('div', {
          className: 'cls-tree-node' + (isCur ? ' cls-tree-cur' : ' cls-tree-nav'),
          style: { paddingLeft: indent + 'px' },
          title: isCur ? '' : classLabel(node.entry, lang)
        });
        // Visual connector
        nodeEl.appendChild(el('span', { className: 'cls-tree-connector', textContent: '└─' }));
        nodeEl.appendChild(el('span', { className: 'cls-tree-key', textContent: node.key }));
        nodeEl.appendChild(el('span', { className: 'cls-tree-lbl', textContent: classLabel(node.entry, lang) }));
        if (!isCur) {
          nodeEl.style.cursor = 'pointer';
          nodeEl.addEventListener('click', () => {
            replaceClassCard(card, node.key, vocab, geo, ctx, classType, lang);
          });
        }
        tree.appendChild(nodeEl);
      });
      hier.appendChild(tree);
      card.appendChild(hier);
    }

    // Narrower classes — all of them, no cap
    const children = (entry.children || []);
    if (children.length) {
      const narr = el('div', { className: 'cls-narrower' });
      narr.appendChild(el('div', { className: 'cls-section-title',
        textContent: L.classNarrower + ' (' + children.length + ')' }));
      const list = el('ul', { className: 'cls-children' });
      children.forEach(ck => {
        const ce = vocab[ck];
        const li = el('li', { style: { cursor: 'pointer' },
          title: ce ? classLabel(ce, lang) : ck });
        li.appendChild(el('span', { className: 'cls-tree-key', textContent: ck }));
        li.appendChild(el('span', { className: 'cls-tree-lbl',
          textContent: ce ? classLabel(ce, lang) : ck }));
        li.addEventListener('click', () => {
          replaceClassCard(card, ck, vocab, geo, ctx, classType, lang);
        });
        list.appendChild(li);
      });
      narr.appendChild(list);
      card.appendChild(narr);
    }

    // Tree explorer: collapsible panel that lets the user drill into the
    // class hierarchy without leaving the card. Each node can be expanded
    // in-place (if it has children in the vocab) or clicked to replace
    // the card with a full view of that class. Uses DOM recursion with
    // lazy rendering of children on first expansion.
    if ((entry.children || []).length > 0) {
      const treeWrap = el('div', { className: 'cls-tree-explore-wrap' });
      const panelId = 'sn-cls-tree-' + Math.random().toString(36).slice(2, 9);
      const toggleBtn = el('button', {
        className: 'cls-tree-explore-btn',
        type: 'button',
        'aria-expanded': 'false',
        'aria-controls': panelId
      });
      toggleBtn.appendChild(el('span', { className: 'cls-tree-caret', textContent: '\u25B8' }));
      toggleBtn.appendChild(el('span', { textContent: L.classTreeExplore || 'Esplora albero' }));

      const panel = el('div', { className: 'cls-tree-panel', id: panelId, hidden: 'hidden' });

      toggleBtn.addEventListener('click', () => {
        const isOpen = toggleBtn.getAttribute('aria-expanded') === 'true';
        if (isOpen) {
          toggleBtn.setAttribute('aria-expanded', 'false');
          panel.setAttribute('hidden', 'hidden');
          toggleBtn.querySelector('span:last-child').textContent = L.classTreeExplore || 'Esplora albero';
        } else {
          toggleBtn.setAttribute('aria-expanded', 'true');
          panel.removeAttribute('hidden');
          toggleBtn.querySelector('span:last-child').textContent = L.classTreeCollapse || 'Comprimi';
          // Lazy-render the first time it opens
          if (!panel._rendered) {
            renderClassTreeNode(panel, resolvedBase, vocab, geo, ctx, classType, lang, card, 0);
            panel._rendered = true;
          }
        }
      });

      treeWrap.appendChild(toggleBtn);
      treeWrap.appendChild(panel);
      card.appendChild(treeWrap);
    }
  }

  // ═══════════════════════════════════════════
  // Search UI — radio buttons with pattern preview.
  //
  // Two design goals:
  //   1. Be explicit about what Primo will receive. The user sees the
  //      exact wildcard pattern in a monospace preview line before
  //      clicking. This removes the "which of the two buttons?" hesitation
  //      we had with the old UI.
  //   2. Keep aux filters orthogonal to the mode. Selecting (494.51)
  //      as a filter adds an AND clause; it does NOT change whether
  //      the base is exact or wildcarded. This matches the user's
  //      mental model: mode = "how wide is my class", aux = "narrow to
  //      this area/form".
  // ═══════════════════════════════════════════
  const links = el('div', { className: 'cls-links' });
  const buildUrl = classType === 'cdu' ? classBuildSearchUrl : classBuildCDDSearchUrl;
  const isAggregator = classType === 'cdd' && !base.includes('.');

  // Selected aux state — each set entry is a ready-to-search token like "(494.51)"
  const auxSelected = new Set();

  // Aux filter pills (unchanged logic from before, only CSS unchanged)
  if (aux.length) {
    const filterWrap = el('div', { className: 'cls-filter-wrap' });
    filterWrap.appendChild(el('span', { className: 'cls-filter-label',
      textContent: (L.classFilterLabel || 'Includi nella ricerca:') + ' ' }));

    aux.forEach(a => {
      const geoEntry = geo[a] || vocab[a];
      const geoLbl = geoEntry ? classLabel(geoEntry, lang) : a;
      const pill = el('button', { className: 'cls-filter-pill', type: 'button',
        'aria-pressed': 'false', textContent: a + ' ' + geoLbl });
      pill.dataset.aux = a;
      pill.addEventListener('click', () => {
        if (auxSelected.has(a)) {
          auxSelected.delete(a); pill.classList.remove('on');
          pill.setAttribute('aria-pressed', 'false');
        } else {
          auxSelected.add(a); pill.classList.add('on');
          pill.setAttribute('aria-pressed', 'true');
        }
        updatePreview();
      });
      filterWrap.appendChild(pill);
    });

    if (rawAux && rawAux.length) {
      rawAux.forEach(ra => {
        const inner = ra.slice(1, -1);
        if (inner.includes('/')) {
          const pill = el('button', { className: 'cls-filter-pill cls-filter-pill-compound',
            type: 'button', 'aria-pressed': 'false', textContent: ra });
          pill.dataset.aux = ra;
          pill.addEventListener('click', () => {
            if (auxSelected.has(ra)) {
              auxSelected.delete(ra); pill.classList.remove('on');
              pill.setAttribute('aria-pressed', 'false');
            } else {
              auxSelected.add(ra); pill.classList.add('on');
              pill.setAttribute('aria-pressed', 'true');
            }
            updatePreview();
          });
          filterWrap.appendChild(pill);
        }
      });
    }
    links.appendChild(filterWrap);
  }

  // Mode radio group
  const modeGroup = el('div', { className: 'cls-mode-group', role: 'radiogroup',
    'aria-label': L.classSearchMode || 'Modalità di ricerca' });

  const modeId = 'sn-cls-mode-' + Math.random().toString(36).slice(2, 9);
  let currentMode = 'broader'; // default: include subclasses (the common case)

  function makeModeOption(value, labelText, description, checked) {
    const id = modeId + '-' + value;
    const wrap = el('label', { className: 'cls-mode-option', htmlFor: id });
    const input = el('input', { type: 'radio', name: modeId, id, value });
    if (checked) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) { currentMode = value; updatePreview(); }
    });
    wrap.appendChild(input);
    const textWrap = el('span', { className: 'cls-mode-text' });
    textWrap.appendChild(el('span', { className: 'cls-mode-lbl', textContent: labelText }));
    if (description) {
      textWrap.appendChild(el('span', { className: 'cls-mode-descr', textContent: description }));
    }
    wrap.appendChild(textWrap);
    return wrap;
  }

  modeGroup.appendChild(makeModeOption('exact',
    L.classModeExact || 'Solo questa classe',
    L.classModeExactHint || 'cerca solo questo numero esatto', false));
  modeGroup.appendChild(makeModeOption('broader',
    L.classModeBroader || 'Questa classe e sottoclassi',
    L.classModeBroaderHint || 'include tutti i numeri che iniziano con questo prefisso', true));
  links.appendChild(modeGroup);

  // Live preview line + warnings
  const previewWrap = el('div', { className: 'cls-preview-wrap' });
  const previewLabel = el('span', { className: 'cls-preview-label',
    textContent: (L.classSearchPreview || 'Anteprima ricerca') + ': ' });
  const previewCode = el('code', { className: 'cls-preview-code', 'aria-live': 'polite' });
  previewWrap.appendChild(previewLabel);
  previewWrap.appendChild(previewCode);
  const previewWarn = el('div', { className: 'cls-preview-warn', role: 'note' });
  links.appendChild(previewWrap);
  links.appendChild(previewWarn);

  // Search button
  const lkSearch = el('button', { className: 'act act-pri cls-search-btn', type: 'button',
    textContent: L.classSearchRun || L.classSearchExact || 'Cerca' });
  lkSearch.addEventListener('click', () => {
    const res = buildUrl(searchBase, ctx, currentMode, Array.from(auxSelected));
    if (res && res.url) openUrlSafe(res.url);
  });
  links.appendChild(lkSearch);

  function updatePreview() {
    const res = buildUrl(searchBase, ctx, currentMode, Array.from(auxSelected));
    previewCode.textContent = res.pattern || '—';
    // Warnings:
    // - aggregator (CDD without decimals) — existing warning
    // - onlyAux is currently impossible here (searchBase is always set),
    //   but auxSelected alone without base would trigger noise; we
    //   still surface a hint when only aux are chosen *and* mode is broader
    //   (because then the query is base-wildcard + aux, which is fine;
    //   it's the "aux alone" use case from showClassRoot that is noisy,
    //   and that one is handled there, not here).
    let warnText = '';
    if (isAggregator && currentMode === 'exact') {
      warnText = L.classAggregatorNote;
    }
    previewWarn.textContent = warnText;
    previewWarn.style.display = warnText ? '' : 'none';
  }

  if (isAggregator) {
    links.appendChild(el('div', { className: 'cls-note',
      textContent: L.classAggregatorNote }));
  }
  card.appendChild(links);

  // Initial preview render
  updatePreview();

  return card;
}
