# HubSpot 联系人目标的实测（给维护者；尚未运行）

[English](hubspot_live_check.md) | 简体中文

> [!IMPORTANT]
> **在做任何事之前：** 在创建任何账号**之前**，先阅读 HubSpot 的服务条款、开发者条款和免费账号的条款，确认谁可以持有这样的账号，以及个人能否为测试开设账号：如果不符合条件，就到此为止。令牌永远不要粘贴到聊天、issue、提交或本仓库的任何文件中。只使用合成数据。

这份计划是基于 FlowAssert 1.0.0 编写的，**尚未运行**。它用来确认或否定[设计说明](../../docs/connectors/hubspot.zh-CN.md)中标为 **[未确认]** 的说法，并证明读取在真实 API 上的表现与在本地仿制服务上相同。每一步的输出记在私人笔记里，不要放进仓库；之后把结论（而不是会暴露账号的输出）写进设计说明和更新日志。

## 需要准备的

- 一个只用于测试、没有任何真实数据的 HubSpot 账号：如果条款允许，用免费的开发者测试账号；否则用专门为此开设的免费 CRM 账号。
- 在这个账号中建一个**私有应用**，只授予一个权限范围：`crm.objects.contacts.read`。不要授予其他权限范围，也不要授予任何敏感数据的权限范围。把它的访问令牌复制一次，保存到密码管理器里。
- 正在审查的那个提交上的 FlowAssert，安装在一个新的 venv 中：`python3 -m pip install ./offline`。

## 合成联系人

1. 新账号里可能有 HubSpot 自己创建的示例联系人。先删除所有联系人，让账号里只有你在这里创建的内容（第 4 步和第 5 步会声明导出覆盖了整个对象）。
2. 手动创建三个联系人，只填下面这些值：

   | 邮箱 | 电话号码 |
   | --- | --- |
   | `flowassert-c001@example.com` | `+1 555 0100 001` |
   | `flowassert-c002@example.com` | `+1 555 0100 002` |
   | `flowassert-c003@example.com` | `+1 555 0100 003` |

   如果 HubSpot 不接受这些地址，就用你自己掌控的域名下的任意地址，并相应修改来源文件。
3. 在自己的电脑上写来源文件 `contacts.csv`：

   ```text
   email,phone
   flowassert-c001@example.com,+1 555 0100 001
   flowassert-c002@example.com,+1 555 0100 002
   flowassert-c003@example.com,+1 555 0100 003
   ```

## 令牌

只把令牌放进一个终端的环境里，不要回显，也不要留在终端的历史记录中：

```sh
read -rs FLOWASSERT_HUBSPOT_TOKEN && export FLOWASSERT_HUBSPOT_TOKEN
```

## 检查

每条命令、它应当输出什么，以及它确认了什么。`N` 和时间会变化。输出是英文的，下面原样引用。

1. **一次已验证的读取。**

   ```sh
   flowassert-verify --source contacts.csv --destination-hubspot contacts --key email --field phone \
     --source-complete --destination-complete --json r1.json --html r1.html
   echo $?
   ```

   预期：`Verified: 3 rows of 3`、`Verified 3 · Mismatch 0 · Unverified 0`，然后是
   `Destination read by FlowAssert from HubSpot: contacts, 3 records in 1 pages, …; archived records were not read.`
   和 `This lists what the token could see at that time; it does not show that the object is complete.`；退出码 0。
   `r1.json` 中：`schema_version` 为 3，`inputs.destination_hubspot` 中没有令牌、门户 ID 或账号名称。
   确认：主机、路径、`archived=false`，以及 `properties` 可以作为一个逗号分隔的参数被接受。
   在两份报告中搜索令牌的前八个字符：必须找不到。

2. **再读一次。** 用 `r2.json` 再运行一次第 1 步。预期：摘要相同，两份报告的 `inputs.destination_sha256` 相同。确认：在没有任何变化时，列表以相同的顺序返回。

3. **一次不一致。** 在 HubSpot 中把 `flowassert-c002@example.com` 的电话号码改为 `+1 555 0100 092`，然后用 `r3.json` 运行第 1 步。预期：`Mismatch: 3 rows of 3`，以及 `field:phone fail: exact string comparison ('+1 555 0100 002' vs '+1 555 0100 092')`；退出码 1。之后把它改回来。

4. **对象没有的属性。** 在第 1 步的命令中改用 `--field phone:flowassert_no_such_property`。预期：`refused: HubSpot contacts: page 1 has a record without the property 'flowassert_no_such_property'; HubSpot leaves out a property the object does not have`；退出码 2。确认：HubSpot 不返回没有定义的属性。

5. **不止一页。** 用 HubSpot 的导入工具导入一个 CSV 文件，其中再有 120 个合成联系人（`flowassert-m001@example.com` 到 `flowassert-m120@example.com`，不填其他值）。然后用一个含有这 123 个地址的来源文件运行：

   ```sh
   flowassert-verify --source all.csv --destination-hubspot contacts --key email --field email \
     --source-complete --destination-complete --json r5.json
   ```

   预期：`… 123 records in 2 pages …`；退出码 0。确认分页游标：如果其中有字母、数字、`-` 和 `_` 以外的字符，读取会以 `gives a paging cursor that FlowAssert cannot send back unchanged` 被拒绝。再加上 `--max-rows 100` 运行一次：预期 `refused: HubSpot contacts: exceeds --max-rows limit of 100`。

6. **不再有效的令牌。** 在 HubSpot 中轮换私有应用的令牌，终端里保留旧令牌，运行第 1 步。预期：`refused: HubSpot contacts: the credential was not accepted (HTTP 401 …)`；退出码 2。记下 401 后面显示的 `category`。确认：无效令牌的状态和类别。

7. **缺少权限范围**（可选）。再建一个私有应用，只授予联系人以外的权限范围（例如只授予 `crm.objects.companies.read`），把它的令牌放进终端，运行第 1 步。预期：`refused: HubSpot contacts: access was denied (HTTP 403 …)`。记下类别。之后删除这个应用。

不要故意去触发限流。

## 吊销令牌

检查完成后，按以下顺序：

1. 在 HubSpot 中删除私有应用（一个或多个）：删除应用会吊销它的令牌。
2. `unset FLOWASSERT_HUBSPOT_TOKEN`，然后关闭这个终端。
3. 删除合成联系人；如果不再需要，再删除测试账号。
4. 删除 `r*.json`、`r*.html` 和来源文件：其中有合成地址。

## 这次实测确认设计说明中的哪些内容

| 标为 **[未确认]** 的说法 | 步骤 |
| --- | --- |
| `properties` 可以作为一个逗号分隔的参数被接受 | 1 |
| 没有变化时，列表的顺序是稳定的 | 2 |
| 分页游标只含字母、数字、`-` 和 `_` | 5 |
| 无效令牌和缺少权限范围时的状态和 `category` | 6、7 |
| 用 `archived=false` 读取的列表中，`archived` 存在且为 `false` | 1（`archived` 为 true 或是其他类型的记录会被拒绝） |
| 私有应用令牌看不到哪些联系人 | 这次实测无法确定：账号中没有受限制的联系人 |
| 读取期间联系人变化时列表会怎样 | 这次实测无法确定 |

这次实测无法确认的说法，仍然标为 **[未确认]**。
