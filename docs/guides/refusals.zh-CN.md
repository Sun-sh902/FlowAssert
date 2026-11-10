# 核对被拒绝时

[English](refusals.md) | 简体中文

核对被拒绝时，命令行会在标准错误输出 `refused: ` 和一条消息，退出码为 `2`，不写任何报告：什么都没有核对，所以没有结果可读。本页为每条消息各写一节，说明它的意思和你可以怎么做。浏览器中的 CSV 核对页面显示同样的消息，其中一些消息下面还会显示同样的提示，这些提示是根据你所选文件开头的字节得出的。

提示只是建议。FlowAssert 从不自动重试核对，也从不替你更改编码、分隔符或列：由你自己改选，然后重新核对。

消息保持英文，和命令行写的一样。下面的消息中，`FILE` 是你给出的路径（在浏览器中是文件名），`N` 是一个数字。

- [读取 CSV 文件](#读取-csv-文件)
- [选择列](#选择列)
- [配置文件和映射文件](#配置文件和映射文件)
- [选项](#选项)
- [两个文件放在一起](#两个文件放在一起)
- [读取 Google 表格范围](#读取-google-表格范围)

## 读取 CSV 文件

### `FILE: not UTF-8`

文件不能按默认编码 UTF-8 解码。FlowAssert 从不猜测编码。请看文件开头的字节：

- 以字节 `FF FE` 或 `FE FF`（UTF-16 字节顺序标记）开头：它很可能是 UTF-16。请传入 `--source-encoding utf-16` 或 `--destination-encoding utf-16`。
- 开头有很多零字节：它很可能是没有字节顺序标记的 UTF-16，FlowAssert 不读取这种文件。请把它另存为 UTF-8，或带字节顺序标记的 UTF-16。
- 包含来自较老系统的中文文本：它可能是 GB18030。请传入 `--source-encoding gb18030` 或 `--destination-encoding gb18030`。

在 macOS 或 Linux 上查看文件开头的字节：`head -c 64 FILE | od -A x -t x1z`。

### `FILE: not UTF-16`

文件在字节顺序标记之后不能按 UTF-16 解码。如果它其实是 UTF-8 或 GB18030，请改用那种编码。

### `FILE: not UTF-16 (no byte order mark)`

你指定了 UTF-16，但文件开头没有字节顺序标记。FlowAssert 只读取带标记的 UTF-16，这样不用猜测字节序。如果开头有很多零字节，请把文件另存为 UTF-8，或带字节顺序标记的 UTF-16；如果没有，文件很可能是 UTF-8：去掉编码选项即可。

### `FILE: not GB18030`

文件不能按 GB18030 解码。如果它是 UTF-8，去掉编码选项；如果它以 UTF-16 字节顺序标记开头，请指定 `utf-16`。

### `FILE: repeated column name`

表头中有列名出现了不止一次，按名字选择列就会有歧义。请在表头中给每一列起一个不同的名字，例如 `phone` 和 `phone_2`，然后重新核对。

### `FILE: missing column NAME`

表头中没有名字完全相同的列；缺少多列时用逗号列出。列名按原样比较，包括大小写和空格。

- 打印表头，看看文件用的列名：`head -n 1 FILE`。
- ` Phone` 或 `PHONE` 与 `phone` 是不同的名字：请按文件中的写法传入列名，或修改配置文件。
- 如果表头是一个很长的名字，里面有 `;` 或制表符，说明文件不是逗号分隔的：见下一节。

### `FILE: line N does not match the header`

文件第 `N` 行（按物理行计数，所以带换行的引号值算作多行）的字段数与表头不同。FlowAssert 不猜测哪个字段对应哪一列，而是拒绝整个文件。

- 对比第 `N` 行和表头的字段数。含有逗号的值必须放在双引号里，否则会被读成两个字段。
- 如果大多数行用 `;` 或制表符分隔，文件就不是逗号分隔的。FlowAssert 只读取逗号分隔的文件。请把文件重新导出或另存为以逗号分隔的 CSV；能写 CSV 的程序通常在导出或保存时提供这个选项，有时名为“逗号分隔”。

### `FILE: exceeds --max-rows limit of N`

文件的数据行数超过了 `--max-rows` 允许的上限（默认 1,000,000）。如果这台电脑的内存够用，可以传入更大的 `--max-rows`：来源文件所用的列会保存在内存中。浏览器核对使用默认上限，不能修改；更大的文件请使用命令行。

### `FILE: file size N bytes exceeds --max-bytes limit of N`

文件大于 `--max-bytes` 允许的大小（默认 209,715,200 字节，即 200 MiB），这在读取前检查。请传入更大的 `--max-bytes`。浏览器核对使用默认上限；更大的文件请使用命令行。

### `FILE: unexpected end of data`

文件在一个引号值内部结束：有一个 `"` 开始了一个值，却一直没有闭合。请在文件末尾附近找多余的双引号。在引号值内部，双引号要写两次：`"a ""quoted"" word"`。

### `FILE: ',' expected after '"'`

一个引号值后面跟着的不是逗号或行尾，例如 `"Ada" Lovelace,`。请把整个值放进引号里，或去掉引号。

### `FILE: new-line character seen in unquoted field - do you need to open the file with newline=''?`

一个没有引号的值里有一个单独的回车符（`\r`），而它并不是行尾。这是 Python CSV 读取器的消息；其中关于 `newline=''` 的问题是写给程序员的，不需要回答。请把这个值放进双引号里，或删掉这个多余的字符。

### `FILE: field larger than field limit (131072)`

有一个值长于 131,072 个字符，这是 Python 的默认上限。常见原因是某个引号没有闭合，文件剩余部分被读成了一个值。请在长值开始的那一行之前找多余的双引号。

### `FILE: ERROR`

文件无法打开，例如 `No such file or directory`（没有这个文件或目录）或 `Permission denied`（没有权限）；错误信息来自操作系统。请检查路径，以及你是否有权读取这个文件。

## 选择列

### `--key or --mapping is required`

用 `--key COLUMN`（或 `--key SOURCE:DESTINATION`）指定键列，或提供 `--mapping` 或 `--config` 文件。

### `at least one --field is required`

用 `--field COLUMN` 或 `--field SOURCE:DESTINATION` 至少指定一个比较列。

### `empty column name in 'TEXT'`

`--key` 或 `--field` 的值以 `:` 开头或为空，没有指定来源列。请写成 `COLUMN` 或 `SOURCE:DESTINATION`。列名本身含有 `:` 时，需要用 `--mapping` 或 `--config` 文件。

### `a source field is repeated`

同一个来源列被比较了两次。每个来源列只比较一次。

### `--mapping cannot be combined with --key or --field`

映射文件已经指定了键和字段。请只用文件，或只用这两个选项。

### `--config cannot be combined with --mapping, --key, --field, --scope`

配置文件已经指定了键、字段及其规则和范围。请去掉消息中列出的选项。

## 配置文件和映射文件

这些消息以 `--config` 或 `--mapping` 文件的路径开头。

### `FILE: not UTF-8`

配置文件或映射文件必须是 UTF-8 编码的 JSON（可以有字节顺序标记）。请把它另存为 UTF-8。

### `FILE: invalid JSON (MESSAGE)`

文件不是有效的 JSON；括号里的消息来自 Python，例如 `Expecting value`（缺少值）或 `Expecting ',' delimiter`（缺少逗号）。JSON 检查工具或编辑器可以指出出错的位置。

### `FILE: duplicate member 'NAME'`

文件中某个对象有两个同名成员。各种 JSON 读取器对哪一个生效看法不一，所以 FlowAssert 两个都拒绝。请只保留一个。

### `FILE: configuration must be a JSON object` 和 `FILE: mapping must be a JSON object`

文件最外层必须是一个对象 `{ ... }`，包含 `key` 和 `fields`。

### `FILE: NAME cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run`

配置文件只保存比较哪些列、怎么比较，从不保存你对某一对文件的声明。请删掉这个成员，在声明成立的那次运行中传入 `--source-complete`、`--destination-complete`、`--source-count` 或 `--destination-count`。

### `FILE: unknown member NAME` 和 `FILE: unknown member NAME in field`

文件里有 FlowAssert 不认识的成员，常见原因是拼写错误。配置文件有 `key`、`fields` 和 `scope`；其中每个字段有 `source`、`destination` 和 `rule`。映射文件有 `key` 和 `fields`。

### `FILE: missing member NAME` 和 `FILE: missing member NAME in field`

缺少必需的成员：文件中的 `key` 和 `fields`，配置文件每个字段中的 `source` 和 `destination`。

### `FILE: key must be a two-item list of strings` 和 `FILE: field must be a two-item list of strings`

键（以及映射文件中的每个字段）要写成 `["来源列", "目标列"]`。

### `FILE: empty column name in key` 和 `FILE: empty column name in field`

有列名为空或只有空格。

### `FILE: fields must be a non-empty list`

`fields` 必须是至少包含一个字段的列表。

### `FILE: each field must be an object with source, destination and an optional rule`

配置文件中的每个字段要写成 `{"source": "phone", "destination": "phone", "rule": "digits"}`。

### `FILE: field source must be a string`、`FILE: field destination must be a string` 和 `FILE: field rule must be a string`

这个成员必须是放在双引号里的文本。

### `FILE: a source field is repeated`

同一个来源列出现在两个字段中。每个来源列只比较一次。

### `FILE: scope must be one of: source, exact`

`scope` 只能是 `"source"` 或 `"exact"`。

### `FILE: field 'NAME': unknown comparison rule 'RULE'; use exact, trim, casefold, digits or date:FORMAT`

规则不是这五种之一。见[比较规则](first-check.zh-CN.md#在配置文件中选择比较规则)。

### `FILE: field 'NAME': date rule 'date:' has no format`

请在 `date:` 后面写格式，例如 `date:%Y-%m-%d`。

### `FILE: field 'NAME': date format 'FORMAT' has no directive`

格式中没有 `%` 指令，无法读取日期。`%%` 表示一个百分号字符，不是指令。

### `FILE: field 'NAME': malformed date format 'FORMAT' (ERROR)`

Python 的 `strptime` 无法使用这个格式；括号里的错误来自 Python。请检查每个 `%` 指令。

### `FILE: field 'NAME': date format 'FORMAT' repeats a directive`

某个指令（例如 `%Y`）出现了两次。每个指令只用一次。

在浏览器中，日期格式还可能因 `date format 'FORMAT' uses %X, which the browser check does not support; it supports %Y %m %d …` 被拒绝：浏览器只读取消息中列出的指令。这种格式请使用命令行。

## 选项

### `--max-bytes must be a positive integer`，`--max-rows` 同理

请写一个从 1 开始、只含数字的整数。

### `--source-count must be a non-negative integer`，`--destination-count` 和 `--max-details` 同理

请写一个从 0 开始、只含数字的整数。

### `--details must be one of: problems, all`

`--scope`（`source, exact`）、`--source-encoding` 和 `--destination-encoding`（`utf-8, utf-16, gb18030`）同理：请使用消息中列出的值之一。

## 两个文件放在一起

### `source and destination are the same file, so the check would not be independent`

两个路径指向同一个文件。请把目标系统的导出文件作为 `--destination` 传入。

### `source and destination have identical content, so the check would not be independent; pass --allow-identical-content if they really come from different systems`

两个文件的字节完全相同，这通常意味着一个文件和它自己的副本作了比较。请把目标系统的导出文件作为 `--destination` 传入。如果两个文件确实来自不同系统，只是恰好相同，`--allow-identical-content` 会把这项声明写进报告。FlowAssert 无法检查它。

## 读取 Google 表格范围

这些消息只来自使用 `--source-sheet` 的命令行（见 [Google 表格指南](google-sheets.zh-CN.md)）。消息中，`RANGE` 是你给出的范围，`WHAT` 说明是哪个请求失败了：`Google Sheets values`（单元格）或 `Google Drive revision metadata`（文件版本，在读取值之前和之后各读一次）。状态码后面的大写名称，例如 `PERMISSION_DENIED`，是 Google 错误中的状态；错误本身的消息从不转述。消息中从不包含你的凭据。FlowAssert 从不自动重试：改动之后，请再运行一次核对。

### `--source and --source-sheet cannot be combined`、`--source-sheet needs --source-range`、`--source-range needs --source-sheet`

来源要么是一个文件（`--source`），要么是一个表格范围（`--source-sheet` 加 `--source-range`）。`--source-timeout` 和 `--skip-source-revision` 也只能和 `--source-sheet` 一起使用。

### `--source-encoding does not apply to a sheet source`

表格中的单元格以文本到达，没有文件编码。请去掉这个选项。`--destination-encoding` 仍然适用于目标文件。

### `--source-sheet must be a spreadsheet ID: letters, digits, - and _, at most 200 characters`

只传入 ID，也就是表格地址中 `/d/` 后面的那一长串，而不是整个地址。

### `--source-range 'RANGE' must name a tab and bounded columns, such as Leads!A1:F or Leads!A1:F500`

写出工作表名、`!`，以及带列的起始和结束单元格：`Leads!A1:F`。工作表名中有空格或其他字符时要加引号：`'Q3 leads'!A1:F`，名字中的单引号写两次。没有工作表名的范围、命名范围、单个单元格和整行范围（`Leads!1:500`）都会被拒绝，这样报告总能说明读取的是哪些单元格。

### `--source-range 'RANGE' starts after it ends`

起始列或起始行在结束之后。把它们对调。

### `no credential: set FLOWASSERT_SHEETS_TOKEN to a read-only OAuth access token, or FLOWASSERT_SHEETS_API_KEY to an API key for a sheet shared for viewing`

FlowAssert 只从这两个环境变量之一读取凭据，从不从选项或文件读取。请在运行核对的命令行环境中设置其中一个（指南中说明了如何设置而不留在命令历史里）。

### `set only one of FLOWASSERT_SHEETS_TOKEN and FLOWASSERT_SHEETS_API_KEY`

两个都设置了。用 `unset` 去掉你不打算使用的那个。

### `FLOWASSERT_SHEETS_TOKEN does not hold a credential: printable ASCII without spaces, at most 4096 characters`，`FLOWASSERT_SHEETS_API_KEY` 同理

变量为空、长于 4,096 个字符，或者含有空格、换行或凭据中不会有的其他字符；常见原因是复制时带进了空格或换行。请重新设置。FlowAssert 不会显示它的内容。

### `FLOWASSERT_SHEETS_TEST_ENDPOINT must be http://127.0.0.1:PORT or http://[::1]:PORT; it is for tests only`

这个变量让命令连接 Google 接口的本地仿制服务，只用于 FlowAssert 自己的测试。请删除它。

### `WHAT: the credential was not accepted (HTTP 401 ...); it may have expired or been revoked`

访问令牌会过期。请获取新的令牌，或者确认 API 密钥没有被删除。

### `WHAT: access was denied (HTTP 403 ...); the credential may lack the read-only scope, its project may not have the API enabled, or the sheet is not shared with it`

- 令牌：签发时是否带有 `spreadsheets.readonly`，云端硬盘请求是否带有 `drive.metadata.readonly`？没有云端硬盘权限范围时，请加上 `--skip-source-revision`。
- API 密钥：它所在的项目是否启用了 Google Sheets API（读取版本还需要 Google Drive API），密钥的限制是否允许这些 API？表格是否共享为“知道链接的人可查看”？
- 令牌所属的账号打不开这个表格：把表格以查看权限共享给这个账号。

### `WHAT: not found (HTTP 404 ...); check the spreadsheet ID and that the credential can see it`

ID 不对，表格已被删除，或者这个凭据看不到它。

### `WHAT: the request was not accepted (HTTP 400 ...); check that the tab exists and the range lies inside it`

通常是工作表名不存在（名字按原样匹配），或者范围超出了工作表的最后一列。

### `WHAT: rate limited (HTTP 429 ...); FlowAssert does not retry: wait, then run the check again`

Google 限制一个项目或一个用户每分钟可以读取的次数。等一分钟左右，再运行一次核对。

### `WHAT: server error (HTTP N ...); FlowAssert does not retry: run the check again later`

5xx 状态：Google 那边的问题。稍后再运行一次核对。

### `WHAT: redirected (HTTP N), and FlowAssert does not follow redirects`，以及 `WHAT: unexpected response (HTTP N ...)`

收到的响应不是 API 文档中读取请求应有的响应。FlowAssert 不从中得出任何结论。如果一直出现，可能是你和 Google 之间的某个东西（例如网络登录页面）代替 Google 作了回答。

### `WHAT: no complete response within N seconds; FlowAssert does not retry`

请求用时超过了 `--source-timeout`（默认 60 秒）。再运行一次核对，限定范围的行数，或者传入更大的 `--source-timeout`。

### `WHAT: the server's TLS certificate could not be verified`

FlowAssert 总是验证证书，没有跳过验证的选项。在 macOS 上使用 python.org 的 Python 时，请运行一次 Python 文件夹中的“Install Certificates.command”。在会检查加密流量的网络中，对方出示的证书不是 Google 的。

### `WHAT: the connection failed`

无法解析域名，或者无法建立连接。请检查电脑是否联网。FlowAssert 直接连接，不使用 `HTTPS_PROXY` 中设置的代理。

### `WHAT: response exceeds --max-bytes limit of N`

响应大于 `--max-bytes`（默认 200 MiB）。请限定范围，或调高上限。

### `WHAT: the response is not the JSON the API documents (DETAIL)`

响应不是文档所描述的 JSON：`DETAIL` 说明了哪里不对，例如 `not JSON` 或 `majorDimension is not ROWS`。FlowAssert 不从中得出任何结论。如果一直出现，欢迎反馈，附上这条消息，但不要附上任何凭据或数据。

### `Google Sheets returned the range 'R' for 'RANGE', which is not the range asked for`

API 说它读取的单元格和请求的不同，例如列不同。FlowAssert 拒绝核对其他单元格。请检查范围，以及它的列是否在工作表之内。

### `RANGE: the response has more rows than the range holds`、`RANGE: row N has more cells than the range has columns`

响应和它所说的范围不相符。FlowAssert 不从中得出任何结论。

### `RANGE: row N has a cell that is not text; FlowAssert reads formatted values only`

FlowAssert 请求的是每个单元格在表格中显示的文本，收到的却是别的东西。欢迎反馈。

### `RANGE: row N has a value beyond the header`

表格的第 `N` 行在某一列中有值，而这一列的表头单元格是空的或不存在。请在表头行给这一列写上列名，或者把范围缩小到有列名的列。

### `RANGE: repeated column name`、`RANGE: missing column NAME`、`RANGE: exceeds --max-rows limit of N`

和文件相同：见[选择列](#选择列)和 [`FILE: exceeds --max-rows limit of N`](#file-exceeds---max-rows-limit-of-n)。表头是范围的第一行：如果范围从表头下面开始，读到的第一行会被当作表头。空范围没有任何列，所以每一列都缺少。

### `the sheet changed while it was read: Drive version A modified T before the values, version B modified U after; run the check again`

在读取值之前和之后，Google 云端硬盘记录到了文件的改动，所以这些值无法对应到表格的同一个状态。云端硬盘也会记录用户看不到的改动，所以即使没有任何单元格变化，也可能出现这种情况。再运行一次核对；如果有人正在编辑表格，请等他们完成。

### `the sheet's revision could not be read the same way before and after the values; run the check again`

两次云端硬盘读取中，一次有版本、另一次没有。再运行一次核对。
