// ═══════════════════════════════════════════
// SUBJECT NAVIGATOR — CONTENT SCRIPT (part 2/8): core: i18n, state, DOM helpers, API bridge
// The eight cs_*.js files are classic scripts executed in order (see
// manifest.json → content_scripts.js) in the same isolated world, so
// top-level declarations from earlier files are visible here.
// ═══════════════════════════════════════════
'use strict';


// ═══════════════════════════════════════════
// CLASSIFICATION VOCABULARIES (BAAM local classification + reduced DDC + Geo)
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════
const I18N = {
  it: { subjects:'Soggetti', navigate:'Naviga', people:'Responsabilità', classification:'Classificazione', classNoData:'Nessuna classe trovata.', classHierarchy:'Gerarchia', classNarrower:'Sottoclassi', classFilterLabel:'Includi nella ricerca:', classAggregatorNote:'⚠ Classe generica: la ricerca esatta potrebbe restituire pochi risultati. Usa la ricerca ampia.',classSearchExact:'Cerca documenti in questa classe', classShowRoot:'Classi principali', classAllClasses:'Tutte le classi', classBaamName:'Classificazione locale BAAM', classSearchBroader:'Cerca questa classe e sottoclassi', search:'Cerca (soggetti)',
    searchBroad:'Cerca (ampia)', searchSuggested:'Ricerca suggerita',
    broader:'Broader (clicca per salire)', narrower:'Specifici (clicca per scendere)', related:'Correlati',
    selected:'Selezionato', loading:'Caricamento', reconciling:'Riconciliazione', fetchingMarc:'Recupero dati MARC\u2026',
    notFound:'Non trovato in Wikidata', sendFeedback:'Invia feedback', aboutSources:'Informazioni e fonti dei dati', about:'Informazioni', theme:'Tema', changeTheme:'Cambia tema', dataSources:'Fonti dei dati', vocabularies:'Vocabolari', privacyNote:'Privacy: nessun dato personale è raccolto; i termini dei record consultati sono inviati alle fonti elencate per l’arricchimento.', noteNS:'Nota d’ambito NS', noteNSDef:'Definizione NS', noteGND:'Definizione GND', noteRAMEAU:'Nota RAMEAU', idrefTypeOther:'Altro', idrefTypes:{ a:'Persona', b:'Ente', s:'Congresso', c:'Luogo', e:'Famiglia', j:'Soggetto RAMEAU', u:'Forma RAMEAU', v:'Genere RAMEAU', h:'Autore-titolo', f:'Serie', x:'Descrittore cronologico RAMEAU' }, fetchError:'Dati non disponibili (errore di rete)', noHierarchy:'Nessuna relazione gerarchica.', noSubjects:'Nessun soggetto trovato.',
    showAll:'Mostra tutti', explore:'\u25B8', andSearch:'Ricerca AND multilingue',
    selectTerms:'Seleziona termini per la ricerca combinata:', buildQuery:'Cerca (soggetti)', buildQueryBroad:'Cerca (ampia)',
    navHint:'Seleziona un termine per navigare:', author:'Autore', editor:'Curatore', contributor:'Contributore', responsibilityPrimary:'Responsabilità principale', responsibilityAdded:'Responsabilità secondaria', kindPerson:'Persona', kindCorporate:'Ente', kindMeeting:'Congresso',
    widen:'Allarga', close:'Chiudi', badge:'soggetti',
    typeTopic:'tema', typePerson:'persona', typePeriod:'periodo', typePlace:'luogo', typeForm:'forma', formsTitle:'Forma/genere del documento',
    suggestedHint:'Tutti i soggetti del record combinati in AND (indice soggetto):',
    modeSubject:'Soggetti', modeAny:'Tutti i campi', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Modalità di ricerca', classModeExact:'Solo questa classe', classModeExactHint:'cerca solo questo numero esatto', classModeBroader:'Questa classe e sottoclassi', classModeBroaderHint:'include tutti i numeri che iniziano con questo prefisso', classSearchPreview:'Anteprima ricerca', classSearchRun:'Cerca', classAuxOnlyWarn:'⚠ Ricerca ampia: risultati da molte classi diverse',
    classTreeExplore:'Esplora albero', classTreeCollapse:'Comprimi',
    netFail:'Non hanno risposto', netFailWhy:'dati forse incompleti, non mancanti: riprovare più tardi.', netFailBox:'{s} non ha risposto: dato non disponibile ora, non mancante.',
    wdRecord:'Corrispondenza Wikidata confermata dal record', wdRecordAuthor:'Opera Wikidata confermata dal suo autore nel record', wdUnverified:'Corrispondenza Wikidata non verificata: trovata solo per nome, nessun identificativo in comune con il record.', wdUnverifiedSearch:'Le ricerche usano soltanto la forma presente nel record.', wdRejected:'Candidato Wikidata scartato', wdRejectedWhy:'nessun ID in comune con il record e forma del nome diversa.',
    idsFromRecord:'Dal record', idsFromWd:'Da Wikidata — ipotesi non confermata',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  de: { subjects:'Themen', navigate:'Navigation', people:'Urheberschaft', classification:'Klassifikation', classNoData:'Keine Klassen gefunden.', classHierarchy:'Hierarchie', classNarrower:'Unterklassen', classFilterLabel:'In der Suche einschließen:', classAggregatorNote:'⚠ Generische Klasse: Die genaue Suche liefert möglicherweise wenige Ergebnisse.',classSearchExact:'Dokumente dieser Klasse suchen', classShowRoot:'Hauptklassen', classAllClasses:'Alle Klassen', classBaamName:'Lokale Klassifikation BAAM', classSearchBroader:'Diese Klasse und Unterklassen suchen', search:'Suche (Schlagwort)',
    searchBroad:'Suche (breit)', searchSuggested:'Vorgeschlagene Suche',
    broader:'Broader (klicken zum Aufsteigen)', narrower:'Spezifisch (klicken zum Absteigen)', related:'Verwandt',
    selected:'Ausgewählt', loading:'Laden', reconciling:'Abgleich', fetchingMarc:'MARC-Daten werden abgerufen\u2026',
    notFound:'In Wikidata nicht gefunden', sendFeedback:'Feedback senden', aboutSources:'Info und Datenquellen', about:'Info', theme:'Design', changeTheme:'Design wechseln', dataSources:'Datenquellen', vocabularies:'Vokabulare', privacyNote:'Datenschutz: Es werden keine personenbezogenen Daten erhoben; die Begriffe der angezeigten Datensätze werden zur Anreicherung an die genannten Quellen gesendet.', noteNS:'Verwendungshinweis NS', noteNSDef:'Definition NS', noteGND:'GND-Definition', noteRAMEAU:'RAMEAU-Anmerkung', idrefTypeOther:'Sonstiges', idrefTypes:{ a:'Person', b:'Körperschaft', s:'Kongress', c:'Ort', e:'Familie', j:'RAMEAU-Schlagwort', u:'RAMEAU-Form', v:'RAMEAU-Gattung', h:'Autor-Titel', f:'Reihe', x:'RAMEAU-Zeitschlagwort' }, fetchError:'Daten nicht verfügbar (Netzwerkfehler)', noHierarchy:'Keine hierarchischen Beziehungen.', noSubjects:'Keine Themen gefunden.',
    showAll:'Alle anzeigen', explore:'\u25B8', andSearch:'Mehrsprachige AND-Suche',
    selectTerms:'Begriffe für kombinierte Suche auswählen:', buildQuery:'Suche (Schlagwort)', buildQueryBroad:'Suche (breit)',
    navHint:'Begriff auswählen:', author:'Autor', editor:'Herausgeber', contributor:'Mitwirkend', responsibilityPrimary:'Hauptverantwortung', responsibilityAdded:'Weitere Verantwortung', kindPerson:'Person', kindCorporate:'Körperschaft', kindMeeting:'Kongress',
    widen:'Verbreitern', close:'Schliessen', badge:'Themen',
    typeTopic:'Thema', typePerson:'Person', typePeriod:'Zeitraum', typePlace:'Ort', typeForm:'Form', formsTitle:'Form/Gattung des Dokuments',
    suggestedHint:'Alle Schlagwörter des Datensatzes als AND-Suche (Schlagwortindex):',
    modeSubject:'Schlagwort', modeAny:'Alle Felder', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Suchmodus', classModeExact:'Nur diese Klasse', classModeExactHint:'nur dieser exakten Nummer suchen', classModeBroader:'Diese Klasse und Unterklassen', classModeBroaderHint:'enthält alle Nummern, die mit diesem Präfix beginnen', classSearchPreview:'Suchvorschau', classSearchRun:'Suchen', classAuxOnlyWarn:'⚠ Breite Suche: Ergebnisse aus vielen Klassen',
    classTreeExplore:'Baum erkunden', classTreeCollapse:'Einklappen',
    netFail:'Keine Antwort von', netFailWhy:'Angaben evtl. unvollständig, nicht fehlend: später erneut versuchen.', netFailBox:'{s} hat nicht geantwortet: Angabe derzeit nicht verfügbar, nicht fehlend.',
    wdRecord:'Wikidata-Zuordnung durch die Aufnahme bestätigt', wdRecordAuthor:'Wikidata-Werk durch seinen Verfasser in der Aufnahme bestätigt', wdUnverified:'Wikidata-Zuordnung nicht verifiziert: nur über den Namen gefunden, keine gemeinsame ID mit der Aufnahme.', wdUnverifiedSearch:'Für die Suche wird nur die Namensform aus der Aufnahme verwendet.', wdRejected:'Wikidata-Kandidat verworfen', wdRejectedWhy:'keine gemeinsame ID und abweichende Namensform.',
    idsFromRecord:'Aus der Aufnahme', idsFromWd:'Aus Wikidata — unbestätigte Hypothese',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  fr: { subjects:'Sujets', navigate:'Naviguer', people:'Responsabilités', classification:'Classification', classNoData:'Aucune classe trouvée.', classHierarchy:'Hiérarchie', classNarrower:'Sous-classes', classFilterLabel:'Inclure dans la recherche:', classAggregatorNote:'⚠ Classe générique: la recherche exacte peut donner peu de résultats.',classSearchExact:'Chercher documents dans cette classe', classShowRoot:'Classes principales', classAllClasses:'Toutes les classes', classBaamName:'Classification locale BAAM', classSearchBroader:'Chercher cette classe et sous-classes', search:'Chercher (sujets)',
    searchBroad:'Chercher (large)', searchSuggested:'Recherche suggérée',
    broader:'Broader (cliquer pour monter)', narrower:'Spécifiques (cliquer pour descendre)', related:'Associés',
    selected:'Sélectionné', loading:'Chargement', reconciling:'Réconciliation', fetchingMarc:'Récupération MARC\u2026',
    notFound:'Introuvable dans Wikidata', sendFeedback:'Envoyer un commentaire', aboutSources:'À propos et sources des données', about:'À propos', theme:'Thème', changeTheme:'Changer de thème', dataSources:'Sources des données', vocabularies:'Vocabulaires', privacyNote:'Confidentialité : aucune donnée personnelle n’est collectée ; les termes des notices consultées sont envoyés aux sources citées pour l’enrichissement.', noteNS:'Note d’application NS', noteNSDef:'Définition NS', noteGND:'Définition GND', noteRAMEAU:'Note RAMEAU', idrefTypeOther:'Autre', idrefTypes:{ a:'Personne', b:'Collectivité', s:'Congrès', c:'Lieu', e:'Famille', j:'Sujet RAMEAU', u:'Forme RAMEAU', v:'Genre RAMEAU', h:'Auteur-titre', f:'Collection', x:'Descripteur chronologique RAMEAU' }, fetchError:'Données indisponibles (erreur réseau)', noHierarchy:'Aucune relation hiérarchique.', noSubjects:'Aucun sujet trouvé.',
    showAll:'Tout afficher', explore:'\u25B8', andSearch:'Recherche AND multilingue',
    selectTerms:'Sélectionner les termes pour la recherche combinée\u00a0:', buildQuery:'Chercher (sujets)', buildQueryBroad:'Chercher (large)',
    navHint:'Sélectionner un terme\u00a0:', author:'Auteur', editor:'Éditeur', contributor:'Contributeur', responsibilityPrimary:'Responsabilité principale', responsibilityAdded:'Responsabilité secondaire', kindPerson:'Personne', kindCorporate:'Collectivité', kindMeeting:'Congrès',
    widen:'Élargir', close:'Fermer', badge:'sujets',
    typeTopic:'sujet', typePerson:'personne', typePeriod:'période', typePlace:'lieu', typeForm:'forme', formsTitle:'Forme/genre du document',
    suggestedHint:'Tous les sujets combinés en AND (index sujets)\u00a0:',
    modeSubject:'Sujets', modeAny:'Tous les champs', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Mode de recherche', classModeExact:'Uniquement cette classe', classModeExactHint:'cherche seulement ce num\u00e9ro exact', classModeBroader:'Cette classe et sous-classes', classModeBroaderHint:'inclut tous les num\u00e9ros commen\u00e7ant par ce pr\u00e9fixe', classSearchPreview:'Aper\u00e7u de la recherche', classSearchRun:'Chercher', classAuxOnlyWarn:'\u26a0 Recherche large : r\u00e9sultats de nombreuses classes diff\u00e9rentes',
    classTreeExplore:'Explorer l\'arbre', classTreeCollapse:'R\u00e9duire',
    netFail:'Sans réponse', netFailWhy:'données peut-être incomplètes, non manquantes\u00a0: réessayer plus tard.', netFailBox:'{s} n\u2019a pas répondu\u00a0: donnée indisponible pour l\u2019instant, non manquante.',
    wdRecord:'Correspondance Wikidata confirmée par la notice', wdRecordAuthor:'Œuvre Wikidata confirmée par son auteur dans la notice', wdUnverified:'Correspondance Wikidata non v\u00e9rifi\u00e9e\u00a0: trouv\u00e9e par le nom seul, aucun identifiant commun avec la notice.', wdUnverifiedSearch:'Les recherches utilisent uniquement la forme présente dans la notice.', wdRejected:'Candidat Wikidata \u00e9cart\u00e9', wdRejectedWhy:'aucun identifiant commun et forme du nom diff\u00e9rente.',
    idsFromRecord:'De la notice', idsFromWd:'De Wikidata \u2014 hypoth\u00e8se non confirm\u00e9e',
    themeLight:'\u2600', themeDark:'\u263E', themeAuto:'\u25D0' },
  en: { subjects:'Subjects', navigate:'Navigate', people:'Responsibilities', classification:'Classification', classNoData:'No classes found.', classHierarchy:'Hierarchy', classNarrower:'Narrower classes', classFilterLabel:'Include in search:', classAggregatorNote:'⚠ Generic class: exact search may return few results. Use broad search.',classSearchExact:'Search documents in this class', classShowRoot:'Main classes', classAllClasses:'All classes', classBaamName:'BAAM local classification', classSearchBroader:'Search this class and subclasses', search:'Search (subject)',
    searchBroad:'Search (broad)', searchSuggested:'Suggested search',
    broader:'Broader (click to go up)', narrower:'Narrower (click to drill down)', related:'Related',
    selected:'Selected', loading:'Loading', reconciling:'Reconciling', fetchingMarc:'Fetching MARC data\u2026',
    notFound:'Not found in Wikidata', sendFeedback:'Send feedback', aboutSources:'About & data sources', about:'About', theme:'Theme', changeTheme:'Change theme', dataSources:'Data sources', vocabularies:'Vocabularies', privacyNote:'Privacy: no personal data is collected; the terms of the records you view are sent to the sources listed, for enrichment.', noteNS:'NS scope note', noteNSDef:'NS definition', noteGND:'GND definition', noteRAMEAU:'RAMEAU note', idrefTypeOther:'Other', idrefTypes:{ a:'Person', b:'Corporate body', s:'Meeting', c:'Place', e:'Family', j:'RAMEAU subject', u:'RAMEAU form', v:'RAMEAU genre', h:'Author-title', f:'Series', x:'RAMEAU chronological descriptor' }, fetchError:'Data unavailable (network error)', noHierarchy:'No hierarchical relationships found.', noSubjects:'No subjects found.',
    showAll:'Show all', explore:'\u25B8', andSearch:'Multilingual AND search',
    selectTerms:'Select terms for combined search:', buildQuery:'Search (subject)', buildQueryBroad:'Search (broad)',
    navHint:'Select a term to navigate:', author:'Author', editor:'Editor', contributor:'Contributor', responsibilityPrimary:'Primary responsibility', responsibilityAdded:'Added responsibility', kindPerson:'Person', kindCorporate:'Corporate body', kindMeeting:'Conference',
    widen:'Widen', close:'Close', badge:'subjects',
    typeTopic:'topic', typePerson:'person', typePeriod:'period', typePlace:'place', typeForm:'form', formsTitle:'Form/genre of the document',
    suggestedHint:'All record subjects combined as AND (subject index):',
    modeSubject:'Subjects', modeAny:'All fields', nsIndex:'NS', nsLoading:'NS...',
    classSearchMode:'Search mode', classModeExact:'Only this class', classModeExactHint:'search only this exact number', classModeBroader:'This class and subclasses', classModeBroaderHint:'includes all numbers starting with this prefix', classSearchPreview:'Search preview', classSearchRun:'Search', classAuxOnlyWarn:'\u26a0 Broad search: results from many different classes',
    classTreeExplore:'Explore tree', classTreeCollapse:'Collapse',
    netFail:'No answer from', netFailWhy:'data may be incomplete, not missing: try again later.', netFailBox:'{s} did not answer: not available now, not missing.',
    wdRecord:'Wikidata match confirmed by the record', wdRecordAuthor:'Wikidata work confirmed by its author in the record', wdUnverified:'Wikidata match unverified: found by name only, no identifier shared with the record.', wdUnverifiedSearch:'Searches use only the name form found in the record.', wdRejected:'Wikidata candidate discarded', wdRejectedWhy:'no shared identifier and a different name form.',
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
let searchCtx = { ...DEFAULT_SEARCH_CTX };   // the catalogue's own (cs_site.js), set per record
let themeMode = 'auto';

// ═══════════════════════════════════════════
// CLASSIFICATION VOCABULARIES — loaded from separate packaged JSON files
// ═══════════════════════════════════════════
let VOCAB_BAAM = {}, VOCAB_CDD = {}, VOCAB_GEO = {}, VOCAB_RELATORS = {}, VOCAB_FORMS = [];
let _vocabReady = false;
const _vocabCallbacks = [];

function onVocabReady(fn) {
  if (_vocabReady) fn();
  else _vocabCallbacks.push(fn);
}

// The vocabularies and the stylesheet come from the
// service worker (bgResource) instead of web-accessible files, which any
// page of the catalog could probe to learn that the extension is installed.
(async function loadVocabs() {
  try {
    const [baam, cdd, geo, relators, forms] = await Promise.all([
      bgResource('vocab_baam.json').then(JSON.parse),
      bgResource('vocab_cdd.json').then(JSON.parse),
      bgResource('vocab_geo.json').then(JSON.parse),
      bgResource('vocab_relators.json').then(JSON.parse),
      bgResource('vocab_forms.json').then(JSON.parse).catch(() => ({ forms: [] })),
    ]);
    VOCAB_BAAM = baam; VOCAB_CDD = cdd; VOCAB_GEO = geo;
    VOCAB_RELATORS = relators.relators || {};
    VOCAB_FORMS = forms.forms || [];
    _vocabReady = true;
    _vocabCallbacks.forEach(fn => fn());
  } catch(e) { console.error('BAAM/CDD: vocabulary load error', e); }
})();

function normaliseRelatorCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const uriCode = raw.match(/(?:relators\/|relator:)([a-z]{3})\/?$/i);
  if (uriCode) return uriCode[1].toLowerCase();
  return /^[a-z]{3}$/i.test(raw) ? raw.toLowerCase() : null;
}

function describeRelator(relator) {
  const raw = String(relator?.value || '').trim();
  const code = normaliseRelatorCode(raw);
  const entry = code ? VOCAB_RELATORS[code] : null;
  const lang = getInterfaceLang();
  const label = entry?.labels?.[lang] || entry?.label || raw;
  return { code, label, uri: entry?.uri || null, raw, source: relator?.source || null };
}

function responsibilityLabel(nameEntry) {
  const seen = new Set();
  const labels = [];
  for (const relator of (nameEntry.relators || [])) {
    const described = describeRelator(relator);
    const key = (described.code || described.label).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(described.label + (described.code ? ' [' + described.code + ']' : ''));
  }
  if (labels.length) return labels.join('; ');
  return ['100', '110', '111'].includes(nameEntry.tag)
    ? L.responsibilityPrimary
    : L.responsibilityAdded;
}

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
      // Only https links, like openUrlSafe — a link can
      // never carry another scheme (javascript:, data:), whatever builds it.
      else if (k === 'href') { if (isAllowedOpenUrl(v)) e.href = v; }
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
// Reconciliation lives in the worker, so there are no per-API bridges
// here (sparql / fetchJSON / lobid / idref / …). Only the MARC fetch
// remains here; the reconcile/hierarchy wrappers live in
// cs_reconcile.js and the four-message protocol is documented in
// background.js.
function bgFetchMarc(o) { return bgMsg({ type: 'fetchMarc', ...o }); }
// A packaged file (vocabulary or stylesheet), as text, from the worker.
function bgResource(name) {
  return bgMsg({ type: 'resource', name }).then(t => {
    if (typeof t !== 'string') throw new Error('resource unavailable: ' + name);
    return t;
  });
}
// Testing: timing marks for the worker's timing log (bg_util.js; off in
// a release). Fire-and-forget; never blocks the panel.
let snRecordT0 = 0, snRecordId = '';
function snTiming(mark, data) {
  try {
    chrome.runtime.sendMessage({ type: 'timing', ev: { mark, rec: snRecordId, ...data } },
      () => void chrome.runtime.lastError);
  } catch (e) { /* worker unavailable: timing is best effort */ }
}

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
