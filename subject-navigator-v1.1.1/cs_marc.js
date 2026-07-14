// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 3/7): MARC extraction — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';
// ═══════════════════════════════════════════
// MARC EXTRACTION
// ═══════════════════════════════════════════
function extractAll(fields) {
  const sbt = [], gnd = [], idr = [], names = [];
  const cduClasses = [], cddClasses = [];
  const seen = new Set();
  for (const f of fields) {
    if (!f.subs) continue;
    const v2 = (f.subs.find(s => s.c === '2') || {}).v || '';
    // CDU locale (691 $2 usi-TM)
    if (f.tag === '691' && v2 === 'usi-TM') {
      const num = (f.subs.find(s => s.c === 'a') || f.subs.find(s => s.c === 'e') || {}).v || '';
      const numClean = num.replace(/\s+/g, '');
      if (numClean && !seen.has('cdu-' + numClean)) {
        seen.add('cdu-' + numClean);
        cduClasses.push({ num: numClean, raw: f.subs });
      }
    }
    // CDD ridotta 23sdnb (082 $2 23sdnb)
    if (f.tag === '082' && v2 === '23sdnb') {
      const num = (f.subs.find(s => s.c === 'a') || {}).v || '';
      if (num && !seen.has('cdd-' + num)) {
        seen.add('cdd-' + num);
        cddClasses.push({ num: num.trim(), raw: f.subs });
      }
    }
    const gi = exG(f.subs);
    const ii = exI(f.subs);
    if (['650', '651', '648'].includes(f.tag)) {
      if (v2.startsWith('sbt')) {
        const k = 's-' + f.tag + '-' + v2 + '-' + sbtD(f.subs).toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          sbt.push({ tag: f.tag, subs: f.subs, vocab: v2, display: sbtD(f.subs) });
        }
      } else if (v2.startsWith('gnd')) {
        const t = (f.subs.find(s => s.c === 'a') || {}).v || '';
        const k = 'g-' + t.toLowerCase();
        if (!seen.has(k)) { seen.add(k); gnd.push({ tag: f.tag, term: t, gndId: gi, display: t }); }
      } else if (v2 === 'idref') {
        const t = (f.subs.find(s => s.c === 'a') || {}).v || '';
        const k = 'i-' + t.toLowerCase();
        if (!seen.has(k)) { seen.add(k); idr.push({ tag: f.tag, term: t, idrefId: ii, display: t }); }
      }
    }
    if (f.tag === '600') {
      const nm = namD(f.subs);
      const disp = nameD(f.subs, nm);
      const k = cleanName(nm).toLowerCase();
      if (v2.startsWith('sbt')) { if (!seen.has('s6-' + k)) { seen.add('s6-' + k); sbt.push({ tag: '600', subs: f.subs, vocab: v2, display: disp, isName: true, kind: 'person' }); } }
      else if (v2 === 'gnd') { if (!seen.has('g6-' + k)) { seen.add('g6-' + k); gnd.push({ tag: '600', term: nm, gndId: gi, display: disp, isName: true, kind: 'person' }); } }
      else if (v2 === 'idref') { if (!seen.has('i6-' + k)) { seen.add('i6-' + k); idr.push({ tag: '600', term: nm, idrefId: ii, display: disp, isName: true, kind: 'person' }); } }
    }
    // 610: corporate body as subject — the book is *about* this organisation
    if (f.tag === '610') {
      const nm = corpD(f.subs);
      const disp = nameD(f.subs, nm);
      const k = cleanName(nm).toLowerCase();
      if (v2.startsWith('sbt')) { if (!seen.has('s6c-' + k)) { seen.add('s6c-' + k); sbt.push({ tag: '610', subs: f.subs, vocab: v2, display: disp, isName: true, kind: 'corporate' }); } }
      else if (v2 === 'gnd') { if (!seen.has('g6c-' + k)) { seen.add('g6c-' + k); gnd.push({ tag: '610', term: nm, gndId: gi, display: disp, isName: true, kind: 'corporate' }); } }
      else if (v2 === 'idref') { if (!seen.has('i6c-' + k)) { seen.add('i6c-' + k); idr.push({ tag: '610', term: nm, idrefId: ii, display: disp, isName: true, kind: 'corporate' }); } }
    }
    // 611: meeting/conference as subject — the book is *about* this event
    if (f.tag === '611') {
      const nm = meetD(f.subs);
      const disp = nameD(f.subs, nm);
      const k = cleanName(nm).toLowerCase();
      if (v2.startsWith('sbt')) { if (!seen.has('s6m-' + k)) { seen.add('s6m-' + k); sbt.push({ tag: '611', subs: f.subs, vocab: v2, display: disp, isName: true, kind: 'meeting' }); } }
      else if (v2 === 'gnd') { if (!seen.has('g6m-' + k)) { seen.add('g6m-' + k); gnd.push({ tag: '611', term: nm, gndId: gi, display: disp, isName: true, kind: 'meeting' }); } }
      else if (v2 === 'idref') { if (!seen.has('i6m-' + k)) { seen.add('i6m-' + k); idr.push({ tag: '611', term: nm, idrefId: ii, display: disp, isName: true, kind: 'meeting' }); } }
    }
    if (f.tag === '100' || f.tag === '700') {
      const nm = namD(f.subs);
      const k = 'n-' + cleanName(nm).toLowerCase();
      const role = (f.subs.find(s => s.c === 'e') || {}).v || (f.subs.find(s => s.c === '4') || {}).v || '';
      if (nm && !seen.has(k)) { seen.add(k); names.push({ tag: f.tag, kind: 'person', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, role }); }
    }
    if (f.tag === '110' || f.tag === '710') {
      const nm = corpD(f.subs);
      const k = 'c-' + cleanName(nm).toLowerCase();
      const role = (f.subs.find(s => s.c === 'e') || {}).v || (f.subs.find(s => s.c === '4') || {}).v || '';
      if (nm && !seen.has(k)) { seen.add(k); names.push({ tag: f.tag, kind: 'corporate', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, role }); }
    }
    if (f.tag === '111' || f.tag === '711') {
      const nm = meetD(f.subs);
      const k = 'm-' + cleanName(nm).toLowerCase();
      const role = (f.subs.find(s => s.c === 'j') || {}).v || (f.subs.find(s => s.c === '4') || {}).v || '';
      if (nm && !seen.has(k)) { seen.add(k); names.push({ tag: f.tag, kind: 'meeting', name: nm, gndId: exG(f.subs), idrefId: exI(f.subs), display: nm, role }); }
    }
  }
  return { sbt, gnd, idr, names, cduClasses, cddClasses };
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
function namD(s) { let n = (s.find(x => x.c === 'a') || {}).v || ''; const c = (s.find(x => x.c === 'c') || {}).v; if (c) n = n.replace(/\s*$/, '') + ' ' + c; const d = (s.find(x => x.c === 'd') || {}).v; if (d) n += ' (' + d.replace(/[.\s]+$/, '') + ')'; return n.replace(/,\s*$/, ''); }
// Corporate body (X10): $a = main heading, $b = subordinate unit (may repeat,
// one per level). Joined with " — " to mirror the hierarchical path.
function corpD(s) {
  const a = (s.find(x => x.c === 'a') || {}).v || '';
  const bs = s.filter(x => x.c === 'b').map(x => x.v.replace(/[.,\s]+$/, ''));
  return [a.replace(/[.,\s]+$/, ''), ...bs].filter(Boolean).join(' \u2014 ');
}
// Meeting/conference (X11): $a = meeting name, $n = number, $d = date,
// $c = location. Rendered as "Name (n. : date : location)" when the qualifiers
// are present, otherwise just the name.
function meetD(s) {
  const a = (s.find(x => x.c === 'a') || {}).v || '';
  const n = (s.find(x => x.c === 'n') || {}).v;
  const d = (s.find(x => x.c === 'd') || {}).v;
  const c = (s.find(x => x.c === 'c') || {}).v;
  const quals = [n, d, c].map(v => v ? v.replace(/[.,\s]+$/, '') : '').filter(Boolean);
  let name = a.replace(/[.,\s]+$/, '');
  if (quals.length) name += ' (' + quals.join(' : ') + ')';
  return name;
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
// sbtC: broken into components. $v is a "form of document" (guide, manual,
// dictionary ...). It is NOT useful as a standalone subject search (would
// return too much noise) but IS useful as a refinement in combined searches;
// so we emit it as a component with type 'v', to be handled differently by
// the UI (not individually searchable, but available in the AND builder).
function sbtC(s) {
  const c = [];
  s.forEach(x => {
    if (!'axzyv'.includes(x.c)) return;
    const type = x.c === 'y' ? 'y'
               : x.c === 'z' ? 'z'
               : x.c === 'a' ? 'a'
               : x.c === 'v' ? 'v'
               : 'x';
    const val = (type === 'y' || type === 'v') ? x.v.replace(/\.$/, '') : x.v;
    // Split terms connected by bracketed connectors like [e], [del], etc.
    // Applies to all subfields ($a, $x, $z, $y, $v)
    const parts = val.split(/\s*\[[^\]]+\]\s*/);
    parts.forEach(part => {
      const p = part.trim();
      if (p) c.push({ t: p, type });
    });
  });
  return c;
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
function nameC(s, kind) {
  const root = kind === 'corporate' ? corpD(s)
             : kind === 'meeting'   ? meetD(s)
             :                        namD(s);
  const c = [];
  if (root) c.push({ t: root, type: 'a' });
  s.forEach(x => {
    if (!'xzyv'.includes(x.c)) return;
    const type = x.c === 'y' ? 'y'
               : x.c === 'z' ? 'z'
               : x.c === 'v' ? 'v'
               : 'x';
    const val = (type === 'y' || type === 'v') ? x.v.replace(/\.$/, '') : x.v;
    const parts = val.split(/\s*\[[^\]]+\]\s*/);
    parts.forEach(part => {
      const p = part.trim();
      if (p) c.push({ t: p, type });
    });
  });
  return c;
}
