/**
 * A route ID refused before any request was built (P2-AUD-003, src/data/local/ids.ts). Presented as
 * a request error — no read happened, so there is no verdict and nothing is "not found" on the Service.
 * `transportable: false` (P3A-AUD-001) is a contract-valid Verification ID that the single-segment path API
 * cannot carry unchanged ("." / ".." / "/" / a lone surrogate): it is said so, never called invalid.
 * `lookup` (ID-addressability remediation-03): for such an ID that the exact-ID query API can carry, a link to
 * #/local/verification-lookup — following it is the user's choice; nothing is requested from this page.
 * `addressing: "query"`: the refusal happened on that lookup route, so the wording names the query API.
 */
import { useEffect } from "react";
import { AccessNotice } from "../states/AccessStates";
import { buttonClass } from "../ui/primitives";
import { LocalModeStamp } from "./LocalResearch";

export function InvalidIdNotice({
  kind,
  raw,
  reason,
  back,
  transportable = true,
  lookup,
  addressing = "path",
}: {
  kind: "verification" | "history";
  raw: string;
  reason: string;
  back: { href: string; label: string };
  transportable?: boolean;
  lookup?: string;
  addressing?: "path" | "query";
}) {
  useEffect(() => {
    document.title = transportable ? `Invalid ${kind === "history" ? "history" : "verification"} ID — Local research — FlowAssert` : "Verification ID not requestable — Local research — FlowAssert";
  }, [kind, transportable]);
  return (
    <div>
      <LocalModeStamp className="mb-5" />
      <AccessNotice
        state="REQUEST_ERROR"
        headingLevel={1}
        title={!transportable ? "This verification ID cannot be requested over the local API" : kind === "history" ? "This address does not name a valid history entry" : "This address does not name a valid verification ID"}
        body={`${transportable ? "The ID in the address was refused before any request was built" : addressing === "query" ? "The frozen contract allows this ID, but no UTF-8 query value can carry it unchanged, so no request was built" : "The frozen contract allows this ID, but the local API's single path segment cannot carry it unchanged, so no request was built"}, so nothing was sent to the local service and no result exists. ${reason.charAt(0).toUpperCase()}${reason.slice(1)}. IDs are never repaired or re-encoded.${lookup ? " The exact-ID lookup carries it as a query value instead." : ""}`}
        facts={[
          ["ID as written", JSON.stringify(raw)],
          ["Reason", reason],
          ["Request", "none sent"],
          ["MOCK fallback", "none — no other data source is used"],
        ]}
        actions={
          <>
            {lookup && (
              <a className={buttonClass("default", "sm")} href={lookup} data-lookup-link>
                Open with exact-ID lookup
              </a>
            )}
            <a className={buttonClass("default", "sm")} href={back.href}>
              {back.label}
            </a>
          </>
        }
      />
    </div>
  );
}
