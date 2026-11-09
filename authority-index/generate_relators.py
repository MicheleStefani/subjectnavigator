#!/usr/bin/env python3
"""Build the compact, runtime MARC relator vocabulary from the LoC JSON-LD snapshot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


MADS = "http://www.loc.gov/mads/rdf/v1#"


def first_value(entry: dict, predicate: str) -> str | None:
    values = entry.get(predicate) or []
    if not values:
        return None
    return values[0].get("@value")


def build(source: Path) -> dict[str, dict[str, str]]:
    records = json.loads(source.read_text(encoding="utf-8"))
    compact: dict[str, dict[str, str]] = {}
    for record in records:
        code = first_value(record, MADS + "code")
        label = first_value(record, MADS + "authoritativeLabel")
        uri = record.get("@id")
        if not code or not label or not uri:
            continue
        compact[code.lower()] = {
            "label": label,
            "uri": uri.replace("http://", "https://", 1),
        }
    return dict(sorted(compact.items()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = {
        "source": "Library of Congress MARC Code List for Relators",
        "sourceUri": "https://id.loc.gov/vocabulary/relators",
        "count": 0,
        "relators": build(args.source),
    }
    result["count"] = len(result["relators"])
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(result, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {result['count']} relators to {args.output}")


if __name__ == "__main__":
    main()
