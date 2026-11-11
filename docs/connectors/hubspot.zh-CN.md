# HubSpot 联系人目标：设计说明

[English](hubspot.md) | 简体中文

状态：FlowAssert 1.0.0，只在命令行中提供。这份说明写在代码之前，之后随代码保持一致：代码、`offline/golden-hubspot/` 中的核对样例和 `scripts/dev/tests/test_hubspot_destination.py` 现在都与它一致。这里的内容都没有在 HubSpot 上实际试过：没有创建任何账号，也没有带着凭证向 HubSpot 发送过任何请求。关于 HubSpot 行为的每一条说法都来自 HubSpot 的公开文档，标为 **[文档]**，对应的页面列在[资料来源](#资料来源)中；文档没有说清楚的，标为 **[未确认]**，必须由维护者的实测（[scripts/dev/hubspot_live_check.zh-CN.md](../../scripts/dev/hubspot_live_check.zh-CN.md)）来确认。关于 FlowAssert 自身行为的说法，依据的是它自己的代码和测试，测试针对的是这个接口的本地仿制服务。

- [这次读取能说明什么，不能说明什么](#这次读取能说明什么不能说明什么)
- [选项和环境变量](#选项和环境变量)
- [请求](#请求)
- [从页面到行](#从页面到行)
- [规范形式](#规范形式)
- [内容完全相同](#内容完全相同)
- [拒绝](#拒绝)
- [报告](#报告)
- [资料来源](#资料来源)

## 这次读取能说明什么，不能说明什么

使用 `--destination-hubspot contacts` 时，目标行不是使用者导出的 CSV 文件：FlowAssert 自己通过 HubSpot 的 CRM API 逐页列出联系人，只读。

它能说明：API 在第一次请求到最后一次请求之间，向这个令牌列出了哪些联系人，以及所请求属性的值；并且没有任何导出步骤能在途中筛选、截断或修改它们。

它**不能**说明对象是完整的：

- **令牌看不到的记录不会被列出。** 一个令牌能读取什么，取决于它的权限范围和账号的设置 **[未确认]**；FlowAssert 看不到被漏掉的部分。
- **读取期间变化的记录可能被漏掉。** 列表是在一段时间内逐页读取的。读取期间被创建、合并、归档或恢复的联系人，可能不出现在任何一页里，而 FlowAssert 没有可以绑定这次读取的版本号。同一个记录 ID 出现两次时，它会拒绝这次读取，这是它唯一能看到的一种变化。
- **已归档的记录被排除在外。** 读取时请求 `archived=false`。已删除的联系人不会被列出，核对也从不说它被删除了。

所以 `--destination-complete` 仍然是使用者的声明，含义和作用与原来完全相同：提供的行覆盖了整个对象。没有这个声明，缺失的记录和重复都保持未知。有了它，这项声明会作为 FlowAssert 不核实的前提记录下来。读完每一页并不能替使用者作出这项声明，摘要和报告中也没有任何措辞暗示它能。

它也不能说明这些值是真实的、某个工作流做过写入，或者某条记录在过去的截止时间前已经存在。HubSpot 目标从不比放在 CSV 文件里的同样的行“更已验证”：同样的行得到同样的记录、规则结果、计数和批次状态，测试保证两条路径的结果一致。

## 选项和环境变量

| 选项 | 含义 |
| --- | --- |
| `--destination-hubspot OBJECT` | 从 HubSpot 读取目标，代替 `--destination FILE`。`OBJECT` 必须是 `contacts` |
| `--destination-timeout SECONDS` | 每个请求最长允许多久，从建立连接到响应的最后一个字节（默认 60） |

使用 `--destination-hubspot` 时，`--key` 和每个 `--field` 的目标一侧（以及映射文件或配置文件中的目标一侧）是 HubSpot 属性的内部名称，例如 `email` 或 `hs_object_id`：`--key external_id:hs_object_id --field email`。名称只能包含字母、数字和 `_`，最多 100 个字符，这样它不会改变请求。记录 ID `hs_object_id` 可以用作键。

`--destination-hubspot` 和 `--destination` 不能同时使用。`--destination-timeout` 需要 `--destination-hubspot`。`--destination-encoding` 不适用，同时使用时会被拒绝。它可以和 `--source-sheet` 一起使用。其他一切都与文件相同：`--max-rows`（列出的记录数）、`--max-bytes`（每个响应体的大小）、`--scope`、前提和总数、`--details`、`--max-details`、`--redact-values`、`--json` 和 `--html`。

凭证只从环境变量读取，从不来自参数或文件：

| 变量 | 内容 |
| --- | --- |
| `FLOWASSERT_HUBSPOT_TOKEN` | 私有应用的访问令牌，以 `Authorization: Bearer TOKEN` 发送 **[文档]** |
| `FLOWASSERT_HUBSPOT_TEST_ENDPOINT` | 只用于测试：`http://127.0.0.1:PORT` 或 `http://[::1]:PORT`。所有请求都发到这里，而不是 HubSpot。其他任何值都会被拒绝 |

令牌必须是不含空格的可打印 ASCII 字符，最多 4,096 个；否则会被拒绝，并且不显示它的内容。FlowAssert 从不打印、记录、保存或写出令牌：摘要、报告、拒绝信息和错误信息里都没有。

私有应用应当只被授予一个权限范围：`crm.objects.contacts.read`，即“查看联系人的属性和其他详细信息” **[文档]**。FlowAssert 看不到令牌带有哪些权限范围；权限更宽的令牌也只会被用于下面的 `GET` 请求。`crm.objects.contacts.sensitive.read` 和 `…highly_sensitive.read` 所开放的属性用不到，不应授予。

## 请求

FlowAssert 向一个接口依次发送 HTTPS `GET` 请求，此外什么也不发：

```text
GET https://api.hubapi.com/crm/v3/objects/contacts?limit=100&archived=false&properties=NAME,NAME,...
GET https://api.hubapi.com/crm/v3/objects/contacts?limit=100&archived=false&properties=NAME,NAME,...&after=CURSOR
```

- **接口**是“Retrieve contacts”，即 `https://api.hubapi.com` 上的 `GET /crm/v3/objects/contacts` **[文档]**。
- **`limit=100`**：一次请求最多可以取回 100 个联系人 **[文档]**。
- **`archived=false`**：这个参数表示“是否只返回已归档的结果”，默认是 `false` **[文档]**。请求中明确写出它，这样请求本身就说明了要的是什么。
- **`properties`**：“以逗号分隔的、要在响应中返回的属性列表” **[文档]**：目标键和目标字段，每个只出现一次，按这个顺序。API 的机器可读描述把这个参数写成数组，也可以作为重复的参数发送；FlowAssert 使用文字说明中的逗号分隔形式，由实测确认 **[未确认]**。
- **`after`**：分页响应中如果还有更多结果，最后读到的资源的分页游标会作为 `paging.next.after` 返回 **[文档]**。FlowAssert 原样把它发回。

每个请求还发送 `Accept: application/json`、`Accept-Encoding: identity` 和 `User-Agent: flowassert-verify/VERSION`。

发送方式与 Google 表格来源相同：

- 使用标准库的 `http.client`，每个请求新建一个连接，只连到 `api.hubapi.com` 的 443 端口。即使设置了 `HTTPS_PROXY`，也不使用代理。
- TLS 使用 `ssl.create_default_context()`：验证证书和主机名，没有关闭验证的选项。
- 从不跟随重定向：任何 3xx 响应都会被拒绝。
- 不重试。限流、服务器错误或超时都会被拒绝，由使用者再运行一次核对。
- 响应体一旦超过 `--max-bytes` 就会被拒绝。

在免费账号上，私有应用每 10 秒最多 100 个请求，整个账号每天 250,000 个 **[文档]**。FlowAssert 一次发一个请求，不做限速；读取 1,000,000 个联系人需要 10,000 个请求。达到上限时 API 返回 429 **[文档]**，这会被拒绝。

## 从页面到行

一页是一个 JSON 对象，包含 `results`（记录列表），还有更多时包含 `paging.next.after`；最后一页“省略 `paging` 或它为空” **[文档]**。一条记录有 `id`（字符串）、`properties`（属性名到字符串的映射）、`archived`、`createdAt` 和 `updatedAt` **[文档]**。

| 响应中的内容 | 变成 |
| --- | --- |
| 一条记录 | 一个目标行，按列出的顺序 |
| 值为字符串的属性 | 原样的值 |
| 值为 `null` 的属性 | 空值。“如果请求的属性已定义，但联系人没有值，它会以 `null` 返回” **[文档]**。空值在每条规则下都是 `unknown`，与 CSV 文件相同 |
| 记录中没有的被请求属性 | 拒绝。“如果请求的属性没有定义，它不会出现在响应中” **[文档]**：这个名称不是这个对象的属性，就像缺少这一列的 CSV 文件会被拒绝一样 |
| 不是字符串也不是 `null` 的属性值 | 拒绝 |
| 没有 `id` 或 `properties` 的记录，或 `archived` 为 true 的记录 | 拒绝：这一页不是所请求的形状 |
| 之前某一页或本页已经列出过的记录 ID | 拒绝：列表在读取期间变了 |
| 一页超过 100 条记录 | 拒绝 |
| 有 `paging.next.after` | 下一个请求把它作为 `after` 发送。它只能包含字母、数字、`-` 和 `_`，最多 512 个字符，这样才能原样发回；指南说它是一个记录 ID **[文档]**。其他任何游标都会被拒绝 |
| 之前某一页已经给过的游标 | 拒绝：页面会重复 |
| 有下一页游标却没有记录的一页 | 拒绝 |
| 没有 `paging`、`paging` 为空或没有 `next` | 最后一页 |

这些行的表头就是所请求属性的列表。`--max-rows N`：列出的记录一旦超过 `N` 条就拒绝，不再请求后面的页。

行按页交给评估器，不会保留：目标逐行建立索引，与文件相同。

## 规范形式

读到的行在读取的同时写成一段 CSV 文本，`inputs.destination_sha256` 是这段文本字节的 SHA-256。这种形式名为 `flowassert-hubspot-csv-1`：

- UTF-8，没有字节顺序标记；
- 第一行是所请求的属性名，按请求的顺序，然后每条记录一行，按列出的顺序，每行以换行符（`\n`）结束，最后一行之后也有；
- 单元格用 `,` 分隔，值为 `null` 的属性写成空单元格；
- 单元格中含有 `,`、`"`、回车或换行时，或者它是这一行唯一的单元格且为空时，用双引号括起，其中的每个 `"` 写两次；其他单元格原样写出。

这是一个 CSV 文件，`flowassert-verify --destination` 读取它，会得到完全相同的行。使用者可以根据这些值重新算出摘要值，测试也用这种形式证明 HubSpot 和含有同样行的文件给出同样的结果。它不是从 HubSpot 导出的文件的字节。

## 内容完全相同

内容完全相同的检测保持不变：规范形式的摘要值与来源的摘要值相同时，除非加上 `--allow-identical-content`，否则会拒绝这次核对。它只能发现恰好含有这种规范形式的来源文件，发现不了以其他形式从同一个 HubSpot 账号导出的来源；来源是否独立，仍然由使用者负责。

## 拒绝

每次拒绝都会向标准错误输出 `refused: MESSAGE`，以状态 2 退出，不写报告，不得出任何结论。消息中从不包含令牌。`WHAT` 是 `HubSpot contacts`。`STATUS` 是 HubSpot 错误响应中的 `category`，或者限流响应中的 `errorType`，存在时写成 ` MISSING_SCOPES` 这样，并且只在它全由大写字母和 `_` 组成时才写。错误中的 `message` 从不复述，因为 FlowAssert 无法知道其中有什么。

| 消息 | 何时 |
| --- | --- |
| `--destination and --destination-hubspot cannot be combined` | 两者都给出 |
| `--destination-hubspot must be contacts` | 任何其他对象 |
| `--destination-timeout needs --destination-hubspot` | 只有这个选项，没有连接器 |
| `--destination-encoding does not apply to a HubSpot destination` | 两者都给出 |
| `HubSpot property name 'NAME' must be letters, digits and _, at most 100 characters` | 目标键或字段不是这样的名称 |
| `no credential: set FLOWASSERT_HUBSPOT_TOKEN to a private app access token with the scope crm.objects.contacts.read only` | 没有设置这个变量 |
| `FLOWASSERT_HUBSPOT_TOKEN does not hold a credential: printable ASCII without spaces, at most 4096 characters` | 为空、太长，或含有其他字符 |
| `FLOWASSERT_HUBSPOT_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only` | 任何其他值 |
| `WHAT: the request was not accepted (HTTP 400STATUS)` | 400 |
| `WHAT: the credential was not accepted (HTTP 401STATUS); it may have expired or been rotated` | 401 |
| `WHAT: access was denied (HTTP 403STATUS); the token may lack the scope crm.objects.contacts.read` | 403 |
| `WHAT: not found (HTTP 404STATUS)` | 404 |
| `WHAT: rate limited (HTTP 429STATUS); FlowAssert does not retry: wait, then run the check again` | 429 |
| `WHAT: server error (HTTP NSTATUS); FlowAssert does not retry: run the check again later` | 500 到 599 |
| `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects` | 300 到 399 |
| `WHAT: unexpected response (HTTP NSTATUS)` | 除 200 以外的其他状态 |
| `WHAT: no complete response within N seconds; FlowAssert does not retry` | 超过 `--destination-timeout` |
| `WHAT: the server's TLS certificate could not be verified` | 证书或主机名检查失败 |
| `WHAT: the connection failed` | 域名解析、连接或其他类型的 TLS 失败 |
| `WHAT: response exceeds --max-bytes limit of N` | 响应体大于 `--max-bytes` |
| `WHAT: the response is not the JSON the API documents (DETAIL)` | 不是 UTF-8 JSON、成员重复、响应体被压缩，或某个成员缺失或类型不对；`DETAIL` 说明是哪一种 |
| `WHAT: page P has more than 100 records` | 一页超过了请求的上限 |
| `WHAT: page P lists an archived record, and the read asked for none` | `archived` 为 true |
| `WHAT: page P has a record without the property 'NAME'; HubSpot leaves out a property the object does not have` | 某条记录缺少被请求的属性 |
| `WHAT: page P has a property value that is not text` | 值是数字、`true`、列表或对象 |
| `WHAT: record ID appears twice (pages P and Q): the list changed while it was read; run the check again` | 记录 ID 重复 |
| `WHAT: page P gives a paging cursor that FlowAssert cannot send back unchanged` | 游标含有其他字符，或长于 512 |
| `WHAT: page P repeats an earlier paging cursor` | 同一个游标出现两次 |
| `WHAT: page P has a next page and no records` | 不是最后一页的空页 |
| `WHAT: exceeds --max-rows limit of N` | 列出的记录超过 `N` 条 |

## 报告

目标从 HubSpot 读取的报告，`schema_version` 为 **3**。没有它的报告一个字节都不变，保留原来的版本（1，或者 Google 表格来源为 2）。使用版本 3，是因为已有成员的含义变了：`inputs.destination_sha256` 是规范形式的摘要值，而不是文件字节的摘要值；`premises.destination_count.observed` 统计的是列出的记录；`premises.destination_complete` 声明的是列出的记录覆盖了整个对象。只认识版本 1 和 2 的读取方会拒绝版本 3 的报告，这是有意的。

版本 3 包含版本 1 的每个成员，区别如下：

| 成员 | 在版本 3 中 |
| --- | --- |
| `inputs.destination_sha256` | 规范形式的 SHA-256 |
| `inputs.destination_encoding` | 从不出现。传了 `--source-encoding` 时，只出现 `inputs.source_encoding` |
| `inputs.destination_hubspot` | 新成员，总是出现（见下） |
| `inputs.source_sheet` | 来源从 Google 表格读取时出现，含义与版本 2 相同 |

`inputs.destination_hubspot`：

| 成员 | 值 |
| --- | --- |
| `read_by` | `FlowAssert`：这些行是 FlowAssert 读取的，不是使用者导出的。这不是关于完整性的说法 |
| `service` | `HubSpot CRM API v3` |
| `object` | `contacts` |
| `properties` | 所请求的属性名，按顺序 |
| `archived_excluded` | `true`：读取时请求了 `archived=false` |
| `page_limit` | `100` |
| `pages` | 读取的页数 |
| `rows` | 列出的记录数 |
| `read_at` | 发送第一个请求的时间，UTC ISO 8601 |
| `read_finished_at` | 最后一个响应到达的时间，UTC ISO 8601 |
| `canonical_form` | `flowassert-hubspot-csv-1` |

它从不记录令牌、门户（账号）ID、账号名称或记录的网址。`--redact-values` 保留对象和属性名：它们不是值。

打印的摘要在计数之后多两行（同时使用 Google 表格来源时，在表格的几行之后）：

```text
Destination read by FlowAssert from HubSpot: contacts, N records in P pages, from READ_AT to READ_FINISHED_AT; archived records were not read.
This lists what the token could see at that time; it does not show that the object is complete.
```

声明的总数不一致时，写 `HubSpot listed N records`，代替 `file has N rows`。HTML 报告多一节“Destination read from HubSpot”，列出同样的成员，以及这次读取不能说明的三件事。

`claim`、`limitations`、`acquisition_authenticity`（`not_authenticated`）和每一个结论都与文件相同。

浏览器打开、解释和比较版本 3 的报告：已保存报告的页面写明这些记录是 FlowAssert 从 HubSpot 联系人中只读列出的，以及这不能说明对象是完整的；“这个结果是什么意思”多一条同样的说明；目标一个是文件、一个是 HubSpot 的两份报告不能比较。浏览器从不向 HubSpot 发送请求。

## 资料来源

2026-11-09 阅读，读的是 HubSpot 开发者网站为每个页面提供的 Markdown 版本。

| 来源 | 用于 |
| --- | --- |
| “Retrieve contacts”，<https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/get-contacts.md>（以及 `GET /crm/v3/objects/contacts` 的 OpenAPI 描述） | 主机、路径，参数 `after`、`archived`、`limit`、`properties` 及其说明；响应形状（`results`、`paging.next.after`、记录的成员）；错误形状（`category`、`message`、`correlationId`） |
| “CRM API: Contacts”指南，<https://developers.hubspot.com/docs/api-reference/legacy/crm/objects/contacts/guide.md> | 一次请求最多 100 个联系人；`after` 是下一个联系人的记录 ID；没有定义的属性不返回，没有值的属性为 `null`；示例响应 |
| “Legacy private apps”，<https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview.md> | 访问令牌和 `Authorization: Bearer`；轮换令牌；删除应用会吊销它的令牌 |
| “Scopes”，<https://developers.hubspot.com/docs/apps/legacy-apps/authentication/scopes.md> | `crm.objects.contacts.read` 及其说明；敏感数据的权限范围 |
| “API usage guidelines and limits”，<https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines.md> | 私有分发应用的限制；429 响应及其成员 `errorType` 和 `policyName` |

HubSpot 的网站把 v3 接口列在“Legacy”下，旁边是同一个 API 按日期命名的版本（2026-03、2026-09）。FlowAssert 使用上面写明的 v3 路径。所读页面没有说明 v3 是否以及何时会被撤下 **[未确认]**。

所读页面没有说清楚、需要实测确认或否定的内容：

- 分页游标是否总是只含字母、数字、`-` 和 `_`；
- `properties` 是否接受一个逗号分隔的参数；
- 列表的顺序是否稳定，以及读取期间联系人变化时会怎样；
- 每种错误（无效令牌、缺少权限范围）的状态和 `category`；
- 私有应用令牌看不到哪些联系人；
- 用 `archived=false` 读取的列表中，`archived` 是否总是存在且为 `false`。
