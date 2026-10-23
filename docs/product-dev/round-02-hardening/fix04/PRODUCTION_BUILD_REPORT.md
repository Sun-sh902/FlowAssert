# FIX04 production build report

## Finding

The baseline `ui/vite.config.ts` (`e974c6d`) declared two Rollup inputs:

```ts
build: { rollupOptions: { input: { main: resolve(__dirname, "index.html"), lab: resolve(__dirname, "lab.html") } } },
```

So `npm run build` shipped the art-direction laboratory alongside the product. That was unintended: the
comment said the lab "never ships styles into the app", but it did ship its own page, code and fonts in the same
output that `vite preview` serves.

## Change (`e759bd6`)

The `build` block and its `resolve` import were removed, so Vite uses its default single `index.html` entry. `ui/lab.html` and
`ui/src/lab/**` (14 tracked files) are unchanged. In development, `npm run dev` still serves `/lab.html` and
`/src/lab/main.tsx`, both HTTP 200 (`evidence/session1/lab-development.log`). The laboratory is retained in source
control and kept out of the product output.

## Before and after

| Build | Files | Bytes | HTML entries | Manifest |
| --- | --- | --- | --- | --- |
| Baseline `e974c6d` (session 1) | 73 | 1,800,693 | `index.html`, `lab.html` | `evidence/session1/before/build-manifest.json` |
| `e759bd6` clean clone (session 1) | 35 | 1,079,138 | `index.html` | `evidence/session1/clean-build-manifest.json` |
| **Candidate `a30e4f3`, clean clone** | **35** | **1,079,657** | **`index.html`** | `evidence/clean-clone-a30e4f3/clean-build-manifest.json` (per-file bytes + SHA-256) |

The 73 baseline files split into two groups.

**35 lab-only files (721,779 bytes), now absent:**

- `lab.html` and `lab-*.js`
- the A and C prototypes (`AShell`, `AOverview`, `ADetail`, `CShell`, `COverview`, `CDetail`, `FieldDiff`, with CSS)
- the `Brand`, `data` and `marks` chunks
- 20 lab-only font files (597,496 bytes): Inter, Inter Tight, Martian Mono, Newsreader

**38 app files, re-chunked into 35.** With two entries, Rollup named the app entry `main-*` and put code shared by both
entries into separate chunks. Those were `preload-helper-*` (220,563 bytes, the shared React/vendor code),
`jsx-runtime-*` and `store-*`. With one entry, these merge into the app's `index-*.js`:

- baseline `main.js` + `preload-helper` + `jsx-runtime` + `store` = 635,175 bytes; candidate `index-*.js` = 636,105 bytes
- `main-*.css` 75,476 → `index-*.css` 75,708 bytes

So the application's own code and the product fonts (Instrument Sans, Instrument Serif, IBM Plex Mono) are all
still shipped; only how they are chunked changed. 31 of the 32 file names common to both builds are byte-identical
(all fonts and the favicon). The exception is `index.html`, which now references the new asset names. The three new
names are `index-*.js`, `index-*.css` and `States-*.js`; the `States` chunk now contains the session 2 `AccessStates`
change. The 519-byte increase from `e759bd6` to `a30e4f3` comes from the session 2 class and region changes.

`lab-absent` (clean clone) searched `ui/dist` for any `*lab*`, `Brand-*`, `AShell-*`, `CShell-*`, `newsreader-*`,
`martian-mono-*` or `inter-*` file and found none (exit 0).

## Existing warning (not changed)

Vite reports one chunk above 500 kB (`index-*.js`, ≈636 kB, ≈181 kB gzip). This was already true at baseline, inside
the combined `main` chunk. Code-splitting the application is an architecture change outside FIX04's scope. It is
recorded in REMAINING_LIMITATIONS.md.

## Not shipped, not deployed

The output was built and served only on loopback for the tests (`vite preview` on 127.0.0.1). There was no external
deployment.
