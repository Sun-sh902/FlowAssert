#!/usr/bin/env python3
"""Golden outputs of the command-line checker, for the browser check to match byte for byte.

    python3 offline/bench/golden.py           write offline/golden/ again
    python3 offline/bench/golden.py --check   exit 1 if offline/golden/ or offline/golden-sheets/ is not what this
                                              script writes now

Each case is a folder under offline/golden/ holding its input files, `case.json` (the arguments, and for a case the
browser page can also run, the page's choices), and what the checker gave: `exit_status.txt`, `stdout.txt` (the
printed summary), `stderr.txt`, and `report.json` and `report.html` when it wrote them. `evaluated_at` is fixed at
2000-01-01T00:00:00Z. The checker runs in this process with the case folder as working directory, so a refusal names
the files as `source.csv` and `destination.csv`, the names the browser shows.

A case marked `page` is also run through the browser page's code (ui/src/test/offline/golden.test.ts) with the
premises' origin "browser form": its output must be the same apart from that origin. Every case must give the same
output on every supported Python version; CI checks this one on 3.9, 3.11 and 3.14.

The cases whose source is a Google Sheets range (0.7.0) are written to offline/golden-sheets/ instead, because the
browser cannot run them: it makes no request to Google. Each holds `sheet-responses.json`, the synthetic responses a
local fake of the two endpoints serves (fake_sheets_api.py), and `requests.json`, what the checker asked it for, with
any API key replaced by the variable's name. Nothing contacts Google. `read_at` is fixed like `evaluated_at`.
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
from flowassert_offline import cli, sheets  # noqa: E402

sys.path.insert(0, str(ROOT / "offline" / "bench"))
from fake_sheets_api import FAKE_KEY, FAKE_TOKEN, FakeSheetsApi, drive, error, values  # noqa: E402

GOLDEN = ROOT / "offline" / "golden"
GOLDEN_SHEETS = ROOT / "offline" / "golden-sheets"
EVALUATED_AT = datetime(2000, 1, 1, tzinfo=timezone.utc)
EXAMPLE_SOURCE = (ROOT / "offline/examples/source.csv").read_bytes()
EXAMPLE_DESTINATION = (ROOT / "offline/examples/destination.csv").read_bytes()
OUTPUTS = ("exit_status.txt", "stdout.txt", "stderr.txt", "report.json", "report.html")
SHEET_VARIABLES = ("FLOWASSERT_SHEETS_TOKEN", "FLOWASSERT_SHEETS_API_KEY", "FLOWASSERT_SHEETS_TEST_ENDPOINT")


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
    # A UTC conversion outside the years 1-9999: no value to compare, so the field is unknown.
    "date-overflow-unknown": (
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
    "refused-config-repeated-directive": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p", "rule": "date:%Y-%m-%d %Y"}]})},
        ["--config", "config.json"]),
    "refused-config-repeated-field": ({"config.json": canonical_config(
        {"key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}, {"source": "p", "destination": "q"}]})},
        ["--config", "config.json"]),
    "refused-config-bad-scope": ({"config.json": canonical_config({**KP, "scope": None})}, ["--config", "config.json"]),
    "refused-config-with-key": ({"config.json": canonical_config(KP)}, ["--config", "config.json", "--key", "k"]),
    # A mapping file (command line only): column names with a colon, every rule exact, and the file's hash recorded.
    "mapping-file": ({"source.csv": utf8("ext:id,phone:main\nA,1\nB,2\n"), "destination.csv": utf8("id,tel\nA,1\nB,3\n"),
                      "mapping.json": utf8('{"key": ["ext:id", "id"], "fields": [["phone:main", "tel"]]}\n')},
                     ["--mapping", "mapping.json", "--source-complete", "--destination-complete"]),
    "refused-mapping-with-key": ({"mapping.json": utf8('{"key": ["k", "k"], "fields": [["p", "p"]]}\n')},
                                 ["--mapping", "mapping.json", "--key", "k"]),
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

# The scenarios of offline/examples/scenarios/ (0.6.0): each expectation of scenarios.json is a case the page runs,
# named scenario-ID-PREMISES, so the command line and the browser are held to the same result for each.
SCENARIOS = ROOT / "offline" / "examples" / "scenarios"
SCENARIO_PREMISES = {(True, True): "both-statements", (True, False): "source-statement",
                     (False, True): "destination-statement", (False, False): "no-statements"}
for _scenario in json.loads((SCENARIOS / "scenarios.json").read_text(encoding="utf-8"))["scenarios"]:
    _folder = SCENARIOS / _scenario["id"]
    for _expect in _scenario["expect"]:
        _premises = _expect["premises"]
        _suffix = SCENARIO_PREMISES[(_premises["source_complete"], _premises["destination_complete"])]
        CASES[f"scenario-{_scenario['id']}-{_suffix}"] = (
            {"source.csv": (_folder / "source.csv").read_bytes(), "destination.csv": (_folder / "destination.csv").read_bytes()},
            page(_scenario["config"], **_premises))


# ---------- Google Sheets source (offline/golden-sheets/) ----------

SHEET_ID = "1SyntheticSpreadsheet-FlowAssert_0001"
SHEET_RANGE = "Leads!A1:C"
SHEET_RETURNED = "Leads!A1:C1000"
LEADS = [["lead_id", "phone", "email"],
         ["LEAD-001", "+1 555 0100 001", "lead001@example.test"],
         ["LEAD-002", "+1 555 0100 002", "lead002@example.test"],
         ["LEAD-003", "+1 555 0100 003", "lead003@example.test"]]
CRM = utf8("lead_id,phone,hs_email\n"
           "LEAD-001,+1 555 0100 001,lead001@example.test\n"
           "LEAD-002,+1 555 0100 002,lead002@example.test\n"
           "LEAD-003,+1 555 0100 003,lead003@example.test\n")
CRM_MISMATCH = utf8("lead_id,phone,hs_email\n"
                    "LEAD-001,+1 555 0100 001,lead001@example.test\n"
                    "LEAD-002,+1 555 0100 092,lead002@example.test\n")
LEAD_ARGS = ["--key", "lead_id", "--field", "phone", "--field", "email:hs_email"]
# The canonical form of LEADS (flowassert-sheet-csv-1): a destination file with these bytes has identical content.
CANONICAL_LEADS = utf8("".join(",".join(row) + "\n" for row in [["lead_id", "phone", "email"]] + LEADS[1:]))
CANONICAL_ARGS = ["--key", "lead_id", "--field", "phone", "--field", "email"]
COMPLETE = ["--source-complete", "--destination-complete"]
SAME = [drive(57), drive(57)]


def sheet(args, rows=LEADS, *, responses=None, destination=CRM, files=None, credential="token", env=None,
          range_text=SHEET_RANGE, returned=SHEET_RETURNED):
    """A case whose source is a Google Sheets range, served by the local fake."""
    if responses is None:
        responses = {"drive": SAME, "values": [values(returned, rows)]}
    return {"args": ["--source-sheet", SHEET_ID, "--source-range", range_text, "--destination", "destination.csv"]
            + args, "responses": responses, "files": {"destination.csv": destination, **(files or {})},
            "credential": credential, "env": env or {}}


def refused_values(response, args=LEAD_ARGS):
    return sheet(args, responses={"drive": SAME, "values": [response]})


RAGGED = [["lead_id", "phone", "email"], ["LEAD-001", "+1 555 0100 001"], [], ["LEAD-003", "", "lead003@example.test"],
          ["LEAD-004"]]
RULES_SHEET = [["id", "signed", "tel", "note"], ["R1", "2026-01-02", "+1 (555) 0100-001", "Alpha"],
               ["R2", "2026-02-30", "555 0100 002", " beta "], ["R3", "2026-03-04", "n/a", "Gamma"]]
RULES_CRM = utf8("id,signed_on,tel,note\nR1,2026-01-02,15550100001,ALPHA\nR2,2026-02-28,5550100002,beta\n"
                 "R4,2026-05-06,5550100004,delta\n")
RULES_SHEET_CONFIG = {"key": ["id", "id"], "fields": [
    {"source": "signed", "destination": "signed_on", "rule": "date:%Y-%m-%d"},
    {"source": "tel", "destination": "tel", "rule": "digits"},
    {"source": "note", "destination": "note", "rule": "casefold"}], "scope": "exact"}

SHEET_CASES = {
    # Results: Verified, Mismatch and Unverified, as for a file, with the read recorded beside them.
    "sheet-verified": sheet(LEAD_ARGS + COMPLETE),
    "sheet-mismatch": sheet(LEAD_ARGS + COMPLETE, destination=CRM_MISMATCH),
    "sheet-unverified": sheet(LEAD_ARGS),
    "sheet-api-key": sheet(LEAD_ARGS + COMPLETE, credential="key"),
    "sheet-count-differs": sheet(LEAD_ARGS + COMPLETE + ["--source-count", "4", "--destination-count", "3"]),
    "sheet-config-rules-exact-redacted": sheet(["--config", "config.json", "--source-complete", "--details", "all",
                                                "--redact-values"], RULES_SHEET, destination=RULES_CRM,
                                               files={"config.json": canonical_config(RULES_SHEET_CONFIG)},
                                               range_text="'Q3 leads'!A2:D9", returned="'Q3 leads'!A2:D9"),
    # Rows as the API returns them: cells omitted at the end of a row, an empty row inside the range.
    "sheet-ragged-rows": sheet(LEAD_ARGS + COMPLETE, RAGGED, range_text="Leads!A1:C500", returned="Leads!A1:C500"),
    # The revision: not requested, or not given by Drive.
    "sheet-revision-not-requested": sheet(LEAD_ARGS + COMPLETE + ["--skip-source-revision"],
                                          responses={"values": [values(SHEET_RETURNED, LEADS)]}),
    "sheet-revision-not-given": sheet(LEAD_ARGS + COMPLETE, responses={
        "drive": [drive(None), drive(None)], "values": [values(SHEET_RETURNED, LEADS)]}),
    # Identical content: the destination file holds the canonical form of the values.
    "sheet-identical-content-refused": sheet(CANONICAL_ARGS, destination=CANONICAL_LEADS),
    "sheet-identical-content-allowed": sheet(CANONICAL_ARGS + ["--allow-identical-content"],
                                             destination=CANONICAL_LEADS),
    # Refusals before any request.
    "sheet-refused-no-credential": sheet(LEAD_ARGS, credential=None, responses={}),
    "sheet-refused-two-credentials": sheet(LEAD_ARGS, credential="both", responses={}),
    "sheet-refused-malformed-credential": sheet(LEAD_ARGS, credential="token", responses={},
                                                env={"FLOWASSERT_SHEETS_TOKEN": "two words"}),
    "sheet-refused-endpoint": sheet(LEAD_ARGS, responses={},
                                    env={"FLOWASSERT_SHEETS_TEST_ENDPOINT": "https://sheets.googleapis.com"}),
    "sheet-refused-no-tab": sheet(LEAD_ARGS, responses={}, range_text="A1:C"),
    "sheet-refused-unbounded-columns": sheet(LEAD_ARGS, responses={}, range_text="Leads!1:500"),
    "sheet-refused-named-range": sheet(LEAD_ARGS, responses={}, range_text="Leads2026"),
    "sheet-refused-reversed-range": sheet(LEAD_ARGS, responses={}, range_text="Leads!C1:A"),
    "sheet-refused-spreadsheet-id": {**sheet(LEAD_ARGS, responses={}),
                                     "args": ["--source-sheet", "../files", "--source-range", SHEET_RANGE,
                                              "--destination", "destination.csv"] + LEAD_ARGS},
    "sheet-refused-with-source": sheet(LEAD_ARGS + ["--source", "destination.csv"], responses={}),
    "sheet-refused-source-encoding": sheet(LEAD_ARGS + ["--source-encoding", "utf-8"], responses={}),
    "sheet-refused-range-without-sheet": {**sheet([], responses={}),
                                          "args": ["--source", "source.csv", "--destination", "destination.csv",
                                                   "--source-range", SHEET_RANGE] + LEAD_ARGS,
                                          "files": {"source.csv": CRM, "destination.csv": CRM_MISMATCH}},
    # Refusals of a read: every error, and every response in doubt.
    "sheet-refused-401": refused_values(error(401, "UNAUTHENTICATED")),
    "sheet-refused-403-drive": sheet(LEAD_ARGS, responses={"drive": [error(403, "PERMISSION_DENIED")]}),
    "sheet-refused-404": refused_values(error(404, "NOT_FOUND")),
    "sheet-refused-400": refused_values(error(400, "INVALID_ARGUMENT")),
    "sheet-refused-429": refused_values(error(429, "RESOURCE_EXHAUSTED")),
    "sheet-refused-503": refused_values(error(503, "UNAVAILABLE")),
    "sheet-refused-redirect": refused_values({"status": 302, "text": "",
                                              "headers": {"Location": "https://accounts.example.test/signin"}}),
    "sheet-refused-not-json": refused_values({"status": 200, "text": "<html>Synthetic sign-in page</html>"}),
    "sheet-refused-major-dimension": refused_values(values(SHEET_RETURNED, LEADS, major="COLUMNS")),
    "sheet-refused-range-differs": refused_values(values("Leads!A1:D1000", LEADS)),
    "sheet-refused-more-rows-than-range": sheet(LEAD_ARGS, range_text="Leads!A1:C3", returned="Leads!A1:C3"),
    "sheet-refused-cell-not-text": refused_values(values(SHEET_RETURNED, [LEADS[0], ["LEAD-001", 15550100001, "x"]])),
    "sheet-refused-value-beyond-header": refused_values(values(SHEET_RETURNED, [["lead_id", "phone"],
                                                                                ["LEAD-001", "1", "x"]]),
                                                        ["--key", "lead_id", "--field", "phone"]),
    "sheet-refused-missing-column": refused_values(values(SHEET_RETURNED, [["lead_id", "Phone", "email"]])),
    "sheet-refused-empty-range": refused_values(values(SHEET_RETURNED, [])),
    "sheet-refused-max-rows": sheet(LEAD_ARGS + ["--max-rows", "2"]),
    "sheet-refused-max-bytes": sheet(LEAD_ARGS + ["--max-bytes", "100"], destination=utf8("lead_id,phone,hs_email\n")),
    "sheet-refused-changed": sheet(LEAD_ARGS, responses={"drive": [drive(57), drive(58, "2026-11-01T09:00:05.000Z")],
                                                         "values": [values(SHEET_RETURNED, LEADS)]}),
    "sheet-refused-revision-uneven": sheet(LEAD_ARGS, responses={"drive": [drive(57), drive(None)],
                                                                 "values": [values(SHEET_RETURNED, LEADS)]}),
}


def _sheet_environ(spec, endpoint):
    """The sheet variables for one case: the fake's endpoint and a fake credential, then the case's own values."""
    environ = {"FLOWASSERT_SHEETS_TEST_ENDPOINT": endpoint}
    if spec["credential"] in ("token", "both"):
        environ["FLOWASSERT_SHEETS_TOKEN"] = FAKE_TOKEN
    if spec["credential"] in ("key", "both"):
        environ["FLOWASSERT_SHEETS_API_KEY"] = FAKE_KEY
    environ.update(spec["env"])
    return environ


def fake_for(kind, case, responses):
    """The local fake a connector case talks to, serving the case's responses (also used by conformance.py)."""
    credential = ("key", FAKE_KEY) if case["credential"] == "key" else ("token", FAKE_TOKEN)
    return FakeSheetsApi(json.loads(json.dumps(responses)), credential=credential)


def environ_for(kind, case, endpoint):
    """The environment variables of a connector case: the fake's endpoint and a fake credential."""
    return _sheet_environ(case, endpoint)


def requests_of(kind, api):
    """What the checker asked the fake for, as requests.json records it: any API key replaced by its variable's name."""
    return [[r["method"], r["path"], [[k, "FLOWASSERT_SHEETS_API_KEY" if k == "key" else v] for k, v in r["query"]]]
            for r in api.requests]


def run_sheet_case(spec, folder):
    """Run one sheet case in `folder` against the local fake: (exit status, stdout, stderr, requests)."""
    stdout, stderr = io.StringIO(), io.StringIO()
    saved_env = {name: os.environ.pop(name) for name in SHEET_VARIABLES if name in os.environ}
    cwd = os.getcwd()
    with fake_for("sheets", spec, spec["responses"]) as api:
        os.environ.update(environ_for("sheets", spec, api.endpoint))
        os.chdir(folder)
        saved = cli.datetime, sheets.datetime
        cli.datetime = sheets.datetime = _FixedDatetime
        try:
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                code = cli.main(spec["args"] + ["--json", "report.json", "--html", "report.html"])
        finally:
            cli.datetime, sheets.datetime = saved
            os.chdir(cwd)
            for name in SHEET_VARIABLES:
                os.environ.pop(name, None)
            os.environ.update(saved_env)
    return code, stdout.getvalue(), stderr.getvalue(), requests_of("sheets", api)


def write_sheet_case(folder, name, spec):
    """Write one sheet case's inputs, the fake's responses, and the checker's outputs and requests into `folder`."""
    folder.mkdir(parents=True)
    for file, data in spec["files"].items():
        (folder / file).write_bytes(data)
    case = {"name": name, "args": spec["args"], "credential": spec["credential"], "env": spec["env"]}
    (folder / "case.json").write_text(json.dumps(case, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (folder / "sheet-responses.json").write_text(json.dumps(spec["responses"], indent=2, ensure_ascii=False) + "\n",
                                                 encoding="utf-8")
    with tempfile.TemporaryDirectory() as tmp:
        for file, data in spec["files"].items():
            Path(tmp, file).write_bytes(data)
        code, stdout, stderr, requests = run_sheet_case(spec, tmp)
        for report in ("report.json", "report.html"):
            if Path(tmp, report).exists():
                shutil.copyfile(Path(tmp, report), folder / report)
    (folder / "exit_status.txt").write_text(f"{code}\n", encoding="utf-8")
    (folder / "stdout.txt").write_bytes(stdout.encode("utf-8"))
    (folder / "stderr.txt").write_bytes(stderr.encode("utf-8"))
    (folder / "requests.json").write_text(json.dumps(requests, indent=2) + "\n", encoding="utf-8")


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


def write_all(target, sheets_target=None):
    for name, spec in CASES.items():
        write_case(target / name, name, spec)
    if sheets_target is not None:
        for name, spec in SHEET_CASES.items():
            write_sheet_case(sheets_target / name, name, spec)


def differences(expected_root, actual_root):
    """Paths, relative to the roots, that are missing, extra or different."""
    def tree(root):
        return {p.relative_to(root).as_posix(): p for p in root.rglob("*") if p.is_file()} if root.exists() else {}
    expected, actual = tree(expected_root), tree(actual_root)
    return sorted(name for name in expected.keys() | actual.keys()
                  if name not in expected or name not in actual or expected[name].read_bytes() != actual[name].read_bytes())


def check():
    """The paths under offline/golden/ and offline/golden-sheets/ that differ from what write_all writes now."""
    with tempfile.TemporaryDirectory() as tmp:
        write_all(Path(tmp, "golden"), Path(tmp, "golden-sheets"))
        return ([f"offline/golden/{n}" for n in differences(Path(tmp, "golden"), GOLDEN)]
                + [f"offline/golden-sheets/{n}" for n in differences(Path(tmp, "golden-sheets"), GOLDEN_SHEETS)])


def main(argv):
    if argv == ["--check"]:
        diff = check()
        for name in diff:
            print(f"{name} is not current", file=sys.stderr)
        if diff:
            print("run python3 offline/bench/golden.py to write it again", file=sys.stderr)
        return 1 if diff else 0
    if argv:
        print(__doc__, file=sys.stderr)
        return 2
    for folder in (GOLDEN, GOLDEN_SHEETS):
        if folder.exists():
            shutil.rmtree(folder)
    write_all(GOLDEN, GOLDEN_SHEETS)
    print(f"wrote {len(CASES)} cases to {GOLDEN} and {len(SHEET_CASES)} to {GOLDEN_SHEETS}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
