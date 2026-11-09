# -*- coding: utf-8 -*-
"""Compare two generated index folders (e.g. the installed index and a rebuild).

Read-only. Prints counts that show what a rebuild gained or lost, plus the
real cases used as acceptance checks, and optionally writes them as JSON.

  python scripts/compare_builds.py OLD_DIR NEW_DIR [--json report.json]
"""
import argparse
import json
import sys
from collections import Counter
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FILES = ["unified_index_core.json", "labels_de.json", "labels_fr.json",
         "labels_en_slim.json", "labels_es_slim.json", "hierarchy_gnd.json", "hierarchy_bnf.json"]

# Real cases used as acceptance checks for the index.
CASES = [
    ("NS 30177 Trinità: RT count", lambda d: len(d["core"]["concepts"].get("30177", {}).get("rt", []))),
    ("NS 30177 Trinità: BT", lambda d: d["core"]["concepts"].get("30177", {}).get("bt")),
    ("NS 596 Strumenti: NT count", lambda d: len(d["core"]["concepts"].get("596", {}).get("nt", []))),
    ("NS 6943 Spirito Santo: RT count", lambda d: len(d["core"]["concepts"].get("6943", {}).get("rt", []))),
    ("LCSH sh85137555 (Trinity)", lambda d: d["labels_en_slim"].get("sh85137555")),
    ("LCSH sh85097530 (Papacy)", lambda d: d["labels_en_slim"].get("sh85097530")),
    ("BNE XX525502 (Trinidad)", lambda d: d["labels_es_slim"].get("XX525502")),
    ("BNE XX526215 (Espíritu Santo)", lambda d: d["labels_es_slim"].get("XX526215")),
    ("GND 4030702-5 Kirche: related", lambda d: d["hierarchy_gnd"].get("4030702-5", {}).get("rt")),
    ("NS 767 Chiesa: cluster", lambda d: cluster(d, "767")),
    ("NS 6011 Eucaristia: cluster", lambda d: cluster(d, "6011")),
    ("NS 6932 Evangelizzazione: cluster", lambda d: cluster(d, "6932")),
    ("NS 6943 Spirito Santo: cluster", lambda d: cluster(d, "6943")),
    ("NS 4021 Papi: cluster", lambda d: cluster(d, "4021")),
    ("GND 4015644-8 Eucharistie → NS", lambda d: d["core"].get("reverse", {}).get("gnd", {}).get("4015644-8")),
    ("GND 4132778-0 Seelengewinnung → NS", lambda d: d["core"].get("reverse", {}).get("gnd", {}).get("4132778-0")),
]


def cluster(d, tid):
    cl = d["core"]["concepts"].get(tid, {}).get("cl") or {}
    return {k: (v["id"] if isinstance(v, dict) else v) for k, v in cl.items() if k != "_g"}


def load(folder):
    folder = Path(folder)
    d = {}
    for name in FILES + ["secondary_mappings.json"]:
        p = folder / name
        d[name.replace(".json", "").replace("unified_index_", "")] = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return d


def stats(d):
    concepts = d["core"].get("concepts", {})
    ns = {k: c for k, c in concepts.items() if not k.startswith("SBT_")}
    rel = {k: sum(len(c.get(k, [])) for c in ns.values()) for k in ("bt", "nt", "rt", "al")}
    slots = Counter(a for c in concepts.values() for a in (c.get("cl") or {}) if a != "_g")
    grades = Counter((c.get("cl") or {}).get("_g") for c in concepts.values() if c.get("cl"))
    rev = d["core"].get("reverse", {})
    sec = d.get("secondary_mappings", {}).get("gnd", {})
    # slot-only view: remove the secondary targets
    slot_rev = {a: {k: [t for t in v if not (a == "gnd" and t in sec.get(k, []))] for k, v in m.items()}
                for a, m in rev.items()}
    return {
        "concepts_total": len(concepts),
        "concepts_sbt": len(concepts) - len(ns),
        "ns_bt_edges": rel["bt"], "ns_nt_edges": rel["nt"], "ns_rt_edges": rel["rt"],
        "ns_altLabels": rel["al"],
        "ns_with_scopeNote": sum(1 for c in ns.values() if c.get("sn")),
        "clusters": sum(1 for c in concepts.values() if c.get("cl")),
        **{f"cluster_slot_{a}": n for a, n in sorted(slots.items())},
        **{f"grade_{g}": n for g, n in sorted(grades.items(), key=lambda x: str(x[0]))},
        "reverse_ambiguous_ids": sum(1 for m in slot_rev.values() for v in m.values() if len(v) > 1),
        "gnd_secondary_mappings": sum(len(v) for v in sec.values()),
        "gnd_ids_reaching_ns": sum(1 for v in rev.get("gnd", {}).values() if v),
        "labels_de": len(d["labels_de"]), "labels_fr": len(d["labels_fr"]),
        "labels_en": len(d["labels_en_slim"]), "labels_es": len(d["labels_es_slim"]),
        "hierarchy_gnd_entries": len(d["hierarchy_gnd"]),
        "hierarchy_gnd_rt_edges": sum(len(h.get("rt", [])) for h in d["hierarchy_gnd"].values()),
        "hierarchy_gnd_bt_edges": sum(len(h.get("bt", [])) for h in d["hierarchy_gnd"].values()),
        "hierarchy_bnf_entries": len(d["hierarchy_bnf"]),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("old"); ap.add_argument("new")
    ap.add_argument("--json")
    a = ap.parse_args()
    old, new = load(a.old), load(a.new)
    so, sn = stats(old), stats(new)
    print(f"{'measure':34} {'old':>12} {'new':>12} {'diff':>10}")
    for k in sorted(set(so) | set(sn)):
        o, n = so.get(k, 0), sn.get(k, 0)
        print(f"{k:34} {o:>12} {n:>12} {n - o:>+10}")
    print("\nReal cases:")
    cases = []
    for name, fn in CASES:
        o, n = fn(old), fn(new)
        cases.append({"case": name, "old": o, "new": n})
        print(f"- {name}\n    old: {o}\n    new: {n}")
    # Labels whose text changed (same id in both files)
    changed = {}
    for key in ("labels_en_slim", "labels_es_slim", "labels_de", "labels_fr"):
        common = set(old[key]) & set(new[key])
        changed[key] = sum(1 for i in common if old[key][i] != new[key][i])
    print("\nSame id, different label text:", changed)
    if a.json:
        Path(a.json).write_text(json.dumps({"old": str(a.old), "new": str(a.new), "stats_old": so,
                                            "stats_new": sn, "cases": cases, "changed_labels": changed},
                                           ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
