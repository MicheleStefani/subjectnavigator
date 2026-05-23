// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT v1.0.0
// Unified index v6: confidence grades, SBT local terms, {id,c} cluster format
// ═══════════════════════════════════════════
(function() {
'use strict';

// ═══════════════════════════════════════════
// CLUSTER ID HELPER — adapts v5 (string) and v6 ({id,c}) formats
// ═══════════════════════════════════════════
function clId(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;          // v5 format
  if (typeof val === 'object' && val.id) return val.id;  // v6 format {id, c}
  if (Array.isArray(val)) return val[0];            // legacy array
  return null;
}
function clConf(val) {
  if (!val || typeof val !== 'object') return 0;
  return val.c || 0;
}
function clGrade(cl) {
  return cl?._g || 4;
}


// ═══════════════════════════════════════════
// VOCABOLARI CLASSIFICAZIONE (CDU locale + CDD ridotta + Geo)
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════
const I18N = {
  it: { subjects:'Soggetti', navigate:'Naviga', people:'Responsabilità', classification:'Classificazione', classNoData:'Nessuna classe trovata.', classHierarchy:'Gerarchia', classNarrower:'Sottoclassi', classFilterLabel:'Includi nella ricerca:', classAggregatorNote:'⚠ Classe generica: la ricerca esatta potrebbe restituire pochi risultati. Usa la ricerca ampia.',classSearchExact:'Cerca documenti in questa classe', classShowRoot:'Classi principali', classAllClasses:'Tutte le classi', classSearchBroader:'Cerca questa classe e sottoclassi', search:'Cerca (soggetti)',
    searchBroad:'Cerca (ampia)', searchSuggested:'Ricerca suggerita',
    broader:'Broader (clicca per salire)', narrower:'Specifici (clicca per scendere)', related:'Correlati',
    selected:'Selezionato', loading:'Caricamento', reconciling:'Riconciliazione', fetchingMarc:'Recupero dati MARC\u2026',
    notFound:'Non trovato', fetchError:'Dati non disponibili (errore di rete)', noHierarchy:'Nessuna relazione gerarchica.', noSubjects:'Nessun soggetto trovato.',
    showAll:'Mostra tutti', explore:'\u25B8', andSearch:'Ricerca AND multilingue',
    selectTerms:'Seleziona termini per la ricerca combinata:', buildQuery:'Cerca (soggetti)', buildQueryBroad:'Cerca (ampia)',
    navHint:'Seleziona un termine per navigare:', author:'Autore', editor:'Curatore', contributor:'Contributore', kindPerson:'Persona', kindCorporate:'Ente', kindMeeting:'Congresso',
    widen:'Allarga', close:'Chiudi', badge:'soggetti',
    typeTopic:'tema', typePerson:'persona', typePeriod:'periodo', typePlace:'luogo', typeForm:'forma',
    suggestedHint:'Tutti i soggetti del record combinati in AND (indice soggetto):',
    modeSubject:'Soggetti', modeAny:'Tutti i campi', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Modalità di ricerca', classModeExact:'Solo questa classe', classModeExactHint:'cerca solo questo numero esatto', classModeBroader:'Questa classe e sottoclassi', classModeBroaderHint:'include tutti i numeri che iniziano con questo prefisso', classSearchPreview:'Anteprima ricerca', classSearchRun:'Cerca', classAuxOnlyWarn:'⚠ Ricerca ampia: risultati da molte classi diverse',
    classTreeExplore:'Esplora albero', classTreeCollapse:'Comprimi',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  de: { subjects:'Themen', navigate:'Navigation', people:'Urheberschaft', classification:'Klassifikation', classNoData:'Keine Klassen gefunden.', classHierarchy:'Hierarchie', classNarrower:'Unterklassen', classFilterLabel:'In der Suche einschließen:', classAggregatorNote:'⚠ Generische Klasse: Die genaue Suche liefert möglicherweise wenige Ergebnisse.',classSearchExact:'Dokumente dieser Klasse suchen', classShowRoot:'Hauptklassen', classAllClasses:'Alle Klassen', classSearchBroader:'Diese Klasse und Unterklassen suchen', search:'Suche (Schlagwort)',
    searchBroad:'Suche (breit)', searchSuggested:'Vorgeschlagene Suche',
    broader:'Broader (klicken zum Aufsteigen)', narrower:'Spezifisch (klicken zum Absteigen)', related:'Verwandt',
    selected:'Ausgewählt', loading:'Laden', reconciling:'Abgleich', fetchingMarc:'MARC-Daten werden abgerufen\u2026',
    notFound:'Nicht gefunden', fetchError:'Daten nicht verfügbar (Netzwerkfehler)', noHierarchy:'Keine hierarchischen Beziehungen.', noSubjects:'Keine Themen gefunden.',
    showAll:'Alle anzeigen', explore:'\u25B8', andSearch:'Mehrsprachige AND-Suche',
    selectTerms:'Begriffe für kombinierte Suche auswählen:', buildQuery:'Suche (Schlagwort)', buildQueryBroad:'Suche (breit)',
    navHint:'Begriff auswählen:', author:'Autor', editor:'Herausgeber', contributor:'Mitwirkend', kindPerson:'Person', kindCorporate:'Körperschaft', kindMeeting:'Kongress',
    widen:'Verbreitern', close:'Schliessen', badge:'Themen',
    typeTopic:'Thema', typePerson:'Person', typePeriod:'Zeitraum', typePlace:'Ort', typeForm:'Form',
    suggestedHint:'Alle Schlagwörter des Datensatzes als AND-Suche (Schlagwortindex):',
    modeSubject:'Schlagwort', modeAny:'Alle Felder', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Suchmodus', classModeExact:'Nur diese Klasse', classModeExactHint:'nur dieser exakten Nummer suchen', classModeBroader:'Diese Klasse und Unterklassen', classModeBroaderHint:'enthält alle Nummern, die mit diesem Präfix beginnen', classSearchPreview:'Suchvorschau', classSearchRun:'Suchen', classAuxOnlyWarn:'⚠ Breite Suche: Ergebnisse aus vielen Klassen',
    classTreeExplore:'Baum erkunden', classTreeCollapse:'Einklappen',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  fr: { subjects:'Sujets', navigate:'Naviguer', people:'Responsabilités', classification:'Classification', classNoData:'Aucune classe trouvée.', classHierarchy:'Hiérarchie', classNarrower:'Sous-classes', classFilterLabel:'Inclure dans la recherche:', classAggregatorNote:'⚠ Classe générique: la recherche exacte peut donner peu de résultats.',classSearchExact:'Chercher documents dans cette classe', classShowRoot:'Classes principales', classAllClasses:'Toutes les classes', classSearchBroader:'Chercher cette classe et sous-classes', search:'Chercher (sujets)',
    searchBroad:'Chercher (large)', searchSuggested:'Recherche suggérée',
    broader:'Broader (cliquer pour monter)', narrower:'Spécifiques (cliquer pour descendre)', related:'Associés',
    selected:'Sélectionné', loading:'Chargement', reconciling:'Réconciliation', fetchingMarc:'Récupération MARC\u2026',
    notFound:'Non trouvé', fetchError:'Données indisponibles (erreur réseau)', noHierarchy:'Aucune relation hiérarchique.', noSubjects:'Aucun sujet trouvé.',
    showAll:'Tout afficher', explore:'\u25B8', andSearch:'Recherche AND multilingue',
    selectTerms:'Sélectionner les termes pour la recherche combinée\u00a0:', buildQuery:'Chercher (sujets)', buildQueryBroad:'Chercher (large)',
    navHint:'Sélectionner un terme\u00a0:', author:'Auteur', editor:'Éditeur', contributor:'Contributeur', kindPerson:'Personne', kindCorporate:'Collectivité', kindMeeting:'Congrès',
    widen:'Élargir', close:'Fermer', badge:'sujets',
    typeTopic:'sujet', typePerson:'personne', typePeriod:'période', typePlace:'lieu', typeForm:'forme',
    suggestedHint:'Tous les sujets combinés en AND (index sujets)\u00a0:',
    modeSubject:'Sujets', modeAny:'Tous les champs', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Mode de recherche', classModeExact:'Uniquement cette classe', classModeExactHint:'cherche seulement ce num\u00e9ro exact', classModeBroader:'Cette classe et sous-classes', classModeBroaderHint:'inclut tous les num\u00e9ros commen\u00e7ant par ce pr\u00e9fixe', classSearchPreview:'Aper\u00e7u de la recherche', classSearchRun:'Chercher', classAuxOnlyWarn:'\u26a0 Recherche large : r\u00e9sultats de nombreuses classes diff\u00e9rentes',
    classTreeExplore:'Explorer l\'arbre', classTreeCollapse:'R\u00e9duire',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  en: { subjects:'Subjects', navigate:'Navigate', people:'Responsibilities', classification:'Classification', classNoData:'No classes found.', classHierarchy:'Hierarchy', classNarrower:'Narrower classes', classFilterLabel:'Include in search:', classAggregatorNote:'⚠ Generic class: exact search may return few results. Use broad search.',classSearchExact:'Search documents in this class', classShowRoot:'Main classes', classAllClasses:'All classes', classSearchBroader:'Search this class and subclasses', search:'Search (subject)',
    searchBroad:'Search (broad)', searchSuggested:'Suggested search',
    broader:'Broader (click to go up)', narrower:'Narrower (click to drill down)', related:'Related',
    selected:'Selected', loading:'Loading', reconciling:'Reconciling', fetchingMarc:'Fetching MARC data\u2026',
    notFound:'Not found', fetchError:'Data unavailable (network error)', noHierarchy:'No hierarchical relationships found.', noSubjects:'No subjects found.',
    showAll:'Show all', explore:'\u25B8', andSearch:'Multilingual AND search',
    selectTerms:'Select terms for combined search:', buildQuery:'Search (subject)', buildQueryBroad:'Search (broad)',
    navHint:'Select a term to navigate:', author:'Author', editor:'Editor', contributor:'Contributor', kindPerson:'Person', kindCorporate:'Corporate body', kindMeeting:'Conference',
    widen:'Widen', close:'Close', badge:'subjects',
    typeTopic:'topic', typePerson:'person', typePeriod:'period', typePlace:'place', typeForm:'form',
    suggestedHint:'All record subjects combined as AND (subject index):',
    modeSubject:'Subjects', modeAny:'All fields', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Search mode', classModeExact:'Only this class', classModeExactHint:'search only this exact number', classModeBroader:'This class and subclasses', classModeBroaderHint:'includes all numbers starting with this prefix', classSearchPreview:'Search preview', classSearchRun:'Search', classAuxOnlyWarn:'\u26a0 Broad search: results from many different classes',
    classTreeExplore:'Explore tree', classTreeCollapse:'Collapse',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' }
};
let L = I18N.it;
function setLang(code) { L = I18N[code] || I18N[code?.substring(0,2)] || I18N.it; }

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let currentDocId = null;
let sidebarState = 'none';
let searchCtx = { host:'swisscovery.ch', vid:'41SLSP_NETWORK:VU1_UNION', tab:'41SLSP_NETWORK', scope:'DN_and_CI' };
let themeMode = 'auto';

// ═══════════════════════════════════════════
// VOCABOLARI CLASSIFICAZIONE — caricati da file JSON separati
// ═══════════════════════════════════════════
let VOCAB_CDU = {}, VOCAB_CDD = {}, VOCAB_GEO = {};
let _vocabReady = false;
const _vocabCallbacks = [];

function onVocabReady(fn) {
  if (_vocabReady) fn();
  else _vocabCallbacks.push(fn);
}

(async function loadVocabs() {
  try {
    const [cdu, cdd, geo] = await Promise.all([
      fetch(chrome.runtime.getURL('vocab_cdu.json')).then(r => r.json()),
      fetch(chrome.runtime.getURL('vocab_cdd.json')).then(r => r.json()),
      fetch(chrome.runtime.getURL('vocab_geo.json')).then(r => r.json()),
    ]);
    VOCAB_CDU = cdu; VOCAB_CDD = cdd; VOCAB_GEO = geo;
    _vocabReady = true;
    _vocabCallbacks.forEach(fn => fn());
  } catch(e) { console.error('CDU/CDD: errore caricamento vocabolari', e); }
})();

 // 'auto' | 'light' | 'dark'

// ═══════════════════════════════════════════
// DOM HELPERS (security: no innerHTML)
// ═══════════════════════════════════════════
function el(tag, attrs, ...children) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k === 'textContent') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('data-') || k.startsWith('data_')) e.setAttribute(k.replace(/_/g, '-'), v);
      else if (k === 'title') e.title = v;
      else if (k === 'id') e.id = v;
      else if (k === 'href') e.href = v;
      else if (k === 'target') e.target = v;
      else e.setAttribute(k, v);
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') e.appendChild(document.createTextNode(child));
    else if (child instanceof Node) e.appendChild(child);
    else if (Array.isArray(child)) child.forEach(c => { if (c instanceof Node) e.appendChild(c); });
  }
  return e;
}

function txt(s) { return document.createTextNode(s || ''); }

function clearEl(e) { if (!e) return; while (e.firstChild) e.removeChild(e.firstChild); }

function setChildren(parent, ...children) {
  clearEl(parent);
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') parent.appendChild(document.createTextNode(child));
    else if (child instanceof Node) parent.appendChild(child);
    else if (Array.isArray(child)) child.forEach(c => { if (c instanceof Node) parent.appendChild(c); });
  }
}

// ═══════════════════════════════════════════
// DEBUG FLAG
// Enable with ?sn_debug=1 in URL or chrome.storage.local.set({snDebug: true})
// When off, caught errors are silent (production UX).
// When on, they are printed to console.debug with a [SN] prefix.
// ═══════════════════════════════════════════
let SN_DEBUG = false;
try {
  SN_DEBUG = new URLSearchParams(window.location.search).has('sn_debug');
} catch (e) { /* url not parseable, keep default */ }
try {
  chrome.storage.local.get('snDebug', r => { if (r && r.snDebug) SN_DEBUG = true; });
} catch (e) { /* storage unavailable, keep default */ }
function logDebug(...args) {
  if (SN_DEBUG) console.debug('[SN]', ...args);
}
// sink(context): returns a catch handler that is silent in production
// but logs the error (with a short context tag) when SN_DEBUG is on.
// Use wherever a promise failure is a legitimate fallback path (e.g. an
// optional authority-label enrichment that may 404 for unknown IDs).
function sink(context) {
  return (e) => { if (SN_DEBUG) console.debug('[SN]', context, e); };
}

// ═══════════════════════════════════════════
// URL VALIDATION (security)
// ═══════════════════════════════════════════
function isAllowedOpenUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

// ═══════════════════════════════════════════
// SPARQL SAFE LITERAL (security: prevent injection)
// ═══════════════════════════════════════════
function sparqlLiteral(s) {
  if (!s) return '""';
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

// ═══════════════════════════════════════════
// BnF JSON-LD LABEL FETCH (HTTP fallback)
// Consolidated helper — replaces three identical inline copies
// in reconcile(): NS-cluster path, GND→Lobid→BnF path, NS-reverse path.
// ═══════════════════════════════════════════
async function fetchBnfLabelRemote(bnfArk) {
  try {
    const bj = await bgFetchJSON('https://data.bnf.fr/fr/ark:/12148/' + bnfArk + '.rdfjsonld');
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

// ═══════════════════════════════════════════
// API BRIDGE
// ═══════════════════════════════════════════
function bgMsg(msg) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(msg, r => {
      if (chrome.runtime.lastError) return rej(new Error(chrome.runtime.lastError.message));
      if (r?.error && !r.fields) return rej(new Error(r.error));
      res(r?.data !== undefined ? r.data : r);
    });
  });
}
function bgSparql(ep, q) { return bgMsg({ type: 'sparql', endpoint: ep, query: q }); }
function bgFetchJSON(url) { return bgMsg({ type: 'fetchJSON', url }); }
function bgFetchMarc(o) { return bgMsg({ type: 'fetchMarc', ...o }); }
function bgLobid(gndId) { return bgMsg({ type: 'lobid', gndId }); }
function bgIdref(idrefId) { return bgMsg({ type: 'idref', idrefId }); }
function bgFetchBNE(bneId) { return bgMsg({ type: 'fetchBNE', bneId }); }
function bgFetchLCSH(lcshId) { return bgMsg({ type: 'fetchLCSH', lcshId }); }
function bgIdrefSolr(ppn) { return bgMsg({ type: 'idrefSolr', ppn }); }

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
const WD_API = 'https://www.wikidata.org/w/api.php';
const WD_SPARQL = 'https://query.wikidata.org/sparql';
const AAT_SPARQL = 'https://vocab.getty.edu/sparql';
const NS_SPARQL = 'https://digitale.bncf.firenze.sbn.it/openrdf-sesame/repositories/NS';
const LANGS = ['it', 'de', 'fr', 'en', 'es'];
const ID_PROPS = {
  P227: { l: 'GND', c: 'id-gnd', u: i => 'https://d-nb.info/gnd/' + i },
  P269: { l: 'IdRef', c: 'id-idr', u: i => 'https://www.idref.fr/' + i },
  P268: { l: 'BnF', c: 'id-bnf', u: i => 'https://catalogue.bnf.fr/ark:/12148/' + i },
  P1014: { l: 'AAT', c: 'id-aat', u: i => 'https://vocab.getty.edu/page/aat/' + i },
  P508: { l: 'NS', c: 'id-ns', u: i => 'https://thes.bncf.firenze.sbn.it/termine.php?id=' + i },
  P244: { l: 'LCSH', c: 'id-lcsh', u: i => 'https://id.loc.gov/authorities/' + i },
  P396: { l: 'SBN', c: 'id-sbn', u: i => 'https://opac.sbn.it/nome/' + encodeURIComponent(i)},
  P10397: { l: 'SBN-luogo', c: 'id-sbn-place', u: i => 'https://opac.sbn.it/luogo/' + encodeURIComponent(i)},
  P214: { l: 'VIAF', c: 'id-viaf', u: i => 'https://viaf.org/viaf/' + i },
  P213: { l: 'ISNI', c: 'id-isni', u: i => 'https://isni.org/isni/' + i.replace(/\s/g, '') },
  P245: { l: 'ULAN', c: 'id-ulan', u: i => 'https://vocab.getty.edu/page/ulan/' + i },
  P950: { l: 'BNE', c: 'id-bne', u: i => 'https://datos.bne.es/resource/' + i },
  P496: { l: 'ORCID', c: 'id-orcid', u: i => 'https://orcid.org/' + i }
};
const VOCAB_LANG = { sbt: 'it', ns: 'it', gnd: 'de', idref: 'fr' };

// IdRef recordtype_z mapping (confirmed 25.03.2026)
const IDREF_TYPES = {
  a: { desc: 'Persona', cat: 'name' },
  b: { desc: 'Ente', cat: 'name' },
  s: { desc: 'Congresso', cat: 'name' },
  c: { desc: 'Luogo', cat: 'place' },
  e: { desc: 'Famiglia', cat: 'name' },
  j: { desc: 'Soggetto RAMEAU', cat: 'subject' },
  u: { desc: 'Forma RAMEAU', cat: 'subject' },
  v: { desc: 'Genere RAMEAU', cat: 'subject' },
  h: { desc: 'Autore-titolo', cat: 'title' },
  f: { desc: 'Serie', cat: 'title' },
};

// ═══════════════════════════════════════════
// UNIFIED INDEX (IndexedDB cached)
// ═══════════════════════════════════════════
let nsIndex = null; // { concepts: {tid: {..., cl:{...}}}, labels: {label_lower: tid}, reverse: {gnd:{}, bnf:{}, lcsh:{}, wd:{}} }
let nsIndexStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let langLabels = {}; // { de: {gnd_id: label}, fr: {bnf_id: label}, en: {lcsh_id: label} }
let langLabelsStatus = {}; // { de: 'unloaded'|'loading'|'ready', ... }
let frLabelReverse = null; // { label_lower: bnf_id } — built from labels_fr.json for IdRef→RAMEAU matching

// Pre-built hierarchy indexes: {id: {bt: [...ids], nt: [...ids]}}
// Loaded lazily after NS index ready; replace most Lobid/IdRef API calls for navigation.
let gndHierarchy = null;
let bnfHierarchy = null;
let gndHierarchyStatus = 'unloaded'; // 'unloaded' | 'loading' | 'ready' | 'error'
let bnfHierarchyStatus = 'unloaded';

const INDEX_VERSION = 'v6'; // bump this when data files change

async function loadNSIndex() {
  if (nsIndexStatus === 'ready' || nsIndexStatus === 'loading') return;
  nsIndexStatus = 'loading';
  try {
    const cacheKey = 'unified_index_' + INDEX_VERSION;
    const cached = await idbGet(cacheKey);
    if (cached) {
      nsIndex = cached;
    } else {
      const url = chrome.runtime.getURL('unified_index_core.json');
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      nsIndex = await resp.json();
      await idbSet(cacheKey, nsIndex);
      // Clean up ALL old cache keys
      try {
        const db = await idbOpen();
        const tx = db.transaction('cache', 'readwrite');
        const st = tx.objectStore('cache');
        const allKeys = await new Promise((res) => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
        for (const k of allKeys) {
          if (k !== cacheKey && (k.startsWith('unified_index_') || k.startsWith('ns_index_'))) st.delete(k);
        }
      } catch (e) { logDebug('cache cleanup (unified)', e); }
    }
    nsIndexStatus = 'ready';
    // Start lazy loading label files and hierarchy indexes in background
    loadLangLabels('de');
    loadLangLabels('fr');
    loadLangLabels('en');
    loadLangLabels('es');
    loadGndHierarchy();
    loadBnfHierarchy();
  } catch (e) {
    logDebug('loadNSIndex', e);
    nsIndexStatus = 'error';
  }
}

async function loadLangLabels(lang) {
  if (langLabelsStatus[lang] === 'ready' || langLabelsStatus[lang] === 'loading') return;
  langLabelsStatus[lang] = 'loading';
  try {
    // EN and ES use slim files (only IDs present in NS clusters, ~17k vs ~270k for LCSH).
    // DE and FR use full files: all GND/BnF IDs may appear in catalog MARC records.
    const isSlim = lang === 'en' || lang === 'es';
    const fileName = 'labels_' + lang + (isSlim ? '_slim' : '') + '.json';
    const cacheKey = 'labels_' + lang + (isSlim ? '_slim' : '') + '_' + INDEX_VERSION;
    const cached = await idbGet(cacheKey);
    if (cached) {
      langLabels[lang] = cached;
    } else {
      const url = chrome.runtime.getURL(fileName);
      const resp = await fetch(url);
      if (resp.ok) {
        langLabels[lang] = await resp.json();
        await idbSet(cacheKey, langLabels[lang]);
        // Clean old label cache keys (both slim and full variants)
        try {
          const db = await idbOpen();
          const tx = db.transaction('cache', 'readwrite');
          const st = tx.objectStore('cache');
          const allKeys = await new Promise((res) => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
          for (const k of allKeys) {
            if (k.startsWith('labels_' + lang + '_') && k !== cacheKey) st.delete(k);
          }
        } catch (e) { logDebug('cache cleanup (labels)', lang, e); }
      }
    }
    langLabelsStatus[lang] = 'ready';
    // Build French reverse label index (for IdRef→RAMEAU text matching)
    if (lang === 'fr' && langLabels.fr && !frLabelReverse) {
      frLabelReverse = {};
      for (const [bnfId, label] of Object.entries(langLabels.fr)) {
        frLabelReverse[label.toLowerCase()] = bnfId;
      }
    }
  } catch (e) {
    logDebug('loadLangLabels', lang, e);
    langLabelsStatus[lang] = 'error';
  }
}

async function loadGndHierarchy() {
  if (gndHierarchyStatus === 'ready' || gndHierarchyStatus === 'loading') return;
  gndHierarchyStatus = 'loading';
  try {
    const cacheKey = 'hierarchy_gnd_' + INDEX_VERSION;
    const cached = await idbGet(cacheKey);
    if (cached) {
      gndHierarchy = cached;
    } else {
      const resp = await fetch(chrome.runtime.getURL('hierarchy_gnd.json'));
      if (resp.ok) {
        gndHierarchy = await resp.json();
        await idbSet(cacheKey, gndHierarchy);
        try {
          const db = await idbOpen();
          const tx = db.transaction('cache', 'readwrite');
          const st = tx.objectStore('cache');
          const allKeys = await new Promise(res => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
          for (const k of allKeys) {
            if (k.startsWith('hierarchy_gnd_') && k !== cacheKey) st.delete(k);
          }
        } catch (e) { logDebug('cache cleanup (gnd hierarchy)', e); }
      }
    }
    gndHierarchyStatus = 'ready';
  } catch (e) {
    logDebug('loadGndHierarchy', e);
    gndHierarchyStatus = 'error';
  }
}

async function loadBnfHierarchy() {
  if (bnfHierarchyStatus === 'ready' || bnfHierarchyStatus === 'loading') return;
  bnfHierarchyStatus = 'loading';
  try {
    const cacheKey = 'hierarchy_bnf_' + INDEX_VERSION;
    const cached = await idbGet(cacheKey);
    if (cached) {
      bnfHierarchy = cached;
    } else {
      const resp = await fetch(chrome.runtime.getURL('hierarchy_bnf.json'));
      if (resp.ok) {
        bnfHierarchy = await resp.json();
        await idbSet(cacheKey, bnfHierarchy);
        try {
          const db = await idbOpen();
          const tx = db.transaction('cache', 'readwrite');
          const st = tx.objectStore('cache');
          const allKeys = await new Promise(res => { const r = st.getAllKeys(); r.onsuccess = () => res(r.result || []); r.onerror = () => res([]); });
          for (const k of allKeys) {
            if (k.startsWith('hierarchy_bnf_') && k !== cacheKey) st.delete(k);
          }
        } catch (e) { logDebug('cache cleanup (bnf hierarchy)', e); }
      }
    }
    bnfHierarchyStatus = 'ready';
  } catch (e) {
    logDebug('loadBnfHierarchy', e);
    bnfHierarchyStatus = 'error';
  }
}

// Hierarchy lookups — return {bt: [...ids], nt: [...ids]} or null
function getGndBroaderNarrower(gndId) { return gndHierarchy?.[gndId] || null; }
function getBnfBroaderNarrower(bnfId) { return bnfHierarchy?.[bnfId] || null; }

// Local label lookups from pre-loaded lang files
function getAuthLabel(vocab, id) {
  if (vocab === 'gnd') return langLabels.de?.[id] || null;
  if (vocab === 'bnf') return langLabels.fr?.[id] || null;
  if (vocab === 'lcsh') return langLabels.en?.[id] || null;
  if (vocab === 'bne') return langLabels.es?.[id] || null;
  return null;
}

// Reverse lookup: find NS concept from a French label (IdRef→RAMEAU bridge)
function nsLookupByFrLabel(frLabel) {
  if (!frLabelReverse || !nsIndex?.reverse?.bnf) return null;
  const bnfId = frLabelReverse[frLabel.toLowerCase()];
  if (!bnfId) return null;
  return nsLookupByBnf(bnfId);
}

// Simple IndexedDB wrapper
function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('SubjectNavigator', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('cache'); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('cache', 'readonly');
    const req = tx.objectStore('cache').get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => res(null);
  });
}
async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('cache', 'readwrite');
    tx.objectStore('cache').put(val, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// NS index lookups
function nsLookup(label) {
  if (!nsIndex) return null;
  const tid = nsIndex.labels[label.toLowerCase().trim()];
  if (!tid) return null;
  const c = nsIndex.concepts[tid];
  if (!c) return null;
  return { tid, ...c };
}

function nsGetConcept(tid) {
  if (!nsIndex || !nsIndex.concepts[tid]) return null;
  return { tid, ...nsIndex.concepts[tid] };
}

function nsGetLabel(tid) {
  const c = nsIndex?.concepts?.[tid];
  return c?.l || null;
}

// Build a normalised nsData object from any NS-or-SBT concept returned by nsLookup/nsGetConcept.
// SBT concepts (tid starts with 'SBT_') get a different source URL and a 'sbt' src marker.
function makeNsData(ns) {
  if (!ns) return null;
  const isSBT = ns.tid.startsWith('SBT_');
  if (isSBT) {
    const numId = ns.tid.slice(4); // 'SBT_4405' → '4405'
    return { id: ns.tid, label: ns.l, uri: 'https://www2.sbt.ti.ch/soggettario/index.jsp?termine=' + numId, src: 'sbt', scopeNote: null, ddc: null, definition: null };
  }
  return { id: ns.tid, label: ns.l, uri: 'http://purl.org/bncf/tid/' + ns.tid, src: null, scopeNote: ns.sn || null, ddc: ns.d || null, definition: ns.df || null };
}

// Reverse lookups: find NS concept by external ID (using unified reverse index)
function nsLookupByQid(qid) {
  if (!nsIndex?.reverse?.wd) return null;
  const tid = nsIndex.reverse.wd[qid];
  return tid ? nsGetConcept(tid) : null;
}

function nsLookupByGnd(gndId) {
  if (!nsIndex?.reverse?.gnd) return null;
  const tid = nsIndex.reverse.gnd[gndId];
  return tid ? nsGetConcept(tid) : null;
}

function nsLookupByBnf(bnfId) {
  if (!nsIndex?.reverse?.bnf) return null;
  const tid = nsIndex.reverse.bnf[bnfId];
  return tid ? nsGetConcept(tid) : null;
}

function nsLookupByLcsh(lcshId) {
  if (!nsIndex?.reverse?.lcsh) return null;
  const tid = nsIndex.reverse.lcsh[lcshId];
  return tid ? nsGetConcept(tid) : null;
}

function nsLookupByIdref(idrefId) {
  if (!nsIndex?.reverse?.idref) return null;
  const tid = nsIndex.reverse.idref[idrefId];
  return tid ? nsGetConcept(tid) : null;
}

// Get cluster data for a concept (pre-computed equivalences)
function nsGetCluster(tid) {
  const c = nsIndex?.concepts?.[tid];
  return c?.cl || null;
}

// Resolve all labels for a cluster from pre-loaded lang files
function resolveClusterLabels(cl) {
  const labels = {};
  if (!cl) return labels;
  const gndId = clId(cl.gnd);
  if (gndId) { const lbl = getAuthLabel('gnd', gndId); if (lbl) labels.de = lbl; }
  const bnfId = clId(cl.bnf);
  if (bnfId) { const lbl = getAuthLabel('bnf', bnfId); if (lbl) labels.fr = lbl; }
  const lcshId = clId(cl.lcsh);
  if (lcshId) { const lbl = getAuthLabel('lcsh', lcshId); if (lbl) labels.en = lbl; }
  const bneId = clId(cl.bne);
  if (bneId) { const lbl = getAuthLabel('bne', bneId); if (lbl) labels.es = lbl; }
  return labels;
}

// Get the current interface language code (2-letter)
function getInterfaceLang() {
  const pp = new URLSearchParams(window.location.search);
  return pp.get('lang')?.substring(0, 2) || 'it';
}

// ═══════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════
const RC = new Map(), HC = new Map(), EC = new Map();
function rck(t, g, i) { return (t || '').toLowerCase().trim() + '|' + (g || '') + '|' + (i || ''); }

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
function cleanName(n) { return n.replace(/\s*\(.*?\)/g, '').replace(/,\s*$/, '').replace(/\s*:\s*/g, ' ').replace(/\s*;\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function invertName(n) { const c = cleanName(n); const p = c.split(/\s*,\s*/); return p.length >= 2 ? p.slice(1).join(' ') + ' ' + p[0] : c; }
function initials(n) { const c = cleanName(n).replace(/,/g, ''); const w = c.split(/\s+/).filter(x => x.length > 1); return w.length >= 2 ? (w[0][0] + w[w.length - 1][0]).toUpperCase() : c.substring(0, 2).toUpperCase(); }
function getClaim(e, p) { const c = e?.claims?.[p]; return c?.length ? c[0].mainsnak?.datavalue?.value : null; }
function getLabel(e, l) { return e?.labels?.[l]?.value || null; }
function getDesc(e, l) { return e?.descriptions?.[l]?.value || null; }
function getPrefLabel(cl, e, l) { if (cl && cl[l]) return cl[l]; return e ? getLabel(e, l) : null; }
function parsePageUrl(url) {
  const u = new URL(url || window.location.href);
  const p = u.searchParams;
  const docId = p.get('docid') || p.get('docId') || '';
  const vid = p.get('vid') || '';
  // Security: whitelist language against the set we actually support,
  // so that a malformed ?lang=… query string cannot leak into DOM attributes
  // or into data-* keys downstream. Falls back to Italian (primary audience).
  const rawLang = (p.get('lang') || 'it').substring(0, 5).toLowerCase();
  const lang = ['it', 'de', 'fr', 'en', 'es'].includes(rawLang.substring(0, 2))
    ? rawLang.substring(0, 2) : 'it';
  const m = docId.match(/alma(\d+)/);
  const rawInstCode = vid.split(':')[0] || '';
  const instCode = /^[\w-]{1,50}$/.test(rawInstCode) ? rawInstCode : '';
  return { docId, vid, instCode, mmsId: m ? m[1] : '', isFullDisplay: u.pathname.includes('/fulldisplay'), lang };
}

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
  // Prova prima la chiave combinata base:rel (es. "711:504")
  if (rel) {
    const combined = base + ':' + rel;
    if (vocab[combined]) return { key: combined, entry: vocab[combined] };
  }
  // Poi la base da sola
  if (vocab[base]) return { key: base, entry: vocab[base] };
  // Poi prefisso più lungo
  const candidates = Object.keys(vocab).filter(k => k.startsWith(base + ':') || k.startsWith(base));
  if (candidates.length) {
    const best = candidates.sort((a,b) => b.length - a.length)[0];
    return { key: best, entry: vocab[best] };
  }
  // Risali al parent
  let cur = base;
  while (cur.length > 2) {
    cur = cur.includes('.') ? cur.replace(/\.[^.]*$/, '') : cur.slice(0, -1);
    if (vocab[cur]) return { key: cur, entry: vocab[cur] };
  }
  return null;
}

function classChain(num, vocab, geo) {
  // Costruisce catena gerarchica risalendo i parent
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
  // Divide un numero CDU composito in tutte le sue parti:
  // "720.011(494.51)(091)"       -> base:"720.011", aux:["(494.51)","(091)"], rel:null, slash:null
  // "720.017(450.52/494.4)"      -> base:"720.017", aux:["(450.52)","(494.4)"], rel:null, slash:null
  //                                 (compound geo split + rawAux:["(450.52/494.4)"] preserved)
  // "016:700"                    -> base:"016",     aux:[],   rel:"700",      slash:null
  // "338.450:574"                -> base:"338.450", aux:[],   rel:"574",      slash:null
  // "400/500"                    -> base:"400",     aux:[],   rel:null,       slash:["400","500"]
  // "410.1/430"                  -> base:"410.1",   aux:[],   rel:null,       slash:["410.1","430"]
  const raw2 = raw.trim();
  // Estrai tutte le parentesi tonde (raw, prima della scomposizione)
  const rawAux = (raw2.match(/\([^)]+\)/g) || []);
  // Espandi parentesi composte con slash: (450.52/494.4) → (450.52) + (494.4)
  const aux = [];
  for (const a of rawAux) {
    const inner = a.slice(1, -1); // rimuovi ( e )
    if (inner.includes('/')) {
      // Split su slash: ogni parte diventa un aux separato
      const parts = inner.split('/').map(s => s.trim()).filter(Boolean);
      parts.forEach(p => aux.push('(' + p + ')'));
    } else {
      aux.push(a);
    }
  }
  let noAux = raw2.replace(/\([^)]*\)/g, '').trim();
  // Gestisci range slash: "A/B" -> due aree geografiche separate
  let slash = null;
  if (noAux.includes('/')) {
    slash = noAux.split('/').map(s => s.trim()).filter(Boolean);
    // base è la prima parte
    return { base: slash[0], aux, rawAux, rel: null, slash };
  }
  // Gestisci i due punti
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
    + '&tab=' + ctx.tab + '&search_scope=' + ctx.scope + '&vid=' + ctx.vid + '&mode=advanced';

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
    + '&tab=' + ctx.tab + '&search_scope=' + ctx.scope + '&vid=' + ctx.vid + '&mode=advanced';

  const pattern = patternParts.join(' + ');
  const onlyAux = auxList.length > 0 && !baseOnly;

  return { url, pattern, onlyAux };
}

function showClassRoot(oldCard, vocab, geo, ctx, classType, lang) {
  // CDU: mostra i macro-livelli (000-999) come gruppi virtuali cliccabili
  // CDD: mostra le 10 classi principali direttamente
  const cduMacro = [
    { key:'0xx', label:'000 – Generalità, informatica, documentazione' },
    { key:'1xx', label:'100 – Filosofia, Psicologia' },
    { key:'2xx', label:'200 – Religione, Teologia' },
    { key:'3xx', label:'300 – Scienze sociali' },
    { key:'4xx', label:'400 – (non usato)' },
    { key:'5xx', label:'500 – Scienze pure, Matematica' },
    { key:'6xx', label:'600 – Scienze applicate, Tecnologia' },
    { key:'7xx', label:'700 – Arte, Architettura' },
    { key:'8xx', label:'800 – Linguistica, Letteratura' },
    { key:'9xx', label:'900 – Geografia, Storia' },
  ];
  // Sottoclassi CDU per ogni macro
  const cduByMacro = {
    '0xx': ['001','002','003','004','007','008','010','011','012','016','020','030','061','069','070','090'],
    '1xx': ['100','111','113','115','125','128','130','133','140','141','159.900','160','165','167','170','172','177.700'],
    '2xx': ['200','215','235','245','248','264','266','270','271','272','274','276','290','292','293','294','296','297','298','299'],
    '3xx': ['300','303','304','305','310','312','314','316','320','323','325','327','329','330','331','332','336','338','339','340','341','342','343','346','347','349','350','351','352','354','355','364','365','366','368','370','371','374','378','379.800','390','391','392','394','396','397','398'],
    '4xx': [],
    '5xx': ['500','501','502','504','510','511','512','514','515.100','517','519','520','523','524','528','529','530','531','532','533','534','535','536','537','540','546','547','549','550','551','560','570','572','573','574','575','576','577','580','581','590','591','595.782','598.200'],
    '6xx': ['600','610','611','612','613','614','615','617','620','621','622','623','624','625','626','627','628','629','630','631','634','635','636','637','639','640','641','642','644','650','651.500','654','655','656','658','659','660','661','662','663','664','665','666','667','669','670','671','673','674','676','677','678','681','682','683','685','686','687','688','689','690','691','692','693','694','695','696','697','698','699.800'],
    '7xx': ['700','711','712','719','720','725/728','726','727','728','730','736','737','738','739','740','741','742','743','744','745','747','748','749','760','766','770','771','780','790','791','792','793.300','794.100','794.900','796','797.140','798','799'],
    '8xx': ['800','801','807.500','808','811.131.1','820.090','821.111','821.112.2','821.131.1','821.133.1','821.134.2','821.134.3','821.160','821.161.1','821.411.21','821.511.14','821.512.1','821.521','871','875'],
    '9xx': ['900','902','903','910','911','912','913','914','915','916','917.283','917.293','917.300','929ABCD','929.600','930','931','932','933','935','936','937','938','939.450','939.970','940','941/949','941','942','943','944','945','946','947','948','949.200','949.400','949.45','950','951','952','953','956','957','960','962','971','972','973','980','981','985','998'],
  };
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
    cduMacro.forEach(m => {
      if (m.key === '4xx') return;
      const li = el('li', { style: { cursor: 'pointer' } });
      li.appendChild(el('span', { className: 'cls-tree-key', textContent: m.key.replace('xx','00') }));
      li.appendChild(el('span', { className: 'cls-tree-lbl', textContent: m.label.split(' – ')[1] || m.label }));
      li.addEventListener('click', () => {
        showCduGroup(card, m.key, cduByMacro[m.key], vocab, geo, ctx, lang);
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
  const macroLabels = { '0xx':'Generalità, informatica, documentazione',
    '1xx':'Filosofia, Psicologia', '2xx':'Religione, Teologia',
    '3xx':'Scienze sociali', '5xx':'Scienze pure, Matematica',
    '6xx':'Scienze applicate, Tecnologia', '7xx':'Arte, Architettura',
    '8xx':'Linguistica, Letteratura', '9xx':'Geografia, Storia' };
  head.appendChild(el('span', { className: 'cls-num', textContent: macroNum }));
  head.appendChild(el('span', { className: 'cls-lbl', textContent: macroLabels[macroKey] || macroNum }));
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

  // Lookup: prova base:rel combinata, poi base, poi prefisso, poi parent
  const lookupResult = classLookupFull(base, rel, vocab);
  let entry = lookupResult ? lookupResult.entry : null;
  let resolvedBase = lookupResult ? lookupResult.key : base;

  const card = el('div', { className: 'cls-card' });

  // Numero da mostrare e da usare nella ricerca: preferisce resolvedBase se contiene ':'
  const searchBase = (resolvedBase && resolvedBase !== base) ? resolvedBase : base;

  // Header: numero + label + chip
  const head = el('div', { className: 'cls-head' });
  head.appendChild(el('span', { className: 'cls-num', textContent: searchBase }));
  if (entry) {
    head.appendChild(el('span', { className: 'cls-lbl', textContent: classLabel(entry, lang) }));
  } else {
    head.appendChild(el('span', { className: 'cls-lbl cls-lbl-unknown', textContent: base }));
  }
  head.appendChild(el('span', { className: 'cls-chip cls-chip-' + classType,
    textContent: classType === 'cdu' ? 'CDU' : 'CDD' }));
  // Pulsante radice (↑↑) se non siamo già a livello radice
  const rootKeys = classType === 'cdu'
    ? ['001','002','003','004','007','008','010','011','012','016','020','030','061','069','070','090','100','200','300','400','500','600','700','800','900']
    : ['000','100','200','300','400','500','600','700','800','900'];
  // Pulsante ⌂ sempre visibile
  const rootBtn = el('button', { className: 'cls-root-btn', title: L.classShowRoot || 'Classi principali',
    textContent: '⌂' });
  rootBtn.addEventListener('click', () => {
    showClassRoot(card, vocab, geo, ctx, classType, lang);
  });
  head.appendChild(rootBtn);
  card.appendChild(head);

  // Range slash: mostra tutte le parti come tag separati
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

  // Suddivisioni geografiche / ausiliarie
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

  // Relazione (:) — mostra solo se la chiave combinata NON è già nel vocabolario
  // (se c'è, la label è già nella card; se non c'è, mostriamo la relazione esplicitamente)
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

  // Gerarchia — albero indentato con "Tutte le classi" come radice cliccabile
  if (entry) {
    const chain = classChain(resolvedBase, vocab, geo);
    if (chain.length >= 1) {
      const hier = el('div', { className: 'cls-hier' });
      hier.appendChild(el('div', { className: 'cls-section-title', textContent: L.classHierarchy }));
      const tree = el('div', { className: 'cls-tree-v2' });

      // Radice: "Tutte le classi" — sempre cliccabile
      const rootItem = el('div', { className: 'cls-tree-node cls-tree-nav', style: { paddingLeft: '0px', cursor: 'pointer' } });
      rootItem.appendChild(el('span', { className: 'cls-tree-key', textContent: '⌂' }));
      rootItem.appendChild(el('span', { className: 'cls-tree-lbl', textContent: L.classAllClasses || 'Tutte le classi' }));
      rootItem.addEventListener('click', () => showClassRoot(card, vocab, geo, ctx, classType, lang));
      tree.appendChild(rootItem);

      chain.forEach((node, i) => {
        const isCur = i === chain.length - 1;
        const indent = (i + 1) * 16; // Indentazione progressiva
        const nodeEl = el('div', {
          className: 'cls-tree-node' + (isCur ? ' cls-tree-cur' : ' cls-tree-nav'),
          style: { paddingLeft: indent + 'px' },
          title: isCur ? '' : classLabel(node.entry, lang)
        });
        // Connettore visivo
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

    // Sottoclassi — tutte, senza limite
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
    if (res && res.url && isAllowedOpenUrl(res.url)) window.open(res.url, '_blank');
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

// ═══════════════════════════════════════════
// RECONCILIATION (with NS local index + authoritative labels)
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// RESOLVE NAMES/PLACES/ENTITIES via live API (v3.2)
// For MARC 600/610/651/700/710 with $0 identifiers
// ═══════════════════════════════════════════

async function resolveViaLobid(gndId) {
  try {
    const ld = await bgLobid(gndId);
    if (!ld?.preferredName) return null;
    const types = (ld.type || []).filter(t => t !== 'AuthorityResource');
    let cat = 'other';
    if (types.some(t => t.includes('Person'))) cat = 'name';
    else if (types.some(t => t.includes('PlaceOrGeographic'))) cat = 'place';
    else if (types.some(t => t.includes('CorporateBody'))) cat = 'name';
    else if (types.some(t => t.includes('SubjectHeading'))) cat = 'subject';
    else if (types.some(t => t.includes('Family'))) cat = 'name';
    else if (types.some(t => t.includes('Work'))) cat = 'title';
    // Extract useful IDs from sameAs
    let wikidataId = null, viafId = null, bnfArk = null, locId = null;
    for (const sa of (ld.sameAs || [])) {
      const id = (sa && sa.id) ? sa.id : (typeof sa === 'string' ? sa : '');
      if (id.includes('wikidata.org/entity/')) wikidataId = id.split('/').pop();
      else if (id.includes('viaf.org/viaf/')) viafId = (id.match(/viaf\/(\d+)/) || [])[1] || null;
      else if (id.includes('catalogue.bnf.fr/ark:') || id.includes('data.bnf.fr/ark:')) {
        bnfArk = (id.match(/ark:\/12148\/(cb\w+)/) || [])[1] || null;
      }
      else if (id.includes('id.loc.gov/')) locId = (id.match(/agents\/(\w+)/) || [])[1] || null;
    }
    return { label: ld.preferredName, variants: ld.variantName || [], types, category: cat,
      wikidataId, viafId, bnfArk, locId, lobidData: ld };
  } catch (e) { return null; }
}

async function resolveViaIdRefSolr(ppn) {
  try {
    const doc = await bgIdrefSolr(ppn);
    if (!doc?.affcourt_z) return null;
    const rtype = doc.recordtype_z || '';
    const typeInfo = IDREF_TYPES[rtype] || { desc: 'Altro', cat: 'other' };
    return { label: doc.affcourt_z, variants: doc.affcourt_r || [], type: rtype,
      typeDesc: typeInfo.desc, category: typeInfo.cat,
      isSubject: typeInfo.cat === 'subject' };
  } catch (e) { return null; }
}

// Cross-reference enrichment: given partial IDs, fill in via WD hub
async function enrichViaWdHub(qid, existingIds) {
  if (!qid) return {};
  const extra = {};
  try {
    let entity = EC.get(qid);
    if (!entity) {
      const d = await bgFetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims&format=json&origin=*');
      if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
    }
    if (!entity) return extra;
    extra.entity = entity;
    // Discover missing IDs
    const idMap = { P227: 'gndId', P269: 'idrefPpn', P268: 'bnfArk', P244: 'lcshId',
      P950: 'bneId', P1014: 'aatId', P214: 'viafId', P213: 'isni', P245: 'ulanId' };
    for (const [prop, key] of Object.entries(idMap)) {
      if (!existingIds[key]) {
        const val = getClaim(entity, prop);
        if (val) extra[key] = val;
      }
    }
  } catch (e) { logDebug('net fallback', e); }
  return extra;
}

async function reconcile(term, gndId, idrefId, vocabSource, termType) {
  const k = rck(term, gndId, idrefId);
  if (RC.has(k)) {
    const cached = RC.get(k);
    // If termType was not set before but is now provided, update it
    if (termType && !cached.termType) cached.termType = termType;
    return cached;
  }
  let qid = null, entity = null, route = [], nsData = null, dewey = null;
  let nsClusterGrade = null; // 1-4 grade from pre-computed cluster, null if no NS anchor found
  const cl = {};
  const homeLang = VOCAB_LANG[vocabSource] || null;
  if (homeLang) cl[homeLang] = term;
  let lobidData = null, idrefData = null;

  // ── NS local index lookup (always try, regardless of vocabSource) ──
  {
    const ns = nsLookup(term);
    if (ns) {
      nsData = makeNsData(ns);
      cl.it = ns.l;
      route.push('NS-local');

      // Use pre-computed cluster (replaces old mx-based approach)
      const cluster = ns.cl || {};
      nsClusterGrade = clGrade(cluster); // capture cluster confidence grade

      // GND from cluster
      if (cluster.gnd && !gndId) { gndId = clId(cluster.gnd); route.push('NS→GND'); }

      // QID from cluster
      if (cluster.wd) { qid = clId(cluster.wd); route.push('NS→WD'); }

      // Resolve authoritative labels: local lang files first, HTTP fallback
      const labelPromises = [];

      // DE: from pre-loaded labels_de.json (full), fallback to Lobid
      if (cluster.gnd || gndId) {
        const gi = (cluster.gnd ? (clId(cluster.gnd)) : gndId);
        const localDE = getAuthLabel('gnd', gi);
        if (localDE) {
          cl.de = localDE;
        } else {
          labelPromises.push(
            bgLobid(gi).then(ld => {
              if (ld?.preferredName) { lobidData = ld; cl.de = ld.preferredName; }
            }).catch(() => {})
          );
        }
      }

      // FR: from pre-loaded labels_fr.json (full), fallback to BnF API
      if (cluster.bnf && !cl.fr) {
        const bi = clId(cluster.bnf);
        const localFR = getAuthLabel('bnf', bi);
        if (localFR) {
          cl.fr = localFR;
        } else {
          labelPromises.push(fetchBnfLabelRemote(bi).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; }));
        }
      }

      // EN: from pre-loaded labels_en_slim.json, fallback to LoC API
      if (cluster.lcsh) {
        const li = clId(cluster.lcsh);
        const localEN = getAuthLabel('lcsh', li);
        if (localEN) {
          cl.en = localEN;
        } else {
          labelPromises.push(
            bgFetchLCSH(li).then(heading => { if (heading) cl.en = heading; }).catch(() => {})
          );
        }
      }

      // ES: from pre-loaded labels_es_slim.json, fallback to BNE API
      if (cluster.bne) {
        const bi = clId(cluster.bne);
        const localES = getAuthLabel('bne', bi);
        if (localES) {
          cl.es = localES;
        } else {
          labelPromises.push(
            bgFetchBNE(bi).then(label => { if (label) cl.es = label; }).catch(() => {})
          );
        }
      }

      if (labelPromises.length) await Promise.all(labelPromises);

      // If no QID yet but we have GND, try WD via P227
      if (!qid && gndId) {
        try {
          const r = await bgSparql(WD_SPARQL, 'SELECT ?i WHERE{?i wdt:P227 ' + sparqlLiteral(gndId) + '}LIMIT 1');
          if (r?.results?.bindings?.length) { qid = r.results.bindings[0].i.value.split('/').pop(); route.push('GND→WD'); }
        } catch (e) { logDebug('net fallback', e); }
      }

      // Use WD as hub to discover missing IDs for authoritative labels
      if (qid && (!cl.de || !cl.fr || !cl.en || !cl.es)) {
        // Load entity to discover IDs
        if (!entity) {
          try {
            const d = await bgFetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims&format=json&origin=*');
            if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
          } catch (e) { logDebug('net fallback', e); }
        }
        if (entity) {
          const hubPromises = [];
          // Discover GND via P227 if missing
          if (!cl.de) {
            const gi = getClaim(entity, 'P227');
            if (gi) hubPromises.push(bgLobid(gi).then(ld => { if (ld?.preferredName) { lobidData = ld; cl.de = ld.preferredName; } }).catch(() => {}));
          }
          // Discover LCSH via P244 if missing
          if (!cl.en) {
            const li = getClaim(entity, 'P244');
            if (li) hubPromises.push(bgFetchLCSH(li).then(h => { if (h) cl.en = h; }).catch(() => {}));
          }
          // Discover BNE via P950 if missing
          if (!cl.es) {
            const bi = getClaim(entity, 'P950');
            if (bi) hubPromises.push(bgFetchBNE(bi).then(lb => { if (lb) cl.es = lb; }).catch(() => {}));
          }
          await Promise.all(hubPromises);
        }
      }
    }
  }

  // ── GND path (non-SBT terms): try reverse index first, then WD ──
  if (!nsData && gndId) {
    // Try direct reverse lookup by GND ID (instant, no API call)
    const nsFromGnd = nsLookupByGnd(gndId);
    if (nsFromGnd) {
      nsData = makeNsData(nsFromGnd);
      cl.it = nsFromGnd.l;
      route.push('GND→NS-reverse');
      // Resolve cluster labels
      const cluster = nsFromGnd.cl || {};
      nsClusterGrade = clGrade(cluster);
      if (cluster.wd) { qid = clId(cluster.wd); route.push('cl→WD'); }
      const clLabels = resolveClusterLabels(cluster);
      if (clLabels.de) cl.de = clLabels.de;
      if (clLabels.fr) cl.fr = clLabels.fr;
      if (clLabels.en) cl.en = clLabels.en;
      if (clLabels.es) cl.es = clLabels.es;
    }
    if (!qid) {
      try {
        const r = await bgSparql(WD_SPARQL, 'SELECT ?i WHERE{?i wdt:P227 ' + sparqlLiteral(gndId) + '}LIMIT 1');
        if (r?.results?.bindings?.length) { qid = r.results.bindings[0].i.value.split('/').pop(); route.push('GND→WD'); }
      } catch (e) { logDebug('net fallback', e); }
    }
    if (!qid || !cl.de) {
      // Use enhanced Lobid resolution (extracts sameAs with WD, VIAF, BnF)
      const lobidRes = await resolveViaLobid(gndId);
      if (lobidRes) {
        lobidData = lobidRes.lobidData;
        if (!cl.de) cl.de = lobidRes.label;
        route.push('Lobid:' + gndId);
        // Use Lobid sameAs to discover QID and BnF
        if (!qid && lobidRes.wikidataId) { qid = lobidRes.wikidataId; route.push('Lobid→WD'); }
        // If Lobid has BnF ARK, try to get French label via consolidated helper
        if (!cl.fr && lobidRes.bnfArk) {
          const lbl = await fetchBnfLabelRemote(lobidRes.bnfArk);
          if (lbl) { cl.fr = lbl; route.push('Lobid→BnF'); }
        }
        // Fallback: WD via VIAF if still no QID
        if (!qid && lobidRes.viafId) {
          try {
            const wr = await bgSparql(WD_SPARQL, 'SELECT ?i WHERE{?i wdt:P214 ' + sparqlLiteral(lobidRes.viafId) + '}LIMIT 1');
            if (wr?.results?.bindings?.length) { qid = wr.results.bindings[0].i.value.split('/').pop(); route.push('VIAF\u2192WD'); }
          } catch (e) { logDebug('net fallback', e); }
        }
      }
    }
  }

  // ── IdRef path ──
  if (!nsData && idrefId) {
    // Step 1: direct reverse lookup by IdRef PPN (instant, no network)
    const nsFromIdref = nsLookupByIdref(idrefId);
    if (nsFromIdref) {
      nsData = makeNsData(nsFromIdref);
      cl.it = nsFromIdref.l;
      route.push('IdRef→NS-direct');
      const cluster = nsFromIdref.cl || {};
      nsClusterGrade = clGrade(cluster);
      if (cluster.wd) { qid = clId(cluster.wd); }
      const clLabels = resolveClusterLabels(cluster);
      if (clLabels.de && !cl.de) cl.de = clLabels.de;
      // cl.fr: use original MARC term (homeLang), fall back to cluster label only if term not set
      if (!cl.fr) cl.fr = clLabels.fr || null;
      if (clLabels.en && !cl.en) cl.en = clLabels.en;
      if (clLabels.es && !cl.es) cl.es = clLabels.es;
    }

    // Step 2: IdRef Solr for type info (needed for hierarchy) — always run to get termType
    // but only use label/NS matching if direct lookup above failed
    const solrRes = await resolveViaIdRefSolr(idrefId);
    if (solrRes) {
      route.push('IdRefSolr:' + idrefId + '(' + (solrRes.typeDesc || solrRes.type) + ')');
      // Only use Solr label if cl.fr not already set by MARC term or cluster
      if (!cl.fr) cl.fr = solrRes.label;
      // If direct lookup failed, try FR label → NS as fallback
      if (!nsData && solrRes.isSubject) {
        const nsFromFr = nsLookupByFrLabel(solrRes.label);
        if (nsFromFr) {
          nsData = makeNsData(nsFromFr);
          cl.it = nsFromFr.l;
          route.push('IdRef→FR→NS');
          const cluster = nsFromFr.cl || {};
          nsClusterGrade = clGrade(cluster);
          const clLabels = resolveClusterLabels(cluster);
          if (clLabels.de && !cl.de) cl.de = clLabels.de;
          if (clLabels.fr && !cl.fr) cl.fr = clLabels.fr;
          if (clLabels.en && !cl.en) cl.en = clLabels.en;
          if (cluster.wd) { qid = clId(cluster.wd); }
        }
      }
    }

    // Step 3: load full IdRef JSON for hierarchy data (only if still no QID)
    if (!qid || !idrefData) {
      try {
        const ir = await bgIdref(idrefId);
        if (ir) { idrefData = ir; route.push('IdRef:' + idrefId); }
      } catch (e) { logDebug('net fallback', e); }
    }
  }

  // ── NS SPARQL fallback REMOVED in v3.3 ──
  // The local unified index contains the complete NS vocabulary.
  // If nsLookup() didn't find the term, it either doesn't exist in NS
  // or is misspelled — in both cases the remote SPARQL would not help
  // and only adds ~500ms-1s latency per term.

  // ── Text fallback (WD) ──
  if (!qid) {
    route.push('WD-text');
    let searchTerm = term, searchLang = 'it';
    if (cl.fr && vocabSource === 'idref') { searchTerm = cl.fr; searchLang = 'fr'; }
    else if (cl.de && vocabSource === 'gnd') { searchTerm = cl.de; searchLang = 'de'; }
    else if (cl.it) { searchTerm = cl.it; }
    if (searchTerm.includes(',')) searchTerm = invertName(searchTerm);
    else searchTerm = cleanName(searchTerm);
    try {
      const r = await bgFetchJSON(WD_API + '?action=wbsearchentities&search=' + encodeURIComponent(searchTerm) + '&language=' + searchLang + '&uselang=' + searchLang + '&type=item&limit=1&format=json&origin=*');
      if (r?.search?.length) qid = r.search[0].id;
    } catch (e) { logDebug('net fallback', e); }
  }

  // ── Load WD entity ──
  if (qid) {
    if (EC.has(qid)) { entity = EC.get(qid); }
    else {
      try {
        const d = await bgFetchJSON(WD_API + '?action=wbgetentities&ids=' + qid + '&languages=' + LANGS.join('|') + '&props=labels|descriptions|claims&format=json&origin=*');
        if (d?.entities?.[qid]) { entity = d.entities[qid]; EC.set(qid, entity); }
      } catch (e) { logDebug('net fallback', e); }
    }
  }
  if (entity) {
    const cs = entity?.claims?.P1036;
    if (cs?.length) {
      dewey = [];
      for (const x of cs) {
        const n = x.mainsnak?.datavalue?.value;
        if (n) { let ed = null; if (x.qualifiers?.P393) ed = x.qualifiers.P393[0]?.datavalue?.value; dewey.push({ number: n, edition: ed }); }
      }
      if (!dewey.length) dewey = null;
    }
  }

  // ── NS reverse lookup: if we have QID or GND but no nsData, find the NS concept ──
  if (!nsData && nsIndex) {
    let nsReverse = null;
    if (qid) nsReverse = nsLookupByQid(qid);
    if (!nsReverse && gndId) nsReverse = nsLookupByGnd(gndId);
    if (!nsReverse && idrefId) nsReverse = nsLookupByIdref(idrefId);
    if (!nsReverse && entity) {
      const gi = getClaim(entity, 'P227');
      if (gi) nsReverse = nsLookupByGnd(gi);
      if (!nsReverse) {
        const li = getClaim(entity, 'P244');
        if (li) nsReverse = nsLookupByLcsh(li);
      }
      if (!nsReverse) {
        const ii = getClaim(entity, 'P269');
        if (ii) nsReverse = nsLookupByIdref(ii);
      }
    }
    if (nsReverse) {
      nsData = makeNsData(nsReverse);
      if (!cl.it) cl.it = nsReverse.l;
      if (!dewey && nsReverse.d) dewey = [{ number: nsReverse.d, edition: null }];
      route.push('NS-reverse');
      // Recover authoritative labels from pre-computed cluster (local first, HTTP fallback)
      const cluster = nsReverse.cl || {};
      nsClusterGrade = clGrade(cluster);
      const reversePromises = [];
      if (!cl.de && (cluster.gnd || gndId)) {
        const gi = cluster.gnd ? (clId(cluster.gnd)) : gndId;
        const localDE = getAuthLabel('gnd', gi);
        if (localDE) { cl.de = localDE; }
        else { reversePromises.push(bgLobid(gi).then(ld => { if (ld?.preferredName) { lobidData = ld; cl.de = ld.preferredName; } }).catch(() => {})); }
      }
      // FR: full labels_fr.json (all BnF terms are potential catalog subjects)
      if (!cl.fr && cluster.bnf) {
        const bi = clId(cluster.bnf);
        const localFR = getAuthLabel('bnf', bi);
        if (localFR) { cl.fr = localFR; }
        else { reversePromises.push(fetchBnfLabelRemote(bi).then(lbl => { if (lbl && !cl.fr) cl.fr = lbl; })); }
      }
      if (!cl.en && cluster.lcsh) {
        const li = clId(cluster.lcsh);
        const localEN = getAuthLabel('lcsh', li);
        if (localEN) { cl.en = localEN; }
        else { reversePromises.push(bgFetchLCSH(li).then(h => { if (h) cl.en = h; }).catch(() => {})); }
      }
      // ES: slim labels_es_slim.json, fallback to BNE API
      if (!cl.es && cluster.bne) {
        const bi = clId(cluster.bne);
        const localES = getAuthLabel('bne', bi);
        if (localES) { cl.es = localES; }
        else { reversePromises.push(bgFetchBNE(bi).then(lb => { if (lb) cl.es = lb; }).catch(() => {})); }
      }
      if (reversePromises.length) await Promise.all(reversePromises);
    }
  }

  // ── Enrichment for places/persons: use WD entity to fill missing authoritative labels ──
  // Only for terms that are NOT thesaurus concepts (no nsData) but have a WD entity,
  // AND whose termType is explicitly 'place' or 'person' (from MARC structure).
  // This avoids false positives from the WD text fallback on misspelled thesaurus terms.
  if (!nsData && entity && (termType === 'place' || termType === 'person')) {
    const enrichPromises = [];
    // GND label via Lobid (only if cl.de is still empty)
    if (!cl.de) {
      const gi = gndId || getClaim(entity, 'P227');
      if (gi) {
        enrichPromises.push(
          bgLobid(gi).then(ld => {
            if (ld?.preferredName) { if (!lobidData) lobidData = ld; if (!cl.de) cl.de = ld.preferredName; }
          }).catch(() => {})
        );
      }
    }
    // IdRef/FR label via IdRef Solr (only if cl.fr is still empty)
    if (!cl.fr) {
      const ii = idrefId || getClaim(entity, 'P269');
      if (ii) {
        enrichPromises.push(
          resolveViaIdRefSolr(ii).then(solr => {
            if (solr?.label && !cl.fr) cl.fr = solr.label;
          }).catch(() => {})
        );
      }
    }
    // EN label via LCSH (only if cl.en is still empty)
    if (!cl.en) {
      const li = getClaim(entity, 'P244');
      if (li) {
        enrichPromises.push(
          bgFetchLCSH(li).then(h => { if (h && !cl.en) cl.en = h; }).catch(() => {})
        );
      }
    }
    // ES label via BNE (only if cl.es is still empty)
    if (!cl.es) {
      const bi = getClaim(entity, 'P950');
      if (bi) {
        enrichPromises.push(
          bgFetchBNE(bi).then(lb => { if (lb && !cl.es) cl.es = lb; }).catch(() => {})
        );
      }
    }
    if (enrichPromises.length) {
      route.push('enrich-' + termType);
      await Promise.all(enrichPromises);
    }
  }

  const result = { qid, entity, route, nsData, dewey, controlledLabels: cl, vocabSource: vocabSource || null, lobidData, idrefData, termType: termType || null, gndId: gndId || null, idrefId: idrefId || null, nsClusterGrade };
  RC.set(k, result);
  return result;
}

// ═══════════════════════════════════════════
// HIERARCHY (with NS local index)
// ═══════════════════════════════════════════
async function getHierarchy(qid, entity, nsUri, gndId, idrefId) {
  const k = (qid || '') + '|' + (nsUri || '') + '|' + (gndId || '') + '|' + (idrefId || '');
  if (HC.has(k)) return HC.get(k);
  const nodes = [];

  function addNode(type, label, src, uri, langs, extras) {
    const ex = nodes.find(n => n.label.toLowerCase() === label.toLowerCase() && n.type === type);
    if (ex) {
      if (!ex.srcs.includes(src)) ex.srcs.push(src);
      if (langs) Object.entries(langs).forEach(([k, v]) => { if (v) ex.langs[k] = ex.langs[k] || v; });
      if (extras) { if (extras.gndId) ex.gndId = ex.gndId || extras.gndId; if (extras.idrefId) ex.idrefId = ex.idrefId || extras.idrefId; if (extras.nsTid) ex.nsTid = ex.nsTid || extras.nsTid; }
    } else {
      nodes.push({ type, label, srcs: [src], uri: uri || '', langs: langs || {}, gndId: extras?.gndId || null, idrefId: extras?.idrefId || null, nsTid: extras?.nsTid || null });
    }
  }

  // NS local hierarchy (instant) — enriched with cluster labels
  if (nsUri && nsIndex) {
    const tid = nsUri.split('/').pop();
    const concept = nsGetConcept(tid);
    if (concept) {
      // Recover GND ID from cluster if not provided (crucial for GND hierarchy)
      if (!gndId && concept.cl?.gnd) {
        gndId = clId(concept.cl.gnd);
      }
      // Recover IdRef-compatible BnF for IdRef hierarchy enrichment
      if (!idrefId && concept.cl?.bnf) {
        // We don't have IdRef ID directly, but we note the BnF for reference
      }
      const addNsNode = (type, relTid) => {
        const lbl = nsGetLabel(relTid);
        if (!lbl) return;
        const cluster = nsIndex.concepts[relTid]?.cl || {};
        const clLabels = resolveClusterLabels(cluster);
        const langs = { it: lbl };
        if (clLabels.de) langs.de = clLabels.de;
        if (clLabels.fr) langs.fr = clLabels.fr;
        if (clLabels.en) langs.en = clLabels.en;
        addNode(type, lbl, 'NS', 'http://purl.org/bncf/tid/' + relTid, langs, { nsTid: relTid, gndId: cluster.gnd ? (clId(cluster.gnd)) : null });
      };
      if (concept.bt) concept.bt.forEach(btId => addNsNode('bt', btId));
      if (concept.nt) concept.nt.forEach(ntId => addNsNode('nt', ntId));
      if (concept.rt) concept.rt.forEach(rtId => addNsNode('rt', rtId));
    }
  } else if (nsUri) {
    // Fallback: SPARQL
    try {
      const r = await bgSparql(NS_SPARQL, 'PREFIX skos:<http://www.w3.org/2004/02/skos/core#> SELECT ?type ?r ?l WHERE{{BIND("bt" AS ?type) <' + nsUri + '> skos:broader ?r. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}UNION{BIND("nt" AS ?type) ?r skos:broader <' + nsUri + '>. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}UNION{BIND("rt" AS ?type) <' + nsUri + '> skos:related ?r. ?r skos:prefLabel ?l. FILTER(LANG(?l)="it")}} ORDER BY ?type ?l LIMIT 50');
      if (r?.results?.bindings) r.results.bindings.forEach(b => { addNode(b.type.value, b.l.value, 'NS', b.r.value, {}); });
    } catch (e) { logDebug('net fallback', e); }
  }

  // GND hierarchy — local index first, Lobid API as fallback for related terms
  // or when the GND ID is absent from hierarchy_gnd.json (non-topic entities).
  if (gndId) {
    const localHier = getGndBroaderNarrower(gndId);
    if (localHier) {
      const addGndLocal = (type, ids) => {
        if (!ids) return;
        ids.forEach(relGndId => {
          const nsConcept = nsLookupByGnd(relGndId);
          if (nsConcept) {
            const cluster = nsConcept.cl || {};
            const clLabels = resolveClusterLabels(cluster);
            const deLabel = langLabels.de?.[relGndId];
            const langs = { it: nsConcept.l, de: deLabel || nsConcept.l };
            if (clLabels.fr) langs.fr = clLabels.fr;
            if (clLabels.en) langs.en = clLabels.en;
            addNode(type, nsConcept.l, 'GND', 'https://d-nb.info/gnd/' + relGndId, langs, { gndId: relGndId, nsTid: nsConcept.tid });
          } else {
            const deLabel = langLabels.de?.[relGndId];
            if (deLabel) addNode(type, deLabel, 'GND', 'https://d-nb.info/gnd/' + relGndId, { de: deLabel }, { gndId: relGndId });
          }
        });
      };
      addGndLocal('bt', localHier.bt);
      addGndLocal('nt', localHier.nt);
      // related terms (rt) are not in the local hierarchy file — skip API call
      // to avoid the latency; they can be re-enabled below if needed.
    } else {
      // Fallback: Lobid API (covers non-topic GND entities and missing entries)
      try {
        const ld = await bgLobid(gndId);
        if (ld) {
          const addGndNodes = (type, items) => {
            if (!items) return;
            items.forEach(b => {
              if (!b.label) return;
              const gi = b.id?.match?.(/gnd\/([^/]+)$/)?.[1] || b.gndIdentifier;
              const nsConcept = gi ? nsLookupByGnd(gi) : null;
              if (nsConcept) {
                const cluster = nsConcept.cl || {};
                const clLabels = resolveClusterLabels(cluster);
                const langs = { it: nsConcept.l, de: b.label };
                if (clLabels.fr) langs.fr = clLabels.fr;
                if (clLabels.en) langs.en = clLabels.en;
                addNode(type, nsConcept.l, 'GND', b.id, langs, { gndId: gi, nsTid: nsConcept.tid });
              } else {
                addNode(type, b.label, 'GND', b.id, { de: b.label }, { gndId: gi });
              }
            });
          };
          addGndNodes('bt', ld.broaderTermGeneral);
          addGndNodes('nt', ld.narrowerTermGeneral);
          addGndNodes('rt', ld.relatedTerm);
        }
      } catch (e) { logDebug('gnd lobid fallback', e); }
    }
  }

  // IdRef hierarchy — resolve to BnF ID via NS cluster, then use local BnF
  // hierarchy index. Falls back to IdRef API when no local data is available.
  if (idrefId) {
    // Find the BnF/RAMEAU ID for this IdRef term via the NS cluster reverse index
    const idrefNsConcept = nsLookupByIdref(idrefId);
    const idrefBnfId = idrefNsConcept?.cl?.bnf ? clId(idrefNsConcept.cl.bnf) : null;
    const localBnfHier = idrefBnfId ? getBnfBroaderNarrower(idrefBnfId) : null;

    if (localBnfHier) {
      const addBnfLocal = (type, ids) => {
        if (!ids) return;
        ids.forEach(relBnfId => {
          const relNsConcept = nsLookupByBnf(relBnfId);
          if (relNsConcept) {
            const cluster = relNsConcept.cl || {};
            const clLabels = resolveClusterLabels(cluster);
            const frLabel = langLabels.fr?.[relBnfId];
            const langs = { it: relNsConcept.l, fr: frLabel || relNsConcept.l };
            if (clLabels.de) langs.de = clLabels.de;
            if (clLabels.en) langs.en = clLabels.en;
            // Use IdRef ID from cluster if available, else leave blank
            const relIdrefId = relNsConcept.cl?.idref ? clId(relNsConcept.cl.idref) : null;
            const relUri = relIdrefId ? 'https://www.idref.fr/' + relIdrefId : '';
            addNode(type, relNsConcept.l, 'IdRef', relUri, langs, { idrefId: relIdrefId, nsTid: relNsConcept.tid });
          } else {
            const frLabel = langLabels.fr?.[relBnfId];
            if (frLabel) addNode(type, frLabel, 'IdRef', '', { fr: frLabel }, {});
          }
        });
      };
      addBnfLocal('bt', localBnfHier.bt);
      addBnfLocal('nt', localBnfHier.nt);
    } else {
      // Fallback: IdRef API (covers terms not in NS clusters or missing from hierarchy_bnf)
      try {
        const ir = await bgIdref(idrefId);
        if (ir?.record?.datafield) {
          ir.record.datafield.forEach(f => {
            const tag = String(f.tag);
            if (tag !== '550' && tag !== '551') return;
            const subs = Array.isArray(f.subfield) ? f.subfield : [f.subfield];
            const label = subs.find(s => s.code === 'a')?.content;
            const code5 = subs.find(s => String(s.code) === '5')?.content || '';
            const refId = String(subs.find(s => String(s.code) === '3')?.content || '');
            if (!label) return;
            let type = 'rt';
            if (code5.startsWith('g')) type = 'bt';
            else if (code5.startsWith('h')) type = 'nt';
            const nsConcept = nsLookupByFrLabel(label);
            if (nsConcept) {
              const cluster = nsConcept.cl || {};
              const clLabels = resolveClusterLabels(cluster);
              const langs = { it: nsConcept.l, fr: label };
              if (clLabels.de) langs.de = clLabels.de;
              if (clLabels.en) langs.en = clLabels.en;
              addNode(type, nsConcept.l, 'IdRef', refId ? 'https://www.idref.fr/' + refId : '', langs, { idrefId: refId || null, nsTid: nsConcept.tid });
            } else {
              addNode(type, label, 'IdRef', refId ? 'https://www.idref.fr/' + refId : '', { fr: label }, { idrefId: refId || null });
            }
          });
        }
      } catch (e) { logDebug('idref api fallback', e); }
    }
  }

  // AAT hierarchy
  const aatId = entity ? getClaim(entity, 'P1014') : null;
  if (aatId) {
    try {
      const r = await bgSparql(AAT_SPARQL, 'PREFIX gvp:<http://vocab.getty.edu/ontology#> PREFIX xl:<http://www.w3.org/2008/05/skos-xl#> PREFIX dct:<http://purl.org/dc/terms/> SELECT ?type ?uri ?labelEn ?labelIt ?labelDe ?labelFr WHERE{{BIND("bt" AS ?type)<http://vocab.getty.edu/aat/' + aatId + '> gvp:broaderGeneric ?uri.?uri xl:prefLabel ?xlEn.?xlEn dct:language <http://vocab.getty.edu/aat/300388277>;gvp:term ?labelEn.OPTIONAL{?uri xl:prefLabel ?xlIt.?xlIt dct:language <http://vocab.getty.edu/aat/300388474>;gvp:term ?labelIt}OPTIONAL{?uri xl:prefLabel ?xlDe.?xlDe dct:language <http://vocab.getty.edu/aat/300388344>;gvp:term ?labelDe}OPTIONAL{?uri xl:prefLabel ?xlFr.?xlFr dct:language <http://vocab.getty.edu/aat/300388306>;gvp:term ?labelFr}}UNION{BIND("nt" AS ?type)?uri gvp:broaderGeneric <http://vocab.getty.edu/aat/' + aatId + '>.?uri xl:prefLabel ?xlEn.?xlEn dct:language <http://vocab.getty.edu/aat/300388277>;gvp:term ?labelEn.OPTIONAL{?uri xl:prefLabel ?xlIt.?xlIt dct:language <http://vocab.getty.edu/aat/300388474>;gvp:term ?labelIt}OPTIONAL{?uri xl:prefLabel ?xlDe.?xlDe dct:language <http://vocab.getty.edu/aat/300388344>;gvp:term ?labelDe}OPTIONAL{?uri xl:prefLabel ?xlFr.?xlFr dct:language <http://vocab.getty.edu/aat/300388306>;gvp:term ?labelFr}}}LIMIT 20');
      if (r?.results?.bindings) r.results.bindings.forEach(b => {
        const lbl = b.labelIt?.value || b.labelEn?.value || '';
        const langs = { en: b.labelEn?.value, it: b.labelIt?.value, de: b.labelDe?.value, fr: b.labelFr?.value };
        addNode(b.type.value, lbl, 'AAT', b.uri.value, langs);
      });
    } catch (e) { logDebug('net fallback', e); }
  }

  // WD hierarchy (P279) — match to NS cluster when possible
  if (qid) {
    try {
      const r = await bgSparql(WD_SPARQL, 'SELECT ?type ?item ?lIt ?lDe ?lFr ?lEn WHERE{{BIND("bt" AS ?type)wd:' + qid + ' wdt:P279 ?item}UNION{BIND("nt" AS ?type)?item wdt:P279 wd:' + qid + '}OPTIONAL{?item rdfs:label ?lIt FILTER(LANG(?lIt)="it")}OPTIONAL{?item rdfs:label ?lDe FILTER(LANG(?lDe)="de")}OPTIONAL{?item rdfs:label ?lFr FILTER(LANG(?lFr)="fr")}OPTIONAL{?item rdfs:label ?lEn FILTER(LANG(?lEn)="en")}}LIMIT 20');
      if (r?.results?.bindings) r.results.bindings.forEach(b => {
        const lbl = b.lIt?.value || b.lEn?.value || '';
        if (!lbl) return;
        const langs = { it: b.lIt?.value, de: b.lDe?.value, fr: b.lFr?.value, en: b.lEn?.value };
        const wdQid = b.item?.value?.split('/').pop() || null;
        const nsConcept = wdQid ? nsLookupByQid(wdQid) : null;
        if (nsConcept) {
          const cluster = nsConcept.cl || {};
          const clLabels = resolveClusterLabels(cluster);
          const mergedLangs = { it: nsConcept.l, ...clLabels, ...langs };
          addNode(b.type.value, nsConcept.l, 'WD', b.item.value, mergedLangs, { nsTid: nsConcept.tid });
        } else {
          addNode(b.type.value, lbl, 'WD', b.item.value, langs);
        }
      });
    } catch (e) { logDebug('net fallback', e); }
  }

  // ── Cluster-based fusion: merge nodes sharing the same nsTid ──
  const fused = [];
  const tidMap = new Map();
  for (const n of nodes) {
    if (n.nsTid) {
      const fusionKey = n.type + ':' + n.nsTid;
      if (tidMap.has(fusionKey)) {
        const target = fused[tidMap.get(fusionKey)];
        n.srcs.forEach(s => { if (!target.srcs.includes(s)) target.srcs.push(s); });
        Object.entries(n.langs).forEach(([k, v]) => { if (v) target.langs[k] = target.langs[k] || v; });
        if (n.gndId) target.gndId = target.gndId || n.gndId;
        if (n.idrefId) target.idrefId = target.idrefId || n.idrefId;
      } else {
        tidMap.set(fusionKey, fused.length);
        fused.push({ ...n });
      }
    } else {
      const existing = fused.find(f => f.type === n.type && f.label.toLowerCase() === n.label.toLowerCase());
      if (existing) {
        n.srcs.forEach(s => { if (!existing.srcs.includes(s)) existing.srcs.push(s); });
        Object.entries(n.langs).forEach(([k, v]) => { if (v) existing.langs[k] = existing.langs[k] || v; });
        if (n.gndId) existing.gndId = existing.gndId || n.gndId;
        if (n.idrefId) existing.idrefId = existing.idrefId || n.idrefId;
      } else {
        fused.push({ ...n });
      }
    }
  }

  // Sort within types: clustered nodes first, then AAT, then WD-only
  fused.sort((a, b) => {
    if (a.type !== b.type) return 0;
    const aScore = a.nsTid ? 0 : a.srcs.includes('AAT') ? 1 : 2;
    const bScore = b.nsTid ? 0 : b.srcs.includes('AAT') ? 1 : 2;
    return aScore - bScore;
  });

  HC.set(k, fused);
  return fused;
}

// ═══════════════════════════════════════════
// URL BUILDERS
// ═══════════════════════════════════════════
function buildSearchUrl(q, mode) {
  const idx = mode === 'broad' ? 'any' : 'sub';
  return 'https://' + searchCtx.host + '/discovery/search?query=' + idx + ',contains,' + encodeURIComponent(q) + '&tab=' + searchCtx.tab + '&search_scope=' + searchCtx.scope + '&vid=' + searchCtx.vid;
}
function buildCatUrl(e, nsL, cl, mode) {
  const labels = new Set();
  if (cl) Object.values(cl).forEach(l => { if (l) labels.add(l); });
  if (nsL) labels.add(nsL);
  if (e) LANGS.forEach(l => { if (!cl || !cl[l]) { const lb = getLabel(e, l); if (lb) labels.add(lb); } });
  if (!labels.size) return null;
  return buildSearchUrl([...labels].map(l => '"' + l + '"').join(' OR '), mode);
}
function buildCrossAndUrl(selectedTerms, mode) {
  const langGroups = {};
  LANGS.forEach(l => { langGroups[l] = []; });
  for (const t of selectedTerms) {
    const cl = t.mergedLabels || t.controlledLabels || {};
    const e = t.entity;
    LANGS.forEach(l => { const label = getPrefLabel(cl, e, l); if (label) langGroups[l].push('"' + label + '"'); });
  }
  const parts = [];
  Object.entries(langGroups).forEach(([l, terms]) => { if (terms.length >= 2) parts.push('(' + terms.join(' AND ') + ')'); });
  if (!parts.length) {
    const allLabels = selectedTerms.map(t => { const cl = t.mergedLabels || t.controlledLabels || {}; return cl.it || cl.de || cl.fr || cl.en || cl.es || t.nsData?.label || ''; }).filter(Boolean);
    if (allLabels.length >= 2) parts.push('(' + allLabels.map(l => '"' + l + '"').join(' AND ') + ')');
  }
  if (!parts.length) return null;
  return buildSearchUrl(parts.join(' OR '), mode);
}

// ═══════════════════════════════════════════
// MERGED LABELS (cross-vocab QID dedup)
// ═══════════════════════════════════════════
function mergeByQid(allResults) {
  const qidMap = new Map();
  for (const r of allResults) {
    if (!r.qid) continue;
    if (!qidMap.has(r.qid)) qidMap.set(r.qid, {});
    const merged = qidMap.get(r.qid);
    const cl = r.controlledLabels || {};
    for (const [lang, label] of Object.entries(cl)) {
      if (label && !merged[lang]) merged[lang] = label;
    }
  }
  for (const r of allResults) {
    if (r.qid && qidMap.has(r.qid)) r.mergedLabels = qidMap.get(r.qid);
  }
}

// ═══════════════════════════════════════════
// RENDERING (DOM-based, no innerHTML)
// ═══════════════════════════════════════════
function rBadges(e, q, ns, knownIds) {
  const container = el('span');
  if (ns) {
    if (ns.src === 'sbt') {
      const numId = ns.id.slice(4); // 'SBT_4405' → '4405'
      const a = el('a', { href: 'https://www2.sbt.ti.ch/soggettario/index.jsp?termine=' + numId, target: '_blank', textContent: 'SBT:' + numId });
      container.appendChild(el('span', { className: 'id id-sbt' }, a));
    } else {
      const a = el('a', { href: ID_PROPS.P508.u(ns.id), target: '_blank', textContent: 'NS:' + ns.id });
      container.appendChild(el('span', { className: 'id id-ns' }, a));
    }
  }
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
  // Show MARC-known IDs that WD didn't have
  if (knownIds) {
    if (knownIds.idrefId && !shownProps.has('P269')) {
      const info = ID_PROPS.P269;
      const a = el('a', { href: info.u(knownIds.idrefId), target: '_blank', textContent: info.l + ':' + knownIds.idrefId });
      container.appendChild(el('span', { className: 'id ' + info.c }, a));
    }
    if (knownIds.gndId && !shownProps.has('P227')) {
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

  const badges = rBadges(entity, qid, nsData, { idrefId: idrefId || null, gndId: gndId || null });
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
  const navEl = document.getElementById('sn-navTree');
  if (!navEl) return;
  clearEl(navEl);
  navEl.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: label }));
  const r = await reconcile(label, nodeGndId || null, nodeIdrefId || null, nodeGndId ? 'gnd' : nodeIdrefId ? 'idref' : null);
  let gi = nodeGndId || getGndFromEntity(r.entity);
  let ii = nodeIdrefId || getIdrefFromEntity(r.entity);
  if (!gi && r.lobidData) gi = r.lobidData.gndIdentifier || null;
  if (!gi || !ii) {
    for (const [k, v] of RC.entries()) {
      if (v.qid === r.qid || (label && k.startsWith(label.toLowerCase() + '|'))) {
        if (!gi) { const mg = k.split('|')[1]; if (mg) gi = mg; }
        if (!ii) { const mi = k.split('|')[2]; if (mi) ii = mi; }
        if (!gi && v.lobidData) gi = v.lobidData.gndIdentifier;
        break;
      }
    }
  }
  navPush(label, r.qid, r.entity, r.nsData?.uri, gi, ii);
  const h = await getHierarchy(r.qid, r.entity, r.nsData?.uri, gi, ii);
  rDynHier(document.getElementById('sn-navTree'), h, label, r.qid, r.entity, gi, ii);
}

async function navTo(idx) {
  if (idx < 0 || idx >= navState.history.length) return;
  navState.currentIndex = idx;
  const e = navState.history[idx];
  const navEl = document.getElementById('sn-navTree');
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

  // ── Helper: build a cluster row (the riquadro with affianced vocab cards) ──
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
        card.addEventListener('click', () => { if (isAllowedOpenUrl(url)) window.open(url, '_blank'); });
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
  const sidebar = document.getElementById('sn-sidebar');
  if (!sidebar) return;
  const container = document.getElementById('sn-crossAnd');
  if (!container) return;
  const allItems = container._allItems;
  if (!allItems) return;

  const chips = sidebar.querySelectorAll('.and-chip');
  const selected = [];
  chips.forEach((chip, i) => { if (chip.classList.contains('checked') && allItems[i]) selected.push(allItems[i]); });
  const resultEl = document.getElementById('sn-and-result');
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
  const sb = document.getElementById('sn-sidebar');
  if (sb) sb.remove();
  const badge = document.getElementById('sn-badge');
  if (badge) badge.remove();
  sidebarState = 'none';
  currentDocId = null;
}

function createBadge(count) {
  let badge = document.getElementById('sn-badge');
  if (!badge) {
    badge = el('div', { id: 'sn-badge' });
    badge.addEventListener('click', () => expandSidebar());
    document.body.appendChild(badge);
  }
  clearEl(badge);
  badge.appendChild(el('span', { className: 'sn-badge-icon', textContent: 'S' }));
  badge.appendChild(el('span', { className: 'sn-badge-count', textContent: String(count) }));
  sidebarState = 'badge';
}

function expandSidebar() {
  const sb = document.getElementById('sn-sidebar');
  if (sb) { sb.classList.remove('sn-hidden', 'sn-wide'); sidebarState = 'open'; const badge = document.getElementById('sn-badge'); if (badge) badge.style.display = 'none'; }
}

function collapseSidebar() {
  const sb = document.getElementById('sn-sidebar');
  if (sb) sb.classList.add('sn-hidden');
  const badge = document.getElementById('sn-badge');
  if (badge) badge.style.display = '';
  sidebarState = 'badge';
}

// ═══════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════
function applyTheme() {
  const sb = document.getElementById('sn-sidebar');
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
  const btn = document.querySelector('.sn-theme-btn');
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
    else if (a === 'togglewide') { const sb = document.getElementById('sn-sidebar'); sb.classList.toggle('sn-wide'); }
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
      if (url && isAllowedOpenUrl(url)) window.open(url, '_blank');
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
    const t = e.target.closest('[data-action]');
    if (!t) return;
    executeAction(t);
  });

  // Close the about popover when clicking anywhere outside it
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="toggleabout"]')) return; // handled by toggleabout
    if (!e.target.closest('.sn-about-popover')) {
      sidebar.querySelector('.sn-about-popover')?.classList.remove('on');
    }
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

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
let isLoading = false;
async function loadRecord(url) {
  const { docId, vid, instCode, mmsId, isFullDisplay, lang } = parsePageUrl(url);
  if (!isFullDisplay || !docId) { removeSidebar(); return; }
  if (docId === currentDocId) return;
  if (isLoading) return;
  isLoading = true;
  currentDocId = docId;
  setLang(lang);
  RC.clear(); HC.clear(); EC.clear();
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
  headerLeft.appendChild(el('span', { className: 'sn-version', textContent: 'v1.0' }));

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
  header.appendChild(aboutPopover);

  sidebar.appendChild(header);

  const body = el('div', { className: 'sn-body', id: 'sn-body' });
  body.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.fetchingMarc }));
  sidebar.appendChild(body);
  document.body.appendChild(sidebar);
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
    if (!result?.fields?.length) { removeSidebar(); isLoading = false; return; }
    marcFields = result.fields;
  } catch (e) { removeSidebar(); isLoading = false; return; }

  const { sbt, gnd, idr, names, cduClasses, cddClasses } = extractAll(marcFields);
  const subjCount = sbt.length + gnd.length + idr.length;
  const classCount = cduClasses.length + cddClasses.length;
  if (!subjCount && !names.length && !classCount) { removeSidebar(); isLoading = false; return; }
  createBadge(subjCount + names.length);

  // Guard: if the sidebar was removed while awaiting the MARC fetch (URL change
  // or navigation during the async wait), abort gracefully instead of crashing.
  const bodyEl = document.getElementById('sn-body');
  if (!bodyEl) { isLoading = false; return; }
  clearEl(bodyEl);

  // Tabs — role=tablist con role=tab per accessibilità
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

    // Sezioni CDU e CDD — come vtabs
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

    // CDU section — 'on' se è la prima sezione visibile (con o senza vtabs)
    var cduBodyEl = null;
    if (cduClasses.length) {
      cduBodyEl = el('div', { className: 'vtb cls-vtb on' });
      clsBody.appendChild(cduBodyEl);
    }

    // CDD section — 'on' solo se non c'è CDU (è la prima sezione)
    var cddBodyEl = null;
    if (cddClasses.length) {
      cddBodyEl = el('div', { className: 'cls-vtb vtb' + (cduClasses.length ? '' : ' on') });
      clsBody.appendChild(cddBodyEl);
    }

    // Cattura esplicitamente le variabili per la closure asincrona
    var _cduItems = cduClasses.slice();
    var _cddItems = cddClasses.slice();
    var _cduTarget = cduBodyEl;
    var _cddTarget = cddBodyEl;
    var _ctx = searchCtx;
    var _lang = lang;

    // Popola le sezioni sempre in modo asincrono (setTimeout garantisce DOM stabile)
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
    // Sempre asincrono: se vocabReady chiama subito, setTimeout(0) posticipa
    // di un tick garantendo che il DOM sia completamente costruito e appendato
    onVocabReady(function() { setTimeout(_populateClassCards, 0); });

    bodyEl.appendChild(clsBody);

    // vtabs switching per classificazione (scoped a clsBody)
    if (clsVtabs) {
      clsVtabs.addEventListener('click', e => {
        const vt = e.target.closest('[data-action="switchvt-cls"]');
        if (!vt) return;
        const idx = parseInt(vt.dataset.idx);
        clsVtabs.querySelectorAll('.vt').forEach((v,i) => v.classList.toggle('on', i===idx));
        // Solo i vtb figli diretti di clsBody
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
      const detEl = document.getElementById('sn-det-sbt-' + j);
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
        const chipsEl = document.getElementById('sn-chips-' + sbtIdx + '-' + j);
        const andEl = document.getElementById('sn-and-' + sbtIdx + '-' + j);
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
                await renderTermDetail(detEl, comp.t, null, null, 'sbt', clickTT);
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
          const fr = await renderTermDetail(detEl, orderedComps[0].t, null, null, 'sbt', 'person');
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
              const r = await reconcile(orderedComps[ci].t, null, null, 'sbt', compTT);
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
          const r = await renderTermDetail(detEl, item.display, null, null, 'sbt', 'person');
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
        const chipsEl = document.getElementById('sn-chips-' + sbtIdx + '-' + j);
        const andEl = document.getElementById('sn-and-' + sbtIdx + '-' + j);
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
                await renderTermDetail(detEl, comp.t, null, null, 'sbt', clickTT);
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
          const fr = await renderTermDetail(detEl, orderedComps[0].t, null, null, 'sbt', firstTT);
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
              const r = await reconcile(orderedComps[ci].t, null, null, 'sbt', compTT);
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
      const el2 = document.getElementById('sn-det-gnd-' + j);
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
      const el2 = document.getElementById('sn-det-idr-' + j);
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
      const el2 = document.getElementById('sn-det-name-' + j);
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

  const crossAndEl = document.getElementById('sn-crossAnd');
  if (crossAndEl && (rTerms.length + allNameResults.length) >= 2) renderAndBuilder(crossAndEl);

  // Nav chips — dedup by label, QID, and NS tid to avoid duplicates
  const navSelEl = document.getElementById('sn-navSel');
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
        const navEl = document.getElementById('sn-navTree');
        if (!navEl) return;
        clearEl(navEl);
        navEl.appendChild(el('div', { className: 'status spin', role: 'status', 'aria-live': 'polite', textContent: L.loading }));
        let q = term.qid, e = term.entity, u = term.nsData?.uri;
        if (!q && !u) { const r = await reconcile(term.label, null, null, null, term.termType || null); q = r.qid; e = r.entity; u = r.nsData?.uri; }
        let gi = getGndFromEntity(e), ii = getIdrefFromEntity(e);
        for (const [k, v] of RC.entries()) {
          if (v.qid === q || (term.label && k.startsWith(term.label.toLowerCase() + '|'))) {
            if (!gi) { const mg = k.split('|')[1]; if (mg) gi = mg; }
            if (!ii) { const mi = k.split('|')[2]; if (mi) ii = mi; }
            if (!gi && v.lobidData) gi = v.lobidData.gndIdentifier;
            break;
          }
        }
        navPush(term.label, q, e, u, gi, ii);
        const h = await getHierarchy(q, e, u, gi, ii);
        rDynHier(document.getElementById('sn-navTree'), h, term.label, q, e, gi, ii);
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
      if (!q && !u) { const r = await reconcile(t.label, null, null, null, t.termType || null); q = r.qid; e = r.entity; u = r.nsData?.uri; }
      let gi = getGndFromEntity(e), ii = getIdrefFromEntity(e);
      for (const [k, v] of RC.entries()) {
        if (v.qid === q || (t.label && k.startsWith(t.label.toLowerCase() + '|'))) {
          if (!gi) { const mg = k.split('|')[1]; if (mg) gi = mg; }
          if (!ii) { const mi = k.split('|')[2]; if (mi) ii = mi; }
          if (!gi && v.lobidData) gi = v.lobidData.gndIdentifier;
          break;
        }
      }
      navPush(t.label, q, e, u, gi, ii);
      const h = await getHierarchy(q, e, u, gi, ii);
      rDynHier(document.getElementById('sn-navTree'), h, t.label, q, e, gi, ii);
    }
  }
  isLoading = false;
}

// ═══════════════════════════════════════════
// SPA + MESSAGES
// ═══════════════════════════════════════════
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'toggleSidebar') {
    const sb = document.getElementById('sn-sidebar');
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

// Polling for URL changes: Primo is a SPA with history transitions that
// don't always fire popstate/hashchange. 800 ms is responsive enough for
// hand-driven navigation while keeping background cost negligible.
// We pause the interval when the tab is hidden to avoid needless work
// across many open tabs, and catch up on re-activation.
let snPollTimer = null;
function snStartPoll() {
  if (snPollTimer) return;
  snPollTimer = setInterval(checkUrl, 800);
}
function snStopPoll() {
  if (snPollTimer) { clearInterval(snPollTimer); snPollTimer = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { checkUrl(); snStartPoll(); }
  else snStopPoll();
});
if (document.visibilityState === 'visible') snStartPoll();
checkUrl();

})();
