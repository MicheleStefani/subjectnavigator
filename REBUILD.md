# Rebuilding the authority index

The extension reads its subject headings, translations and hierarchies from
a local index (the `*.json` files next to `manifest.json`). The release zip
ships a ready-made index; this page explains how to build a new one from
fresh dumps of the authority files, for example after a new edition of
RAMEAU or LCSH.

Everything below is run from the repository root.

## 1. Requirements

- Python 3.11 or later, and the `requests` package:

  ```
  python -m pip install -r authority-index/requirements.txt
  ```

  Without `requests` the Wikidata step is skipped and the index differs.
- Node.js, only to run the extension tests.
- 15–20 minutes for a full build; the Wikidata step needs a network
  connection (its queries are sent in small batches, with pauses).

## 2. Download the dumps

The generator does **not** download anything: get the files by hand and put
them, with exactly these names, in `authority-index/data/` (or in another
folder named by the `SN_DATA_DIR` environment variable).

| File name | Dataset | Where |
|---|---|---|
| `ns_skos.ttl` | Nuovo soggettario, SKOS in Turtle | export of the BNCF repository: `https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All` (see also the [thesaurus data page](https://thes.bncf.firenze.sbn.it/thes-dati_eng.htm)) |
| `authorities-gnd-sachbegriff_lds.ttl.gz` | GND subject headings | [data.dnb.de/opendata](https://data.dnb.de/opendata/) |
| `mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz` | GND ↔ LCSH ↔ RAMEAU mapping | [data.dnb.de/opendata](https://data.dnb.de/opendata/) |
| `mapping-authorities-gnd-nsogg_lds.jsonld.gz` | GND ↔ Nuovo soggettario mapping | [data.dnb.de/opendata](https://data.dnb.de/opendata/) |
| `databnf_rameau_nt.tar.gz` | RAMEAU, N-Triples | [data.bnf.fr dumps](https://api.bnf.fr/fr/dumps-de-databnffr) — the download link changes with every edition |
| `subjects.skosrdf.ttl` | LCSH, SKOS in Turtle | [id.loc.gov/download](https://id.loc.gov/download/) (`subjects.skosrdf.ttl.gz`, to be decompressed) |
| `materia-MARCXML.xml`, `generoforma-MARCXML.xml` | BNE authorities «Materia» and «Género/Forma», MARCXML | [datosabiertos.bne.es](https://datosabiertos.bne.es/) — the site asks for a browser check, so a script cannot download them |

The licences of these datasets are listed in `DATA_LICENSES.md`.

## 3. Check and build

```
python authority-index/build_index.py --check
```

lists the files found (with their checksums, compared with the previous
build) and the dates of the remote dumps, and says whether a rebuild is
needed. Then:

```
python authority-index/build_index.py
```

The new index is written to `authority-index/output/` and copied next to
`manifest.json`, replacing the installed one (`--skip-copy` to keep the
installed one). On Windows, when the output is redirected to a file, set
`PYTHONIOENCODING=utf-8` first.

Other options: `--no-wikidata` (no Wikidata step), `--slim-only` (rebuild
only the English and Spanish labels), `--help` for the full list. The
environment variables `SN_DATA_DIR`, `SN_OUTPUT_DIR` and `SN_EXTENSION_DIR`
change the folders used.

The build is deterministic: the same dumps give the same files, byte for
byte. A build that suddenly loses a large share of a vocabulary stops with
an error (sanity thresholds): usually a sign that the format of a dump has
changed.

## 4. Check the new index

Keep the previous output folder (rename `authority-index/output` to, say,
`authority-index/output-old` before building), then:

```
python scripts/check_no_loss.py authority-index/output-old authority-index/output
python scripts/compare_builds.py authority-index/output-old authority-index/output
```

`check_no_loss.py` fails if an identifier, a label or a mapping of the old
index is missing from the new one; `compare_builds.py` summarises what
changed. Then run the tests:

```
node tests/run_tests.js
python authority-index/tests/test_parsers.py
```

and reload the extension in Chrome (`chrome://extensions`, ⟳ on Subject
Navigator) to try it on a few records.

## 5. Make a release zip

```
python scripts/make_release.py
```

writes `release/subject-navigator-<version>.zip` (version from
`manifest.json`): the extension with its index, ready to load in Chrome.
`--list` shows what goes in without writing anything.

## 6. For other catalogues

`scripts/audit_marc_fields.js` runs the extension's own MARC reading over a
MARCXML dump of a catalogue and lists the fields and subfields it never
reads:

```
node scripts/audit_marc_fields.js catalogue.xml --out report.md
```
