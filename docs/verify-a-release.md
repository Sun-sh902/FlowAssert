# Verify a release

English | [简体中文](verify-a-release.zh-CN.md)

From 1.0.0, every file of a FlowAssert release, and the site the online demo serves, is built by a GitHub Actions
workflow of this repository and carries a **build provenance attestation**: a statement, signed with a short-lived
certificate that GitHub's OIDC token obtains from Sigstore, that names the file's SHA-256 digest, the repository, the
workflow and the commit it was built from. Anyone can check it, and nobody has to trust this page to do so.

This page says how, and what the check does and does not prove. It describes the workflows as they are written
(`.github/workflows/release.yml` and `pages.yml`). They have not been run yet: no release of FlowAssert carries an
attestation until the owner publishes 1.0.0.

## What a release holds

| File | What it is |
| --- | --- |
| `flowassert_offline-VERSION-py3-none-any.whl` | The command-line checker, as a wheel (`pip install` it) |
| `flowassert_offline-VERSION.tar.gz` | The same, as a source distribution |
| `flowassert-check.js` | The packaged JavaScript checker (the n8n example and other hosts) |
| `flowassert-site.tar.gz` | The static site of the browser check, as the Pages build makes it |
| `SHA256SUMS` | The SHA-256 of each file above, in the format `sha256sum` writes |

Each of the five files has its own attestation. The release is created as a draft by the workflow and published by
hand.

## Check a download

You need the [GitHub CLI](https://cli.github.com/) (`gh`), signed in to any GitHub account.

1. **The checksums.** In the folder where you downloaded the files:

   ```sh
   sha256sum -c SHA256SUMS            # Linux
   shasum -a 256 -c SHA256SUMS        # macOS
   ```

   Every line should end in `OK`. This shows that each file is the one `SHA256SUMS` names.

2. **The attestation of each file**, including `SHA256SUMS` itself:

   ```sh
   gh attestation verify flowassert-check.js \
     --repo Sun-sh902/FlowAssert \
     --signer-workflow Sun-sh902/FlowAssert/.github/workflows/release.yml \
     --source-ref refs/tags/v1.0.0 \
     --deny-self-hosted-runners
   ```

   Repeat it for each file. A file that passes prints `✓ Verification succeeded!` and the attestation it matched.
   `--signer-workflow` requires that the release workflow signed it, `--source-ref` that it was built from that tag,
   and `--deny-self-hosted-runners` that it was built on a GitHub-hosted runner.

If either step fails, do not use the file.

## Check the online demo

The Pages workflow attests the archive it deploys, `artifact.tar`, and keeps it as the `github-pages` artifact of the
workflow run for 90 days. To compare the demo with it:

1. On the repository's Actions tab, open the latest run of "Pages demo", download its `github-pages` artifact, and
   unzip it: it holds `artifact.tar`.
2. Verify it:

   ```sh
   gh attestation verify artifact.tar --repo Sun-sh902/FlowAssert \
     --signer-workflow Sun-sh902/FlowAssert/.github/workflows/pages.yml --deny-self-hosted-runners
   ```

3. Compare what the demo serves now with the archive, file by file:

   ```sh
   mkdir site && tar -xf artifact.tar -C site
   cd site && find . -type f | sort | while read -r f; do
     printf '%s  ' "$f"
     curl -fsS --compressed "https://sun-sh902.github.io/FlowAssert/${f#./}" | cmp -s - "$f" && echo same || echo DIFFERENT
   done
   ```

   Every line should end in `same`.

When the artifact has expired, compare the demo with `flowassert-site.tar.gz` of the release instead: verify that
file as above, extract it, and run the same loop. Two builds of the same commit give the same files only when the build
is reproducible, which has not been shown; a difference is then a reason to look closer, not a proof of tampering.

## What this proves, and what it does not

It proves:

- the file was built by the named workflow of `Sun-sh902/FlowAssert`, on a GitHub-hosted runner, from the commit and
  ref the attestation records, and has not changed since;
- with `SHA256SUMS` and its own attestation, that the set of files is the one that workflow run produced.

It does **not** prove:

- that the code is correct, safe or free of defects, or that anyone reviewed it;
- that any result FlowAssert gives is right: a verdict still rests on the files and the premises you supply;
- that the dependencies the build used (npm packages, Python's build tools) were benign: they are part of the build;
- that the build is reproducible: a second build of the same commit has not been compared byte for byte;
- that the demo a browser opens later serves the same bytes as when you compared them: a site can change after it is
  checked, and a browser may hold an older copy.

An attestation also says nothing about who wrote a change. It ties a file to a repository, a workflow and a commit,
and the commit history says the rest.

## Sources

Read on 10 November 2026.

| Source | Used for |
| --- | --- |
| `actions/attest-build-provenance` README (v4.2.2), <https://github.com/actions/attest-build-provenance> | Sigstore-signed SLSA provenance in in-toto form; version 4 wraps `actions/attest`; availability on public repositories |
| `actions/attest` README (v4.2.2), <https://github.com/actions/attest> | The permissions `id-token: write` and `attestations: write`; `subject-path` with globs and a list of paths |
| `actions/upload-pages-artifact` `action.yml` (v5.0.0), <https://github.com/actions/upload-pages-artifact> | It archives the site as `$RUNNER_TEMP/artifact.tar`; `retention-days` |
| `pkg/cmd/attestation/verify/verify.go` of the GitHub CLI, <https://github.com/cli/cli/blob/trunk/pkg/cmd/attestation/verify/verify.go> (gh 2.103.3), whose help text is the manual page <https://cli.github.com/manual/gh_attestation_verify> | The flags `--repo`, `--signer-workflow`, `--source-ref`, `--deny-self-hosted-runners`; what a verification checks; the message `✓ Verification succeeded!` |
