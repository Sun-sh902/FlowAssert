# n8n-nodes-flowassert

An [n8n](https://n8n.io) community node that checks whether expected records reached a destination: it compares a
source file with a destination file, CSV or one worksheet of an Excel workbook, record by record, and never calls a
result Verified without enough evidence. It is [FlowAssert](https://github.com/Sun-sh902/FlowAssert)'s checker, the
same one its command line and browser run, built into the node.

The node makes no network request, reads no file and no environment variable, and needs no credential. It has no
runtime dependency. It is not verified by n8n and is not listed in n8n's catalogue, so it needs a self-hosted n8n:
unverified community nodes are not available on n8n Cloud. On n8n Cloud, use the Code-node workflow in
[examples/n8n](https://github.com/Sun-sh902/FlowAssert/tree/main/examples/n8n), which runs the same checker.

## Install

In a self-hosted n8n: Settings, Community Nodes, Install, and enter `n8n-nodes-flowassert`. See n8n's guide to
[installing community nodes](https://docs.n8n.io/integrations/community-nodes/installation/).

## Use

Each input item is one check. It carries the two files as binary properties, by default `source` and `destination`:
for example two "Read/Write Files from Disk" nodes, or two downloads, joined by a Merge node set to combine by
position. Items from other nodes become a file with n8n's "Convert to File" node: the node checks files, whose bytes
its report records, never values whose text depends on the node that made them.

| Parameter | What it is |
| --- | --- |
| Source and Destination Binary Property, Format, Worksheet, Encoding | Where each file is, and how to read it: CSV in UTF-8, UTF-16 or GB18030, or one worksheet of an .xlsx workbook, read as stored, not as displayed |
| Source Key Column, Destination Key Column | The column that identifies a record on each side |
| Fields | The fields to compare, each with a rule: exact, trim, case-insensitive, digits only, or a date with a format |
| Scope | Source records, or exact: also report destination records whose key is not in the source |
| Premise: … | What you state about the files: that the source is the whole batch, that the destination covers the whole object, the totals you saw, that two identical files come from different systems |
| Output Records to Resend | Whether the rows that need action are output as items (on by default) |
| Options | Leave values out of the reports, the byte and row limits, and how much the JSON report says about Verified records |

**Every premise is unstated by default.** A premise is your statement. FlowAssert cannot check it, and a wrong
statement gives a wrong result: the report records each one, with its origin, `n8n node`.

## Outputs

| Output | Items |
| --- | --- |
| Result | One per input item: `state` (`Verified`, `Mismatch`, `Unverified`, `refused` or `failed`), `exit`, `summary`, `message`, `claim`, `counts`, `report` (the JSON report), and `exports` (each file of records to resend, its rows and meaning). Binary: `report_json`, `report_html`, and one `export_…` per file of records to resend |
| Missing From Destination | One item per row the destination, stated complete, lacks |
| Values Differ | One per row whose compared values differ |
| Duplicated in Destination | One per row whose key the destination holds more than once |
| Unknown Status (Resending May Duplicate) | One per row the check could not conclude on: it may already be in the destination, so resending it may create a duplicate |
| Only in Destination | Scope exact, source population known: one per destination row whose key is not in the source |
| Only in Destination (Not Concluded) | Scope exact, source population unknown: the same, without a conclusion |

A row item holds the row as it was read, every column of its file, so a following node can act on it. The records to
resend are advice from the check, not a further conclusion: rows whose status is unknown are never on the same output
as rows the check showed missing, and a destination that was not stated complete never gives missing rows. A refusal is
a Result item, not an error; the node fails an item only when it has no such binary property, or for an internal
failure, and with "Continue On Fail" that is an item too.

## What it does not do

- It does not read Google Sheets or HubSpot itself: n8n's own nodes do, and their output, converted to a file, is what it
  checks. FlowAssert's command line and GitHub Action read both directly.
- It does not decide what to resend. Its outputs are advice; a following node acts on them only when you build it so.

## Development

This package lives in FlowAssert's repository. The checker is copied from `ui/dist-lib/flowassert-check.js` at each
build, so build that first.

```sh
(cd ../../ui && npm ci && npm run build:lib)
npm ci
npm run build                                   # n8n-node build
npm run lint                                    # n8n-node lint: n8n's rules for community nodes
npm test                                        # unit tests, on the build
node test/n8n-run.mjs --n8n "npx --yes n8n@2.47.5"   # every golden case the node can express, in a real n8n
```

The design is in
[docs/design/1.1-n8n-node.md](https://github.com/Sun-sh902/FlowAssert/blob/main/docs/design/1.1-n8n-node.md).

## Licence

MIT, for this package and the copy of the checker it holds. The rest of FlowAssert is licensed under Apache-2.0.
