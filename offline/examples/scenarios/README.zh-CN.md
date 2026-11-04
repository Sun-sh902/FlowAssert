# 第一次核对的场景

[English](README.md) | 简体中文

四个小场景，每个都是一对合成的 CSV 文件，以及比较它们所用的配置。每个场景都说明作出哪些声明时会得到什么结果，让你在使用自己的文件之前，先看到声明如何改变结果。数据都是虚构的：键、数字和 `example.test` 地址不属于任何人。

CSV 核对页面的 **手边没有文件？试试一个场景** 中有同样的场景。选择一个场景会填入它的文件、列和规则，但不会替你声明任何内容。

在这些文件里，这些声明按设计是成立的。用你自己的文件时，只有在确知声明成立时才作出它：FlowAssert 无法检查声明，错误的声明会得出错误的结果。

在仓库根目录执行 `python3 -m pip install ./offline` 后运行下面的命令（也可以用 `python3 offline/verify.py` 代替 `flowassert-verify`）。下面表格中的每一行都是一个黄金样例 `offline/golden/scenario-*`，按页面的方式运行（页面还会记录两个文件的编码）；测试会检查命令行和页面都给出这个结果。

## 同步到 CRM 的联系人

同步到 CRM 的联系人列表：一个电话号码变了，还有一个联系人缺失。

文件夹 [`contacts-crm/`](contacts-crm/)。键 `contact_id` → `external_id`；字段 `phone` → `phone_number` (exact), `email` (exact)；范围 `source`。

| 声明 | 结果 | 原因 |
| --- | --- | --- |
| 两项声明都作出（`--source-complete --destination-complete`） | Mismatch | C-1002 的电话号码不同，而 C-1003 不在已声明覆盖整个对象的导出中。 |
| 不作任何声明 | Mismatch | C-1002 的电话号码不同，这本身就是不一致，因为这一行确实存在。C-1003 没有找到，但没有目标完整声明，这并不能说明它缺失，所以它是未验证。 |

不作声明时：

```sh
flowassert-verify \
  --source offline/examples/scenarios/contacts-crm/source.csv \
  --destination offline/examples/scenarios/contacts-crm/destination.csv \
  --config offline/examples/scenarios/contacts-crm/config.json
```

在命令末尾加上表中某一行的声明，即可看到那一行的结果。

## 按 trim 和 casefold 比较的订单

订单导出按规则比较：email 用 casefold，status 用 trim。两个文件只在大小写和空格上不同。

文件夹 [`orders-rules/`](orders-rules/)。键 `order_id`；字段 `customer_email` → `email` (casefold), `status` (trim)；范围 `source`。

| 声明 | 结果 | 原因 |
| --- | --- | --- |
| 两项声明都作出（`--source-complete --destination-complete`） | Verified | 只有大小写和空格不同，而这两条规则会忽略它们。 |
| 不作任何声明 | Unverified | 没有规则不通过，但没有这两项声明，只找到一次的记录不能证明是带这个键的唯一一条，这一批也不能确定是完整的。 |

不作声明时：

```sh
flowassert-verify \
  --source offline/examples/scenarios/orders-rules/source.csv \
  --destination offline/examples/scenarios/orders-rules/destination.csv \
  --config offline/examples/scenarios/orders-rules/config.json
```

在命令末尾加上表中某一行的声明，即可看到那一行的结果。

## 目标中多出一条记录

一份价格表，目标中有一条来源里没有的记录，按 exact 范围核对。

文件夹 [`extra-in-destination/`](extra-in-destination/)。键 `sku`；字段 `price` (exact)；范围 `exact`。

| 声明 | 结果 | 原因 |
| --- | --- | --- |
| 两项声明都作出（`--source-complete --destination-complete`） | Mismatch | SKU-399 在目标中，却不在已声明为完整一批的来源中。 |
| 只作出 `--source-complete` | Mismatch | 多出的这一行确实存在，所以判断它不需要目标完整声明。没有这项声明，四条来源记录都是未验证。 |
| 不作任何声明 | Unverified | SKU-399 只被列出，不下结论：它可能属于不在文件中的某条来源记录。 |

不作声明时：

```sh
flowassert-verify \
  --source offline/examples/scenarios/extra-in-destination/source.csv \
  --destination offline/examples/scenarios/extra-in-destination/destination.csv \
  --config offline/examples/scenarios/extra-in-destination/config.json
```

在命令末尾加上表中某一行的声明，即可看到那一行的结果。

## 一行来源数据的键为空

一份会员列表，其中一行来源数据没有键。

文件夹 [`empty-key/`](empty-key/)。键 `member_id`；字段 `email` (exact)；范围 `source`。

| 声明 | 结果 | 原因 |
| --- | --- | --- |
| 两项声明都作出（`--source-complete --destination-complete`） | Unverified | 没有键的行无法匹配，所以即使有来源完整声明，来源总体也是未知的。 |
| 不作任何声明 | Unverified | 没有键的那一行无法匹配，其他内容也都没有确立。 |

不作声明时：

```sh
flowassert-verify \
  --source offline/examples/scenarios/empty-key/source.csv \
  --destination offline/examples/scenarios/empty-key/destination.csv \
  --config offline/examples/scenarios/empty-key/config.json
```

在命令末尾加上表中某一行的声明，即可看到那一行的结果。
