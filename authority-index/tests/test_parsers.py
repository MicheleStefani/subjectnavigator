# -*- coding: utf-8 -*-
"""Golden tests for the build_index.py parsers and clustering.

Run with:  python tests/test_parsers.py   (from unified_auth_index/)

The parsers are streaming regexes over multi-hundred-MB upstream dumps
(NS SKOS, GND TTL, RAMEAU NT, LCSH TTL, BNE NT). A format drift upstream
makes them "succeed" while returning a fraction of the data; the sanity
thresholds in build_index.py catch collapses at build time, and these
fixtures catch regressions in the parsing logic itself at development
time. Fixtures are inline snippets in the exact upstream formats, written
to a temp dir. No third-party dependencies (plain asserts, no pytest).
"""
import io
import os
import sys
import tarfile
import tempfile

# build_index.py prints arrows/ellipses; Windows consoles default to cp1252
# when piped, so force UTF-8 (harmless elsewhere).
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import build_index as bi

passed = 0
failed = 0


def check(name, cond, detail=None):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print(f"  FAIL: {name}" + (f"  -> {detail!r}" if detail is not None else ""))


def section(title):
    print(f"\n. {title}")


TMP = tempfile.mkdtemp(prefix="sn_parser_tests_")


def write_fixture(name, text):
    path = os.path.join(TMP, name)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    return path


# ── NS SKOS (Nuovo Soggettario TTL export) ──────────────────────────
section("parse_ns_skos")
ns_path = write_fixture("ns.ttl", """<http://purl.org/bncf/tid/100> a skos:Concept ;
    skos:prefLabel "calcestruzzo"@it ;
    skos:broader <http://purl.org/bncf/tid/200> ;
    skos:notation "620.136"^^<http://dewey.info> ;
    skos:scopeNote "Conglomerato di cemento, sabbia e acqua" ;
    skos:altLabel "conglomerato cementizio" ;
    skos:closeMatch <http://d-nb.info/gnd/4005184-2> ;
    skos:closeMatch <http://www.wikidata.org/entity/Q40089> .
<http://purl.org/bncf/tid/200> a skos:Concept ;
    skos:prefLabel "materiali da costruzione"@it ;
    skos:narrower <http://purl.org/bncf/tid/100> .
<http://purl.org/bncf/tid/300> rdfs:label "not a concept" .
""")
ns = bi.parse_ns_skos(ns_path)
check("two concepts parsed, non-concept skipped", len(ns) == 2, sorted(ns))
check("prefLabel", ns["100"]["l"] == "calcestruzzo", ns.get("100"))
check("broader", ns["100"].get("bt") == ["200"], ns.get("100"))
check("narrower", ns["200"].get("nt") == ["100"], ns.get("200"))
check("dewey notation", ns["100"].get("d") == "620.136", ns.get("100"))
check("scope note", "cemento" in ns["100"].get("sn", ""), ns.get("100"))
check("altLabel", ns["100"].get("al") == ["conglomerato cementizio"], ns.get("100"))
check("GND match extracted", ns["100"].get("mx", {}).get("gnd") == "4005184-2", ns["100"].get("mx"))
check("Wikidata match extracted", ns["100"].get("mx", {}).get("wd") == "Q40089", ns["100"].get("mx"))

# ── GND dump (DNB lds TTL) ──────────────────────────────────────────
section("parse_gnd_dump")
gnd_path = write_fixture("gnd.ttl", """@prefix gndo: <https://d-nb.info/standards/elementset/gnd#> .
<https://d-nb.info/gnd/4005184-2> a gndo:SubjectHeadingSensoStricto ;
gndo:preferredNameForTheSubjectHeading "Beton" ;
gndo:variantNameForTheSubjectHeading "Zementbeton" ;
gndo:definition "Baustoff aus Zement, Gesteinskörnung und Wasser"@de ;
gndo:broaderTermGeneral <https://d-nb.info/gnd/4056795-3> ;
owl:sameAs <http://www.wikidata.org/entity/Q40089> ;
skos:closeMatch ram:cb119456091 ;
skos:exactMatch nsogg:100 .
<https://d-nb.info/gnd/4056795-3> a gndo:SubjectHeadingSensoStricto ;
gndo:preferredNameForTheSubjectHeading "Baustoff" .
""")
gnd_data, gnd_edges = bi.parse_gnd_dump(gnd_path)
check("two labelled entities", len(gnd_data) == 2, sorted(gnd_data))
check("preferred name", gnd_data["4005184-2"]["label"] == "Beton", gnd_data.get("4005184-2"))
check("variant name", gnd_data["4005184-2"].get("variants") == ["Zementbeton"], gnd_data.get("4005184-2"))
check("broader", gnd_data["4005184-2"].get("broader") == ["4056795-3"], gnd_data.get("4005184-2"))
check("GND definition kept", gnd_data["4005184-2"].get("definition") == "Baustoff aus Zement, Gesteinskörnung und Wasser", gnd_data.get("4005184-2"))
check("no definition, no key", "definition" not in gnd_data["4056795-3"], gnd_data.get("4056795-3"))
check("wikidata sameAs", gnd_data["4005184-2"].get("wd") == "Q40089", gnd_data.get("4005184-2"))
check("wd edge", ("gnd", "4005184-2", "wd", "Q40089") in gnd_edges, gnd_edges)
check("ram: prefixed edge", ("gnd", "4005184-2", "bnf", "cb119456091") in gnd_edges, gnd_edges)
check("nsogg: prefixed edge", ("gnd", "4005184-2", "ns", "100") in gnd_edges, gnd_edges)

# ── RAMEAU dump (BnF NT inside tar.gz) ──────────────────────────────
section("parse_rameau_dump")
nt_content = (
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/1999/02/22-rdf-syntax-ns#type> '
    '<http://www.w3.org/2004/02/skos/core#Concept> .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#prefLabel> "Béton"@fr .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#broader> '
    '<http://data.bnf.fr/ark:/12148/cb12042942h> .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#closeMatch> '
    '<http://www.idref.fr/027290905> .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#related> '
    '<http://data.bnf.fr/ark:/12148/cb11930812p> .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://purl.org/dc/terms/isPartOf> '
    '<http://data.bnf.fr/vocabulary/rameau/r166> .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#note> "Matériau de construction"@fr .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#scopeNote> "Voir aussi la subdivision Béton"@fr .\n'
    '<http://data.bnf.fr/ark:/12148/cb119456091> '
    '<http://www.w3.org/2004/02/skos/core#editorialNote> "Grand Larousse"@fr .\n'
)
tar_path = os.path.join(TMP, "rameau.tar.gz")
nt_bytes = nt_content.encode("utf-8")
with tarfile.open(tar_path, "w:gz") as tar:
    info = tarfile.TarInfo(name="rameau_test.nt")
    info.size = len(nt_bytes)
    tar.addfile(info, io.BytesIO(nt_bytes))
bnf_data, bnf_edges = bi.parse_rameau_dump(tar_path)
check("concept with label", bnf_data.get("cb119456091", {}).get("label") == "Béton", bnf_data)
check("broader kept", bnf_data.get("cb119456091", {}).get("broader") == ["cb12042942h"], bnf_data)
check("idref edge", ("bnf", "cb119456091", "idref", "027290905") in bnf_edges, bnf_edges)
check("RAMEAU 'voir aussi' (skos:related) kept", bnf_data.get("cb119456091", {}).get("related") == ["cb11930812p"], bnf_data)
check("RAMEAU part kept (r166 common nouns)", bnf_data.get("cb119456091", {}).get("parts") == ["r166"], bnf_data)
check("RAMEAU skos:note kept; scopeNote and editorialNote not read",
      bnf_data.get("cb119456091", {}).get("notes") == ["Matériau de construction"], bnf_data)

# ── LCSH dump (LoC skosrdf TTL) ─────────────────────────────────────
section("parse_lcsh_dump")
# Real dump layout: every block states its own subject (only the label of
# that subject is read).
lcsh_path = write_fixture("lcsh.ttl", """# BEGIN http://id.loc.gov/authorities/subjects/sh85006611
<http://id.loc.gov/authorities/subjects/sh85006611> a skos:Concept ;
skos:prefLabel "Architecture"@en ;
skos:broader <http://id.loc.gov/authorities/subjects/sh85006622> .
# END http://id.loc.gov/authorities/subjects/sh85006611
# BEGIN http://id.loc.gov/authorities/subjects/sh85006700
<http://id.loc.gov/authorities/subjects/sh85006700> skos:prefLabel "Architecture--History"@en .
# BEGIN http://id.loc.gov/authorities/subjects/sh85006800-781
<http://id.loc.gov/authorities/subjects/sh85006800-781> skos:prefLabel "Should be skipped"@en .
""")
lcsh = bi.parse_lcsh_dump(lcsh_path)
check("simple term kept", lcsh.get("sh85006611", {}).get("label") == "Architecture", lcsh)
check("broader kept", lcsh.get("sh85006611", {}).get("broader") == ["sh85006622"], lcsh)
check("compound (--) term skipped", "sh85006700" not in lcsh, sorted(lcsh))
check("-781 record skipped", not any(k.startswith("sh85006800") for k in lcsh), sorted(lcsh))

# ── BNE dump (datos.bne.es NT) ──────────────────────────────────────
section("parse_bne_dump")
bne_path = write_fixture("bne.nt", (
    '<https://datos.bne.es/resource/XX527980> '
    '<http://www.w3.org/2004/02/skos/core#prefLabel> "Hormigón"@es .\n'
    '<https://datos.bne.es/resource/XX527980> '
    '<http://www.w3.org/2004/02/skos/core#closeMatch> '
    '<http://d-nb.info/gnd/4005184-2> .\n'
    '<https://datos.bne.es/resource/XX999> '
    '<http://www.w3.org/2004/02/skos/core#prefLabel> "Arquitectura--Historia"@es .\n'
))
bne_data, bne_edges = bi.parse_bne_dump(bne_path)
check("simple term kept", bne_data.get("XX527980", {}).get("label") == "Hormigón", bne_data)
check("compound (--) term skipped", "XX999" not in bne_data, sorted(bne_data))
check("gnd edge", ("bne", "XX527980", "gnd", "4005184-2") in bne_edges, bne_edges)

# ── BNE authority MARCXML (datosabiertos.bne.es) ───────
section("parse_bne_marcxml")
bx_path = write_fixture("bne-materia.xml", """<?xml version="1.0" encoding="UTF-8"?>
<collection><record><controlfield tag="001">981061093345908606</controlfield>
<datafield tag="035" ind1=" " ind2=" "><subfield code="a">(SpMaBN)XX527980</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">http://id.loc.gov/authorities/subjects/sh85031428</subfield><subfield code="2">lcsh</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">https://data.bnf.fr/fr/ark:/12148/cb119456091</subfield><subfield code="2">rameau</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">https://www.wikidata.org/wiki/Q22657</subfield><subfield code="2">wikidata</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">http://purl.org/bncf/tid/100</subfield><subfield code="2">nsbncf</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">http://viaf.org/viaf/1</subfield><subfield code="2">viaf</subfield></datafield>
<datafield tag="150" ind1=" " ind2=" "><subfield code="a">Hormigón</subfield></datafield></record>
<record><datafield tag="035" ind1=" " ind2=" "><subfield code="a">(SpMaBN)XX999</subfield></datafield>
<datafield tag="024" ind1="7" ind2=" "><subfield code="a">http://id.loc.gov/authorities/subjects/sh1</subfield><subfield code="2">lcsh</subfield></datafield>
<datafield tag="150" ind1=" " ind2=" "><subfield code="a">Arquitectura</subfield><subfield code="x">Historia</subfield></datafield></record>
</collection>""")
bg_path = write_fixture("bne-genero.xml", """<?xml version="1.0" encoding="UTF-8"?>
<collection><record><datafield tag="035" ind1=" " ind2=" "><subfield code="a">(SpMaBN)XX5382550</subfield></datafield>
<datafield tag="155" ind1=" " ind2=" "><subfield code="a">Tragedias</subfield></datafield></record>
<record><datafield tag="035" ind1=" " ind2=" "><subfield code="a">(SpMaBN)XX4343854</subfield></datafield>
<datafield tag="185" ind1=" " ind2=" "><subfield code="v">Diccionarios</subfield></datafield></record>
<record><datafield tag="035" ind1=" " ind2=" "><subfield code="a">(SpMaBN)XX7</subfield></datafield>
<datafield tag="180" ind1=" " ind2=" "><subfield code="x">Historia</subfield><subfield code="v">Fuentes</subfield></datafield></record></collection>""")
bx_data, bx_edges = bi.parse_bne_marcxml([bx_path, bg_path])
check("MARCXML: XX id from 035, 150 label", bx_data.get("XX527980", {}).get("label") == "Hormigón", bx_data)
check("MARCXML: heading with subdivisions has no label", "XX999" not in bx_data, sorted(bx_data))
check("MARCXML: genre/form file read (155)", bx_data.get("XX5382550", {}).get("label") == "Tragedias", bx_data)
check("MARCXML: subdivision record of one element (185 Diccionarios) labelled", bx_data.get("XX4343854", {}).get("label") == "Diccionarios", bx_data)
check("MARCXML: subdivision record of two elements has no label", "XX7" not in bx_data, sorted(bx_data))
check("MARCXML: 024 links to LCSH, RAMEAU, Wikidata, NS", all(e in bx_edges for e in [
    ("bne", "XX527980", "lcsh", "sh85031428"), ("bne", "XX527980", "bnf", "cb119456091"),
    ("bne", "XX527980", "wd", "Q22657"), ("bne", "XX527980", "ns", "100")]), bx_edges)
check("MARCXML: links stay close, VIAF ignored", not any(bi.is_exact(e) for e in bx_edges) and not any(e[2] == "viaf" for e in bx_edges), bx_edges)
check("MARCXML: links of a heading with subdivisions kept (as in materias.nt)", ("bne", "XX999", "lcsh", "sh1") in bx_edges, bx_edges)

# ══ Regressions: source-reading defects of a line-by-line reader ══════════
# Each fixture reproduces the exact upstream layout of a real case that the
# line-by-line regexes read wrongly.

section("NS: comma lists, triple quotes, self-references")
ns2_path = write_fixture("ns2.ttl", '''@prefix skos: <http://www.w3.org/2004/02/skos/core#> .

<http://purl.org/bncf/tid/30177> dc:date "2005-07-20" ;
\ta skos:Concept ;
\tskos:altLabel "Santissima Trinità"@it , "Trinità divina"@it ;
\tskos:broader <http://purl.org/bncf/tid/596> ;
\tskos:closeMatch <http://d-nb.info/gnd/4060860-8> , <http://www.wikidata.org/entity/Q18298> ;
\tskos:prefLabel "Trinità"@it ;
\tskos:related <http://purl.org/bncf/tid/6943> , <http://purl.org/bncf/tid/30177> ,
\t\t<http://purl.org/bncf/tid/1> , <http://purl.org/bncf/tid/2> ;
\tskos:scopeNote """Nota su \\"più\\" righe
con a capo.""" .

<http://purl.org/bncf/tid/596> a skos:Concept ;
\tskos:narrower <http://purl.org/bncf/tid/30177> , <http://purl.org/bncf/tid/7> , <http://purl.org/bncf/tid/8> ;
\tskos:prefLabel "Strumenti"@it .
''')
ns2 = bi.parse_ns_skos(ns2_path)
check("NS: every RT of a comma list kept, self-reference dropped",
      ns2["30177"].get("rt") == ["6943", "1", "2"], ns2.get("30177"))
check("NS: every NT of a comma list kept", ns2["596"].get("nt") == ["30177", "7", "8"], ns2.get("596"))
check("NS: every altLabel of a comma list kept",
      ns2["30177"].get("al") == ["Santissima Trinità", "Trinità divina"], ns2["30177"].get("al"))
check("NS: triple-quoted scope note read (escapes resolved)",
      ns2["30177"].get("sn") == 'Nota su "più" righe\ncon a capo.', ns2["30177"].get("sn"))
check("NS: matches from a comma list", ns2["30177"].get("mx") == {"gnd": "4060860-8", "wd": "Q18298"},
      ns2["30177"].get("mx"))

section("GND: continuation lines and split statement groups")
gnd2_path = write_fixture("gnd2.ttl", """@prefix gndo: <https://d-nb.info/standards/elementset/gnd#> .
@prefix ram: <https://data.bnf.fr/ark:/12148/> .

<https://d-nb.info/gnd/4030702-5> a gndo:SubjectHeadingSensoStricto;
  wdrs:describedby <https://d-nb.info/gnd/4030702-5/about> .

<https://d-nb.info/gnd/4030702-5/about> dcterms:license <http://creativecommons.org/publicdomain/zero/1.0/> .

<https://d-nb.info/gnd/4030702-5> gndo:gndIdentifier "4030702-5";
  gndo:variantNameForTheSubjectHeading "Christliche Kirche", "Ekklesia <Theologie>";
  gndo:preferredNameForTheSubjectHeading "Kirche";
  skos:closeMatch <http://id.loc.gov/authorities/subjects/sh85025502>, ram:cb119757086,
    <http://purl.org/bncf/tid/767>;
  gndo:relatedTerm <https://d-nb.info/gnd/4070730-1>, <https://d-nb.info/gnd/4073439-0>,
    <https://d-nb.info/gnd/4010074-1>, <https://d-nb.info/gnd/4131503-0>;
  wdrs:describedby <https://d-nb.info/gnd/4030702-5/about> .

<https://d-nb.info/gnd/4030706-2> a gndo:SubjectHeadingSensoStricto .

<https://d-nb.info/gnd/4030706-2> gndo:preferredNameForTheSubjectHeading "Kirchenarchiv";
  gndo:variantNameForTheSubjectHeading "Kirchliches Archiv",
    "Kirchenarchive";
  skos:closeMatch embne:XX533627;
  gndo:broaderTermGeneric <https://d-nb.info/gnd/4002859-8> .
""")
gnd2, gnd2_edges = bi.parse_gnd_dump(gnd2_path)
check("GND: NS mapping on a continuation line kept (Kirche → 767)",
      ("gnd", "4030702-5", "ns", "767") in gnd2_edges, gnd2_edges)
check("GND: LCSH and prefixed RAMEAU mappings kept",
      {("gnd", "4030702-5", "lcsh", "sh85025502"), ("gnd", "4030702-5", "bnf", "cb119757086")} <= set(gnd2_edges),
      gnd2_edges)
check("GND: all four related terms kept",
      gnd2["4030702-5"].get("related") == ["4070730-1", "4073439-0", "4010074-1", "4131503-0"],
      gnd2.get("4030702-5"))
check("GND: variants on a continuation line kept",
      gnd2["4030706-2"].get("variants") == ["Kirchliches Archiv", "Kirchenarchive"], gnd2.get("4030706-2"))
check("GND: type from the first statement group", gnd2["4030702-5"].get("type") == "SubjectHeadingSensoStricto",
      gnd2.get("4030702-5"))
check("GND: embne: prefixed BNE mapping", ("gnd", "4030706-2", "bne", "XX533627") in gnd2_edges, gnd2_edges)
check("GND: broader after split statement groups", gnd2["4030706-2"].get("broader") == ["4002859-8"],
      gnd2.get("4030706-2"))

# In part of the dump the type statement comes AFTER the entity's data.
# Opening an entity at its "a gndo:" line gives it the label of
# the NEXT entity (7503347-1 showed "Mehrstellige Funktion"; 2,405 cases).
gnd3_path = write_fixture("gnd3.ttl", """@prefix gndo: <https://d-nb.info/standards/elementset/gnd#> .

<https://d-nb.info/gnd/7503347-1> gndo:gndIdentifier "7503347-1";
  gndo:preferredNameForTheSubjectHeading "Fürstenwappen";
  wdrs:describedby <https://d-nb.info/gnd/7503347-1/about> .

<https://d-nb.info/gnd/7503347-1> a gndo:SubjectHeadingSensoStricto .

<https://d-nb.info/gnd/7503349-5> gndo:gndIdentifier "7503349-5";
  gndo:variantNameForTheSubjectHeading "Multivariate Funktion";
  gndo:preferredNameForTheSubjectHeading "Mehrstellige Funktion";
  wdrs:describedby <https://d-nb.info/gnd/7503349-5/about> .

<https://d-nb.info/gnd/7503349-5> a gndo:SubjectHeadingSensoStricto .
""")
gnd3, _ = bi.parse_gnd_dump(gnd3_path)
check("GND: type after data — each entity keeps its own label",
      gnd3.get("7503347-1", {}).get("label") == "Fürstenwappen"
      and gnd3.get("7503349-5", {}).get("label") == "Mehrstellige Funktion", gnd3)
check("GND: type after data — variants not shifted to the previous entity",
      "variants" not in gnd3.get("7503347-1", {}) and gnd3["7503349-5"].get("variants") == ["Multivariate Funktion"], gnd3)

# Source order kept (pass 2 bridges depend on it); exactness carried per edge.
gnd4, gnd4_edges = bi.parse_gnd_dump(write_fixture("gnd4.ttl", """@prefix gndo: <https://d-nb.info/standards/elementset/gnd#> .
<https://d-nb.info/gnd/4148766-7> a gndo:SubjectHeadingSensoStricto ;
  gndo:preferredNameForTheSubjectHeading "Damnatio memoriae";
  skos:exactMatch ram:cb171563207;
  skos:closeMatch <http://purl.org/bncf/tid/47197>, <http://id.loc.gov/authorities/subjects/sh1>;
  skos:exactMatch <http://id.loc.gov/authorities/subjects/sh1> .
"""))
m_edges = [e for e in gnd4_edges if e[2] != "wd"]
check("GND: match edges keep the source order (closeMatch objects, then exactMatch)",
      [e[3] for e in m_edges] == ["47197", "sh1", "cb171563207"], m_edges)
check("GND: exactness carried per edge; a pair declared both ways is exact",
      [bi.is_exact(e) for e in m_edges] == [False, True, True], [bi.is_exact(e) for e in m_edges])

section("LCSH: label of the block's own subject")
lcsh2_path = write_fixture("lcsh2.ttl", """@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
# BEGIN /authorities/subjects/sh85137555

<http://id.loc.gov/authorities/subjects/sh85137555> a skos:Concept ;
skos:broader <http://id.loc.gov/authorities/subjects/sh85134686>,
<http://id.loc.gov/authorities/subjects/sh85137321> ;
skos:prefLabel "Trinity"@en ;
skos:related [ a skos:Concept ;
skos:prefLabel "Godhead (Mormon theology)"@en ],
<http://id.loc.gov/authorities/subjects/sh85061632> .

# END /authorities/subjects/sh85137555
# BEGIN /authorities/subjects/sh85097530

<http://id.loc.gov/authorities/subjects/sh85097530> a skos:Concept ;
skos:prefLabel "Papacy"@en ;
skos:related [ a skos:Concept ;
skos:prefLabel "Papal States--History"@en ] .

# END /authorities/subjects/sh85097530
""")
lcsh2 = bi.parse_lcsh_dump(lcsh2_path)
check("LCSH: nested node label does not replace the root (Trinity)",
      lcsh2.get("sh85137555", {}).get("label") == "Trinity", lcsh2.get("sh85137555"))
check("LCSH: broader list across lines kept",
      lcsh2.get("sh85137555", {}).get("broader") == ["sh85134686", "sh85137321"], lcsh2.get("sh85137555"))
check("LCSH: a nested compound label does not drop the heading (Papacy)",
      lcsh2.get("sh85097530", {}).get("label") == "Papacy", lcsh2.get("sh85097530"))

section("BNE / RAMEAU: language chosen explicitly, independent of line order")
P = "<http://www.w3.org/2004/02/skos/core#prefLabel>"
bne_rows = [
    f'<https://datos.bne.es/resource/XX525502> {P} "Trinidad"@es .\n',
    f'<https://datos.bne.es/resource/XX525502> {P} "Trinité"@fr .\n',
    f'<https://datos.bne.es/resource/XX525502> {P} "Hirutasuna"@eu .\n',
    f'<https://datos.bne.es/resource/XX526215> {P} "Esp\\u00EDritu Santo"@es .\n',
    f'<https://datos.bne.es/resource/XX526215> {P} "Espiritu Santua"@eu .\n',
    f'<https://datos.bne.es/resource/XX1> {P} "Only Basque"@eu .\n',
]
for name, rows in (("bne_fwd.nt", bne_rows), ("bne_rev.nt", list(reversed(bne_rows)))):
    d, _ = bi.parse_bne_dump(write_fixture(name, "".join(rows)))
    check(f"BNE ({name}): Spanish label, not the last line", d.get("XX525502", {}).get("label") == "Trinidad", d)
    check(f"BNE ({name}): \\u escape resolved", d.get("XX526215", {}).get("label") == "Espíritu Santo", d)
    check(f"BNE ({name}): no Spanish form → no label in another language", "XX1" not in d, d)

rameau_rows = (
    '<http://data.bnf.fr/ark:/12148/cb1> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> '
    '<http://www.w3.org/2004/02/skos/core#Concept> .\n'
    f'<http://data.bnf.fr/ark:/12148/cb1> {P} "Église"@fr .\n'
    f'<http://data.bnf.fr/ark:/12148/cb1> {P} "Ecclesia"@la .\n'
)
tar2 = os.path.join(TMP, "rameau2.tar.gz")
with tarfile.open(tar2, "w:gz") as tar:
    b = rameau_rows.encode("utf-8")
    info = tarfile.TarInfo(name="r.nt"); info.size = len(b)
    tar.addfile(info, io.BytesIO(b))
bnf2, _ = bi.parse_rameau_dump(tar2)
check("RAMEAU: French label kept although a Latin one comes later", bnf2.get("cb1", {}).get("label") == "Église", bnf2)

section("DNB mapping: every segment read")
import gzip, json
dnb_path = os.path.join(TMP, "dnb.jsonld.gz")
SK = "http://www.w3.org/2004/02/skos/core#closeMatch"
with gzip.open(dnb_path, "wt", encoding="utf-8") as f:
    json.dump([
        [{"@id": "https://d-nb.info/gnd/1", SK: [{"@id": "http://id.loc.gov/authorities/subjects/sh1"}]}],
        [{"@id": "https://d-nb.info/gnd/2", SK: [{"@id": "http://data.bnf.fr/ark:/12148/cb2"}]}],
    ], f)
dnb = bi.parse_dnb_mapping(dnb_path)
check("DNB: edges from the second segment too",
      dnb == [("gnd", "1", "lcsh", "sh1"), ("gnd", "2", "bnf", "cb2")], dnb)

# ── Clustering: pass 1 + pass 2 ─────────────────────────────────────
section("clustering (pass1_ns + pass2_enrich)")
clusters, assigned = bi.pass1_ns(ns)
check("cluster created from NS matches", clusters.get("100", {}).get("gnd") == "4005184-2", clusters)
check("assignment index populated as a one-to-many set", assigned.get("gnd:4005184-2") == {"100"}, assigned)
bi.pass2_enrich(clusters, assigned, [("gnd", "4005184-2", "lcsh", "sh85006611")])
check("pass2 pulls linked LCSH into cluster", clusters["100"].get("lcsh") == "sh85006611", clusters["100"])

# A collision must remain explicit and must not be silently overwritten or
# propagated through pass 2.
ns_collision = {
    "10": {"l": "animali mitici", "mx": {"gnd": "4016114-6"}},
    "20": {"l": "esseri immaginari", "mx": {"gnd": "4016114-6"}},
}
collision_clusters, collision_assigned = bi.pass1_ns(ns_collision)
check("reverse collision retains both primary concepts",
      collision_assigned.get("gnd:4016114-6") == {"10", "20"}, collision_assigned)
bi.pass2_enrich(collision_clusters, collision_assigned,
                [("gnd", "4016114-6", "lcsh", "sh-collision")])
check("ambiguous anchor is not propagated to either cluster",
      all("lcsh" not in cluster for cluster in collision_clusters.values()), collision_clusters)

# Local SBT preferred labels that are exact NS duplicates are removed in
# favour of the consortium's NS record, while unrelated SBT terms remain.
filtered_sbt, filtered_edges, removed_sbt = bi.drop_sbt_labels_already_in_ns(
    {"1": {"l": "Krav maga"}},
    {"SBT_1": {"l": "krav maga"}, "SBT_2": {"l": "termine locale"}},
    [("sbt_local", "SBT_1", "wd", "Q1"), ("sbt_local", "SBT_2", "wd", "Q2")],
)
check("duplicate SBT label removed in favour of NS", set(filtered_sbt) == {"SBT_2"}, filtered_sbt)
check("removed SBT edge removed too", filtered_edges == [("sbt_local", "SBT_2", "wd", "Q2")], filtered_edges)
check("removed SBT audit map retained", removed_sbt == {"SBT_1": "krav maga"}, removed_sbt)

section("single slot: exactMatch over closeMatch, secondary mappings")
E = bi.make_edge
check("exact edge equals the plain tuple (sets, membership, unpacking)",
      E("ns", "1", "gnd", "A", True) == ("ns", "1", "gnd", "A") and bi.is_exact(E("ns", "1", "gnd", "A", True))
      and not bi.is_exact(E("ns", "1", "gnd", "A")))
# NS dump declares a closeMatch; another source declares an exactMatch to a
# different GND id for the same concept → the exact one takes the slot.
cl_x, as_x = bi.pass1_ns({"1": {"l": "x", "mx": {"gnd": "CLOSE"}}, "2": {"l": "y", "mx": {"gnd": "TAKEN"}},
                          "3": {"l": "w", "mx": {"gnd": "CLOSE3"}}})
edges_x = [E("ns", "1", "gnd", "CLOSE"), E("gnd", "EXACT", "ns", "1", True), E("gnd", "EXACT-B", "ns", "1", True),
           E("gnd", "TAKEN", "ns", "3", True)]
_, swapped, collisions = bi.prefer_exact_slots("ns", cl_x, as_x, edges_x)
check("exact declaration takes the slot held by a close one", cl_x["1"]["gnd"] == "EXACT", cl_x)
check("two exacts: the first read keeps the slot (order, not alphabet)", cl_x["1"]["gnd"] != "EXACT-B", cl_x)
check("assignment index follows the swap", as_x.get("gnd:EXACT") == {"1"} and "gnd:CLOSE" not in as_x, dict(as_x))
check("no swap to an exact id already in another cluster (would create ambiguity)",
      collisions and collisions[0][2] == "TAKEN" and cl_x["3"]["gnd"] == "CLOSE3" and cl_x["2"]["gnd"] == "TAKEN",
      collisions)
# The primary thesaurus' own declaration comes first.
# NS 17458 Geografia regionale: BNCF closeMatch Regionale Geografie, DNB
# exactMatch Heimatkunde -> the BNCF one keeps the slot, Heimatkunde becomes
# a secondary mapping (still reaches 17458).
cl_o, as_o = bi.pass1_ns({"17458": {"l": "Geografia regionale", "mx": {"gnd": "4131549-2"}}})
edges_o = [E("ns", "17458", "gnd", "4131549-2"), E("gnd", "4127794-6", "ns", "17458", True),
           E("gnd", "4131549-2", "ns", "17458")]
_, sw_o, _ = bi.prefer_exact_slots("ns", cl_o, as_o, edges_o, frozenset({("17458", "gnd", "4131549-2")}))
check("own declaration of the NS concept is not replaced by another source's exact",
      cl_o["17458"]["gnd"] == "4131549-2" and not sw_o, cl_o)
sec_o = bi.secondary_direct_mappings("ns", "gnd", edges_o, {"4131549-2": ["17458"]}, {"17458"})
check("the exact declared elsewhere stays reachable as a secondary mapping (Heimatkunde)",
      sec_o == {"4127794-6": ["17458"]}, sec_o)
cl_p, as_p = bi.pass1_ns({"17458": {"l": "Geografia regionale", "mx": {"gnd": "4131549-2"}}})
bi.prefer_exact_slots("ns", cl_p, as_p, edges_o)
check("without the owner rule the exact would still take the slot (rule is the only change)",
      cl_p["17458"]["gnd"] == "4127794-6", cl_p)
# RAMEAU/IdRef is one vocabulary — the IdRef slot is the
# twin of the RAMEAU slot; a non-twin IdRef is displaced but stays reachable.
tw = bi.rameau_twins([E("bnf", "cbA", "idref", "PA", True), E("bnf", "cbB", "idref", "PB", True),
                      E("bnf", "cbC", "idref", "PC")])
check("RAMEAU twins come only from exactMatch BnF->IdRef", dict(tw) == {"cbA": ["PA"], "cbB": ["PB"]}, dict(tw))
cl_t = {"1": {"bnf": "cbA", "idref": "PX"}, "2": {"bnf": "cbB"}, "3": {"bnf": "cbA2"}}
as_t = bi.defaultdict(set, {"bnf:cbA": {"1"}, "idref:PX": {"1"}, "bnf:cbB": {"2"}, "bnf:cbA2": {"3"}})
bi.IDREF_DISPLACED.clear()
bi.pair_rameau_idref(cl_t, as_t, tw)
check("non-twin IdRef replaced by the twin of the RAMEAU slot", cl_t["1"]["idref"] == "PA" and as_t["idref:PA"] == {"1"}, cl_t)
check("empty IdRef slot filled with the twin", cl_t["2"]["idref"] == "PB", cl_t)
check("RAMEAU without a known twin: IdRef slot left as it is", "idref" not in cl_t["3"], cl_t)
check("displaced IdRef kept for a secondary mapping", dict(bi.IDREF_DISPLACED) == {"PX": ["1"]}, dict(bi.IDREF_DISPLACED))
bi.IDREF_DISPLACED.clear()
# One RAMEAU/IdRef table — both ids, label, BT/NT/RT,
# thesaurus terms only (no places, names, titles).
T = ["r166"]
bnf_t = {"cbA": {"label": "Dictionnaires", "broader": ["cbP", "cbG"], "related": ["cbR"], "parts": T},
         "cbB": {"label": "Lexiques", "parts": T},
         "cbP": {"label": "Ouvrages de référence", "parts": T}, "cbR": {"label": "Lexicographie", "parts": T},
         "cbG": {"label": "Ariège (France)", "parts": ["r167"]},
         "cbK": {"label": "Francophonie", "parts": ["r166", "r167"]},
         "cbF": {"label": "Silène (mythologie grecque)", "parts": ["r160"]},
         "cbO": {"label": "Bibliothèque nationale de France", "parts": ["r161", "r166"]},
         "cbS": {"label": "Suisse", "parts": ["r167"]},
         "cbM": {"label": "Concertos", "parts": ["genre", "r166"]}, "cbN": {"label": "Concertos (orchestre)", "parts": ["r166"]},
         "cbX": {"label": "Dictionnaires anglais", "parts": T}, "cbY": {"label": "Lexique", "parts": T}}
edges_t = [E("bnf", "cbA", "idref", "P1", True), E("bnf", "cbB", "idref", "P1", True),
           E("bnf", "cbP", "idref", "P0", True), E("bnf", "cbR", "idref", "PR"),
           E("bnf", "cbG", "idref", "PG", True), E("bnf", "cbS", "idref", "PS", True),
           E("bnf", "cbM", "idref", "P2", True), E("bnf", "cbN", "idref", "P2", True),
           E("bnf", "cbX", "idref", "P3", True), E("bnf", "cbY", "idref", "P3", True)]
asked = []
def fake_lookup(ppns):
    asked.extend(ppns)
    return {"P1": {"label": "Dictionnaires", "arks": ["cbA"]},           # IdRef links one ark
            "P2": {"label": "Concertos (orchestre)", "arks": []}}         # same wording
    # P3: IdRef not reached -> fixed rule
tab, rep_t = bi.build_rameau_idref_table(bnf_t, edges_t, fake_lookup, keep_arks=frozenset({"cbS"}))
check("table: thesaurus heading with label, twin, BT, NT, RT (place neighbour dropped)",
      tab["e"]["cbA"] == ["Dictionnaires", "P1", ["cbP"], [], ["cbR"]] and tab["e"]["cbP"][3] == ["cbA"], tab["e"].get("cbA"))
check("table: geographic names alone stay out", "cbG" not in tab["e"], sorted(tab["e"]))
check("table: common nouns RAMEAU also tags as geographic stay in (rule B)", "cbK" in tab["e"], sorted(tab["e"]))
check("table: fictional figures and corporate bodies stay out", "cbF" not in tab["e"] and "cbO" not in tab["e"], sorted(tab["e"]))
check("table: a heading the NS index uses stays, even a place (no French label lost)", "cbS" in tab["e"], sorted(tab["e"]))
check("table: genre headings are thesaurus terms", "cbM" in tab["e"], sorted(tab["e"]))
check("table: 'voir aussi' is symmetric", tab["e"]["cbR"][4] == ["cbA"], tab["e"]["cbR"])
check("table: a closeMatch is not a twin", tab["e"]["cbR"][1] == "", tab["e"]["cbR"])
check("table: IdRef is asked only about PPNs with several headings", sorted(asked) == ["P1", "P2", "P3"], asked)
check("conflict: the ark IdRef links wins", tab["pc"]["P1"] == "cbA", tab["pc"])
check("conflict: else IdRef's own wording", tab["pc"]["P2"] == "cbN", tab["pc"])
check("conflict: else the shortest heading (IdRef not reached)", tab["pc"]["P3"] == "cbY", tab["pc"])
check("conflict report says how", rep_t[2]["how"].startswith("regola fissa"), rep_t)
# A concept the NS declares nothing for takes the RAMEAU heading that declares it,
# and only that directly (Dizionari etimologici <- Dictionnaires etymologiques).
cl_e, as_e = {"10393": {}}, bi.defaultdict(set, {"ns:10393": {"10393"}})
bi.pass2_enrich(cl_e, as_e, [E("gnd", "G1", "ns", "10393"), E("bnf", "cb120918791", "ns", "10393"),
                             E("bnf", "cb120918791", "lcsh", "sh1")], "ns", frozenset(), rameau_only=frozenset({"10393"}))
check("empty NS concept: RAMEAU declaring it fills the slot, then bridges as usual",
      cl_e["10393"].get("bnf") == "cb120918791" and cl_e["10393"].get("lcsh") == "sh1", cl_e)
check("empty NS concept: other direct declarations do not fill it (unchanged)", "gnd" not in cl_e["10393"], cl_e)
# Two close declarations: order of reading still decides (unchanged rule).
cl_y, as_y = bi.pass1_ns({"6011": {"l": "Eucaristia", "mx": {"gnd": "4000081-3"}}})
edges_y = [E("ns", "6011", "gnd", "4000081-3"), E("gnd", "4015644-8", "ns", "6011"), E("ns", "6011", "gnd", "4015644-8")]
bi.prefer_exact_slots("ns", cl_y, as_y, edges_y)
check("close vs close: slot unchanged (Abendmahl)", cl_y["6011"]["gnd"] == "4000081-3", cl_y)
sec = bi.secondary_direct_mappings("ns", "gnd", edges_y, {"4000081-3": ["6011"]}, {"6011"})
check("displaced direct declaration becomes a secondary mapping (Eucharistie → 6011)",
      sec == {"4015644-8": ["6011"]}, sec)
sec2 = bi.secondary_direct_mappings("ns", "gnd", [E("gnd", "G", "lcsh", "L"), E("lcsh", "L", "ns", "9")], {}, {"9"})
check("no secondary mapping through a third vocabulary", sec2 == {}, sec2)
# pass 2 keeps source order; an all-exact path displaces a close one in the same slot
cl_z, as_z = bi.pass1_ns({"5": {"l": "z", "mx": {"gnd": "G5"}}})
bi.pass2_enrich(cl_z, as_z, [E("gnd", "G5", "lcsh", "sh-close"), E("gnd", "G5", "lcsh", "sh-exact", True)],
                "ns", {("5", "gnd", "G5")})
check("pass 2: exact path replaces a close one read earlier", cl_z["5"].get("lcsh") == "sh-exact"
      and "lcsh:sh-close" not in as_z and as_z.get("lcsh:sh-exact") == {"5"}, cl_z)
# a chain is as strong as its weakest link (Eucaristia: NS —close→ Q66086 —sameAs→ Eucharistie)
cl_e, as_e = bi.pass1_ns({"6011": {"l": "Eucaristia", "mx": {"wd": "Q66086"}}})
bi.pass2_enrich(cl_e, as_e, [E("gnd", "4000081-3", "ns", "6011"), E("gnd", "4015644-8", "wd", "Q66086", True)],
                "ns", set())
check("pass 2: exact last hop after a close hop does not displace a direct close (Abendmahl stays)",
      cl_e["6011"].get("gnd") == "4000081-3", cl_e)
# ...and not once the close one has bridged to another slot
cl_b, as_b = bi.pass1_ns({"6": {"l": "b", "mx": {"gnd": "G6"}}})
bi.pass2_enrich(cl_b, as_b, [E("gnd", "G6", "bnf", "cb-close"), E("bnf", "cb-close", "idref", "I1", True),
                             E("gnd", "G6", "bnf", "cb-exact", True)], "ns", {("6", "gnd", "G6")})
check("pass 2: a close slot already used as bridge is kept (its IdRef depends on it)",
      cl_b["6"].get("bnf") == "cb-close" and cl_b["6"].get("idref") == "I1", cl_b)
# order-dependent bridge preserved (GND→BnF close, then BnF→IdRef exact)
cl_o, as_o = bi.pass1_ns({"8": {"l": "o", "mx": {"gnd": "G8"}}})
bi.pass2_enrich(cl_o, as_o, [E("gnd", "G8", "bnf", "cb8"), E("bnf", "cb8", "idref", "I8", True)], "ns", set())
check("pass 2: bridge through a close slot still reaches IdRef", cl_o["8"].get("idref") == "I8", cl_o)
ns_e = bi.parse_ns_skos(write_fixture("ns_exact.ttl", """<http://purl.org/bncf/tid/7> a skos:Concept ;
    skos:prefLabel "p"@it ;
    skos:closeMatch <http://d-nb.info/gnd/C1> ;
    skos:exactMatch <http://d-nb.info/gnd/E1> .
"""))
check("NS dump: exactMatch seeds the slot, every declared id kept",
      ns_e["7"]["mx"]["gnd"] == "E1" and ("gnd", "C1", False) in ns_e["7"]["mxa"] and ("gnd", "E1", True) in ns_e["7"]["mxa"],
      ns_e["7"])

section("mapping direction evidence")
evidence_edges = {
    ("ns", "100", "gnd", "G"), ("gnd", "G", "ns", "100"),
    ("ns", "100", "idref", "I"),
    ("lcsh", "L", "ns", "100"),
}
check("reciprocal mapping wins", bi.mapping_evidence("ns", "100", "gnd", "G", evidence_edges) == {"id": "G", "c": 3, "d": "both"})
check("primary-to-external direction retained", bi.mapping_evidence("ns", "100", "idref", "I", evidence_edges) == {"id": "I", "c": 2, "d": "out"})
check("external-to-primary direction retained", bi.mapping_evidence("ns", "100", "lcsh", "L", evidence_edges) == {"id": "L", "c": 1, "d": "in"})
check("inferred mapping identified", bi.mapping_evidence("ns", "100", "bne", "B", evidence_edges) == {"id": "B", "c": 0, "d": "inferred"})

# ── Confidence grading ──────────────────────────────────────────────
section("confidence grading (_grade_ns)")
idx = bi._build_edge_index([
    ("ns", "100", "gnd", "G"), ("gnd", "G", "ns", "100"),
    ("ns", "100", "bnf", "B"), ("bnf", "B", "ns", "100"),
    ("gnd", "G", "bnf", "B"), ("bnf", "B", "gnd", "G"),
    ("ns", "500", "gnd", "G5"),
], {})
check("grade 1: full bidirectional triangle", bi._grade_ns("100", {"gnd": "G", "bnf": "B"}, idx) == 1)
check("grade 3: single one-way link", bi._grade_ns("500", {"gnd": "G5"}, idx) == 3)
check("grade 2: single bidirectional link", bi._grade_ns("100", {"gnd": "G"}, idx) == 2)
check("grade 3: wikidata-only cluster", bi._grade_ns("900", {"wd": "Q1"}, idx) == 3)
check("grade 4: empty cluster", bi._grade_ns("900", {}, idx) == 4)

# ── Wikidata enrichment (multi-property backlinks) ───────────
section("enrich_wikidata (multi-property backlinks)")


class _FakeResp:
    status_code = 200

    def __init__(self, payload):
        self._p = payload

    def json(self):
        return self._p


section("arks the RAMEAU dump no longer contains")
# NS 3299 Immagini: the BNE file links XX530997 to cb119409512, an ark the
# BnF replaced by «Illustrations» (another heading); NS 4564 Omelie got
# cb12008248x («Bible») through the DNB mapping.
dead = [E("bne", "XX530997", "bnf", "cb119409512", True), E("gnd", "4160556-1", "bnf", "cb12008248x"),
        E("gnd", "4006568-6", "bnf", "cbLIVE", True), E("bnf", "cbLIVE", "lcsh", "sh1")]
kept = bi.drop_dead_arks(dead, {"cbLIVE": {"label": "Images"}})
check("links to arks absent from the RAMEAU dump are left out, the others kept with their strength",
      kept == [("gnd", "4006568-6", "bnf", "cbLIVE"), ("bnf", "cbLIVE", "lcsh", "sh1")] and bi.is_exact(kept[0]), kept)
cl_d = bi.build_clusters("ns", {"27226": {"l": "Macchiaioli", "mx": {"bnf": "cbNSONLY"}}}, {}, [],
                            {}, [], {}, [], [E("bne", "XX1", "bnf", "cbGONE")], [])[0]
check("an ark declared by the NS itself is kept even if absent from the dump",
      cl_d.get("27226", {}).get("bnf") == "cbNSONLY", cl_d)

section("exact links of headings without an NS concept")
links = bi.exact_links(
    [E("gnd", "G1", "wd", "Q1", True), E("bnf", "cbA", "wd", "Q1", True),       # same Wikidata item
     E("bnf", "cbA", "idref", "PPN_A", True),                                    # RAMEAU twin
     E("gnd", "G2", "bnf", "cbC", True), E("gnd", "G2", "bnf", "cbB", True),     # two candidates
     E("gnd", "G3", "bnf", "cbD"),                                               # closeMatch only
     E("gnd", "G4", "bnf", "cbD", True),                                         # reaches NS
     E("gnd", "G5", "lcsh", "sh5", True)],
    {"gnd": {"G4": ["100"]}}, {"cbA": ["Doctorants", "PPN_A"], "cbB": ["Autre", ""], "cbC": ["C", ""], "cbD": ["D", ""]}, {},
    {"G1": "Doktorand"}, {"sh5": "Doctoral students"}, {})
check("GND and RAMEAU declaring the same Wikidata item: the GND heading gets the RAMEAU one",
      links["gnd"].get("G1") == {"bnf": "cbA"}, links)
check("the IdRef twin gets the GND heading through its RAMEAU ark", links["idref"].get("PPN_A") == {"gnd": "G1"}, links)
check("two candidates, a closeMatch, or an id that reaches NS: nothing",
      "G2" not in links["gnd"] and "G3" not in links["gnd"] and "G4" not in links["gnd"], links)
check("a direct exact link with a local label is kept", links["gnd"].get("G5") == {"lcsh": "sh5"}, links)

class _FakeRequests:
    """Answers only the P269 backlink for PPN1; every other query is empty.
    Injected via sys.modules so the `import requests` inside
    enrich_wikidata() picks it up — no network in tests."""

    @staticmethod
    def get(url, params=None, headers=None, timeout=None):
        q = (params or {}).get("query", "")
        if "wdt:P269" in q and '"PPN1"' in q:
            return _FakeResp({"results": {"bindings": [
                {"id": {"value": "PPN1"},
                 "item": {"value": "http://www.wikidata.org/entity/Q39"}}]}})
        return _FakeResp({"results": {"bindings": []}})


sys.modules["requests"] = _FakeRequests
clusters_wd = {
    "n1": {"idref": "PPN1"},                # IdRef-only: resolvable via P269
    "n2": {"gnd": "G-unlinked"},            # GND without a WD backlink
    "n3": {"gnd": "G2", "wd": "Q_existing"} # already resolved: must not change
}
bi.enrich_wikidata(clusters_wd, batch_size=10)
check("idref-only cluster got QID via P269", clusters_wd["n1"].get("wd") == "Q39", clusters_wd)
check("unlinked gnd cluster left without QID", "wd" not in clusters_wd["n2"], clusters_wd)
check("existing QID untouched", clusters_wd["n3"]["wd"] == "Q_existing", clusters_wd)


class _FlakyRequests:
    """Wikidata times out on the first call, then answers."""
    calls = 0

    @staticmethod
    def get(url, params=None, headers=None, timeout=None):
        _FlakyRequests.calls += 1
        if _FlakyRequests.calls == 1:
            raise TimeoutError("read timeout")
        q = (params or {}).get("query", "")
        if '"G-flaky"' in q:
            return _FakeResp({"results": {"bindings": [
                {"id": {"value": "G-flaky"}, "item": {"value": "http://www.wikidata.org/entity/Q7"}}]}})
        return _FakeResp({"results": {"bindings": []}})


sys.modules["requests"] = _FlakyRequests
_real_sleep, bi.sleep = bi.sleep, (lambda s: None)
clusters_fl = {"n1": {"gnd": "G-flaky"}}
bi.enrich_wikidata(clusters_fl, batch_size=10)
bi.sleep = _real_sleep
check("a Wikidata batch that times out is asked again, not skipped", clusters_fl["n1"].get("wd") == "Q7", clusters_fl)

# Ids from the dumps are escaped in the SPARQL text;
# ordinary ids are unchanged, so the queries — and the build — stay the same.
check("SPARQL literal: ordinary id unchanged", bi.sparql_literal("4005184-2") == '"4005184-2"')
check("SPARQL literal: quote escaped", bi.sparql_literal('a"b') == '"a\\"b"', bi.sparql_literal('a"b'))
check("SPARQL literal: backslash and newline escaped",
      bi.sparql_literal("c\\d\ne") == '"c\\\\d\\ne"', bi.sparql_literal("c\\d\ne"))

print("\n" + "=" * 30)
print(f"RESULT: {passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
