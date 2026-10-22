/** Inputs shared by the contract drift tests. Read-only: nothing here writes the contract or the mirror. */
import { CONTRACT_VERSION, V1_PATHS } from "../../data/contract/v1";
import mirrorSource from "../../data/contract/v1.ts?raw";
import type { Binding } from "./guard";

/** The reviewed Phase 0 contract, in a read-only sibling repository. Override with FLOWASSERT_OPENAPI. */
export const CONTRACT = process.env.FLOWASSERT_OPENAPI ?? "/Users/zhangshenghe/Documents/FlowAssert-Integration-Planning/contracts/openapi-v1-proposed.yaml";

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
