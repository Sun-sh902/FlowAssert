/**
 * The check the "CSV check" page runs, expressed as the command-line arguments it is equivalent to:
 *
 *   flowassert-verify --source S --destination D --config C --source-encoding E --destination-encoding F
 *       [--source-complete] [--destination-complete] [--source-count N] [--destination-count N]
 *       [--allow-identical-content]
 *
 * with every premise's origin "browser form". C is the configuration file the user loaded, unchanged, or the
 * canonical bytes of the configuration chosen in the page (canonicalConfig). The page always states both encodings
 * and a scope, so a report from the page always has inputs.source_encoding, obligation.rules and obligation.scope.
 * The packaged checker (api.ts) runs this same check with an origin of its own.
 */
import { canonicalConfig, check, type CheckOutcome, type InputFile } from "./check";
import type { Encoding } from "./csv";
import type { Scope } from "./evaluator";
import { ORIGINS, type Origin } from "./report";

export interface ChosenConfig {
  key: readonly [string, string];
  fields: readonly (readonly [string, string, string])[];
  scope: Scope;
}

export interface PageCheckInput {
  source: InputFile;
  destination: InputFile;
  sourceEncoding: Encoding;
  destinationEncoding: Encoding;
  /** The configuration file the user loaded and did not change since, or the choices made in the page. */
  config: { loaded: InputFile } | { chosen: ChosenConfig };
  sourceComplete: boolean;
  destinationComplete: boolean;
  /** As typed, or null when left empty. */
  sourceCount: string | null;
  destinationCount: string | null;
  allowIdenticalContent: boolean;
  /** The browser could tell that both choices are the same file. */
  sameFile: boolean;
  /** Where the premises were stated: "browser form" unless the packaged checker (api.ts) says otherwise. */
  origin?: Origin;
  now?: () => string;
  progress?: (side: "source" | "destination", bytes: number, rows: number) => void;
  evaluating?: () => void;
}

/** The configuration file of the page's choices: its canonical bytes, under the name refusals would use. */
export function chosenConfigFile(config: ChosenConfig): InputFile {
  const bytes = new TextEncoder().encode(canonicalConfig(config));
  return { name: "configuration", size: bytes.length, read: () => bytes };
}

export function pageCheck(input: PageCheckInput): Promise<CheckOutcome> {
  return check({
    source: input.source,
    destination: input.destination,
    config: "loaded" in input.config ? input.config.loaded : chosenConfigFile(input.config.chosen),
    sourceEncoding: input.sourceEncoding,
    destinationEncoding: input.destinationEncoding,
    sourceComplete: input.sourceComplete,
    destinationComplete: input.destinationComplete,
    sourceCount: input.sourceCount ?? undefined,
    destinationCount: input.destinationCount ?? undefined,
    allowIdenticalContent: input.allowIdenticalContent,
    sameFile: input.sameFile,
    origin: input.origin ?? ORIGINS.browser,
    now: input.now,
    progress: input.progress,
    evaluating: input.evaluating,
  });
}
