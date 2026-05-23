// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — BACKGROUND SERVICE WORKER v1.0.1
// + IdRef Solr API for names/places/bodies
// + Lobid for GND names/places/bodies
// ═══════════════════════════════════════════
'use strict';

// ── Constants ──
const NS_SPARQL = 'https://digitale.bncf.firenze.sbn.it/openrdf-sesame/repositories/NS';

// Whitelist of SPARQL endpoints the content script is allowed to query.
const ALLOWED_SPARQL_ENDPOINTS = new Set([
  NS_SPARQL,
  'https://query.wikidata.org/sparql',
  'https://vocab.getty.edu/sparql'
]);

// ── Debug flag ──
// Enable with chrome.storage.local.set({snDebug: true}). Silent by default.
let SN_DEBUG = false;
try {
  chrome.storage.local.get('snDebug', r => { if (r && r.snDebug) SN_DEBUG = true; });
} catch (e) { /* storage unavailable, keep default */ }
function logDebug(...args) {
  if (SN_DEBUG) console.debug('[SN-bg]', ...args);
}

// ── Fetch helpers ──
const FETCH_TIMEOUT_MS = 6000;    // 6 seconds max per external request
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

async function fetchJSON(url) {
  const r = await fetchWithTimeout(url);
  return r.json();
}
async function fetchXML(url) {
  const r = await fetchWithTimeout(url);
  return r.text();
}

// SPARQL for Wikidata/AAT (returns JSON)
function sparqlJSON(ep, q) {
  return fetchJSON(ep + '?query=' + encodeURIComponent(q) + '&format=json');
}

// SPARQL for NS (returns XML — openrdf-sesame always returns XML)
async function sparqlXML(ep, q) {
  const url = ep + '?query=' + encodeURIComponent(q);
  const r = await fetchWithTimeout(url, { headers: { 'Accept': 'application/sparql-results+xml' } });
  const xml = await r.text();
  return parseSparqlResultsXML(xml);
}

// Parse SPARQL Results XML into {results:{bindings:[...]}} structure
function parseSparqlResultsXML(xml) {
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
async function fetchMarcViaSRU(mmsId, instCode, pageHost) {
  // Security: mmsId must be digits only. Even though content.js extracts
  // it via regex, we re-validate here so that any refactor upstream does
  // not break this invariant.
  if (!/^\d+$/.test(String(mmsId))) {
    logDebug('fetchMarcViaSRU: invalid mmsId', mmsId);
    return null;
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
    if (pageHost && !pageHost.includes('swisscovery'))
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
function parseMarcXML(xmlText) {
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

function decXML(t) {
  return t
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

// ── BNE fetch (Spanish authoritative label) ──
async function fetchBNE(bneId) {
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
async function fetchLCSH(lcshId) {
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

// ── URL validation (security) ──
function isAllowedUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// ── Message handler ──
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'fetchMarc') {
    const { docId, mmsId, vid, instCode, pageHost } = msg;
    (async () => {
      if (mmsId) {
        const r = await fetchMarcViaSRU(mmsId, instCode, pageHost);
        if (r) return r;
      }
      return { error: 'Could not fetch MARC data' };
    })().then(sendResponse).catch(e => {
      logDebug('fetchMarc error', e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'sparql') {
    if (!ALLOWED_SPARQL_ENDPOINTS.has(msg.endpoint)) {
      sendResponse({ error: 'SPARQL endpoint not allowed' });
      return true;
    }
    const isNS = msg.endpoint === NS_SPARQL;
    const fn = isNS ? sparqlXML(msg.endpoint, msg.query) : sparqlJSON(msg.endpoint, msg.query);
    fn.then(data => sendResponse({ data })).catch(e => {
      logDebug('sparql error', msg.endpoint, e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'fetchJSON') {
    if (!isAllowedUrl(msg.url)) {
      sendResponse({ error: 'URL not allowed' });
      return true;
    }
    fetchJSON(msg.url).then(data => sendResponse({ data })).catch(e => {
      logDebug('fetchJSON error', msg.url, e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'lobid') {
    fetchJSON('https://lobid.org/gnd/' + encodeURIComponent(msg.gndId) + '.json')
      .then(data => sendResponse({ data }))
      .catch(e => {
        logDebug('lobid error', msg.gndId, e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  if (msg.type === 'idref') {
    fetchJSON('https://www.idref.fr/' + encodeURIComponent(msg.idrefId) + '.json')
      .then(data => sendResponse({ data }))
      .catch(e => {
        logDebug('idref error', msg.idrefId, e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  if (msg.type === 'idrefSolr') {
    const url = 'https://www.idref.fr/Sru/Solr?q=ppn_z:'
      + encodeURIComponent(msg.ppn)
      + '&wt=json&fl=ppn_z,affcourt_z,affcourt_r,recordtype_z&rows=1&version=2.2';
    fetchJSON(url)
      .then(data => {
        const doc = data?.response?.docs?.[0] || null;
        sendResponse({ data: doc });
      })
      .catch(e => {
        logDebug('idrefSolr error', msg.ppn, e);
        sendResponse({ error: e.message || String(e) });
      });
    return true;
  }

  if (msg.type === 'fetchBNE') {
    fetchBNE(msg.bneId).then(label => sendResponse({ data: label })).catch(e => {
      logDebug('fetchBNE error', msg.bneId, e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }

  if (msg.type === 'fetchLCSH') {
    fetchLCSH(msg.lcshId).then(label => sendResponse({ data: label })).catch(e => {
      logDebug('fetchLCSH error', msg.lcshId, e);
      sendResponse({ error: e.message || String(e) });
    });
    return true;
  }
});

// ── Programmatic injection ──
const injectedTabs = new Set();
function isTargetUrl(url) {
  return url && /swisscovery|reperio\.usi\.ch|explore\.lib\.unige\.ch/.test(url);
}

chrome.action.onClicked.addListener(tab => { injectIfNeeded(tab.id, tab.url); });
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) injectIfNeeded(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener(tabId => { injectedTabs.delete(tabId); });

async function injectIfNeeded(tabId, url) {
  if (!isTargetUrl(url)) return;
  if (injectedTabs.has(tabId)) {
    chrome.tabs.sendMessage(tabId, { type: 'checkUrl' }).catch(() => {
      injectedTabs.delete(tabId);
      doInject(tabId);
    });
    return;
  }
  doInject(tabId);
}

async function doInject(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['sidebar.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    injectedTabs.add(tabId);
  } catch (e) { logDebug('doInject', tabId, e); }
}
