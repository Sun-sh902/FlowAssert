# 用 Google 表格的范围核对目标导出

[English](google-sheets.md) | 简体中文

从 1.0.0 起，命令行可以自己读取来源行：以只读方式，从 Google 表格的一个范围中读取，而不是从你导出的 CSV 文件中读取。目标仍是导出的 CSV 文件。这份指南介绍如何准备范围、获取只读凭据、运行一次核对、阅读结果，以及哪些仍然是你的声明。所有细节和每一种拒绝，见[设计说明](../connectors/google-sheets.zh-CN.md)。

只有命令行会读取表格。浏览器中的 CSV 核对页面、GitHub Action 和 n8n 示例只读取文件，不会向 Google 发送任何请求。

> [!IMPORTANT]
> **还没有在 Google 上实际试过。** FlowAssert 读取表格的功能，是针对按 Google API 描述搭建的、两个接口的本地仿制服务测试的，还没有人在真实的表格上运行过。下面获取凭据的步骤，是根据文档以一般的方式写的，同样没有试过。如果有什么和这里写的不一样，欢迎[反馈](https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback_zh-CN.yml)，但不要附上任何凭据、密钥或真实数据。

- [1. 读取表格能说明什么，不能说明什么](#1-读取表格能说明什么不能说明什么)
- [2. 准备一个带键列的有界范围](#2-准备一个带键列的有界范围)
- [3. 获取只读凭据](#3-获取只读凭据)
- [4. 运行一次核对](#4-运行一次核对)
- [5. 阅读结果](#5-阅读结果)
- [6. 哪些仍然是你的声明](#6-哪些仍然是你的声明)
- [7. 用完之后：清除凭据](#7-用完之后清除凭据)

## 1. 读取表格能说明什么，不能说明什么

读取表格去掉了一个原本需要你信任的步骤：导出。因为是 FlowAssert 自己读取范围，没有任何导出过程能截断或改动这些行；报告会记录读取的是哪个表格、哪个范围、什么时间，以及在 Google 云端硬盘提供时，读取值之前和之后的文件版本。

它**不能**说明这个范围包含了应有的全部记录。筛选、缺少的行，或者从来没有录入表格的记录，通过 API 看和通过 CSV 文件看是一样的。范围是否就是完整的一批，仍然是你的声明 `--source-complete`，和文件来源完全相同。同样的单元格值，会得到和放在 CSV 文件里的同样的行相同的结果：读取表格永远不会让结果“更已验证”。

## 2. 准备一个带键列的有界范围

1. 把一批记录放在一个工作表上，第一行是表头，每行一条记录。
2. 给工作表一列能标识每条记录的值，例如 `lead_id`，每一行都有值，并且没有重复。目标导出中必须有同样的键。
3. 记录之间不要有空行。FlowAssert 会把范围中的空行当作一条没有键的记录，这会让这一批不能是已验证；它分不清空记录和空隙。
4. 写范围时带上工作表名和需要的列：`Leads!A1:F` 读取工作表 `Leads` 的 A 到 F 列，从第 1 行到最后一行有值的行；`Leads!A1:F500` 到第 500 行为止。工作表名中有空格时要加引号：`'Q3 leads'!A1:F`。没有工作表名的范围、命名范围、整行范围（例如 `Leads!1:500`）都会被拒绝，这样命令和报告总能说明读取的是哪些单元格。
5. 看一看表格中显示的样子。FlowAssert 读取的是每个单元格在表格中显示的文本，按表格的区域设置格式化：显示为 `2026-01-02` 的日期读到的就是 `2026-01-02`，显示为 `1,234.50` 的数字读到的就是 `1,234.50`。在 `--config` 文件中为它选一条合适的规则来和目标比较，例如 `date:%Y-%m-%d` 或 `digits`。

试用时请使用合成数据。给维护者的实测计划（[scripts/dev/sheets_live_check.md](../../scripts/dev/sheets_live_check.md)，英文）中有一个可以照着建立的小型合成表格。

## 3. 获取只读凭据

FlowAssert 不会帮你登录。你通过一个环境变量给它一个凭据，从不作为选项、也从不放在文件里；它只用这个凭据发送三个 `GET` 请求：两个发给 Google 云端硬盘读取文件版本，一个发给 Google Sheets API 读取值。它从不打印、保存或写出凭据。

凭据有两种，选择一种：

- **OAuth 访问令牌**，放在 `FLOWASSERT_SHEETS_TOKEN` 中，适用于你的 Google 账号能打开的表格。只授予只读权限范围：读取值用 `https://www.googleapis.com/auth/spreadsheets.readonly`，读取版本用 `https://www.googleapis.com/auth/drive.metadata.readonly`。在签发令牌的工具中（例如 Google 的 OAuth 2.0 Playground 或 `gcloud` 命令行工具）找到选择权限范围的地方。访问令牌过一段时间就会过期；FlowAssert 把过期的令牌作为拒绝（HTTP 401）报告，不会刷新它。
- **API 密钥**，放在 `FLOWASSERT_SHEETS_API_KEY` 中，只适用于共享为“知道链接的人可查看”的表格。API 密钥属于一个 Google Cloud 项目，这个项目中要启用 Google Sheets API（读取版本还需要 Google Drive API）。创建密钥时，找到把密钥限制为只能用于这些 API 的设置，并使用它。

没有云端硬盘权限范围的令牌，或者所在项目没有启用 Drive API 的密钥，无法读取版本。这时请加上 `--skip-source-revision`：核对会继续，报告会写明这次读取无法对应到某个版本。

**没有试过的步骤。** 创建 Google Cloud 项目、启用这两个 API、创建并限制 API 密钥、签发带指定权限范围的令牌，这些步骤在编写这份指南时都没有试过；因为没有看到过相关页面，这里也不逐个描述。创建账号或项目前，请先查看 Google 的服务条款，确认谁可以持有账号。

设置变量时，不要让它留在命令历史里，例如在 zsh 或 bash 中：

```sh
read -rs FLOWASSERT_SHEETS_TOKEN && export FLOWASSERT_SHEETS_TOKEN
```

粘贴令牌后按回车，屏幕上不会显示任何内容。永远不要把凭据粘贴到 Issue、聊天、仓库中的文件或报告里。

## 4. 运行一次核对

一个合成示例。表格中的工作表 `Leads` 内容如下：

| lead_id | phone | email |
| --- | --- | --- |
| LEAD-001 | +1 555 0100 001 | lead001@example.test |
| LEAD-002 | +1 555 0100 002 | lead002@example.test |
| LEAD-003 | +1 555 0100 003 | lead003@example.test |

目标导出文件 `crm-export.csv`：

```text
lead_id,phone,hs_email
LEAD-001,+1 555 0100 001,lead001@example.test
LEAD-002,+1 555 0100 002,lead002@example.test
LEAD-003,+1 555 0100 003,lead003@example.test
```

命令如下，把合成的 ID 换成你的表格 ID（表格地址中 `/d/` 后面的那一长串）：

```sh
flowassert-verify \
  --source-sheet 1SyntheticSpreadsheet-FlowAssert_0001 \
  --source-range 'Leads!A1:C' \
  --destination crm-export.csv \
  --key lead_id --field phone --field email:hs_email \
  --source-complete --destination-complete \
  --json report.json --html report.html
```

只有当范围确实是完整的一批时，才加 `--source-complete`；只有当导出确实覆盖整个对象时，才加 `--destination-complete`（见第 6 节）。

## 5. 阅读结果

下面是这条命令针对合成表格的输出，来自黄金样例 `offline/golden-sheets/sheet-verified`（针对本地仿制服务运行，时间是固定的）：

```text
Verified: 3 rows of 3
Verified 3 · Mismatch 0 · Unverified 0
Source read by FlowAssert from Google Sheets: spreadsheet 1SyntheticSpreadsheet-FlowAssert_0001, range Leads!A1:C1000, at 2000-01-01T00:00:00Z.
Drive version 57 before and after the values were read.
Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.
```

- 前两行的读法和两个文件时一样（见[第一次核对指南](first-check.zh-CN.md#4-运行核对阅读结果并使用退出码)）。
- `Source read by FlowAssert from Google Sheets` 写明了表格、API 所说读取的范围（`Leads!A1:C1000`：请求的范围，补上了工作表的最后一行）以及时间。
- `Drive version 57 before and after the values were read.` 表示在读取之前和之后，Google 云端硬盘没有记录到文件的改动。如果这一行是 `The read cannot be tied to a revision: ...`，它说明了为什么没有版本：你加了 `--skip-source-revision`，或者云端硬盘没有返回版本。
- 如果表格在读取期间发生变化，核对会被拒绝（“the sheet changed while it was read”）。再运行一次即可。

JSON 报告的 `schema_version` 是 2，读取情况记录在 `inputs.source_sheet` 中（见[报告格式](../report-format.zh-CN.md#来自-google-表格来源的报告)）。网页界面的“保存的报告”页面可以导入它，会显示这些行是从哪里读取的，并且只会把它与同一个表格同一个范围的另一次读取进行比较。被拒绝的核对只输出一行：关于表格的每条消息，见[核对被拒绝时](refusals.zh-CN.md#读取-google-表格范围)。

## 6. 哪些仍然是你的声明

| 声明 | 选项 | 读取表格能说明它吗？ |
| --- | --- | --- |
| 范围是完整的一批 | `--source-complete` | **不能。** FlowAssert 看到的是范围中的行，而不是应该在那里的记录。像检查文件一样检查它：把行数和管理这一批的系统显示的总数对比，并用 `--source-count` 传入这个总数 |
| 导出覆盖整个对象 | `--destination-complete` | 不能：目标仍是你导出的文件 |
| 表格是正确的来源，其中的值是真实的 | — | 不能 |

错误的声明会得出错误的结果。读取表格不会改变这一点。

## 7. 用完之后：清除凭据

用完后，从命令行环境中删除变量（`unset FLOWASSERT_SHEETS_TOKEN` 或 `unset FLOWASSERT_SHEETS_API_KEY`）。然后撤销你创建的内容：在所在的 Google Cloud 项目中删除 API 密钥，或者在 Google 账号的安全设置中移除你授予的访问权限，这会让令牌失效（找到有访问权限的第三方应用或连接的列表）。令牌过期后也会自动失效。这些步骤在编写这份指南时都没有试过。
