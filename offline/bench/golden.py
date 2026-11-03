#!/usr/bin/env python3
"""Golden outputs of the command-line checker, for the browser check to match byte for byte.

    python3 offline/bench/golden.py           write offline/golden/ again
    python3 offline/bench/golden.py --check   exit 1 if offline/golden/ is not what this script writes now

Each case is a folder under offline/golden/ holding its input files, `case.json` (the arguments, and for a case the
browser page can also run, the page's choices), and what the checker gave: `exit_status.txt`, `stdout.txt` (the
printed summary), `stderr.txt`, and `report.json` and `report.html` when it wrote them. `evaluated_at` is fixed at
2000-01-01T00:00:00Z. The checker runs in this process with the case folder as working directory, so a refusal names
the files as `source.csv` and `destination.csv`, the names the browser shows.

A case marked `page` is also run through the browser page's code (ui/src/test/offline/golden.test.ts) with the
premises' origin "browser form": its output must be the same apart from that origin. Every case must give the same
output on every supported Python version; CI checks this one on 3.9, 3.11 and 3.14.
"""
import codecs
import contextlib
from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "offline"))
from flowassert_offline import cli  # noqa: E402

GOLDEN = ROOT / "offline" / "golden"
EVALUATED_AT = datetime(2000, 1, 1, tzinfo=timezone.utc)
EXAMPLE_SOURCE = (ROOT / "offline/examples/source.csv").read_bytes()
EXAMPLE_DESTINATION = (ROOT / "offline/examples/destination.csv").read_bytes()
OUTPUTS = ("exit_status.txt", "stdout.txt", "stderr.txt", "report.json", "report.html")


class _FixedDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return EVALUATED_AT


def canonical_config(config):
    """The bytes the browser page writes for a configuration: see canonicalConfig in ui/src/offline/check.ts."""
    return (json.dumps(config, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def utf8(text):
    return text.encode("utf-8")


# A configuration with one field per rule, and rows that pass, fail or stay unknown under each.
RULES = {"key": ["id", "id"], "fields": [
    {"source": "name", "destination": "name", "rule": "trim"},
    {"source": "email", "destination": "mail", "rule": "casefold"},
    {"source": "phone", "destination": "tel", "rule": "digits"},
    {"source": "signed", "destination": "signed_on", "rule": "date:%Y-%m-%d"},
    {"source": "at", "destination": "at", "rule": "date:%d/%m/%Y %H:%M:%S.%f %z"},
    {"source": "code", "destination": "code", "rule": "exact"}], "scope": "source"}
RULES_SOURCE = utf8(
    "id,name,email,phone,signed,at,code\n"
    "P1, Ada ,Ada@Example.test,+1 (212) 555-0101,2026-01-02,02/01/2026 09:00:00.5 +0800,A1\n"
    "P2,Grace,Straße@x.test,555 0102,2026-1-2,1/1/2026 23:59:59.999999 -0130,B2\n"
    "P3,Alan,ΣΊΣΥΦΟΣ@x.test,٣ 12,2026-02-03,03/02/2026 10:00:00.0 +0000,C3\n")
RULES_PASS = utf8(
    "id,name,mail,tel,signed_on,at,code\n"
    "P1,Ada,ada@example.test,12125550101,2026-01-02,02/01/2026 01:00:00.500000 +0000,A1\n"
    "P2,  Grace\t,STRASSE@X.TEST,5550102,2026-01-02,02/01/2026 01:29:59.999999 +00:00,B2\n"
    "P3,Alan,σίσυφοσ@x.test,(12),2026-02-03,03/02/2026 10:00:00.0 Z,C3\n")
RULES_FAIL = utf8(
    "id,name,mail,tel,signed_on,at,code\n"
    "P1,Ada Lovelace,ada@example.org,12125550199,2026-01-03,02/01/2026 01:00:00.4 +0000,a1\n"
    "P2,Grace H,strasse@y.test,555 0103,2025-01-02,02/01/2026 01:30:00 +0000,B2 \n"
    "P3,Alan,sisyphos@x.test,99,2026-03-02,03/02/2026 10:00:00 +0100,C 3\n")
RULES_UNKNOWN = utf8(
    "id,name,mail,tel,signed_on,at,code\n"
    "P1,   ,,n/a,02/01/2026,2026-01-02 09:00,\n"
    "P2,,x,none,2026-02-30,32/01/2026 00:00:00.0 +0000,\n"
    "P3,Alan,,—,2026-13-01,03/02/2026 10:00:00.0 +2400,\n")

UNSAFE_SOURCE = utf8(
    "id,名前,note\n"
    "<script>alert(1)</script>,\"<b>\"\"bold\"\" & 'quoted'</b>\",​zero width\n"
    "K-ü,名字 Zoë,tab\there\n"
    "K-😀,emoji 😀,\"line\nbreak\"\n"
    "K-ctl,\x01\x7f\x85,\\back\\slash\n")
UNSAFE_DESTINATION = utf8(
    "id,名前,note\n"
    "<script>alert(1)</script>,<b>\"bold\" & 'quoted'</b>,zero width\n"
    "K-ü,名字 Zoe,tab\there\n"
    "K-😀,emoji 😀,\"line\r\nbreak\"\n"
    "K-ctl,\x01\x7f\x85,\\back\\slash \n"
    "K-only-in-destination,x,y\n")

EXAMPLE_ARGS = ["--key", "external_id", "--field", "phone", "--field", "email:hs_email"]
EXAMPLE_CONFIG = {"key": ["external_id", "external_id"], "fields": [
    {"source": "phone", "destination": "phone", "rule": "exact"},
    {"source": "email", "destination": "hs_email", "rule": "exact"}], "scope": "source"}
KP = {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "exact"}], "scope": "source"}


def page(config, source=None, destination=None, encodings=("utf-8", "utf-8"), **premises):
    """A case the browser page can run: its configuration, encodings and premises, and the files."""
    return {"config": config, "source": source, "destination": destination, "encodings": encodings, **premises}


def gb18030(text):
    return text.encode("gb18030")


# name: (files, arguments) for a command-line case, or (files, page(...)) for a case the page can run too.
CASES = {
    # The v0.1.0 example, as the README and the first-check guide run it.
    "example": ({}, EXAMPLE_ARGS + ["--source-complete", "--destination-complete"]),
    "example-without-premises": ({}, EXAMPLE_ARGS),
    "example-page": ({}, page(EXAMPLE_CONFIG, source_complete=True, destination_complete=True)),
    "example-page-source-complete-only": ({}, page(EXAMPLE_CONFIG, source_complete=True)),
    "example-page-destination-complete-only": ({}, page(EXAMPLE_CONFIG, destination_complete=True)),
    "example-page-no-premises": ({}, page(EXAMPLE_CONFIG)),
    "example-details-all": ({}, EXAMPLE_ARGS + ["--source-complete", "--destination-complete", "--details", "all"]),
    "example-redacted": ({}, EXAMPLE_ARGS + ["--source-complete", "--destination-complete", "--redact-values"]),
    "example-max-details-1": ({}, EXAMPLE_ARGS + ["--max-details", "1"]),
    "example-max-details-0": ({}, EXAMPLE_ARGS + ["--max-details", "0"]),
    # Every rule passing, failing and unknown.
    "rules-pass": ({"source.csv": RULES_SOURCE, "destination.csv": RULES_PASS},
                   page(RULES, source_complete=True, destination_complete=True)),
    "rules-fail": ({"source.csv": RULES_SOURCE, "destination.csv": RULES_FAIL},
                   page(RULES, source_complete=True, destination_complete=True)),
    "rules-unknown": ({"source.csv": RULES_SOURCE, "destination.csv": RULES_UNKNOWN},
                      page(RULES, source_complete=True, destination_complete=True)),
    "rules-redacted": ({"source.csv": RULES_SOURCE, "destination.csv": RULES_FAIL, "config.json": canonical_config(RULES)},
                       ["--config", "config.json", "--redact-values", "--details", "all"]),
    # A UTC conversion outside the years 1-9999: Python raises OverflowError, an internal failure (exit 4).
    "date-overflow-internal-failure": (
        {"source.csv": utf8("k,t\n1,0001-01-01 00:00 +0100\n"), "destination.csv": utf8("k,t\n1,0001-01-01 00:00 +0100\n"),
         "config.json": canonical_config({"key": ["k", "k"], "fields": [
             {"source": "t", "destination": "t", "rule": "date:%Y-%m-%d %H:%M %z"}], "scope": "source"})},
        ["--config", "config.json", "--allow-identical-content"]),
    # Both scopes, with and without each premise.
    "scope-exact-source-known": ({"source.csv": UNSAFE_SOURCE, "destination.csv": UNSAFE_DESTINATION},
                                 page({**KP, "key": ["id", "id"], "fields": [
                                     {"source": "名前", "destination": "名前", "rule": "exact"},
                                     {"source": "note", "destination": "note", "rule": "trim"}], "scope": "exact"},
                                      source_complete=True)),
    "scope-exact-source-unknown": ({"source.csv": UNSAFE_SOURCE, "destination.csv": UNSAFE_DESTINATION},
                                   page({"key": ["id", "id"], "fields": [
                                       {"source": "note", "destination": "note", "rule": "casefold"}], "scope": "exact"},
                                        destination_complete=True)),
    "scope-exact-no-extra": ({}, page({**EXAMPLE_CONFIG, "scope": "exact"}, source_complete=True,
                                      destination_complete=True)),
    "scope-exact-keyless-destination": (
        {"source.csv": utf8("k,p\nA,1\nB,2\n"), "destination.csv": utf8("k,p\nA,1\n ,2\nC,3\nC,3\n")},
        page({**KP, "scope": "exact"}, source_complete=True, destination_complete=True)),
    "scope-source-cli": ({}, EXAMPLE_ARGS + ["--scope", "source", "--source-complete"]),
    "scope-exact-cli": ({}, EXAMPLE_ARGS + ["--scope", "exact", "--source-complete", "--destination-complete",
                                            "--redact-values"]),
    # Stated counts.
    "count-source-mismatch": ({}, page(EXAMPLE_CONFIG, source_complete=True, destination_complete=True,
                                       source_count="5")),
    "count-destination-mismatch": ({}, page(EXAMPLE_CONFIG, source_complete=True, destination_complete=True,
                                            destination_count="3")),
    "count-destination-mismatch-without-complete": ({}, page(EXAMPLE_CONFIG, destination_count="5")),
    "counts-match": ({}, page(EXAMPLE_CONFIG, source_complete=True, destination_complete=True, source_count="4",
                              destination_count="4")),
    "counts-zero": ({"source.csv": utf8("k,p\n"), "destination.csv": utf8("p,k\n\n")},
                    page(KP, source_complete=True, destination_complete=True, source_count="0", destination_count="0")),
    "count-cli-forms": ({}, EXAMPLE_ARGS + ["--source-count", "+4", "--destination-count", "0_4"]),
    # Keys: duplicates on each side, rows without a key, empty values.
    "duplicate-source-key": ({"source.csv": utf8("k,p\nA,1\nA,1\nB,2\n"), "destination.csv": utf8("k,p\nA,1\nB,2\n")},
                             page(KP, source_complete=True, destination_complete=True)),
    "duplicate-destination-key": ({"source.csv": utf8("k,p\nA,1\nB,2\n"), "destination.csv": utf8("k,p\nA,1\nA,2\nB,2\n")},
                                  page(KP, source_complete=True, destination_complete=True)),
    "keyless-rows": ({"source.csv": utf8("k,p\n,1\n  ,2\nB,2\n"), "destination.csv": utf8("k,p\n\t,1\nB,2\n")},
                     page(KP, source_complete=True, destination_complete=True)),
    "empty-values": ({"source.csv": utf8("k,p\nA,\nB,2\nC,\n"), "destination.csv": utf8("k,p\nA,1\nB,\nC,\n")},
                     page(KP, source_complete=True, destination_complete=True)),
    "no-rows": ({"source.csv": utf8("k,p\n"), "destination.csv": utf8("k,p\r\n")},
                page(KP, source_complete=True, destination_complete=True)),
    # Encodings, a byte order mark, and decoding failures.
    "encoding-utf8-bom": ({"source.csv": codecs.BOM_UTF8 + utf8("k,p\nK1,名字 Zoë\n"),
                           "destination.csv": utf8("p,k\n名字 Zoë,K1\n")},
                          page(KP, source_complete=True, destination_complete=True)),
    "encoding-utf16-le": ({"source.csv": "k,p\r\nK1,名字 Zoë 😀\r\n".encode("utf-16"),
                           "destination.csv": codecs.BOM_UTF16_LE + "p,k\nK2,K1\n".encode("utf-16-le")},
                          page(KP, encodings=("utf-16", "utf-16"), source_complete=True)),
    "encoding-utf16-be": ({"source.csv": codecs.BOM_UTF16_BE + "k,p\nK1,名字\n".encode("utf-16-be"),
                           "destination.csv": utf8("p,k\n名字,K1\n")},
                          page(KP, encodings=("utf-16", "utf-8"), source_complete=True, destination_complete=True)),
    "encoding-gb18030": ({"source.csv": gb18030("k,p\nK1,名字 Zoë €\n"),
                          "destination.csv": utf8("p,k\n名字 Zoë €,K1\n")},
                         page(KP, encodings=("gb18030", "utf-8"), source_complete=True, destination_complete=True)),
    # Byte sequences that Python and the browser's TextDecoder decode differently: Python's mapping is the reference.
    "encoding-gb18030-python-mapping": (
        {"source.csv": b"k,p\nK1," + bytes.fromhex("a8bc a6d9 fe59 8135f437 a3a0") + b"\n",
         "destination.csv": utf8("p,k\nḿ,K1\n")},
        page(KP, encodings=("gb18030", "utf-8"), source_complete=True, destination_complete=True)),
    "encoding-cli-options": ({"source.csv": gb18030("k,p\nK1,名字\n"), "destination.csv": utf8("p,k\n名字,K1\n")},
                             ["--key", "k", "--field", "p", "--source-encoding", "gb18030"]),
    "decode-utf8-invalid": ({"source.csv": b"k,p\nK1,\xff\n", "destination.csv": utf8("k,p\nK1,x\n")},
                            page(KP, source_complete=True)),
    "decode-utf8-truncated": ({"source.csv": utf8("k,p\nK1,x\n"), "destination.csv": b"k,p\nK1,\xe5\x90"},
                              page(KP)),
    "decode-utf16-no-bom": ({"source.csv": "k,p\nK1,x\n".encode("utf-16-le"), "destination.csv": utf8("k,p\nK1,x\n")},
                            page(KP, encodings=("utf-16", "utf-8"))),
    "decode-utf16-odd-length": ({"source.csv": utf8("k,p\nK1,x\n"),
                                 "destination.csv": "k,p\nK1,x\n".encode("utf-16") + b"\x00"},
                                page(KP, encodings=("utf-8", "utf-16"))),
    "decode-utf16-lone-surrogate": ({"source.csv": codecs.BOM_UTF16_LE + "k,p\nK1,".encode("utf-16-le") +
                                     b"\x00\xd8" + "\n".encode("utf-16-le"),
                                     "destination.csv": utf8("k,p\nK1,x\n")},
                                    page(KP, encodings=("utf-16", "utf-8"))),
    "decode-gb18030-invalid": ({"source.csv": b"k,p\nK1,\x80\n", "destination.csv": utf8("k,p\nK1,x\n")},
                               page(KP, encodings=("gb18030", "utf-8"))),
    "decode-wrong-encoding": ({"source.csv": gb18030("k,p\nK1,名字\n"), "destination.csv": utf8("k,p\nK1,x\n")},
                              page(KP)),
    # Python decodes in chunks of 8192 bytes when the CSV reader asks for more, so the first problem wins.
    "chunk-csv-error-before-later-decode-error": (
        {"source.csv": b"k,p\nK1,1,extra\n" + b"K,x\n" * 2100 + b"K,\xff\n", "destination.csv": utf8("k,p\nK1,x\n")},
        page(KP)),
    "chunk-decode-error-in-first-chunk": (
        {"source.csv": b"k,p\nK1,1,extra\n" + b"K,x\n" * 1000 + b"K,\xff\n", "destination.csv": utf8("k,p\nK1,x\n")},
        page(KP)),
    # Quoting: doubled quotes, line breaks of every kind inside quotes and between rows, blank lines.
    "quoted-line-breaks": (
        {"source.csv": b'k,p\r\nA,"one\r\ntwo"\r\nB,"x""y"\r\n\r\nC,"a\rb"\r\nD,"\n"\r\n',
         "destination.csv": b'p,k\r"one\r\ntwo",A\r"x""y",B\r\r"a\rb",C\r"\r\n",D\r'},
        page(KP, source_complete=True, destination_complete=True)),
    "line-number-after-quoted-break": ({"source.csv": b'k,p\nA,"1\n2\n3"\n\nB,2,3\n', "destination.csv": utf8("k,p\nA,1\n")},
                                       page(KP)),
    # Refusals.
    "refused-unexpected-end": ({"source.csv": utf8('k,p\n"1,2\n'), "destination.csv": utf8("k,p\n1,2\n")}, page(KP)),
    "refused-quote-not-followed-by-comma": ({"source.csv": utf8('k,p\n"1"x,2\n'), "destination.csv": utf8("k,p\n1,2\n")},
                                            page(KP)),
    "refused-repeated-column": ({"source.csv": utf8("k,p,p\n1,2,3\n"), "destination.csv": utf8("k,p\n1,2\n")}, page(KP)),
    "refused-missing-columns": ({"source.csv": utf8("k,p\n1,2\n"), "destination.csv": utf8("x,y\n1,2\n")},
                                page({**KP, "fields": [{"source": "p", "destination": "q", "rule": "exact"}]})),
    "refused-empty-file": ({"source.csv": b"", "destination.csv": utf8("k,p\n1,2\n")}, page(KP)),
    "refused-row-wider-than-header": ({"source.csv": utf8("k,p\n1,2\n3,4,5\n"), "destination.csv": utf8("k,p\n1,2\n")},
                                      page(KP)),
    "refused-row-narrower-than-header": ({"source.csv": utf8("k,p\n1,2\n"), "destination.csv": utf8("k,p\n\n1\n")},
                                         page(KP)),
    "refused-field-limit": ({"source.csv": b"k,p\n1," + b"x" * 131073 + b"\n", "destination.csv": utf8("k,p\n1,2\n")},
                            page(KP)),
    "field-at-limit": ({"source.csv": b"k,p\n1," + b"x" * 131072 + b"\n", "destination.csv": b"p,k\n" + b"x" * 131072 + b",1\n"},
                       page(KP, source_complete=True, destination_complete=True)),
    "refused-identical-content": ({"source.csv": utf8("k,p\n1,2\n"), "destination.csv": utf8("k,p\n1,2\n")}, page(KP)),
    "identical-content-allowed": ({"source.csv": utf8("k,p\n1,2\n"), "destination.csv": utf8("k,p\n1,2\n")},
                                  page(KP, source_complete=True, destination_complete=True,
                                       allow_identical_content=True)),
    "refused-same-file": ({"source.csv": utf8("k,p\n1,2\n")},
                          ["--source", "source.csv", "--destination", "./source.csv", "--key", "k", "--field", "p"]),
    "refused-max-rows": ({}, EXAMPLE_ARGS + ["--max-rows", "3"]),
    "max-rows-at-limit": ({}, EXAMPLE_ARGS + ["--max-rows", "4"]),
    "refused-max-bytes": ({}, EXAMPLE_ARGS + ["--max-bytes", "100"]),
    "refused-bad-count": ({}, EXAMPLE_ARGS + ["--source-count", "4.0"]),
    "refused-negative-count": ({}, EXAMPLE_ARGS + ["--destination-count", "-1"]),
    "refused-bad-encoding-name": ({}, EXAMPLE_ARGS + ["--source-encoding", "latin-1"]),
    "refused-bad-scope": ({}, EXAMPLE_ARGS + ["--scope", "both"]),
    "refused-bad-details": ({}, EXAMPLE_ARGS + ["--details", "full"]),
    "refused-no-field": ({}, ["--key", "external_id"]),
    "refused-empty-key-column": ({}, ["--key", ":external_id", "--field", "phone"]),
    "refused-repeated-field": ({}, ["--key", "external_id", "--field", "phone", "--field", "phone:email"]),
    "refused-config-premise": ({"config.json": utf8('{"key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}],'
                                                    ' "source_complete": true, "Destination-Count": 3}\n')},
                               ["--config", "config.json"]),
    "refused-config-unknown-member": ({"config.json": utf8('{"key": ["k", "k"], "fields": [], "zeta": 1, "alpha": 2}')},
                                      ["--config", "config.json"]),
    "refused-config-duplicate-member": ({"config.json": utf8('{"key": ["k", "k"], "key": ["a", "a"]}')},
                                        ["--config", "config.json"]),
    "refused-config-not-utf8": ({"config.json": b'{"key": ["k\xff", "k"]}'}, ["--config", "config.json"]),
    "refused-config-not-json": ({"config.json": b"{key: 1}"}, ["--config", "config.json"]),
    "refused-config-unknown-rule": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "Trim"}]})}, ["--config", "config.json"]),
    "refused-config-malformed-date": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "date:%Y-%q"}]})},
        ["--config", "config.json"]),
    "refused-config-stray-percent": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "date:%Y %"}]})},
        ["--config", "config.json"]),
    "refused-config-no-directive": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "date:%%Y"}]})},
        ["--config", "config.json"]),
    "refused-config-repeated-field": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}, {"source": "p", "destination": "q"}]})},
        ["--config", "config.json"]),
    "refused-config-bad-scope": ({"config.json": canonical_config({**KP, "scope": None})}, ["--config", "config.json"]),
    "refused-config-with-key": ({"config.json": canonical_config(KP)}, ["--config", "config.json", "--key", "k"]),
    # A configuration file loaded in the page keeps its own bytes and hash: here, a byte order mark and no rules.
    "config-loaded-with-bom": ({"config.json": codecs.BOM_UTF8 + utf8(
        '{"fields":[{"source":"phone","destination":"phone"},{"source":"email","destination":"hs_email","rule":"casefold"}],'
        '"key":["external_id","external_id"]}')},
        page(None, source_complete=True, destination_complete=True)),
    # Values that need escaping: HTML, quotes, control characters, characters outside the BMP.
    "unsafe-values": ({"source.csv": UNSAFE_SOURCE, "destination.csv": UNSAFE_DESTINATION},
                      page({"key": ["id", "id"], "fields": [{"source": "名前", "destination": "名前", "rule": "exact"},
                                                            {"source": "note", "destination": "note", "rule": "exact"}],
                            "scope": "source"}, source_complete=True, destination_complete=True)),
    "unsafe-values-details-all": ({"source.csv": UNSAFE_SOURCE, "destination.csv": UNSAFE_DESTINATION},
                                  ["--key", "id", "--field", "名前", "--field", "note", "--details", "all",
                                   "--source-complete", "--destination-complete", "--redact-values"]),
}


def _files(name, spec):
    files, run = spec
    files = dict(files)
    files.setdefault("source.csv", EXAMPLE_SOURCE)
    files.setdefault("destination.csv", EXAMPLE_DESTINATION)
    case = {"name": name}
    if isinstance(run, dict):
        if run["config"] is not None:
            files["config.json"] = canonical_config(run["config"])
        source_encoding, destination_encoding = run["encodings"]
        args = ["--config", "config.json", "--source-encoding", source_encoding,
                "--destination-encoding", destination_encoding]
        for flag, member in (("--source-complete", "source_complete"), ("--destination-complete", "destination_complete"),
                             ("--allow-identical-content", "allow_identical_content")):
            if run.get(member):
                args.append(flag)
        for flag, member in (("--source-count", "source_count"), ("--destination-count", "destination_count")):
            if run.get(member) is not None:
                args += [flag, run[member]]
        case["page"] = {
            "source_encoding": source_encoding, "destination_encoding": destination_encoding,
            "config": "canonical" if run["config"] is not None else "loaded",
            **{m: bool(run.get(m)) for m in ("source_complete", "destination_complete", "allow_identical_content")},
            **{m: run.get(m) for m in ("source_count", "destination_count")},
        }
    else:
        args = run
    if "--source" not in args:
        args = ["--source", "source.csv", "--destination", "destination.csv"] + args
    case["args"] = args
    return files, case


def write_case(folder, name, spec):
    """Write one case's inputs and the checker's outputs into `folder`."""
    files, case = _files(name, spec)
    folder.mkdir(parents=True)
    for file, data in files.items():
        (folder / file).write_bytes(data)
    (folder / "case.json").write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    stdout, stderr = io.StringIO(), io.StringIO()
    cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        # Run in a copy, so the reports are new files the checker may create.
        for file, data in files.items():
            Path(tmp, file).write_bytes(data)
        os.chdir(tmp)
        saved = cli.datetime
        cli.datetime = _FixedDatetime
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = cli.main(case["args"] + ["--json", "report.json", "--html", "report.html"])
        finally:
            cli.datetime = saved
            os.chdir(cwd)
        for report in ("report.json", "report.html"):
            if Path(tmp, report).exists():
                shutil.copyfile(Path(tmp, report), folder / report)
    (folder / "exit_status.txt").write_text(f"{code}\n", encoding="utf-8")
    (folder / "stdout.txt").write_bytes(stdout.getvalue().encode("utf-8"))
    (folder / "stderr.txt").write_bytes(stderr.getvalue().encode("utf-8"))


def write_all(target):
    for name, spec in CASES.items():
        write_case(target / name, name, spec)


def differences(expected_root, actual_root):
    """Paths, relative to the roots, that are missing, extra or different."""
    def tree(root):
        return {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()} if root.exists() else {}
    expected, actual = tree(expected_root), tree(actual_root)
    return sorted(name for name in expected.keys() | actual.keys()
                  if name not in expected or name not in actual or expected[name].read_bytes() != actual[name].read_bytes())


def check():
    """The paths under offline/golden/ that differ from what write_all writes now."""
    with tempfile.TemporaryDirectory() as tmp:
        write_all(Path(tmp))
        return differences(Path(tmp), GOLDEN)


def main(argv):
    if argv == ["--check"]:
        diff = check()
        for name in diff:
            print(f"offline/golden/{name} is not current", file=sys.stderr)
        if diff:
            print("run python3 offline/bench/golden.py to write it again", file=sys.stderr)
        return 1 if diff else 0
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    if GOLDEN.exists():
        shutil.rmtree(GOLDEN)
    write_all(GOLDEN)
    print(f"wrote {len(CASES)} cases to {GOLDEN}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
