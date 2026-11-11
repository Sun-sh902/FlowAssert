# Live check of the HubSpot Contacts destination (for the owner; not run)

English | [简体中文](hubspot_live_check.zh-CN.md)

> [!IMPORTANT]
> **Before anything else:** read HubSpot's Terms of Service, its developer terms and the terms of any free account
> before any account is created, and check who may hold such an account and whether a person may open one for
> testing: if you are not eligible, stop here. No token is ever pasted into a chat, an issue, a commit or a file in this repository. Use synthetic data
> only.

This plan was written with FlowAssert 1.0.0 and has **not** been run. It confirms or contradicts the statements marked
**[unconfirmed]** in the [design note](../../docs/connectors/hubspot.md), and shows that the read behaves on the real
API as it does against the local fake. Record what each step printed in a private note, not in the repository;
afterwards, write the conclusions (not the outputs that name the account) into the design note and the changelog.

## What you need

- A HubSpot account used only for testing, with no real data: a free developer test account, if the terms allow you
  one, or a free CRM account opened only for this.
- In that account, a **private app** with one scope only: `crm.objects.contacts.read`. No other scope, and none of the
  sensitive-data scopes. Copy its access token once, into a password manager.
- FlowAssert at the commit under review, installed in a fresh venv: `python3 -m pip install ./offline`.

## The synthetic contacts

1. A new account may hold sample contacts that HubSpot creates by itself. Delete every contact first, so the account
   holds only what you create here (steps 4 and 5 state that the export covers the whole object).
2. Create three contacts by hand, with these values and nothing else:

   | Email | Phone number |
   | --- | --- |
   | `flowassert-c001@example.com` | `+1 555 0100 001` |
   | `flowassert-c002@example.com` | `+1 555 0100 002` |
   | `flowassert-c003@example.com` | `+1 555 0100 003` |

   If HubSpot refuses these addresses, use any address on a domain you control and change the source file to match.
3. Write the source file `contacts.csv` on your computer:

   ```text
   email,phone
   flowassert-c001@example.com,+1 555 0100 001
   flowassert-c002@example.com,+1 555 0100 002
   flowassert-c003@example.com,+1 555 0100 003
   ```

## The token

Put the token in the environment of one shell only, without echoing it or saving it in the shell's history:

```sh
read -rs FLOWASSERT_HUBSPOT_TOKEN && export FLOWASSERT_HUBSPOT_TOKEN
```

## The checks

Each command, what it should print, and what it confirms. `N` and the times vary.

1. **A Verified read.**

   ```sh
   flowassert-verify --source contacts.csv --destination-hubspot contacts --key email --field phone \
     --source-complete --destination-complete --json r1.json --html r1.html
   echo $?
   ```

   Expected: `Verified: 3 rows of 3`, `Verified 3 · Mismatch 0 · Unverified 0`, then
   `Destination read by FlowAssert from HubSpot: contacts, 3 records in 1 pages, …; archived records were not read.`
   and `This lists what the token could see at that time; it does not show that the object is complete.`; exit 0.
   In `r1.json`: `schema_version` 3, and `inputs.destination_hubspot` with no token, portal ID or account name.
   Confirms: the host, the path, `archived=false`, and that `properties` is accepted as one comma-separated parameter.
   Search both reports for the token's first eight characters: they must not be there.

2. **The same read again.** Run step 1 again with `r2.json`. Expected: the same summary, and in both reports the same
   `inputs.destination_sha256`. Confirms that, with nothing changed, the list comes back in the same order.

3. **A Mismatch.** In HubSpot, change the phone number of `flowassert-c002@example.com` to `+1 555 0100 092`, then run
   step 1 with `r3.json`. Expected: `Mismatch: 3 rows of 3`, and `field:phone fail: exact string comparison
   ('+1 555 0100 002' vs '+1 555 0100 092')`; exit 1. Change it back afterwards.

4. **A property the object does not have.** Run step 1 with `--field phone:flowassert_no_such_property`. Expected:
   `refused: HubSpot contacts: page 1 has a record without the property 'flowassert_no_such_property'; HubSpot leaves
   out a property the object does not have`; exit 2. Confirms that HubSpot leaves out a property that is not defined.

5. **More than one page.** Import a CSV file of 120 more synthetic contacts (`flowassert-m001@example.com` to
   `flowassert-m120@example.com`, no other value) with HubSpot's import tool. Then run, with a source file holding the
   123 addresses:

   ```sh
   flowassert-verify --source all.csv --destination-hubspot contacts --key email --field email \
     --source-complete --destination-complete --json r5.json
   ```

   Expected: `… 123 records in 2 pages …`; exit 0. Confirms the paging cursor: had it held any character but letters,
   digits, `-` and `_`, the read would have been refused with `gives a paging cursor that FlowAssert cannot send back
   unchanged`. Run it once more with `--max-rows 100`: expected `refused: HubSpot contacts: exceeds --max-rows limit
   of 100`.

6. **A token that is no longer valid.** Rotate the private app's token in HubSpot, keep the old one in the shell, and
   run step 1. Expected: `refused: HubSpot contacts: the credential was not accepted (HTTP 401 …)`; exit 2. Write down
   the `category` shown after 401. Confirms the status and category of an invalid token.

7. **A missing scope** (optional). Create a second private app with a scope other than contacts (for example
   `crm.objects.companies.read` only), put its token in the shell, and run step 1. Expected: `refused: HubSpot
   contacts: access was denied (HTTP 403 …)`. Write down the category. Delete that app afterwards.

Do not try to reach the rate limit on purpose.

## Revoking the token

When the checks are done, in this order:

1. In HubSpot, delete the private app (or apps): deleting an app revokes its token.
2. `unset FLOWASSERT_HUBSPOT_TOKEN`, and close the shell.
3. Delete the synthetic contacts, then the test account if it is no longer needed.
4. Delete `r*.json`, `r*.html` and the source files: they hold the synthetic addresses.

## What the run confirms in the design note

| Statement marked **[unconfirmed]** | Step |
| --- | --- |
| `properties` is accepted as one comma-separated parameter | 1 |
| The list is in a stable order when nothing changes | 2 |
| A paging cursor is letters, digits, `-` and `_` | 5 |
| The status and `category` of an invalid token, and of a missing scope | 6, 7 |
| `archived` is present and `false` in a list read with `archived=false` | 1 (a record with `archived` true, or of another type, would have been refused) |
| Which contacts a private app token cannot see | Not settled by this run: the account has no restricted contacts |
| What the list does when a contact changes during the read | Not settled by this run |

Statements this run cannot confirm stay marked **[unconfirmed]**.
