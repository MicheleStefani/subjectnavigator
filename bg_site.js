// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — SW MODULE: site adapter
// The worker side of the site adapter (see cs_site.js): what the worker
// knows about the catalogue — Primo VE on Alma — and nothing else does.
//
//   isTargetUrl(url)          → is this tab one of the catalogue's pages?
//   validMarcRequest(msg)     → are the 'fetchMarc' message parameters well formed?
//   marcSources(mmsId, instCode, pageHost) → the SRU addresses to try, in order
//   isAllowedSruUrl(url)      → may a MARC request go to this address?
//   ALLOWED_SRU_HOSTS         → every host an SRU request may reach
//
// No imports: bg_net.js imports from here, never the other way round.
// ═══════════════════════════════════════════
'use strict';

// Catalogue pages (the manifest's content_scripts.matches say the same).
export function isTargetUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return h === 'reperio.usi.ch' || h === 'explore.lib.unige.ch'
      || h === 'swisscovery.ch' || h.endsWith('.swisscovery.ch')
      || h.endsWith('.swisscovery.slsp.ch')
      || h === 'swisscovery.org' || h.endsWith('.swisscovery.org');
  } catch (e) {
    return false;
  }
}

// The parameters cs_site.js sends (marcRequestParams): the Alma MMS id, the
// institution code of the view, the page's host.
export function validMarcRequest(msg) {
  const { mmsId, instCode, pageHost } = msg || {};
  return typeof mmsId === 'string' && /^\d{5,30}$/.test(mmsId)
    && typeof instCode === 'string' && (instCode === '' || /^[A-Za-z0-9_-]{2,40}$/.test(instCode))
    && typeof pageHost === 'string' && pageHost.length <= 120;
}

// Catalogues other than swisscovery whose own SRU may serve the record
// (pageHost arrives from the content script and is checked against this).
export const ALLOWED_SRU_PAGE_HOSTS = new Set([
  'reperio.usi.ch',
  'explore.lib.unige.ch'
]);

// Every host an SRU (MARC) request may go to — the two
// swisscovery domains plus the catalogs above.
export const ALLOWED_SRU_HOSTS = new Set([
  'swisscovery.ch',
  'swisscovery.slsp.ch',
  ...ALLOWED_SRU_PAGE_HOSTS
]);

// An SRU address — https, an SRU host, the SRU path.
export function isAllowedSruUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_SRU_HOSTS.has(u.hostname) && u.pathname.startsWith('/view/sru/');
  } catch (e) {
    return false;
  }
}

// The SRU addresses of one record, in the order to try: the network zone
// first, then — for an institution view — the institution zone, on the
// page's own catalogue when it is a known one. swisscovery.ch comes
// before swisscovery.slsp.ch, which is being retired.
const SRU_DOMAINS = ['swisscovery.ch', 'swisscovery.slsp.ch'];
const NETWORK_ZONE = '41SLSP_NETWORK';
export function marcSources(mmsId, instCode, pageHost) {
  // Security: mmsId must be digits only, instCode a plain code; both are
  // re-validated here so that no upstream refactor can break the invariant.
  if (!/^\d+$/.test(String(mmsId))) return [];
  if (instCode && !/^[\w-]{1,50}$/.test(String(instCode))) instCode = '';
  const query = '?version=1.2&operation=searchRetrieve&recordSchema=marcxml&query=alma.mms_id=' + mmsId;
  const out = SRU_DOMAINS.map(d => ({ url: 'https://' + d + '/view/sru/' + NETWORK_ZONE + query, source: 'SRU-NZ' }));
  if (instCode && instCode !== NETWORK_ZONE) {
    const hosts = [...(pageHost && ALLOWED_SRU_PAGE_HOSTS.has(String(pageHost)) ? [String(pageHost)] : []), ...SRU_DOMAINS];
    hosts.forEach(h => out.push({ url: 'https://' + h + '/view/sru/' + instCode + query, source: 'SRU-IZ' }));
  }
  return out;
}
