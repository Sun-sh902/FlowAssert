# 一致性

[English](conformance.md) | 简体中文

本页说明另一个实现怎样证明它给出的结果与 FlowAssert 相同。一个实现通过了本仓库里的样例，才算一致；它的作者读过[规范](spec/verification.zh-CN.md)，并不算数。

- [样例](#样例)
- [运行](#运行)
- [怎样算通过](#怎样算通过)
- [没有命令行的评估器](#没有命令行的评估器)
- [一致性等级](#一致性等级)
- [FlowAssert 自己的实现怎样受它约束](#flowassert-自己的实现怎样受它约束)

## 样例

| 样例 | 位置 | 每个样例里有什么 |
| --- | --- | --- |
| 核对样例 | `offline/golden/NAME/` | 输入文件、写着命令参数的 `case.json`，以及参考实现给出的结果：`exit_status.txt`、`stdout.txt`、`stderr.txt`，写了报告时还有 `report.json` 和 `report.html` |
| 连接器样例 | `offline/golden-sheets/NAME/` | 同上，另有本地假接口给出的响应，以及核对程序必须发出的请求（`requests.json`） |
| 一致性样例 | `offline/conformance/NAME.json` | 用 JSON 写的行、核对内容和前提，以及预期的批次状态、各记录状态和总数（见[它们的 README](../offline/conformance/README.md)，仅英文） |

样例里的每个值都是合成的。`python3 offline/bench/golden.py` 用参考实现写出核对样例；样例不是最新时，CI 会失败。

## 运行

在克隆下来的仓库里，只要有 Python 3.9 或更高版本，不用安装别的东西，一条命令就能对参考实现运行全部样例：

```sh
python3 offline/bench/conformance.py --connectors
```

要运行另一个实现，把它的命令传进去。运行程序会新建一个只放着该样例输入文件的文件夹，在里面启动这个命令，参数是样例的参数加上 `--json report.json`，所以命令必须在 `PATH` 里，或者用完整路径给出：

```sh
python3 offline/bench/conformance.py --command "my-verify"
python3 offline/bench/conformance.py --command "/full/path/to/my-verify --some-option" --bytes --html
```

| 选项 | 作用 |
| --- | --- |
| `--command "CMD ARG..."` | 代替 `flowassert-verify` 运行的命令 |
| `--evaluator "CMD ARG..."` | 用于一致性样例的评估器（[见下文](#没有命令行的评估器)） |
| `--no-golden`、`--no-cases` | 不运行核对样例，或不运行一致性样例 |
| `--bytes` | 还要求 `report.json` 与样例里的文件逐字节相同 |
| `--html` | 还传入 `--html report.html`，并要求 HTML 报告逐字节相同 |
| `--connectors` | 还运行连接器样例，对着本机回环端口上的假接口；不访问任何网络 |
| `--only NAME` | 只运行一个样例；可以重复 |
| `--list` | 打印样例名称 |

它为每个样例打印 `PASS` 或 `FAIL` 以及不同之处，最后打印 `N of M cases pass`；只有全部通过时才以 0 退出。

## 怎样算通过

一个核对样例要同时满足以下各条才算通过：

1. **退出码**与 `exit_status.txt` 相同。
2. **标准输出**与 `stdout.txt`、**标准错误**与 `stderr.txt` 逐字节相同。拒绝信息里的文件名与样例里的写法相同，比如 `source.csv`。
3. `report.json` **只在**样例里有它时才存在。被拒绝的核对什么也不写。
4. 报告**符合**它的 `schema_version` 对应的 **JSON Schema**（[docs/schema/](schema/)）。
5. 报告**作为 JSON 值与样例的报告相等**：成员相同，值相同；顺序和空白不限。

时间不比较，因为它是核对运行的时刻：`evaluated_at`，以及连接器的 `read_at`。它们都必须是文档规定形式的 UTC 时间。

连接器样例还要求：命令发给假接口的请求，与 `requests.json` 里的一致，包括每个请求的方法、路径和查询参数，顺序也相同。

一致性样例要求评估器给出的结果与 `expected` 成员完全相同：`cohort_state`、`record_states` 和 `expected_total`。

## 没有命令行的评估器

没有命令行的实现（比如一个库）也能运行一致性样例。给运行程序一个命令：它从标准输入读取一个 JSON 样例，成员有 `name`、`obligation`、`source_rows`、`destination_rows` 和 `premises`；再向标准输出打印一个 JSON 对象：

```json
{"cohort_state": "Mismatch", "record_states": ["Verified", "Mismatch"], "expected_total": 2}
```

```sh
python3 offline/bench/conformance.py --no-golden --evaluator "my-evaluator"
```

预期结果不会发给它。

## 一致性等级

| 等级 | 实现需要通过 |
| --- | --- |
| **评估器** | 每个一致性样例 |
| **报告** | 每个核对样例和每个一致性样例，不加 `--bytes` 和 `--html` |
| **逐字节** | 同上，加 `--bytes --html` |
| **连接器** | 在它已有的等级上，加 `--connectors` |

声称一致时，要写明等级、所运行样例的 FlowAssert 版本，以及运行它们的命令。

## FlowAssert 自己的实现怎样受它约束

- **命令行**是参考实现。CI 在 Python 3.9、3.11 和 3.14 上运行 `python3 offline/bench/golden.py --check`，保证核对样例就是它在每个版本上写出的内容；`scripts/dev/tests/test_spec.py` 用 `--bytes --html --connectors` 运行上面的程序。
- **浏览器核对**在 Vitest 里逐字节运行每个核对样例（`ui/src/test/offline/golden.test.ts`）和每个一致性样例（`conformance.test.ts`），并对着命令行运行 300 个随机样例（`random-parity.test.ts`）。
- **打包的 JavaScript 核对函数**用构建出的文件，在没有 `crypto` 的环境里运行页面能运行的每个核对样例（`bundle.test.ts`）。

它们之间出现差异就是缺陷，不论错的是哪一个。
