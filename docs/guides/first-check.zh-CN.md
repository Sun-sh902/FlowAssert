# 第一次核对：比较两个 CSV 文件

[English](first-check.md) | 简体中文

本指南介绍如何安装 `flowassert-verify`、准备来源 CSV 与目标导出 CSV、只声明你确实能确认的完整性前提，以及如何阅读核对结果。

FlowAssert 始终遵循同一条核心规则：**证据不足时，绝不说 Verified。**

## 1. 安装命令

正式支持 Python 3.11+；由于 macOS 自带 Python 3.9，Python 3.9 和 3.10 提供尽力支持。工具只使用 Python 标准库，只读取本地文件，不发任何网络请求。

在本地克隆的仓库根目录安装：

```sh
python3 -m pip install ./offline
flowassert-verify --version
```

或者直接从 GitHub 安装：

```sh
python3 -m pip install "git+https://github.com/Sun-sh902/FlowAssert.git#subdirectory=offline"
```

如果不想安装包，也可以在仓库根目录直接运行 `python3 offline/verify.py`，命令行选项完全相同。

## 2. 导出两个 CSV 文件并选择稳定的键

准备两份带表头的 UTF-8 CSV 文件：

1. **来源 CSV（`--source`）**：应该到达目标系统的记录（例如上游数据表、表单记录或订单列表的导出）。
2. **目标 CSV（`--destination`）**：从目标系统独立导出的当前记录。

保持两份文件彼此独立：

- 不要拿同一份文件或同一次导出的副本自己核对自己。路径解析到同一文件时，FlowAssert 始终拒绝；两份文件内容完全相同时默认也会拒绝，只有当你确认它们确实来自两个独立系统时，才应传入 `--allow-identical-content`。
- 确保文件是合法的 UTF-8 CSV，并且每一行都与表头列数一致。遇到格式错误或超出大小/行数上限的文件，FlowAssert 会整体拒绝，绝不给出残缺结论。

### 选择稳定的记录键（Key）

选择一个由上游产生、能够唯一标识每条业务记录，并且原样写入目标系统的列作为键，例如 `external_id`、提交单号或订单号。

避免把以下列当作键：

- **容易变化或被格式化的字段**：例如姓名、公司名或可能被改写格式的电话号码。
- **只在目标系统生成的自增 ID**：除非上游来源系统已经独立记录了它。
- **存在空值或重复值的来源列**：来源键为空或重复的行无法可靠匹配，会被判定为 `Unverified`。

如果同一个字段在两份文件里的列名不同，写成 `来源列名:目标列名`，例如 `--field email:hs_email`。如果列名本身带有冒号（例如 `Contact: Phone`），请改用 `--mapping FILE`（不能与 `--key` 或 `--field` 同时使用）：

```json
{
  "key": ["external_id", "Record ID"],
  "fields": [["Contact: Phone", "phone"], ["email", "hs_email"]]
}
```

### `offline/examples/` 中的示例文件

仓库自带两份小型合成数据文件，可以直接试跑。

`offline/examples/source.csv`：

```csv
external_id,phone,email
SYN-001,+1 212 555 0101,ada@example.test
SYN-002,+1 212 555 0102,grace@example.test
SYN-003,+1 212 555 0103,alan@example.test
SYN-004,+1 212 555 0104,edsger@example.test
```

`offline/examples/destination.csv`：

```csv
external_id,phone,hs_email
SYN-001,+1 212 555 0101,ada@example.test
SYN-002,+1 212 555 0199,grace@example.test
SYN-004,+1 212 555 0104,edsger@example.test
SYN-004,+1 212 555 0104,edsger.2@example.test
```

## 3. 两个完整性选项的含义，以及什么时候不要用

单凭一份 CSV 文件，工具无法自己判断导出时有没有漏掉记录。因此 FlowAssert 用两个显式选项来记录你的声明：

| 选项 | 你声明的前提 | 什么时候**不要**使用 |
| --- | --- | --- |
| `--source-complete` | 来源 CSV 就是本次要验证的完整批次。 | 如果来源文件只是抽样、筛选视图、分页中的一页或部分日志，**不要**加这个选项。不加时，单条记录仍可判为 `Verified` 或 `Mismatch`，但整个批次保持 `Unverified`。 |
| `--destination-complete` | 目标 CSV 覆盖了目标对象中所有可能匹配或重复的记录。 | 如果导出时加了筛选条件（例如按日期、负责人、状态过滤）、受导出行数上限截断，或只导出了局部视图，**不要**加这个选项。不加时，在文件里没看到的键会判为 `Unverified` 而不是 `Mismatch`，唯一性也保持未知。 |

**FlowAssert 不会核实这两项声明。** 如果目标导出其实经过筛选，却传入了 `--destination-complete`，筛选范围外的记录会被误判为缺失（`Mismatch`），范围外的重复记录也会被漏掉，从而把本不唯一的记录误判为 `Verified`。只有在清楚导出范围时才使用它们。

即使传入了 `--destination-complete`，只要目标文件里存在没有键（空键）的行，FlowAssert 也不会认定覆盖完整，因为那行无键记录可能正是缺失或重复的目标记录。

## 4. 运行核对、阅读结果并使用退出码

在仓库根目录运行示例：

```sh
flowassert-verify \
  --source offline/examples/source.csv \
  --destination offline/examples/destination.csv \
  --key external_id \
  --field phone \
  --field email:hs_email \
  --source-complete --destination-complete
```

输出如下：

```text
Mismatch: 4 rows of 4
Verified 1 · Mismatch 3 · Unverified 0
  record 2 SYN-002: Mismatch
    field:phone fail: exact string comparison ('+1 212 555 0102' vs '+1 212 555 0199')
  record 3 SYN-003: Mismatch
    existence fail: key not found in stated complete destination
    uniqueness unknown: insufficient evidence
    field:phone unknown: insufficient evidence
    field:email unknown: insufficient evidence
  record 4 SYN-004: Mismatch
    uniqueness fail: more than one destination row carries this key
    field:phone unknown: no arbitrary candidate selected
    field:email unknown: no arbitrary candidate selected
Files and completeness statements are not authenticated. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline.
```

逐行解读：

- `Mismatch: 4 rows of 4` 是**批次（cohort）判定**，后面是观测到的来源行数和预期总数（未传 `--source-complete` 或来源键存在空值/重复时显示 `unknown total`）。
- `Verified 1 · Mismatch 3 · Unverified 0` 汇总了**单条记录的状态**：
  - `SYN-001` 在目标中唯一存在，且 `phone` 与 `email`（`hs_email`）完全一致，因此判为 `Verified`，不在问题明细中展开。
  - `SYN-002` 找到了对应记录，但 `phone` 精确字符串比较不一致，判为 `Mismatch`。
  - `SYN-003` 在已声明完整的目标中不存在，判为 `Mismatch`（如果去掉 `--destination-complete`，`SYN-003` 会变成 `Unverified`）。
  - `SYN-004` 在目标中出现了两条相同键的记录，违反唯一性，判为 `Mismatch`，并且不会随意挑其中一条去比较字段。
- 字段比较是精确匹配：首尾空格、大小写和电话号码格式差异都会算作 `Mismatch`。任一侧比较字段为空字符串时判为 `Unverified`，因为 CSV 无法说明单元格为空的原因。
- 需要留存完整报告（包含每条记录、规则状态和输入文件的 SHA-256 摘要）时，加上 `--json report.json`；不希望报告写出键值和字段值时，再加上 `--redact-values`。问题记录很多时，`--max-details N` 控制终端摘要打印多少条非 `Verified` 记录，JSON 报告始终保留全部记录。

### 在脚本中使用退出码

命令结束后可立即检查退出码 `$?`：

| 退出码 | 含义 | 脚本或定时任务的典型处理 |
| --- | --- | --- |
| `0` | `Verified` | 通过 |
| `1` | `Mismatch` | 已证实存在数据不一致，触发告警或人工排查 |
| `3` | `Unverified` | 证据不足，**不能**当作成功；检查缺失证据或完整性前提 |
| `2` | 输入被拒绝 | 修正命令行参数、缺失列名、损坏的 CSV 或大小/行数上限 |
| `4` | 内部故障 | 工具自身异常，没有产生任何判定，按运行故障告警 |

只有退出码 `0` 才代表 `Verified`。自动化任务应把 `1`（数据不一致）、`3`（证据不足）以及 `2`、`4`（核对未完成）明确区分开。

## 5. 结果**不能**证明什么

即使得到 `Verified`（退出码 `0`），它表达的结论也刻意收窄为：在本次评估时点，在你声明的完整性前提下，所提供的目标 CSV 在选定字段上满足针对所提供来源 CSV 的精确字符串比较规则。

它**不能**证明：

- **工作流确实执行过写入**：无法区分数据是由自动化工作流写入、其他程序写入，还是人工修改。
- **来源数据本身真实且没有遗漏现实事件**：如果某条现实业务记录一开始就没有进入来源 CSV，这次核对不会发现。
- **文件来源真实且未经改动**：SHA-256 摘要只能标识你传入的文件字节，不能证明文件确实导自某个系统或未在导出后被过滤、编辑。
- **不存在语义重复**：如果同一个人或同一笔订单在目标系统里使用了另一个键，或者留在导出范围之外，单靠按键核对无法排除。
- **历史截止时间或后续状态**：当前导出无法证明记录在过去某个截止时间前就已到达，也无法保证导出之后目标系统不会被改坏。
