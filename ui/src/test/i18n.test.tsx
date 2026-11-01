/** Simplified Chinese presentation layer: what it changes, what it must leave alone, and that English is untouched. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageLocale, setLocale } from "../i18n/locale";
import { startLocalizer } from "../i18n/localizer";
import { translate } from "../i18n/translate";
import { EXACT } from "../i18n/zh-CN";

const settle = () => new Promise((r) => setTimeout(r));

describe("translate", () => {
  it("translates a catalogued string and keeps its surrounding spaces", () => {
    expect(translate("Overview")).toBe("总览");
    expect(translate(" Overview ")).toBe(" 总览 ");
  });

  it("carries numbers through, including where Chinese reorders them", () => {
    expect(translate("3 records")).toBe("3 条记录");
    expect(translate("2 of 7 records lack sufficient evidence.")).toBe("7 条记录中有 2 条证据不足。");
  });

  it("translates each known part of a composed label and keeps the rest", () => {
    expect(translate("LOCAL_RESEARCH · synthetic")).toBe("LOCAL_RESEARCH · 合成");
  });

  it("translates a message assembled from known sentences", () => {
    const text = "No provider answered. Nothing is shown in place of a result, and no other data source is used instead. HTTP 502 without a FlowAssert error envelope — the local service did not answer (proxy or transport failure). Start it with scripts/dev/service.sh, then read again.";
    expect(translate(text)).toBe("没有数据源响应。不显示任何替代结果，也不使用其他数据源。HTTP 502 没有 FlowAssert 错误信封：本地服务没有响应（代理或传输故障）。用 scripts/dev/service.sh 启动后再重新读取。");
  });

  it("maps the four verdicts to four distinct words", () => {
    const words = ["Verified", "Mismatch", "Pending", "Unverified"].map(translate);
    expect(new Set(words).size).toBe(4);
    expect(words).not.toContain("Verified");
  });

  it.each([
    "SPEC-002",
    "b61779e1…842d",
    "hist_a10029f2…b940",
    "Maya Varga",
    "exact string comparison",
    "reliable candidate observed",
    "insufficient evidence",
    "waiting window or insufficient absence evidence",
    "expected key not found at observation at or after deadline",
    "missing, null, inaccessible, or unsupported phone type",
    "SHA-256 identifies supplied values and code, not authentic origin, independent collection or complete external population.",
  ])("leaves %s exactly as supplied", (text) => {
    expect(translate(text)).toBe(text);
  });

  it("has no catalogue key that could never match", () => {
    expect(Object.keys(EXACT).filter((k) => /\d|[，；：（）]/.test(k))).toEqual([]);
  });

  it("translates a sentence that quotes a supplied value, and keeps the value", () => {
    expect(translate("HubSpot phone is “restaurant”; the captured source has “+1 415 555 1038”.")).toBe("HubSpot 电话是“restaurant”，已采集的来源是“+1 415 555 1038”。");
  });

  it("does not catalogue a reason the pinned evaluator writes", () => {
    const model = readFileSync(resolve(__dirname, "../../../service/vendor/model.py"), "utf8");
    const reasons = [...model.matchAll(/"([a-z][a-z ,/-]{12,})"/g)].map((m) => m[1]!);
    expect(reasons.length).toBeGreaterThan(10);
    expect(reasons.filter((r) => Object.hasOwn(EXACT, r))).toEqual([]);
  });

  it("uses full-width punctuation between Chinese text", () => {
    expect(Object.values(EXACT).filter((v) => /[一-鿿][,;:]|[,;:][一-鿿]/.test(v))).toEqual([]);
  });
});

describe("localizer", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
  });

  it("translates text and accessible names, now and when they change", async () => {
    document.body.innerHTML = `<main><h1>Overview</h1><button aria-label="Check">x</button></main>`;
    stop = startLocalizer();
    expect(document.querySelector("h1")!.textContent).toBe("总览");
    expect(document.querySelector("button")!.getAttribute("aria-label")).toBe("检查");

    document.querySelector("h1")!.firstChild!.nodeValue = "History";
    const added = document.createElement("p");
    added.textContent = "Settings";
    document.querySelector("main")!.append(added);
    await settle();
    expect(document.querySelector("h1")!.textContent).toBe("历史");
    expect(added.textContent).toBe("设置");
  });

  it("never touches code, preformatted evidence or a marked region", () => {
    document.body.innerHTML = `<code>Overview</code><pre>Pending</pre><div data-no-translate><span title="Check">History</span></div><textarea>Rules</textarea>`;
    stop = startLocalizer();
    expect(document.querySelector("code")!.textContent).toBe("Overview");
    expect(document.querySelector("pre")!.textContent).toBe("Pending");
    expect(document.querySelector("span")!.textContent).toBe("History");
    expect(document.querySelector("span")!.title).toBe("Check");
    expect(document.querySelector("textarea")!.value).toBe("Rules");
  });

  it("stops when asked", async () => {
    document.body.innerHTML = `<h1>x</h1>`;
    startLocalizer()();
    document.querySelector("h1")!.textContent = "Overview";
    await settle();
    expect(document.querySelector("h1")!.textContent).toBe("Overview");
  });
});

describe("language preference", () => {
  afterEach(() => localStorage.clear());

  it("defaults to English", () => {
    expect(pageLocale()).toBe("en");
  });

  it("stores a change and reloads once", () => {
    const reload = vi.fn();
    setLocale("zh-CN", reload);
    expect(localStorage.getItem("flowassert.locale")).toBe("zh-CN");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does nothing when the language is already selected", () => {
    const reload = vi.fn();
    setLocale("en", reload);
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem("flowassert.locale")).toBeNull();
  });
});
