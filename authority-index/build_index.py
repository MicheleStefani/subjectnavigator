#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py  —  Unified Authority Index Builder
===========================================================
General-purpose: supports NS-centric (default), GND-centric, IdRef-centric builds.

Copies to the extension folder (see EXT_DIR); sanity thresholds on
the parsers — a silent format drift in the upstream dumps now aborts the
build instead of producing a valid-looking but crippled index. Golden
tests for the parsers live in tests/test_parsers.py.
Wikidata enrichment resolves QIDs through every authority backlink
(P227/P269/P244/P268/P950) instead of GND-only — clusters without a GND id
no longer leave the build without a QID.

Usage
-----
  python build_index.py                           NS-centric (default)
  python build_index.py --primary-vocab gnd       GND-centric
  python build_index.py --primary-vocab idref     IdRef-centric
  python build_index.py --check                   check source files, no rebuild
  python build_index.py --slim-only               rebuild EN/ES slim labels only
  python build_index.py --no-wikidata             skip Wikidata enrichment
  python build_index.py --skip-copy               do not copy to extension dir

Primary vocab effects
---------------------
  NS    : concept keys are NS TIDs; bt/nt/rt from NS SKOS; grade axis NS↔GND + NS↔BnF
  GND   : concept keys are GND IDs; bt/nt/rt from GND dump (nt derived by inversion)
  IdRef : concept keys are IdRef IDs; bt/nt/rt derived from BnF hierarchy via ID mapping
"""

import os
import re
import csv
import sys
import json
import gzip
import bz2
import tarfile
import hashlib
import shutil
import argparse
import unicodedata
import xml.etree.ElementTree as ET
import urllib.request
from collections import defaultdict, Counter
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone
from time import sleep

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import turtle_reader as tr


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR = Path(__file__).resolve().parent
DATA_DIR   = os.environ.get("SN_DATA_DIR", str(SCRIPT_DIR / "data"))
# The extension lives at the repository root, next to authority-index/.
EXT_DIR    = os.environ.get("SN_EXTENSION_DIR", str(SCRIPT_DIR.parent))
OUTPUT_ROOT = Path(os.environ.get("SN_OUTPUT_DIR", str(SCRIPT_DIR / "output")))

# Output directories per primary vocab
OUTPUT_DIRS = {
    "ns":    str(OUTPUT_ROOT),
    "gnd":   str(OUTPUT_ROOT.parent / (OUTPUT_ROOT.name + "_gnd")),
    "idref": str(OUTPUT_ROOT.parent / (OUTPUT_ROOT.name + "_idref")),
}

NS_SKOS_TTL       = f"{DATA_DIR}/ns_skos.ttl"
GND_DUMP_GZ       = f"{DATA_DIR}/authorities-gnd-sachbegriff_lds.ttl.gz"
RAMEAU_DUMP_TARGZ = f"{DATA_DIR}/databnf_rameau_nt.tar.gz"
LCSH_DUMP_TTL     = f"{DATA_DIR}/subjects.skosrdf.ttl"
BNE_DUMP_NT       = f"{DATA_DIR}/materias.nt"
# BNE authority files of datosabiertos.bne.es («Catálogo de
# autoridades. Materia» and «Género/Forma», MARCXML, CC0, March 2025). Used
# instead of materias.nt when both are in the data folder (downloaded by hand:
# www.bne.es answers programs with a Cloudflare human check).
BNE_MARCXML_FILES = [f"{DATA_DIR}/materia-MARCXML.xml", f"{DATA_DIR}/generoforma-MARCXML.xml"]
DNB_MAPPING_GZ    = f"{DATA_DIR}/mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz"
NSOGG_MAPPING_GZ  = f"{DATA_DIR}/mapping-authorities-gnd-nsogg_lds.jsonld.gz"
SBT_CSV           = f"{DATA_DIR}/SBT-THESAURUS-csv.csv"
NS_INDEX_CACHE    = f"{DATA_DIR}/ns_index.json"
BUILD_USER_AGENT  = "SubjectNavigator-build (https://github.com/MicheleStefani/subjectnavigator)"
METADATA_FILE     = os.environ.get("SN_METADATA_FILE", str(SCRIPT_DIR / "build_metadata.json"))

REMOTE_SOURCES = {
    "lcsh": "https://id.loc.gov/download/authorities/subjects.skosrdf.ttl.gz",
    # materias.nt.bz2 is no longer published; the new portal
    # (datosabiertos.bne.es) has «Materia» and «Género/Forma» in MARCXML.
    # www.bne.es answers programs with a Cloudflare check: download by hand.
    "bne":  "https://www.bne.es/media/datosgob/catalogo-autoridades/materia/materia-MARCXML.xml",
    "gnd":  "https://data.dnb.de/opendata/authorities-gnd-sachbegriff_lds.ttl.gz",
    # "bnf": "https://transfert.bnf.fr/link/7da54f6e-34e0-48c5-b7c3-f3912cdcf355",  # update each release
    # "ns":  "https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All",
}

EXTENSION_FILES = [
    ("unified_index_core.json", "unified_index_core.json"),
    ("labels_de.json",          "labels_de.json"),
    ("rameau_idref.json",       "rameau_idref.json"),   # Replaces labels_fr + hierarchy_bnf
    ("labels_en_slim.json",     "labels_en_slim.json"),
    ("labels_es_slim.json",     "labels_es_slim.json"),
    ("hierarchy_gnd.json",      "hierarchy_gnd.json"),
    ("notes_gnd.json",          "notes_gnd.json"),      # GND definitions
    ("notes_rameau.json",       "notes_rameau.json"),   # RAMEAU notes
    ("exact_links.json",        "exact_links.json"),    # Exact links outside NS
]


# ══════════════════════════════════════════════════════════════════════════════
# UTILITIES
# ══════════════════════════════════════════════════════════════════════════════

def banner(title):
    print(f"\n{'═'*60}")
    print(f"  {title}")
    print(f"{'═'*60}")

def sha256_file(path, chunk=1 << 20):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf: break
            h.update(buf)
    return h.hexdigest()

def http_head(url, timeout=12):
    req = urllib.request.Request(url, method="HEAD")
    req.add_header("User-Agent", BUILD_USER_AGENT)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return {"last_modified": r.headers.get("Last-Modified"),
                    "etag": r.headers.get("ETag"),
                    "size_bytes": r.headers.get("Content-Length")}
    except Exception as e:
        return {"error": str(e)}

def open_auto(path, mode="rt", encoding="utf-8"):
    p = str(path).lower()
    if p.endswith(".gz"):
        return gzip.open(path, mode, encoding=encoding if "t" in mode else None)
    if p.endswith(".bz2"):
        return bz2.open(path, mode, encoding=encoding if "t" in mode else None)
    return open(path, mode, encoding=encoding)


# ══════════════════════════════════════════════════════════════════════════════
# UPDATE CHECK
# ══════════════════════════════════════════════════════════════════════════════

LOCAL_FILES = {
    "ns":   NS_SKOS_TTL,
    "gnd":  GND_DUMP_GZ,
    "bnf":  RAMEAU_DUMP_TARGZ,
    "lcsh": LCSH_DUMP_TTL,
    "bne":  BNE_MARCXML_FILES[0] if os.path.exists(BNE_MARCXML_FILES[0]) else BNE_DUMP_NT,
}

def run_check():
    banner("UPDATE CHECK")
    prev_meta = {}
    if os.path.exists(METADATA_FILE):
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            prev_meta = json.load(f)
        print(f"Previous build: {prev_meta.get('built_at', '?')}\n")
    else:
        print("No previous metadata found — first run.\n")

    current_meta = {"built_at": datetime.now(timezone.utc).isoformat(), "files": {}, "remote": {}}
    changed_local = []

    print("Local file checksums:")
    for name, path in LOCAL_FILES.items():
        if not os.path.exists(path):
            print(f"  {name:6}: MISSING  ({path})")
            continue
        sha   = sha256_file(path)
        size  = round(os.path.getsize(path) / 1024 / 1024, 2)
        mtime = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc).isoformat()
        current_meta["files"][name] = {"sha256": sha, "mtime": mtime, "size_mb": size}
        prev_sha = prev_meta.get("files", {}).get(name, {}).get("sha256")
        if prev_sha is None:          status = "NEW"
        elif prev_sha != sha:         status = "CHANGED  ⚠"; changed_local.append(name)
        else:                         status = "unchanged"
        print(f"  {name:6}: {sha[:14]}…  {size:7.1f} MB  {status}")

    print("\nRemote HTTP headers:")
    for name, url in REMOTE_SOURCES.items():
        info = http_head(url)
        current_meta["remote"][name] = info
        prev_etag = prev_meta.get("remote", {}).get(name, {}).get("etag")
        cur_etag  = info.get("etag")
        flag = "  ⚠  ETag changed" if (prev_etag and cur_etag and prev_etag != cur_etag) else ""
        if info.get("error"):
            print(f"  {name:6}: ERROR: {info['error']}")
        else:
            print(f"  {name:6}: Last-Modified={info.get('last_modified','?')}  ETag={info.get('etag','?')}{flag}")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(current_meta, f, ensure_ascii=False, indent=2)
    print(f"\nMetadata saved to {METADATA_FILE}")

    needs_full = any(n in changed_local for n in ("ns", "gnd", "bnf"))
    needs_slim = not needs_full and any(n in changed_local for n in ("lcsh", "bne"))
    if changed_local:
        print(f"\nChanged files: {changed_local}")
        if needs_full:   print("→ Full rebuild required.")
        elif needs_slim: print("→ Slim-only rebuild sufficient.")
    else:
        print("\nNo changes detected.")
    return changed_local, needs_full, needs_slim


# ══════════════════════════════════════════════════════════════════════════════
# PARSERS  (unchanged from v101)
# ══════════════════════════════════════════════════════════════════════════════

class ExactEdge(tuple):
    """A mapping edge declared with skos:exactMatch. It IS the plain
    (src_auth, src_id, tgt_auth, tgt_id) tuple — same equality, hash and
    unpacking — so only the type carries the extra information."""
    __slots__ = ()


def make_edge(s_type, s_id, t_type, t_id, exact=False):
    t = (s_type, s_id, t_type, t_id)
    return ExactEdge(t) if exact else t


def is_exact(edge):
    return isinstance(edge, ExactEdge)


def exact_first(edges):
    """Stable order: exactMatch edges before closeMatch ones. When several
    candidates compete for the single slot of a cluster, the equivalence
    declared as exact wins over the approximate one; order of reading
    decides only between edges of the same strength."""
    return sorted(edges, key=lambda e: 0 if is_exact(e) else 1)


NS_TID_RX = re.compile(r"^https?://purl\.org/bncf/tid/(\d+)$")
NS_MATCH_PATTERNS = [
    (re.compile(r"wikidata\.org/entity/(Q\d+)"),               "wd"),
    (re.compile(r"d-nb\.info/gnd/([\w.-]+)"),                  "gnd"),
    (re.compile(r"data\.bnf\.fr/ark:/12148/(cb\w+)"),          "bnf"),
    (re.compile(r"id\.loc\.gov/authorities/subjects/(sh\w+)"), "lcsh"),
    (re.compile(r"vocab\.getty\.edu/aat/(\d+)"),               "aat"),
    (re.compile(r"datos\.bne\.es/resource/(\w+)"),             "bne"),
]


def _ns_tids(values, own):
    """NS concept ids from IRIs, without duplicates or self-references."""
    out = []
    for v in values:
        m = NS_TID_RX.match(v)
        if m and m.group(1) != own:
            out.append(m.group(1))
    return tr.unique(out)


def parse_ns_skos(ttl_path):
    """NS SKOS export. Statement-aware reading — every object of a
    comma-separated list is kept (a line-by-line reading keeps only the first
    BT/NT/RT and altLabel of each list), and triple-quoted notes are read correctly."""
    print(f"Parsing NS SKOS from {ttl_path}…")
    rejected = []
    subjects = {}
    with open(ttl_path, "r", encoding="utf-8") as f:
        for subject, props in tr.iter_statement_groups(f, rejected=rejected):
            if not isinstance(subject, str):
                continue
            m = NS_TID_RX.match(subject)
            if not m:
                continue
            merged = subjects.setdefault(m.group(1), {})
            for pred, objs in props.items():
                merged.setdefault(pred, []).extend(objs)
    concepts = {}
    for tid, props in subjects.items():
        if tr.SKOS + "Concept" not in props.get("a", ()):
            continue
        c = {}
        pl = tr.literals(props, tr.SKOS + "prefLabel", lang="it")
        if pl: c["l"] = pl[0]
        for key, pred in (("bt", "broader"), ("nt", "narrower"), ("rt", "related")):
            ids = _ns_tids(tr.iris(props, tr.SKOS + pred), tid)
            if ids: c[key] = ids
        ddc = [o.value for o in props.get(tr.SKOS + "notation", ())
               if isinstance(o, tr.Literal) and o.datatype == "http://dewey.info"]
        if ddc: c["d"] = ddc[0]
        sn = tr.literals(props, tr.SKOS + "scopeNote")
        if sn: c["sn"] = sn[0]
        df = tr.literals(props, tr.SKOS + "definition")
        if df: c["df"] = df[0]
        alt = tr.unique(tr.literals(props, tr.SKOS + "altLabel"))
        if alt: c["al"] = alt
        # Matches: every declared id is kept in "mxa" as (auth, id, exact);
        # "mx" (one per authority, the cluster seed) prefers an exactMatch
        # over a closeMatch, then source order.
        exact_iris = set(tr.iris(props, tr.SKOS + "exactMatch"))
        mxa, seen = [], set()
        for iri in (o for objs in props.values() for o in objs if isinstance(o, str)):
            for rx, key in NS_MATCH_PATTERNS:
                m2 = rx.search(iri)
                if m2:
                    if (key, m2.group(1)) not in seen:
                        seen.add((key, m2.group(1)))
                        mxa.append((key, m2.group(1), iri in exact_iris))
                    break
        mx = {}
        for key, aid, exact in sorted(mxa, key=lambda x: not x[2]):
            mx.setdefault(key, aid)
        if mx: c["mx"] = mx
        if mxa: c["mxa"] = mxa
        concepts[tid] = c
    print(f"  Parsed {len(concepts)} NS concepts"
          + (f"  (unreadable statement groups skipped: {len(rejected)})" if rejected else ""))
    return concepts


def load_ns():
    """Always parse NS from the SKOS TTL source file (no JSON cache)."""
    if not os.path.exists(NS_SKOS_TTL):
        sys.exit(f"ERROR: NS SKOS file not found: {NS_SKOS_TTL}")
    return parse_ns_skos(NS_SKOS_TTL)


def load_sbt():
    sbt_concepts = {}
    sbt_wd_edges = []
    if not os.path.exists(SBT_CSV):
        print(f"WARNING: SBT CSV not found: {SBT_CSV}")
        return sbt_concepts, sbt_wd_edges
    print(f"Loading SBT from {SBT_CSV}…")
    seen = set()
    with open(SBT_CSV, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Thesaurus", "") != "SBT": continue
            sbt_id = row.get("SBT_ID", "").strip()
            if not sbt_id or sbt_id in seen: continue
            seen.add(sbt_id)
            tid   = f"SBT_{sbt_id}"
            label = row.get("Termine preferito", "").strip()
            if not label: continue
            c = {"l": label, "src": "sbt"}
            macro = row.get("Macrocategoria", "").strip()
            cat   = row.get("Categoria", "").strip()
            if macro or cat:
                c["cat"] = f"{macro}/{cat}" if macro and cat else macro or cat
            npt = row.get("Termine non preferito", "").strip()
            if npt: c["al"] = [npt]
            qid = row.get("WDQID", "").strip()
            if qid:
                c.setdefault("mx", {})["wd"] = qid
                sbt_wd_edges.append(("sbt_local", tid, "wd", qid))
            sbt_concepts[tid] = c
    print(f"  SBT terms: {len(sbt_concepts)}, with WD QID: {sum(1 for c in sbt_concepts.values() if 'mx' in c)}")
    return sbt_concepts, sbt_wd_edges


def drop_sbt_labels_already_in_ns(ns_concepts, sbt_concepts, sbt_wd_edges):
    """NS is authoritative when an SBT preferred label duplicates an NS preferred label."""
    ns_labels = {unicodedata.normalize("NFKC", c.get("l", "")).casefold().strip()
                 for c in ns_concepts.values() if c.get("l")}
    removed = {
        tid: c["l"] for tid, c in sbt_concepts.items()
        if unicodedata.normalize("NFKC", c.get("l", "")).casefold().strip() in ns_labels
    }
    if not removed:
        return sbt_concepts, sbt_wd_edges, removed
    filtered_concepts = {tid: c for tid, c in sbt_concepts.items() if tid not in removed}
    filtered_edges = [edge for edge in sbt_wd_edges if edge[1] not in removed]
    print(f"  SBT preferred-label duplicates removed in favour of NS: {len(removed)}")
    for tid, label in sorted(removed.items(), key=lambda item: item[1].casefold()):
        print(f"    {tid}: {label}")
    return filtered_concepts, filtered_edges, removed


GND_ID_RX = re.compile(r"^https?://d-nb\.info/gnd/([^/]+)$")
GND_MATCH_PATTERNS = [
    (re.compile(r"id\.loc\.gov/authorities/subjects/(sh\w+)"), "lcsh"),
    (re.compile(r"data\.bnf\.fr/ark:/12148/(cb\w+)"),          "bnf"),
    (re.compile(r"purl\.org/bncf/tid/(\d+)"),                  "ns"),
    (re.compile(r"vocab\.getty\.edu/aat/(\d+)"),               "aat"),
    (re.compile(r"datos\.bne\.es/resource/(XX\w+)"),           "bne"),
]
GND_BROADER = [tr.GNDO + p for p in ("broaderTermGeneral", "broaderTermGeneric",
                                     "broaderTermPartitive", "broaderTermInstantial")]


def _gnd_ids(values, own):
    out = []
    for v in values:
        m = GND_ID_RX.match(v)
        if m and m.group(1) != own:
            out.append(m.group(1))
    return tr.unique(out)


def parse_gnd_dump(gz_path):
    """GND subject headings (DNB lds Turtle). Statement-aware reading.
    The dump spreads each entity over several statement groups and continues
    predicate lists on following lines; a line-by-line reading loses every continuation line
    (e.g. Kirche → NS 767, half of its related terms, many variants)."""
    print(f"Parsing GND dump from {gz_path}…")
    rejected = []
    entities = {}   # gnd id -> merged props, in first-seen order
    edges    = []
    seen_edges = {}  # (auth, gnd id, target id) -> position in edges
    with open_auto(gz_path) as f:
        for subject, props in tr.iter_statement_groups(f, rejected=rejected):
            if not isinstance(subject, str):
                continue
            m = GND_ID_RX.match(subject)
            if not m:
                continue
            gid = m.group(1)
            if gid not in entities and len(entities) % 50000 == 49999:
                print(f"  … {len(entities) + 1} entities")
            merged = entities.setdefault(gid, {})
            for pred, objs in props.items():
                merged.setdefault(pred, []).extend(objs)
            # Edges keep source order (clustering is first-come per slot).
            for wd in tr.iris(props, "http://www.w3.org/2002/07/owl#sameAs"):
                m2 = re.search(r"wikidata\.org/entity/(Q\d+)", wd)
                if m2 and ("wd", gid, m2.group(1)) not in seen_edges:
                    seen_edges[("wd", gid, m2.group(1))] = len(edges)
                    edges.append(make_edge("gnd", gid, "wd", m2.group(1), exact=True))  # owl:sameAs
            # Source order (closeMatch objects, then exactMatch):
            # pass 2 is order-sensitive, reordering loses bridges. A pair
            # declared both ways keeps its first position and becomes exact.
            exact_iris = set(tr.iris(props, tr.SKOS + "exactMatch"))
            for iri in tr.iris(props, tr.SKOS + "closeMatch", tr.SKOS + "exactMatch"):
                for rx, auth in GND_MATCH_PATTERNS:
                    m2 = rx.search(iri)
                    if m2:
                        key = (auth, gid, m2.group(1))
                        exact = iri in exact_iris
                        if key not in seen_edges:
                            seen_edges[key] = len(edges)
                            edges.append(make_edge("gnd", gid, auth, m2.group(1), exact))
                        elif exact and not is_exact(edges[seen_edges[key]]):
                            edges[seen_edges[key]] = make_edge("gnd", gid, auth, m2.group(1), True)
                        break
    gnd_data = {}
    entity_count = 0
    for gid, props in entities.items():
        types = [t for t in props.get("a", ()) if isinstance(t, str) and t.startswith(tr.GNDO)]
        if not types:
            continue
        entity_count += 1
        labels = tr.literals(props, tr.GNDO + "preferredNameForTheSubjectHeading")
        if not labels:
            continue
        d = {"type": types[0][len(tr.GNDO):], "label": labels[0]}
        variants = tr.unique(tr.literals(props, tr.GNDO + "variantNameForTheSubjectHeading"))
        if variants: d["variants"] = variants
        broader = _gnd_ids(tr.iris(props, *GND_BROADER), gid)
        if broader: d["broader"] = broader
        related = _gnd_ids(tr.iris(props, tr.GNDO + "relatedTerm"), gid)
        if related: d["related"] = related
        # The GND definition, shown under a GND heading.
        definition = tr.literals(props, tr.GNDO + "definition")
        if definition: d["definition"] = definition[0]
        gnd_data[gid] = d
    for s, gid, t, tid in edges:
        if t == "wd" and gid in gnd_data:
            gnd_data[gid].setdefault("wd", tid)
    print(f"  GND entities: {entity_count}, labelled: {len(gnd_data)}, edges: {len(edges)}"
          + (f"  (unreadable statement groups skipped: {len(rejected)})" if rejected else ""))
    for et, c in Counter(f"{s}→{t}" for s,_,t,_ in edges).most_common():
        print(f"    {et}: {c}")
    return gnd_data, edges


def parse_rameau_dump(targz_path):
    print(f"Parsing RAMEAU dump from {targz_path}…")
    bnf_data    = {}
    edges       = []
    SKOS        = "http://www.w3.org/2004/02/skos/core#"
    line_count  = 0
    concept_ids = set()
    pref_labels = defaultdict(list)   # sid -> [(value, lang)] in source order

    def bnf_id(uri):
        m = re.search(r"ark:/12148/(cb\w+)", uri)
        return m.group(1) if m else None

    with tarfile.open(targz_path, "r:gz") as tar:
        for member in tar.getmembers():
            if not member.name.endswith(".nt"): continue
            print(f"  File: {member.name}  ({member.size/1024/1024:.1f} MB)")
            fh = tar.extractfile(member)
            if fh is None: continue
            for raw in fh:
                line_count += 1
                if line_count % 1_000_000 == 0:
                    print(f"    … {line_count//1_000_000}M lines")
                try:
                    line = raw.decode("utf-8").strip()
                except Exception:
                    continue
                if not line or line.startswith("#"): continue
                t = tr.parse_nt_line(line)
                if not t: continue
                subj, pred, obj_uri, obj_lit, lang = t
                sid = bnf_id(subj)
                if not sid or "#about" in subj: continue
                if pred.endswith("type") and obj_uri and "Concept" in obj_uri:
                    concept_ids.add(sid); bnf_data.setdefault(sid, {}); continue
                if pred == SKOS + "prefLabel" and obj_lit:
                    # French (else untagged) regardless of line order;
                    # (not whichever prefLabel comes last).
                    bnf_data.setdefault(sid, {})
                    pref_labels[sid].append((obj_lit, lang)); continue
                if pred == SKOS + "broader" and obj_uri:
                    bt = bnf_id(obj_uri)
                    if bt: bnf_data.setdefault(sid, {}).setdefault("broader", []).append(bt); continue
                if pred == SKOS + "narrower" and obj_uri:
                    nt = bnf_id(obj_uri)
                    if nt: bnf_data.setdefault(sid, {}).setdefault("narrower", []).append(nt); continue
                # The RAMEAU part, as named on data.bnf.fr
                # (vocabulary/rameau/…): r166 «Noms communs (et noms de peuples,
                # de batailles, etc.)», r167 «Noms géographiques», r160
                # «Personnages fictifs, mythologiques ou légendaires, divinités»,
                # r161 «Nom de collectivité», r164 «Titres de publications en
                # série», genre, form.
                if pred == "http://purl.org/dc/terms/isPartOf" and obj_uri and "/vocabulary/rameau/" in obj_uri:
                    part = obj_uri.rstrip("/").split("/")[-1]
                    parts = bnf_data.setdefault(sid, {}).setdefault("parts", [])
                    if part not in parts: parts.append(part)
                    continue
                # RAMEAU "voir aussi" — related headings, shown
                # as RT in the hierarchy like the GND related terms.
                # skos:note is RAMEAU's definition / note for the
                # public («Procédé permettant d'obtenir l'image durable…»).
                # skos:scopeNote holds cataloguing instructions («Voir aussi la
                # subdivision…») and skos:editorialNote the sources: not read.
                if pred == SKOS + "note" and obj_lit:
                    bnf_data.setdefault(sid, {}).setdefault("notes", []).append(obj_lit); continue
                if pred == SKOS + "related" and obj_uri:
                    rt = bnf_id(obj_uri)
                    if rt and rt != sid: bnf_data.setdefault(sid, {}).setdefault("related", []).append(rt); continue
                if (pred == SKOS+"closeMatch" or pred == SKOS+"exactMatch") and obj_uri:
                    for pat, auth in (
                        (r"d-nb\.info/gnd/([\w.-]+)",                      "gnd"),
                        (r"id\.loc\.gov/authorities/(?:subjects/)?(sh\w+)", "lcsh"),
                        (r"wikidata\.org/entity/(Q\d+)",                    "wd"),
                        (r"idref\.fr/([0-9A-Z]+)",                          "idref"),
                        (r"purl\.org/bncf/tid/(\d+)",                       "ns"),
                    ):
                        m2 = re.search(pat, obj_uri)
                        if m2: edges.append(make_edge("bnf", sid, auth, m2.group(1), pred == SKOS + "exactMatch")); break
    for sid, candidates in pref_labels.items():
        label = tr.pick_label(candidates, ("fr", "")) or candidates[0][0]
        bnf_data[sid]["label"] = label
    bnf_concepts = {k: v for k, v in bnf_data.items() if k in concept_ids and "label" in v}
    print(f"  Lines: {line_count}, SKOS concepts: {len(bnf_concepts)}, edges: {len(edges)}")
    for et, c in Counter(f"{s}→{t}" for s,_,t,_ in edges).most_common():
        print(f"    {et}: {c}")
    return bnf_concepts, edges


def parse_lcsh_dump(ttl_path):
    print(f"Parsing LCSH from {ttl_path}  ({os.path.getsize(ttl_path)/1024/1024:.0f} MB)…")
    """LoC subjects skosrdf Turtle, one '# BEGIN … # END' block per heading.
    The label is the prefLabel of the block's own subject, not the last
    prefLabel line of the block, which can belong to a nested
    related/broader node (sh85137555 Trinity → "Godhead (Mormon theology)")
    and, when such a nested label contains '--', would drop the heading."""
    lcsh_data = {}
    count = skipped_compound = skipped_781 = 0
    rejected = []
    prefixes = tr.new_prefixes()
    lcsh_base = "http://id.loc.gov/authorities/subjects/"

    def finish(aid, lines):
        nonlocal skipped_compound
        try:
            stmts = tr.parse_statements("".join(lines), prefixes)
        except (tr.Incomplete, ValueError):
            rejected.append(aid); return
        root = lcsh_base + aid
        props = {}
        for subject, p in stmts:
            if subject == root:
                for pred, objs in p.items():
                    props.setdefault(pred, []).extend(objs)
        labels = tr.literals(props, tr.SKOS + "prefLabel", lang="en")
        if not labels:
            return
        if "--" in labels[0]:
            skipped_compound += 1; return
        entry = {"label": labels[0]}
        broader = tr.unique(i[len(lcsh_base):] for i in tr.iris(props, tr.SKOS + "broader")
                            if i.startswith(lcsh_base) and i[len(lcsh_base):] != aid)
        if broader: entry["broader"] = broader
        lcsh_data[aid] = entry

    current_id, lines = None, []
    with open(ttl_path, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("@prefix"):
                try: tr.parse_statements(line, prefixes)
                except (tr.Incomplete, ValueError): pass
                continue
            if line.startswith("# BEGIN"):
                if current_id: finish(current_id, lines)
                current_id, lines = None, []
                m = re.search(r"subjects/(sh\d+(?:-781)?)\s*$", line)
                if m:
                    raw_id = m.group(1)
                    if raw_id.endswith("-781"):
                        skipped_781 += 1; continue
                    current_id = raw_id; count += 1
                    if count % 100_000 == 0: print(f"  … {count} concepts")
                continue
            if line.startswith("# END"):
                if current_id: finish(current_id, lines)
                current_id, lines = None, []
                continue
            if current_id: lines.append(line)
    if current_id: finish(current_id, lines)
    print(f"  LCSH simple terms: {len(lcsh_data)}  (skipped: {skipped_compound} compound, {skipped_781} -781)"
          + (f"  (unreadable blocks: {len(rejected)})" if rejected else ""))
    return lcsh_data


def parse_bne_dump(nt_path):
    print(f"Parsing BNE from {nt_path}  ({os.path.getsize(nt_path)/1024/1024:.0f} MB)…")
    bne_data = {}
    edges    = []
    SKOS     = "http://www.w3.org/2004/02/skos/core#"
    skipped_compound = line_count = 0
    pref_labels = defaultdict(list)   # bid -> [(value, lang)] in source order

    def bne_id(uri):
        m = re.search(r"datos\.bne\.es/resource/(XX\w+)", uri)
        return m.group(1) if m else None

    with open_auto(nt_path) as f:
        for line in f:
            line_count += 1
            if line_count % 1_000_000 == 0:
                print(f"  … {line_count//1_000_000}M lines, {len(bne_data)} concepts")
            line = line.strip()
            if not line or line.startswith("#"): continue
            t = tr.parse_nt_line(line)
            if not t: continue
            subj, pred, obj_uri, obj_lit, lang = t
            bid = bne_id(subj)
            if not bid: continue
            if pred == SKOS + "prefLabel" and obj_lit:
                # Keep the language; the label is chosen after the
                # whole file is read (keeping the last line, whatever its
                # language, made 67% of the "Spanish" labels ca/en/eu/fr/gl).
                pref_labels[bid].append((obj_lit, lang)); continue
            if pred == SKOS + "inScheme" and obj_uri:
                bne_data.setdefault(bid, {})["scheme"] = obj_uri.split("/")[-1]; continue
            if pred == SKOS + "broader" and obj_uri:
                bt = bne_id(obj_uri)
                if bt: bne_data.setdefault(bid, {}).setdefault("broader", []).append(bt); continue
            if (pred == SKOS+"closeMatch" or pred == SKOS+"exactMatch") and obj_uri:
                for pat, auth in (
                    (r"id\.loc\.gov/authorities/subjects/(sh\w+)", "lcsh"),
                    (r"wikidata\.org/(?:entity|wiki)/(Q\d+)",      "wd"),
                    (r"d-nb\.info/gnd/([\w.-]+)",                  "gnd"),
                    (r"data\.bnf\.fr/ark:/12148/(cb\w+)",          "bnf"),
                ):
                    m2 = re.search(pat, obj_uri)
                    if m2: edges.append(make_edge("bne", bid, auth, m2.group(1), pred == SKOS + "exactMatch")); break
    for bid, candidates in pref_labels.items():
        label = tr.pick_label(candidates, ("es", ""))
        if label is None:
            continue            # no Spanish form: better no label than a wrong language
        if "--" in label:
            skipped_compound += 1; continue
        bne_data.setdefault(bid, {})["label"] = label
    bne_data = {k: v for k, v in bne_data.items() if "label" in v}
    print(f"  Lines: {line_count}, simple concepts: {len(bne_data)}, edges: {len(edges)}")
    return bne_data, edges


# BNE authority records in MARCXML. Same output as
# parse_bne_dump: a Spanish label for headings without subdivisions (150
# topic, 151 place, 155 genre/form, 148 period) and for subdivision records
# of one element (180-185, e.g. 185 «$v Diccionarios», a concept the NS
# links as Dizionari), links from 024 with their
# source in $2 — LCSH, RAMEAU/BnF, Wikidata and, new, the Nuovo Soggettario
# (nsbncf). materias.nt declared every link as closeMatch: these stay close.
BNE_024_SOURCES = {
    "lcsh":     ("lcsh", r"id\.loc\.gov/authorities/subjects/(sh\w+)"),
    "rameau":   ("bnf",  r"(?:data|ark)\.bnf\.fr/(?:fr/)?ark:/12148/(cb\w+)"),
    "bnf":      ("bnf",  r"(?:data|ark)\.bnf\.fr/(?:fr/)?ark:/12148/(cb\w+)"),
    "wikidata": ("wd",   r"wikidata\.org/(?:entity|wiki)/(Q\d+)"),
    "nsbncf":   ("ns",   r"purl\.org/bncf/tid/(\d+)"),
}
BNE_HEADING_TAGS = {"150", "151", "155", "148"}
BNE_SUBDIVISION_TAGS = {"180", "181", "182", "185"}


def parse_bne_marcxml(paths):
    bne_data, edges = {}, []
    records = compound = 0
    for path in paths:
        print(f"Parsing BNE MARCXML from {path}  ({os.path.getsize(path)/1024/1024:.0f} MB)…")
        for _, el in ET.iterparse(path, events=("end",)):
            if el.tag.rsplit("}", 1)[-1] != "record":
                continue
            records += 1
            bid = heading = None
            links = []
            for f in el:
                tag = f.get("tag")
                subs = [(sf.get("code"), (sf.text or "").strip()) for sf in f]
                if tag == "035":
                    for _, v in subs:
                        m = re.match(r"\(SpMaBN\)(XX\w+)", v)
                        if m: bid = m.group(1)
                elif (tag in BNE_HEADING_TAGS or tag in BNE_SUBDIVISION_TAGS) and heading is None:
                    heading = subs if tag in BNE_HEADING_TAGS else [("a", v) for c, v in subs if c in "vxyz" and v]
                    if tag in BNE_SUBDIVISION_TAGS and len(heading) > 1:
                        heading = heading[:1] + [("x", v) for _, v in heading[1:]]   # two or more: compound
                elif tag == "024":
                    src = BNE_024_SOURCES.get(next((v for c, v in subs if c == "2"), ""))
                    if src:
                        for c, v in subs:
                            m = re.search(src[1], v) if c == "a" else None
                            if m: links.append((src[0], m.group(1)))
            el.clear()
            if not bid:
                continue
            for auth, tid in links:
                edges.append(make_edge("bne", bid, auth, tid, False))
            if not heading:
                continue
            if any(c in ("v", "x", "y", "z") for c, _ in heading):
                compound += 1; continue
            label = " ".join(v for c, v in heading if c == "a" and v)
            if label:
                bne_data[bid] = {"label": label}
    print(f"  Records: {records}, simple headings: {len(bne_data)}, with subdivisions: {compound}, edges: {len(edges)}")
    for et, c in Counter(t for _, _, t, _ in edges).most_common():
        print(f"    bne→{et}: {c}")
    return bne_data, edges


def load_bne():
    """The MARCXML files of the new BNE portal when present,
    else the datos.bne.es N-Triples dump."""
    if all(os.path.exists(p) for p in BNE_MARCXML_FILES):
        return parse_bne_marcxml(BNE_MARCXML_FILES)
    return parse_bne_dump(BNE_DUMP_NT)


def parse_dnb_mapping(gz_path):
    print(f"Parsing DNB mapping from {gz_path}…")
    with open_auto(gz_path) as f:
        data = json.load(f)
    # The file is a list of segments (46 in the 2025-09 release);
    # data[0] alone is only ~3% of the GND↔LCSH↔RAMEAU mappings.
    if data and isinstance(data[0], list):
        entries = [item for segment in data for item in segment]
    else:
        entries = data
    edges = []
    def extract_id(uri):
        if "d-nb.info/gnd/"                      in uri: return "gnd",  uri.split("/")[-1]
        if "id.loc.gov/authorities/subjects/"     in uri: return "lcsh", uri.split("/")[-1]
        m = re.search(r"ark:/12148/(cb\w+)", uri)
        if m: return "bnf", m.group(1)
        return None, None
    for entry in entries:
        s_type, s_id = extract_id(entry.get("@id", ""))
        if not s_type: continue
        for prop in ["http://www.w3.org/2004/02/skos/core#closeMatch",
                     "http://www.w3.org/2004/02/skos/core#exactMatch"]:
            for obj in entry.get(prop, []):
                t_type, t_id = extract_id(obj.get("@id", ""))
                if t_type and t_id:
                    edges.append(make_edge(s_type, s_id, t_type, t_id, prop.endswith("exactMatch")))
    print(f"  Entries: {len(entries)}, edges: {len(edges)}  (exactMatch: {sum(map(is_exact, edges))})")
    return edges


def parse_nsogg_mapping(gz_path):
    """Parse DNB's GND↔NS (Nuovo Soggettario) cross-mapping.
    The file is a JSON-LD list of 5 segments; each entry maps a bncf/tid NS concept
    to one or more GND concepts via skos:closeMatch / skos:exactMatch.
    Returns (ns, tid, gnd, gnd_id) edges — complementing the sparse NS links
    already present in the GND TTL dump (~830 edges → ~9,000 with this file)."""
    if not os.path.exists(gz_path):
        print(f"  NSOGG mapping not found ({gz_path}) — skipped.")
        return []
    print(f"Parsing GND↔NS mapping from {gz_path}…")
    with open_auto(gz_path) as f:
        data = json.load(f)
    # Top level is a list of 5 sub-lists — flatten all of them
    if data and isinstance(data[0], list):
        entries = [item for sublist in data for item in sublist]
    else:
        entries = data
    re_ns  = re.compile(r"purl\.org/bncf/tid/(\d+)")
    re_gnd = re.compile(r"d-nb\.info/gnd/([^/\s\"]+)")
    edges  = []
    for entry in entries:
        ns_m = re_ns.search(entry.get("@id", ""))
        if not ns_m:
            continue
        ns_id = ns_m.group(1)
        for prop in ["http://www.w3.org/2004/02/skos/core#closeMatch",
                     "http://www.w3.org/2004/02/skos/core#exactMatch"]:
            for obj in entry.get(prop, []):
                gnd_m = re_gnd.search(obj.get("@id", ""))
                if gnd_m:
                    edges.append(make_edge("ns", ns_id, "gnd", gnd_m.group(1), prop.endswith("exactMatch")))
    print(f"  Entries: {len(entries):,}, GND↔NS edges: {len(edges):,}  (exactMatch: {sum(map(is_exact, edges)):,})")
    return edges


# ══════════════════════════════════════════════════════════════════════════════
# CLUSTERING — Pass 1 (vocab-specific)
# ══════════════════════════════════════════════════════════════════════════════

def pass1_ns(ns_concepts):
    """Create NS-centric clusters from NS SKOS match declarations."""
    clusters    = {}  # tid → {auth: id, ...}
    assigned    = defaultdict(set)  # "auth:id" → {tid, ...}; collisions are preserved
    for tid, c in ns_concepts.items():
        mx = c.get("mx", c.get("cl", {}))
        if not mx: continue
        cluster = {}
        for auth, aid in mx.items():
            if isinstance(aid, list): aid = aid[0]
            cluster[auth] = aid
        if cluster:
            clusters[tid] = cluster
            assigned[f"ns:{tid}"].add(tid)
            for auth, aid in cluster.items():
                assigned[f"{auth}:{aid}"].add(tid)
    print(f"  NS concepts with matches: {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned


def pass1_gnd(gnd_edges, gnd_data):
    """Create GND-centric clusters from GND outgoing match edges."""
    clusters = {}   # gnd_id → {auth: id, ...}
    assigned = defaultdict(set)   # "auth:id" → {gnd_id, ...}

    # Group GND outgoing edges; first match per target vocab wins
    gnd_out = defaultdict(dict)
    for s_type, s_id, t_type, t_id in gnd_edges:
        if s_type != "gnd": continue
        if t_type == "wd": continue  # add WD separately below
        if t_type not in gnd_out[s_id]:
            gnd_out[s_id][t_type] = t_id
    # Add Wikidata from gnd_data directly
    for gnd_id, d in gnd_data.items():
        if "wd" in d and gnd_id in gnd_out:
            gnd_out[gnd_id].setdefault("wd", d["wd"])

    for gnd_id, targets in gnd_out.items():
        if not targets or gnd_id not in gnd_data: continue
        cluster = dict(targets)
        clusters[gnd_id] = cluster
        assigned[f"gnd:{gnd_id}"].add(gnd_id)
        for auth, aid in cluster.items():
            key = f"{auth}:{aid}"
            assigned[key].add(gnd_id)

    print(f"  GND concepts with matches: {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned


def pass1_idref(bnf_edges, bnf_data):
    """Create IdRef-centric clusters from BnF→IdRef exactMatch declarations."""
    clusters    = {}   # idref_id → {auth: id, ...}
    assigned    = defaultdict(set)   # "auth:id" → {idref_id, ...}
    bnf_to_idref = {}  # bnf_id → idref_id

    # First pass: find all BnF→IdRef matches
    for s_type, s_id, t_type, t_id in bnf_edges:
        if s_type == "bnf" and t_type == "idref":
            if t_id not in clusters:
                clusters[t_id]   = {"bnf": s_id}
                bnf_to_idref[s_id] = t_id
                assigned[f"idref:{t_id}"].add(t_id)
                assigned[f"bnf:{s_id}"].add(t_id)

    # Second pass: pull other matches (gnd, ns, lcsh, wd…) into each IdRef cluster
    for s_type, s_id, t_type, t_id in bnf_edges:
        if s_type != "bnf" or t_type == "idref": continue
        idref_id = bnf_to_idref.get(s_id)
        if idref_id is None: continue
        cluster = clusters[idref_id]
        if t_type not in cluster:
            cluster[t_type] = t_id
            key = f"{t_type}:{t_id}"
            assigned[key].add(idref_id)

    print(f"  IdRef concepts (from BnF matches): {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned, bnf_to_idref


# ══════════════════════════════════════════════════════════════════════════════
# CLUSTERING — Passes 2-4 (universal)
# ══════════════════════════════════════════════════════════════════════════════

def prefer_exact_slots(primary_vocab, clusters, assigned, all_ext_edges, owner_decl=frozenset()):
    """A cluster has ONE slot per authority. When the primary concept
    has several DIRECT declarations for that authority (from any source), an
    exactMatch takes the slot over a closeMatch; between declarations of the
    same strength the previous rule (order of reading) is unchanged.
    The declaration of the primary thesaurus itself comes
    first. A slot seeded from the concept's own match (owner_decl: (pid,
    auth, id) declared by the BNCF for an NS concept) is not swapped for an
    id that only another source declares as exact (NS 17458 Geografia
    regionale: BNCF -> Regionale Geografie, DNB exact -> Heimatkunde).
    The displaced id is not lost: it stays in the edge set, and for GND it is
    added to the reverse index as a secondary mapping (see assemble_and_save).
    A swap that would give the exact id to a second cluster is skipped and
    counted: it would create an ambiguity instead of resolving one."""
    exact_pairs = {}   # insertion-ordered: source order decides between two exacts
    for e in all_ext_edges:
        if not is_exact(e): continue
        s, sid, t, tid = e
        if s == primary_vocab: exact_pairs.setdefault((sid, t, tid), True)
        elif t == primary_vocab: exact_pairs.setdefault((tid, s, sid), True)
    swapped, collisions, kept_owner = [], [], []
    for pid, auth, aid in exact_pairs:
        cluster = clusters.get(pid)
        if cluster is None or auth == primary_vocab: continue
        cur = cluster.get(auth)
        if cur is None or cur == aid or (pid, auth, cur) in exact_pairs:
            continue   # empty slot (pass 2 fills it, exact first) or already exact
        if (pid, auth, cur) in owner_decl and (pid, auth, aid) not in owner_decl:
            kept_owner.append((pid, auth, cur, aid)); continue
        others = assigned.get(f"{auth}:{aid}", set()) - {pid}
        if others:
            collisions.append((pid, auth, aid, sorted(others))); continue
        assigned[f"{auth}:{cur}"].discard(pid)
        if not assigned[f"{auth}:{cur}"]: del assigned[f"{auth}:{cur}"]
        cluster[auth] = aid
        assigned[f"{auth}:{aid}"].add(pid)
        swapped.append((pid, auth, cur, aid))
    print(f"  Direct exactMatch declarations: {len(exact_pairs)}  |  close → exact slot swaps: {len(swapped)}"
          f"  |  skipped (exact id already in another cluster): {len(collisions)}"
          f"  |  kept (declared by the primary thesaurus): {len(kept_owner)}")
    for pid, auth, cur, aid in kept_owner:
        print(f"    {pid} {auth}: {cur} kept (own declaration), {aid} (exact elsewhere) becomes secondary")
    for pid, auth, cur, aid in swapped[:15]:
        print(f"    {pid} {auth}: {cur} (close) → {aid} (exact)")
    return set(exact_pairs), swapped, collisions


def secondary_direct_mappings(primary_vocab, authority, all_ext_edges, reverse_for_auth, known_pids):
    """Direct primary↔authority declarations that did not get the
    cluster slot (one slot per authority). Returned as {auth_id: [pid, …]},
    exactMatch before closeMatch, to be appended AFTER the slot holders in the
    reverse index: an id that already reaches a concept through its slot keeps
    it first. Only direct declarations — never chains through a third
    vocabulary."""
    found = defaultdict(list)
    for e in exact_first(all_ext_edges):
        s, sid, t, tid = e
        if s == primary_vocab and t == authority: pid, aid = sid, tid
        elif t == primary_vocab and s == authority: pid, aid = tid, sid
        else: continue
        if pid not in known_pids or pid in (reverse_for_auth.get(aid) or []) or pid in found[aid]:
            continue
        found[aid].append(pid)
    return {aid: pids for aid, pids in found.items() if pids}


# IdRef ids displaced from a slot by the RAMEAU/IdRef pairing: idref -> [pid].
# Filled by pair_rameau_idref(), read by assemble_and_save() (secondaries).
IDREF_DISPLACED = defaultdict(list)


def rameau_twins(all_ext_edges):
    """BnF ark -> IdRef ids, from the exactMatch the RAMEAU dump declares."""
    twins = defaultdict(list)
    for e in all_ext_edges:
        if is_exact(e) and {e[0], e[2]} == {"bnf", "idref"}:
            b, i = (e[1], e[3]) if e[0] == "bnf" else (e[3], e[1])
            if i not in twins[b]:
                twins[b].append(i)
    return twins


def pair_rameau_idref(clusters, assigned, twins):
    """RAMEAU and IdRef are one vocabulary (IdRef uses the
    RAMEAU headings; RAMEAU is read only because IdRef publishes no dump).
    The IdRef slot of a cluster is therefore the twin of its RAMEAU slot,
    never chosen on its own. An IdRef id displaced this way stays reachable
    as a secondary mapping (IDREF_DISPLACED)."""
    filled = fixed = conflict = 0
    for pid, cl in clusters.items():
        b = cl.get("bnf")
        t = (twins.get(b) or [None])[0] if b else None
        cur = cl.get("idref")
        if not t or cur == t:
            continue
        if assigned.get(f"idref:{t}", set()) - {pid}:
            conflict += 1      # twin already holds another concept's slot
            continue
        if cur:
            assigned[f"idref:{cur}"].discard(pid)
            if not assigned[f"idref:{cur}"]: del assigned[f"idref:{cur}"]
            IDREF_DISPLACED[cur].append(pid)
            fixed += 1
        else:
            filled += 1
        cl["idref"] = t
        assigned[f"idref:{t}"].add(pid)
    print(f"  RAMEAU/IdRef pairs: empty IdRef slots filled {filled}, non-twin IdRef replaced {fixed}, "
          f"twin already elsewhere {conflict}")


def pass2_enrich(clusters, assigned, all_ext_edges, primary_vocab=None, exact_pairs=frozenset(), trace=None,
                 rameau_only=frozenset()):
    """Enrich clusters with additional cross-vocab edges (same logic for all vocabs).

    A candidate is "exact" for the primary concept only if EVERY hop
    from the concept to it is exact (a chain is as strong as its weakest
    link: NS —close→ Q66086 —sameAs→ GND Eucharistie is a close relation).
    Such a candidate displaces a close one that entered the same slot earlier
    in this pass, unless that one has already bridged to another slot."""
    enriched = rej_no_cluster = rej_already = rej_slot = rej_ambiguous = 0
    exact_swaps = exact_blocked = 0
    filled = {}      # (pid, auth) -> exact path? for slots filled in THIS pass
    bridged = set()  # (pid, auth) slots already used to reach another slot

    def path_exact(pid, auth):
        if auth == primary_vocab: return True
        if (pid, auth) in filled: return filled[(pid, auth)]
        return (pid, auth, clusters[pid].get(auth)) in exact_pairs   # seed slot
    for edge in all_ext_edges:
        s_type, s_id, t_type, t_id = edge
        sk, tk = f"{s_type}:{s_id}", f"{t_type}:{t_id}"
        source_pids = assigned.get(sk, set())
        target_pids = assigned.get(tk, set())
        if trace and (sk in trace or tk in trace):   # debugging aid: python -c, see docs
            print(f"    trace {'exact' if is_exact(edge) else 'close'} {sk} → {tk}: "
                  f"src={sorted(source_pids)} tgt={sorted(target_pids)}")
        if source_pids and target_pids: continue
        if not source_pids and not target_pids: rej_no_cluster += 1; continue
        active_pids = source_pids or target_pids
        if len(active_pids) != 1:
            rej_ambiguous += 1
            continue
        cluster_pid = next(iter(active_pids))
        if source_pids:
            cand_type, cand_id, cand_key, via_type = t_type, t_id, tk, s_type
        else:
            cand_type, cand_id, cand_key, via_type = s_type, s_id, sk, t_type
        if cand_key in assigned: rej_already += 1; continue
        # A concept the NS declares nothing for (empty cluster)
        # takes, directly, only the RAMEAU heading that declares it; the rest
        # follows through that heading as for any other cluster.
        if cluster_pid in rameau_only and via_type == primary_vocab and cand_type != "bnf":
            rej_slot += 1; continue
        cluster = clusters[cluster_pid]
        cand_exact = is_exact(edge) and path_exact(cluster_pid, via_type)
        if cand_type in cluster:
            # An exact path displaces a close one that entered the
            # same slot earlier in this pass — unless that one has already
            # served as a bridge (then other additions depend on it).
            slot = (cluster_pid, cand_type)
            if cand_exact and filled.get(slot) is False:
                if slot in bridged:
                    exact_blocked += 1
                else:
                    old_key = f"{cand_type}:{cluster[cand_type]}"
                    assigned[old_key].discard(cluster_pid)
                    if not assigned[old_key]: del assigned[old_key]
                    cluster[cand_type] = cand_id
                    assigned[cand_key].add(cluster_pid)
                    filled[slot] = True
                    bridged.add((cluster_pid, via_type))
                    exact_swaps += 1
                    continue
            rej_slot += 1; continue
        cluster[cand_type] = cand_id
        assigned[cand_key].add(cluster_pid)
        filled[(cluster_pid, cand_type)] = cand_exact
        bridged.add((cluster_pid, via_type))
        enriched += 1
    print(f"  Added: {enriched}  |  No cluster: {rej_no_cluster}  |  Ambiguous anchor: {rej_ambiguous}  |  Slot occupied: {rej_slot}")
    print(f"  close → exact replacements: {exact_swaps}  |  not replaced (close already used as bridge): {exact_blocked}")
    print("  Coverage after enrichment:")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")


def pass3_sbt(ns_clusters, assigned, sbt_concepts, sbt_wd_edges):
    """Integrate SBT local terms (NS-centric only)."""
    sbt_clusters = {}
    sbt_enriched = 0
    for sbt_tid, c in sbt_concepts.items():
        mx = c.get("mx", {})
        if not mx: continue
        cluster = {}
        for auth, aid in mx.items():
            cluster[auth] = aid
            assigned[f"{auth}:{aid}"].add(sbt_tid)
        sbt_clusters[sbt_tid] = cluster
    for sbt_tid, cl in list(sbt_clusters.items()):
        qid = cl.get("wd")
        if not qid: continue
        ns_tid = next((tid for tid, ns_cl in ns_clusters.items() if ns_cl.get("wd") == qid), None)
        if ns_tid:
            sbt_concepts[sbt_tid]["ns_equiv"] = ns_tid
            sbt_enriched += 1
            del sbt_clusters[sbt_tid]
    print(f"  SBT terms with NS equivalent via WD: {sbt_enriched}")
    print(f"  Independent SBT clusters: {len(sbt_clusters)}")
    return sbt_clusters


def pass4_orphans(assigned, all_ext_edges):
    """Identify orphan clusters: external terms linked to each other but not to any primary cluster."""
    class UF:
        def __init__(self): self.p = {}; self.r = {}
        def find(self, x):
            if x not in self.p: self.p[x]=x; self.r[x]=0
            if self.p[x]!=x: self.p[x]=self.find(self.p[x])
            return self.p[x]
        def union(self, x, y):
            rx,ry=self.find(x),self.find(y)
            if rx==ry: return
            if self.r[rx]<self.r[ry]: rx,ry=ry,rx
            self.p[ry]=rx
            if self.r[rx]==self.r[ry]: self.r[rx]+=1
    uf = UF()
    for s_type,s_id,t_type,t_id in all_ext_edges:
        sk,tk=f"{s_type}:{s_id}",f"{t_type}:{t_id}"
        if sk not in assigned and tk not in assigned:
            uf.union(sk, tk)
    orphan_raw = defaultdict(set)
    for x in uf.p: orphan_raw[uf.find(x)].add(x)
    orphan_clusters = []
    for _, members in orphan_raw.items():
        cd = defaultdict(list)
        for node in members:
            at, ai = node.split(":", 1)
            cd[at].append(ai)
        orphan_clusters.append(dict(cd))
    print(f"  Orphan clusters: {len(orphan_clusters)}")
    return orphan_clusters


def drop_dead_arks(edges, bnf_data):
    """The mappings of other sources (DNB GND–RAMEAU, BNE)
    still carry arks that the RAMEAU dump no longer contains: headings the
    BnF deleted (data.bnf.fr answers 410) or replaced by another one (it
    redirects, e.g. «Images» → «Illustrations», a different heading). Such
    an ark is not taken into a cluster. The NS's own declarations are not
    edges of this list: they are added later and kept."""
    kept = [e for e in edges
            if not ((e[0] == "bnf" and e[1] not in bnf_data) or (e[2] == "bnf" and e[3] not in bnf_data))]
    dropped = len(edges) - len(kept)
    if dropped:
        print(f"  Links to arks absent from the RAMEAU dump, left out: {dropped}")
    return kept


def build_clusters(primary_vocab, ns_concepts, sbt_concepts, sbt_wd_edges,
                   gnd_data, gnd_edges, bnf_data, bnf_edges, bne_edges, dnb_edges,
                   nsogg_edges=None):
    banner(f"CLUSTERING ({primary_vocab.upper()}-centric)")
    all_ext_edges = list(gnd_edges) + list(bnf_edges) + list(dnb_edges) + list(bne_edges) + list(nsogg_edges or [])
    all_ext_edges = drop_dead_arks(all_ext_edges, bnf_data)
    bnf_to_idref  = {}
    sbt_clusters  = {}

    print("\n--- Pass 1 ---")
    if primary_vocab == "ns":
        clusters, assigned = pass1_ns(ns_concepts)
    elif primary_vocab == "gnd":
        clusters, assigned = pass1_gnd(gnd_edges, gnd_data)
    else:  # idref
        clusters, assigned, bnf_to_idref = pass1_idref(bnf_edges, bnf_data)

    # For NS-centric, also add NS→external edges to the global edge set
    # (every declared id, not only the one chosen for the slot)
    if primary_vocab == "ns":
        for tid, c in ns_concepts.items():
            mxa = c.get("mxa")
            if mxa is None:
                mxa = [(auth, aid[0] if isinstance(aid, list) else aid, False)
                       for auth, aid in c.get("mx", {}).items()]
            for auth, aid, exact in mxa:
                all_ext_edges.append(make_edge("ns", tid, auth, aid, exact))

    rameau_only = set()
    if primary_vocab == "ns":
        for tid in ns_concepts:
            if tid not in clusters:
                clusters[tid] = {}
                assigned[f"ns:{tid}"].add(tid)
                rameau_only.add(tid)
        print(f"  NS concepts without declared matches, open to RAMEAU headings that declare them: {len(rameau_only)}")

    print("\n--- Pass 1b: exactMatch takes the slot ---")
    owner_decl = frozenset()
    if primary_vocab == "ns":
        owner_decl = frozenset((tid, auth, aid) for tid, c in ns_concepts.items()
                               for auth, aid, _ in (c.get("mxa") or []))
    exact_pairs, _, _ = prefer_exact_slots(primary_vocab, clusters, assigned, all_ext_edges, owner_decl)

    # Source order is kept: enrichment is a single pass in which a slot added
    # early can bridge to the next one (GND→BnF, then BnF→IdRef). Reordering
    # all exact edges first broke those bridges (-781 IdRef slots); the
    # exact-over-close rule is applied inside pass 2, per contested slot.
    print("\n--- Pass 2: external edge enrichment ---")
    pass2_enrich(clusters, assigned, all_ext_edges, primary_vocab, exact_pairs, rameau_only=frozenset(rameau_only))
    if primary_vocab == "ns":
        print("\n--- Pass 2b: RAMEAU/IdRef pairs ---")
        pair_rameau_idref(clusters, assigned, rameau_twins(all_ext_edges))
    for tid in [t for t in rameau_only if not clusters.get(t)]:
        del clusters[tid]      # still empty: no cluster, as before
        assigned[f"ns:{tid}"].discard(tid)
        if not assigned[f"ns:{tid}"]: del assigned[f"ns:{tid}"]

    print("\n--- Pass 3: local terms ---")
    if primary_vocab == "ns":
        sbt_clusters = pass3_sbt(clusters, assigned, sbt_concepts, sbt_wd_edges)
    else:
        print("  (skipped — no local terms for this primary vocab)")

    print("\n--- Pass 4: orphan clusters ---")
    orphan_clusters = pass4_orphans(assigned, all_ext_edges)

    print(f"\nCluster totals — primary: {len(clusters)}, SBT: {len(sbt_clusters)}, Orphans: {len(orphan_clusters)}")
    return clusters, sbt_clusters, orphan_clusters, all_ext_edges, bnf_to_idref


# ══════════════════════════════════════════════════════════════════════════════
# CONFIDENCE GRADING
# ══════════════════════════════════════════════════════════════════════════════

def _build_edge_index(all_ext_edges, ns_concepts):
    """Build directional edge index from all edges + NS SKOS matches."""
    idx = defaultdict(set)
    for s_type,s_id,t_type,t_id in all_ext_edges:
        idx[(s_type,s_id)].add((t_type,t_id))
    for tid, c in ns_concepts.items():
        mx = c.get("mx", c.get("cl", {}))
        for auth, aid in mx.items():
            if isinstance(aid, list): aid = aid[0]
            idx[("ns",tid)].add((auth,aid))
    return idx


def _bidi(idx, ta, ia, tb, ib):
    fwd = (tb,ib) in idx.get((ta,ia), set())
    rev = (ta,ia) in idx.get((tb,ib), set())
    return fwd, rev


def _grade_ns(tid, cluster, idx):
    gnd_id = cluster.get("gnd")
    bnf_id = cluster.get("bnf")
    if gnd_id and bnf_id:
        ng_f,gn_r = _bidi(idx,"ns",tid,"gnd",gnd_id)
        nb_f,bn_r = _bidi(idx,"ns",tid,"bnf",bnf_id)
        gb_f,bg_r = _bidi(idx,"gnd",gnd_id,"bnf",bnf_id)
        sides      = sum([(ng_f or gn_r),(nb_f or bn_r),(gb_f or bg_r)])
        bidi_sides = sum([(ng_f and gn_r),(nb_f and bn_r),(gb_f and bg_r)])
        if   bidi_sides >= 3:                   return 1
        elif bidi_sides >= 2 or sides >= 3:     return 2
        elif sides >= 1 or bidi_sides >= 1:     return 3
        else:                                   return 4
    elif gnd_id or bnf_id:
        other_auth = "gnd" if gnd_id else "bnf"
        other_id   = gnd_id or bnf_id
        fwd,rev    = _bidi(idx,"ns",tid,other_auth,other_id)
        return 2 if (fwd and rev) else (3 if (fwd or rev) else 4)
    else:
        return 3 if any(cluster.get(v) for v in ("wd","aat","lcsh","bne")) else 4


def _grade_gnd(gnd_id, cluster, idx):
    bnf_id = cluster.get("bnf")
    ns_id  = cluster.get("ns")
    if bnf_id and ns_id:
        gb_f,bg_r = _bidi(idx,"gnd",gnd_id,"bnf",bnf_id)
        gn_f,ng_r = _bidi(idx,"gnd",gnd_id,"ns",ns_id)
        bn_f,nb_r = _bidi(idx,"bnf",bnf_id,"ns",ns_id)
        sides      = sum([(gb_f or bg_r),(gn_f or ng_r),(bn_f or nb_r)])
        bidi_sides = sum([(gb_f and bg_r),(gn_f and ng_r),(bn_f and nb_r)])
        if   bidi_sides >= 3:                   return 1
        elif bidi_sides >= 2 or sides >= 3:     return 2
        elif sides >= 1 or bidi_sides >= 1:     return 3
        else:                                   return 4
    elif bnf_id or ns_id:
        other_auth = "bnf" if bnf_id else "ns"
        other_id   = bnf_id or ns_id
        fwd,rev    = _bidi(idx,"gnd",gnd_id,other_auth,other_id)
        return 2 if (fwd and rev) else (3 if (fwd or rev) else 4)
    else:
        return 3 if any(cluster.get(v) for v in ("wd","lcsh","bne")) else 4


def _grade_idref(idref_id, cluster, idx, bnf_to_idref):
    # IdRef≡BnF: use the BnF node as proxy for IdRef in the edge index
    bnf_id = cluster.get("bnf")
    gnd_id = cluster.get("gnd")
    ns_id  = cluster.get("ns")
    primary = ("bnf", bnf_id) if bnf_id else ("idref", idref_id)
    if gnd_id and ns_id:
        pg_f = ("gnd",gnd_id) in idx.get(primary, set())
        gp_r = primary in idx.get(("gnd",gnd_id), set())
        pn_f = ("ns",ns_id) in idx.get(primary, set())
        np_r = primary in idx.get(("ns",ns_id), set())
        gn_f,ng_r = _bidi(idx,"gnd",gnd_id,"ns",ns_id)
        sides      = sum([(pg_f or gp_r),(pn_f or np_r),(gn_f or ng_r)])
        bidi_sides = sum([(pg_f and gp_r),(pn_f and np_r),(gn_f and ng_r)])
        if   bidi_sides >= 3:                   return 1
        elif bidi_sides >= 2 or sides >= 3:     return 2
        elif sides >= 1 or bidi_sides >= 1:     return 3
        else:                                   return 4
    elif gnd_id or ns_id:
        other = ("gnd",gnd_id) if gnd_id else ("ns",ns_id)
        fwd = other in idx.get(primary, set())
        rev = primary in idx.get(other, set())
        return 2 if (fwd and rev) else (3 if (fwd or rev) else 4)
    else:
        return 3 if any(cluster.get(v) for v in ("wd","lcsh","bne")) else 4


def compute_confidence(primary_vocab, clusters, all_ext_edges, ns_concepts, bnf_to_idref=None):
    banner("CONFIDENCE GRADING")
    idx = _build_edge_index(all_ext_edges, ns_concepts)

    if primary_vocab == "ns":
        grade_fn = lambda pid, cl: _grade_ns(pid, cl, idx)
    elif primary_vocab == "gnd":
        grade_fn = lambda pid, cl: _grade_gnd(pid, cl, idx)
    else:
        grade_fn = lambda pid, cl: _grade_idref(pid, cl, idx, bnf_to_idref)

    cluster_grades = {pid: grade_fn(pid, cl) for pid, cl in clusters.items()}
    dist = Counter(cluster_grades.values())
    print(f"Grade distribution ({len(cluster_grades)} clusters):")
    for g in sorted(dist):
        print(f"  Grade {g}: {dist[g]}  ({dist[g]*100/len(cluster_grades):.1f}%)")
    return cluster_grades


# ══════════════════════════════════════════════════════════════════════════════
# WIKIDATA ENRICHMENT  (works on any cluster dict)
# ══════════════════════════════════════════════════════════════════════════════

def sparql_literal(value):
    """A SPARQL string literal, escaped: an id read from
    a dump goes into the query text, and a quote in it must not end the
    literal. Ordinary ids come out unchanged between the quotes."""
    s = str(value).replace("\\", "\\\\").replace('"', '\\"')
    s = s.replace("\n", "\\n").replace("\r", "\\r")
    return '"' + s + '"'


def enrich_wikidata(clusters, batch_size=50):
    banner("WIKIDATA ENRICHMENT")
    try:
        import requests
    except ImportError:
        print("WARNING: requests not available — skipping Wikidata enrichment")
        return

    WD_SPARQL  = "https://query.wikidata.org/sparql"
    # Wikimedia asks programs for a User-Agent that names them and a contact.
    WD_HEADERS = {"User-Agent": BUILD_USER_AGENT}

    failed_batches = []

    # A batch Wikidata refuses or times out is asked again
    # (up to 4 times, with growing pauses). Skipped in silence, it made two
    # builds from the same dumps differ (26 QIDs lost).
    def wd_batch(prop, ids):
        values = " ".join(sparql_literal(i) for i in ids)
        q = f"SELECT ?id ?item WHERE {{ VALUES ?id {{ {values} }} ?item wdt:{prop} ?id . }}"
        for attempt in range(4):
            try:
                r = requests.get(WD_SPARQL, params={"query": q, "format": "json"},
                                 headers=WD_HEADERS, timeout=30)
                if r.status_code == 200:
                    return {b["id"]["value"]: b["item"]["value"].split("/")[-1]
                            for b in r.json().get("results", {}).get("bindings", [])}
            except Exception:
                pass
            sleep(5 * (attempt + 1))
        failed_batches.append((prop, len(ids)))
        return {}

    # Resolve QIDs through EVERY authority backlink, not only GND/P227.
    # Clusters holding only RAMEAU/IdRef/LCSH/BNE ids used to leave the build
    # without a QID, which downstream forced the extension into its
    # text-search fallback (the extension's reconcile() does the same).
    # Waves run in reliability order; a cluster resolved by one wave is
    # skipped by the next. WD stores BnF ARKs without the 'cb' prefix (P268).
    PROPS = [
        ("gnd",   "P227", None),
        ("idref", "P269", None),
        ("lcsh",  "P244", None),
        ("bnf",   "P268", lambda v: v[2:] if v.startswith("cb") else v),
        ("bne",   "P950", None),
    ]
    total = 0
    for key, prop, xform in PROPS:
        targets = [(pid, xform(cl[key]) if xform else cl[key])
                   for pid, cl in clusters.items() if "wd" not in cl and key in cl]
        if not targets:
            continue
        print(f"  {key}/{prop}: {len(targets)} clusters without QID")
        added = 0
        for start in range(0, len(targets), batch_size):
            batch   = targets[start:start+batch_size]
            results = wd_batch(prop, [v for _, v in batch])
            for pid, val in batch:
                if val in results and "wd" not in clusters[pid]:
                    clusters[pid]["wd"] = results[val]
                    added += 1
            if (start // batch_size + 1) % 10 == 0:
                print(f"    batch {start//batch_size+1}  (found so far: {added})")
            sleep(0.2)
        print(f"    QIDs added via {prop}: {added}")
        total += added
    print(f"  Wikidata QIDs added (all properties): {total}")
    if failed_batches:
        print(f"  WARNING: {len(failed_batches)} Wikidata batches unanswered after 4 attempts "
              f"({sum(n for _, n in failed_batches)} ids): rebuild later for a complete index")


# ══════════════════════════════════════════════════════════════════════════════
# LABEL CACHE
# ══════════════════════════════════════════════════════════════════════════════

def build_label_cache(gnd_data, bnf_data, lcsh_data, bne_data):
    cache = {
        "gnd":  {k: v["label"] for k, v in gnd_data.items()  if "label" in v},
        "bnf":  {k: v["label"] for k, v in bnf_data.items()  if "label" in v},
        "lcsh": {k: v["label"] for k, v in lcsh_data.items() if "label" in v},
        "bne":  {k: v["label"] for k, v in bne_data.items()  if "label" in v},
    }
    print("Label cache:")
    for auth, d in cache.items():
        print(f"  {auth}: {len(d)}")
    return cache


# ══════════════════════════════════════════════════════════════════════════════
# JSON ASSEMBLY
# ══════════════════════════════════════════════════════════════════════════════

def _build_gnd_nt_index(gnd_data):
    """Derive narrower terms for GND by inverting broader declarations."""
    nt_index = defaultdict(list)
    for gnd_id, d in gnd_data.items():
        for parent in d.get("broader", []):
            nt_index[parent].append(gnd_id)
    return nt_index


IDREF_SOLR = "https://www.idref.fr/Sru/Solr"


def idref_solr_lookup(ppns, cache_path=None, timeout=30):
    """IdRef's own view of some PPNs: {ppn: {"label", "arks"}} (Solr: affcourt_z,
    BnF arks in idsext_s). Cached on disk; a PPN that cannot be fetched is
    simply missing from the result (the caller falls back to a fixed rule)."""
    import urllib.parse, urllib.request
    cache = {}
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            cache = json.load(f)
    todo = [p for p in ppns if p not in cache]
    for i in range(0, len(todo), 50):
        batch = todo[i:i + 50]
        q = "ppn_z:(" + " OR ".join(batch) + ")"
        url = IDREF_SOLR + "?" + urllib.parse.urlencode(
            {"q": q, "wt": "json", "fl": "ppn_z,affcourt_z,idsext_s", "rows": len(batch)})
        try:
            req = urllib.request.Request(url, headers={"User-Agent": BUILD_USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                docs = json.load(r)["response"]["docs"]
        except Exception as e:
            print(f"  WARNING: IdRef Solr not reachable ({e}); {len(todo) - i} PPN left to the fixed rule")
            break
        for d in docs:
            arks = [re.search(r"(cb\w+)$", x).group(1) for x in d.get("idsext_s", [])
                    if "catalogue.bnf.fr/ark:/12148/" in x and re.search(r"(cb\w+)$", x)]
            cache[d["ppn_z"]] = {"label": d.get("affcourt_z", ""), "arks": arks}
        for p_ in batch:
            cache.setdefault(p_, {"label": "", "arks": []})
    if cache_path and todo:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=1)
    return {p_: cache[p_] for p_ in ppns if p_ in cache}


def _fold(s_):
    return re.sub(r"\s+", " ", (s_ or "").casefold()).strip()


RAMEAU_THESAURUS = "r166"                          # Noms communs
RAMEAU_NOT_THESAURUS = {"r160", "r161", "r164"}    # fictional figures/divinities, bodies, serial titles


def is_rameau_thesaurus(d):
    """A RAMEAU thesaurus term (decision 2026-10-06, rule B): a heading of the
    common-noun part (r166, genre and form included), also when RAMEAU tags
    it as geographic too (Francophonie, Gaullisme, Amérique latine);
    geographic names alone (r167 only), corporate bodies, serial titles and
    fictional figures stay out. What a double tag means is not documented by
    the BnF: measured on the catalogue, excluding it lost more than it kept."""
    parts = set(d.get("parts") or ())
    return RAMEAU_THESAURUS in parts and not (parts & RAMEAU_NOT_THESAURUS)


def build_rameau_idref_table(bnf_data, all_ext_edges, idref_lookup=idref_solr_lookup, keep_arks=frozenset()):
    """RAMEAU and IdRef as ONE vocabulary in one file.

    e:  {ark: [label, ppn, [bt arks], [nt arks], [rt arks]]} — every RAMEAU
        heading, with the IdRef twin declared by the BnF (exactMatch) or "".
    pc: {ppn: ark} — the few PPNs that several RAMEAU headings declare (mostly
        a place and its "région"); IdRef decides: the ark IdRef itself links
        to, else the heading with IdRef's own wording, else the shortest one.
    pl: {ppn: label} — IdRef's own wording for those PPNs when it differs.
    The extension finds a heading from either id and never compares the two
    systems at run time.
    Only RAMEAU thesaurus terms enter (decision 2026-10-06: see
    is_rameau_thesaurus); `keep_arks` — the headings the NS index already uses — stay
    too, so no NS concept loses its French label. Returns (table, report)."""
    twins = rameau_twins(all_ext_edges)
    bnf_data = {a: d for a, d in bnf_data.items()
                if "label" in d and (is_rameau_thesaurus(d) or a in keep_arks)}
    by_ppn = defaultdict(list)
    for ark, ppns in twins.items():
        if ark in bnf_data:
            for p_ in ppns:
                if ark not in by_ppn[p_]:
                    by_ppn[p_].append(ark)
    conflicts = {p_: sorted(arks) for p_, arks in by_ppn.items() if len(arks) > 1}
    views = idref_lookup(sorted(conflicts)) if conflicts else {}
    pc, pl, report = {}, {}, []
    for p_, arks in sorted(conflicts.items()):
        v = views.get(p_) or {}
        declared = [a for a in arks if a in (v.get("arks") or [])]
        same_label = [a for a in arks if v.get("label") and _fold(bnf_data[a].get("label")) == _fold(v["label"])]
        if len(declared) == 1:
            chosen, how = declared[0], "ark dichiarato da IdRef"
        elif len(same_label) == 1:
            chosen, how = same_label[0], "stessa etichetta di IdRef"
        else:
            chosen = sorted(arks, key=lambda a: (len(bnf_data[a].get("label", "")), a))[0]
            how = "regola fissa (etichetta più corta)" + ("" if v else ", IdRef non raggiunto")
        pc[p_] = chosen
        if v.get("label") and _fold(v["label"]) != _fold(bnf_data[chosen].get("label")):
            pl[p_] = v["label"]
        report.append({"idref": p_, "idref_label": v.get("label", ""), "chosen": chosen, "how": how,
                       "candidates": [{"ark": a, "label": bnf_data[a].get("label", "")} for a in arks]})

    nt_index = defaultdict(set)
    rt_index = defaultdict(set)
    for ark, d in bnf_data.items():
        for c in d.get("narrower", []): nt_index[ark].add(c)
        for b in d.get("broader", []): nt_index[b].add(ark)
        for r in d.get("related", []):
            rt_index[ark].add(r); rt_index[r].add(ark)
    e = {}
    for ark, d in bnf_data.items():
        if "label" not in d:
            continue
        keep = lambda ids: sorted(i for i in set(ids) if i in bnf_data and i != ark)
        ppn = (twins.get(ark) or [""])[0]
        e[ark] = [d["label"], ppn, keep(d.get("broader", [])), keep(nt_index.get(ark, ())), keep(rt_index.get(ark, ()))]
    table = {"v": 1, "e": e, "pc": pc, "pl": pl}
    print(f"  RAMEAU/IdRef table: {len(e)} headings ({sum(1 for a in e if a in keep_arks and not is_rameau_thesaurus(bnf_data[a]))} "
          f"outside the thesaurus kept for the NS index), {sum(1 for x in e.values() if x[1])} with IdRef twin, "
          f"{sum(1 for x in e.values() if x[4])} with 'voir aussi', PPN with several headings: {len(conflicts)}")
    return table, report


def _build_idref_hierarchy(bnf_data, bnf_to_idref):
    """Derive IdRef hierarchy from BnF broader/narrower, mapping IDs through bnf_to_idref."""
    idref_to_bnf = {v: k for k, v in bnf_to_idref.items()}

    # Build NT from BnF narrower + inversion of broader
    nt_bnf = defaultdict(list)
    for bnf_id, d in bnf_data.items():
        for child in d.get("narrower", []):
            nt_bnf[bnf_id].append(child)
        for parent in d.get("broader", []):
            nt_bnf[parent].append(bnf_id)

    hier = {}
    for idref_id, bnf_id in idref_to_bnf.items():
        d = bnf_data.get(bnf_id, {})
        h = {}
        bt = [bnf_to_idref[b] for b in d.get("broader", []) if b in bnf_to_idref]
        nt = list({bnf_to_idref[n] for n in nt_bnf.get(bnf_id, []) if n in bnf_to_idref})
        if bt: h["bt"] = bt
        if nt: h["nt"] = nt
        if h: hier[idref_id] = h
    return hier


def mapping_evidence(primary_vocab, primary_id, authority, authority_id, edge_set):
    """0 inferred, 1 external→primary, 2 primary→external, 3 reciprocal."""
    forward = (primary_vocab, primary_id, authority, authority_id) in edge_set
    reverse = (authority, authority_id, primary_vocab, primary_id) in edge_set
    confidence = 3 if forward and reverse else 2 if forward else 1 if reverse else 0
    direction = "both" if confidence == 3 else "out" if confidence == 2 else "in" if confidence == 1 else "inferred"
    return {"id": authority_id, "c": confidence, "d": direction}


def assemble_and_save(primary_vocab, primary_data, primary_clusters,
                      sbt_concepts, sbt_clusters, orphan_clusters,
                      cluster_grades, label_cache,
                      gnd_data, bnf_data, lcsh_data,
                      bnf_to_idref=None, all_ext_edges=None):
    banner(f"FINAL JSON ASSEMBLY  (primary: {primary_vocab.upper()})")
    output_dir = OUTPUT_DIRS[primary_vocab]
    os.makedirs(output_dir, exist_ok=True)
    edge_set = set(all_ext_edges or [])

    # ── Concept entries ───────────────────────────────────────────────────────
    output_concepts = {}

    if primary_vocab == "ns":
        # Rich entries: l, bt, nt, rt, sn, df, d, al from NS SKOS
        for tid, concept in primary_data.items():
            entry = {k: concept[k] for k in ("l","bt","nt","rt","d","df","sn","al") if k in concept}
            cl = primary_clusters.get(tid)
            if cl:
                grade = cluster_grades.get(tid, 4)
                ecl   = {auth: mapping_evidence("ns", tid, auth, aid, edge_set) for auth, aid in cl.items()}
                ecl["_g"] = grade
                entry["cl"] = ecl
            output_concepts[tid] = entry
        # SBT local terms
        for sbt_tid, concept in sbt_concepts.items():
            if "ns_equiv" in concept: continue
            entry = {k: concept[k] for k in ("l","al","cat","src") if k in concept}
            cl = sbt_clusters.get(sbt_tid)
            if cl:
                ecl = {auth: {"id": aid, "c": 0, "d": "inferred"} for auth, aid in cl.items()}
                ecl["_g"] = 4
                entry["cl"] = ecl
            output_concepts[sbt_tid] = entry

    elif primary_vocab == "gnd":
        # Include ALL GND concepts, not just those with external matches —
        # same behaviour as NS-centric (concepts without clusters have no "cl" field).
        gnd_nt_index = _build_gnd_nt_index(gnd_data)
        for gnd_id, d in gnd_data.items():
            entry = {}
            if d.get("label"):   entry["l"]  = d["label"]
            if d.get("broader"): entry["bt"]  = d["broader"]
            nt = gnd_nt_index.get(gnd_id, [])
            if nt: entry["nt"] = nt
            if d.get("related"):  entry["rt"] = d["related"]
            if d.get("variants"): entry["al"] = d["variants"]
            cl = primary_clusters.get(gnd_id)
            if cl:
                grade = cluster_grades.get(gnd_id, 4)
                ecl   = {auth: mapping_evidence("gnd", gnd_id, auth, aid, edge_set) for auth, aid in cl.items()}
                ecl["_g"] = grade
                entry["cl"] = ecl
            output_concepts[gnd_id] = entry

    else:  # idref
        # "bnf" is kept in the cluster for the data.bnf.fr link — it is the same
        # thesaurus as IdRef but the BnF ID is a useful external reference.
        # The visualizer merges bnf+idref into one category; the builder does not.
        idref_to_bnf = {v: k for k, v in bnf_to_idref.items()}
        for idref_id, cl in primary_clusters.items():
            bnf_id  = idref_to_bnf.get(idref_id)
            bnf_rec = bnf_data.get(bnf_id, {}) if bnf_id else {}
            entry   = {}
            if bnf_rec.get("label"): entry["l"] = bnf_rec["label"]
            if cl:
                grade = cluster_grades.get(idref_id, 4)
                ecl   = {auth: mapping_evidence("idref", idref_id, auth, aid, edge_set) for auth, aid in cl.items()}
                ecl["_g"] = grade
                entry["cl"] = ecl
            output_concepts[idref_id] = entry

    print(f"Total concepts: {len(output_concepts)}")

    # ── Indexes ───────────────────────────────────────────────────────────────
    label_index = defaultdict(list)
    for pid, concept in output_concepts.items():
        if "l" in concept:
            label_index[concept["l"].lower()].append(pid)
    reverse_index = {"gnd": {}, "bnf": {}, "idref": {}, "lcsh": {}, "wd": {}, "bne": {}}
    for pid, concept in output_concepts.items():
        cl_raw = (primary_clusters.get(pid) or
                  sbt_clusters.get(pid) or {})
        for auth in reverse_index:
            aid = cl_raw.get(auth)
            if aid:
                reverse_index[auth].setdefault(aid, []).append(pid)
    # For the primary vocab itself, add an identity mapping
    for pid in primary_clusters:
        if primary_vocab == "gnd":
            reverse_index["gnd"].setdefault(pid, []).append(pid)
        elif primary_vocab == "idref":
            reverse_index["idref"].setdefault(pid, []).append(pid)

    # GND ids directly declared for an NS concept whose GND slot holds
    # another id (e.g. NS 6011 Eucaristia: slot Abendmahl, also declared
    # Eucharistie) become reachable, after any slot holder of the same id.
    slot_reverse = {a: {k: list(v) for k, v in m.items()} for a, m in reverse_index.items()}
    secondary = {}
    if primary_vocab == "ns" and all_ext_edges:
        secondary = secondary_direct_mappings("ns", "gnd", all_ext_edges,
                                              reverse_index["gnd"], set(output_concepts))
        for aid, pids in secondary.items():
            reverse_index["gnd"].setdefault(aid, []).extend(pids)
        gained = sum(1 for aid in secondary if len(reverse_index["gnd"][aid]) == len(secondary[aid]))
        print(f"Secondary GND mappings: {sum(map(len, secondary.values()))} "
              f"({gained} GND ids gain an NS concept they had none for)")
        # IdRef secondaries — RAMEAU/IdRef is one vocabulary, so
        # a RAMEAU heading declared for a concept (BNCF or BnF) whose slot is
        # taken brings its IdRef twin; an IdRef id displaced by the pairing
        # stays reachable too. Appended after the slot holders.
        twins = rameau_twins(all_ext_edges)
        sec_bnf = secondary_direct_mappings("ns", "bnf", all_ext_edges,
                                            reverse_index["bnf"], set(output_concepts))
        secondary_idref = defaultdict(list)
        for b, pids in sec_bnf.items():
            for i in twins.get(b, []):
                for pid in pids:
                    if pid not in (reverse_index["idref"].get(i) or []) and pid not in secondary_idref[i]:
                        secondary_idref[i].append(pid)
        rameau_idrefs = {i for ids in twins.values() for i in ids}
        for i, pids in IDREF_DISPLACED.items():
            # subject headings only: an IdRef id that is not the twin of a
            # RAMEAU heading (a name, a body, another thesaurus) is not kept
            if i not in rameau_idrefs:
                continue
            for pid in pids:
                if pid in output_concepts and pid not in (reverse_index["idref"].get(i) or []) \
                        and pid not in secondary_idref[i]:
                    secondary_idref[i].append(pid)
        # Only ids that reach no concept through a slot: for the others the
        # slot holder always wins at runtime, a secondary would only add an
        # ambiguity (e.g. «Actrices»: slot Attrici, BnF also declares Attori).
        secondary_idref = {i: p for i, p in secondary_idref.items()
                           if p and not reverse_index["idref"].get(i)}
        for i, pids in secondary_idref.items():
            reverse_index["idref"].setdefault(i, []).extend(pids)
        print(f"Secondary IdRef mappings: {sum(map(len, secondary_idref.values()))} "
              f"({sum(1 for i, p in secondary_idref.items() if len(reverse_index['idref'][i]) == len(p))} "
              f"IdRef ids gain an NS concept they had none for)")
        with open(os.path.join(output_dir, "secondary_mappings.json"), "w", encoding="utf-8") as f:
            json.dump({"gnd": secondary, "idref": secondary_idref}, f, ensure_ascii=False, indent=1)

        # MEASURE ONLY — what the same mechanism would add for
        # the other authorities. Written as a report; the index is unchanged.
        # IdRef has no direct NS declarations: its candidates are the IdRef
        # twins (BnF→IdRef exactMatch) of secondary RAMEAU ids.
        report = {}
        for auth in ("bnf", "lcsh", "bne", "idref"):
            cand = secondary_direct_mappings("ns", auth, all_ext_edges,
                                             reverse_index.get(auth, {}), set(output_concepts))
            report[auth] = cand
        twins = defaultdict(set)
        for e in all_ext_edges:
            if is_exact(e) and {e[0], e[2]} == {"bnf", "idref"}:
                b, i = (e[1], e[3]) if e[0] == "bnf" else (e[3], e[1])
                twins[b].add(i)
        via = defaultdict(list)
        for b, pids in report["bnf"].items():
            for i in twins.get(b, ()):
                for pid in pids:
                    if pid not in (reverse_index.get("idref", {}).get(i) or []) and pid not in via[i]:
                        via[i].append(pid)
        report["idref_via_rameau_twin"] = dict(via)
        summary = {}
        for auth, cand in report.items():
            base = "idref" if auth.startswith("idref") else auth
            summary[auth] = {
                "mappings": sum(map(len, cand.values())),
                "ids": len(cand),
                "ids_gaining_first_concept": sum(1 for aid in cand if not reverse_index.get(base, {}).get(aid)),
                "ids_to_2plus_concepts": sum(1 for pids in cand.values() if len(pids) > 1),
            }
            print(f"  [measure] secondary {auth}: {summary[auth]}")
        with open(os.path.join(output_dir, "secondary_candidates_report.json"), "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "candidates": report}, f, ensure_ascii=False, indent=1)

    ambiguities = {
        "labels": {label: tids for label, tids in label_index.items() if len(tids) > 1},
        "reverse": {
            auth: {aid: tids for aid, tids in mapping.items() if len(tids) > 1}
            for auth, mapping in slot_reverse.items()
        },
        # GND ids reachable ONLY through secondary mappings, towards 2+ concepts
        "secondary_gnd": {aid: pids for aid, pids in secondary.items()
                          if len(pids) > 1 and not slot_reverse["gnd"].get(aid)},
    }
    ambiguities["reverse"] = {auth: rows for auth, rows in ambiguities["reverse"].items() if rows}
    with open(os.path.join(output_dir, "ambiguities.json"), "w", encoding="utf-8") as f:
        json.dump(ambiguities, f, ensure_ascii=False, indent=2)

    core = {
        "v": 7,
        "primary": primary_vocab,
        "count": len(output_concepts),
        "concepts": output_concepts,
        "labels": dict(label_index),
        "reverse": reverse_index,
    }

    core_path = os.path.join(output_dir, "unified_index_core.json")
    with open(core_path, "w", encoding="utf-8") as f:
        json.dump(core, f, ensure_ascii=False, separators=(",", ":"))
    size_kb = os.path.getsize(core_path) // 1024
    print(f"unified_index_core.json:  {size_kb} KB")

    import gzip as _gz
    with open(core_path, "rb") as fi, _gz.open(core_path + ".gz", "wb", 9) as fo:
        fo.write(fi.read())
    print(f"unified_index_core.json.gz:  {os.path.getsize(core_path+'.gz')//1024} KB")

    # ── Label files ───────────────────────────────────────────────────────────
    for lang, auth in (("de", "gnd"), ("fr", "bnf")):
        labels = label_cache.get(auth, {})
        if not labels: continue
        p = os.path.join(output_dir, f"labels_{lang}.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(labels, f, ensure_ascii=False, separators=(",", ":"))
        print(f"labels_{lang}.json:  {os.path.getsize(p)//1024} KB  ({len(labels)} labels)")

    # ── Hierarchy files ───────────────────────────────────────────────────────
    # GND hierarchy: always include NT (derived by inversion)
    gnd_nt_index = _build_gnd_nt_index(gnd_data)
    hier_gnd = {}
    for aid, d in gnd_data.items():
        h = {}
        if "broader" in d: h["bt"] = d["broader"]
        nt = gnd_nt_index.get(aid, [])
        if nt: h["nt"] = nt
        if d.get("related"): h["rt"] = d["related"]
        if h: hier_gnd[aid] = h
    if hier_gnd:
        p = os.path.join(output_dir, "hierarchy_gnd.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(hier_gnd, f, ensure_ascii=False, separators=(",", ":"))
        print(f"hierarchy_gnd.json:  {os.path.getsize(p)//1024} KB  ({len(hier_gnd)} entries)")

    # BnF hierarchy: bt + nt (from dump + inversion)
    nt_bnf_index = defaultdict(list)
    for bnf_id, d in bnf_data.items():
        for child in d.get("narrower", []):
            nt_bnf_index[bnf_id].append(child)
        for parent in d.get("broader", []):
            nt_bnf_index[parent].append(bnf_id)
    hier_bnf = {}
    for aid, d in bnf_data.items():
        h = {}
        if "broader" in d: h["bt"] = d["broader"]
        nt = list(set(d.get("narrower", []) + nt_bnf_index.get(aid, [])))
        if nt: h["nt"] = nt
        if h: hier_bnf[aid] = h
    if hier_bnf:
        p = os.path.join(output_dir, "hierarchy_bnf.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(hier_bnf, f, ensure_ascii=False, separators=(",", ":"))
        print(f"hierarchy_bnf.json:  {os.path.getsize(p)//1024} KB  ({len(hier_bnf)} entries)")

    # Single RAMEAU/IdRef table for the extension.
    if all_ext_edges is not None:
        table, conflicts_report = build_rameau_idref_table(
            bnf_data, all_ext_edges,
            lambda ppns: idref_solr_lookup(ppns, os.path.join(SCRIPT_DIR, "parser-cache", "idref_conflicts.json")),
            keep_arks=frozenset(reverse_index.get("bnf", {})))
        p = os.path.join(output_dir, "rameau_idref.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(table, f, ensure_ascii=False, separators=(",", ":"))
        print(f"rameau_idref.json:  {os.path.getsize(p)//1024} KB")
        with open(os.path.join(output_dir, "rameau_idref_conflicts.json"), "w", encoding="utf-8") as f:
            json.dump(conflicts_report, f, ensure_ascii=False, indent=1)
        # RAMEAU notes of the table's headings, a file of its
        # own so the extension loads it only when a card needs a note.
        notes_rameau = {a: " ".join(bnf_data[a]["notes"]) for a in table["e"]
                        if bnf_data.get(a, {}).get("notes")}
        p = os.path.join(output_dir, "notes_rameau.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(notes_rameau, f, ensure_ascii=False, separators=(",", ":"))
        print(f"notes_rameau.json:  {os.path.getsize(p)//1024} KB  ({len(notes_rameau)} notes)")

    # GND definitions, loaded by the extension on demand.
    notes_gnd = {gid: d["definition"] for gid, d in gnd_data.items() if d.get("definition")}
    p = os.path.join(output_dir, "notes_gnd.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(notes_gnd, f, ensure_ascii=False, separators=(",", ":"))
    print(f"notes_gnd.json:  {os.path.getsize(p)//1024} KB  ({len(notes_gnd)} definitions)")

    # IdRef hierarchy (only for idref-centric build)
    if primary_vocab == "idref" and bnf_to_idref:
        hier_idref = _build_idref_hierarchy(bnf_data, bnf_to_idref)
        if hier_idref:
            p = os.path.join(output_dir, "hierarchy_idref.json")
            with open(p, "w", encoding="utf-8") as f:
                json.dump(hier_idref, f, ensure_ascii=False, separators=(",", ":"))
            print(f"hierarchy_idref.json:  {os.path.getsize(p)//1024} KB  ({len(hier_idref)} entries)")

    # Orphan clusters
    if orphan_clusters:
        p = os.path.join(output_dir, "orphan_clusters.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump(orphan_clusters, f, ensure_ascii=False, separators=(",", ":"))
        print(f"orphan_clusters.json:  {os.path.getsize(p)//1024} KB  ({len(orphan_clusters)} clusters)")

    return output_dir


# ══════════════════════════════════════════════════════════════════════════════
# SLIM LABEL FILES
# ══════════════════════════════════════════════════════════════════════════════

def exact_links(edges, reverse, rameau_e, rameau_pc, labels_de, labels_en, labels_es):
    """For GND and IdRef subject headings WITHOUT an NS concept,
    the headings of the other vocabularies that the sources declare as exact
    equivalents — directly, or through ONE Wikidata item that both declare
    (GND sameAs Q…, RAMEAU exactMatch Q…). An IdRef PPN counts as its RAMEAU
    twin. A vocabulary is kept only when there is exactly one candidate and
    the extension has its label locally (DE labels_de, FR the RAMEAU/IdRef
    table, EN/ES the slim files). closeMatch never counts.
    Returns {"gnd": {id: {"bnf": ark, "lcsh": id, "bne": id}},
             "idref": {ppn: {"gnd": id, "lcsh": id, "bne": id}}}."""
    nb = defaultdict(lambda: defaultdict(set))
    for e in edges:
        if not is_exact(e):
            continue
        s_t, s_i, t_t, t_i = e[0], e[1], e[2], e[3]
        nb[(s_t, s_i)][t_t].add(t_i)
        nb[(t_t, t_i)][s_t].add(s_i)
    ark_of = {e[1]: ark for ark, e in rameau_e.items() if e[1]}
    ark_of.update(rameau_pc or {})
    has_label = {"bnf": lambda i: i in rameau_e, "gnd": lambda i: i in labels_de,
                 "lcsh": lambda i: i in labels_en, "bne": lambda i: i in labels_es}

    def targets(keys):
        t = defaultdict(set)
        for k in keys:
            for auth, ids in nb.get(k, {}).items():
                t[auth] |= ids
        for q in list(t.get("wd", ())):
            for auth, ids in nb.get(("wd", q), {}).items():
                t[auth] |= ids
        return t

    out = {"gnd": {}, "idref": {}}
    gnd_ids = {i for (a, i) in nb if a == "gnd"}
    idref_ids = {i for (a, i) in nb if a == "idref"} | set(ark_of)
    for vocab, ids, wanted in (("gnd", gnd_ids, ("bnf", "lcsh", "bne")),
                               ("idref", idref_ids, ("gnd", "lcsh", "bne"))):
        for i in sorted(ids):                # sorted: same file on every run (a set's order is not)
            if i in reverse.get(vocab, {}):
                continue                     # reaches an NS concept: the cluster decides
            keys = [(vocab, i)]
            if vocab == "idref" and i in ark_of:
                keys.append(("bnf", ark_of[i]))
            t = targets(keys)
            entry = {}
            for auth in wanted:
                cand = t.get(auth, set())
                if len(cand) == 1:
                    (c,) = cand
                    if has_label[auth](c):
                        entry[auth] = c
            if entry:
                out[vocab][i] = entry
    return out


def build_exact_links(all_ext_edges, output_dir):
    d = Path(output_dir)
    load = lambda name: json.loads((d / name).read_text(encoding="utf-8"))
    core, table = load("unified_index_core.json"), load("rameau_idref.json")
    links = exact_links(all_ext_edges, core.get("reverse", {}), table.get("e", {}), table.get("pc", {}),
                        load("labels_de.json"), load("labels_en_slim.json"), load("labels_es_slim.json"))
    p = d / "exact_links.json"
    p.write_text(json.dumps({"v": 1, **links}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  exact_links.json: {p.stat().st_size // 1024} KB  "
          f"(GND {len(links['gnd'])}, IdRef {len(links['idref'])} headings without NS concept)")
    return links


def build_slim_labels(primary_vocab, clusters, label_cache, all_ext_edges, output_dir):
    banner("SLIM LABEL FILES  (EN + ES)")

    clustered_lcsh = {cl["lcsh"] for cl in clusters.values() if "lcsh" in cl}
    clustered_bne  = {cl["bne"]  for cl in clusters.values() if "bne"  in cl}
    print(f"  LCSH IDs in clusters (base):  {len(clustered_lcsh)}")
    print(f"  BNE  IDs in clusters (base):  {len(clustered_bne)}")

    if all_ext_edges:
        extra_lcsh  = {t_id for s_type,s_id,t_type,t_id in all_ext_edges if t_type=="lcsh"}
        extra_bne   = {t_id for s_type,s_id,t_type,t_id in all_ext_edges if t_type=="bne"}
        extra_lcsh |= {s_id for s_type,s_id,t_type,t_id in all_ext_edges if s_type=="lcsh"}
        extra_bne  |= {s_id for s_type,s_id,t_type,t_id in all_ext_edges if s_type=="bne"}
        clustered_lcsh |= extra_lcsh
        clustered_bne  |= extra_bne
        print(f"  LCSH IDs after edge enrichment: {len(clustered_lcsh)}")
        print(f"  BNE  IDs after edge enrichment: {len(clustered_bne)}")

    labels_en_slim = {k: v for k, v in label_cache["lcsh"].items() if k in clustered_lcsh}
    labels_es_slim = {k: v for k, v in label_cache["bne"].items()  if k in clustered_bne}

    p_en = os.path.join(output_dir, "labels_en_slim.json")
    p_es = os.path.join(output_dir, "labels_es_slim.json")
    with open(p_en, "w", encoding="utf-8") as f:
        json.dump(labels_en_slim, f, ensure_ascii=False, separators=(",", ":"))
    with open(p_es, "w", encoding="utf-8") as f:
        json.dump(labels_es_slim, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n  labels_en_slim.json:  {os.path.getsize(p_en)//1024} KB  ({len(labels_en_slim)} labels)")
    print(f"  labels_es_slim.json:  {os.path.getsize(p_es)//1024} KB  ({len(labels_es_slim)} labels)")
    return labels_en_slim, labels_es_slim


# ══════════════════════════════════════════════════════════════════════════════
# COPY TO EXTENSION
# ══════════════════════════════════════════════════════════════════════════════

def copy_to_extension(output_dir, skip=False):
    if skip:
        print("\n  --skip-copy: extension files not updated.")
        return
    if not os.path.isdir(EXT_DIR):
        print(f"\n  WARNING: extension dir not found: {EXT_DIR}")
        print(f"  Copy manually from {output_dir}/")
        return
    banner("COPY TO EXTENSION")
    for src_name, dst_name in EXTENSION_FILES:
        src = os.path.join(output_dir, src_name)
        dst = os.path.join(EXT_DIR, dst_name)
        if not os.path.exists(src):
            print(f"  MISSING: {src_name}")
            continue
        shutil.copy2(src, dst)
        print(f"  {dst_name}  →  {os.path.getsize(dst)//1024} KB")


# ══════════════════════════════════════════════════════════════════════════════
# SLIM-ONLY REBUILD
# ══════════════════════════════════════════════════════════════════════════════

def run_slim_only(primary_vocab, skip_copy=False):
    banner("SLIM-ONLY REBUILD")
    output_dir = OUTPUT_DIRS[primary_vocab]
    core_path  = os.path.join(output_dir, "unified_index_core.json")
    if not os.path.exists(core_path):
        sys.exit(f"ERROR: {core_path} not found. Run a full build first.")

    print(f"Loading existing index from {core_path}…")
    with open(core_path, "r", encoding="utf-8") as f:
        core = json.load(f)

    clustered_lcsh, clustered_bne = set(), set()
    for concept in core.get("concepts", {}).values():
        cl = concept.get("cl", {})
        if "lcsh" in cl: clustered_lcsh.add(cl["lcsh"]["id"] if isinstance(cl["lcsh"], dict) else cl["lcsh"])
        if "bne"  in cl: clustered_bne.add(cl["bne"]["id"]   if isinstance(cl["bne"],  dict) else cl["bne"])
    print(f"  LCSH IDs: {len(clustered_lcsh)}")
    print(f"  BNE  IDs: {len(clustered_bne)}")

    lcsh_labels = {}
    if os.path.exists(LCSH_DUMP_TTL):
        lcsh_data   = parse_lcsh_dump(LCSH_DUMP_TTL)
        lcsh_labels = {k: v["label"] for k, v in lcsh_data.items() if "label" in v}

    bne_labels = {}
    if os.path.exists(BNE_DUMP_NT) or all(os.path.exists(p) for p in BNE_MARCXML_FILES):
        bne_data, _ = load_bne()
        bne_labels  = {k: v["label"] for k, v in bne_data.items() if "label" in v}

    labels_en_slim = {k: v for k, v in lcsh_labels.items() if k in clustered_lcsh}
    labels_es_slim = {k: v for k, v in bne_labels.items()  if k in clustered_bne}

    os.makedirs(output_dir, exist_ok=True)
    p_en = os.path.join(output_dir, "labels_en_slim.json")
    p_es = os.path.join(output_dir, "labels_es_slim.json")
    with open(p_en, "w", encoding="utf-8") as f: json.dump(labels_en_slim, f, ensure_ascii=False, separators=(",",":"))
    with open(p_es, "w", encoding="utf-8") as f: json.dump(labels_es_slim, f, ensure_ascii=False, separators=(",",":"))
    print(f"\n  labels_en_slim.json:  {len(labels_en_slim)} labels")
    print(f"  labels_es_slim.json:  {len(labels_es_slim)} labels")
    copy_to_extension(output_dir, skip=skip_copy)


# ══════════════════════════════════════════════════════════════════════════════
# FULL BUILD
# ══════════════════════════════════════════════════════════════════════════════

def run_full_build(primary_vocab, skip_wikidata=False, skip_copy=False, include_sbt=False):
    t0 = datetime.now()

    # Sanity thresholds: the parsers are streaming
    # regexes over the upstream dumps — if a format changes, the parse
    # "succeeds" but returns a fraction of the concepts, and the build must
    # stop instead of propagating a degraded index into the extension.
    # Thresholds are ~50% of the counts observed on the 2026-07 build
    # (NS 35,125 · GND ~200k · BnF 203,739 · LCSH 270,076 · BNE 97,460);
    # adjust them if the sources legitimately shrink. Each check runs right
    # after its parse so a bad source fails fast instead of after the whole
    # multi-minute parsing phase.
    def sanity(name, actual, mn):
        if actual < mn:
            sys.exit(f"SANITY CHECK FAILED: {name} = {actual} < {mn} — "
                     f"the source format has probably changed; build aborted.")

    # 1. Load all source data (same for all primary vocabs)
    ns_concepts              = load_ns()
    sanity("NS concepts", len(ns_concepts), 18000)
    # SBT local terms are excluded unless explicitly requested
    # (decision 2026-09-16: the public index carries no SBT additions).
    if include_sbt and primary_vocab == "ns":
        sbt_concepts, sbt_wd_edges = load_sbt()
    else:
        print("SBT local terms excluded (use --include-sbt for a local NS build).")
        sbt_concepts, sbt_wd_edges = {}, []
    sbt_concepts, sbt_wd_edges, removed_sbt = drop_sbt_labels_already_in_ns(
        ns_concepts, sbt_concepts, sbt_wd_edges
    )
    Path(OUTPUT_DIRS[primary_vocab]).mkdir(parents=True, exist_ok=True)
    with open(Path(OUTPUT_DIRS[primary_vocab]) / "sbt_duplicates_removed.json", "w", encoding="utf-8") as f:
        json.dump(removed_sbt, f, ensure_ascii=False, indent=2)
    gnd_data,   gnd_edges    = parse_gnd_dump(GND_DUMP_GZ)
    sanity("GND entities", len(gnd_data), 100000)
    bnf_data,   bnf_edges    = parse_rameau_dump(RAMEAU_DUMP_TARGZ)
    sanity("BnF concepts", len(bnf_data), 100000)
    lcsh_data                = parse_lcsh_dump(LCSH_DUMP_TTL)
    sanity("LCSH terms", len(lcsh_data), 135000)
    bne_data,   bne_edges    = load_bne()
    sanity("BNE terms", len(bne_data), 45000)
    dnb_edges                = parse_dnb_mapping(DNB_MAPPING_GZ)
    nsogg_edges              = parse_nsogg_mapping(NSOGG_MAPPING_GZ)

    # 2. Clustering
    clusters, sbt_clusters, orphan_clusters, all_ext_edges, bnf_to_idref = build_clusters(
        primary_vocab, ns_concepts, sbt_concepts, sbt_wd_edges,
        gnd_data, gnd_edges, bnf_data, bnf_edges, bne_edges, dnb_edges,
        nsogg_edges=nsogg_edges
    )

    # primary_data: the raw source data for the primary vocab
    primary_data = {"ns": ns_concepts, "gnd": gnd_data, "idref": bnf_data}[primary_vocab]

    # 3. Wikidata enrichment (optional)
    if not skip_wikidata:
        enrich_wikidata(clusters)

    # 4. Confidence grading
    cluster_grades = compute_confidence(
        primary_vocab, clusters, all_ext_edges, ns_concepts, bnf_to_idref
    )

    # 5. Label cache
    label_cache = build_label_cache(gnd_data, bnf_data, lcsh_data, bne_data)

    # 6. Assemble and save
    output_dir = assemble_and_save(
        primary_vocab, primary_data, clusters,
        sbt_concepts, sbt_clusters, orphan_clusters,
        cluster_grades, label_cache,
        gnd_data, bnf_data, lcsh_data,
        bnf_to_idref=bnf_to_idref,
        all_ext_edges=all_ext_edges
    )

    # 7. Slim label files, from every link read, including
    # those to arks absent from the RAMEAU dump (left out of the clusters
    # only): the BNE ids they carry — 3,320, mostly places whose BnF record
    # moved to the new geographic file — keep their Spanish label for the
    # extension, which looks it up when Wikidata gives a BNE id.
    raw_edges = (list(gnd_edges) + list(bnf_edges) + list(dnb_edges) + list(bne_edges)
                 + list(nsogg_edges or []) + [e for e in all_ext_edges if e[0] == "ns"])
    build_slim_labels(primary_vocab, clusters, label_cache, raw_edges, output_dir)
    if primary_vocab == "ns":
        build_exact_links(all_ext_edges, output_dir)

    # 8. Copy to extension
    copy_to_extension(output_dir, skip=skip_copy)

    elapsed = (datetime.now() - t0).total_seconds()
    banner(f"BUILD COMPLETE  ({primary_vocab.upper()}-centric, {elapsed/60:.1f} min)")

    meta = {}
    if os.path.exists(METADATA_FILE):
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            meta = json.load(f)
    meta[f"last_full_build_{primary_vocab}"] = datetime.now(timezone.utc).isoformat()
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# ══════════════════════════════════════════════════════════════════════════════
# CLI
# ══════════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Unified Authority Index Builder — multi-vocab",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples
--------
  python build_index.py                           NS-centric (default)
  python build_index.py --primary-vocab gnd       GND-centric → output_gnd/
  python build_index.py --primary-vocab idref     IdRef-centric → output_idref/
  python build_index.py --check                   check source file hashes
  python build_index.py --slim-only               rebuild EN/ES slim labels only
  python build_index.py --no-wikidata             skip Wikidata enrichment
  python build_index.py --skip-copy               do not copy to extension dir
        """
    )
    parser.add_argument("--primary-vocab", choices=["ns","gnd","idref"], default="ns",
                        help="Primary vocabulary for clustering (default: ns)")
    parser.add_argument("--check",       action="store_true", help="check source files, no rebuild")
    parser.add_argument("--slim-only",   action="store_true", help="rebuild EN/ES slim labels only")
    parser.add_argument("--no-wikidata", action="store_true", help="skip Wikidata enrichment step")
    parser.add_argument("--skip-copy",   action="store_true", help="do not copy to extension dir")
    parser.add_argument("--include-sbt", action="store_true",
                        help="add SBT local terms (local NS builds only; excluded by default)")
    args = parser.parse_args()

    primary_vocab = args.primary_vocab
    os.makedirs(OUTPUT_DIRS[primary_vocab], exist_ok=True)

    if args.check:
        run_check()
    elif args.slim_only:
        run_slim_only(primary_vocab, skip_copy=args.skip_copy)
    else:
        run_full_build(primary_vocab, skip_wikidata=args.no_wikidata, skip_copy=args.skip_copy,
                       include_sbt=args.include_sbt)


if __name__ == "__main__":
    main()
