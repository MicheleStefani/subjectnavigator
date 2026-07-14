# Subject Navigator for swisscovery — v1.1.1

A Chrome extension (Manifest V3) for multilingual, hierarchical navigation of
controlled subject headings — Nuovo Soggettario (BNCF), SBT, GND, RAMEAU/IdRef,
LCSH, BNE — and of classification schemes (a local UDC profile and the reduced
DDC "23sdnb") on the swisscovery/SLSP and reperio library catalogs. Built with
particular attention to the Accademia di Architettura in Mendrisio, which is
why Italian and the Nuovo Soggettario are treated as first-class citizens.

Reading the bibliographic record on screen, the extension shows the record's
subjects in a side panel, reconciles them across vocabularies, reconstructs
their broader/narrower/related hierarchies, explains classification numbers,
and builds multilingual catalog searches (single-term, combined AND, by
class, by person).

## Install (development)

1. `chrome://extensions` → enable "Developer mode"
2. "Load unpacked" → select this folder

## Architecture

```
┌────────────────────────── catalog page (Primo SPA) ─────────────────────────┐
│  content scripts (isolated world, 7 classic scripts loaded in order)        │
│  cs_core → cs_index → cs_marc → cs_class → cs_reconcile → cs_render →       │
│  cs_main                                                                    │
│      UI lives in <div id="sn-host"> + a *closed* Shadow DOM                 │
│      (CSS injected inside the shadow root: two-way style isolation)         │
└──────────┬───────────────────────────────────────────────────────────────────┘
           │ chrome.runtime messages — 4 typed requests, no URL-shaped input:
           │   warmIndex · reconcile · hierarchy · fetchMarc
┌──────────▼──────────── background service worker (ES modules) ──────────────┐
│  background.js     message router + tab lifecycle                           │
│  bg_util.js        constants, LRU caches, small helpers                     │
│  bg_net.js         the ONLY module that touches the network:                │
│                    host/endpoint whitelists, 6 s timeout, 5 MB byte cap,    │
│                    ID re-validation                                         │
│  bg_index.js       packaged unified index (~35 MB JSON) — ONE parsed copy   │
│                    shared by all tabs                                       │
│  bg_reconcile.js   reconcile() + getHierarchy() engine                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Principles

- **Local-first.** The unified index (`unified_index_core.json`) and the
  label/hierarchy files are precomputed by the `unified_auth_index/` pipeline
  and packaged with the extension. Reconciliation across
  NS↔GND↔RAMEAU↔LCSH↔BNE↔Wikidata and BT/NT/RT hierarchies are instant local
  lookups; external APIs only fill the gaps.
- **One copy of the data.** Since v1.1.0 the index lives in the service
  worker: N open tabs share a single parsed copy instead of parsing ~35 MB
  each. MV3 kills an idle worker after ~30 s; the index reloads lazily
  (~200–500 ms) and the content script warms it up as soon as a record page
  opens, overlapping with the MARC fetch.
- **Minimal message surface.** The content script cannot ask the worker to
  fetch arbitrary URLs — the generic fetch bridge of v1.0.x is gone. Four
  typed messages only; every parameter is re-validated worker-side even when
  the content script already validated it (defence in depth: the content
  script is the most exposed surface).
- **No `innerHTML`, ever.** All DOM is built via `el()`/`textContent`; remote
  data (MARC, Wikidata, lobid, IdRef…) is never interpreted as markup.
- **Least privilege.** Permissions: `storage` (theme/debug flag) and
  `scripting` (only for the one-shot fallback injection into tabs opened
  before install). No `tabs`, no `activeTab`. URL opening goes through
  `openUrlSafe()` (https-only + `noopener`).
- **Content is data, not code.** UDC macro groups with quadrilingual labels
  live in `vocab_cdu.json` (`_macros` key), not in the source.

### Files

| File | Role |
|---|---|
| `manifest.json` | MV3, static content scripts, module worker, minimal permissions |
| `background.js` | worker entry: message router, tab lifecycle |
| `bg_util.js` | shared constants, LRU cache, helpers |
| `bg_net.js` | network layer: whitelists, caps, parsers, authority APIs |
| `bg_index.js` | unified index loading + synchronous lookups |
| `bg_reconcile.js` | reconciliation + hierarchy engine |
| `cs_core.js` | i18n, state, DOM helpers, shadow host, message bridge |
| `cs_index.js` | index status, per-record cache mirrors, URL/name helpers |
| `cs_marc.js` | MARC field extraction (6xx, 1xx/7xx, 082/691) |
| `cs_class.js` | UDC/DDC: number parsing, cards, tree explorer, search |
| `cs_reconcile.js` | worker bridge wrappers, search-URL builders |
| `cs_render.js` | panel rendering, navigation, AND builder, event delegation |
| `cs_main.js` | lifecycle: shadow host, `loadRecord`, SPA handling |
| `sidebar.css` | styles, injected inside the shadow root |
| `tests/run_tests.js` | smoke + unit + offline end-to-end — `node tests/run_tests.js` |

The seven `cs_*.js` files are classic scripts executed in order in the same
isolated world (Chrome does not support ES modules in content scripts without
dynamic-import tricks). The worker modules are written in a deliberately
strip-friendly style — single-line imports, `export` only as a declaration
prefix — so the test harness can load them without a bundler.

### Data

Produced by `../unified_auth_index/build_index.py` (v3.2), which copies its
output here and aborts on sanity-threshold violations. `vocab_cdu.json`,
`vocab_cdd.json` and `vocab_geo.json` are hand-curated. Sources: BNCF (NS),
DNB (GND, CC0), BnF/ABES (RAMEAU/IdRef, Licence Ouverte), Library of Congress
(LCSH), BNE, Wikidata (CC0).

## Tests

```
node tests/run_tests.js          # extension suite
python tests/test_parsers.py     # pipeline (run from unified_auth_index/)
```

The extension suite loads all modules in `vm` sandboxes (content + worker),
runs the pure-function unit tests, and drives reconcile()/getHierarchy()
end-to-end against a fixture index with the network stubbed out.

## Roadmap

- ES modules + a real bundler (esbuild) once a build step becomes acceptable;
  the current file split is the bridge to that.
- Wider golden fixtures for the pipeline (full mini-dumps with expected
  cluster output).
- See the extra design notes in the repository discussion for a standalone
  subject/class exploration app built on the same unified index.

## Privacy & license

MIT. No personal data is collected; subject terms and authority IDs from the
record being viewed are sent to the public authority APIs listed above for
enrichment. See [PRIVACY.md](PRIVACY.md) (English + Italian).
