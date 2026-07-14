# Changelog

## 1.1.1 — 2026-07-09 

### Wrong-person guard for the WD text fallback (B1 + A1 + A2 + C1)

- **B1 — validation gate on text-found candidates.** `wbsearchentities`
  matches fuzzily and the first hit was adopted blindly: "Bär, Oskar"
  (IdRef 200738925) matched *Oskar Barnack* (Q61109) and dragged all of
  Barnack's IDs into the panel. A person found by name alone is now
  corroborated before adoption: `confirmed` when the entity shares an
  authority ID with the record; **discarded** when the family name
  (diacritics-folded, checked against all labels and aliases in five
  languages) appears nowhere among the entity's names; `unverified`
  otherwise. An ID *difference* alone never rejects — authorities
  legitimately hold several PPNs for one concept.
- **A1 — match verdict surfaced in the panel.** A discarded candidate is
  explained («Oskar Barnack» (Q61109) — no shared ID, different name form);
  an unconfirmed text match gets a warning banner. New i18n strings in
  it/de/fr/en; route tag `WD-text✗` marks the discard.
- **C1 — co-references mined from the IdRef record.** Person records often
  carry VIAF (035), ISNI (010) and BnF ark (033) even when Wikidata lacks
  the PPN backlink: they are now extracted from the already-downloaded
  IdRef JSON and tried as `P214`/`P213`/`P268` backlinks (ISNI normalised
  to WD's spaced format) before any text search — deterministic anchoring
  for persons reachable via VIAF/ISNI.
- **A2 — provenance-grouped ID badges.** For unconfirmed matches the badge
  row splits into "From the record" (NS/SBT + the MARC authority ids) and a
  dashed "From Wikidata — unconfirmed hypothesis" group, so it is always
  clear which identifiers stand on the text guess.
- **Route now records mined co-references** (e.g. `coref:VIAF+ISNI`) even
  when Wikidata has no matching item, so a fruitless backlink attempt is
  distinguishable from a skipped one (verified live on IdRef 200738925:
  VIAF/ISNI mined correctly, no WD item exists → clean discard).
- `wbgetentities` now also requests `aliases` (needed by the name check).

### Backlink resolution generalized after the flow audit (2026-07-08)

- **IdRef-only terms no longer fall through to the Wikidata text search when
  a P269 backlink exists.** The IdRef path in the reconciliation engine was
  missing the WD-by-authority-ID lookup that the GND path has had all along
  (P227): a heading like *Suisse* (IdRef 027249654, linked from Q39) was
  resolved by label search and matched the French commune Q22036 instead of
  Switzerland, dragging wrong BnF/descriptions along. `reconcile()` now
  queries `wdt:P269` before any text fallback (route tag: `IdRef→WD`).
  Regression-tested offline with a canned SPARQL backlink.
- **The record's own authority ID stays visible when it differs from the
  Wikidata claim.** Authorities can hold several PPNs for one concept (e.g.
  RAMEAU *Géographie* 027534510 vs 027534499): the badge row used to show
  only the entity's P269/P227 value, hiding the PPN the catalog actually
  uses; now both are shown when they differ.
- **Backlink resolution generalized after a flow audit.** The P269 fix above
  turned out to be one instance of a systematic P227-only bias; a shared
  `qidViaBacklinks()` helper now tries GND/P227 → IdRef/P269 → LCSH/P244 →
  BnF/P268 → BNE/P950 (in reliability order) before any text fallback, on
  all three reconciliation paths: NS-local (clusters without GND and without
  a precomputed QID), GND (names carrying both GND and IdRef ids) and IdRef.
- **The WD hub now recovers the French label too** (via P268 → data.bnf.fr,
  falling back to P269 → IdRef Solr): it used to fill DE/EN/ES and skip FR.
- Dead code removed: `enrichViaWdHub()` (superseded by the inline hub) and
  the unused `sink()` helper.
- Pipeline v3.3: `enrich_wikidata()` had the same GND-only bias at build
  time — clusters holding only RAMEAU/IdRef/LCSH/BNE ids left the build
  without a QID. It now resolves backlinks through all five properties in
  waves (regression-tested with a stubbed Wikidata endpoint).

## 1.1.0 — 2026-07-02

### Architecture

- **The unified index and the reconciliation/hierarchy engine moved into the
  background service worker** (`bg_index.js`, `bg_reconcile.js`, ES modules).
  One parsed copy of the ~35 MB of data is now shared by every tab; in
  v1.0.x each tab parsed and held its own. The content script keeps thin
  wrappers with the v1.0.x signatures plus per-record cache mirrors, so the
  rendering code is untouched. On MV3 worker cold-start the index reloads
  lazily (~200–500 ms), warmed up in parallel with the MARC fetch.
- **Message surface reduced to four typed requests** (`warmIndex`,
  `reconcile`, `hierarchy`, `fetchMarc`). The generic `fetchJSON`/`sparql`/
  `lobid`/`idref`/`fetchBNE`/`fetchLCSH` bridges of v1.0.x are gone — no
  URL-shaped input crosses the content→worker boundary anymore.
- **`web_accessible_resources` slimmed** to the CSS and the three hand-made
  vocabulary files: the big index/label/hierarchy JSONs are now fetched only
  from the worker (extension context), so catalog pages can no longer read
  them.
- Worker-side caches are bounded LRUs shared across tabs (reconciliation is
  deterministic per input), replacing the per-record clearing.
- Worker modules are written in a strip-friendly ES-module style so the test
  harness loads them without a bundler.

### Tests

- Extension suite extended to 91 checks: content sandbox + worker sandbox,
  including **offline end-to-end runs of `reconcile()` and `getHierarchy()`**
  against a fixture index with the network stubbed out, and coverage of the
  new bridge wrappers and LRU caches.
- **Pipeline golden tests** (`unified_auth_index/tests/test_parsers.py`,
  35 checks): inline fixtures in the exact upstream dump formats for the
  NS/GND/RAMEAU/LCSH/BNE parsers, plus clustering and confidence grading.

### Internationalization

- **All source comments are now in English** (they were mixed
  Italian/English), including the data-preparation pipeline. UI strings keep
  their five-language `I18N` table with Italian as default.
- README rewritten in English; manifest description in English.

## 1.0.1 — 2026-07-02

### Security

- Permissions reduced to `storage` + `scripting` (dropped `tabs` — and with
  it the "read your browsing history" install warning — and `activeTab`).
- Static content scripts in the manifest instead of programmatic injection:
  no double-injection after service-worker restarts.
- Background `fetchJSON` restricted to a whitelist of authority hosts;
  `pageHost` validated against known catalog domains; `bneId`/`lcshId`/
  `instCode` format re-validated in the background.
- 5 MB cap enforced on actual response bytes (previously only on the
  Content-Length header, which chunked responses can omit).
- `window.open` centralised in `openUrlSafe()`: https-only + `noopener`.
- Search-context parameters (`tab`, `search_scope`, `vid`) URL-encoded in all
  search-URL builders.
- Content-script IndexedDB cache removed: it lived in the page origin
  (readable/poisonable by the site) and duplicated ~11 MB per origin.
- `decXML` decoding order fixed (`&amp;` last, so `&amp;lt;` no longer
  becomes `<`).
- PRIVACY.md (it/en) and a privacy note in the About popover.

### Architecture and robustness

- UI moved into a **closed Shadow DOM**: two-way CSS isolation from the
  catalog; the page cannot reach the panel via `element.shadowRoot`.
- The 3,970-line `content.js` split into 7 ordered modules; pure functions
  became testable (first test suite: 66 checks).
- URL polling (800 ms) removed: the background forwards `tabs.onUpdated` —
  which also fires on SPA `pushState` — as `checkUrl` messages.
- `loadRecord` wrapped in `try/finally`: an exception no longer bricks the
  extension until reload; a URL arriving during a slow load is retried.
- SBT path aligned with the others (`renderTermDetailSafe`/`safeReconcile`).
- ~80 duplicated label-resolution lines consolidated into
  `queueClusterLabels()`; three hand-rolled cache-scan loops consolidated
  into `recoverAuthIds()`.
- UDC macro groups moved from code to data (`vocab_cdu.json` → `_macros`),
  with quadrilingual labels.
- Listener leak fixed (one `document.click` handler per record load).
- Pipeline v3.2: sanity thresholds abort the build when an upstream dump
  format drifts.

## 1.0.0

Initial version.
