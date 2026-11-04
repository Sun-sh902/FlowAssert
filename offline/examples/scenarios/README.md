# Scenarios for a first check

English | [简体中文](README.zh-CN.md)

Four small scenarios, each a pair of synthetic CSV files with the configuration that compares them. Each says which result to expect with which statements, so you can see how the statements change a result before you use your own files. The data is invented: the keys, numbers and `example.test` addresses belong to no one.

The same scenarios are on the CSV check page under **No files at hand? Try a scenario**. Choosing one fills in its files, columns and rules; it states nothing for you.

In these files the statements are true by construction. With your own files, make a statement only when you know it is true: FlowAssert cannot check it, and a wrong statement gives a wrong result.

Run them from the repository root after `python3 -m pip install ./offline` (or with `python3 offline/verify.py` in place of `flowassert-verify`). Each row of the tables below is a golden case, `offline/golden/scenario-*`, run as the page runs it (which also records both encodings); the tests check that the command line and the page give that result.

## Contacts synced to a CRM

A contact list synced to a CRM: one phone number changed, and one contact is missing.

Folder [`contacts-crm/`](contacts-crm/). Key `contact_id` → `external_id`; fields `phone` → `phone_number` (exact), `email` (exact); scope `source`.

| Statements | Result | Why |
| --- | --- | --- |
| With both statements (`--source-complete --destination-complete`) | Mismatch | C-1002 has a different phone number, and C-1003 is not in an export stated to cover the whole object. |
| With no statement | Mismatch | The different phone number of C-1002 is a Mismatch on its own, because the row exists. C-1003 is not found, but without the destination statement that does not show it is missing, so it is Unverified. |

Without statements:

```sh
flowassert-verify \
  --source offline/examples/scenarios/contacts-crm/source.csv \
  --destination offline/examples/scenarios/contacts-crm/destination.csv \
  --config offline/examples/scenarios/contacts-crm/config.json
```

Add the statements of a row of the table at the end of the command to see that row's result.

## Orders compared with trim and casefold

An order export compared with the rules casefold for the email and trim for the status: the files differ only in letter case and spaces.

Folder [`orders-rules/`](orders-rules/). Key `order_id`; fields `customer_email` → `email` (casefold), `status` (trim); scope `source`.

| Statements | Result | Why |
| --- | --- | --- |
| With both statements (`--source-complete --destination-complete`) | Verified | Only letter case and spaces differ, and the two rules ignore them. |
| With no statement | Unverified | No rule fails, but without the statements a record found once is not shown to be the only one with its key, and the batch is not known to be whole. |

Without statements:

```sh
flowassert-verify \
  --source offline/examples/scenarios/orders-rules/source.csv \
  --destination offline/examples/scenarios/orders-rules/destination.csv \
  --config offline/examples/scenarios/orders-rules/config.json
```

Add the statements of a row of the table at the end of the command to see that row's result.

## An extra record in the destination

A price list whose destination holds one record that is not in the source, checked with scope exact.

Folder [`extra-in-destination/`](extra-in-destination/). Key `sku`; fields `price` (exact); scope `exact`.

| Statements | Result | Why |
| --- | --- | --- |
| With both statements (`--source-complete --destination-complete`) | Mismatch | SKU-399 is in the destination and not in a source stated to be the whole batch. |
| With only `--source-complete` | Mismatch | The extra row exists, so the destination statement is not needed for it. Without that statement the four source records are Unverified. |
| With no statement | Unverified | SKU-399 is listed without a conclusion: it could belong to a source record that is not in the file. |

Without statements:

```sh
flowassert-verify \
  --source offline/examples/scenarios/extra-in-destination/source.csv \
  --destination offline/examples/scenarios/extra-in-destination/destination.csv \
  --config offline/examples/scenarios/extra-in-destination/config.json
```

Add the statements of a row of the table at the end of the command to see that row's result.

## A source row with an empty key

A member list in which one source row has no key.

Folder [`empty-key/`](empty-key/). Key `member_id`; fields `email` (exact); scope `source`.

| Statements | Result | Why |
| --- | --- | --- |
| With both statements (`--source-complete --destination-complete`) | Unverified | A row without a key cannot be matched, so the source population is unknown even with the source statement. |
| With no statement | Unverified | The row without a key cannot be matched, and nothing else is established either. |

Without statements:

```sh
flowassert-verify \
  --source offline/examples/scenarios/empty-key/source.csv \
  --destination offline/examples/scenarios/empty-key/destination.csv \
  --config offline/examples/scenarios/empty-key/config.json
```

Add the statements of a row of the table at the end of the command to see that row's result.
