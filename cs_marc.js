// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 4/8): MARC extraction
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// MARC EXTRACTION
// ═══════════════════════════════════════════
function extractAll(fields) {
  const sbt = [], gnd = [], idr = [], names = [], forms = [];
  const baamClasses = [], cddClasses = [];
  const seen = new Set();
  // Fields linked through Alma's integrated GND/IdRef vocabularies
  // always carry the authority id in $0. A $2 gnd/idref field without its id
  // is a legacy heading: it is left out of the panel (it stays findable in
  // the catalogue) instead of being guessed through a Wikidata text search.
  const linkedToAuthority = (v2Norm, gi, ii) =>
    v2Norm.startsWith('gnd') ? Boolean(gi) : v2Norm === 'idref' ? Boolean(ii) : true;
  const addName = (entry) => {
    // MARC 880 fields can carry an alternate script/form and a complementary
    // authority identifier for the same 1XX/7XX access point.  The occurrence
    // number in $6 links the pair (for example 100 $6=880-01 and
    // 880 $6=100-01), so it is a stronger merge key than the displayed label.
    // With an authority id the id is the identity, not the wording —
    // once $b was read, «Johannes Paul $b II.» and «$b II» (same GND id) were
    // two cards.
    let key = entry.linkageKey
      ? [entry.kind, 'link', entry.linkageKey].join('|')
      : (entry.gndId || entry.idrefId)
        ? [entry.kind, 'id', entry.gndId || '', entry.idrefId || ''].join('|')
        : [entry.kind, cleanName(entry.name).toLowerCase(), '', ''].join('|');
    let existing = names.find(n => n._key === key);
    // A linked pair whose fields carry two different ids of the same
    // authority is not merged — keeping the first id would hide the conflict.
    if (existing && ((existing.gndId && entry.gndId && existing.gndId !== entry.gndId)
                  || (existing.idrefId && entry.idrefId && existing.idrefId !== entry.idrefId))) {
      key += '|' + (entry.gndId || '') + '|' + (entry.idrefId || '');
      existing = names.find(n => n._key === key);
    }
    if (existing) {
      if (!existing.tags.includes(entry.tag)) existing.tags.push(entry.tag);
      if (!existing.gndId && entry.gndId) existing.gndId = entry.gndId;
      if (!existing.idrefId && entry.idrefId) existing.idrefId = entry.idrefId;
      const variants = existing.variants || (existing.variants = []);
      for (const value of [existing.name, entry.name]) {
        if (value && !variants.some(v => cleanName(v).toLowerCase() === cleanName(value).toLowerCase())) variants.push(value);
      }
      // Prefer the non-880 display form when an alternate field happened to
      // precede its linked base field in the XML.
      if (existing.from880 && !entry.from880) {
        existing.name = entry.name;
        existing.display = entry.display;
        existing.from880 = false;
      }
      const relatorKeys = new Set(existing.relators.map(r => r.source + '|' + r.value));
      entry.relators.forEach(r => {
        const rk = r.source + '|' + r.value;
        if (!relatorKeys.has(rk)) { relatorKeys.add(rk); existing.relators.push(r); }
      });
      return;
    }
    names.push({ ...entry, tags: [entry.tag], variants: [entry.name], _key: key });
  };
  for (const f of fields) {
    if (!f.subs) continue;
    const linked = marcLinkedTag(f);
    const tag = linked.tag;
    const linkageKey = linked.occurrence ? tag + ':' + linked.occurrence : null;
    const v2 = (f.subs.find(s => s.c === '2') || {}).v || '';
    const v2Norm = v2.trim().toLowerCase();
    // BAAM local classification (691 $2 usi-TM)
    if (tag === '691' && v2 === 'usi-TM') {
      const num = (f.subs.find(s => s.c === 'a') || f.subs.find(s => s.c === 'e') || {}).v || '';
      const numClean = num.replace(/\s+/g, '');
      if (numClean && !seen.has('baam-' + numClean)) {
        seen.add('baam-' + numClean);
        baamClasses.push({ num: numClean, raw: f.subs });
      }
    }
    // CDD ridotta 23sdnb (082 $2 23sdnb)
    if (tag === '082' && v2 === '23sdnb') {
      const num = (f.subs.find(s => s.c === 'a') || {}).v || '';
      if (num && !seen.has('cdd-' + num)) {
        seen.add('cdd-' + num);
        cddClasses.push({ num: num.trim(), raw: f.subs });
      }
    }
    const gi = exG(f.subs);
    const ii = exI(f.subs);
    // Form/genre terms from the SLSP content/carrier lists are entered without
    // $0 by rule (655 $2 gnd-content / gnd-carrier / sbt12-content): the $2
    // already says what they are, so they are kept.
    const isFormList = tag === '655' && (v2Norm === 'gnd-content' || v2Norm === 'gnd-carrier');
    if (['600', '610', '611', '630', '648', '650', '651', '655'].includes(tag) && !isFormList && !linkedToAuthority(v2Norm, gi, ii)) continue;
    // 655 is the form/genre of the document, not what it is about:
    // kept apart from the subjects (no navigation, no Wikidata guess), still
    // available as a refinement in the combined search.
    if (tag === '655') {
      const source = v2Norm.startsWith('sbt') ? 'sbt' : v2Norm.startsWith('gnd') ? 'gnd' : v2Norm === 'idref' ? 'idref' : null;
      const term = ((f.subs.find(s => s.c === 'a') || {}).v || '').replace(/[.\s]+$/, '');
      const k = 'f-' + source + '-' + (gi || ii || '') + '-' + term.toLowerCase();
      if (source && term && !seen.has(k)) {
        seen.add(k);
        forms.push({ tag, term, display: sbtD(f.subs), vocab: v2, source, gndId: gi, idrefId: ii });
      }
      continue;
    }
    if (['630', '648', '650', '651'].includes(tag)) {
      // A 651 with a subordinate unit (GND «Katholische Kirche $b
      // Diözese Spoleto») keeps it, as a body does.
      const subjectTerm = tag === '630' ? uniformTitleD(f.subs)
        : tag === '651' ? [(f.subs.find(s => s.c === 'a') || {}).v || '', ...f.subs.filter(s => s.c === 'b').map(s => s.v.replace(/[.,\s]+$/, ''))].filter(Boolean).join(' \u2014 ')
        : ((f.subs.find(s => s.c === 'a') || {}).v || '');
      const subjectDisplay = tag === '630' ? uniformTitleDisplay(f.subs) : sbtD(f.subs);
      if (v2Norm.startsWith('sbt')) {
        const k = 's-' + tag + '-' + v2 + '-' + subjectDisplay.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          sbt.push({ tag, subs: f.subs, vocab: v2, display: subjectDisplay });
        }
      } else if (v2Norm.startsWith('gnd')) {
        const t = subjectTerm;
        const k = 'g-' + tag + '-' + (gi || '') + '-' + t.toLowerCase();
        if (!seen.has(k)) { seen.add(k); gnd.push({ tag, term: t, gndId: gi, idrefId: ii, display: t, qual: headingQualifier(f.subs) }); }
      } else if (v2Norm === 'idref') {
        const t = subjectTerm;
        const k = 'i-' + tag + '-' + (ii || '') + '-' + t.toLowerCase();
        if (!seen.has(k)) { seen.add(k); idr.push({ tag, term: t, gndId: gi, idrefId: ii, display: t, qual: headingQualifier(f.subs) }); }
      }
    }
    // 600/610/611: a person, body or meeting as subject — the book is *about*
    // them. With $t (name-title, body-title, meeting-title) the
    // subject is a WORK of theirs — kind 'work', the heading «Author: Title.
    // Parts (qualifiers)», and the record's $0 is the work's id (before, the
    // work's id was reconciled as the person: «Dante Alighieri» with the GND
    // id of De vulgari eloquentia).
    if (NAME_SUBJECTS[tag]) {
      const [nameKind, keyBase] = NAME_SUBJECTS[tag];
      const work = hasTitle(f.subs);
      const nm = work ? workD(f.subs, nameKind)
        : nameKind === 'corporate' ? corpD(f.subs) : nameKind === 'meeting' ? meetD(f.subs) : namD(f.subs);
      const disp = nameD(f.subs, nm);
      const k = cleanName(nm).toLowerCase();
      const kb = keyBase + (work ? 'w' : '');
      const kind = work ? 'work' : nameKind;
      const workOf = work ? { workOf: nameKind, workTitle: workParts(f.subs, nameKind).title } : {};
      if (v2Norm.startsWith('sbt')) { const key = 's' + kb + '-' + k; if (!seen.has(key)) { seen.add(key); sbt.push({ tag, subs: f.subs, vocab: v2, display: disp, isName: true, kind, ...workOf }); } }
      else if (v2Norm.startsWith('gnd')) { const key = 'g' + kb + '-' + (gi || '') + '-' + k; if (!seen.has(key)) { seen.add(key); gnd.push({ tag, term: nm, gndId: gi, idrefId: ii, display: disp, isName: true, kind, ...workOf }); } }
      else if (v2Norm === 'idref') { const key = 'i' + kb + '-' + (ii || '') + '-' + k; if (!seen.has(key)) { seen.add(key); idr.push({ tag, term: nm, gndId: gi, idrefId: ii, display: disp, isName: true, kind, ...workOf }); } }
    }
    // A 7XX with $t (an added entry for a work) is not a person,
    // body or meeting of the record: it is left out (in the USI catalogue
    // these entries are not reliable).
    const titled7xx = tag[0] === '7' && hasTitle(f.subs);
    if ((tag === '100' || tag === '700') && !titled7xx) {
      const nm = namD(f.subs);
      if (nm) addName({ tag, kind: 'person', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, relators: extractRelators(f.subs, 'person'), linkageKey, from880: f.tag === '880' });
    }
    if ((tag === '110' || tag === '710') && !titled7xx) {
      const nm = corpD(f.subs, true);
      if (nm) addName({ tag, kind: 'corporate', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, relators: extractRelators(f.subs, 'corporate'), linkageKey, from880: f.tag === '880' });
    }
    if ((tag === '111' || tag === '711') && !titled7xx) {
      const nm = meetD(f.subs);
      if (nm) addName({ tag, kind: 'meeting', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, relators: extractRelators(f.subs, 'meeting'), linkageKey, from880: f.tag === '880' });
    }
  }
  return { sbt, gnd, idr, names, forms, baamClasses, cddClasses };
}
// Resolve an 880 to its linked logical tag while retaining the occurrence
// number that joins it to the base field. Unsupported 880 links stay 880 and
// are ignored by the extractors below.
function marcLinkedTag(field) {
  const raw = ((field.subs || []).find(s => s.c === '6') || {}).v || '';
  const match = raw.match(/^(\d{3})-(\d{2})/);
  if (!match) return { tag: field.tag, occurrence: null };
  const supported = new Set(['082', '100', '110', '111', '600', '610', '611', '630', '648', '650', '651', '655', '691', '700', '710', '711']);
  const tag = field.tag === '880' && supported.has(match[1]) ? match[1] : field.tag;
  // Occurrence 00 means "no linked base field": two 880s with 700-00 are not
  // two scripts of the same name, so 00 must never act as a merge key.
  return { tag, occurrence: match[2] === '00' ? null : match[2] };
}
function extractRelators(subs, kind) {
  const termCode = kind === 'meeting' ? 'j' : 'e';
  return [
    ...subs.filter(s => s.c === termCode && s.v).map(s => ({ source: '$' + termCode, value: s.v.trim() })),
    ...subs.filter(s => s.c === '4' && s.v).map(s => ({ source: '$4', value: s.v.trim() })),
  ];
}
// Equivalent forms of a 655 term, from the reviewed SLSP table
// (vocab_forms.json). IdRef forms match by id or label, the others by label
// (gnd-content and sbt-content carry no id); the label wins over the id,
// since $0 values copied from another form occur in the catalogue. Unknown
// forms return null and stay as the record's wording, untranslated.
function formEquivalents(form, table) {
  const key = s => String(s || '').replace(/[.\s]+$/, '').trim().toLocaleLowerCase();
  const term = key(form.term);
  const lang = form.source === 'gnd' ? 'de' : form.source === 'idref' ? 'fr' : 'it';
  const rows = table || [];
  const row = rows.find(r => key(r[lang]) === term)
    || rows.find(r => (r.aliases || []).some(a => key(a) === term))
    || (form.source === 'idref' && form.idrefId ? rows.find(r => r.idref === form.idrefId) : null);
  if (!row) return null;
  const labels = {};
  for (const l of ['de', 'fr', 'it', 'en', 'es']) if (row[l]) labels[l] = row[l];
  return { labels, status: row.status, row };
}
// The record's forms that are the same row of the table (one
// 655 per vocabulary: GND Zeitschrift, IdRef Périodique, SBT Periodici) make
// one group — one badge, one chip in the combined search. A form outside the
// table is a group of its own: no equivalence is known.
function formGroups(forms, table) {
  const groups = [], byRow = new Map();
  for (const f of forms) {
    const eq = formEquivalents(f, table);
    const same = eq && byRow.get(eq.row);
    if (same) { same.forms.push(f); continue; }
    const g = { forms: [f], eq };
    if (eq) byRow.set(eq.row, g);
    groups.push(g);
  }
  return groups;
}
// What a form badge shows: the record's wordings, their vocabularies, and
// the official wordings that are not already among the record's.
function formGroupView(g) {
  const homeLang = { gnd: 'de', idref: 'fr', sbt: 'it' };
  const vocName = { gnd: 'GND', idref: 'IdRef', sbt: 'SBT/NS' };
  const key = s => String(s || '').toLowerCase().trim();
  const cl = g.eq ? { ...g.eq.labels } : {};
  const titles = [], vocabs = [];
  for (const f of g.forms) {
    cl[homeLang[f.source]] = cl[homeLang[f.source]] || f.term;
    const t = f.display || f.term;
    if (!titles.some(x => key(x) === key(t))) titles.push(t);
    const v = vocName[f.source] || f.source;
    if (!vocabs.includes(v)) vocabs.push(v);
  }
  const own = new Set(g.forms.map(f => key(f.term)));
  const other = Object.entries(cl).filter(([, v]) => v && !own.has(key(v)));
  return { title: titles.join(' · '), vocabs, other, cl };
}
// The qualifier of a GND/IdRef heading ($g: GND «Architektur
// <Motiv>», 4112586-1, the motif, not the discipline 4002851-3). Shown with
// the heading, never searched: the searched word stays $a.
function headingQualifier(subs) {
  const g = subs.filter(s => s.c === 'g').map(s => String(s.v || '').trim()).filter(Boolean);
  return g.length ? g.join(', ') : null;
}
function qualifiedLabel(label, qual, vocab) {
  if (!qual || !label) return label;
  return vocab === 'gnd' ? label + ' <' + qual + '>' : label + ' (' + qual + ')';
}
function exG(s) { const x = s.find(s => s.c === '0' && s.v.includes('DE-588')); return x ? (x.v.match(/\(DE-588\)(\S+)/) || [])[1] || null : null; }
function exI(s) { const x = s.find(s => s.c === '0' && s.v.includes('IDREF')); return x ? (x.v.match(/\(IDREF\)(\S+)/) || [])[1] || null : null; }
// sbtD: rendered as a single display string. Form ($v) is appended at the end
// in italics so it reads clearly as "topic — subdivision ... — form".
function sbtD(s) {
  const main = s.filter(x => 'axzy'.includes(x.c)).map(x => x.v.replace(/\.$/, ''));
  const form = s.filter(x => x.c === 'v').map(x => x.v.replace(/\.$/, ''));
  return [...main, ...form].join(' \u2014 ');
}
// A subfield value without the ISBD/AACR2 punctuation around it
// («(Costas),» → «Costas», «(2017 :» → «2017», «Chicago, Ill.),» → «Chicago, Ill»).
function bareSub(v) { return String(v || '').trim().replace(/^[(\s]+/, '').replace(/[\s.,:;)]+$/, ''); }
// Personal name (X00): $a name, $b numeration (without it «Johannes
// Paulus papa» for Johannes Paulus 2), $c titles, $d dates.
// $q (fuller form) and every further $c
// ($c is repeatable: «Thomas $c Aquinas $c santo») are shown too, in
// parentheses — cleanName() drops what is in parentheses, so the term the
// extension searches with stays the one it was.
function namD(s) {
  let n = (s.find(x => x.c === 'a') || {}).v || '';
  const b = (s.find(x => x.c === 'b') || {}).v;
  if (b) n = n.replace(/\s*$/, '') + ' ' + b.trim();
  const cs = s.filter(x => x.c === 'c').map(x => x.v);
  if (cs[0]) n = n.replace(/\s*$/, '') + ' ' + cs[0];
  const q = bareSub((s.find(x => x.c === 'q') || {}).v);
  if (q) n = n.replace(/[,\s]+$/, '') + ' (' + q + ')';
  const moreC = cs.slice(1).map(bareSub).filter(Boolean);
  if (moreC.length) n = n.replace(/[,\s]+$/, '') + ' (' + moreC.join('; ') + ')';
  const d = (s.find(x => x.c === 'd') || {}).v;
  if (d) n += ' (' + d.replace(/[.\s]+$/, '') + ')';
  return n.replace(/,\s*$/, '');
}
// Corporate body (X10): $a = main heading, $b = subordinate unit (may repeat,
// one per level). Joined with " — " to mirror the hierarchical path.
// $g (qualifier: place, type) in parentheses
// after the level it follows — «Staatliche Museen (Berlin, RDA) —
// Skulpturensammlung»; and, for a meeting entered under a body (110/710,
// `withMeeting`), its number, date and place: «… — General Meeting (2017 :
// Chicago, Ill)». Not for 610, where $c/$d are mostly coding errors.
function corpD(s, withMeeting) {
  const levels = [{ text: ((s.find(x => x.c === 'a') || {}).v || '').replace(/[.,\s]+$/, ''), g: [] }];
  let cur = levels[0];
  const meeting = { n: [], d: [], c: [] };
  for (const x of s) {
    if (x.c === 'a') cur = levels[0];
    else if (x.c === 'b') { cur = { text: (x.v || '').replace(/[.,\s]+$/, ''), g: [] }; levels.push(cur); }
    else if (x.c === 'g') { const g = bareSub(x.v); if (g) cur.g.push(g); }
    else if (withMeeting && meeting[x.c]) { const m = bareSub(x.v); if (m) meeting[x.c].push(m); }
  }
  let name = levels.filter(l => l.text).map(l => l.text + (l.g.length ? ' (' + l.g.join('; ') + ')' : '')).join(' \u2014 ');
  const quals = [...meeting.n, ...meeting.d, meeting.c.join('; ')].filter(Boolean);
  if (name && quals.length) name += ' (' + quals.join(' : ') + ')';
  return name;
}
// Meeting/conference (X11): $a = meeting name, $n = number, $d = date,
// $c = location. Rendered as "Name (n. : date : location)" when the qualifiers
// are present, otherwise just the name.
function meetD(s) {
  const a = (s.find(x => x.c === 'a') || {}).v || '';
  const q = (s.find(x => x.c === 'q') || {}).v;
  // $c is repeatable (several places: «Higashihiroshima-shi, Japan;
  // Online»), and the AACR2 punctuation around the values is dropped.
  const n = bareSub((s.find(x => x.c === 'n') || {}).v);
  const d = bareSub((s.find(x => x.c === 'd') || {}).v);
  const c = s.filter(x => x.c === 'c').map(x => bareSub(x.v)).filter(Boolean).join('; ');
  const quals = [n, d, c].filter(Boolean);
  let name = [a, q].filter(Boolean).map(v => v.replace(/[.,\s]+$/, '')).join(' \u2014 ');
  if (quals.length) name += ' (' + quals.join(' : ') + ')';
  const subordinateUnits = s.filter(x => x.c === 'e').map(x => x.v.replace(/[.,\s]+$/, '')).filter(Boolean);
  return [name, ...subordinateUnits].filter(Boolean).join(' \u2014 ');
}
// Uniform title as subject (630). Qualifying subfields belong to the identity
// of the work and must not be flattened into topical subdivisions.
function uniformTitleD(s) {
  const identityCodes = new Set(['a', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't']);
  return s.filter(x => identityCodes.has(x.c) && x.v)
    .map(x => x.v.replace(/[.,\s]+$/, '')).filter(Boolean).join(' \u2014 ');
}
function uniformTitleDisplay(s) {
  const root = uniformTitleD(s);
  const subdivisions = s.filter(x => 'xzy'.includes(x.c)).map(x => x.v.replace(/\.$/, ''));
  const forms = s.filter(x => x.c === 'v').map(x => x.v.replace(/\.$/, ''));
  return [root, ...subdivisions, ...forms].filter(Boolean).join(' \u2014 ');
}
// name-title, body-title, meeting-title (X00/X10/X11 with $t) — a
// work. The heading is «Author: Title. Parts (qualifiers)»: the name is built
// from the subfields before $t (namD / corpD / meetD), $n and $p follow the
// title after a full stop, $f $g $k $l $m $o $r $s go in parentheses. Subject
// subdivisions ($x $y $z $v) are not part of it (nameD / nameC add them).
const NAME_SUBJECTS = { '600': ['person', '6'], '610': ['corporate', '6c'], '611': ['meeting', '6m'] };
function hasTitle(s) { return s.some(x => x.c === 't'); }
function workD(s, kind) {
  const p = workParts(s, kind);
  return !p ? '' : p.author ? p.author + ': ' + p.title : p.title;
}
// The two halves of a work heading: the author (person, body, meeting) and
// the title with its parts and qualifiers.
function workParts(s, kind) {
  const i = s.findIndex(x => x.c === 't');
  if (i < 0) return null;
  const head = s.slice(0, i);
  const author = kind === 'corporate' ? corpD(head) : kind === 'meeting' ? meetD(head) : namD(head);
  const clean = v => String(v || '').replace(/<<|>>/g, '').trim().replace(/[\s.,:;/]+$/, '');
  let title = clean(s[i].v);
  const quals = [];
  for (const x of s.slice(i + 1)) {
    if ('npt'.includes(x.c)) { const v = clean(x.v); if (v) title += '. ' + v; }
    else if ('fgklmors'.includes(x.c)) { const v = bareSub(String(x.v || '').replace(/<<|>>/g, '')); if (v) quals.push(v); }
  }
  if (quals.length) title += ' (' + quals.join('; ') + ')';
  return { author, title };
}
// nameD: full display string for a name-as-subject entry (600/610/611).
// Takes the already-built root (from namD/corpD/meetD) and appends the
// topical/geographic/chronological/form subdivisions joined with em-dash,
// mirroring how sbtD renders regular subject strings. Form ($v) is appended
// last so it reads as "Name — subdivision — form".
function nameD(s, rootName) {
  const main = s.filter(x => 'xzy'.includes(x.c)).map(x => x.v.replace(/\.$/, ''));
  const form = s.filter(x => x.c === 'v').map(x => x.v.replace(/\.$/, ''));
  return [rootName, ...main, ...form].filter(Boolean).join(' \u2014 ');
}
// One routine for the components of a subject string, shared
// by sbtC, subjectC and nameC (three copies before). Each subfield whose code
// is in `codes` becomes one or more components of the same type: $a, $x
// (topic), $z (place), $y (period), $v (form). A trailing full stop is dropped
// from $y and $v only. Terms joined by a bracketed connector — [e], [del] … —
// are split into separate components, in every subfield.
function subfieldComponents(s, codes) {
  const c = [];
  s.forEach(x => {
    if (!codes.includes(x.c)) return;
    const type = 'azyv'.includes(x.c) ? x.c : 'x';
    const val = (type === 'y' || type === 'v') ? x.v.replace(/\.$/, '') : x.v;
    val.split(/\s*\[[^\]]+\]\s*/).forEach(part => {
      const p = part.trim();
      if (p) c.push({ t: p, type });
    });
  });
  return c;
}
// sbtC: broken into components. $v is a "form of document" (guide, manual,
// dictionary ...). It is NOT useful as a standalone subject search (would
// return too much noise) but IS useful as a refinement in combined searches;
// so we emit it as a component with type 'v', to be handled differently by
// the UI (not individually searchable, but available in the AND builder).
function sbtC(s) {
  return subfieldComponents(s, 'axzyv');
}
function subjectC(s, tag) {
  if (tag !== '630') return sbtC(s);
  const root = uniformTitleD(s);
  return [...(root ? [{ t: root, type: 'a' }] : []), ...subfieldComponents(s, 'xzyv')];
}
function subjectComponentTermType(component, tag) {
  if (component?.type === 'y') return 'period';
  if (component?.type === 'z') return 'place';
  if (component?.type === 'v') return 'form';
  if (component?.type === 'a' && tag === '651') return 'place';
  if (component?.type === 'a' && tag === '648') return 'period';
  if (component?.type === 'a' && tag === '655') return 'form';
  if (component?.type === 'a' && tag === '630') return 'work';
  return 'topic';
}
// nameC: like sbtC but for name-as-subject fields (600/610/611).
// The root name is built with the kind-specific formatter (namD / corpD /
// meetD) so that qualifiers like birth/death dates ($d on 600), subordinate
// units ($b on 610) and meeting number/date/place ($n/$d/$c on 611) stay
// embedded in the root chip — they are *part of the identity*, not
// subdivisions. The remaining subdivisions $x, $z, $y, $v are emitted as
// separate chips, with the same semantic typing used for 650/651: topic /
// place / period / form. The form chip is kept but not individually
// searchable, as for regular subject strings.
function nameC(s, kind, workOf) {
  // A work shows its title, then its author as a
  // chip of its own — [Alice's adventures in Wonderland] [author: Carroll,
  // Lewis] [Illustrazioni] — not «Author: Title» repeated. The title chip
  // keeps the full heading in `term`: it is reconciled with it (the author
  // check on Wikidata needs both halves).
  if (kind === 'work') {
    const p = workParts(s, workOf || 'person');
    if (p) {
      return [{ t: p.title, type: 'a', term: workD(s, workOf || 'person') },
        ...(p.author ? [{ t: p.author, type: 'author', kind: workOf || 'person' }] : []),
        ...subfieldComponents(s, 'xzyv')];
    }
  }
  const root = kind === 'work'      ? workD(s, workOf || 'person')
             : kind === 'corporate' ? corpD(s)
             : kind === 'meeting'   ? meetD(s)
             :                        namD(s);
  return [...(root ? [{ t: root, type: 'a' }] : []), ...subfieldComponents(s, 'xzyv')];
}
