# -*- coding: utf-8 -*-
"""Minimal, dependency-free Turtle / N-Triples reading for build_index.py.

The authority dumps are too large for a full RDF graph in memory, and the
original line-oriented regexes lost everything that Turtle is allowed to
spread over several lines or lists:

  skos:related <a> , <b> , <c> ;        -> only <a> was kept
  skos:prefLabel "X"@en ;               -> a nested  [ skos:prefLabel "Y"@en ]
                                           overwrote X
  "A"@es . "A"@eu .                     -> the last language won

This module tokenises one *statement group* at a time (a subject with its
predicate/object lists, terminated by '.') and returns the objects with their
language tags, so each parser can pick exactly the values it needs. It does
not try to be a complete Turtle implementation: collections and base IRIs are
not needed by the dumps used here.
"""
import re

_TOKEN_RX = re.compile(r'''
    (?P<ws>\s+)
  | (?P<comment>\#[^\n]*)
  | (?P<iri><[^<>"{}|^`\\\s]*>)
  | (?P<lit3>"""(?:[^"\\]|\\.|"(?!""))*""")
  | (?P<lit>"(?:[^"\\\n]|\\.)*")
  | (?P<lits>'(?:[^'\\\n]|\\.)*')
  | (?P<lang>@[A-Za-z]+(?:-[A-Za-z0-9]+)*)
  | (?P<dt>\^\^)
  | (?P<punct>[;,.\[\]()])
  | (?P<bnl>_:[\w-]+)
  | (?P<pname>(?:[A-Za-z][\w-]*)?:(?:[\w%:-]|\.(?=[\w%:-]))*)
  | (?P<num>[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<word>[A-Za-z_][\w-]*)
''', re.X)

_ESC_RX = re.compile(r'\\(u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8}|.)', re.S)
_ESC_CHARS = {"t": "\t", "n": "\n", "r": "\r", "b": "\b", "f": "\f"}


SKOS = "http://www.w3.org/2004/02/skos/core#"
GNDO = "https://d-nb.info/standards/elementset/gnd#"

# Always applied (a file's own @prefix lines override them), so a predicate is
# the same full IRI whether or not a snippet carries its prefix header.
DEFAULT_PREFIXES = {
    "skos": SKOS,
    "gndo": GNDO,
    "owl": "http://www.w3.org/2002/07/owl#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "ram": "https://data.bnf.fr/ark:/12148/",
    "nsogg": "https://purl.org/bncf/tid/",
    "embne": "https://datos.bne.es/resource/",
    "lcsh": "https://id.loc.gov/authorities/subjects/",
}


def new_prefixes():
    return dict(DEFAULT_PREFIXES)


class Incomplete(Exception):
    """The text ends before the current statement is terminated."""


def unescape(value):
    """Resolve Turtle/N-Triples string escapes (\\" \\n \\uXXXX \\UXXXXXXXX)."""
    if "\\" not in value:
        return value

    def repl(m):
        code = m.group(1)
        if code[0] in "uU" and len(code) > 1:
            return chr(int(code[1:], 16))
        return _ESC_CHARS.get(code, code)
    return _ESC_RX.sub(repl, value)


class Literal(tuple):
    """(value, lang, datatype) — lang is '' when absent."""
    __slots__ = ()

    def __new__(cls, value, lang="", datatype=None):
        return tuple.__new__(cls, (value, lang, datatype))

    value = property(lambda self: self[0])
    lang = property(lambda self: self[1])
    datatype = property(lambda self: self[2])


class BNode(dict):
    """Anonymous node [ ... ]: predicate -> list of objects."""


def _tokens(text):
    pos, end = 0, len(text)
    out = []
    while pos < end:
        m = _TOKEN_RX.match(text, pos)
        if not m:
            if text[pos] in "\"'<":
                raise Incomplete()
            raise ValueError(f"unexpected Turtle input near: {text[pos:pos + 40]!r}")
        kind = m.lastgroup
        if kind not in ("ws", "comment"):
            out.append((kind, m.group()))
        pos = m.end()
    return out


class _Parser:
    def __init__(self, tokens, prefixes):
        self.t = tokens
        self.i = 0
        self.prefixes = prefixes

    def peek(self):
        if self.i >= len(self.t):
            raise Incomplete()
        return self.t[self.i]

    def take(self):
        tok = self.peek()
        self.i += 1
        return tok

    def expect(self, value):
        kind, text = self.take()
        if text != value:
            raise ValueError(f"expected {value!r}, found {text!r}")

    def term(self, kind, text):
        if kind == "iri":
            return text[1:-1]
        if kind == "pname":
            prefix, _, local = text.partition(":")
            base = self.prefixes.get(prefix)
            return base + local if base is not None else text
        if kind in ("word", "bnl"):
            return text  # 'a', true, false, _:label
        if kind == "num":
            return Literal(text)
        raise ValueError(f"unexpected token {text!r}")

    def obj(self):
        kind, text = self.take()
        if kind in ("lit", "lit3", "lits"):
            q = 3 if kind == "lit3" else 1
            value = unescape(text[q:-q])
            lang, datatype = "", None
            if self.i < len(self.t):
                nk, nt = self.t[self.i]
                if nk == "lang":
                    lang = nt[1:].lower()
                    self.i += 1
                elif nk == "dt":
                    self.i += 1
                    dk, dt = self.take()
                    datatype = self.term(dk, dt)
            return Literal(value, lang, datatype)
        if text == "[":
            node = BNode()
            if self.peek()[1] != "]":
                self.predicate_list(node)
            self.expect("]")
            return node
        if text == "(":
            items = []
            while self.peek()[1] != ")":
                items.append(self.obj())
            self.take()
            return items
        return self.term(kind, text)

    def predicate_list(self, target):
        while True:
            kind, text = self.take()
            pred = "a" if (kind == "word" and text == "a") else self.term(kind, text)
            objects = target.setdefault(pred, [])
            objects.append(self.obj())
            while self.peek()[1] == ",":
                self.take()
                objects.append(self.obj())
            if self.peek()[1] != ";":
                return
            while self.peek()[1] == ";":
                self.take()
            if self.peek()[1] in (".", "]"):
                return

    def statements(self):
        """Yield (subject, {predicate: [objects]}) until the tokens run out."""
        while self.i < len(self.t):
            kind, text = self.take()
            if kind == "lang" and text in ("@prefix", "@base"):
                name = self.take()[1]
                iri = self.take()[1][1:-1]
                self.expect(".")
                if text == "@prefix":
                    self.prefixes[name[:-1]] = iri
                continue
            if kind == "word" and text.upper() == "PREFIX":
                name = self.take()[1]
                self.prefixes[name[:-1]] = self.take()[1][1:-1]
                continue
            if text == "[":
                subject = BNode()
                if self.peek()[1] != "]":
                    self.predicate_list(subject)
                self.expect("]")
            else:
                subject = self.term(kind, text)
            props = {}
            if self.peek()[1] != ".":
                self.predicate_list(props)
            self.expect(".")
            yield subject, props


def parse_statements(text, prefixes=None):
    """Parse complete Turtle text; returns a list of (subject, props).

    `prefixes` (dict) is used and updated in place, so @prefix lines seen in
    an earlier chunk keep applying to later chunks of the same file.
    Raises Incomplete if the last statement is not terminated.
    """
    prefixes = new_prefixes() if prefixes is None else prefixes
    return list(_Parser(_tokens(text), prefixes).statements())


def iter_statement_groups(lines, prefixes=None, rejected=None):
    """Stream (subject, props) from an iterable of Turtle lines.

    Lines are buffered until the buffer holds complete statements, so a
    predicate list continued on the next line (or a multi-line literal) is
    never split. Memory stays bounded by the largest statement group.
    A group that cannot be parsed is skipped and, when `rejected` is a list,
    recorded there (first 200 characters) instead of aborting the build.
    """
    prefixes = new_prefixes() if prefixes is None else prefixes
    buf = []
    for line in lines:
        buf.append(line)
        if not line.rstrip().endswith("."):
            continue
        text = "".join(buf)
        try:
            stmts = parse_statements(text, prefixes)
        except Incomplete:
            continue
        except ValueError:
            if rejected is not None:
                rejected.append(text[:200])
            buf = []
            continue
        buf = []
        yield from stmts
    rest = "".join(buf).strip()
    if rest:
        try:
            yield from parse_statements(rest, prefixes)
        except (Incomplete, ValueError):
            if rejected is not None:
                rejected.append(rest[:200])


def objects(props, *predicates):
    """All objects of the given predicates, in source order."""
    out = []
    for p in predicates:
        out.extend(props.get(p, ()))
    return out


def iris(props, *predicates):
    return [o for o in objects(props, *predicates) if isinstance(o, str)]


def literals(props, *predicates, lang=None):
    """Literal values; with lang=... only that language tag ('' = untagged)."""
    return [o.value for o in objects(props, *predicates)
            if isinstance(o, Literal) and (lang is None or o.lang == lang)]


def unique(values):
    """De-duplicate preserving first-seen order."""
    seen = set()
    return [v for v in values if not (v in seen or seen.add(v))]


# N-Triples: one triple per line, with language tag or datatype kept.
NT_RX = re.compile(
    r'^\s*<([^>]+)>\s+<([^>]+)>\s+'
    r'(?:<([^>]+)>|"((?:[^"\\]|\\.)*)"(?:@([A-Za-z]+(?:-[A-Za-z0-9]+)*)|\^\^<[^>]+>)?)'
    r'\s*\.\s*$')


def parse_nt_line(line):
    """-> (subject, predicate, object_iri, literal_value, lang) or None."""
    m = NT_RX.match(line)
    if not m:
        return None
    s, p, o_iri, o_lit, lang = m.groups()
    if o_lit is not None:
        o_lit = unescape(o_lit)
    return s, p, o_iri, o_lit, (lang or "").lower()


def pick_label(candidates, preferred):
    """candidates: [(value, lang)] in source order. Returns the first value in
    the first preferred language ('' = untagged) that is present, else None.
    Deterministic and independent of the order of the other languages."""
    for want in preferred:
        for value, lang in candidates:
            if lang == want:
                return value
    return None
