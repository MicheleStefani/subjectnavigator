# -*- coding: utf-8 -*-
"""Check that a new index loses nothing against the previous one.

  python scripts/check_no_loss.py authority-index/output-OLD authority-index/output-NEW

For every authority id in the old reverse index, every NS concept it reached
must still be reached (as slot holder or as secondary mapping); every NS
concept that had a label in a language must still have one; every filled
slot must still be filled. Changed slots are listed. Exit code 1 on loss.
"""
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

LABEL_FILES = {"gnd": ("de", "labels_de.json"), "bnf": ("fr", "labels_fr.json"),
               "lcsh": ("en", "labels_en_slim.json"), "bne": ("es", "labels_es_slim.json")}


def load(d):
    d = Path(d)
    core = json.loads((d / "unified_index_core.json").read_text(encoding="utf-8"))
    labels = {a: json.loads((d / f).read_text(encoding="utf-8")) for a, (_, f) in LABEL_FILES.items()}
    return core, labels


def langs(concept, labels):
    out = {"it"} if concept.get("l") else set()
    for auth, (lang, _) in LABEL_FILES.items():
        aid = ((concept.get("cl") or {}).get(auth) or {}).get("id")
        if aid and labels[auth].get(aid):
            out.add(lang)
    return out


def main():
    old_dir, new_dir = sys.argv[1:3]
    (old, old_l), (new, new_l) = load(old_dir), load(new_dir)
    lost = []
    for auth, rev in old["reverse"].items():
        nrev = new["reverse"].get(auth, {})
        for aid, tids in rev.items():
            missing = set(tids) - set(nrev.get(aid) or [])
            if missing:
                lost.append(f"reverse {auth} {aid}: no longer reaches {sorted(missing)}")
    gained_lang, changed = [], []
    for tid, c in old["concepts"].items():
        n = new["concepts"].get(tid)
        if n is None:
            lost.append(f"concept {tid} {c.get('l')} missing"); continue
        lo, ln = langs(c, old_l), langs(n, new_l)
        if lo - ln:
            lost.append(f"concept {tid} {c.get('l')}: lost label(s) {sorted(lo - ln)}")
        if ln - lo:
            gained_lang.append(f"{tid} {c.get('l')}: +{sorted(ln - lo)}")
        for auth, slot in (c.get("cl") or {}).items():
            if auth.startswith("_"): continue
            nslot = (n.get("cl") or {}).get(auth)
            if not nslot:
                lost.append(f"concept {tid} {c.get('l')}: slot {auth} {slot.get('id')} emptied")
            elif nslot.get("id") != slot.get("id"):
                changed.append(f"{tid} {c.get('l')}: {auth} {slot.get('id')} -> {nslot.get('id')}")
    print(f"concepts: {len(old['concepts'])} -> {len(new['concepts'])}")
    print(f"slots changed: {len(changed)}")
    for x in changed: print("  " + x)
    print(f"concepts gaining a language: {len(gained_lang)}")
    for x in gained_lang[:20]: print("  " + x)
    print(f"LOSSES: {len(lost)}")
    for x in lost: print("  " + x)
    sys.exit(1 if lost else 0)


if __name__ == "__main__":
    main()
