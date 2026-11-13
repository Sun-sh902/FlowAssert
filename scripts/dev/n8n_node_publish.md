# Publishing the n8n node: the owner's checklist

`integrations/n8n-nodes-flowassert` is ready to publish but has not been published. Nothing below has been done. The
node is not on npm, not listed in n8n's catalogue, and not verified by n8n. These are the owner's steps, in order;
[docs/design/1.1-n8n-node.md](../../docs/design/1.1-n8n-node.md) explains the choices.

## 1. Before the first publish

- [x] The email npm and n8n will show for the package is set in
      `integrations/n8n-nodes-flowassert/package.json` (`author.email`): the GitHub no-reply address, chosen for
      1.1.0. n8n's linter requires an email, and the publish workflow refuses to run while an `example.invalid`
      placeholder is there.
- [ ] Release FlowAssert 1.1.0 first, so the node's README links and the checker version (1.1.0) match a release.
- [ ] Read the package once as npm will publish it:
      `cd ui && npm ci && npm run build:lib && cd ../integrations/n8n-nodes-flowassert && npm ci && npm run build && npm pack --dry-run`.

## 2. An npm account and the package name

- [ ] Sign in to npmjs.com, or create an account, with two-factor authentication on.
- [ ] Check that the name `n8n-nodes-flowassert` is free: `npm view n8n-nodes-flowassert` should answer "404".
- [ ] npm's trusted publishing is set up on a package's settings page, so a package must exist first. Either publish
      0.0.0-placeholder by hand once and then deprecate it, or follow npm's current documentation if it allows a
      trusted publisher for a new name: https://docs.npmjs.com/trusted-publishers

## 3. Trusted publishing (no token)

- [ ] On npmjs.com, the package's Settings, "Trusted Publisher", GitHub Actions:
      owner `Sun-sh902`, repository `FlowAssert`, workflow file `n8n-node-publish.yml`, no environment.
- [ ] Do not create an npm token or a repository secret: the workflow has no `NPM_TOKEN`, and npm exchanges the job's
      OIDC identity for a short-lived credential. It needs npm 11.5.1 or later and Node 22.14.0 or later, which the
      workflow installs.
- [ ] Optionally, on the same page, require trusted publishing and disallow tokens for this package.

## 4. Publish

- [ ] Tag the commit to publish, with the package's version: `git tag n8n-node-v1.1.0 && git push origin n8n-node-v1.1.0`.
- [ ] Watch `.github/workflows/n8n-node-publish.yml`: it checks that the tag names the version and that the email is
      set, builds the checker and the node, runs the unit tests, then `npm run release` (n8n's `n8n-node release`:
      lint, build, `npm publish` with provenance).
- [ ] On npmjs.com, the version shows "Provenance" with a link to the workflow run.

## 5. Install it in a self-hosted n8n

- [ ] In a self-hosted n8n (not n8n Cloud): Settings, Community Nodes, Install, `n8n-nodes-flowassert`.
- [ ] Import `examples/n8n/flowassert-check.workflow.json`'s two read nodes and Merge, add the FlowAssert node after
      Merge, and run it on `offline/examples/`: the Result output says `Mismatch`, and the three outputs of records to
      resend have one row each.
- [ ] `node integrations/n8n-nodes-flowassert/test/n8n-run.mjs --n8n "npx --yes n8n@VERSION"` with the n8n version
      you run, to see every golden case the node can express pass there too.

## 6. Apply for verification

- [ ] Read n8n's current requirements again: https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/
      and the verification guidelines. On 2026-11-12 they asked for: the MIT licence, no runtime dependency, no
      environment variables or file access, `n8n-node` lint passing, English documentation, and publishing from
      GitHub Actions with provenance. The package meets each as far as the build and the linter can tell.
- [ ] Submit it through the n8n Creator Portal. Until n8n answers, say nowhere that the node is verified or listed.
