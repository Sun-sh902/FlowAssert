/** Inputs shared by the contract drift tests. Read-only: nothing here writes the contract or the mirror. */
import { CONTRACT_VERSION, V1_PATHS } from "../../data/contract/v1";
import mirrorSource from "../../data/contract/v1.ts?raw";
import { requiredFixture } from "../fixtures/sources";
import type { Binding } from "./guard";

/** The reviewed Phase 0 contract: the Service's pinned copy (byte-identical to FlowAssert-Integration-Planning's). Override with FLOWASSERT_OPENAPI. */
export const CONTRACT = requiredFixture("FLOWASSERT_OPENAPI", "service/contracts/openapi-v1-proposed.yaml");
/** The additive Phase 3A history contract (the Service's pinned copy). Override with FLOWASSERT_HISTORY_OPENAPI. */
export const HISTORY_CONTRACT = requiredFixture("FLOWASSERT_HISTORY_OPENAPI", "service/contracts/openapi-history-v1.yaml");
/** The additive exact-ID query contract (the Service's pinned copy). Override with FLOWASSERT_LOOKUP_OPENAPI. */
export const LOOKUP_CONTRACT = requiredFixture("FLOWASSERT_LOOKUP_OPENAPI", "service/contracts/openapi-id-addressability-v1.yaml");

/** The wire mirror's own source text; the guard parses it rather than trusting a hand-kept copy. */
export const MIRROR_SOURCE: string = mirrorSource;

/** How the mirror's declarations attach to the contract's endpoints (restates the v1.ts header). */
export const BINDING: Binding = {
  version: CONTRACT_VERSION,
  paths: V1_PATHS,
  roots: { verification: "VerificationRun", evidence: "EvidencePage" },
  queries: { verification: "DetailQueryDTO", evidence: "EvidenceQueryDTO" },
  error: "Error",
};

/** Contract schemas outside the Detail/evidence slice. Mirrored only when their screens are authorized. */
export const UNMIRRORED_SCHEMAS = ["ResultSummary", "RunSummary", "VerificationList", "WorkflowList", "TrendDay", "OverviewScope", "Overview"] as const;
