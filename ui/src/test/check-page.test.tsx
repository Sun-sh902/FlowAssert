/**
 * The CSV check page (#/check): choices are made by the user and nothing is preselected, the check gives the command
 * line's summary and reports (origin "browser form"), refusals show no result, and nothing the user states is stored.
 * The check runs in this thread here (inThreadRunner); the browser suite runs it in the real Web Worker.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Check } from "../pages/Check";
import { inThreadRunner } from "../offline/runner";
import { REPO_ROOT } from "./fixtures/sources";
import { renderApp } from "./render";

const golden = (name: string, file: string) => readFileSync(join(REPO_ROOT, "offline/golden", name, file), "utf-8");
const example = (file: string) => new File([readFileSync(join(REPO_ROOT, "offline/examples", file))], file, { type: "text/csv" });
const asBrowser = (text: string) => text.replaceAll('"origin": "command-line option"', '"origin": "browser form"').replaceAll("<td>command-line option</td>", "<td>browser form</td>");
const anyTime = (text: string) => text.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{6})?Z/g, "TIME");

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

async function chooseExample() {
  const user = userEvent.setup();
  render(<Check runner={inThreadRunner()} />);
  await user.upload(screen.getByTestId("source-file"), example("source.csv"));
  await user.upload(screen.getByTestId("destination-file"), example("destination.csv"));
  await waitFor(() => expect(screen.getAllByText("3 columns")).toHaveLength(2));
  return user;
}

async function chooseColumns(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByTestId("key-source"), "external_id");
  await user.selectOptions(screen.getByTestId("key-destination"), "external_id");
  await user.selectOptions(screen.getByTestId("field-0-source"), "phone");
  await user.selectOptions(screen.getByTestId("field-0-destination"), "phone");
  await user.click(screen.getByRole("button", { name: "Add a field" }));
  await user.selectOptions(screen.getByTestId("field-1-source"), "email");
  await user.selectOptions(screen.getByTestId("field-1-destination"), "hs_email");
}

describe("CSV check page", () => {
  it("preselects nothing: no column, no rule beyond exact, no premise, no count", async () => {
    await chooseExample();
    expect((screen.getByTestId("key-source") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("key-destination") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("");
    expect((screen.getByTestId("source-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("destination-complete") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("allow-identical") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("source-count") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("scope-source") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId("run-check") as HTMLButtonElement).disabled).toBe(true);
  });

  it("gives the command line's summary and reports, with the premises' origin the browser form", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.click(screen.getByTestId("destination-complete"));
    await user.click(screen.getByTestId("run-check"));
    const result = await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(within(result).getByTestId("summary").textContent).toBe(golden("example-page", "stdout.txt"));
    expect(result.querySelector(".fa-seal")?.getAttribute("data-s")).toBe("Mismatch");
    expect(within(result).getByText("No claim is made: the result is not Verified.")).toBeTruthy();
    // Every stated premise is shown beside the result, with its origin.
    for (const name of ["source_complete", "destination_complete", "source_count", "destination_count"]) {
      expect(result.querySelector(`[data-premise="${name}"]`)?.textContent).toContain("browser form");
    }
    await user.click(screen.getByTestId("download-json"));
    await user.click(screen.getByTestId("download-html"));
    expect(saved.map((s) => s.name)).toEqual(["flowassert-report.json", "flowassert-report.html"]);
    expect(anyTime(await saved[0]!.blob.text())).toBe(anyTime(asBrowser(golden("example-page", "report.json"))));
    expect(anyTime(await saved[1]!.blob.text())).toBe(anyTime(asBrowser(golden("example-page", "report.html"))));
  });

  it("stores nothing the user chose or stated, and leaves the address alone", async () => {
    const before = window.location.href;
    const user = await chooseExample();
    await chooseColumns(user);
    await user.click(screen.getByTestId("source-complete"));
    await user.type(screen.getByTestId("source-count"), "4");
    await user.click(screen.getByTestId("run-check"));
    await screen.findByRole("region", { name: "Result" }, { timeout: 5000 });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
    expect(window.location.href).toBe(before);
  });

  it("shows a refusal, and no result, for a malformed file", async () => {
    const user = userEvent.setup();
    render(<Check runner={inThreadRunner()} />);
    await user.upload(screen.getByTestId("source-file"), new File(['k,p\n"1,2\n'], "bad.csv"));
    await user.upload(screen.getByTestId("destination-file"), new File(["k,p\n1,2\n"], "d.csv"));
    await waitFor(() => expect(screen.getAllByText("2 columns")).toHaveLength(2));
    await user.selectOptions(screen.getByTestId("key-source"), "k");
    await user.selectOptions(screen.getByTestId("key-destination"), "k");
    await user.selectOptions(screen.getByTestId("field-0-source"), "p");
    await user.selectOptions(screen.getByTestId("field-0-destination"), "p");
    await user.click(screen.getByTestId("run-check"));
    const refusal = await screen.findByTestId("refusal", {}, { timeout: 5000 });
    expect(refusal.textContent).toContain("bad.csv: unexpected end of data");
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
  });

  it("downloads the configuration in its canonical form and loads it back with the CLI's validation", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.selectOptions(screen.getByTestId("field-1-rule"), "casefold");
    await user.click(screen.getByTestId("download-config"));
    expect(saved[0]!.name).toBe("flowassert-config.json");
    expect(await saved[0]!.blob.text()).toBe(
      '{\n  "key": [\n    "external_id",\n    "external_id"\n  ],\n  "fields": [\n    {\n      "source": "phone",\n      "destination": "phone",\n      "rule": "exact"\n    },\n' +
        '    {\n      "source": "email",\n      "destination": "hs_email",\n      "rule": "casefold"\n    }\n  ],\n  "scope": "source"\n}\n',
    );
    const refused = new File(['{"key": ["k", "k"], "fields": [{"source": "p", "destination": "p"}], "source_complete": true}'], "with-premise.json");
    await user.upload(screen.getByTestId("config-file"), refused);
    expect(await screen.findByText(/cannot be set in a configuration file/)).toBeTruthy();
    await user.upload(screen.getByTestId("config-file"), new File([golden("config-loaded-with-bom", "config.json")], "config.json"));
    expect(await screen.findByText("Configuration loaded:")).toBeTruthy();
    expect((screen.getByTestId("field-1-rule") as HTMLSelectElement).value).toBe("casefold");
  });

  it("refuses a date format with a directive the browser does not support, before any check", async () => {
    const user = await chooseExample();
    await chooseColumns(user);
    await user.selectOptions(screen.getByTestId("field-0-rule"), "date");
    await user.type(screen.getByTestId("field-0-format"), "%Y %a");
    expect(await screen.findByText(/does not support/)).toBeTruthy();
    expect((screen.getByTestId("run-check") as HTMLButtonElement).disabled).toBe(true);
  });

  it("suggests same-named pairs only when asked", async () => {
    const user = await chooseExample();
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByTestId("suggest-pairs"));
    expect(screen.queryByTestId("field-1-source")).toBeTruthy();
    expect((screen.getByTestId("field-0-source") as HTMLSelectElement).value).toBe("external_id");
    expect((screen.getByTestId("field-1-source") as HTMLSelectElement).value).toBe("phone");
  });

  it("is in the app at #/check with its own navigation entry", async () => {
    renderApp("#/check");
    expect(await screen.findByRole("heading", { level: 1, name: "CSV check" }, { timeout: 5000 })).toBeTruthy();
    const nav = screen.getAllByRole("navigation", { name: "Browser check" })[0]!;
    expect(within(nav).getByRole("link", { name: /CSV check/ }).getAttribute("aria-current")).toBe("page");
  });
});
