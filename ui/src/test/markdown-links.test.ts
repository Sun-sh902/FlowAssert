/**
 * Every relative link and anchor in the repository's Markdown files resolves: a linked file or folder exists, and a
 * linked heading exists in the file it names, with anchors made as GitHub makes them. Every Markdown file is checked,
 * except the four pinned files named below.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT } from "./fixtures/sources";

/**
 * Files whose bytes are pinned, so they cannot be corrected, and whose links name paths on the original machine or
 * generated folders that are not published: the frozen frontend contract and its Phase 1 baseline copy, and two Phase 2
 * reports recorded in service/evidence/protected-reconciled-20261031.json. Links into them are still checked.
 */
const PINNED = new Set([
  "service/contracts/frontend-provider-contract.md",
  "service/baseline/FlowAssert-Service/contracts/frontend-provider-contract.md",
  "ui/docs/PHASE2_5_FRONTEND_READINESS.md",
  "ui/docs/PHASE2_INTEGRATION_REPORT.md",
]);

const files = execFileSync("git", ["ls-files", "*.md"], { cwd: REPO_ROOT, encoding: "utf-8" })
  .split("\n")
  .filter((f) => f && !f.startsWith(".venv") && !PINNED.has(f));

/** The text of a Markdown file without fenced code blocks, where a link is not a link. */
const withoutCode = (text: string) => text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");

/** GitHub's anchor for a heading (github-slugger): lower case, punctuation and symbols removed, spaces to hyphens. */
export function slug(heading: string): string {
  const text = heading
    .replace(/<[^>]+>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_)(?=\S)([^*_]*?\S)\1/g, "$2")
    .trim();
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
}

const anchorCache = new Map<string, Set<string>>();

/** The anchors of a Markdown file: one per heading, numbered when repeated, and explicit <a id> or <a name>. */
function anchorsOf(path: string): Set<string> {
  const cached = anchorCache.get(path);
  if (cached) return cached;
  const text = withoutCode(readFileSync(path, "utf-8"));
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) anchors.add(m[1]!);
  anchorCache.set(path, anchors);
  return anchors;
}

/** The relative links of a file, with their line numbers: inline links, images, reference definitions, <img src>. */
function linksOf(file: string): { line: number; target: string }[] {
  const text = withoutCode(readFileSync(join(REPO_ROOT, file), "utf-8"));
  const out: { line: number; target: string }[] = [];
  const lines = text.split("\n");
  for (const [i, raw] of lines.entries()) {
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/!?\[(?:[^\]]|\][^(])*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) out.push({ line: i + 1, target: m[1]! });
    for (const m of line.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/g)) out.push({ line: i + 1, target: m[1]! });
    for (const m of line.matchAll(/<img\s[^>]*src="([^"]+)"/g)) out.push({ line: i + 1, target: m[1]! });
  }
  return out.filter((l) => !/^[a-z][a-z0-9+.-]*:/i.test(l.target));
}

function problems(file: string): string[] {
  const out: string[] = [];
  for (const { line, target } of linksOf(file)) {
    const [pathPart, anchor] = target.split("#", 2) as [string, string | undefined];
    const path = pathPart ? normalize(join(dirname(join(REPO_ROOT, file)), decodeURI(pathPart))) : join(REPO_ROOT, file);
    if (relative(REPO_ROOT, path).startsWith("..")) {
      out.push(`${file}:${line}: ${target} leaves the repository`);
      continue;
    }
    if (!existsSync(path)) {
      out.push(`${file}:${line}: ${target}: no such file`);
      continue;
    }
    if (anchor === undefined || anchor === "") continue;
    if (!path.endsWith(".md") || statSync(path).isDirectory()) continue;
    if (!anchorsOf(path).has(decodeURIComponent(anchor).toLowerCase())) out.push(`${file}:${line}: ${target}: no heading with this anchor`);
  }
  return out;
}

describe("Markdown links", () => {
  test("the anchors are made as GitHub makes them", () => {
    expect(slug("Check in your browser")).toBe("check-in-your-browser");
    expect(slug("`FILE: not UTF-8`")).toBe("file-not-utf-8");
    expect(slug("Quick start: run the Service and UI")).toBe("quick-start-run-the-service-and-ui");
    expect(slug("快速开始：比较两个 CSV 文件")).toBe("快速开始比较两个-csv-文件");
    expect(slug("为什么我的结果是 Unverified？")).toBe("为什么我的结果是-unverified");
    expect(slug("6. What the result does not prove")).toBe("6-what-the-result-does-not-prove");
  });

  test("the files checked include the README, the guides, the FAQ, the development page and the roadmap", () => {
    for (const f of ["README.md", "docs/faq.md", "docs/development.md", "docs/guides/refusals.md", "docs/ROADMAP.md", "CHANGELOG.md"]) expect(files).toContain(f);
  });

  test.each(files)("%s", (file) => {
    expect(problems(file)).toEqual([]);
  });
});
