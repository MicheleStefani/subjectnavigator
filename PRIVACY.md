# Privacy — Subject Navigator

*Last updated: October 2026*

**What the extension collects: nothing.** Subject Navigator does not collect,
store or transmit personal data. There are no accounts, analytics, telemetry
or identifiers; the only locally stored data (`chrome.storage.local`) is the
theme preference and an optional debug flag.

**What is sent to third parties and why.** To enrich the subjects of the
bibliographic record being viewed, the extension queries public authority
APIs: swisscovery/SLSP SRU (MARC records), Wikidata (also through QLever, the
public endpoint of the University of Freiburg), lobid (DNB), IdRef
(ABES), data.bnf.fr, id.loc.gov, datos.bne.es, the BNCF thesaurus and Getty
AAT. Requests contain **only subject terms and authority identifiers**
extracted from the record on screen — never data about the user. As with any
web request, the service operators see your IP address (QLever states that
logs with IP addresses are deleted after a week). Requests to Wikidata carry
the extension's name and project page (`Api-User-Agent` header), as Wikimedia
asks of software clients.

**Where the code runs.** Only on the catalogs listed in the manifest. The code
is loaded on the pages of these catalogs, but it acts — and queries the external
services — only on record detail pages.

**Feedback form.** The ✉ button in the panel opens a Microsoft Forms form in a
new tab. The extension passes nothing to it: only what you type in the form
is sent, and Microsoft handles it under its own privacy statement.
