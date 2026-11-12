# HubSpot Contacts destination: design note

Status: FlowAssert 1.0.0, command line only. Written before the code, and kept in step with it: the code, the golden
cases in `offline/golden-hubspot/` and `scripts/dev/tests/test_hubspot_destination.py` now follow it. Nothing here has been
tried against HubSpot: no account was created and no request was sent to HubSpot with a credential. Every statement
about HubSpot's behaviour comes from HubSpot's public documentation and is marked **[doc]**, with the page in
[Sources](#sources); a statement the documentation does not settle is marked **[unconfirmed]** and must be confirmed
by the owner's live check ([scripts/dev/hubspot_live_check.md](../../scripts/dev/hubspot_live_check.md)). Statements
about what FlowAssert does are about its own code and tests, which run against a local fake of the endpoint.

- [What the read shows, and what it does not](#what-the-read-shows-and-what-it-does-not)
- [Options and environment variables](#options-and-environment-variables)
- [The requests](#the-requests)
- [From pages to rows](#from-pages-to-rows)
- [The canonical form](#the-canonical-form)
- [Identical content](#identical-content)
- [Refusals](#refusals)
- [The report](#the-report)
- [Sources](#sources)

## What the read shows, and what it does not

With `--destination-hubspot contacts`, the destination rows are not a CSV file the person exported: FlowAssert lists
the contacts itself, page after page, through HubSpot's CRM API, read-only.

It shows: which contacts the API listed to this token, with which values of the properties asked for, between the
time of the first request and the time of the last; and that no export step could have filtered, cut short or edited
them on the way.

It does **not** show that the object is complete:

- **Records the token cannot see are not listed.** What a token may read depends on its scopes and on the account's
  settings **[unconfirmed]**; FlowAssert cannot see what was left out.
- **Records changed during the read may be missed.** The list is read in pages over time. A contact created, merged,
  archived or restored while the pages are read can be absent from every page, and FlowAssert has no revision to tie
  the read to. It refuses a read in which the same record ID appears twice, which is the one such change it can see.
- **Archived records are excluded.** The read asks for `archived=false`. A contact that was deleted is not listed, and
  a check never says that it was.

So `--destination-complete` stays the person's statement, with exactly its existing meaning and effect: the rows
supplied cover the whole object. Without it, a missing record and a duplicate stay unknown. With it, the statement is
recorded as a premise FlowAssert does not verify. Reading every page does not make the statement for the person, and
no wording in the summary or the reports suggests that it does.

It also does not show that the values are true, that a workflow made any write, or that a record existed by a past
deadline. A HubSpot destination is never "more Verified" than the same rows in a CSV file: the same rows give the same
records, rule results, counts and cohort state, and tests hold the two paths to that.

## Options and environment variables

| Option | Meaning |
| --- | --- |
| `--destination-hubspot OBJECT` | Read the destination from HubSpot, in place of `--destination FILE`. `OBJECT` must be `contacts` |
| `--destination-timeout SECONDS` | The longest each request may take, from connecting to the last byte of the response (default 60) |

With `--destination-hubspot`, the destination side of `--key` and of each `--field` (and of a mapping or a
configuration file) is a HubSpot property's internal name, such as `email` or `hs_object_id`: `--key
external_id:hs_object_id --field email`. A name must be letters, digits and `_` only, at most 100 characters, so that
it cannot change the request. `hs_object_id`, the record ID, is allowed as the key.

`--destination-hubspot` and `--destination` cannot be combined. `--destination-timeout` needs `--destination-hubspot`.
`--destination-encoding` does not apply and is refused with it. It can be combined with `--source-sheet`. Everything
else works as for a file: `--max-rows` (the records listed), `--max-bytes` (the size of each response body), `--scope`,
the premises and counts, `--details`, `--max-details`, `--redact-values`, `--json` and `--html`.

The credential is taken only from the environment, never from an argument or a file:

| Variable | Holds |
| --- | --- |
| `FLOWASSERT_HUBSPOT_TOKEN` | A private app access token, sent as `Authorization: Bearer TOKEN` **[doc]** |
| `FLOWASSERT_HUBSPOT_TEST_ENDPOINT` | For tests only: `http://127.0.0.1:PORT` or `http://[::1]:PORT`. Every request goes there instead of to HubSpot. Any other value is refused |

The token must be printable ASCII without spaces, at most 4,096 characters; anything else is refused without showing
it. FlowAssert never prints, logs, stores or writes the token: not in the summary, a report, a refusal or an error.

The private app should be given one scope only: `crm.objects.contacts.read`, "View properties and other details about
contacts" **[doc]**. FlowAssert cannot see which scopes a token carries; a wider token would still only be used for the
`GET` requests below. The properties `crm.objects.contacts.sensitive.read` and `…highly_sensitive.read` unlock are not
needed and should not be granted.

## The requests

FlowAssert sends HTTPS `GET` requests to one endpoint, one after another, and nothing else:

```text
GET https://api.hubapi.com/crm/v3/objects/contacts?limit=100&archived=false&properties=NAME,NAME,...
GET https://api.hubapi.com/crm/v3/objects/contacts?limit=100&archived=false&properties=NAME,NAME,...&after=CURSOR
```

- **The endpoint** is "Retrieve contacts", `GET /crm/v3/objects/contacts` on `https://api.hubapi.com` **[doc]**.
- **`limit=100`**: "You can retrieve up to 100 contacts in one request" **[doc]**.
- **`archived=false`**: the parameter is "Whether to return only results that have been archived", default `false`
  **[doc]**. It is sent explicitly, so the request says what was asked.
- **`properties`**: "A comma separated list of the properties to be returned in the response" **[doc]**: the
  destination key and the destination fields, each once, in that order. The API's machine-readable description gives
  the parameter as an array that may also be sent as repeated parameters; FlowAssert sends the comma-separated form
  the text documents, and the live check confirms it **[unconfirmed]**.
- **`after`**: "The paging cursor token of the last successfully read resource will be returned as the
  `paging.next.after` JSON property of a paged response containing more results" **[doc]**. FlowAssert sends it back
  unchanged.

Each request also sends `Accept: application/json`, `Accept-Encoding: identity` and
`User-Agent: flowassert-verify/VERSION`.

How they are sent, as for the Google Sheets source:

- With `http.client` from the standard library, one new connection per request, to port 443 of `api.hubapi.com`
  only. No proxy is used, even when `HTTPS_PROXY` is set.
- TLS uses `ssl.create_default_context()`: the certificate and the host name are verified, with no option to turn that
  off.
- A redirect is never followed: any 3xx response is a refusal.
- There is no retry. A rate limit, a server error or a timeout is a refusal, and the person runs the check again.
- A response body larger than `--max-bytes` is refused as soon as it is larger.

A private app is limited to 100 requests every 10 seconds on a free account, and 250,000 a day for the account
**[doc]**. FlowAssert sends its requests one at a time and does not pace them; a read of 1,000,000 contacts is 10,000
requests. When a limit is reached the API answers 429 **[doc]**, which is a refusal.

## From pages to rows

A page is a JSON object with `results`, a list of records, and, when there are more, `paging.next.after`; `paging` is
"omitted or empty on the last page" **[doc]**. A record has `id` (a string), `properties` (a map of property names to
strings), `archived`, `createdAt` and `updatedAt` **[doc]**.

| In the response | Becomes |
| --- | --- |
| A record | One destination row, in the order listed |
| A property with a string value | That value, exactly |
| A property that is `null` | An empty value. "If a requested property is defined but a contact doesn't have a value, it will be returned as `null`" **[doc]**. Empty is `unknown` under every rule, as in a CSV file |
| A requested property that a record does not have | Refused. "If a requested property isn't defined, it won't be included in the response" **[doc]**: the name is not a property of the object, as a CSV file without that column is refused |
| A property value that is not a string or `null` | Refused |
| A record without `id` or `properties`, or with `archived` true | Refused: the page is not the shape asked for |
| A record ID that an earlier page, or this page, already listed | Refused: the list changed while it was read |
| More than 100 records in a page | Refused |
| `paging.next.after` present | The next request sends it as `after`. It must be letters, digits, `-` and `_`, at most 512 characters, so it can be sent back exactly; the guide says it is a record ID **[doc]**. Any other cursor is refused |
| A cursor that an earlier page already gave | Refused: the pages would repeat |
| A page with a next cursor and no records | Refused |
| No `paging`, an empty `paging`, or no `next` | The last page |

The header of the rows is the list of requested properties. `--max-rows N` refuses a read as soon as it has listed
more than `N` records; no further page is requested.

Rows are handed to the evaluator page by page and are not kept: the destination is indexed row by row, as a file is.

## The canonical form

The rows read are written, as they are read, as a CSV text, and `inputs.destination_sha256` is the SHA-256 of its
bytes. The form, named `flowassert-hubspot-csv-1`, is:

- UTF-8 without a byte order mark;
- a header row with the requested property names, in the order requested, then one row per record in the order listed,
  each ending with a line feed (`\n`, also after the last row);
- cells separated by `,`, a `null` property written as an empty cell;
- a cell in double quotes, with each `"` inside written twice, when it contains `,`, `"`, a carriage return or a line
  feed, or when it is the only cell of its row and is empty; every other cell as it is.

This is a CSV file that `flowassert-verify --destination` reads as exactly the same rows. A person can rebuild the
digest from the values, and the tests use this form to prove that HubSpot and a file with the same rows give the same
result. It is not the bytes of a file exported from HubSpot.

## Identical content

Identical-content detection is kept: when the digest of the canonical form equals the digest of the source, the check
is refused unless `--allow-identical-content` is passed. It catches only a source file that holds exactly the
canonical form. It does not catch a source that was itself exported from the same HubSpot account in another form;
the independence of the source remains the person's responsibility.

## Refusals

Every refusal prints `refused: MESSAGE` to standard error, exits with status 2, writes no report and concludes
nothing. No message contains the token. `WHAT` is `HubSpot contacts`. `STATUS` is the `category` of a HubSpot error
response, or the `errorType` of a rate-limit response, written as ` MISSING_SCOPES` when present and only when it is
upper-case letters and `_`. The error's `message` is never repeated, because FlowAssert cannot know what it contains.

| Message | When |
| --- | --- |
| `--destination and --destination-hubspot cannot be combined` | Both were given |
| `--destination-hubspot must be contacts` | Any other object |
| `--destination-timeout needs --destination-hubspot` | The option without the connector |
| `--destination-encoding does not apply to a HubSpot destination` | Both given |
| `HubSpot property name 'NAME' must be letters, digits and _, at most 100 characters` | A destination key or field that is not such a name |
| `no credential: set FLOWASSERT_HUBSPOT_TOKEN to a private app access token with the scope crm.objects.contacts.read only` | The variable is not set |
| `FLOWASSERT_HUBSPOT_TOKEN does not hold a credential: printable ASCII without spaces, at most 4096 characters` | Empty, too long, or another character |
| `FLOWASSERT_HUBSPOT_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only` | Any other value |
| `WHAT: the request was not accepted (HTTP 400STATUS)` | 400 |
| `WHAT: the credential was not accepted (HTTP 401STATUS); it may have expired or been rotated` | 401 |
| `WHAT: access was denied (HTTP 403STATUS); the token may lack the scope crm.objects.contacts.read` | 403 |
| `WHAT: not found (HTTP 404STATUS)` | 404 |
| `WHAT: rate limited (HTTP 429STATUS); FlowAssert does not retry: wait, then run the check again` | 429 |
| `WHAT: server error (HTTP NSTATUS); FlowAssert does not retry: run the check again later` | 500 to 599 |
| `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects` | 300 to 399 |
| `WHAT: unexpected response (HTTP NSTATUS)` | Any other status but 200 |
| `WHAT: no complete response within N seconds; FlowAssert does not retry` | `--destination-timeout` passed |
| `WHAT: the server's TLS certificate could not be verified` | Certificate or host name check failed |
| `WHAT: the connection failed` | Name lookup, connection or TLS failure of another kind |
| `WHAT: response exceeds --max-bytes limit of N` | Body larger than `--max-bytes` |
| `WHAT: the response is not the JSON the API documents (DETAIL)` | Not UTF-8 JSON, a duplicate member, a compressed body, or a member missing or of the wrong type; `DETAIL` says which |
| `WHAT: page P has more than 100 records` | A page longer than the limit asked for |
| `WHAT: page P lists an archived record, and the read asked for none` | `archived` is true |
| `WHAT: page P has a record without the property 'NAME'; HubSpot leaves out a property the object does not have` | A requested property is absent from a record |
| `WHAT: page P has a property value that is not text` | A number, `true`, a list or an object as a value |
| `WHAT: record ID appears twice (pages P and Q): the list changed while it was read; run the check again` | A repeated record ID |
| `WHAT: page P gives a paging cursor that FlowAssert cannot send back unchanged` | A cursor with other characters, or longer than 512 |
| `WHAT: page P repeats an earlier paging cursor` | The same cursor twice |
| `WHAT: page P has a next page and no records` | An empty page that is not the last |
| `WHAT: exceeds --max-rows limit of N` | More than `N` records listed |

## The report

A report whose destination was read from HubSpot has `schema_version` **3**. Every report without it is unchanged,
byte for byte, and keeps its version (1, or 2 for a Google Sheets source). Version 3 is used because existing members
change meaning: `inputs.destination_sha256` is the digest of the canonical form, not of a file's bytes;
`premises.destination_count.observed` counts the records listed; and `premises.destination_complete` states that the
records listed cover the whole object. A reader that knows only versions 1 and 2 refuses a version 3 report, which is
intended.

Version 3 has every member of version 1, with these differences:

| Member | In version 3 |
| --- | --- |
| `inputs.destination_sha256` | SHA-256 of the canonical form |
| `inputs.destination_encoding` | Never present. `inputs.source_encoding` is present alone when `--source-encoding` was passed |
| `inputs.destination_hubspot` | New, always present (below) |
| `inputs.source_sheet` | Present when the source was read from Google Sheets, with the meaning it has in version 2 |

`inputs.destination_hubspot`:

| Member | Value |
| --- | --- |
| `read_by` | `FlowAssert`: the rows were read by FlowAssert, not exported by the person. This is not a statement about completeness |
| `service` | `HubSpot CRM API v3` |
| `object` | `contacts` |
| `properties` | The property names requested, in order |
| `archived_excluded` | `true`: the read asked for `archived=false` |
| `page_limit` | `100` |
| `pages` | The number of pages read |
| `rows` | The number of records listed |
| `read_at` | When the first request was sent, UTC ISO 8601 |
| `read_finished_at` | When the last response had arrived, UTC ISO 8601 |
| `canonical_form` | `flowassert-hubspot-csv-1` |

It never records the token, the portal (account) ID, the account's name or a record's URL. `--redact-values` leaves
the object and the property names in place: they are not values.

The printed summary adds two lines after the counts (after the Google Sheets lines, when both are used):

```text
Destination read by FlowAssert from HubSpot: contacts, N records in P pages, from READ_AT to READ_FINISHED_AT; archived records were not read.
This lists what the token could see at that time; it does not show that the object is complete.
```

A stated count that differs says `HubSpot listed N records` in place of `file has N rows`. The HTML report adds a
section, "Destination read from HubSpot", with the same members and the three things the read does not show.

`claim`, `limitations`, `acquisition_authenticity` (`not_authenticated`) and every conclusion are the same as for a
file.

The browser opens, explains and compares version 3 reports: a saved report's page says that FlowAssert listed the
records from HubSpot's contacts, read-only, and that this does not show that the object is complete; "What this result
means" has one more point saying the same; and two reports whose destinations are a file and HubSpot are not compared.
The browser never sends a request to HubSpot.

## Sources

Read on 2026-11-09, as the Markdown copies HubSpot's developer site serves for each page.

| Source | Used for |
| --- | --- |
| "Retrieve contacts", <https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/get-contacts.md> (with the OpenAPI description of `GET /crm/v3/objects/contacts`) | The host, the path, the parameters `after`, `archived`, `limit`, `properties` and their descriptions; the response shape (`results`, `paging.next.after`, the record's members); the error shape (`category`, `message`, `correlationId`) |
| "CRM API: Contacts" guide, <https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide.md> | Up to 100 contacts in one request; `after` is the record ID of the next contact; a property that is not defined is left out, and one without a value is `null`; the example response |
| "Legacy private apps", <https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview.md> | The access token and `Authorization: Bearer`; rotating a token; deleting an app revokes its token |
| "Scopes", <https://developers.hubspot.com/docs/apps/legacy-apps/authentication/scopes.md> | `crm.objects.contacts.read` and its description; the sensitive-data scopes |
| "API usage guidelines and limits", <https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines.md> | The limits for privately distributed apps; the 429 response and its members `errorType` and `policyName` |

HubSpot's site lists the v3 endpoints under "Legacy" beside date-versioned releases of the same API (2026-03,
2026-09). FlowAssert uses the v3 path named above. Whether and when v3 will be withdrawn is not stated on the pages
read **[unconfirmed]**.

What the pages read do not settle, which the live check confirms or contradicts:

- that a paging cursor is always letters, digits, `-` and `_`;
- that `properties` is accepted as one comma-separated parameter;
- that the list is in a stable order, and what it does when a contact changes during the read;
- the status and `category` of each error (an invalid token, a missing scope);
- which contacts a private app token cannot see;
- that `archived` is always present and `false` in a list read with `archived=false`.
