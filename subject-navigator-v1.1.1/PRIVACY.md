# Privacy — Subject Navigator for swisscovery

*Versione 1.1.0 — luglio 2026 / Version 1.1.0 — July 2026*

## Italiano

**Che cosa raccoglie l'estensione: nulla.** Subject Navigator non raccoglie,
memorizza né trasmette dati personali. Non esistono account, analytics,
telemetria o identificatori; l'unico dato salvato localmente
(`chrome.storage.local`) è la preferenza di tema (chiaro/scuro/auto) e
l'eventuale flag di debug.

**Che cosa viene inviato a terzi e perché.** Per arricchire i soggetti del
record bibliografico visualizzato, l'estensione interroga API pubbliche di
autorità bibliografiche: SRU swisscovery/SLSP (record MARC), Wikidata, lobid
(DNB), IdRef (ABES), data.bnf.fr, id.loc.gov (Library of Congress),
datos.bne.es, thesaurus BNCF e Getty AAT. Le richieste contengono
esclusivamente **termini di soggetto e identificatori di autorità** (es.
"Architettura", GND `4002851-3`) estratti dal record che si sta consultando —
mai dati sull'utente. Da queste richieste i gestori dei servizi vedono, come
per qualunque richiesta web, il vostro indirizzo IP.

**Dove gira il codice.** Solo sui cataloghi elencati nel manifest
(swisscovery/SLSP, reperio.usi.ch, explore.lib.unige.ch) e solo sulle pagine
di dettaglio dei record.

## English

**What the extension collects: nothing.** Subject Navigator does not collect,
store or transmit personal data. There are no accounts, analytics, telemetry
or identifiers; the only locally stored data (`chrome.storage.local`) is the
theme preference and an optional debug flag.

**What is sent to third parties and why.** To enrich the subjects of the
bibliographic record being viewed, the extension queries public authority
APIs: swisscovery/SLSP SRU (MARC records), Wikidata, lobid (DNB), IdRef
(ABES), data.bnf.fr, id.loc.gov, datos.bne.es, the BNCF thesaurus and Getty
AAT. Requests contain **only subject terms and authority identifiers**
extracted from the record on screen — never data about the user. As with any
web request, the service operators see your IP address.

**Where the code runs.** Only on the catalogs listed in the manifest and only
on record detail pages.
