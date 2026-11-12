/**
 * "Records to resend" on the CSV check page (docs/design/1.1-exports.md): each file the result has, with its row count
 * and meaning, offered before anything is read again; the bytes the command line's --export-dir writes, built only
 * when a button is pressed; the warnings beside the unknown file, a list of missing records not established and text
 * a spreadsheet would run; and a file changed since the check refused.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "../pages/Check";
import { inThreadRunner, resendOf, runCheckKeeping, type CheckRunner, type RunInput } from "../offline/runner";
import { REPO_ROOT } from "./fixtures/sources";

const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });

let saved: { blob: Blob; name: string }[] = [];

beforeEach(() => {
  saved = [];
  // jsdom has no object URLs; record what the page would save instead.
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (blob: Blob) => (saved.push({ blob, name: "" }), "blob:test"), revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1]!.name = this.download;
  });
});

afterEach(() => vi.unstubAllGlobals());

/** The example check, with or without both completeness statements, on a runner whose exportFile calls are counted. */
async function checked(statements: boolean) {
  const runner = inThreadRunner();
  const asked: string[] = [];
  const released: number[] = [];
  const counted: CheckRunner = { ...runner, exportFile: (file) => (asked.push(file), runner.exportFile(file)), release: () => (released.push(1), runner.release()) };
  const user = userEvent.setup();
  render(<Check runner={counted} />);
  await user.upload(screen.getByTestId("source-file"), example("source.csv"));
  await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
  await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
  await user.selectOptions(screen.getByTestId("key-source"), "external_id");
  await user.selectOptions(screen.getByTestId("key-destination"), "external_id");
  await user.selectOptions(screen.getByTestId("field-0-source"), "phone");
  await user.selectOptions(screen.getByTestId("field-0-destination"), "phone");
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  await user.selectOptions(screen.getByTestId("field-1-source"), "email");
  await user.selectOptions(screen.getByTestId("field-1-destination"), "hs_email");
  if (statements) {
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
  }
  await user.click(screen.getByTestId("run-check"));
  const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
  return { user, asked, released, section: within(result).getByTestId("records-to-resend") };
}

const offered = (section: HTMLElement) => [...section.querySelectorAll("[data-export]")].map((e) => [e.getAttribute("data-export"), within(e as HTMLElement).getByTestId("export-rows").textContent]);

describe("Records to resend", () => {
  it("offers each file with its row count and meaning, and reads nothing again until a button is pressed", async () => {
    const { user, asked, section } = await checked(true);
    expect(within(section).getByRole("heading", { level: 3 }).textContent).toBe("Export records to fix");
    expect(offered(section)).toEqual([
      ["missing-from-destination.csv", "1 row"],
      ["values-differ.csv", "1 row"],
      ["duplicated-in-destination.csv", "1 row"],
    ]);
    expect(section.querySelector('[data-export="missing-from-destination.csv"]')!.textContent).toContain("The destination, stated complete, has no row with this key: these records did not arrive.");
    expect(within(section).queryByTestId("resend-no-missing")).toBeNull();
    expect(asked).toEqual([]);
    expect(saved).toEqual([]);

    const missing = section.querySelector('[data-export="missing-from-destination.csv"]') as HTMLElement;
    await user.click(within(missing).getByTestId("download-export"));
    await waitFor(() => expect(saved.map((s) => s.name)).toEqual(["missing-from-destination.csv"]));
    expect(asked).toEqual(["missing-from-destination.csv"]);
    // The bytes --export-dir writes: a byte order mark, the source's header and the row as read, CR LF.
    expect([...new Uint8Array(await saved[0]!.blob.arrayBuffer())]).toEqual([...new TextEncoder().encode("\ufeffexternal_id,phone,email\r\nSYN-003,+1 212 555 0103,alan@example.test\r\n")]);
    // The phone begins with "+": one field a spreadsheet would run.
    expect((await within(missing).findByTestId("export-formula-warning")).textContent).toMatch(/^1 field in this file begins with =, \+, -, @, a tab or a carriage return\. /);
  });

  it("without the destination stated complete: no list of missing records, and the unknown file's warning", async () => {
    const { section } = await checked(false);
    expect(within(section).getByTestId("resend-no-missing").textContent).toBe("No list of missing records: the destination was not stated complete, so absence is not established.");
    expect(offered(section).map(([f]) => f)).not.toContain("missing-from-destination.csv");
    const unknown = section.querySelector('[data-export="unknown-status-resending-may-create-duplicates.csv"]') as HTMLElement;
    expect(within(unknown).getByTestId("export-unknown-warning").textContent).toBe(
      "The check could not conclude for these records. Some may already be in the destination; resending them may create duplicates.",
    );
  });
});

describe("letting go of a result", () => {
  it("a change to a choice removes the result, and the runner lets go of what it kept for it", async () => {
    const { user, released } = await checked(true);
    expect(released).toEqual([]);
    await user.click(screen.getByTestId("destination-complete"));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Result" })).toBeNull());
    expect(released).toEqual([1]);
  });
});

describe("the records to resend of a runner", () => {
  const input = (source: File): RunInput => ({
    source,
    destination: example("destination.csv"),
    sourceEncoding: "utf-8",
    destinationEncoding: "utf-8",
    config: { chosen: { key: ["external_id", "external_id"], fields: [["phone", "phone", "exact"]], scope: "source" } },
    sourceComplete: true,
    destinationComplete: true,
    sourceCount: null,
    destinationCount: null,
    allowIdenticalContent: false,
  });

  it("refuses a file that is not the one checked, and builds nothing", async () => {
    const [, report] = await runCheckKeeping(input(example("source.csv")), () => undefined);
    const changed = new File([readFileSync(join(REPO_ROOT, "offline/examples/source.csv"), "utf-8") + "SYN-009,x,y\r\n"], "source.csv");
    expect(await resendOf(input(changed), report!)("missing-from-destination.csv")).toEqual({ ok: false, message: "source.csv: changed after it was checked; nothing was exported" });
    const same = await resendOf(input(example("source.csv")), report!)("missing-from-destination.csv");
    expect(same.ok).toBe(true);
  });

  it("has nothing to export once it let go of the result", async () => {
    const runner = inThreadRunner();
    await runner.run(input(example("source.csv")), () => undefined);
    expect((await runner.exportFile("missing-from-destination.csv")).ok).toBe(true);
    runner.release();
    expect(await runner.exportFile("missing-from-destination.csv")).toEqual({ ok: false, message: "There is no result to export: run the check again." });
  });

  it("has nothing to export before a check or after a refused one", async () => {
    const runner = inThreadRunner();
    expect(await runner.exportFile("values-differ.csv")).toEqual({ ok: false, message: "There is no result to export: run the check again." });
    const result = await runner.run({ ...input(example("source.csv")), destination: example("source.csv") }, () => undefined);
    expect(result.resend).toBeNull();
    expect((await runner.exportFile("values-differ.csv")).ok).toBe(false);
  });
});
