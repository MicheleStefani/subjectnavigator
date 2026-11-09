// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: network layer
// The ONLY module that talks to the network. Every outbound request goes
// through a host/endpoint whitelist, a 6-second timeout and a 5 MB cap on
// the actual response bytes. IDs that end up in URL paths are re-validated
// here even when the caller already validated them (defence in depth).
// With reconciliation living in the worker there is no generic
// content→worker fetch bridge — the message surface exposes no
// URL-shaped input.
// ═══════════════════════════════════════════
'use strict';

import { logDebug, NS_SPARQL, WD_SPARQL, WD_SPARQL_FALLBACK, API_USER_AGENT, WIKIMEDIA_HOSTS, timingEvent, LRUMap } from './bg_util.js';
import { ALLOWED_SRU_HOSTS, isAllowedSruUrl, marcSources } from './bg_site.js';

// Whitelist of SPARQL endpoints reconciliation may query.
export const ALLOWED_SPARQL_ENDPOINTS = new Set([
  NS_SPARQL,
  WD_SPARQL,
  WD_SPARQL_FALLBACK,
  'https://vocab.getty.edu/sparql'
]);

// Whitelist of hosts fetchJSON may reach. All JSON lookups target known
// bibliographic authorities; anything else is a programming error and is
// rejected as an invariant violation.
export const ALLOWED_FETCH_HOSTS = new Set([
  'www.wikidata.org',
  'query.wikidata.org',
  'qlever.dev',          // Wikidata on QLever (see WD_SPARQL)
  'data.bnf.fr',
  'id.loc.gov',
  'datos.bne.es',
  'lobid.org',
  'www.idref.fr',
  'vocab.getty.edu',
  'digitale.bncf.firenze.sbn.it'
]);

// The SRU (MARC) hosts and addresses belong to the site adapter (bg_site.js).

// A failure that may pass — time-out, no network, server
// error, rate limit — as opposed to an answer or a refusal (404, 403: BNE's
// Cloudflare). The card says which service did not answer, and an
// incomplete result is not kept.
export function isTemporaryFailure(e) {
  const m = String(e?.message || '');
  return m === 'TIMEOUT' || /^HTTP (5\d\d|429)$/.test(m) || e?.name === 'TypeError';
}

// ── Fetch helpers ──
const FETCH_TIMEOUT_MS = 6000;        // 6 seconds max per external request
const MAX_RESPONSE_BYTES = 5_000_000; // 5 MB — reject unexpectedly large responses

async function fetchTextWithTimeout(url, options = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  let outcome = 'ok', bytes = 0;
  try {
    // Wikimedia services are told who is asking (Api-User-Agent).
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { /* invalid URL: fetch rejects it */ }
    if (WIKIMEDIA_HOSTS.has(host)) options = { ...options, headers: { ...(options.headers || {}), 'Api-User-Agent': API_USER_AGENT } };
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    // With redirect:'manual' a redirect is reported, not followed.
    if (r.type === 'opaqueredirect') throw new Error('REDIRECT');
    // The whitelist is checked on the address asked; a
    // redirect is followed only if it ends on a whitelisted host too.
    if (r.redirected && !isAllowedFinalUrl(r.url)) throw new Error('REDIRECT');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const len = parseInt(r.headers.get('content-length') || '0', 10);
    if (len > MAX_RESPONSE_BYTES) throw new Error('RESPONSE_TOO_LARGE');
    const text = await readTextCapped(r);
    clearTimeout(timer);
    bytes = text.length;
    return text;
  } catch (e) {
    clearTimeout(timer);
    outcome = e.name === 'AbortError' ? 'TIMEOUT' : (e.message || String(e)).slice(0, 80);
    if (e.name === 'AbortError') throw new Error('TIMEOUT');
    throw e;
  } finally {
    timingEvent({ src: 'net', what: describeRequest(url), ms: Date.now() - t0, outcome, bytes });
  }
}

// Short description of a request for the timing log: host + service, and
// the SPARQL endpoint instead of the (long) query text.
function describeRequest(url) {
  try {
    const u = new URL(url);
    if (u.pathname.includes('/sru/')) return u.hostname + ' SRU (MARC)';
    if (u.searchParams.has('query') || /\/(sparql|api\/wikidata)$/.test(u.pathname)) return u.hostname + ' SPARQL';
    const action = u.searchParams.get('action');
    return (u.hostname + u.pathname + (action ? ' ' + action : '')).slice(0, 120);
  } catch (e) {
    return String(url).slice(0, 120);
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

// Where a followed redirect may end.
export function isAllowedFinalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (ALLOWED_FETCH_HOSTS.has(u.hostname) || ALLOWED_SRU_HOSTS.has(u.hostname));
  } catch (e) {
    return false;
  }
}

export async function fetchJSON(url, options) {
  if (!isAllowedUrl(url)) throw new Error('URL not allowed: ' + url);
  return JSON.parse(await fetchTextWithTimeout(url, options));
}

// XML fetches are used only by the SRU MARC path, whose base URLs are
// assembled locally from fixed hosts + validated parts. They are
// checked here as well, so that a future catalog adapter cannot pass an
// address that was not.
export async function fetchXML(url) {
  if (!isAllowedSruUrl(url)) throw new Error('URL not allowed: ' + url);
  return fetchTextWithTimeout(url);
}

// ── SPARQL ──
// A long query (several terms at once) goes by POST — Getty
// refuses a GET whose address is long (403; a 20-term AAT query is ~2,800
// characters), and the WDQS manual advises POST for large queries.
const SPARQL_GET_MAX = 1800;
function sparqlJSON(ep, q) {
  const params = 'query=' + encodeURIComponent(q) + '&format=json';
  const headers = { 'Accept': 'application/sparql-results+json' };
  if (ep.length + 1 + params.length <= SPARQL_GET_MAX) return fetchJSON(ep + '?' + params, { headers });
  return fetchJSON(ep, { method: 'POST', body: params,
    headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' } });
}

// openrdf-sesame (NS endpoint) always returns XML
async function sparqlXML(ep, q) {
  const url = ep + '?query=' + encodeURIComponent(q);
  const xml = await fetchTextWithTimeout(url, { headers: { 'Accept': 'application/sparql-results+xml' } });
  return parseSparqlResultsXML(xml);
}

// Single entry point used by reconciliation: dispatches on endpoint type
// and enforces the endpoint whitelist.
export function sparql(ep, q) {
  if (!ALLOWED_SPARQL_ENDPOINTS.has(ep)) return Promise.reject(new Error('SPARQL endpoint not allowed'));
  if (ep === NS_SPARQL) return sparqlXML(ep, q);
  // Wikidata — if the first endpoint does not answer, the other.
  if (ep === WD_SPARQL && WD_SPARQL_FALLBACK && WD_SPARQL_FALLBACK !== WD_SPARQL)
    return sparqlJSON(ep, q).catch(() => sparqlJSON(WD_SPARQL_FALLBACK, q));
  return sparqlJSON(ep, q);
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
// The addresses, their order and the id checks come from the
// site adapter (bg_site.js, marcSources); here only the requests, one after
// the other until one returns MARC fields.
export async function fetchMarcViaSRU(mmsId, instCode, pageHost) {
  const sources = marcSources(mmsId, instCode, pageHost);
  if (!sources.length) logDebug('fetchMarcViaSRU: invalid mmsId', mmsId);
  for (const { url, source } of sources) {
    try {
      const marc = parseMarcXML(await fetchXML(url));
      if (marc.length > 0) return { fields: marc, source };
    } catch (e) { logDebug(source + ' fail', url, e.message); }
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
// Plain function calls, used by bg_reconcile.js.

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

// Several IdRef records in one request — a Wikidata item with
// more than one IdRef id (Italia Q38: 026389908, the State as a body, type b;
// 027235408, the place, type c).
export async function idrefSolrMany(ppns) {
  const ok = [...new Set((ppns || []).map(String))].filter(p => /^\d{8}[\dX]$/i.test(p)).slice(0, 10);
  if (!ok.length) return [];
  const url = 'https://www.idref.fr/Sru/Solr?q='
    + encodeURIComponent('ppn_z:(' + ok.join(' OR ') + ')')
    + '&wt=json&fl=ppn_z,affcourt_z,recordtype_z&rows=' + ok.length + '&version=2.2';
  const data = await fetchJSON(url);
  return data?.response?.docs || [];
}

// The IdRef record that declares a BnF ark (its RAMEAU twin),
// for places and names whose Wikidata item has the ark (P268) but no IdRef
// id (P269) — e.g. Europe, Q46. Only an unambiguous answer counts.
export async function idrefSolrByArk(ark) {
  if (!/^cb[0-9a-z]{8,12}$/i.test(String(ark))) return null;
  const url = 'https://www.idref.fr/Sru/Solr?q='
    + encodeURIComponent('idsext_s:"http://catalogue.bnf.fr/ark:/12148/' + ark + '"')
    + '&wt=json&fl=ppn_z,affcourt_z,recordtype_z&rows=2&version=2.2';
  const data = await fetchJSON(url);
  const docs = data?.response?.docs || [];
  return docs.length === 1 ? docs[0] : null;
}

// ── BNE fetch (Spanish authoritative label) ──
// One request per BNE id while the worker lives. datos.bne.es
// refuses most requests (Cloudflare challenge, 403) and the same id was asked
// two or three times for one record (several headings, Navigate); the answer
// — label or refusal — is now shared, also by a request still in flight.
const BNE_ANSWERS = new LRUMap(500);
export function fetchBNE(bneId) {
  const k = String(bneId);
  if (!BNE_ANSWERS.has(k)) BNE_ANSWERS.set(k, fetchBNEOnce(bneId));
  return BNE_ANSWERS.get(k);
}
async function fetchBNEOnce(bneId) {
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
export async function fetchLCSH(lcshId, fails) {
  // Security: the ID lands in a URL path — sh/sj prefix + digits.
  if (!/^[a-z]{1,3}[0-9]{4,12}$/i.test(String(lcshId))) return null;
  // Name authorities (n, nb, no, nr …, reached through Wikidata
  // P244) live under /names/; asking /subjects/ for them always gave 404.
  const scheme = /^n/i.test(String(lcshId)) ? 'names' : 'subjects';
  try {
    const url = 'https://id.loc.gov/authorities/' + scheme + '/' + lcshId + '.json';
    const data = await fetchJSON(url);
    if (!data || !Array.isArray(data)) return null;
    const targetUri = 'http://id.loc.gov/authorities/' + scheme + '/' + lcshId;
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
  } catch (e) { logDebug('fetchLCSH', lcshId, e); if (fails && isTemporaryFailure(e)) fails.add('LC'); }
  return null;
}

// ── BnF JSON-LD label fetch (HTTP fallback for missing FR labels) ──
export async function fetchBnfLabelRemote(bnfArk, fails) {
  // Security: the ARK lands in a URL path — BnF ARKs are "cb" + alphanumerics.
  if (!/^cb[A-Za-z0-9]{1,20}$/.test(String(bnfArk))) return null;
  try {
    // An ark RAMEAU has replaced is redirected by data.bnf.fr
    // to its successor over plain http, where the extension may not read
    // (CORS error in the service worker: NS «Immagini» → cb119409512 →
    // cb11975832b «Illustrations»). The successor is another heading, whose
    // label would be wrong here anyway: the redirect is not followed.
    const url = 'https://data.bnf.fr/fr/ark:/12148/' + bnfArk + '.rdfjsonld';
    if (!isAllowedUrl(url)) return null;
    const bj = JSON.parse(await fetchTextWithTimeout(url, { redirect: 'manual' }));
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
  } catch (e) { logDebug('fetchBnfLabelRemote', bnfArk, e); if (fails && isTemporaryFailure(e)) fails.add('BnF'); }
  return null;
}
