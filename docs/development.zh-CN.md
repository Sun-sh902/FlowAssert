# 开发

[English](development.md) | 简体中文

FlowAssert 如何构建和测试，以及如何在本地运行 Service 和 UI。这些章节在 0.5.0 之前位于 [README](../README.zh-CN.md) 中，内容没有改动，只是相对链接现在从 `docs/` 出发。

- [快速开始：运行 Service 和 UI](#快速开始运行-service-和-ui)
- [架构](#架构)
- [后端](#后端)
- [前端](#前端)
- [测试](#测试)
- [如何扩展](#如何扩展)
- [仓库结构](#仓库结构)
- [项目历史](#项目历史)

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

契约在 [`service/contracts/`](../service/contracts/)。错误使用统一的信封：

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

`CAPTURED_COMPLETE` 和 `ADMITTED_RUN_BOUND` 只表示这些本地检查通过了。密钥在同一台机器上，所以回执无法证明采集过外部数据。live 读取总是报告 *Not implemented*。详见 [EXPERIMENTAL_ADMISSION_BOUNDARY.md](../service/docs/phase3b/EXPERIMENTAL_ADMISSION_BOUNDARY.md)。

## 前端

技术栈是 React 19、TypeScript、Vite 和 Tailwind，源码在 `ui/`。设计系统名为 Evidence Atelier([DESIGN_SYSTEM.md](../ui/docs/DESIGN_SYSTEM.md))。

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

接入真实数据的规划在 [docs/product-dev/final-version/](../docs/product-dev/final-version/):[产品定义 v0.2](../docs/product-dev/final-version/PRODUCT_DEFINITION_v0.2.md)和[验证计划](../docs/product-dev/final-version/S1_VALIDATION_PLAN.md)。规划建议先做用户验证，并用只读沙箱账号测试，再写连接器。`offline/flowassert_offline/evaluator_v2.py` 是走向可配置规则的第一步。

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
| 项目结项 | [PROJECT_CLOSEOUT_20261101.md](../docs/product-dev/final-version/PROJECT_CLOSEOUT_20261101.md) |
| 归档设计 | [ARCHIVE_INTEGRITY_MODEL.md](../service/docs/phase3a/ARCHIVE_INTEGRITY_MODEL.md)、[SQLITE_SCHEMA.md](../service/docs/phase3a/SQLITE_SCHEMA.md) |
| 快照和游标 | [SNAPSHOT_AND_CURSOR_MODEL.md](../service/docs/phase3a/SNAPSHOT_AND_CURSOR_MODEL.md) |
| 后端决策 | [ARCHITECTURE_DECISIONS.md](../service/docs/phase3a/ARCHITECTURE_DECISIONS.md) |
| 前端契约 | [frontend-provider-contract.md](../service/contracts/frontend-provider-contract.md) |
| UI 结构 | [INFORMATION_ARCHITECTURE.md](../ui/docs/INFORMATION_ARCHITECTURE.md) |
| 回归配置 | [REGRESSION_PROFILES.md](../docs/product-dev/round-02-residual-closeout/REGRESSION_PROFILES.md) |

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
