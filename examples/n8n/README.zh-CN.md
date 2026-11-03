# 在 n8n 中使用 FlowAssert

[English](README.md)

`flowassert-check.workflow.json` 在 n8n 工作流里运行 FlowAssert 的 CSV 核对，不使用 Execute Command 节点（从
n8n 2.0 起默认禁用，n8n Cloud 也不提供）。核对在一个 **Code 节点**里进行，节点中是这个 FlowAssert 版本打包好的
JavaScript 核对程序。对同样的文件和前提，它给出的结果、摘要和 JSON 报告与 `flowassert-verify` 相同；只有每项前提的
`origin` 不同（`n8n Code node`）。

```text
Run the check ─┬─ Read source CSV ──────┬─ Both files ── FlowAssert check ── Verified?
               └─ Read destination CSV ─┘   (Merge)        (Code 节点)       (If：true / false)
```

**在自托管的 n8n 2.46.4 上测试过**（在 macOS 上用 npm 安装，task runner 为默认的 internal 模式）。**没有**在
n8n Cloud 上测试。

**文件内容留在你的 n8n 实例里。** Code 节点不发出任何请求，也不运行任何命令。n8n 本身会把每次执行的数据保存在自己的
数据库里，包括这个节点的输出（摘要和 JSON 报告，其中有键和比较的值），和它对其他节点的做法一样。

## 用示例文件运行

1. 把本仓库的 `offline/examples/source.csv` 和 `offline/examples/destination.csv` 复制到 n8n 的 Read/Write
   Files 节点可以读取的文件夹下的 `flowassert` 文件夹里。默认是运行 n8n 的用户的 `~/.n8n-files`；在官方 Docker
   镜像中是 `/home/node/.n8n-files/flowassert/`，也就是工作流里写的路径。如果文件在别处，请修改两个 Read 节点里的
   路径，并用 `N8N_RESTRICT_FILE_ACCESS_TO` 允许那个文件夹。路径中经过符号链接时，n8n 会拒绝读取。
2. 导入工作流：在编辑器里选 **Import from File…**，或运行 `n8n import:workflow --input=flowassert-check.workflow.json`。
3. 运行。用示例文件、不声明任何前提时，结果是 `Mismatch`：有一个电话号码不同、有一个键出现了两次，这不需要前提；
   其他记录仍是未知。

## 配置

打开 **FlowAssert check** 节点。代码开头是配置区；配置区以下的内容不要修改。

| 设置 | 含义 |
| --- | --- |
| `SOURCE`、`DESTINATION` | 每个 Read 节点写入的二进制字段（`source`、`destination`）、拒绝信息里使用的文件名，以及编码：`utf-8`（有无字节顺序标记均可）、`utf-16`（需要字节顺序标记）或 `gb18030` |
| `CONFIG` | 键、每个字段及其规则（`exact`、`trim`、`casefold`、`digits`、`date:FORMAT`）和范围（`source` 或 `exact`），与 `--config` 文件相同。见 [offline/README.md](../../offline/README.md#comparison-rules) |

前提是你对每次运行的文件所作的声明。**FlowAssert 无法核实其中任何一项，声明错了，结果也会错。** 每一项默认是
`false` 或 `null`；只有确知为真时才设置。

| 前提 | 你声明 | 不声明时 |
| --- | --- | --- |
| `SOURCE_COMPLETE = true` | 来源文件就是整个批次 | 批次永远不会是 Verified |
| `DESTINATION_COMPLETE = true` | 目标导出覆盖整个目标对象 | 缺失的记录和重复仍是未知 |
| `SOURCE_COUNT = "120"` | 来源系统显示有 120 条记录。行数不同就不会给出 Verified | 不做交叉核对 |
| `DESTINATION_COUNT = "118"` | 目标系统显示有 118 条记录。行数不同时，缺失和重复仍是未知 | 不做交叉核对 |
| `ALLOW_IDENTICAL_CONTENT = true` | 内容完全相同的两个文件确实来自不同系统 | 内容相同的文件会被拒绝 |

总数相符不能代替完整性声明，只能发现一部分错误的声明。

## Code 节点的输出

一个条目，包含 `state`（`Verified`、`Mismatch`、`Unverified`、`refused` 或 `failed`）、`exit`（与
`flowassert-verify` 的退出码相同：0、1、3、2、4）、`counts`、`summary`（`flowassert-verify` 打印的摘要）、
`message`（拒绝或失败的信息）、`flowassertVersion`，以及 `reportJson`：JSON 报告的文本，逐字节相同
（[格式](../../docs/report-format.md)），核对被拒绝或失败时为 `null`。它不输出报告本身没有的任何值。

**Verified?** 节点只在 `state` 为 `Verified` 时把条目送到 *true* 输出。其他情况，包括 Unverified、拒绝和失败，都
走 *false*。把工作流的后续步骤接到你需要的输出上。如果输入里缺少某个文件，Code 节点会报错，而不是返回结果。

## 用命令行重复核对

配置会被当作 `--config` 文件使用，内容是 `JSON.stringify(CONFIG, null, 2) + "\n"`。把它保存为 `config.json`
后，下面的命令给出相同的摘要和报告（`origin` 和 `evaluated_at` 除外）：

```sh
flowassert-verify --source source.csv --destination destination.csv --config config.json \
  --source-encoding utf-8 --destination-encoding utf-8   # 再加上你在 Code 节点里声明的前提
```

## 关于 Code 节点的实测结果

在 n8n 2.46.4 中，JavaScript Code 节点（"Run Once for All Items"）在 task runner 里、在独立的上下文中运行：

| 功能 | 实测 |
| --- | --- |
| `crypto` | 不存在，所以也没有 `crypto.subtle`。核对程序使用自带的 SHA-256，已在随机输入和全部 golden 文件上与 `crypto.subtle` 对比 |
| `TextDecoder` | 存在，支持 `utf-8`、`utf-16le`、`utf-16be` 和 `gb18030`，fatal 模式会拒绝无效字节 |
| `TextEncoder`、`BigInt`、`Buffer` | 存在 |
| `fetch`、`process` | 不存在 |
| Read/Write Files 读入的文件 | 保存在磁盘上（`filesystem-v2`），不是 base64；`this.helpers.getBinaryDataBuffer(index, field)` 以 Buffer 返回其字节 |
| 约 95 KB 的 Code 节点 | 可以保存和运行 |

每次核对前，核对程序都会用已知字节测试它需要的每项功能。缺少某项或结果不同时，核对会被拒绝，并说明是哪一项；
FlowAssert 从不改用别的方式解码、编码或计算摘要。

在一台 Apple silicon Mac 上，两个各 100,000 行（各 5.3 MB）的文件，Code 节点用时约 0.9 秒，task runner 的内存峰值
约 400 MB（n8n 进程约 700 MB）。命令行处理同样的文件约 0.5 秒。

## 新的 FlowAssert 版本

Code 节点里是某一个版本的核对程序。要更新，在本仓库的 `ui/` 目录中运行：

```sh
npm ci && npm run build:lib && node scripts/n8n/build_workflow.mjs
```

然后导入新的工作流，并把你的配置区复制过去。

HubSpot、n8n 和 Google Sheets 是其各自所有者的商标。本项目与它们没有关联，也未获得它们的认可。
