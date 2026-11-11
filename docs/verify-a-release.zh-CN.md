# 验证一次发布

[English](verify-a-release.md) | 简体中文

从 1.0.0 起，FlowAssert 每次发布的每个文件，以及在线演示所提供的网站，都由本仓库的 GitHub Actions 工作流构建，并带有一份**构建来源证明**（build provenance attestation）：一份用短期证书签名的说明，证书由 GitHub 的 OIDC 令牌向 Sigstore 申请。这份说明写明文件的 SHA-256 摘要值、仓库、工作流，以及构建所用的提交。任何人都可以核对它，核对时不需要相信这个页面。

这个页面说明怎样核对，以及核对能证明什么、不能证明什么。它描述的是工作流现在写成的样子（`.github/workflows/release.yml` 和 `pages.yml`）。这两个工作流还没有运行过：在维护者发布 1.0.0 之前，FlowAssert 的任何发布都没有来源证明。

## 一次发布包含什么

| 文件 | 是什么 |
| --- | --- |
| `flowassert_offline-VERSION-py3-none-any.whl` | 命令行核对工具的 wheel 包（用 `pip install` 安装） |
| `flowassert_offline-VERSION.tar.gz` | 同一个工具的源码包 |
| `flowassert-check.js` | 打包好的 JavaScript 核对器（n8n 示例和其他宿主使用） |
| `flowassert-site.tar.gz` | 浏览器核对的静态网站，与 Pages 构建的结果相同 |
| `SHA256SUMS` | 上面每个文件的 SHA-256，格式与 `sha256sum` 的输出相同 |

这五个文件各有一份来源证明。发布由工作流创建为草稿，再由维护者手动发布。

## 核对下载的文件

需要 [GitHub CLI](https://cli.github.com/)（`gh`），并登录任意一个 GitHub 账号。

1. **校验和。** 在下载文件所在的文件夹中：

   ```sh
   sha256sum -c SHA256SUMS            # Linux
   shasum -a 256 -c SHA256SUMS        # macOS
   ```

   每一行都应当以 `OK` 结尾。这说明每个文件就是 `SHA256SUMS` 中列出的那个文件。

2. **每个文件的来源证明**，包括 `SHA256SUMS` 本身：

   ```sh
   gh attestation verify flowassert-check.js \
     --repo Sun-sh902/FlowAssert \
     --signer-workflow Sun-sh902/FlowAssert/.github/workflows/release.yml \
     --source-ref refs/tags/v1.0.0 \
     --deny-self-hosted-runners
   ```

   对每个文件重复一次。通过的文件会输出 `✓ Verification succeeded!` 以及它所匹配的证明。`--signer-workflow` 要求证明由发布工作流签名，`--source-ref` 要求文件从这个标签构建，`--deny-self-hosted-runners` 要求文件在 GitHub 托管的运行器上构建。

任何一步失败，都不要使用这个文件。

## 核对在线演示

Pages 工作流为它部署的归档 `artifact.tar` 生成来源证明，并把它作为这次运行的 `github-pages` 产物保留 90 天。与它对照的方法：

1. 在仓库的 Actions 页面，打开“Pages demo”最近一次运行，下载它的 `github-pages` 产物并解压，里面是 `artifact.tar`。
2. 核对它：

   ```sh
   gh attestation verify artifact.tar --repo Sun-sh902/FlowAssert \
     --signer-workflow Sun-sh902/FlowAssert/.github/workflows/pages.yml --deny-self-hosted-runners
   ```

3. 逐个文件比较演示现在提供的内容和这个归档：

   ```sh
   mkdir site && tar -xf artifact.tar -C site
   cd site && find . -type f | sort | while read -r f; do
     printf '%s  ' "$f"
     curl -fsS --compressed "https://sun-sh902.github.io/FlowAssert/${f#./}" | cmp -s - "$f" && echo same || echo DIFFERENT
   done
   ```

   每一行都应当以 `same` 结尾。

产物过期后，可以改用发布中的 `flowassert-site.tar.gz` 来比较：像上面那样核对这个文件，解压后运行同样的循环。同一个提交构建两次，只有在构建可复现时才会得到相同的文件，而这一点还没有被证明；这时出现差异是需要进一步查看的理由，不是被篡改的证据。

## 能证明什么，不能证明什么

它能证明：

- 这个文件由 `Sun-sh902/FlowAssert` 中指定的工作流，在 GitHub 托管的运行器上，从证明所记录的提交和引用构建，并且之后没有改变；
- 结合 `SHA256SUMS` 及其自身的证明，这组文件就是那次工作流运行产生的文件。

它**不能**证明：

- 代码是正确的、安全的或没有缺陷的，也不能证明有人审查过它；
- FlowAssert 给出的任何结果是对的：结论仍然取决于你提供的文件和前提；
- 构建所用的依赖（npm 包、Python 的构建工具）是无害的：它们也是构建的一部分；
- 构建是可复现的：同一个提交的第二次构建还没有逐字节比较过；
- 浏览器之后打开的演示，提供的字节与你比较时相同：网站在核对之后可能变化，浏览器也可能用着旧的副本。

来源证明也不说明某个改动是谁写的。它把文件与一个仓库、一个工作流和一个提交联系起来，其余的由提交历史说明。

## 资料来源

2026 年 11 月 10 日阅读。

| 来源 | 用于 |
| --- | --- |
| `actions/attest-build-provenance` 的 README（v4.2.2），<https://github.com/actions/attest-build-provenance> | 以 in-toto 形式、由 Sigstore 签名的 SLSA 来源证明；版本 4 是对 `actions/attest` 的封装；在公开仓库中可用 |
| `actions/attest` 的 README（v4.2.2），<https://github.com/actions/attest> | 权限 `id-token: write` 和 `attestations: write`；`subject-path` 可以用通配符和路径列表 |
| `actions/upload-pages-artifact` 的 `action.yml`（v5.0.0），<https://github.com/actions/upload-pages-artifact> | 它把网站归档为 `$RUNNER_TEMP/artifact.tar`；`retention-days` |
| GitHub CLI 的 `pkg/cmd/attestation/verify/verify.go`，<https://github.com/cli/cli/blob/trunk/pkg/cmd/attestation/verify/verify.go>（gh 2.103.3），它的帮助文字就是手册页 <https://cli.github.com/manual/gh_attestation_verify> | 参数 `--repo`、`--signer-workflow`、`--source-ref`、`--deny-self-hosted-runners`；核对检查什么；提示 `✓ Verification succeeded!` |
