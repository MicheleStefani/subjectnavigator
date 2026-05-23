# Subject Navigator for reperio/swisscovery and index_builder

A browser extension for multilingual subject navigation across three controlled vocabularies (GND, IdRef, SBT) in the SLSP Swiss library network.
Built for Architecture's Academy Library catalogue (USI - Università della Svizzera Italiana). 
[It works just with [USI](https://reperio.usi.ch) and [SLSP](https://swisscovery.ch) addresses]  

---

## What it does

Library subject indexing is invisible to most users. Catalogers invest significant effort in assigning controlled terms — but from the user's perspective, subjects are opaque strings with no apparent structure or relationships. In a multilingual consortial catalog like [swisscovery](https://swisscovery.ch), the problem compounds: records may be indexed in Italian (using the *Nuovo Soggettario*, NS), German (using the *Gemeinsame Normdatei*, GND), or French (using *RAMEAU/IdRef*), each with different intellectual structures, string formats, and authority files.

**Subject Navigator** surfaces that invisible work. It reads the MARC21 record of any document in the catalog and presents a structured sidebar with four sections:

| Tab | Contents |
|---|---|
| **Subjects** | Subject strings or terms broken into components, with definitions, scope notes, DDC correspondence, and multilingual equivalents (IT / DE / FR / EN / ES) |
| **Navigate** | Hierarchical navigation of the subject terms across all three thesauri simultaneously — broader, narrower, and related terms, with cross-vocabulary equivalences where they exist |
| **Responsibilities** | Names linked to the record (authors, editors, contributors) enriched with authority identifiers (VIAF, ISNI, ORCID, GND, IdRef, SBN, Wikidata) |
| **Classification** | Local UDC and Dewey Decimal classifications with hierarchy navigation and direct catalog search |

The extension does not modify the catalog interface. It adds a collapsible sidebar that works alongside the existing discovery layer.

---

## Context

**Biblioteca dell'Accademia di architettura di Mendrisio (BAAM)** is a member of [SLSP](https://slsp.ch) — the Swiss Library Service Platform, a consortium of over 500 academic libraries sharing the same ExLibris Alma/Primo Network Zone. The catalog is genuinely multilingual: German-speaking institutions catalog in GND, French-speaking institutions use RAMEAU/IdRef, and Italian-speaking institutions (including BAAM) use the *Soggettario del Sistema Bibliotecario Ticinese* (SBT) which is mainly based on the *Nuovo Soggettario* (NS) maintained by the Biblioteca Nazionale Centrale di Firenze.

This extension was built to solve a concrete problem: BAAM's users navigate a catalog where the same intellectual concept may be indexed in just one of the three possible languages and as a pre-coordinated Italian subject string, or some post-coordinate German/French terms — with no visible connection between them. The extension makes those connections explicit.

---

## Architecture

### Chrome Extension (MV3)

```
subject-navigator-v1.0.0/
├── manifest.json          # MV3, host_permissions scoped to catalog domains
├── background.js          # Service worker: MARC/SRU fetching, external API proxy
├── content.js             # Main logic: MARC parsing, index lookup, UI rendering
├── sidebar.css            # Sidebar UI (dark/light theme, 4 languages)
├── unified_index_core.json  # Pre-built reconciliation index (~12 MB)
├── labels_de.json           # GND German labels (full)
├── labels_fr.json           # BnF/RAMEAU French labels (full)
├── labels_en_slim.json      # LCSH English labels (subset present in clusters)
├── labels_es_slim.json      # BNE Spanish labels (subset present in clusters)
├── hierarchy_gnd.json       # GND broader/narrower hierarchy (~5 MB)
├── hierarchy_bnf.json       # BnF/RAMEAU broader/narrower hierarchy (~9 MB)
└── vocab_cdu/cdd/geo.json   # Local classification vocabularies
```

The extension intercepts navigation events on catalog pages, fetches the full MARC record via SRU, extracts subject fields (`650`, `651`, `648`, `600`, `610`, `611`) filtered by `$2` value (`sbt12`, `gnd`, `idref`), and resolves them against the pre-built index. External API calls (Wikidata, Lobid, IdRef, Getty AAT) are used only for data not present in the local index — primarily people and place authorities, and live Wikidata enrichment.

All index data is cached in IndexedDB on first load. Subsequent navigation is local-first.

### Index Builder

```
unified_auth_index/
├── build_index.py     # Full build pipeline
└── data/
    ├── ns_skos.ttl                     # Nuovo Soggettario (BNCF, SKOS-RDF)
    ├── authorities-gnd-sachbegriff_lds.ttl.gz  # GND Sachbegriffe dump (DNB)
    ├── databnf_rameau_nt.tar.gz        # RAMEAU (BnF, N-Triples)
    ├── subjects.skosrdf.ttl            # LCSH (Library of Congress, SKOS-RDF)
    ├── materias.nt                     # BNE (Biblioteca Nacional de España)
    ├── mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz  # DNB cross-authority mappings with LCSH and RAMEAU
    ├── mapping-authorities-gnd-nsogg_lds.jsonld.gz  # DNB cross-authority mappings with NS
    └── SBT-THESAURUS-csv.csv           # SBT local thesaurus (local additions to NS, not provided)
```

The build pipeline parses all source files and produces a single reconciliation index through a four-pass clustering algorithm (see [Architecture notes](#architecture-notes) below). Build time is a few minutes on a standard laptop; updates are expected 1–2 times per year as source authority files are refreshed.

---

## The Reconciliation Index

### Cluster structure

Each concept in the index is NS-centric: the *Nuovo Soggettario* term is the hub, and the cluster aggregates equivalent terms from GND, RAMEAU/IdRef, LCSH, BNE, and Wikidata where explicit mappings exist (via SKOS `exactMatch`/`closeMatch` in the source files, enriched by DNB cross-authority mappings and Wikidata).

```json
{
  "1076": {
    "l": "Architettura",
    "df": "disciplina che ha come scopo la progettazione...",
    "sn": "L'arte di formare, attraverso mezzi tecnico-costruttivi...",
    "d":  "720",
    "bt": ["37"],
    "nt": ["1077", "1078", ...],
    "cl": {
      "gnd":  {"id": "4002851-3", "c": 2},
      "bnf":  {"id": "cb11931745s", "c": 2},
      "lcsh": {"id": "sh85006611", "c": 1},
      "bne":  {"id": "XX4576290", "c": 0},
      "wd":   {"id": "Q12271", "c": 0},
      "_g": 2
    }
  }
}
```

The `"c"` field is a per-pair confidence score; `"_g"` is the overall cluster grade (1–4), computed from the bidirectionality of SKOS match declarations across all three main thesauri.

### Confidence grading

| Grade | Meaning |
|---|---|
| 1 | Maximum: NS↔GND and NS↔BnF both bidirectional, GND↔BnF bidirectional |
| 2 | High: two sides bidirectional, or three sides unidirectional |
| 3 | Medium: some cross-thesaurus connection exists |
| 4 | Low: connection via Wikidata or AAT only; single direction |

Grades are shown in the UI so users can assess the reliability of the cross-vocabulary mapping.

### What the index cannot do

The index makes coexistence possible, not unification. NS uses pre-coordinated subject strings (`Architettura — Spagna — Sec. 20`); GND and RAMEAU use single post-coordinated terms. The extension decomposes NS strings into their components and matches each individually — but the intellectual combination represented by a pre-coordinated string is not equivalent to the same terms combined in a post-coordinated search. This distinction is preserved, not obscured.

---

## Installation (development)

1. Clone this repository
2. Download the source authority dumps (see [Data sources](#data-sources)) and place them in `unified_auth_index/data/`
3. Build the index: `python unified_auth_index/build_index.py`
4. Open Chrome → `chrome://extensions` → Enable Developer mode → Load unpacked → select `subject-navigator-v1.0.0/`

The source dumps (~1.4 GB compressed) are not included in the repository due to size. The pre-built JSON index files are included as release assets.

---

## Data sources

| Source | Publisher | License | URL |
|---|---|---|---|
| Nuovo Soggettario (SKOS) | BNCF | CC BY | https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All |
| GND Sachbegriffe | Deutsche Nationalbibliothek | CC0 | https://data.dnb.de/opendata/authorities-gnd-sachbegriff_lds.ttl.gz |
| RAMEAU (N-Triples) | Bibliothèque nationale de France | Licence Ouverte 2.0 | https://transfert.bnf.fr/link/7da54f6e-34e0-48c5-b7c3-f3912cdcf355 |
| LCSH (SKOS-RDF) | Library of Congress | Public domain | https://id.loc.gov/download/authorities/subjects.skosrdf.ttl.gz |
| BNE Materias | Biblioteca Nacional de España | CC BY |  https://datos.bne.es/datadumps/materias.nt.bz2 |
| DNB cross-authority mappings (LCSH/RAMEAU) | Deutsche Nationalbibliothek | CC0 | https://data.dnb.de/opendata/mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz |
| DNB cross-authority mappings (NS) | Deutsche Nationalbibliothek | CC0 | https://data.dnb.de/opendata/mapping-authorities-gnd-nsogg_lds.jsonld.gz |

Runtime lookups use public APIs: [Wikidata](https://www.wikidata.org), [Lobid/GND](https://lobid.org/gnd), [IdRef](https://www.idref.fr), [Getty AAT](https://vocab.getty.edu), [BnF](https://data.bnf.fr), [Library of Congress](https://id.loc.gov), [BNE](https://datos.bne.es).

---

## Architecture notes

### Why NS-centric?

BAAM is an Italian-speaking library that catalogs according to Italian rules using NS. The extension is designed to help BAAM users navigate a catalog that also contains GND and RAMEAU records — not to serve all three communities equally. NS is the reference point from which cross-vocabulary equivalences are navigated; GND and RAMEAU terms anchor to NS clusters where matches exist, and stand independently where they do not.

This is a deliberate institutional choice, not a technical limitation.

### Why a local index rather than live SPARQL?

The NS SPARQL endpoint, Lobid, and IdRef APIs are all public and well-maintained. A fully live architecture was considered and rejected for two reasons: latency (a record with 15 subject terms would require 15+ sequential API calls on every page load) and offline resilience (the extension should work even when external endpoints are slow or unavailable). The pre-built index trades data freshness (rebuilt 1–2 times per year) for performance and reliability.

### The SBT local thesaurus

SBT (*[Soggettario del Sistema Bibliotecario Ticinese](https://www2.sbt.ti.ch/soggettario/)*, not provided) contains several hundred terms added locally beyond the standard NS. These terms are not in the NS SKOS file and are handled separately, with their own identifiers and links. Where a WD equivalence is declared in the SBT data, SBT terms are linked to the nearest NS cluster.

---

## Known limitations

- The extension works only with *.swisscovery.ch, reperio.usi.ch, and explore.lib.unige.ch (ExLibris Primo instances serving SLSP catalogs). Adapting it to other Primo instances requires adding domains to `manifest.json`.
- Cross-vocabulary hierarchical navigation is only as complete as the SKOS match declarations in the source files. Many genuine conceptual equivalences are not declared, and the extension does not infer them.
- The slim EN and ES label files cover only terms present in NS clusters (or reachable via GND↔LCSH mappings). Records indexed exclusively in GND or RAMEAU, with no NS correspondence, will not have EN/ES labels.
- Confidence grade 4 (Wikidata/AAT only) should be treated with caution: Wikidata may link concepts at a different level of granularity than the authority files.

---

## License

Code: MIT

Index data is derived from sources with their own licenses (see [Data sources](#data-sources)). All source authority files are open data. The derived index inherits the most restrictive applicable license among its sources (CC BY).

## Development notes

The domain knowledge, institutional context, architectural decisions, and overall direction of this project are entirely the author's. The reconciliation logic, the four-pass clustering algorithm, the confidence grading model, and the extension's interaction design were conceived and validated by the author through direct engagement with the source authority files and the catalog.

The technical implementation — writing and debugging the Python build pipeline, the JavaScript content script, and the CSS — was carried out with [Claude](https://claude.ai) (Anthropic) as a coding assistant, working under continuous review and correction. All generated code was verified against real data and iteratively refined; nothing was adopted without understanding and deliberate choice.
