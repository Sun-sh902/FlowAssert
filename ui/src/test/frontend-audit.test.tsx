import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenderBoundary } from "../components/shell/RenderBoundary";
import { ServiceStatus } from "../components/shell/ServiceStatus";
import { LOCAL_LIMITS } from "../data/local/config";
import { exchange } from "../data/local/provider";
import { deriveWorkspaceStatusAxes } from "../domain/statusAxes";
import { exchangeSettled, resetServiceStatus } from "../data/serviceStatus";

afterEach(() => {
  vi.restoreAllMocks();
  resetServiceStatus();
});

describe("frontend audit fixes", () => {
  it("draws a failure notice instead of a blank page, with no error detail", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const Broken = (): never => {
      throw new Error("secret detail");
    };
    render(
      <RenderBoundary>
        <Broken />
      </RenderBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("could not be drawn");
    expect(document.body.textContent).not.toContain("secret detail");
  });

  it("keeps the changing age out of the live region", () => {
    exchangeSettled({ kind: "REACHABLE", at: Date.now(), path: "/api/v1/history" });
    render(<ServiceStatus />);
    const live = screen.getByRole("status");
    expect(live.textContent).toContain("Service reachable");
    expect(live.textContent).not.toMatch(/ago/);
    expect(document.body.textContent).toMatch(/s ago/);
  });

  it("stops reading a response just past the size limit", async () => {
    const chunk = new TextEncoder().encode("x".repeat(1_000_000));
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
    });
    const fetchImpl = (async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const ex = await exchange(fetchImpl, "/api/v1/history", 5000);
    expect(ex.kind === "response" && ex.text.length > LOCAL_LIMITS.maxBodyChars).toBe(true);
    expect(pulls).toBeLessThan(10);
  });

  it("never shows live capture status beside an archived verdict with no statement", () => {
    const live = { id: "SPEC-001", state: "Verified", phase3b: { captureStatus: "CAPTURED_COMPLETE", admissionStatus: "ADMITTED_RUN_BOUND", runBound: null } } as never;
    const latest = { historyId: "h", archivedAt: "t", integrity: { status: "INTEGRITY_VERIFIED" }, result: { cohort: "Mismatch" }, phase3b: null } as never;
    const axes = deriveWorkspaceStatusAxes({ live, latest });
    expect(axes.capture.kind).toBe("NOT_IMPLEMENTED");
    expect(axes.admission.kind).toBe("NOT_IMPLEMENTED");
  });
});
