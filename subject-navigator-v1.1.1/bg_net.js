// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: network layer — v1.1.0
// The ONLY module that talks to the network. Every outbound request goes
// through a host/endpoint whitelist, a 6-second timeout and a 5 MB cap on
// the actual response bytes. IDs that end up in URL paths are re-validated
// here even when the caller already validated them (defence in depth).
// v1.1.0: with reconciliation living in the worker, the generic
// content→worker fetch bridge of v1.0.x is gone entirely — the message
// surface no longer exposes any URL-shaped input.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, NS_SPARQL } from './bg_util.js';

// Whitelist of SPARQL endpoints reconciliation may query.
export const ALLOWED_SPARQL_ENDPOINTS = new Set([
  NS_SPARQL,
  'https://query.wikidata.org/sparql',
  'https://vocab.getty.edu/sparql'
]);

// Whitelist of hosts fetchJSON may reach. All JSON lookups target known
// bibliographic authorities; anything else is a programming error and is
// rejected as an invariant violation.
export const ALLOWED_FETCH_HOSTS = new Set([
  'www.wikidata.org',
  'query.wikidata.org',
  'data.bnf.fr',
  'id.loc.gov',
  'datos.bne.es',
  'lobid.org',
  'www.idref.fr',
  'vocab.getty.edu',
  'digitale.bncf.firenze.sbn.it'
]);

// Hosts allowed as SRU bases besides the fixed swisscovery domains
// (pageHost arrives from the content script and is re-validated here).
export const ALLOWED_SRU_PAGE_HOSTS = new Set([
  'reperio.usi.ch',
  'explore.lib.unige.ch'
]);

// ── Fetch helpers ──
const FETCH_TIMEOUT_MS = 6000;        // 6 seconds max per external request
const MAX_RESPONSE_BYTES = 5_000_000; // 5 MB — reject unexpectedly large responses

async function fetchWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = parseInt(r.headers.get('content-length') || '0', 10);
    if (len > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
    return r;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('TIMEOUT');
    throw e;
  }
}

// The Content-Length check above can be sidestepped by chunked responses
// that omit the header; here the cap is enforced on the actual bytes read.
async function readTextCapped(resp) {
  if (!resp.body || !resp.body.getReader) {
    const t = await resp.text();
    if (t.length > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
    return t;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let out = '', received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      reader.cancel();
      throw new Error('RESPONSE_TOO_LARGE');
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

// https-only AND hostname in the whitelist.
export function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_FETCH_HOSTS.has(u.hostname);
  } catch (e) {
    return false;
  }
}

export async function fetchJSON(url) {
  if (!isAllowedUrl(url)) throw new Error('URL not allowed: ' + url);
  const r = await fetchWithTimeout(url);
  return JSON.parse(await readTextCapped(r));
}

// XML fetches are used only by the SRU MARC path, whose base URLs are
// assembled locally from fixed hosts + validated parts (no whitelist here).
export async function fetchXML(url) {
  const r = await fetchWithTimeout(url);
  return readTextCapped(r);
}

// ── SPARQL ──
function sparqlJSON(ep, q) {
  return fetchJSON(ep + '?query=' + encodeURIComponent(q) + '&format=json');
}

// openrdf-sesame (NS endpoint) always returns XML
async function sparqlXML(ep, q) {
  const url = ep + '?query=' + encodeURIComponent(q);
  const r = await fetchWithTimeout(url, { headers: { 'Accept': 'application/sparql-results+xml' } });
  const xml = await readTextCapped(r);
  return parseSparqlResultsXML(xml);
}

// Single entry point used by reconciliation: dispatches on endpoint type
// and enforces the endpoint whitelist.
export function sparql(ep, q) {
  if (!ALLOWED_SPARQL_ENDPOINTS.has(ep)) return Promise.reject(new Error('SPARQL endpoint not allowed'));
  return ep === NS_SPARQL ? sparqlXML(ep, q) : sparqlJSON(ep, q);
}

// Parse SPARQL Results XML into {results:{bindings:[...]}} structure
export function parseSparqlResultsXML(xml) {
  const bindings = [];
  const resultRx = /<(?:\w+:)?result\b[^>]*>([\s\S]*?)<\/(?:\w+:)?result>/g;
  let rm;
  while ((rm = resultRx.exec(xml)) !== null) {
    const row = {};
    const bindRx = /<(?:\w+:)?binding\s+name=['"]([^'"]+)['"][^>]*>\s*<(?:\w+:)?(uri|literal)[^>]*>([\s\S]*?)<\/(?:\w+:)?\2>\s*<\/(?:\w+:)?binding>/g;
    let bm;
    while ((bm = bindRx.exec(rm[1])) !== null) {
      row[bm[1]] = { type: bm[2], value: decXML(bm[3].trim()) };
    }
    if (Object.keys(row).length) bindings.push(row);
  }
  return { results: { bindings } };
}

// ── SRU MARC fetcher ──
export async function fetchMarcViaSRU(mmsId, instCode, pageHost) {
  // Security: mmsId must be digits only. The content script extracts it via
  // regex already, but we re-validate here so that any upstream refactor
  // cannot break this invariant.
  if (!/^\d+$/.test(String(mmsId))) {
    logDebug('fetchMarcViaSRU: invalid mmsId', mmsId);
    return null;
  }
  // Security: instCode re-validated here (same rationale as mmsId).
  if (instCode && !/^[\w-]{1,50}$/.test(String(instCode))) {
    logDebug('fetchMarcViaSRU: invalid instCode', instCode);
    instCode = '';
  }
  for (const base of [
    'https://swisscovery.slsp.ch/view/sru/41SLSP_NETWORK',
    'https://swisscovery.ch/view/sru/41SLSP_NETWORK'
  ]) {
    try {
      const xml = await fetchXML(base + '?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.mms_id=' + mmsId);
      const marc = parseMarcXML(xml);
      if (marc.length > 0) return { fields: marc, source: 'SRU-NZ' };
    } catch (e) { logDebug('SRU-NZ fail', base, e.message); }
  }
  if (instCode && instCode !== '41SLSP_NETWORK') {
    const bases = [];
    // Security: only known non-swisscovery catalog hosts may serve as SRU base.
    if (pageHost && ALLOWED_SRU_PAGE_HOSTS.has(String(pageHost)))
      bases.push('https://' + pageHost + '/view/sru/' + instCode);
    bases.push(
      'https://swisscovery.slsp.ch/view/sru/' + instCode,
      'https://swisscovery.ch/view/sru/' + instCode
    );
    for (const base of bases) {
      try {
        const xml = await fetchXML(base + '?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.mms_id=' + mmsId);
        const marc = parseMarcXML(xml);
        if (marc.length > 0) return { fields: marc, source: 'SRU-IZ' };
      } catch (e) { logDebug('SRU-IZ fail', base, e.message); }
    }
  }
  return null;
}

// ── MARC XML parser (attribute-order agnostic) ──
export function parseMarcXML(xmlText) {
  const fields = [];
  const dfRx = /<(?:marc:)?datafield\s+([^>]+)>([\s\S]*?)<\/(?:marc:)?datafield>/g;
  let m;
  while ((m = dfRx.exec(xmlText)) !== null) {
    const attrs = m[1], body = m[2];
    const tagM = attrs.match(/tag="(\d{3})"/);
    const i1M = attrs.match(/ind1="(.?)"/);
    const i2M = attrs.match(/ind2="(.?)"/);
    if (!tagM) continue;
    const subs = [];
    const sfRx = /<(?:marc:)?subfield\s+code="(.)">([\s\S]*?)<\/(?:marc:)?subfield>/g;
    let sf;
    while ((sf = sfRx.exec(body)) !== null) {
      subs.push({ c: sf[1], v: decXML(sf[2].trim()) });
    }
    if (subs.length) fields.push({ tag: tagM[1], ind: (i1M ? i1M[1] : ' ') + (i2M ? i2M[1] : ' '), subs });
  }
  return fields;
}

// &amp; must be decoded LAST, otherwise "&amp;lt;" would wrongly become "<"
// (double decoding). Order: numeric entities, then named ones, &amp; last.
export function decXML(t) {
  return t
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// ── Authority API wrappers ──
// Same semantics as the v1.0.x message bridges, now plain function calls.

export function lobid(gndId) {
  return fetchJSON('https://lobid.org/gnd/' + encodeURIComponent(gndId) + '.json');
}

export function idrefJSON(idrefId) {
  return fetchJSON('https://www.idref.fr/' + encodeURIComponent(idrefId) + '.json');
}

export async function idrefSolr(ppn) {
  const url = 'https://www.idref.fr/Sru/Solr?q=ppn_z:'
    + encodeURIComponent(ppn)
    + '&wt=json&fl=ppn_z,affcourt_z,affcourt_r,recordtype_z&rows=1&version=2.2';
  const data = await fetchJSON(url);
  return data?.response?.docs?.[0] || null;
}

// ── BNE fetch (Spanish authoritative label) ──
export async function fetchBNE(bneId) {
  // Security: the ID lands in a URL path — alphanumeric only.
  if (!/^[A-Za-z0-9]{1,40}$/.test(String(bneId))) return null;
  try {
    const data = await fetchJSON('https://datos.bne.es/resource/' + bneId + '.jsonld');
    if (!data) return null;
    // JSON-LD: look for skos:prefLabel or rdfs:label
    const graph = data['@graph'] || (Array.isArray(data) ? data : [data]);
    for (const node of graph) {
      const pl = node['skos:prefLabel'] || node['http://www.w3.org/2004/02/skos/core#prefLabel'];
      if (pl) {
        if (typeof pl === 'string') return pl;
        if (Array.isArray(pl)) {
          const es = pl.find(x => (x['@language'] || '').startsWith('es'));
          if (es) return es['@value'] || es;
          return pl[0]?.['@value'] || pl[0] || null;
        }
        return pl['@value'] || null;
      }
      // Fallback: rdfs:label
      const lb = node['rdfs:label'] || node['http://www.w3.org/2000/01/rdf-schema#label'];
      if (lb) {
        if (typeof lb === 'string') return lb;
        if (lb['@value']) return lb['@value'];
      }
    }
  } catch (e) { logDebug('fetchBNE', bneId, e); }
  return null;
}

// ── LoC/LCSH fetch (English authoritative heading) ──
export async function fetchLCSH(lcshId) {
  // Security: the ID lands in a URL path — sh/sj prefix + digits.
  if (!/^[a-z]{1,3}[0-9]{4,12}$/i.test(String(lcshId))) return null;
  try {
    const url = 'https://id.loc.gov/authorities/subjects/' + lcshId + '.json';
    const data = await fetchJSON(url);
    if (!data || !Array.isArray(data)) return null;
    const targetUri = 'http://id.loc.gov/authorities/subjects/' + lcshId;
    for (const node of data) {
      const nid = node['@id'] || '';
      if (nid !== targetUri) continue;
      const al = node['http://www.loc.gov/mads/rdf/v1#authoritativeLabel'];
      if (al && al.length) {
        const eng = al.find(x => (x['@language'] || 'en') === 'en');
        return (eng || al[0])?.['@value'] || null;
      }
      const pl = node['http://www.w3.org/2004/02/skos/core#prefLabel'];
      if (pl && pl.length) {
        const eng = pl.find(x => (x['@language'] || 'en') === 'en');
        return (eng || pl[0])?.['@value'] || null;
      }
    }
  } catch (e) { logDebug('fetchLCSH', lcshId, e); }
  return null;
}

// ── BnF JSON-LD label fetch (HTTP fallback for missing FR labels) ──
export async function fetchBnfLabelRemote(bnfArk) {
  // Security: the ARK lands in a URL path — BnF ARKs are "cb" + alphanumerics.
  if (!/^cb[A-Za-z0-9]{1,20}$/.test(String(bnfArk))) return null;
  try {
    const bj = await fetchJSON('https://data.bnf.fr/fr/ark:/12148/' + bnfArk + '.rdfjsonld');
    if (!bj) return null;
    const targetUri = 'http://data.bnf.fr/ark:/12148/' + bnfArk;
    for (const node of (bj['@graph'] || [])) {
      const nid = node['@id'] || '';
      if (nid !== targetUri && nid !== targetUri + '#about') continue;
      const pl = node['skos:prefLabel'] || node['http://www.w3.org/2004/02/skos/core#prefLabel'];
      if (!pl) continue;
      if (typeof pl === 'string') return pl;
      if (Array.isArray(pl)) {
        const fr = pl.find(x => typeof x === 'string' || (x && x['@language'] === 'fr'));
        return (fr && typeof fr === 'string') ? fr : (fr?.['@value'] || null);
      }
      return pl['@value'] || null;
    }
  } catch (e) { logDebug('fetchBnfLabelRemote', bnfArk, e); }
  return null;
}
