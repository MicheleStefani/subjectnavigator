# -*- coding: utf-8 -*-
"""Build the release zip: the extension ready to load, index included.

  python scripts/make_release.py            -> release/subject-navigator-<version>.zip
  python scripts/make_release.py --list     list the files, write nothing

The zip holds only what Chrome needs to run the extension, plus the README,
licences and privacy notice: the files named in manifest.json (scripts,
icons), the modules the service worker imports, the panel resources, and the
index files the generator copies next to the extension (EXTENSION_FILES in
authority-index/build_index.py). Tests, generator and docs stay out.
The version comes from manifest.json. The build stops if a file is missing,
so a zip without its index cannot be produced by mistake.
"""
import json
import re
import sys
import zipfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DOCS = ["README.md", "LICENSE", "DATA_LICENSES.md", "PRIVACY.md"]


def worker_modules(entry):
    """The service worker and every module it imports, recursively."""
    seen, todo = [], [entry]
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.append(name)
        src = (ROOT / name).read_text(encoding="utf-8")
        todo += re.findall(r"""^\s*import\b[^'"]*['"]\./([\w.-]+\.js)['"]""", src, re.M)
    return seen


def panel_resources():
    src = (ROOT / "background.js").read_text(encoding="utf-8")
    m = re.search(r"PANEL_RESOURCES\s*=\s*new Set\(\[(.*?)\]\)", src, re.S)
    return re.findall(r"'([\w.-]+)'", m.group(1))


def index_files():
    src = (ROOT / "authority-index" / "build_index.py").read_text(encoding="utf-8")
    m = re.search(r"^EXTENSION_FILES = \[(.*?)^\]", src, re.S | re.M)
    return [dst for _, dst in re.findall(r'\("([\w.-]+)",\s*"([\w.-]+)"\)', m.group(1))]


def release_files(manifest):
    files = ["manifest.json"]
    files += worker_modules(manifest["background"]["service_worker"])
    for cs in manifest["content_scripts"]:
        files += cs.get("js", []) + cs.get("css", [])
    files += manifest.get("icons", {}).values()
    files += manifest.get("action", {}).get("default_icon", {}).values()
    files += panel_resources() + index_files() + DOCS
    out = []
    for f in files:
        if f not in out:
            out.append(f)
    return out


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = manifest["version"]
    files = release_files(manifest)
    missing = [f for f in files if not (ROOT / f).is_file()]
    if missing:
        sys.exit("Missing files, no zip written:\n  " + "\n  ".join(missing))
    if "--list" in sys.argv:
        for f in files:
            print(f"{(ROOT / f).stat().st_size // 1024:8} KB  {f}")
        return
    folder = f"subject-navigator-{version}"
    out = ROOT / "release" / f"{folder}.zip"
    out.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(files):
            # Fixed date: the same files always give the same zip.
            info = zipfile.ZipInfo(f"{folder}/{f}", date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, (ROOT / f).read_bytes())
    print(f"{out.relative_to(ROOT)}: {len(files)} files, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
