/** 14 · Draft editing. 15 · Validation feedback. 16 · Local draft persistence. Plus register keyboard navigation. */
import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRuleDraft } from "../data/ruleDraft";
import { currentHash, renderApp } from "./render";

beforeEach(() => clearRuleDraft());

const editor = () => screen.getByRole("region", { name: "Draft rule editor" });
const deadline = () => within(editor()).getByRole("textbox", { name: /Deadline after capture/ }) as HTMLInputElement;
const status = () => within(editor()).getAllByRole("status")[0]!;

describe("Rules register", () => {
  it("opens on the phone rule and moves through the register with ↑/↓", async () => {
    const { user } = renderApp("#/rules");
    const list = screen.getByRole("navigation", { name: "Rules" });
    const current = () => list.querySelector<HTMLElement>('[aria-current="true"]')!;
    expect(current().dataset.rule).toBe("phone");
    current().focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(current());
    expect(current().dataset.rule).not.toBe("phone");
    expect(currentHash()).toBe(`#/rules?rule=${current().dataset.rule}`);
    await user.keyboard("{ArrowUp}");
    expect(current().dataset.rule).toBe("phone");
    expect(currentHash()).toBe("#/rules");
  });

  it("shows the empty draft state when none is saved", () => {
    renderApp("#/rules");
    expect(screen.getByText("No draft in this browser")).toBeTruthy();
  });
});

describe("Draft rule editor", () => {
  it("starts from the seed, which fails the comparison check", () => {
    renderApp("#/rules");
    expect(within(editor()).getByText(/would be rejected/)).toBeTruthy();
    expect(document.getElementById("chk-comparison")!.textContent).toMatch(/^Comparison is supported: fails/);
    expect(status().textContent).toBe("Not saved yet.");
  });

  it("gives live, accessible feedback on an invalid deadline", async () => {
    const { user } = renderApp("#/rules");
    await user.clear(deadline());
    await user.type(deadline(), "ninety");
    expect(deadline().getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById(deadline().getAttribute("aria-describedby")!)!.textContent).toMatch(/Enter whole minutes/);
    await user.clear(deadline());
    await user.type(deadline(), "90");
    expect(deadline().getAttribute("aria-invalid")).toBe("false");
  });

  it("is well-formed with exact-string comparison, yet can never be approved", async () => {
    const { user } = renderApp("#/rules");
    await user.click(within(editor()).getByRole("radio", { name: "Exact string" }));
    expect(within(editor()).getByText(/Well-formed/)).toBeTruthy();
    expect(document.getElementById("chk-approval")!.textContent).toMatch(/^Approval binds this version: cannot be satisfied by a draft/);
    expect(document.getElementById("chk-comparison")!.textContent).toMatch(/: passes/);
    expect((within(editor()).getByRole("button", { name: "Submit for approval" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("saves to this browser only, adds a register entry and selects it", async () => {
    const { user } = renderApp("#/rules");
    await user.click(within(editor()).getByRole("radio", { name: "Exact string" }));
    await user.selectOptions(within(editor()).getByRole("combobox", { name: /Compared field/ }), "email");
    await user.click(within(editor()).getByRole("button", { name: "Save draft locally" }));
    expect(status().textContent).toBe("Saved in this browser. Nothing was sent to the evaluator.");
    expect(JSON.parse(localStorage.getItem("flowassert.ruleDraft")!)).toMatchObject({ field: "email", comparison: "exact-string" });
    expect(currentHash()).toBe("#/rules?rule=draft");
    expect(screen.queryByText("No draft in this browser")).toBeNull();
    expect((within(editor()).getByRole("button", { name: "Save draft locally" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports when browser storage is unavailable instead of claiming it saved", async () => {
    const { user } = renderApp("#/rules");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });
    await user.click(within(editor()).getByRole("button", { name: "Save draft locally" }));
    expect(status().textContent).toMatch(/Browser storage is unavailable/);
  });

  it("discards the draft and restores the empty state", async () => {
    const { user } = renderApp("#/rules");
    await user.click(within(editor()).getByRole("button", { name: "Save draft locally" }));
    await user.click(within(editor()).getByRole("button", { name: "Discard draft" }));
    expect(localStorage.getItem("flowassert.ruleDraft")).toBeNull();
    expect(screen.getByText("No draft in this browser")).toBeTruthy();
    expect(status().textContent).toBe("Draft discarded from this browser.");
    expect(currentHash()).toBe("#/rules");
  });
});

describe("Draft persistence across a reload", () => {
  it("reads a saved draft back from localStorage when the module loads", async () => {
    localStorage.setItem("flowassert.ruleDraft", JSON.stringify({ field: "phone", comparison: "trimmed", deadline: "45", maxAge: "10", retry: false, settling: true }));
    vi.resetModules();
    const fresh = await import("../data/ruleDraft");
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => fresh.useSavedDraft());
    expect(result.current).toEqual({ field: "phone", comparison: "trimmed", deadline: "45", maxAge: "10", retry: false, settling: true });
  });

  it("ignores malformed stored values field by field", async () => {
    localStorage.setItem("flowassert.ruleDraft", JSON.stringify({ field: "ssn", comparison: "regex", deadline: 7, retry: "yes" }));
    vi.resetModules();
    const fresh = await import("../data/ruleDraft");
    const { renderHook } = await import("@testing-library/react");
    const { result } = renderHook(() => fresh.useSavedDraft());
    expect(result.current).toEqual(fresh.SEED_DRAFT);
  });
});
