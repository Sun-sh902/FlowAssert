# Google 表格来源：设计说明

[English](google-sheets.md) | 简体中文

状态：FlowAssert 0.7.0，只在命令行中提供。这份说明写在代码之前，之后随代码保持一致。这里的内容都没有在 Google 上实际试过：关于 Google 行为的每一条说法都来自文档，并做了标记。标为 **[文档]** 的说法来自[资料来源](#资料来源)中列出的文档；标为 **[未确认]** 的说法所依据的 Google 文档页面，在编写这份说明的电脑上打不开，所以只是基于对这个 API 的一般了解，必须由维护者的实测（[scripts/dev/sheets_live_check.md](../../scripts/dev/sheets_live_check.md)）来确认。关于 FlowAssert 自身行为的说法，依据的是它自己的代码和测试，测试针对的是两个接口的本地仿制服务。

- [读取能说明什么，不能说明什么](#读取能说明什么不能说明什么)
- [选项和环境变量](#选项和环境变量)
- [范围](#范围)
- [请求](#请求)
- [从值响应到数据行](#从值响应到数据行)
- [规范形式](#规范形式)
- [版本检查](#版本检查)
- [内容完全相同](#内容完全相同)
- [拒绝](#拒绝)
- [报告](#报告)
- [资料来源](#资料来源)

## 读取能说明什么，不能说明什么

使用 `--source-sheet` 时，来源行不再是用户导出的 CSV 文件：FlowAssert 通过 Google Sheets API，以只读方式，从一个工作表的一个有界范围中自己读取这些行。

它能说明：FlowAssert 读取时，这个范围里有哪些值（按 API 返回的样子）；没有任何导出步骤能在中途截断或改动这些行；如果 Google 云端硬盘给出了版本信息，还能说明在读取值之前和之后的这段时间里，文件版本没有变化。

它不能说明：

- **这个范围包含了应有的全部记录。** 表格范围是否就是完整的一批，仍然是用户的声明 `--source-complete`，作为 FlowAssert 不会核实的前提写进报告，含义和效果都与文件来源相同。没有这项声明，这一批永远不会是已验证。
- 这些值是真实的，或者这个表格就是正确的来源；
- 某个工作流写入过数据，或者某条记录在过去的截止时间前已经存在；
- 在同一个版本下再读一次会得到同样的值：依赖时间或其他文件的公式，可能在版本号不变的情况下改变 **[未确认]**；
- 任何关于目标的事情：目标仍是一个 CSV 文件，前提和以前一样。

表格来源永远不会比放在 CSV 文件里的同样的行“更已验证”：同样的单元格值，会得到同样的记录、规则结果、计数和批次状态，测试保证这两条路径一致。

## 选项和环境变量

| 选项 | 含义 |
| --- | --- |
| `--source-sheet ID` | 从这个表格读取来源，代替 `--source FILE`。ID 是表格地址中 `/d/` 和下一个 `/` 之间的部分 **[未确认]**。只能包含字母、数字、`-` 和 `_`，最多 200 个字符 |
| `--source-range RANGE` | 要读取的范围，用带工作表名和有界列的 A1 表示法写，例如 `Leads!A1:F` 或 `Leads!A1:F500`。使用 `--source-sheet` 时必填 |
| `--source-timeout SECONDS` | 每个请求最长可用的时间，从连接到收到响应的最后一个字节（默认 60） |
| `--skip-source-revision` | 不向 Google 云端硬盘请求版本信息。报告会写明这次读取无法对应到某个版本 |

`--source-sheet` 不能和 `--source` 同时使用。`--source-range`、`--source-timeout` 和 `--skip-source-revision` 只能和 `--source-sheet` 一起使用。`--source-encoding` 不适用于表格，与表格来源同时使用会被拒绝。其他选项的用法和文件来源相同：`--max-rows`（数据行数，不含表头）、`--max-bytes`（每个响应正文的大小）、`--key`、`--field`、`--mapping`、`--config`、`--scope`、各项前提和总数、`--details`、`--max-details`、`--redact-values`、`--json` 和 `--html`。

凭据只从环境变量读取，从不从命令行参数或文件读取：

| 变量 | 内容 |
| --- | --- |
| `FLOWASSERT_SHEETS_TOKEN` | OAuth 2.0 访问令牌，以 `Authorization: Bearer TOKEN` 发送 |
| `FLOWASSERT_SHEETS_API_KEY` | API 密钥，用于共享为“知道链接的人可查看”的表格，以查询参数 `key` 发送 **[文档]** |
| `FLOWASSERT_SHEETS_TEST_ENDPOINT` | 只用于测试：`http://127.0.0.1:PORT` 或 `http://[::1]:PORT`。设置后，两类请求都发往这里，而不是 Google。其他任何值都会被拒绝 |

两种凭据必须恰好设置一种。凭据只能由可打印的 ASCII 字符组成，不含空格，最多 4,096 个字符；否则会被拒绝，并且不会显示它的内容。FlowAssert 从不打印、记录、保存或写出凭据：摘要、报告、拒绝信息和错误里都不会有。它不执行 OAuth 登录：令牌或密钥由用户自己获取（[使用指南](../guides/google-sheets.zh-CN.md)以一般的方式说明了怎么做），并且只应授予下面的只读权限范围。

两个只读权限范围是 `https://www.googleapis.com/auth/spreadsheets.readonly`，说明为“查看你的所有 Google 表格”，以及 `https://www.googleapis.com/auth/drive.metadata.readonly`，说明为“查看你的 Google 云端硬盘文件的信息” **[文档]**（说明原文为英文，这里是译文）。`spreadsheets.values.get` 接受 `spreadsheets.readonly` **[文档]**，云端硬盘的 `files.get` 接受 `drive.metadata.readonly` **[文档]**。只有 `spreadsheets.readonly` 的令牌可以和 `--skip-source-revision` 一起使用。FlowAssert 看不到令牌带有哪些权限范围；即使令牌的权限更宽，也只会用于下面的两类 `GET` 请求。

## 范围

`--source-range` 必须写成 `TAB!START:END`，其中：

- `TAB` 是工作表名，可以不加引号（字母、数字、`_` 和 `.`），也可以放在单引号里，名字中的单引号写两次，例如 `'Q3 leads'` 或 `'Ann''s list'`。这些引号规则是 Google 的 A1 表示法 **[未确认]**。
- `START` 是列加可选的行号，例如 `A1` 或 `A`；没有行号时，范围从第 1 行开始。
- `END` 是列加可选的行号，例如 `F500` 或 `F`；没有行号时，范围一直到工作表的最后一行。
- 列是 1 到 3 个字母，从 `A` 到 `ZZZ`，大小写均可。行号是从 1 开始的整数，最多 8 位。
- 起始列不在结束列之后，起始行不在结束行之后。

会被拒绝的有：没有工作表名的范围（`A1:F`，API 会从第一个可见的工作表读取 **[未确认]**）、定义的名称（“命名范围”，例如 `Leads2026`）、单个单元格、整行范围例如 `Leads!1:500`（列没有边界）、R1C1 表示法，以及其他任何写法。拒绝定义的名称，是因为命令和报告都看不出读取的是哪个工作表的哪些单元格。

范围的第一行是表头，之后的每一行都是数据行。

## 请求

FlowAssert 依次发送三个 HTTPS `GET` 请求，除此之外什么都不发：

1. 读取值之前，云端硬盘的版本信息（使用 `--skip-source-revision` 时不发）：
   `GET https://www.googleapis.com/drive/v3/files/ID?fields=version,modifiedTime&supportsAllDrives=true` **[文档]**
2. 值：
   `GET https://sheets.googleapis.com/v4/spreadsheets/ID/values/RANGE?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING` **[文档]**
3. 读取值之后，再读一次云端硬盘的版本信息（使用 `--skip-source-revision` 时不发）。

`ID` 和 `RANGE` 都经过百分号编码，所以都不能改变路径。使用 API 密钥时，每个请求都会加上 `&key=KEY`。每个请求还会发送 `Accept: application/json`、`Accept-Encoding: identity` 和 `User-Agent: flowassert-verify/VERSION`。

发送方式：

- 使用标准库的 `http.client`，每个请求一个新连接，只连接 `www.googleapis.com` 或 `sheets.googleapis.com` 的 443 端口。不使用代理，即使设置了 `HTTPS_PROXY`。
- TLS 使用 `ssl.create_default_context()`：证书和主机名都会验证，没有任何选项可以关闭。在 macOS 上使用 python.org 的 Python 时，可能需要先安装证书（Python 文件夹中的“Install Certificates.command”），否则请求会因为证书无法验证而被拒绝。
- 从不跟随重定向：任何 3xx 响应都会导致拒绝。
- 不会重试。被限流、服务器出错或超时，都会被拒绝，由用户再运行一次核对。
- 响应正文一旦超过 `--max-bytes` 就被拒绝，不再继续读取。

## 从值响应到数据行

值响应是一个 `ValueRange`，包含 `range`、`majorDimension` 和 `values` **[文档]**。

- **`range`** 是“所请求的整个范围，即使值中不包含末尾的行和列” **[文档]**。FlowAssert 要求它就是所请求的范围：工作表相同（去掉引号后比较）、列相同、起始行相同。如果请求写了结束行，返回的结束行必须相同；如果没有写，响应可以给出一个结束行（工作表的最后一行 **[未确认]**）。其他情况都会被拒绝。
- **`majorDimension`** 必须是 `ROWS`。
- **`values`** 是由行组成的列表，每一行是由单元格组成的列表。“末尾的空行和空列不会包含在内” **[文档]**；范围为空时，这个成员可能不存在 **[未确认]**：这会被当作没有任何行。

数据行这样得到：

| 响应中 | 变成 |
| --- | --- |
| 第一行 | 表头。它的宽度就是它的单元格数，所以表头末尾的空单元格不算在内。中间的空表头单元格是一个名为 `""` 的列，和 CSV 表头一样 |
| 比表头短的行 | 用空字符串补齐：行末省略的单元格就是空单元格。描述中只说“末尾的空行和空列不会包含在内” **[文档]**；每一行自己末尾的空单元格也被省略，这一点 **[未确认]** |
| 比表头长的行 | 拒绝：没有列名的值无法核对，同样的行在 CSV 文件中也会被拒绝 |
| 两行之间的空行（`[]`） | 一个所有单元格都为空的数据行。它没有键，所以来源总体未知。FlowAssert 不跳过它，因为它分不清这是一条空记录还是一个空隙；请删掉它，或缩小范围 |
| 范围末尾被省略的行 | 不是数据行。它们在表格中是空的 **[文档]** |
| 空字符串 | 空值：在每条规则下都是未知，和 CSV 文件相同 |
| 不是字符串的单元格 | 拒绝（见下面的渲染选项） |
| 行数多于范围的行数，或单元格多于范围的列数 | 拒绝 |

**渲染选项。** FlowAssert 请求 `FORMATTED_VALUE`：“值会按单元格的格式计算并格式化。格式依据的是表格的区域设置，而不是请求者的区域设置” **[文档]**。所以每个单元格都以表格中显示的文本到达，这也正是从表格导出的 CSV 中的内容，以及与目标 CSV 文件比较的内容。格式为 `1,234.50` 的数字以 `"1,234.50"` 到达，格式为 `2026-01-02` 的日期以 `"2026-01-02"` 到达，可以用 `date:%Y-%m-%d` 规则读取。其他选项没有采用：`UNFORMATTED_VALUE` 把数字作为 JSON 数字返回，没有唯一的文本形式可供比较（`1`、`1.0`、`1e3`），日期则是序列号；`FORMULA` 返回的是公式而不是值。FlowAssert 还会发送 `dateTimeRenderOption=FORMATTED_STRING`，根据描述，它“在 value_render_option 为 FORMATTED_VALUE 时会被忽略” **[文档]**：发送并记录它，是为了让报告明确写出两个选项。这一版中这两个选项是固定的，用户不能选择其他值。

因为值按表格的区域设置格式化，改变表格的区域设置或某一列的数字格式，会改变读到的值，也可能改变结果。这是来源的变化，报告中的摘要也会随之改变。

`--max-rows N` 会在读完响应后拒绝数据行多于 `N` 的范围；表头不计算在内。想让读取保持小规模，请在范围本身中限定行数。

## 规范形式

读到的行在内存中写成一份 CSV 文本，`inputs.source_sha256` 就是这份文本字节的 SHA-256。这种形式名为 `flowassert-sheet-csv-1`：

- UTF-8，没有字节顺序标记；
- 先是表头，然后是每个数据行，每行都用空字符串补齐到表头的宽度，每行以换行符（`\n`）结尾，最后一行也是；
- 单元格之间用 `,` 分隔；
- 单元格包含 `,`、`"`、回车或换行时，或者它是所在行唯一的单元格并且为空时，用双引号括起来，其中的每个 `"` 写两次；其他单元格原样写出。

空范围没有表头，所以在计算摘要之前，就会因为缺少列而被拒绝。

`flowassert-verify --source` 读这份 CSV 文件，得到的正是同样的行。所以用户可以根据这些值重新算出摘要，测试也用这种形式证明：同样的行放在表格中和放在文件中，结果相同。它和从表格下载的 CSV 文件的字节不一定相同，后者可能使用别的换行符或引号方式 **[未确认]**。

## 版本检查

Google 云端硬盘的 `files.get` 会返回 `version`：“文件单调递增的版本号，反映服务器上对文件的每一次改动，包括用户看不到的改动”，是写成字符串的 int64；以及 `modifiedTime`：“任何人最后一次修改文件的时间（RFC 3339 日期时间）” **[文档]**。字段 `headRevisionId`“目前只对 Google 云端硬盘中有二进制内容的文件提供” **[文档]**，Google 表格不属于这种文件，所以 FlowAssert 不请求它。

FlowAssert 在读取值之前和之后各读一次 `version` 和 `modifiedTime`：

- 两次都有 `version`，并且相同（两次的 `modifiedTime` 也相同）：报告记录它们，摘要写“Drive version V before and after the values were read.”
- 两次都有 `version`，但其中任何一个值不同：拒绝，“the sheet changed while it was read”。因为 `version` 也会因用户看不到的改动而增加 **[文档]**，这可能会拒绝一次没有任何单元格变化的读取；用户再运行一次核对即可。
- 两次都没有 `version`（响应中没有这个成员）：核对继续。报告和摘要会写明这次读取无法对应到某个版本，以及原因。
- 一次有 `version`、另一次没有：拒绝，因为这次读取无法对应到同一个状态。
- 使用 `--skip-source-revision`：不发送任何云端硬盘请求，报告和摘要会写明，因为没有请求版本信息，这次读取无法对应到某个版本。
- 云端硬盘返回的任何错误（401、403、404、429、5xx、超时、无法解析的响应）都会被拒绝，和表格接口的错误一样。没有 `drive.metadata.readonly` 的令牌，预计会在这里得到 403 **[未确认]**：请和 `--skip-source-revision` 一起使用。

两次版本相同，说明在两次读取版本信息之间，云端硬盘没有记录到改动。Google 没有文档说明值响应恰好对应这个版本，所以报告记录的是读取前后观察到的情况，而不是关于它的保证。

## 内容完全相同

内容相同检测保留，并且和两个文件时一样工作：规范形式的摘要和目标文件字节的摘要相同时，除非加上 `--allow-identical-content`，否则核对会被拒绝，报告会记录 `identical_content`。它只在一种很窄的情况下有意义：目标文件恰好就是表格的规范形式，比如是从同样的值写出来的，这样核对就是在拿表格和它自己比较。如果是从表格下载、换行符或引号方式不同的 CSV 文件，它同样是在拿表格和自己的副本比较，但这种检测发现不了。FlowAssert 不打算通过逐行比较来发现这种情况：和两个文件时一样，目标是否独立，仍由用户负责。

## 拒绝

每一次拒绝都会在标准错误输出 `refused: MESSAGE`，以状态 2 退出，不写报告，也不得出任何结论，和其他拒绝一样。消息中从不包含凭据。下表中，`RANGE` 是所给的范围，`WHAT` 是 `Google Sheets values` 或 `Google Drive revision metadata`，`STATUS` 是 Google JSON 错误格式（`{"error": {"code": 404, "status": "NOT_FOUND", ...}}` **[文档]**）中的 `error.status`，在它存在并且只由大写字母和 `_` 组成时写成 ` NOT_FOUND`。错误的 `message` 从不转述，因为 FlowAssert 无法知道其中有什么。

| 消息 | 何时出现 |
| --- | --- |
| `--source and --source-sheet cannot be combined` | 两者都给出了 |
| `--source-sheet needs --source-range` | 没有范围 |
| `OPTION needs --source-sheet` | 没有表格时使用了 `--source-range`、`--source-timeout` 或 `--skip-source-revision` |
| `--source-encoding does not apply to a sheet source` | 两者同时给出 |
| `--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters` | 其他任何 ID |
| `--source-range 'RANGE' must name a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500` | 不符合上面的写法 |
| `--source-range 'RANGE' starts after it ends` | 起始列或起始行在结束之后 |
| `no credential: set FLOWASSERT_SHEETS_TOKEN to a read-only OAuth access token, or FLOWASSERT_SHEETS_API_KEY to an API key for a sheet shared for viewing` | 两个变量都没有设置 |
| `set only one of FLOWASSERT_SHEETS_TOKEN and FLOWASSERT_SHEETS_API_KEY` | 两个都设置了 |
| `VARIABLE does not hold a credential: printable ASCII without spaces, at most 4096 characters` | 为空、太长或含有其他字符 |
| `FLOWASSERT_SHEETS_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only` | 其他任何值 |
| `WHAT: the credential was not accepted (HTTP 401STATUS); it may have expired or been revoked` | 401 |
| `WHAT: access was denied (HTTP 403STATUS); the credential may lack the read-only scope, its project may not have the API enabled, or the sheet is not shared with it` | 403 |
| `WHAT: not found (HTTP 404STATUS); check the spreadsheet ID and that the credential can see it` | 404 |
| `WHAT: the request was not accepted (HTTP 400STATUS); check that the tab exists and the range lies inside it` | 400 |
| `WHAT: rate limited (HTTP 429STATUS); FlowAssert does not retry: wait, then run the check again` | 429 |
| `WHAT: server error (HTTP NSTATUS); FlowAssert does not retry: run the check again later` | 500 到 599 |
| `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects` | 300 到 399 |
| `WHAT: unexpected response (HTTP NSTATUS)` | 200 以外的其他状态 |
| `WHAT: no complete response within N seconds; FlowAssert does not retry` | 超过 `--source-timeout` |
| `WHAT: the server's TLS certificate could not be verified` | 证书或主机名检查失败 |
| `WHAT: the connection failed` | 域名解析、连接或其他类型的 TLS 失败 |
| `WHAT: response exceeds --max-bytes limit of N` | 正文大于 `--max-bytes` |
| `WHAT: the response is not the JSON the API documents (DETAIL)` | 不是 UTF-8 的 JSON、成员重复、正文经过压缩，或者某个成员缺失或类型不对；`DETAIL` 说明是哪一种 |
| `Google Sheets returned the range 'R' for 'RANGE', which is not the range asked for` | 见[从值响应到数据行](#从值响应到数据行) |
| `RANGE: the response has more rows than the range holds` | 行数多于范围的行数 |
| `RANGE: row N has more cells than the range has columns` | 某一行比范围宽 |
| `RANGE: row N has a cell that is not text; FlowAssert reads formatted values only` | 单元格中是数字、`true`、`null` 或列表 |
| `RANGE: row N has a value beyond the header` | 某一行比表头宽（`N` 是表格中的行号） |
| `RANGE: repeated column name` | 和文件相同 |
| `RANGE: missing column NAME` | 和文件相同；空范围没有任何列 |
| `RANGE: exceeds --max-rows limit of N` | 和文件相同 |
| `the sheet changed while it was read: Drive version A modified T before the values, version B modified U after; run the check again` | 版本号或修改时间不同 |
| `the sheet's revision could not be read the same way before and after the values; run the check again` | 一次云端硬盘读取有 `version`，另一次没有 |

## 报告

表格来源的报告的 `schema_version` 是 **2**。所有不使用表格来源的报告都逐字节不变，仍是 `schema_version` 1。使用版本 2，是因为对于表格来源，有三个已有成员的含义变了：`inputs.source_sha256` 是规范形式的摘要，而不是文件字节的摘要；`source_rows_observed` 和 `premises.source_count.observed` 计算的是范围中的数据行；`premises.source_complete` 声明的是表格范围是完整的一批。只认识版本 1 的读取方，例如 0.6.0 的网页界面，会拒绝版本 2 的报告，这是有意的：否则它会把表格中的行当作文件显示，并与文件的报告比较。

版本 2 包含版本 1 的每个成员，含义相同，只有以下不同：

| 成员 | 在版本 2 中 |
| --- | --- |
| `inputs.source_sha256` | 规范形式的 SHA-256 |
| `inputs.source_encoding` | 从不出现：表格没有编码。使用了 `--destination-encoding` 时，只出现 `inputs.destination_encoding` |
| `inputs.source_sheet` | 新增，总是出现（见下） |

`inputs.source_sheet`：

| 成员 | 值 |
| --- | --- |
| `read_by` | `FlowAssert`：这些行由 FlowAssert 读取，而不是由用户导出。这不是关于完整性的声明 |
| `service` | `Google Sheets API v4` |
| `spreadsheet_id` | 所给的表格 ID |
| `range_requested` | 所给的范围 |
| `range_returned` | 值响应中的 `range`，按返回的样子 |
| `value_render_option` | `FORMATTED_VALUE` |
| `date_time_render_option` | `FORMATTED_STRING` |
| `major_dimension` | `ROWS` |
| `read_at` | 发送值请求的时间，UTC 的 ISO 8601，例如 `2026-11-05T08:15:30.123456Z` |
| `revision` | `{"available": true, "before": {"version": V, "modified_time": T}, "after": {...}}`，其中 `V` 是版本字符串，`T` 是 `modifiedTime` 字符串或 `null`；或者 `{"available": false, "reason": R}`，其中 `R` 是 `not requested (--skip-source-revision)` 或 `Google Drive returned no version` |
| `canonical_form` | `flowassert-sheet-csv-1` |

报告从不记录凭据、账号或表格标题。`--redact-values` 不会去掉表格 ID 和范围，它们不是值。

打印的摘要会在计数之后多两行：

```text
Source read by FlowAssert from Google Sheets: spreadsheet ID, range RANGE_RETURNED, at READ_AT.
Drive version V before and after the values were read.
```

或者第二行换成 `The read cannot be tied to a revision: REASON.`。声明的总数不符时，写的是 `range has N rows`，而不是 `file has N rows`。HTML 报告会多一节“Source read from Google Sheets”，包含同样的成员，以及“这次读取不能说明这个范围包含了应有的全部记录”这句话（原文为英文）。

`claim`、`limitations`、`acquisition_authenticity`（`not_authenticated`）以及所有结论，都和文件来源相同。

## 资料来源

阅读日期：2026-11-05。在编写这份说明的电脑上，`developers.google.com` 和 `cloud.google.com` 上的开发者页面都打不开（每个请求都超时），所以 **[文档]** 说法来自 Google 的机器可读 API 描述（其中包含相同的参考文字），以及 Google 在 GitHub 上的 API 设计文档：

| 资料 | 用于 |
| --- | --- |
| Google Sheets API 发现文档，<https://sheets.googleapis.com/$discovery/rest?version=v4>（revision 20261028） | `spreadsheets.values.get`：方法、路径、参数，`ValueRenderOption`、`DateTimeRenderOption` 和 `majorDimension` 的说明，`ValueRange`，接受的权限范围及其说明，`key` 参数 |
| Google Drive API 发现文档，<https://www.googleapis.com/discovery/v1/apis/drive/v3/rest>（revision 20261102） | `files.get`：方法、路径、接受的权限范围、`supportsAllDrives`、`fields`；`File` 的字段 `version`、`modifiedTime`、`headRevisionId`；权限范围 `drive.metadata.readonly` |
| `google/rpc/code.proto`，<https://github.com/googleapis/googleapis/blob/master/google/rpc/code.proto> | `status` 名称及其 HTTP 状态码（`PERMISSION_DENIED` 403、`UNAUTHENTICATED` 401、`RESOURCE_EXHAUSTED` 429、`NOT_FOUND` 404 等） |
| AIP-193 Errors，<https://github.com/aip-dev/google.aip.dev/blob/master/aip/general/0193.md> | JSON 错误格式 `{"error": {"code", "message", "status", "details"}}` |

打不开的页面如下，**[未确认]** 的说法与它们有关；这些说法要在实测中确认或推翻：

- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get>
- <https://developers.google.com/workspace/sheets/api/guides/concepts>（A1 表示法、表格 ID）
- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueRenderOption>
- <https://developers.google.com/workspace/sheets/api/reference/rest/v4/DateTimeRenderOption>
- <https://developers.google.com/workspace/sheets/api/scopes>
- <https://developers.google.com/workspace/sheets/api/limits>（使用限制、429）
- <https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get>
- <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- <https://developers.google.com/workspace/drive/api/guides/handle-errors>
- <https://cloud.google.com/docs/authentication/api-keys>
