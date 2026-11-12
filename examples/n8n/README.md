# FlowAssert in n8n

`flowassert-check.workflow.json` runs the FlowAssert CSV check inside an n8n workflow, with no Execute Command node
(it is disabled by default from n8n 2.0, and n8n Cloud does not offer it). The check runs in a **Code node** that
holds the packaged JavaScript checker of this FlowAssert version. It gives the same result, summary and JSON report as
`flowassert-verify` for the same files and premises; only each premise's `origin` differs (`n8n Code node`).

```text
Run the check ─┬─ Read source CSV ──────┬─ Both files ── FlowAssert check ── Verified?
               └─ Read destination CSV ─┘   (Merge)        (Code node)       (If: true / false)
```

**Tested with n8n 2.46.4, self-hosted** (installed with npm on macOS, task runners in their default internal mode).
It has **not** been tested on n8n Cloud.

**The files' content stays in your n8n instance.** The Code node makes no request and runs no command. n8n itself
keeps each execution's data, including this node's output (the summary and the JSON report, with keys and compared
values), in its own database, as it does for every node.

## Run it with the sample files

1. Copy `offline/examples/source.csv` and `offline/examples/destination.csv` from this repository into a folder
   `flowassert` in the folder n8n's Read/Write Files node may read. By default that is `~/.n8n-files` of the user
   running n8n; in the official Docker image, `/home/node/.n8n-files/flowassert/`, the path the workflow uses. If
   your files are elsewhere, change the path in both Read nodes, and allow the folder with
   `N8N_RESTRICT_FILE_ACCESS_TO`. n8n refuses a path that goes through a symbolic link.
2. Import the workflow: in the editor, **Import from File…**, or `n8n import:workflow --input=flowassert-check.workflow.json`.
3. Run it. With the sample files and no premise stated, the result is `Mismatch`: a phone number differs and a key
   appears twice, which needs no premise, while the other records stay unknown.

## Configure it

Open the **FlowAssert check** node. Its code starts with a configuration block; change nothing below it.

| Setting | Meaning |
| --- | --- |
| `SOURCE`, `DESTINATION` | The binary field each Read node writes (`source`, `destination`), the name a refusal uses, and the encoding: `utf-8` (with or without a byte order mark), `utf-16` (with a byte order mark) or `gb18030` |
| `CONFIG` | The key and the fields with a rule each (`exact`, `trim`, `casefold`, `digits`, `date:FORMAT`), and the scope (`source` or `exact`), as in a `--config` file. See [offline/README.md](../../offline/README.md#comparison-rules) |

The premises are what you state about the files of each run. **FlowAssert cannot check any of them, and a wrong
statement gives a wrong result.** Each starts as `false` or `null`; set one only when you know it is true.

| Premise | You state that | While it is not stated |
| --- | --- | --- |
| `SOURCE_COMPLETE = true` | The source file is the whole batch | The batch can never be Verified |
| `DESTINATION_COMPLETE = true` | The destination export covers the whole destination object | A missing record or a duplicate stays unknown |
| `SOURCE_COUNT = "120"` | The source system showed 120 records. A different row count blocks Verified | Nothing is cross-checked |
| `DESTINATION_COUNT = "118"` | The destination system showed 118 records. A different row count leaves absence and duplicates unknown | Nothing is cross-checked |
| `ALLOW_IDENTICAL_CONTENT = true` | Two files with identical content really come from different systems | Identical files are refused |

A matching count does not replace a completeness statement; it only catches some wrong ones.

## What the Code node returns

One item with `state` (`Verified`, `Mismatch`, `Unverified`, `refused` or `failed`), `exit` (as `flowassert-verify`
exits: 0, 1, 3, 2, 4), `counts`, `summary` (what `flowassert-verify` prints), `message` (its refusal or failure),
`flowassertVersion`, and `reportJson`, the JSON report as text, byte for byte ([format](../../docs/report-format.md)),
or `null` when the check was refused or failed. It returns no value that the report does not hold itself.

The **Verified?** node sends the item to its *true* output only when `state` is `Verified`. Everything else, an
Unverified batch, a refusal or a failure included, goes to *false*. Connect the next steps of your workflow to the
output you need. If a file is missing from the input, the Code node fails rather than returning a result.

## Repeat the check with the command line

The configuration is used as the `--config` file `JSON.stringify(CONFIG, null, 2) + "\n"`. With that file saved as
`config.json`, this gives the same summary and report, apart from `origin` and `evaluated_at`:

```sh
flowassert-verify --source source.csv --destination destination.csv --config config.json \
  --source-encoding utf-8 --destination-encoding utf-8   # plus the premises you stated in the Code node
```

## What we found out about the Code node

In n8n 2.46.4, a JavaScript Code node ("Run Once for All Items") runs in a task runner, in a context of its own:

| Feature | Found |
| --- | --- |
| `crypto` | Missing, so `crypto.subtle` too. The checker uses its own SHA-256, tested against `crypto.subtle` on random inputs and every golden file |
| `TextDecoder` | Present, with `utf-8`, `utf-16le`, `utf-16be` and `gb18030`, and fatal decoding rejects invalid bytes |
| `TextEncoder`, `BigInt`, `Buffer` | Present |
| `fetch`, `process` | Missing |
| A file from Read/Write Files | Kept on disk (`filesystem-v2`), not as base64; `this.helpers.getBinaryDataBuffer(index, field)` returns its bytes as a Buffer |
| A Code node of about 95 KB | Saved and run |

The checker tries each feature it needs on known bytes before every check. If one is missing or answers differently,
the check is refused with a message that names it; FlowAssert never decodes, encodes or hashes another way.

With two files of 100,000 rows (5.3 MB each), the Code node took about 0.9 s, and the task runner's memory peaked at
about 400 MB (the n8n process at about 700 MB) on an Apple silicon Mac. The command line took about 0.5 s on the
same files.

## A new FlowAssert version

The Code node holds the checker of one version. To update it, from `ui/` in this repository:

```sh
npm ci && npm run build:lib && node scripts/n8n/build_workflow.mjs
```

and import the new workflow; copy your configuration block across.

HubSpot, n8n and Google Sheets are trademarks of their respective owners. This project is not affiliated with or
endorsed by them.
