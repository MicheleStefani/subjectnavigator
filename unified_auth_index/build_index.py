#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_index.py  —  Unified Authority Index Builder v3.1
===========================================================
General-purpose: supports NS-centric (default), GND-centric, IdRef-centric builds.

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
import urllib.request
from collections import defaultdict, Counter
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone
from time import sleep


# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

DATA_DIR   = "./data"
EXT_DIR    = "../subject-navigator-v1.0.0"

# Output directories per primary vocab
OUTPUT_DIRS = {
    "ns":    "./output",
    "gnd":   "./output_gnd",
    "idref": "./output_idref",
}

NS_SKOS_TTL       = f"{DATA_DIR}/ns_skos.ttl"
GND_DUMP_GZ       = f"{DATA_DIR}/authorities-gnd-sachbegriff_lds.ttl.gz"
RAMEAU_DUMP_TARGZ = f"{DATA_DIR}/databnf_rameau_nt.tar.gz"
LCSH_DUMP_TTL     = f"{DATA_DIR}/subjects.skosrdf.ttl"
BNE_DUMP_NT       = f"{DATA_DIR}/materias.nt"
DNB_MAPPING_GZ    = f"{DATA_DIR}/mapping-authorities-gnd-lcsh-ram_lds.jsonld.gz"
NSOGG_MAPPING_GZ  = f"{DATA_DIR}/mapping-authorities-gnd-nsogg_lds.jsonld.gz"
SBT_CSV           = f"{DATA_DIR}/SBT-THESAURUS-csv.csv"
NS_INDEX_CACHE    = f"{DATA_DIR}/ns_index.json"
METADATA_FILE     = f"{DATA_DIR}/build_metadata.json"

REMOTE_SOURCES = {
    "lcsh": "https://id.loc.gov/download/authorities/subjects.skosrdf.ttl.gz",
    "bne":  "https://datos.bne.es/datadumps/materias.nt.bz2",
    "gnd":  "https://data.dnb.de/opendata/authorities-gnd-sachbegriff_lds.ttl.gz",
    # "bnf": "https://transfert.bnf.fr/link/7da54f6e-34e0-48c5-b7c3-f3912cdcf355",  # update each release
    # "ns":  "https://digitale.bncf.firenze.sbn.it/openrdf-workbench/repositories/NS/export?Accept=text%2Fturtle&limit=All",
}

EXTENSION_FILES = [
    ("unified_index_core.json", "unified_index_core.json"),
    ("labels_de.json",          "labels_de.json"),
    ("labels_fr.json",          "labels_fr.json"),
    ("labels_en_slim.json",     "labels_en_slim.json"),
    ("labels_es_slim.json",     "labels_es_slim.json"),
    ("hierarchy_gnd.json",      "hierarchy_gnd.json"),
    ("hierarchy_bnf.json",      "hierarchy_bnf.json"),
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
    req.add_header("User-Agent", "SubjectNavigator/3.1 (index builder)")
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
    "bne":  BNE_DUMP_NT,
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

def parse_ns_skos(ttl_path):
    print(f"Parsing NS SKOS from {ttl_path}…")
    with open(ttl_path, "r", encoding="utf-8") as f:
        text = f.read()
    blocks = re.split(r"\n(?=<http://purl\.org/bncf/tid/\d+>)", text)
    print(f"  Blocks found: {len(blocks)}")
    concepts = {}
    for block in blocks:
        m = re.match(r"<http://purl\.org/bncf/tid/(\d+)>", block)
        if not m or "a skos:Concept" not in block:
            continue
        tid = m.group(1)
        c = {}
        pl = re.search(r'skos:prefLabel "([^"]+)"@it', block)
        if pl: c["l"] = pl.group(1)
        broader  = re.findall(r"skos:broader <http://purl\.org/bncf/tid/(\d+)>", block)
        if broader:  c["bt"] = broader
        narrower = re.findall(r"skos:narrower <http://purl\.org/bncf/tid/(\d+)>", block)
        if narrower: c["nt"] = narrower
        related  = re.findall(r"skos:related <http://purl\.org/bncf/tid/(\d+)>", block)
        if related:  c["rt"] = related
        ddc = re.search(r'skos:notation "([^"]+)"\^\^<http://dewey\.info>', block)
        if ddc: c["d"] = ddc.group(1)
        sn = re.search(r'skos:scopeNote "([^"]*(?:\\.[^"]*)*)"', block)
        if sn: c["sn"] = sn.group(1).replace('\\"', '"')
        df = re.search(r'skos:definition "([^"]*(?:\\.[^"]*)*)"', block)
        if df: c["df"] = df.group(1).replace('\\"', '"')
        alt = re.findall(r'skos:altLabel "([^"]+)"', block)
        if alt: c["al"] = alt
        mx = {}
        for pat, key in [
            (r"wikidata\.org/entity/(Q\d+)",               "wd"),
            (r"d-nb\.info/gnd/([\w.-]+)",                  "gnd"),
            (r"data\.bnf\.fr/ark:/12148/(cb\w+)",          "bnf"),
            (r"id\.loc\.gov/authorities/subjects/(sh\w+)", "lcsh"),
            (r"vocab\.getty\.edu/aat/(\d+)",               "aat"),
            (r"datos\.bne\.es/resource/(\w+)",             "bne"),
        ]:
            found = re.findall(pat, block)
            if found: mx[key] = found[0]
        if mx: c["mx"] = mx
        concepts[tid] = c
    print(f"  Parsed {len(concepts)} NS concepts")
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


def parse_gnd_dump(gz_path):
    print(f"Parsing GND dump from {gz_path}…")
    gnd_data = {}
    edges    = []
    current_gnd = None
    current     = {}
    entity_count = 0

    re_entity      = re.compile(r"<https://d-nb\.info/gnd/([^/]+)>\s+a\s+gndo:(\w+)")
    re_pref        = re.compile(r'gndo:preferredNameForTheSubjectHeading "([^"]+)"')
    re_variant     = re.compile(r'gndo:variantNameForTheSubjectHeading "([^"]+)"')
    re_broader_gen = re.compile(r"gndo:broaderTermGeneral <https://d-nb\.info/gnd/([^>]+)>")
    re_broader_grc = re.compile(r"gndo:broaderTermGeneric <https://d-nb\.info/gnd/([^>]+)>")
    re_broader_par = re.compile(r"gndo:broaderTermPartitive <https://d-nb\.info/gnd/([^>]+)>")
    re_broader_ins = re.compile(r"gndo:broaderTermInstantial <https://d-nb\.info/gnd/([^>]+)>")
    re_related     = re.compile(r"gndo:relatedTerm <https://d-nb\.info/gnd/([^>]+)>")
    re_wikidata    = re.compile(r"owl:sameAs <http://www\.wikidata\.org/entity/(Q\d+)>")
    re_skos_uri    = re.compile(r"<(http[^>]+)>")
    re_lcsh_uri    = re.compile(r"id\.loc\.gov/authorities/subjects/(sh\w+)")
    re_bnf_uri     = re.compile(r"data\.bnf\.fr/ark:/12148/(cb\w+)")
    re_ns_uri      = re.compile(r"purl\.org/bncf/tid/(\d+)")
    re_aat_uri     = re.compile(r"vocab\.getty\.edu/aat/(\d+)")
    re_ram_pfx     = re.compile(r"\bram:(cb\w+)")
    re_nsogg_pfx   = re.compile(r"\bnsogg:(\d+)")
    re_embne_pfx   = re.compile(r"\bembne:(XX\w+)")
    re_lcsh_pfx    = re.compile(r"\blcsh:(sh\w+)")

    def flush():
        nonlocal current_gnd, current
        if current_gnd and current.get("label"):
            gnd_data[current_gnd] = current
        current_gnd = None
        current = {}

    with open_auto(gz_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("@prefix"): continue
            m = re_entity.search(line)
            if m:
                flush()
                current_gnd = m.group(1)
                current = {"type": m.group(2)}
                entity_count += 1
                if entity_count % 50000 == 0:
                    print(f"  … {entity_count} entities")
                continue
            if not current_gnd: continue
            m = re_pref.search(line)
            if m: current["label"] = m.group(1); continue
            for m in re_variant.finditer(line):
                current.setdefault("variants", []).append(m.group(1))
            for rx in (re_broader_gen, re_broader_grc, re_broader_par, re_broader_ins):
                for m in rx.finditer(line):
                    current.setdefault("broader", []).append(m.group(1))
            for m in re_related.finditer(line):
                current.setdefault("related", []).append(m.group(1))
            m = re_wikidata.search(line)
            if m:
                current["wd"] = m.group(1)
                edges.append(("gnd", current_gnd, "wd", m.group(1)))
            if "closeMatch" in line or "exactMatch" in line:
                for m_uri in re_skos_uri.finditer(line):
                    uri = m_uri.group(1)
                    for rx, auth in ((re_lcsh_uri,"lcsh"),(re_bnf_uri,"bnf"),(re_ns_uri,"ns"),(re_aat_uri,"aat")):
                        m2 = rx.search(uri)
                        if m2: edges.append(("gnd", current_gnd, auth, m2.group(1))); break
                for m_p in re_ram_pfx.finditer(line):
                    edges.append(("gnd", current_gnd, "bnf",  m_p.group(1)))
                for m_p in re_nsogg_pfx.finditer(line):
                    edges.append(("gnd", current_gnd, "ns",   m_p.group(1)))
                for m_p in re_embne_pfx.finditer(line):
                    edges.append(("gnd", current_gnd, "bne",  m_p.group(1)))
                for m_p in re_lcsh_pfx.finditer(line):
                    edges.append(("gnd", current_gnd, "lcsh", m_p.group(1)))
    flush()
    print(f"  GND entities: {entity_count}, labelled: {len(gnd_data)}, edges: {len(edges)}")
    for et, c in Counter(f"{s}→{t}" for s,_,t,_ in edges).most_common():
        print(f"    {et}: {c}")
    return gnd_data, edges


def parse_rameau_dump(targz_path):
    print(f"Parsing RAMEAU dump from {targz_path}…")
    bnf_data    = {}
    edges       = []
    SKOS        = "http://www.w3.org/2004/02/skos/core#"
    re_triple   = re.compile(r'<([^>]+)>\s+<([^>]+)>\s+(?:<([^>]+)>|"([^"]*)"(?:@(\w+))?)')
    line_count  = 0
    concept_ids = set()

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
                m = re_triple.match(line)
                if not m: continue
                subj, pred, obj_uri, obj_lit = m.group(1), m.group(2), m.group(3), m.group(4)
                sid = bnf_id(subj)
                if not sid or "#about" in subj: continue
                if pred.endswith("type") and obj_uri and "Concept" in obj_uri:
                    concept_ids.add(sid); bnf_data.setdefault(sid, {}); continue
                if pred == SKOS + "prefLabel" and obj_lit:
                    bnf_data.setdefault(sid, {})["label"] = obj_lit; continue
                if pred == SKOS + "broader" and obj_uri:
                    bt = bnf_id(obj_uri)
                    if bt: bnf_data.setdefault(sid, {}).setdefault("broader", []).append(bt); continue
                if pred == SKOS + "narrower" and obj_uri:
                    nt = bnf_id(obj_uri)
                    if nt: bnf_data.setdefault(sid, {}).setdefault("narrower", []).append(nt); continue
                if (pred == SKOS+"closeMatch" or pred == SKOS+"exactMatch") and obj_uri:
                    for pat, auth in (
                        (r"d-nb\.info/gnd/([\w.-]+)",                      "gnd"),
                        (r"id\.loc\.gov/authorities/(?:subjects/)?(sh\w+)", "lcsh"),
                        (r"wikidata\.org/entity/(Q\d+)",                    "wd"),
                        (r"idref\.fr/([0-9A-Z]+)",                          "idref"),
                        (r"purl\.org/bncf/tid/(\d+)",                       "ns"),
                    ):
                        m2 = re.search(pat, obj_uri)
                        if m2: edges.append(("bnf", sid, auth, m2.group(1))); break
    bnf_concepts = {k: v for k, v in bnf_data.items() if k in concept_ids and "label" in v}
    print(f"  Lines: {line_count}, SKOS concepts: {len(bnf_concepts)}, edges: {len(edges)}")
    for et, c in Counter(f"{s}→{t}" for s,_,t,_ in edges).most_common():
        print(f"    {et}: {c}")
    return bnf_concepts, edges


def parse_lcsh_dump(ttl_path):
    print(f"Parsing LCSH from {ttl_path}  ({os.path.getsize(ttl_path)/1024/1024:.0f} MB)…")
    lcsh_data = {}
    re_label   = re.compile(r'skos:prefLabel "([^"]+)"@en')
    re_broader = re.compile(r"skos:broader <http://id\.loc\.gov/authorities/subjects/(sh\d+)>")
    current_id = None
    current    = {}
    count = skipped_compound = skipped_781 = 0
    with open(ttl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("# BEGIN"):
                m = re.search(r"subjects/(sh\d+(?:-781)?)$", line)
                if m:
                    if current_id and current.get("label"):
                        lcsh_data[current_id] = current
                    raw_id = m.group(1)
                    if raw_id.endswith("-781"):
                        current_id = None; skipped_781 += 1; continue
                    current_id = raw_id; current = {}; count += 1
                    if count % 100_000 == 0: print(f"  … {count} concepts")
                else:
                    current_id = None
                continue
            if not current_id: continue
            m = re_label.search(line)
            if m:
                label = m.group(1)
                if "--" in label:
                    skipped_compound += 1; current_id = None; continue
                current["label"] = label; continue
            for m in re_broader.finditer(line):
                current.setdefault("broader", []).append(m.group(1))
    if current_id and current.get("label"):
        lcsh_data[current_id] = current
    print(f"  LCSH simple terms: {len(lcsh_data)}  (skipped: {skipped_compound} compound, {skipped_781} -781)")
    return lcsh_data


def parse_bne_dump(nt_path):
    print(f"Parsing BNE from {nt_path}  ({os.path.getsize(nt_path)/1024/1024:.0f} MB)…")
    bne_data = {}
    edges    = []
    SKOS     = "http://www.w3.org/2004/02/skos/core#"
    re_triple = re.compile(r'<([^>]+)>\s+<([^>]+)>\s+(?:<([^>]+)>|"([^"]*)"(?:@(\w+))?)')
    skipped_compound = line_count = 0

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
            m = re_triple.match(line)
            if not m: continue
            subj, pred, obj_uri, obj_lit = m.group(1), m.group(2), m.group(3), m.group(4)
            bid = bne_id(subj)
            if not bid: continue
            if pred == SKOS + "prefLabel" and obj_lit:
                if "--" in obj_lit:
                    skipped_compound += 1; continue
                bne_data.setdefault(bid, {})["label"] = obj_lit; continue
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
                    if m2: edges.append(("bne", bid, auth, m2.group(1))); break
    bne_data = {k: v for k, v in bne_data.items() if "label" in v}
    print(f"  Lines: {line_count}, simple concepts: {len(bne_data)}, edges: {len(edges)}")
    return bne_data, edges


def parse_dnb_mapping(gz_path):
    print(f"Parsing DNB mapping from {gz_path}…")
    with open_auto(gz_path) as f:
        data = json.load(f)
    entries = data[0] if isinstance(data[0], list) else data
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
                    edges.append((s_type, s_id, t_type, t_id))
    print(f"  Entries: {len(entries)}, edges: {len(edges)}")
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
                    edges.append(("ns", ns_id, "gnd", gnd_m.group(1)))
    print(f"  Entries: {len(entries):,}, GND↔NS edges: {len(edges):,}")
    return edges


# ══════════════════════════════════════════════════════════════════════════════
# CLUSTERING — Pass 1 (vocab-specific)
# ══════════════════════════════════════════════════════════════════════════════

def pass1_ns(ns_concepts):
    """Create NS-centric clusters from NS SKOS match declarations."""
    clusters    = {}  # tid → {auth: id, ...}
    assigned    = {}  # "auth:id" → tid
    for tid, c in ns_concepts.items():
        mx = c.get("mx", c.get("cl", {}))
        if not mx: continue
        cluster = {}
        for auth, aid in mx.items():
            if isinstance(aid, list): aid = aid[0]
            cluster[auth] = aid
        if cluster:
            clusters[tid] = cluster
            assigned[f"ns:{tid}"] = tid
            for auth, aid in cluster.items():
                assigned[f"{auth}:{aid}"] = tid
    print(f"  NS concepts with matches: {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned


def pass1_gnd(gnd_edges, gnd_data):
    """Create GND-centric clusters from GND outgoing match edges."""
    clusters = {}   # gnd_id → {auth: id, ...}
    assigned = {}   # "auth:id" → gnd_id

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
        assigned[f"gnd:{gnd_id}"] = gnd_id
        for auth, aid in cluster.items():
            key = f"{auth}:{aid}"
            if key not in assigned:
                assigned[key] = gnd_id

    print(f"  GND concepts with matches: {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned


def pass1_idref(bnf_edges, bnf_data):
    """Create IdRef-centric clusters from BnF→IdRef exactMatch declarations."""
    clusters    = {}   # idref_id → {auth: id, ...}
    assigned    = {}   # "auth:id" → idref_id
    bnf_to_idref = {}  # bnf_id → idref_id

    # First pass: find all BnF→IdRef matches
    for s_type, s_id, t_type, t_id in bnf_edges:
        if s_type == "bnf" and t_type == "idref":
            if t_id not in clusters:
                clusters[t_id]   = {"bnf": s_id}
                bnf_to_idref[s_id] = t_id
                assigned[f"idref:{t_id}"] = t_id
                assigned[f"bnf:{s_id}"]   = t_id

    # Second pass: pull other matches (gnd, ns, lcsh, wd…) into each IdRef cluster
    for s_type, s_id, t_type, t_id in bnf_edges:
        if s_type != "bnf" or t_type == "idref": continue
        idref_id = bnf_to_idref.get(s_id)
        if idref_id is None: continue
        cluster = clusters[idref_id]
        if t_type not in cluster:
            cluster[t_type] = t_id
            key = f"{t_type}:{t_id}"
            if key not in assigned:
                assigned[key] = idref_id

    print(f"  IdRef concepts (from BnF matches): {len(clusters)}")
    for auth, c in Counter(a for cl in clusters.values() for a in cl).most_common():
        print(f"    {auth}: {c}")
    return clusters, assigned, bnf_to_idref


# ══════════════════════════════════════════════════════════════════════════════
# CLUSTERING — Passes 2-4 (universal)
# ══════════════════════════════════════════════════════════════════════════════

def pass2_enrich(clusters, assigned, all_ext_edges):
    """Enrich clusters with additional cross-vocab edges (same logic for all vocabs)."""
    enriched = rej_no_cluster = rej_already = rej_slot = 0
    for s_type, s_id, t_type, t_id in all_ext_edges:
        sk, tk = f"{s_type}:{s_id}", f"{t_type}:{t_id}"
        source_pid = assigned.get(sk)
        target_pid = assigned.get(tk)
        if source_pid and target_pid: continue
        if not source_pid and not target_pid: rej_no_cluster += 1; continue
        if source_pid:
            cluster_pid, cand_type, cand_id, cand_key = source_pid, t_type, t_id, tk
        else:
            cluster_pid, cand_type, cand_id, cand_key = target_pid, s_type, s_id, sk
        if cand_key in assigned: rej_already += 1; continue
        cluster = clusters[cluster_pid]
        if cand_type in cluster: rej_slot += 1; continue
        cluster[cand_type] = cand_id
        assigned[cand_key] = cluster_pid
        enriched += 1
    print(f"  Added: {enriched}  |  No cluster: {rej_no_cluster}  |  Slot occupied: {rej_slot}")
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
            assigned[f"{auth}:{aid}"] = sbt_tid
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


def build_clusters(primary_vocab, ns_concepts, sbt_concepts, sbt_wd_edges,
                   gnd_data, gnd_edges, bnf_data, bnf_edges, bne_edges, dnb_edges,
                   nsogg_edges=None):
    banner(f"CLUSTERING ({primary_vocab.upper()}-centric)")
    all_ext_edges = list(gnd_edges) + list(bnf_edges) + list(dnb_edges) + list(bne_edges) + list(nsogg_edges or [])
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
    if primary_vocab == "ns":
        for tid, c in ns_concepts.items():
            mx = c.get("mx", {})
            for auth, aid in mx.items():
                if isinstance(aid, list): aid = aid[0]
                all_ext_edges.append(("ns", tid, auth, aid))

    print("\n--- Pass 2: external edge enrichment ---")
    pass2_enrich(clusters, assigned, all_ext_edges)

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

def enrich_wikidata(clusters, gnd_key="gnd", batch_size=50):
    banner("WIKIDATA ENRICHMENT")
    try:
        import requests
    except ImportError:
        print("WARNING: requests not available — skipping Wikidata enrichment")
        return

    WD_SPARQL  = "https://query.wikidata.org/sparql"
    WD_HEADERS = {"User-Agent": "SubjectNavigator/3.1"}

    def wd_batch(prop, ids):
        values = " ".join(f'"{i}"' for i in ids)
        q = f"SELECT ?id ?item WHERE {{ VALUES ?id {{ {values} }} ?item wdt:{prop} ?id . }}"
        try:
            r = requests.get(WD_SPARQL, params={"query": q, "format": "json"},
                             headers=WD_HEADERS, timeout=30)
            if r.status_code == 200:
                return {b["id"]["value"]: b["item"]["value"].split("/")[-1]
                        for b in r.json().get("results", {}).get("bindings", [])}
        except Exception:
            pass
        return {}

    targets = [(pid, cl[gnd_key]) for pid, cl in clusters.items()
               if "wd" not in cl and gnd_key in cl]
    print(f"  Clusters without QID but with GND: {len(targets)}")
    added = 0
    for start in range(0, len(targets), batch_size):
        batch   = targets[start:start+batch_size]
        results = wd_batch("P227", [g for _, g in batch])
        for pid, gnd_id in batch:
            if gnd_id in results:
                clusters[pid]["wd"] = results[gnd_id]
                added += 1
        if (start // batch_size + 1) % 10 == 0:
            print(f"  Batch {start//batch_size+1}  (found so far: {added})")
        sleep(0.2)
    print(f"  Wikidata QIDs added: {added}")


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


def assemble_and_save(primary_vocab, primary_data, primary_clusters,
                      sbt_concepts, sbt_clusters, orphan_clusters,
                      cluster_grades, label_cache,
                      gnd_data, bnf_data, lcsh_data,
                      bnf_to_idref=None):
    banner(f"FINAL JSON ASSEMBLY  (primary: {primary_vocab.upper()})")
    output_dir = OUTPUT_DIRS[primary_vocab]
    os.makedirs(output_dir, exist_ok=True)

    # ── Concept entries ───────────────────────────────────────────────────────
    output_concepts = {}

    if primary_vocab == "ns":
        # Rich entries: l, bt, nt, rt, sn, df, d, al from NS SKOS
        for tid, concept in primary_data.items():
            entry = {k: concept[k] for k in ("l","bt","nt","rt","d","df","sn","al") if k in concept}
            cl = primary_clusters.get(tid)
            if cl:
                grade = cluster_grades.get(tid, 4)
                ecl   = {auth: {"id": aid, "c": 0} for auth, aid in cl.items()}
                ecl["_g"] = grade
                entry["cl"] = ecl
            output_concepts[tid] = entry
        # SBT local terms
        for sbt_tid, concept in sbt_concepts.items():
            if "ns_equiv" in concept: continue
            entry = {k: concept[k] for k in ("l","al","cat","src") if k in concept}
            cl = sbt_clusters.get(sbt_tid)
            if cl:
                ecl = {auth: {"id": aid, "c": 0} for auth, aid in cl.items()}
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
                ecl   = {auth: {"id": aid, "c": 0} for auth, aid in cl.items()}
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
                ecl   = {auth: {"id": aid, "c": 0} for auth, aid in cl.items()}
                ecl["_g"] = grade
                entry["cl"] = ecl
            output_concepts[idref_id] = entry

    print(f"Total concepts: {len(output_concepts)}")

    # ── Indexes ───────────────────────────────────────────────────────────────
    label_index   = {c["l"].lower(): pid for pid, c in output_concepts.items() if "l" in c}
    reverse_index = {"gnd": {}, "bnf": {}, "idref": {}, "lcsh": {}, "wd": {}, "bne": {}}
    for pid, concept in output_concepts.items():
        cl_raw = (primary_clusters.get(pid) or
                  sbt_clusters.get(pid) or {})
        for auth in reverse_index:
            aid = cl_raw.get(auth)
            if aid:
                reverse_index[auth][aid] = pid
    # For the primary vocab itself, add an identity mapping
    for pid in primary_clusters:
        if primary_vocab == "gnd":
            reverse_index["gnd"][pid] = pid
        elif primary_vocab == "idref":
            reverse_index["idref"][pid] = pid

    core = {
        "v": 6,
        "primary": primary_vocab,
        "count": len(output_concepts),
        "concepts": output_concepts,
        "labels": label_index,
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
    if os.path.exists(BNE_DUMP_NT):
        bne_data, _ = parse_bne_dump(BNE_DUMP_NT)
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

def run_full_build(primary_vocab, skip_wikidata=False, skip_copy=False):
    t0 = datetime.now()

    # 1. Load all source data (same for all primary vocabs)
    ns_concepts              = load_ns()
    sbt_concepts, sbt_wd_edges = load_sbt()
    gnd_data,   gnd_edges    = parse_gnd_dump(GND_DUMP_GZ)
    bnf_data,   bnf_edges    = parse_rameau_dump(RAMEAU_DUMP_TARGZ)
    lcsh_data                = parse_lcsh_dump(LCSH_DUMP_TTL)
    bne_data,   bne_edges    = parse_bne_dump(BNE_DUMP_NT)
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
        bnf_to_idref=bnf_to_idref
    )

    # 7. Slim label files
    build_slim_labels(primary_vocab, clusters, label_cache, all_ext_edges, output_dir)

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
        description="Unified Authority Index Builder v3.1 — multi-vocab",
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
    args = parser.parse_args()

    primary_vocab = args.primary_vocab
    os.makedirs(OUTPUT_DIRS[primary_vocab], exist_ok=True)

    if args.check:
        run_check()
    elif args.slim_only:
        run_slim_only(primary_vocab, skip_copy=args.skip_copy)
    else:
        run_full_build(primary_vocab, skip_wikidata=args.no_wikidata, skip_copy=args.skip_copy)


if __name__ == "__main__":
    main()
