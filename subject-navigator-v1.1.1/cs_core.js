// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 1/7): core: i18n, state, DOM helpers, API bridge — v1.1.0
// The seven cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';


// ═══════════════════════════════════════════
// CLASSIFICATION VOCABULARIES (local UDC + reduced DDC + Geo)
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
    wdUnverified:'Corrispondenza Wikidata non verificata: trovata solo per nome, nessun identificativo in comune con il record.', wdRejected:'Candidato Wikidata scartato', wdRejectedWhy:'nessun ID in comune con il record e forma del nome diversa.',
    idsFromRecord:'Dal record', idsFromWd:'Da Wikidata — ipotesi non confermata',
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
    wdUnverified:'Wikidata-Zuordnung nicht verifiziert: nur über den Namen gefunden, keine gemeinsame ID mit der Aufnahme.', wdRejected:'Wikidata-Kandidat verworfen', wdRejectedWhy:'keine gemeinsame ID und abweichende Namensform.',
    idsFromRecord:'Aus der Aufnahme', idsFromWd:'Aus Wikidata — unbestätigte Hypothese',
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
    wdUnverified:'Correspondance Wikidata non v\u00e9rifi\u00e9e\u00a0: trouv\u00e9e par le nom seul, aucun identifiant commun avec la notice.', wdRejected:'Candidat Wikidata \u00e9cart\u00e9', wdRejectedWhy:'aucun identifiant commun et forme du nom diff\u00e9rente.',
    idsFromRecord:'De la notice', idsFromWd:'De Wikidata \u2014 hypoth\u00e8se non confirm\u00e9e',
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
    wdUnverified:'Wikidata match unverified: found by name only, no identifier shared with the record.', wdRejected:'Wikidata candidate discarded', wdRejectedWhy:'no shared identifier and a different name form.',
    idsFromRecord:'From the record', idsFromWd:'From Wikidata — unconfirmed hypothesis',
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
// CLASSIFICATION VOCABULARIES — loaded from separate packaged JSON files
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
  } catch(e) { console.error('CDU/CDD: vocabulary load error', e); }
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
// v1.1.0: reconciliation lives in the worker, so the per-API bridges of
// v1.0.x (sparql / fetchJSON / lobid / idref / …) are gone. Only the MARC
// fetch remains here; the reconcile/hierarchy wrappers live in
// cs_reconcile.js and the four-message protocol is documented in
// background.js.
function bgFetchMarc(o) { return bgMsg({ type: 'fetchMarc', ...o }); }

// ═══════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════
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


// ═══════════════════════════════════════════
// SHADOW DOM HOST
// The whole extension UI lives in a *closed* shadow root attached to a
// host <div> in the page: it isolates our styles from the catalog CSS
// (and vice versa) and prevents the page from reaching the panel via
// element.shadowRoot. Populated by ensureHost() in cs_main.js.
// ═══════════════════════════════════════════
let snHost = null;   // <div id="sn-host"> in the page DOM
let snRoot = null;   // ShadowRoot (closed)
function byId(id) { return snRoot ? snRoot.getElementById(id) : null; }

// Centralised, safe URL opener: https-only plus 'noopener' so the opened
// page cannot navigate this tab (reverse tab-nabbing).
function openUrlSafe(url) {
  if (isAllowedOpenUrl(url)) window.open(url, '_blank', 'noopener');
}
