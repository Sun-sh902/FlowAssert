/**
 * Test helper: the golden cases the node can express, its parameters for each, and what the command line gave. A case
 * the node can express is one the CSV check page can run with the configuration as the page writes it (case.json's
 * `page`, with `config: "canonical"`): the node also gives its key and fields as a configuration, whose bytes are the
 * same. The premises' origin is the node's, "n8n node".
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const GOLDEN = join(REPO, "offline/golden");
export const PYTHON = process.env.FA_PYTHON ?? "python3";

const caseOf = (name) => JSON.parse(readFileSync(join(GOLDEN, name, "case.json"), "utf-8"));

export const NODE_CASES = readdirSync(GOLDEN)
	.sort()
	.filter((name) => caseOf(name).page?.config === "canonical");

/** The node's parameters for a golden case. */
export function parametersOf(name) {
	const folder = join(GOLDEN, name);
	const page = caseOf(name).page;
	const config = JSON.parse(readFileSync(join(folder, "config.json"), "utf-8"));
	return {
		sourceEncoding: page.source_encoding,
		destinationEncoding: page.destination_encoding,
		sourceKey: config.key[0],
		destinationKey: config.key[1],
		fields: {
			field: config.fields.map((f) => {
				const date = f.rule.startsWith("date:");
				return { sourceColumn: f.source, destinationColumn: f.destination, rule: date ? "date" : f.rule, ...(date ? { dateFormat: f.rule.slice(5) } : {}) };
			}),
		},
		scope: config.scope,
		sourceComplete: page.source_complete,
		destinationComplete: page.destination_complete,
		sourceCount: page.source_count ?? "",
		destinationCount: page.destination_count ?? "",
		allowIdenticalContent: page.allow_identical_content,
	};
}

/** What the command line gave for a case, with the node's origin, and its records to resend when Python is found. */
export function expected(name) {
	const folder = join(GOLDEN, name);
	const read = (f) => readFileSync(join(folder, f), "utf-8");
	const exit = Number(read("exit_status.txt"));
	return {
		exit,
		stdout: asNode(read("stdout.txt")),
		stderr: read("stderr.txt"),
		json: exit === 2 ? null : asNode(read("report.json")),
		exports: HAS_PYTHON && exit !== 2 ? cliExports(folder, caseOf(name).args) : null,
	};
}

export const asNode = (text) => text.replaceAll("command-line option", "n8n node");
export const timeless = (text) => text.replace(/"evaluated_at": "[^"]*"/, '"evaluated_at": ""');

function pythonUsable() {
	try {
		execFileSync(PYTHON, ["-c", "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"]);
		return true;
	} catch {
		return false;
	}
}
export const HAS_PYTHON = pythonUsable();

/** The files offline/verify.py --export-dir writes for a case, by name. */
function cliExports(folder, args) {
	const out = mkdtempSync(join(tmpdir(), "fa-node-"));
	try {
		try {
			execFileSync(PYTHON, [join(REPO, "offline/verify.py"), ...args, "--export-dir", join(out, "x")], { cwd: folder, stdio: "pipe" });
		} catch (e) {
			if (![1, 3].includes(e.status)) throw e;
		}
		const dir = join(out, "x");
		return Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))]));
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}
