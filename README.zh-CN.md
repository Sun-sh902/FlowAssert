# FlowAssert

[English](README.md) | 简体中文

**工作流显示成功了，但预期的业务数据真的到了吗？**

FlowAssert 对比“应该存在什么”和“目标系统里实际有什么”，再把每条记录判定为 **Verified**、**Mismatch**、**Pending** 或 **Unverified**。它的核心规则是：证据不足时，绝不说 Verified。

**在线试用：** <https://sun-sh902.github.io/FlowAssert/> 在浏览器里核对两个 CSV 文件，页面上有示例文件，你的文件不会离开电脑。详见[在浏览器中核对](#在浏览器中核对)。

> [!IMPORTANT]
> **这是由一位维护者维护的早期项目。** 它还不是生产软件。
> Service 和 UI 只处理 5 个审核过的合成样例。它们没有连接真实的 n8n、HubSpot 或 Google Sheets，不接收凭据，也不采集外部数据。哈希和本地回执只能说明内部一致，不能证明任何数据是真实的。

许可证：[Apache 2.0](LICENSE)

![FlowAssert 总览页：5 个合成样例的实时结果和归档结果](docs/readme/zh/overview-light.png)

界面支持简体中文：在左侧栏底部切换 `EN` 和 `中文` 即可。本文的截图来自中文界面。

| 英文 | 中文界面 |
| --- | --- |
| Verified | 已验证 |
| Mismatch | 不一致 |
| Pending | 待定 |
| Unverified | 未验证 |

下文保留这四个英文术语，以及接口和代码中的英文名称，方便与代码对照。如有出入，以[英文版](README.md)为准。

## 目录

- [要解决的问题](#要解决的问题)
- [截图](#截图)
- [已有和没有的内容](#已有和没有的内容)
- [快速开始：比较两个 CSV 文件](#快速开始比较两个-csv-文件)
- [在浏览器中核对](#在浏览器中核对)
- [在 GitHub Actions 中使用](#在-github-actions-中使用)
- [在 n8n 中使用](#在-n8n-中使用)
- [快速开始：运行 Service 和 UI](#快速开始运行-service-和-ui)
- [验证如何工作](#验证如何工作)
- [架构](#架构)
- [后端](#后端)
- [前端](#前端)
- [测试](#测试)
- [安全模型](#安全模型)
- [已知问题](#已知问题)
- [如何扩展](#如何扩展)
- [仓库结构](#仓库结构)
- [项目历史](#项目历史)
- [术语表](#术语表)
- [路线图](#路线图)
- [参与贡献](#参与贡献)
- [许可证](#许可证)

## 要解决的问题

自动化运行成功，不代表业务结果正确。工作流可能写错值、漏掉线索或创建重复记录，却依然显示成功。

假设一个工作流要同步 100 条线索：97 条匹配，2 条的值错误，1 条在允许的时间窗口之后仍然缺失。如实的报告应该是 97 条 Verified、3 条 Mismatch，而不是“100 条成功”。如果检查看不到足够多的目标数据，那条记录应该是 Unverified，而不是缺失。

预期用户是独立自动化开发者和小型工作室。这个用户画像从未得到验证：没有做过用户访谈，也没有测试过真实账号。

## 截图

下面的页面都来自本地运行，显示的是审核过的合成数据。日期和时间要么是合成的，要么是那次本地运行的时间。

### 总览

首页先用文字说明结果，再把每个样例的实时结果和最新归档结果并排显示。“实时与归档对比”比较的是 Service 的两次输出，它是诊断信息，不是判定。

| 浅色 | 深色 |
| --- | --- |
| ![浅色主题的总览页](docs/readme/zh/overview-light.png) | ![深色主题的总览页](docs/readme/zh/overview-dark.png) |

### 验证

所有样例集中在一页，采集和准入与实时判定、归档判定分开显示。对审核样例来说，这两列都显示“未实现”，这是有意为之。

![Verifications 列表](docs/readme/zh/verifications.png)

### 一次 Mismatch：从结论到证据

`SPEC-002` 的页面从上到下依次是：判定、判定过程、四个状态轴、匹配的归档条目、记录比较、证据支持的内容、仍然未知的内容、时间线，以及浏览器重新计算哈希的证据引用。

<details>
<summary>展开完整页面</summary>

![一次 Mismatch 的完整详情页](docs/readme/zh/detail-mismatch.png)

</details>

### 每行都通过，批次仍是 Unverified

`SPEC-005` 正是这个产品存在的理由。12 条可见记录全部匹配，但来源总量未知，所以 FlowAssert 不会把这个批次判定为 Verified。

![SPEC-005 详情页：12 条记录匹配，批次未验证](docs/readme/zh/detail-cohort-unverified.png)

### 历史

归档的评估按从新到旧排列，每条都有自己的完整性声明。归档时间和评估时间分开记录。

![History 列表](docs/readme/zh/history.png)

### 演示页面

规则、连接和设置都是 Mock 页面，页面上也写明了这一点。规则草稿只留在浏览器里，不会执行。

![Rules 演示页面](docs/readme/zh/rules-demo.png)

### 窄屏

工作区页面用 200 格响应式矩阵检查过，覆盖两种主题。

<img src="docs/readme/zh/overview-mobile.png" alt="手机宽度下的深色总览页" width="320">

## 已有和没有的内容

| 部分 | 状态 |
| --- | --- |
| 离线 CSV 核对(`offline/`) | 可用于你自己的本地文件 |
| 浏览器中的 CSV 核对(`ui/`、`#/check`) | 可用于你自己的本地文件，不上传任何内容 |
| GitHub Action(`action.yml`) | 在工作流中对文件运行离线核对，不安装也不下载任何东西 |
| n8n 示例(`examples/n8n/`) | 在 Code 节点中运行浏览器核对，只在自托管的 n8n 上测试过 |
| 带四种结果状态的固定版 Evaluator | 可用于 5 个合成样例 |
| 只读 HTTP Service | 可在本地运行 |
| 只增不改的 SQLite 历史归档 | 可在本地运行，只能归档审核过的样例 |
| 查看结果、证据和历史的 React UI | 可连接本地 Service 运行 |
| 本地执行回执 | 实验性质，在这个 Service 之外不能证明任何事 |
| Connections、Rules、Settings 页面 | Mock 演示，不连接也不执行任何东西 |
| Capture runs 页面 | 未实现 |
| n8n、HubSpot 或 Google Sheets 连接器 | 不存在 |
| 从 UI 发起验证 | 不存在 |
| 登录、多用户、部署 | 不存在 |
| 用户验证 | 从未做过 |

## 快速开始：比较两个 CSV 文件

只需要 Python 3.9 或更高版本。它只读取本地文件，不发任何网络请求。

```sh
git clone https://github.com/Sun-sh902/FlowAssert.git
cd FlowAssert
python3 -m pip install ./offline

flowassert-verify \
  --source offline/examples/source.csv \
  --destination offline/examples/destination.csv \
  --key external_id \
  --field phone \
  --field email:hs_email \
  --source-complete --destination-complete
```

结果如下，退出码为 1:

```text
Mismatch: 4 rows of 4
Verified 1 · Mismatch 3 · Unverified 0
  record 2 SYN-002: Mismatch
    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')
  record 3 SYN-003: Mismatch
    existence fail: key not found in stated complete destination
    ...
  record 4 SYN-004: Mismatch
    uniqueness fail: more than one destination row carries this key
    ...
```

不安装也可以运行：把命令换成 `python3 offline/verify.py`，选项相同。也可以直接从 GitHub 安装：

```sh
python3 -m pip install "git+https://github.com/Sun-sh902/FlowAssert.git#subdirectory=offline"
```

`email:hs_email` 表示这一列在来源文件里叫 `email`，在目标文件里叫 `hs_email`。

| 选项 | 含义 |
| --- | --- |
| `--key COL[:COL]` | 稳定的记录键，未使用 `--mapping` 或 `--config` 时必填 |
| `--field COL[:COL]` | 要精确比较的字段，可重复，未使用 `--mapping` 或 `--config` 时至少一个 |
| `--mapping FILE` | 指定 `key` 和 `fields` 列名对的 UTF-8 JSON 文件，支持含 `:` 的列名，始终精确比较 |
| `--config FILE` | 指定 `key`、带比较规则的 `fields` 和 `scope` 的 UTF-8 JSON 配置文件，不能与 `--mapping`、`--key`、`--field`、`--scope` 同时使用 |
| `--scope source\|exact` | `source`（默认）：逐条检查来源记录。`exact`：同时列出目标中有、来源中没有的键 |
| `--source-complete` | 你声明来源文件就是整个批次 |
| `--destination-complete` | 你声明导出文件覆盖了整个对象 |
| `--source-count N` | 你声明在原系统里看到的来源总数；与文件行数不符时不能得到 Verified |
| `--destination-count N` | 你声明在原系统里看到的目标总数；与文件行数不符时缺失和重复都只能是未知 |
| `--allow-identical-content` | 两份不同文件的内容完全相同时允许继续，并在报告 `inputs` 中记录 |
| `--source-encoding NAME` | `utf-8`（默认）、`utf-16` 或 `gb18030` |
| `--destination-encoding NAME` | `utf-8`（默认）、`utf-16` 或 `gb18030` |
| `--max-bytes N` | 读取前拒绝超过 `N` 字节的文件（默认 `209715200`，即 200 MiB） |
| `--max-rows N` | 读取时拒绝超过 `N` 行的 CSV 文件（默认 `1000000`） |
| `--max-details N` | 摘要中最多打印 `N` 条非 Verified 记录，`0` 表示不打印（默认 `50`） |
| `--json PATH` | 写入含文件摘要的完整报告，不会覆盖已有文件。[格式说明（英文）](docs/report-format.md) |
| `--details problems\|all` | `problems`（默认）：`--json` 中 Verified 记录只保留键、行号和状态。`all`：保留每条记录的全部明细 |
| `--html PATH` | 写入一个独立的 HTML 报告，不会覆盖已有文件 |
| `--redact-values` | 输出中不显示键和比较值 |
| `--version` | 显示版本 |

| 退出码 | 含义 |
| --- | --- |
| 0 | Verified |
| 1 | Mismatch |
| 3 | Unverified |
| 2 | 输入被拒绝，例如文件格式错误或缺少列 |
| 4 | 内部故障，没有得出任何结论 |

核对被拒绝时，会用一行说明问题。[核对被拒绝时](docs/guides/refusals.zh-CN.md)逐条解释每条消息和处理方法。

这两个完整性选项很重要。不加 `--source-complete`，批次不可能是 Verified。不加 `--destination-complete`，缺失和重复都只能是未知。FlowAssert 不会核实这些声明，所以声明错了，结果也会错。如果知道原系统里的总数，再加上 `--source-count` 和 `--destination-count`：总数与文件不符时，对应的完整性声明不再成立。总数相符也不能证明文件完整。

默认是精确比较：空格、大小写和电话格式的差异都算不同。`--config` 配置文件可以为每个字段选择 `trim`、`casefold`、`digits` 或 `date:FORMAT`，规则不会自动推断。空单元格判为 Unverified，因为 CSV 无法说明它为什么是空的。详情见 [offline/README.md](offline/README.md)。

## 在浏览器中核对

同样的核对也可以在网页界面里完成，不用命令行：打开 **CSV 核对** 页面，选择两个文件、键列、要比较的字段和每个字段的规则，声明你知道的前提，然后点“检查”。结果、摘要以及 JSON 和 HTML 报告都与命令行逐字节相同，只是每项前提的来源记为 `browser form`（浏览器表单）。

**文件留在你的电脑上。** 文件在浏览器里（一个 Web Worker 中）读取，不上传任何内容：从选择文件到下载报告，页面不发出任何网络请求。你的选择和声明都不会被保存，每次核对都要重新选择文件、重新声明前提。只有列和规则的选择可以保存为一个由你自己下载的配置文件。只有在你要求时，报告才会保存在浏览器中（见下文）。

- **在线演示：** <https://sun-sh902.github.io/FlowAssert/>。它的内容安全策略（CSP）禁止任何连接；需要本地 Service 的页面会写明“仅本地可用”。
- **本地运行：** `cd ui && npm ci && npm run dev`，然后打开 <http://127.0.0.1:5183/#/check>。页面上有示例文件。

与命令行的区别：

| | 浏览器 | 命令行 |
| --- | --- | --- |
| 日期格式 | 只支持 `%Y %m %d %H %M %S %f %z %b %B %y %p %I %j %%`，其他指令会被拒绝，并说明浏览器不支持 | 支持所有 `strptime` 指令 |
| Python 版本差异 | 按 Python 3.15：`%d` 必须配合年份指令，值中可以没有 `%z` | 取决于运行它的 Python |
| 列的选择 | 总是使用配置：报告记录 `config_file_sha256`、`obligation.rules`、`obligation.scope` 和两个编码 | `--key`/`--field`、`--mapping` 或 `--config` |
| 选项 | 默认上限（200 MiB、1,000,000 行）、`--details problems`、不隐去值 | 所有选项 |
| 两次选择同一个文件 | 两个选择的文件名、大小、修改时间和字节都相同时拒绝；浏览器不提供文件路径 | 路径指向同一文件时拒绝 |
| 内存 | 读取时整个文件留在内存中 | 来源只保留用到的列，目标逐行读取 |

浏览器核对按同一份规范实现，并与命令行对照测试：全部一致性样例、97 个逐字节比较的黄金样例，以及随机样例（10,000 个中 0 处差异）。它是第二个实现，出现差异就是缺陷，欢迎报告。

### 已保存的报告和两次结果对比

从 0.5.0 开始，**已保存的报告**页面（`#/check/reports`）可以把 JSON 报告保存在这个浏览器中，并比较其中两份。

- **保存什么，只在你要求时保存。** 核对之后，点“在这个浏览器中保存这份报告”会保存这一份 JSON 报告。也可以导入命令行、GitHub Action 或 n8n 写出的 JSON 报告；不是有效 FlowAssert 报告的文件会被拒绝，什么都不保存。每次核对都只有在你点按钮时才保存，没有任何设置会自动保存。CSV 文件从不保存。报告中包含各条记录的键和比较的值（用 `--redact-values` 写出的报告除外）。
- **保存在哪里。** 保存在页面所在站点的一个 IndexedDB 数据库 `flowassert-saved-reports` 中，属于这个浏览器配置文件。使用这个浏览器配置文件的任何人都能读取。不上传任何内容：保存、导入、列出、比较和删除都不发出请求。
- **删除。** 可以删除一份，也可以确认后全部删除；全部删除会删掉这个数据库。在浏览器中清除站点数据也会删除它。
- **前提从不复用。** 已保存的报告会显示为它声明的前提及其来源，但其中任何内容都不会填进 CSV 核对：每次核对都从什么都没选、什么都没声明开始。
- **比较。** 同一核对义务（键、字段、规则、范围和比较方式相同）的两份报告可以比较：哪些记录变成问题、不再是问题、仍是问题，哪些只在一份来源中，哪些无法按键匹配。两份报告声明的前提不同时，页面会在任何数量之前先说明，因为变化可能来自前提而不是数据。比较只说明每份报告记录了什么，不是新的结论。已脱敏的报告、不同核对义务的报告和同一份报告两次都会被拒绝。规范见[比较两份报告](docs/report-comparison.md)（英文）。
- **未经认证。** 导入的报告未经认证，比较两份报告也不会认证其中任何一份。页面在显示报告的每个地方都会说明这一点。
- **在线演示。** 它的站点 `sun-sh902.github.io` 由该 GitHub 账号的所有 GitHub Pages 站点共用，所以其中另一个站点可能读取保存在那里的报告。在线演示中仍可保存，页面会说明这一点。不想让其他站点读取的报告，请在本地运行界面。

## 在 GitHub Actions 中使用

本仓库同时也是一个 GitHub Action。它在你的工作流里用 runner 上的 Python 3.9 或更高版本，从 Action 自带的
`offline/` 运行离线核对：运行时不安装、也不下载任何东西。步骤根据结果成功或失败。

```yaml
name: Check the nightly export
on:
  schedule:
    - cron: "0 6 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - uses: Sun-sh902/FlowAssert@v0.4.0
        id: flowassert
        with:
          source: exports/source.csv
          destination: exports/destination.csv
          key: external_id
          fields: |
            phone
            email:hs_email
```

每个输入对应 `flowassert-verify` 的一个选项，名称相同，只是去掉 `--`（`fields` 每行一个 `--field`）。输入为空时
不传这个选项，所以核对程序自己的默认值和拒绝规则照常生效。完整列表见 [action.yml](action.yml)。

**示例特意没有写前提。** `source-complete`、`destination-complete`、`source-count`、`destination-count` 和
`allow-identical-content` 是你对文件的声明，FlowAssert 无法核实，所以一项也不会默认。只有当它们对每次运行都成立时，
才加上 `source-complete: "true"` 等。没有 `source-complete`，批次永远不会是 Verified。布尔输入只接受 `"true"` 或
`"false"`。

| 输入 | 默认值 | 含义 |
| --- | --- | --- |
| `fail-on` | `not-verified` | `not-verified`：只有 Verified 时步骤才成功。`mismatch`：Verified 和 Unverified 时成功，Mismatch 时失败。输入被拒绝或内部失败（退出码 2 或 4）时，步骤总是失败 |
| `show-records` | `"false"` | **日志和 job summary 常常是公开的**，例如公开仓库。默认只打印和汇总状态、计数、前提和限制说明，不含任何键或字段值。`"true"` 时还会打印核对程序的记录行，其中有值 |
| `json`、`html` | 空 | 把 JSON 或 HTML 报告写到这个新文件。除非 `redact-values` 为 `"true"`，报告中有键和比较的值；只在你指定的位置写入 |

输出：`state`（`Verified`、`Mismatch`、`Unverified`、`refused` 或 `failed`）、`exit-code`，以及 `json` 和
`html`（写入时为报告路径）。对同样的参数，步骤的摘要和报告与 `flowassert-verify` 完全相同。
`.github/workflows/action-self-test.yml` 在 Linux、macOS 和 Windows 上运行这个 Action。

## 在 n8n 中使用

[examples/n8n/](examples/n8n/) 是一个 n8n 工作流，在 **Code 节点**中运行核对，不使用 Execute Command 节点（从
n8n 2.0 起默认禁用，n8n Cloud 也不提供）。Code 节点中是打包成一个脚本的浏览器核对，所以对同样的文件和前提，它给出
与命令行相同的结果、摘要和 JSON 报告；每项前提的 `origin` 是 `n8n Code node`。文件内容留在 n8n 实例中：节点不发出
请求，也不运行命令。节点配置区中的每项前提默认都不声明。它只在自托管的 n8n 2.46.4 上测试过，没有在 n8n Cloud 上
测试；设置方法和对 Code 节点的实测结果见[示例的说明](examples/n8n/README.zh-CN.md)。

打包的脚本是 `flowassert-check.js`，用 `cd ui && npm run build:lib` 构建（CI 每次运行都会构建，准备附在每个版本的
发布中）。它只定义一个全局变量 `FlowAssert`，包含 `checkCsv` 和 `VERSION`，不导入任何东西，也不发出请求；其他
JavaScript 环境也可以这样调用（见 `ui/src/offline/api.ts`）。

## 快速开始：运行 Service 和 UI

### 环境要求

| 工具 | 版本 |
| --- | --- |
| Python | 3.14，用于 Service |
| 系统 Python 3 | `/usr/bin/python3`，用于隔离的只读检查 |
| Node.js | 22 系列的 22.12+、24 或 26+ |
| npm、git、lsof、curl | 较新版本即可 |
| Google Chrome 和 Playwright WebKit | 仅浏览器测试需要 |

项目在 Apple 芯片的 macOS 上开发和测试，其他平台未测试。

### 安装

```sh
scripts/dev/bootstrap.sh
```

它会按锁文件安装固定版本的依赖，校验固定的文件身份，并创建合成归档。每个阶段失败时都会给出名称和日志。如果 `PATH` 里没有 `python3.14`，可以这样指定：

```sh
FA_PYTHON=/path/to/python3.14 scripts/dev/bootstrap.sh
```

### 运行

在一个终端里运行：

```sh
scripts/dev/service.sh
```

在另一个终端里运行：

```sh
cd ui
npm run dev
```

打开 <http://127.0.0.1:5183>。按 Ctrl-C 可以停止任一进程。Service 停止后，页面显示 *Service unavailable*，绝不会换成演示数据。

用 `FA_STATE` 选择其他归档：

| 状态 | 内容 |
| --- | --- |
| `dev-main`（默认） | 10 条归档评估：5 个样例，2 批 |
| `dev-single` | 5 条归档评估，每个样例一条 |
| `dev-empty` | 有效的空归档 |
| `dev-run-bound` | 6 条归档评估，最新的 `SPEC-001` 带本地回执 |

```sh
FA_STATE=dev-run-bound scripts/dev/service.sh
```

### 页面

| 页面 | 地址 | 数据来源 |
| --- | --- | --- |
| Overview | `#/` | Service |
| Verifications | `#/verifications` | Service |
| 验证详情和证据 | `#/local/verifications/SPEC-001` | Service |
| 按精确 ID 查询详情 | `#/local/verification-lookup?verification_id=SPEC-001` | Service |
| History | `#/local/history` | Service 归档 |
| Capture runs | `#/capture` | 未实现 |
| Connections、Rules、Settings | `#/connections`、`#/rules`、`#/settings` | Mock |
| Demo | `#/demo`、`#/demo/verifications` | Mock |
| Interface states | `#/states` | 模拟 |

在 UI 里，**live** 指 Service 启动时根据样例算出的结果，并不是对外部系统的最新观测。

## 验证如何工作

### 四种状态

| 状态 | 含义 | 该做什么 |
| --- | --- | --- |
| Verified | 每条必需规则都有足够证据，并且通过 | 需要时查看证据 |
| Mismatch | 至少一条必需规则被证明不成立 | 调查差异 |
| Pending | 在明确的等待窗口内，暂时没有结论 | 等待或重新观测 |
| Unverified | 证据或配置不足 | 补上缺失的内容 |

记录取第一个符合条件的状态：

1. 有规则失败：**Mismatch**。
2. 所有规则通过：**Verified**。
3. 在有效窗口内仍可能有结论：**Pending**。
4. 其他情况：**Unverified**。

Pending 不代表成功。Unverified 不代表已确认失败。请求失败则两者都不是：它根本没有判定。

### 记录结果和批次结果是分开的

批次的确定性可能低于单条记录。如果每一行都验证通过，但来源总量未知，批次就是 **Unverified**，因为无法排除那些从未列出的行。批次里只要有 Mismatch，整个批次就是 Mismatch。

### 规则

固定版 Evaluator(`service/vendor/model.py`)使用这些规则：

| 规则 | 通过条件 |
| --- | --- |
| `existence` | 有可靠的目标记录带有这个键 |
| `uniqueness` | 在覆盖完整的前提下，恰好一条记录带有这个键 |
| `phone` | 值完全一致 |
| `existed_by_deadline` | 永远不会通过：当前读取无法证明过去。除非策略明确关闭，否则必需 |
| `workflow_execution` | 永远不会通过：这个方案没有执行证据。除非策略明确关闭，否则必需 |

每个前提都必须明确为真。缺失或格式错误的值绝不允许得出结论。前提包括来源独立性、清单、规则批准、身份可靠性、访问权限、新鲜度、时钟可信度、分页和目标覆盖度。

规则的不对称是有意设计的。只要看到一个错误的值，哪怕是部分读取，也能证明 Mismatch。而要证明记录不存在或唯一，必须有完整的证据。

| 对一个 Verified 样例的改动 | 结果 |
| --- | --- |
| 部分读取，值相同 | Unverified |
| 部分读取，值不同 | Mismatch |
| 超过截止时间后不存在，覆盖完整 | Mismatch |
| 在窗口内不存在 | Pending |
| 不存在，但“不存在”的证据不可靠 | Unverified |
| 两条记录使用同一个键 | Mismatch，不会挑选其中一条比较 |
| 观测时钟不可信 | Unverified |
| 规则未批准 | Unverified |

### 五个审核样例

| ID | 样例 | 行数 | 批次结果 | 原因 |
| --- | --- | --- | --- | --- |
| `SPEC-001` | `A-verified` | 1 | Verified | 所有规则通过 |
| `SPEC-002` | `B-mismatch` | 1 | Mismatch | 电话不同 |
| `SPEC-003` | `C-pending` | 1 | Pending | 尚不可见，窗口仍开放 |
| `SPEC-004` | `D-unverified` | 1 | Unverified | 目标系统访问被拒绝 |
| `SPEC-005` | `E-row-verified-cohort-unverified` | 12 | Unverified | 12 条记录 Verified，来源总量未知 |

### Verified 到底声明了什么

这个主张刻意收窄为：在记录的观测时点，目标系统证据满足针对已声明来源批次配置的规则。

它不声称 n8n 执行过写入，不声称来源本身真实，不声称现实中的每条线索都已列出，不声称不存在语义重复，也不声称目标系统之后会一直正确。

## 架构

```text
Browser (React, hash routes)
   │  relative /api/v1/...  GET only
   ▼
Vite API gate (dev and preview only; exact route and query allowlist)
   │
   ▼
FastAPI Service on 127.0.0.1:8765
   ├─ Catalog: five results computed at startup, held in memory
   └─ ArchiveStore: append-only SQLite
          ▲ written only by local commands
archive_cli.py, seed_run_bound.py ──> pinned Evaluator

flowassert-verify (offline/)   separate; local CSV files only
```

HTTP 层没有写接口。UI 的静态构建没有门禁，所以其中的 Service 页面会显示 *Service unavailable*。

两个 Evaluator 彼此独立。Service 和 UI 使用冻结的 Evaluator v1，其摘要已固定。`offline/` 使用 Evaluator v2，它支持选定字段，但没有经过独立审查。测试会检查两者在共同样例上的结果一致。

## 后端

技术栈是 Python 3.14、FastAPI、Pydantic、jsonschema 和 SQLite，源码在 `service/`。

### 模块

| 文件 | 作用 |
| --- | --- |
| `app/main.py` | 应用入口、冻结的 Detail 和 Evidence 路由、错误信封、边界中间件 |
| `app/service.py` | Catalog、启动时评估、带签名的证据分页 |
| `app/adapter.py` | 调用固定版 Evaluator，并检查输入未被修改 |
| `app/identity.py` | 规范 JSON、摘要和固定的源文件身份校验 |
| `app/validation.py` | 冻结 Schema 校验和跨字段不变量 |
| `app/models.py` | 由冻结的 OpenAPI 生成的 Pydantic 模型 |
| `app/history_api.py` | History 路由 |
| `app/history_store.py` | SQLite 归档、发布、完整性检查和准入 |
| `app/history_security.py` | 私有文件、签名密钥和历史游标 |
| `app/verification_lookup.py` | 精确 ID 查询路由 |
| `app/local_boundary.py` | Host 和 Origin 检查 |
| `app/execution_collector.py` | 实验性的独立进程运行和 HMAC 回执 |
| `app/admission_models.py`、`app/admission_serialization.py` | 实验性状态类型及其公开形式 |
| `archive_cli.py` | 本地 `init`、`seed` 和 `check` 命令 |
| `run_history.py` | 受支持的启动入口，包含全部路由 |
| `run.py` | 冻结的 Phase 1 启动入口，包含两个路由 |

### HTTP API

所有路由都是 GET，而且只在回环地址上提供。

| 路由 | 用途 |
| --- | --- |
| `/api/v1/verifications/{id}` | 单个结果。`?phase3b=true` 会附加采集和准入字段 |
| `/api/v1/verifications/{id}/evidence` | 该结果的证据，分页 |
| `/api/v1/verification-lookup?verification_id=` | 同样的 Detail,ID 作为查询数据 |
| `/api/v1/verification-evidence?verification_id=` | 同样的证据，ID 作为查询数据 |
| `/api/v1/history` | 归档列表，冻结格式 |
| `/api/v1/history/{history_id}` | 单条归档评估，冻结格式 |
| `/api/v1/history/{history_id}/evidence` | 该条的归档证据 |
| `/api/v1/history/verifications` | 带实验性状态字段的归档列表 |
| `/api/v1/history/verifications/{history_id}` | 带这些字段的归档评估 |
| `/api/v1/history/verifications/{history_id}/evidence` | 归档证据，UI 门禁不转发这个路由 |

契约在 [`service/contracts/`](service/contracts/)。错误使用统一的信封：

```json
{
  "error": {
    "code": "run_not_found",
    "message": "Offline request could not be completed.",
    "request_id": "…",
    "retryable": false,
    "details": []
  }
}
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 查询错误，或游标被伪造、不匹配 |
| 403 | Host 或 Origin 被拒绝 |
| 404 | 未找到 |
| 409 | 快照冲突或已过期 |
| 422 | 参数无效 |
| 503 | 源文件身份、完整性或归档故障 |

### 快照和游标

| 命名空间 | 示例 | 生命周期 |
| --- | --- | --- |
| Catalog | `snapshot-…` | 每次 Service 启动都会变，因为包含执行时间 |
| History | `history-snapshot_…` | 永久，由归档内容派生 |
| History list | `list_…` | 把一个列表视图固定在某个高水位 |

游标经过 HMAC 签名，并绑定到查询范围。伪造的游标返回 400。游标真实但快照已不存在时返回 409。

### 归档

`service/migrations/001.sql` 定义了 `archive_meta`、`archives`、`records`、`evidence` 和 `seed_sets`。

- 触发器阻止修改已发布内容，也阻止任何删除。
- 发布在一个事务内从 `BUILDING` 变为 `PUBLISHED`，并先重放 Evaluator。
- `history_id` 是 `hist_` 加上规范候选内容的 SHA-256。
- 每次读取都检查文件安全、Schema、内容摘要，以及记录和证据的关联。
- 检查失败时返回 503 并带上完整性结果，绝不返回部分数据。

归档候选必须在语义上等于审核样例，所以这 5 个样例之外的内容都无法归档。

### 实验性回执

`execution_collector.py` 在独立进程里运行 Evaluator，并签发回执，绑定输入、结果、Evaluator 摘要、上下文和完整候选内容。只有 `scripts/dev/seed_run_bound.py` 调用它，HTTP 路由不会调用。

`CAPTURED_COMPLETE` 和 `ADMITTED_RUN_BOUND` 只表示这些本地检查通过了。密钥在同一台机器上，所以回执无法证明采集过外部数据。live 读取总是报告 *Not implemented*。详见 [EXPERIMENTAL_ADMISSION_BOUNDARY.md](service/docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md)。

## 前端

技术栈是 React 19、TypeScript、Vite 和 Tailwind，源码在 `ui/`。设计系统名为 Evidence Atelier([DESIGN_SYSTEM.md](ui/docs/DESIGN_SYSTEM.md))。

前端从不计算判定，只负责接收、校验和展示 Service 报告的内容。

### 数据流

```text
exchange       GET only, no credentials, no redirects, time and size limits
  ▼
decode         frozen schema, then cross-field checks; refuse the whole body on any failure
  ▼
adapter        wire data to view models
  ▼
hook           request order, cancellation, snapshot pinning
  ▼
page
```

| 路径 | 作用 |
| --- | --- |
| `ui/server/localApiGate.ts` | dev 和 preview 环境的 API 白名单 |
| `ui/src/data/local/` | Service 数据源、解码、规范 JSON、ID 规则、证据链 |
| `ui/src/data/history/` | 归档数据源、解码、列表链 |
| `ui/src/data/workspace/` | 实时和归档结果对比 |
| `ui/src/data/contract/` | 线上类型和 Schema 的逐字副本 |
| `ui/src/domain/` | 视图模型、状态轴、完整性规则 |
| `ui/src/adapters/` | 线上数据转视图模型 |
| `ui/src/lib/` | 路由、读取生命周期 Hook、格式化 |
| `ui/src/pages/`、`ui/src/components/` | 界面 |
| `ui/src/mocks/` | 演示数据 |
| `ui/src/lab/` | 设计实验，不进入产品构建 |

### 分开的词表

这些词表严格分开，这样一类问题绝不会被报告成另一类。

| 词表 | 取值 | 回答的问题 |
| --- | --- | --- |
| 判定 | 4 种状态 | 业务结果是什么 |
| 读取状态 | 8 种状态，例如 `LOADING` 和 `SERVICE_UNAVAILABLE` | 这次读取情况如何 |
| 完整性 | `verified`、`failed`、`unverifiable`、`pending` | 内容与摘要是否一致 |
| 状态轴 | Capture、Admission、Archive、Verdict | 每一步发生了什么 |
| 对比 | 8 种状态，例如 `SAME_INPUT_AGREE` | 实时结果和归档结果是什么关系 |

所以 Service 停止时显示的是 `NO_VERDICT`，不是 Unverified。实时结果和归档结果不同只是诊断信息，不是 Mismatch。

### 界面语言

界面默认是英文，选择 `中文` 后保存在当前浏览器，并重新加载页面。

中文是展示层，代码在 `ui/src/i18n/`：词库按英文原文匹配，只翻译界面文字和无障碍标签。它不修改 Provider、解码器或视图模型里的数据。

以下内容始终保持原样：

- Evaluator 的理由原文和 Service 的保证声明
- ID、摘要、证据值和接口字段名
- 校验器给开发者看的技术诊断信息
- 合成姓名和公司名

### 完整性和读取行为

- 证据分页拼接后，必须与 Detail 列出的引用完全一致。重复、缺失、乱序和游标循环都会被拒绝。
- 浏览器通过无损解析还原 Python 的规范 JSON，再重新计算 SHA-256。还原不了时结果是 `not_checkable`，绝不算通过。
- 单调时钟读数保留为十进制文本，因为它可能超过 JavaScript 的安全整数范围。
- 没有轮询、缓存和自动重试。实时读取最多同时进行两个，迟到的响应会被丢弃。

摘要一致只说明同一个 Service 给出的两个值相符，不能证明任何来源。

## 测试

| 层 | 工具 | 范围 |
| --- | --- | --- |
| 后端 | pytest | 300 多个测试，覆盖路由、归档、游标、回执和失败路径 |
| 脚本和离线核对 | pytest | 开发工具、CSV 核对，以及与 Evaluator v1 的一致性 |
| 前端 | Vitest | 1800 多个测试，包括契约漂移、恶意响应和中文界面 |
| 浏览器 | Playwright | Chrome 和 WebKit，覆盖工作区、历史、查询、门禁安全和无障碍 |
| 布局 | 自定义 | 200 格响应式矩阵和布局偏移检查 |
| 身份 | `check_identities.py` | 固定版 Evaluator、契约和后端源文件映射 |

运行一个测试配置：

```sh
scripts/dev/regression.sh --portable NEW-LABEL   # backend, identities, typecheck, lint, Vitest
scripts/dev/regression.sh --product NEW-LABEL    # plus every browser suite and the matrix
scripts/dev/regression.sh NEW-LABEL              # release: plus historical custody
```

浏览器配置需要先运行：

```sh
scripts/dev/bootstrap.sh --product-harness
cd ui && npx playwright install webkit
```

门禁状态有 PASS、FAIL、BLOCKED 和 NOT RUN。有 BLOCKED 门禁的运行退出码为 3，不算通过。测试数量会与 `scripts/dev/test-inventory.json` 比对，所以跳过或缺少测试都会让运行失败。结果写入 `.dev-runtime/regression/LABEL/`。

**在你的克隆里**，`protected-custody` 门禁会报告 BLOCKED，因为它要比较原机器上的同级文件夹，而这些文件夹没有公开。在其他环境里，`--product` 是最完整的可用检查。

## 安全模型

Service 是为本机单用户设计的。

| 控制措施 | 能做到 | 做不到 |
| --- | --- | --- |
| 回环绑定、Host 和 Origin 检查 | 限制浏览器 DNS 重绑定 | 认证本机其他进程 |
| API 门禁 | 只转发精确的 GET 路由 | 在静态构建或生产环境中生效 |
| 签名游标 | 阻止伪造分页 | 防范持有密钥的人 |
| 固定摘要 | 发现普通的源文件改动 | 阻止能同时修改代码和固定值的人 |
| SQLite 触发器和封存值 | 发现意外改动 | 阻止能写数据库的人；封存值没有密钥 |
| 离线守卫 | 在 Python 中审计 socket 连接 | 提供操作系统级隔离 |

不要把 Service 暴露到网络上，也不要向它输入真实客户数据。它没有身份认证。

发布前扫描过仓库历史，没有发现常见格式的密钥。这只是模式扫描，不是安全审计。请把这份代码视为未经审计。

## 已知问题

| 问题 | 详情 |
| --- | --- |
| 完整性声明 | 离线核对不会核实 `--source-complete` 和 `--destination-complete`，声明错了，结果也会错。`--source-count` 和 `--destination-count` 能发现一部分错误声明，但总数相符不能证明文件完整。浏览器核对中的两项声明同样如此 |
| 浏览器核对 | 支持的日期指令比命令行少，Python 版本之间有差异的地方按 Python 3.15 处理。见[在浏览器中核对](#在浏览器中核对) |
| 已保存的报告 | 保存在浏览器配置文件中，使用它的任何人都能读取；在线演示中，同一账号的其他 GitHub Pages 站点也能读取。导入的报告未经认证。见[已保存的报告和两次结果对比](#已保存的报告和两次结果对比) |
| n8n 示例 | 只在自托管的 n8n 2.46.4 上测试过，没有在 n8n Cloud 上测试。它用 Read/Write Files 节点读取文件，n8n 默认只允许读取 `~/.n8n-files` |
| Evaluator 状态 | 固定版本的标签是 `Round03.5 research — unapproved` |
| P3A-AUD-001 | `/api/v1/verifications/x%2Fevidence` 这样的旧路径可能指向错误资源。特殊 ID 请使用查询路由 |
| 归档封存值 | 使用无密钥哈希，能写数据库的人可以伪造一致的记录 |
| 浏览器测试 | 2026-10-31 有一次 `e2e-lookup` 失败始终没有查明原因，之后未复现 |
| Firefox | 未测试，有一个已知的测试框架缺陷没有修复 |
| 无障碍 | 只有自动化检查，没有做读屏测试 |
| 负载 | 没有做负载测试 |
| `/docs` | FastAPI 文档页已启用，打开时会从 CDN 加载资源 |
| 旧测试脚本 | `ui/scripts/phase2` 和 `ui/scripts/phase3a` 中的部分脚本含有原机器路径 |

2026-11-01 的 `npm audit` 和 Python 锁文件的 OSV 查询都没有报告已知漏洞。

## 如何扩展

Service 的设计是遇到未审核内容就失败，所以有几项限制是刻意写死的：

| 限制 | 位置 |
| --- | --- |
| 只比较 `phone`，只支持精确比较 | `service/vendor/model.py`、`app/models.py`、契约 |
| 5 个样例，`SPEC-00[1-5]` | `app/history_api.py`、`app/history_store.py`、`ui/src/data/local/config.ts` |
| 一个工作区，`ws-synthetic-01` | `app/validation.py`、UI 范围检查 |
| 只接受合成来源 | `app/validation.py`、历史契约 |
| 归档必须等于审核样例 | `app/history_store.py` 的 `validate_candidate` |
| 固定的 Evaluator 身份 | `app/identity.py`、`ui/src/data/local/config.ts` |

修改 `model.py` 后，Service 会一直返回 503，直到更新固定值，这是有意设计的。

接入真实数据的规划在 [docs/product-dev/final-version/](docs/product-dev/final-version/):[产品定义 v0.2](docs/product-dev/final-version/PRODUCT_DEFINITION_v0.2.md)和[验证计划](docs/product-dev/final-version/S1_VALIDATION_PLAN.md)。规划建议先做用户验证，并用只读沙箱账号测试，再写连接器。`offline/flowassert_offline/evaluator_v2.py` 是走向可配置规则的第一步。

## 仓库结构

```text
offline/                     可安装的 CSV 核对工具和 Evaluator v2
action.yml, action/          包装离线核对的 GitHub Action
examples/n8n/                带打包浏览器核对的 n8n 工作流
service/
  app/                       FastAPI 应用
  vendor/model.py            固定版 Evaluator v1
  contracts/                 OpenAPI 契约和审核示例
  fixtures/                  5 个合成样例
  migrations/                SQLite Schema
  tests/                     后端测试
  baseline/                  已验收的 Phase 1 文件，供测试使用
  evidence/                  文件身份基线
  docs/                      后端设计记录
ui/
  src/                       应用，中文词库在 src/i18n/
  server/                    开发环境 API 门禁
  e2e*/                      浏览器测试
  scripts/                   测试框架和证据工具
  docs/                      设计和集成说明
scripts/dev/                 安装、播种、运行、回归
docs/readme/                 README 使用的截图
docs/product-dev/            报告、截图、原始测试证据
```

`docs/product-dev/` 和 `service/evidence/` 大多是项目的原始开发记录，按原样公开。其中的路径指向原机器，在别处并不存在。改写这些路径会破坏记录的摘要。

建议的阅读起点：

| 主题 | 文档 |
| --- | --- |
| 项目结项 | [PROJECT_CLOSEOUT_20261101.md](docs/product-dev/final-version/PROJECT_CLOSEOUT_20261101.md) |
| 归档设计 | [ARCHIVE_INTEGRITY_MODEL.md](service/docs/phase3a/ARCHIVE_INTEGRITY_MODEL.md)、[SQLITE_SCHEMA.md](service/docs/phase3a/SQLITE_SCHEMA.md) |
| 快照和游标 | [SNAPSHOT_AND_CURSOR_MODEL.md](service/docs/phase3a/SNAPSHOT_AND_CURSOR_MODEL.md) |
| 后端决策 | [ARCHITECTURE_DECISIONS.md](service/docs/phase3a/ARCHITECTURE_DECISIONS.md) |
| 前端契约 | [frontend-provider-contract.md](service/contracts/frontend-provider-contract.md) |
| UI 结构 | [INFORMATION_ARCHITECTURE.md](ui/docs/INFORMATION_ARCHITECTURE.md) |
| 回归配置 | [REGRESSION_PROFILES.md](docs/product-dev/round-02-residual-closeout/REGRESSION_PROFILES.md) |

上面的文档都是英文。

## 项目历史

| 日期（2026 年） | 里程碑 |
| --- | --- |
| 10 月 13 日 | 产品定义、可行性研究、信任模型实验 |
| 10 月 16–17 日 | Evidence Atelier UI、集成规划、第一版 Service |
| 10 月 20 日 | Phase 3A 获 Owner 验收，仅限本地合成研究，带一项遗留例外 |
| 10 月 22–23 日 | Phase 3B 规划获验收，但不授权实施；产品第 1、2 轮 |
| 10 月 24–27 日 | Trusted Runner 准备工作；安装停在管理员登录一步 |
| 10 月 29 日 | 机器重装，从外置盘恢复 452,602 个文件 |
| 10 月 31 日 | 实验性本地回执和记录对账 |
| 11 月 1 日 | 完成离线 CSV 核对和中文界面，公开发布，继续维护 |

大量开发和审查工作由一位 Owner 主导，并使用了 AI 编程助手。从记录来看，文档里的“independent review”指独立的角色或会话，不代表第三方审计。

这个分支上的 Phase 3B 工作没有 Owner 验收，也没有独立审查。加固采集的另一批准备材料保存在私有位置，不在这个仓库里。

## 术语表

| 术语 | 含义 |
| --- | --- |
| Owner | 做产品和验收决定的人 |
| Evaluator | 产生判定的代码 |
| Cohort | 被检查的来源记录批次 |
| Source population | 批次里应该包含的全部记录 |
| Snapshot | 一组结果的固定身份 |
| Run-bound | 通过回执绑定到一次本地执行 |
| Custody | 证明受保护文件没有变化的证据 |
| Phase 3A、3B | 本地归档阶段；规划中的证据采集阶段 |
| G1 | 从未签发的实施授权 |
| M1 | Trusted Runner 里程碑，一直受阻 |
| R1–R3 | 机器重装后的恢复阶段 |

## 路线图

当前目标是弄清楚它对维护自动化的人是否有用。这里没有时间承诺。

详细的版本计划见[路线图](docs/ROADMAP.zh-CN.md)。

- 根据真实反馈改进离线 CSV 核对。
- 用只读沙箱账号测试规划中的检查。详见[验证计划](docs/product-dev/final-version/S1_VALIDATION_PLAN.md)。
- 增加明确且经过审核的比较策略，不只是精确匹配。
- 上述测试有依据后，再把 Service 连接到真实来源。

## 参与贡献

欢迎提交问题报告、真实的验证场景和聚焦的 Pull Request。详见 [CONTRIBUTING.md](CONTRIBUTING.md)、[行为准则](CODE_OF_CONDUCT.md)和[安全策略](SECURITY.md)。这些文档是英文的。

## 许可证

Copyright 2026 The FlowAssert Authors. 依据 [Apache License, Version 2.0](LICENSE) 授权。详见 [NOTICE](NOTICE)。

HubSpot、n8n 和 Google Sheets 是其各自所有者的商标。本项目与它们没有关联，也未获得它们的认可。
