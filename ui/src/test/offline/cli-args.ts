/**
 * Test helper: the command-line arguments of a golden or random parity case, read as cli.main's argparse reads the
 * forms those cases use (full option names, each value as the next argument), with files read from `folder`.
 */
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CheckArgs, InputFile } from "../../offline/check";

const VALUES: Record<string, keyof CheckArgs> = {
  "--key": "key",
  "--scope": "scope",
  "--source-count": "sourceCount",
  "--destination-count": "destinationCount",
  "--source-encoding": "sourceEncoding",
  "--destination-encoding": "destinationEncoding",
  "--source-format": "sourceFormat",
  "--destination-format": "destinationFormat",
  "--source-worksheet": "sourceWorksheet",
  "--destination-worksheet": "destinationWorksheet",
  "--max-bytes": "maxBytes",
  "--max-rows": "maxRows",
  "--max-details": "maxDetails",
  "--details": "details",
};
const FLAGS: Record<string, keyof CheckArgs> = {
  "--source-complete": "sourceComplete",
  "--destination-complete": "destinationComplete",
  "--allow-identical-content": "allowIdenticalContent",
  "--redact-values": "redactValues",
};

export function inputFile(folder: string, path: string): InputFile {
  const full = join(folder, path);
  return { name: path, size: statSync(full).size, read: () => new Uint8Array(readFileSync(full)) };
}

/** The check arguments of a case that reads two files. */
export function parseArgs(argv: readonly string[], folder: string): CheckArgs & { source: InputFile; destination: InputFile } {
  const args = parseAnyArgs(argv, folder);
  if (!args.source || !args.destination) throw new Error("a case without two files: use parseAnyArgs");
  return args as CheckArgs & { source: InputFile; destination: InputFile };
}

const CONNECTOR_VALUES: Record<string, keyof CheckArgs> = {
  "--source-sheet": "sourceSheet",
  "--source-range": "sourceRange",
  "--source-timeout": "sourceTimeout",
  "--destination-hubspot": "destinationHubspot",
  "--destination-timeout": "destinationTimeout",
};

/** The check arguments of any case, connector cases included: a side a connector reads has no file. */
export function parseAnyArgs(argv: readonly string[], folder: string): CheckArgs {
  const args: Record<string, unknown> = { field: [] };
  let source: string | undefined;
  let destination: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i]!;
    if (option in FLAGS) args[FLAGS[option]!] = true;
    else if (option === "--field") (args.field as string[]).push(argv[++i]!);
    else if (option === "--source") source = argv[++i]!;
    else if (option === "--destination") destination = argv[++i]!;
    else if (option === "--config") args.config = inputFile(folder, argv[++i]!);
    else if (option === "--mapping") args.mapping = inputFile(folder, argv[++i]!);
    else if (option === "--json" || option === "--html") i++;
    else if (option in VALUES) args[VALUES[option]!] = argv[++i]!;
    else if (option in CONNECTOR_VALUES) args[CONNECTOR_VALUES[option]!] = argv[++i]!;
    else if (option === "--skip-source-revision") args.skipSourceRevision = true;
    else throw new Error(`unexpected argument ${option}`);
  }
  if (!(args.field as string[]).length) delete args.field;
  return {
    ...(args as Partial<CheckArgs>),
    ...(source !== undefined ? { source: inputFile(folder, source) } : {}),
    ...(destination !== undefined ? { destination: inputFile(folder, destination) } : {}),
    sameFile: source !== undefined && destination !== undefined && realpathSync(join(folder, source)) === realpathSync(join(folder, destination)),
  };
}
