# Subject Navigator, step by step

What happens from the moment a record is opened in a Primo VE catalogue (swisscovery, reperio.usi.ch, explore.lib.unige.ch) to the moment the panel shows subjects, names, works, hierarchies and classes. Version 1.0.0. Every step matches the code of this version.

## Who does what

The extension has five parts. The diagrams use these names.

- **The page.** The scripts inside the catalogue: they build the panel (in a closed shadow DOM), sort the record's fields, draw cards and buttons. They ask the engine for the stylesheet and the BAAM, DDC, place, form and role tables: the catalogue page cannot read the extension's files.
- **The site adapter.** Two files, one for the page (`cs_site.js`) and one for the engine (`bg_site.js`), with everything specific to Primo VE and Alma: how a record page is recognised, where the MARC record is asked for (SRU, allowed servers), how a search is built in the same view, with the same scope and tab, which fields to search for BAAM and DDC. A test checks that no other file contains any of it. For another catalogue, these two are rewritten.
- **The engine.** The extension's service worker: it keeps the index in memory and runs every lookup, local and online. The page asks it for things by message; the engine accepts only SRU addresses of the allowed servers and follows redirects only to them.
- **The local index.** Files inside the extension: NS concepts with their mappings, DE/EN/ES labels and the GND hierarchy, one RAMEAU/IdRef table (French label, hierarchy and «voir aussi» of the thesaurus terms, with both ids), the GND and RAMEAU notes (loaded when a card first needs one), BAAM, DDC, place and form tables. Spanish labels and BNE links from the files of the BNE open-data portal. No network.
- **Online sources.** swisscovery SRU (the MARC record: the network zone first, swisscovery.ch then swisscovery.slsp.ch, then the institution), Wikidata, Lobid (GND), IdRef, BnF, LCSH, BNE, Getty AAT. Used only when the index is not enough. Wikidata SPARQL goes through QLever (University of Freiburg; query.wikidata.org when it does not answer): when a record opens, one query with all its GND and IdRef ids; when the subjects are ready, one Wikidata and one Getty query prepare the hierarchies of every Navigate term.

## 1. Overview: from opening the record to a full panel

```mermaid
flowchart TD
  A["A catalogue page opens<br/>(or the address changes within the page)"] --> B{"Is it the full view<br/>of a record?<br/>(the adapter says)"}
  B -- no --> B0["The panel closes"]
  B -- yes --> C{"Is it the record<br/>already shown?"}
  C -- yes --> C0["Nothing happens"]
  C -- no --> D["Prepares the empty panel<br/>with the message «reading MARC»"]
  D --> E["Asks the engine to load the index<br/>(in parallel, waits at most 3 seconds)"]
  D --> F["Asks the engine for the MARC record<br/>via SRU (servers and order from the adapter)"]
  F --> G{"Record received?"}
  G -- no --> G0["The panel closes"]
  G -- yes --> H["Sorts the MARC fields<br/>(diagram 2)"]
  H --> I{"At least one subject,<br/>name, class or form?"}
  I -- no --> I0["The panel closes"]
  I -- yes --> J["Panel visible, with the count on the badge<br/>tabs: Subjects · Navigate · People · Classification"]
  J --> K["Fills five blocks in parallel"]
  K --> K1["NS subjects<br/>(diagram 3)"]
  K --> K2["GND subjects<br/>(3 at a time)"]
  K --> K3["IdRef subjects<br/>(3 at a time)"]
  K --> K4["Names 1XX/7XX, People tab<br/>(3 at a time)"]
  K --> K5["Forms 655<br/>(diagram 8)"]
  J --> K6["BAAM and DDC classes<br/>(diagram 7, as soon as the tables are ready)"]
  K1 & K2 & K3 & K4 & K5 --> L["Subjects ready"]
  L --> M["Merges the languages of terms<br/>that lead to the same concept"]
  M --> M2["Confirms the Wikidata hypotheses<br/>that another heading or the author<br/>reaches through an id (diagram 5)"]
  M2 --> N["Builds the combined search<br/>(diagram 9)"]
  M --> O["Creates the Navigate buttons and shows<br/>the hierarchy of the first term (diagram 6)"]
```

- Every term goes through **reconciliation** (diagrams 4 and 5): the engine looks for the concept, the labels in five languages and the Wikidata item, if any. The result is kept in memory, so a repeated term is not looked up twice.
- If another record is opened while one is loading, the extension finishes the first and then moves on: no navigation is lost.
- The timing log records five moments: record start, panel visible, subjects ready, record end, navigation.

## 2. Sorting the MARC fields

Every field of the record passes through this filter, in the order it appears. 880 fields (other script) count as the field they are linked to.

```mermaid
flowchart TD
  A["A field of the record"] --> B{"Which field?"}
  B -- "691 with $2 usi-TM" --> CDU["BAAM class (local classification)<br/>(number from $a or $e)"]
  B -- "082 with $2 23sdnb" --> CDD["DDC class"]
  B -- "600 · 610 · 611 · 630<br/>648 · 650 · 651 · 655" --> S{"$2 is gnd or idref<br/>but $0 has no id?"}
  S -- "yes (except 655 gnd-content<br/>and gnd-carrier)" --> X["Left out of the panel<br/>(still searchable in the catalogue)"]
  S -- no --> T{"Which field?"}
  T -- "655" --> F["Form or genre<br/>(separate row, not a subject)"]
  T -- "630 · 648 · 650 · 651" --> V{"Vocabulary in $2"}
  T -- "600 · 610 · 611" --> WT{"Is there a title $t?"}
  WT -- yes --> OP["Work: «Author: Title. Parts (qualifiers)»<br/>reconciled with the work's id;<br/>label = the title"]
  WT -- no --> W{"Vocabulary in $2"}
  V -- "sbt…" --> NS["NS tab<br/>whole string with subdivisions"]
  V -- "gnd…" --> GND["GND tab<br/>term $a with GND id"]
  V -- "idref" --> IDR["IdRef tab<br/>term $a with IdRef id"]
  W -- "sbt…" --> NSN["NS tab<br/>name as subject + subdivisions"]
  W -- "gnd…" --> GNDN["GND tab<br/>name as subject"]
  W -- "idref" --> IDRN["IdRef tab<br/>name as subject"]
  B -- "100 · 700 · 110 · 710<br/>111 · 711" --> PT{"Is there a title $t?"}
  PT -- "yes (7XX only)" --> PX["Left out: in the USI data<br/>these fields are not reliable"]
  PT -- no --> P["People tab<br/>person, corporate body or meeting, with the role"]
  P --> PM["A repeated name (or its 880 form)<br/>becomes one card with all its fields:<br/>with an id they merge by id, without one by wording.<br/>Two different ids from the same source stay separate."]
```

- Identical fields repeated in the record are shown once.
- A field with `$2 gnd` and no id is a legacy heading: the extension does not try to guess it.
- 1XX/7XX names go only to the People tab: they do not enter the index, which holds subject terms only, nor the combined search. They also serve to confirm a work through its author.
- **Complete names.** Person: `$a`, numeration `$b`, first `$c`, then in brackets `$q`, the other `$c` and the dates. Corporate body: the `$b` levels, with `$g` in brackets; under 110/710 also the number, date and place of a meeting. Meeting: every `$c`. Place 651: also `$b`. Added parts go in brackets, so the Wikidata search always uses the bare name.
- SBT identifiers in `$0` (SBT11) lead to no other source and are not used.

## 3. NS subject strings

An NS string (for example *Architettura — Svizzera — Sec. 20.*) is split into buttons, one per element. GND and IdRef tabs have one term per field instead. A work as subject (*Carroll, Lewis. Alice's adventures in Wonderland — Illustrazioni*) gives three buttons: [title] [author: Carroll, Lewis] [Illustrazioni].

```mermaid
flowchart TD
  A["NS string from the record"] --> B["Splits into elements:<br/>$a and $x topic · $z place · $y period · $v form"]
  B --> C["One button per element;<br/>$v at the end, not clickable"]
  C --> D["First element: reconciled and shown at once<br/>(name as subject: as person, body or meeting;<br/>work: the title, reconciled with the whole heading)"]
  C --> AU["Work: a separate «author» button,<br/>reconciled as person, body or meeting;<br/>goes to Navigate and to the combined search"]
  C --> E{"Other elements"}
  E -- "$a $x $z" --> E1["Reconciled in the background<br/>(topic or place)"]
  E -- "$y period · $v form" --> E2["No lookup:<br/>they stay the record's wording"]
  D & E1 & E2 --> F{"At least two elements<br/>that are not period, form or author?"}
  F -- yes --> G["AND button for the string:<br/>elements in AND, one variant per language, in OR"]
  F -- no --> H["No AND button"]
  C --> I["Click on a button:<br/>shows the card of that element"]
```

## 4. Reconciliation, part one: a term in the local index

This is the heart of the extension. For every term the engine first looks in the local index, without network. The record's identifiers (GND or IdRef in `$0`) count more than its words.

```mermaid
flowchart TD
  A["Term from the record<br/>(wording, type, GND or IdRef id if any)"] --> Z{"Already looked up<br/>in this record?"}
  Z -- yes --> Z1["Result from memory"]
  Z -- no --> B{"Does the record give<br/>a GND or IdRef id?"}
  B -- yes --> C["Looks the id up among the index mappings:<br/>slot holders and secondary mappings"]
  C --> D{"How many NS concepts?"}
  D -- "one" --> OK["NS concept found"]
  D -- "more than one" --> E["1. the concept where the id holds the slot wins<br/>2. then the safest mapping (exact before close)<br/>3. then the label identical to the term<br/>4. then the NS concept over the SBT one"]
  E -- "one left" --> OK
  E -- "tie" --> AMB["No choice:<br/>warning «several possible concepts»"]
  D -- "none" --> R["Goes online<br/>(diagram 5)"]
  B -- no --> L{"Is the term a topic<br/>or a place?"}
  L -- yes --> LL["Looks the wording up among NS labels"]
  LL -- found --> OK
  LL -- "not found" --> R
  L -- "no (person, body, period, form…)" --> R
  AMB --> R
  OK --> P["Italian = NS label<br/>from the cluster: GND id, Wikidata item"]
  P --> Q["DE · FR · EN · ES labels from local files<br/>(if missing: from the online source)"]
  Q --> Q1["If the id arrives through a secondary mapping,<br/>the record's form is kept (German or French)"]
  Q1 --> S{"No Wikidata item?"}
  S -- yes --> S1["Looks it up by id: GND, IdRef, LCSH, BnF, BNE<br/>(in this order, stops at the first hit)"]
  S -- no --> T
  S1 --> T{"Any language missing?"}
  T -- "yes, and there is Wikidata" --> T1["From Wikidata derives the missing ids<br/>and asks Lobid, BnF or IdRef, LCSH, BNE for the labels"]
  T -- no --> U["Term card"]
  T1 --> U
```

- **Slot holder**: every NS concept has one slot per vocabulary (one GND id, one RAMEAU, one IdRef…). The other ids declared for the same concept are **secondary mappings**: they reach the concept but do not take the slot.
- The IdRef slot is always the twin of the RAMEAU slot.
- A wording alone anchors only topics and places to the thesaurus: a person named like a concept does not become that concept.
- The card shows the Italian title (and the interface language), the description, the NS scope note and definition, the route (section 10), warnings and the cluster reliability dots (4 = highest).

## 5. Reconciliation, part two: when the index is not enough

This happens mostly with names, places and terms the Nuovo Soggettario does not have. Each step runs only if the previous one did not find what is needed.

```mermaid
flowchart TD
  A["No NS concept from the local index"] --> G{"Is there a GND id?"}
  G -- yes --> G1["Looks the GND id up among the index slot holders"]
  G1 --> G2["Wikidata item by id (GND, IdRef)"]
  G2 --> G3["Lobid: German form, links<br/>to Wikidata, BnF (French form) and VIAF"]
  G -- no --> I
  G3 --> I{"Is there an IdRef id?"}
  I -- yes --> I1["Looks the IdRef id up among the index slot holders"]
  I1 --> I2["IdRef (Solr service): record type and French form;<br/>if it is a subject, looks the French form up in the index"]
  I2 --> I3["Wikidata item by IdRef id"]
  I3 --> I4["Full IdRef record: tries VIAF, ISNI, BnF ark<br/>as further bridges to Wikidata"]
  I -- no --> W
  I4 --> W{"Still no Wikidata item?<br/>(and not a period or a form)"}
  W -- "yes, a work" --> WO["Searches Wikidata for the title: keeps the candidate<br/>only if the title is the same and one of its authors<br/>(P50, P170, P84, P86) matches the heading's author;<br/>no author, no search"]
  WO --> VU
  W -- "yes, other" --> W1["Text search in Wikidata<br/>(in the language of the record's vocabulary)"]
  W1 --> V{"Checking the candidate"}
  V -- "same GND or IdRef id" --> VC["Confirmed"]
  V -- "incompatible type or<br/>different surname" --> VX["Discarded, with warning<br/>«discarded: …»"]
  V -- "no evidence" --> VU["Hypothesis, with warning «unverified»:<br/>no description, label or search term.<br/>Confirmed when the subjects are ready if another heading<br/>of the same type reaches the same item through an id<br/>(work: if its author is the item that a person<br/>of the record reaches through GND or IdRef)"]
  W -- no --> N
  VC & VU & VX --> N["Last attempt at an NS concept: from the Wikidata item<br/>(only if found by id or confirmed), then from GND, IdRef, LCSH"]
  N -- found --> N1["Labels from the cluster, as in diagram 4"]
  N -- "not found" --> X["GND or IdRef subject: missing languages from the exact links<br/>(local file: RAMEAU, GND, LCSH, BNE headings declared equivalent)"]
  X --> E{"Person, body,<br/>meeting or place?"}
  E -- yes --> E1["Completes the languages from the Wikidata item:<br/>Lobid (DE), IdRef (FR), LCSH (EN), BNE (ES)"]
  E -- no --> F["The record's wording stays"]
  N1 & E1 & F --> U["Term card"]
```

- Text proposes, identifiers decide. A Wikidata item found only by text and not confirmed by an id stays a hypothesis: its link is shown (with the warning), but it does not anchor the term to a thesaurus concept, gives no labels or description, and searches use only the record's wording.
- A confirmation through the record says so on the card: «confirmed by the record» or, for a work, «confirmed by its author in the record».
- If a source does not answer in time, the card shows what it has; on a network error the error message replaces the card without blocking the other terms.

## 6. Hierarchy in the Navigate tab

```mermaid
flowchart TD
  A["Reconciled terms of the record<br/>(including the «author» buttons of works)"] --> B["One button per distinct heading<br/>(identical wordings of the same concept merge;<br/>a repeated wording names its vocabulary; forms excluded)"]
  B --> C["The first term opens by itself;<br/>the others on click"]
  C --> C2["Uses the record's and the concept's ids;<br/>Wikidata's only when confirmed"]
  C2 --> D["The engine collects neighbouring terms<br/>(BT broader · NT narrower · RT related)"]
  D --> D1["NS from the local index<br/>with the cluster's DE/FR/EN labels"]
  D --> D2["GND: local hierarchy;<br/>if missing, Lobid"]
  D --> D3["IdRef: local RAMEAU/IdRef table<br/>(also outside NS), with «voir aussi»;<br/>if missing, IdRef online"]
  D --> D4["Getty AAT, if the Wikidata item links it"]
  D --> D5["Wikidata: «subclass of»"]
  D1 & D2 & D3 & D4 & D5 --> E["Merges terms that lead<br/>to the same NS concept"]
  E --> F["Sorts: thesaurus terms first,<br/>then AAT, then Wikidata only"]
  F --> F2["AAT or Wikidata-only terms: IT · DE · FR cards<br/>with English below; terms with no Italian,<br/>German or French label are not drawn"]
  F2 --> G["Tree with source tags (never the term itself;<br/>more than 3 broader terms: «Show all»);<br/>the arrow of the chosen term is in the interface language;<br/>click a term: go down and repeat"]
```

## 7. BAAM and DDC classes

Everything happens in the page, with the tables inside the extension: no network. The catalogue's search fields for BAAM and DDC come from the adapter.

```mermaid
flowchart TD
  A["Number from 691 (BAAM) or 082 (DDC)"] --> B["Splits the number:<br/>base · auxiliaries in brackets · relation «:» · range «/»"]
  B --> C["Looks it up in the table: first base:relation,<br/>then the base, then the longest prefix, then the parent class"]
  C --> D["Climbs the parent classes up to the root<br/>(for example 790 › 791 › 791.320)"]
  D --> E["Labels in the interface language<br/>(IT, DE, FR, EN)"]
  B --> F["Auxiliaries: places from the geographic table,<br/>common forms like (03) or (091) from the BAAM table;<br/>a range with its own entry stays whole"]
  E & F --> G["Class card with search buttons:<br/>exact class or class with subclasses;<br/>button for the main classes"]
```

## 8. Forms and genres (655)

```mermaid
flowchart TD
  A["Form from 655<br/>(NS, GND or IdRef)"] --> B{"Is it in the reviewed<br/>SLSP form table?"}
  B -- yes --> G["The record's forms of the same row<br/>(one per vocabulary: Zeitschrift · Périodique · Periodici)<br/>become one badge"]
  G --> C["Shows the official forms<br/>the record does not already have"]
  B -- no --> D["The record's wording stays,<br/>untranslated"]
  C & D --> E["«Forms» row under the subjects;<br/>not navigated, never sent to Wikidata"]
  E --> F["Available as a refinement<br/>in the combined search (off by default):<br/>one chip per badge; if the record has the same word<br/>as a subject, the form joins that chip"]
```

## 9. Combined search (Navigate tab, at the bottom)

```mermaid
flowchart TD
  A["All terms and names as subject of the record,<br/>reconciled (works by their title, authors apart;<br/>not the names of the People tab)"] --> B["Groups terms of the same concept<br/>(same NS or same confirmed Wikidata item)"]
  B --> C["One button per group, with the record's wordings<br/>joined by « · » (for example Organi di senso · Sinne)"]
  C --> D["On by default: topics and places;<br/>forms off"]
  D --> E["For each language builds a branch<br/>with all active buttons in AND"]
  E --> F["Within a group the variants go in OR<br/>(«Sinnesorgan» OR «Sinne»)"]
  F --> G["Language branches in OR:<br/>(IT) OR (DE) OR (FR) …"]
  G --> H["Opens the search in the catalogue, in the record's<br/>own view: same scope, tab and language<br/>(address built by the adapter)"]
```

## 10. Reading the route in the panel

Under each term the panel shows a row of tags: the path the engine followed, in order. During testing it tells where a result comes from.

| Tag | Meaning | Diagram |
|---|---|---|
| `ID→NS-local` | The record's id holds the slot in an NS concept. | 4 |
| `ID→NS-local(secondary)` | The record's id reaches the concept as a secondary mapping; the record's form is kept. | 4 |
| `NS-local` | Found by wording among the NS labels (no id). | 4 |
| `NS→GND` `NS→WD` `cl→WD` | GND id or Wikidata item taken from the concept's cluster. | 4, 5 |
| `GND→WD` `IdRef→WD` `LCSH→WD` `BnF→WD` `BNE→WD` `VIAF→WD` `ISNI→WD` | Wikidata item found through an id: reliable. | 4, 5 |
| `GND→NS-reverse` `IdRef→NS-direct` | Concept found from the id outside the first lookup (for example after an ambiguity resolved elsewhere). | 5 |
| `Lobid:…` `Lobid→WD` `Lobid→BnF` | GND record read online, with its links. | 5 |
| `IdRefSolr:… (type)` `IdRef:…` `IdRef→FR→NS` | IdRef record read online; the last one means the concept was found through the French form. | 5 |
| `coref:VIAF+ISNI…` | Ids of other sources taken from the IdRef record to look for Wikidata. | 5 |
| `WD-text` | Text search in Wikidata (for works: title plus author): see the warning below it (confirmed, unverified, confirmed by the record). | 5 |
| `WD-text✗` | The candidate found by text was discarded. | 5 |
| `NS-reverse` | NS concept found at the end, starting from Wikidata or from an id. | 5 |
| `exact-links` | GND or IdRef subject without NS concept: languages from the headings the sources declare equivalent (exactMatch), no network. | 5 |
| `enrich-person` `enrich-place` … | Name or place without NS concept: languages completed from the sources linked to Wikidata. | 5 |

---

Subject Navigator 1.0.0 · index built from the October 2026 dumps.
