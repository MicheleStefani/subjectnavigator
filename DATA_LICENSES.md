# Data sources and licences

The code of Subject Navigator is under the MIT licence (see `LICENSE`).
The data it shows is not: it comes from the authority files below, each
under its own licence. This file lists them and gives the attribution they
ask for.

## 1. Datasets used to build the authority index

The index files shipped in each release zip (`unified_index_core.json`,
`labels_*.json`, `hierarchy_gnd.json`, `notes_*.json`, `rameau_idref.json`,
`exact_links.json`) are built by `authority-index/build_index.py` from the
public dumps below. They contain labels, hierarchical relations, notes and
mappings **extracted, selected and restructured** from these datasets
(changes were made: the index is not a copy of any of them). How to rebuild the
index from new dumps: see `REBUILD.md`.

| Dataset | Publisher | Licence | Attribution |
|---|---|---|---|
| Nuovo soggettario (thesaurus, SKOS) | Biblioteca Nazionale Centrale di Firenze | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | «Nuovo soggettario, Biblioteca Nazionale Centrale di Firenze, CC BY 4.0» — [data page](https://thes.bncf.firenze.sbn.it/thes-dati_eng.htm) |
| GND subject headings (Sachbegriffe) | Deutsche Nationalbibliothek | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | none required; credited as «GND, Deutsche Nationalbibliothek» |
| GND mapping to LCSH and RAMEAU | Deutsche Nationalbibliothek | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | as set out by the DNB for [LCSH](https://wiki.dnb.de/x/Mwy6Dw) and [RAMEAU](https://wiki.dnb.de/x/NAy6Dw) |
| GND mapping to the Nuovo soggettario | Deutsche Nationalbibliothek | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | as set out by the DNB [here](https://wiki.dnb.de/x/OQy6Dw) |
| RAMEAU (data.bnf.fr dump) | Bibliothèque nationale de France | [Licence Ouverte / Open Licence 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) | «Source: Bibliothèque nationale de France, data.bnf.fr» |
| Library of Congress Subject Headings | Library of Congress | public domain («made available as a public domain data set», [id.loc.gov](https://id.loc.gov/about/)) | none required; credited as «LCSH, Library of Congress» |
| Catálogo de autoridades: Materia, Género/Forma | Biblioteca Nacional de España | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) («Creative Commons CCZero» on the dataset pages of [datosabiertos.bne.es](https://datosabiertos.bne.es/catalogo/dataset/catalogo-de-autoridades-materia1)) | none required; credited as «Biblioteca Nacional de España» |
| Wikidata (identifiers added to the index) | Wikimedia Foundation and contributors | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | none required |

Licence information of the dumps: [DNB open data](https://data.dnb.de/opendata/),
[BnF dumps](https://api.bnf.fr/fr/dumps-de-databnffr),
[BNCF thesaurus data](https://thes.bncf.firenze.sbn.it/thes-dati_eng.htm),
[id.loc.gov](https://id.loc.gov/about/).

## 2. Services queried while you browse

On a record page the extension also reads data live from these services
(what is sent to them: see `PRIVACY.md`).

| Service | Data | Licence |
|---|---|---|
| Wikidata (query.wikidata.org, QLever) | items, labels, hierarchies | CC0 1.0 |
| lobid GND (hbz) | GND records | CC0 1.0 (GND data) |
| IdRef (ABES) | IdRef / RAMEAU records | Licence Ouverte 2.0 |
| data.bnf.fr | RAMEAU records | Licence Ouverte 2.0 |
| id.loc.gov | LCSH records | public domain |
| datos.bne.es | BNE records | see above |
| Getty Vocabularies (vocab.getty.edu) | Art & Architecture Thesaurus (AAT) | [ODC-By 1.0](https://opendatacommons.org/licenses/by/1-0/) — «Art & Architecture Thesaurus® (AAT), J. Paul Getty Trust» |

The panel credits these sources in its «Data sources» box (ⓘ button).
