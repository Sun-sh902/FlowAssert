/**
 * The FlowAssert node in a real n8n, run locally: every golden case the node can express (test/cases.mjs) is a
 * workflow, Manual Trigger, two "Read/Write Files from Disk" nodes, Merge by position and the FlowAssert node, imported
 * and executed with n8n's own command line. Each must give the command line's state, exit status, summary, JSON
 * report and records to resend (those with Python). The build must exist (npm run build).
 *
 *   node test/n8n-run.mjs --n8n "npx --yes n8n@2.47.5"
 *   node test/n8n-run.mjs --n8n /path/to/node_modules/.bin/n8n --out result.json
 *
 * n8n runs with a new temporary user folder (N8N_USER_FOLDER), the node loaded from a copy of dist/ as a custom
 * extension (N8N_CUSTOM_EXTENSIONS), file access limited to the cases' folder, binary data kept in the execution,
 * and telemetry, version notifications and templates turned off. Nothing is sent anywhere; the folder is removed at
 * the end. n8n Cloud is not tested.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GOLDEN, HAS_PYTHON, NODE_CASES, expected, parametersOf, timeless } from "./cases.mjs";

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const command = (option("--n8n") ?? "npx --yes n8n@2.47.5").split(" ");
const OUTPUTS = ["Result", "Missing From Destination", "Values Differ", "Duplicated in Destination", "Unknown Status (Resending May Duplicate)", "Only in Destination", "Only in Destination (Not Concluded)"];
const FILES = [null, "missing-from-destination.csv", "values-differ.csv", "duplicated-in-destination.csv", "unknown-status-resending-may-create-duplicates.csv", "only-in-destination.csv", "only-in-destination-not-concluded.csv"];

// Resolved: n8n compares the real path of a file it reads with the folder it may read (on macOS /var is a link).
const root = realpathSync(mkdtempSync(join(tmpdir(), "fa-n8n-")));
const env = {
	...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("N8N_"))),
	N8N_USER_FOLDER: join(root, "user"),
	N8N_CUSTOM_EXTENSIONS: join(root, "extensions"),
	N8N_RESTRICT_FILE_ACCESS_TO: join(root, "cases"),
	N8N_DEFAULT_BINARY_DATA_MODE: "default",
	N8N_DIAGNOSTICS_ENABLED: "false",
	N8N_VERSION_NOTIFICATIONS_ENABLED: "false",
	N8N_TEMPLATES_ENABLED: "false",
	N8N_PERSONALIZATION_ENABLED: "false",
	N8N_PORT: "5799",
	N8N_RUNNERS_BROKER_PORT: "5798",
};
const n8n = (...rest) => spawnSync(command[0], [...command.slice(1), ...rest], { env, cwd: root, encoding: "utf-8", maxBuffer: 1 << 28 });

/** One case's workflow. */
function workflow(index, name) {
	const folder = join(root, "cases", name);
	const id = `flowassertcase${String(index).padStart(2, "0")}`;
	const at = (x) => [x * 220, 0];
	return {
		id,
		name: `FlowAssert ${name}`,
		active: false,
		settings: { executionOrder: "v1" },
		nodes: [
			{ id: "t", name: "Start", type: "n8n-nodes-base.manualTrigger", typeVersion: 1, position: at(0), parameters: {} },
			{ id: "s", name: "Read source", type: "n8n-nodes-base.readWriteFile", typeVersion: 1.1, position: at(1), parameters: { fileSelector: join(folder, "source.csv"), options: { dataPropertyName: "source" } } },
			{ id: "d", name: "Read destination", type: "n8n-nodes-base.readWriteFile", typeVersion: 1.1, position: [220, 200], parameters: { fileSelector: join(folder, "destination.csv"), options: { dataPropertyName: "destination" } } },
			{ id: "m", name: "Both files", type: "n8n-nodes-base.merge", typeVersion: 3.2, position: at(2), parameters: { mode: "combine", combineBy: "combineByPosition", options: {} } },
			{ id: "f", name: "FlowAssert", type: "CUSTOM.flowAssert", typeVersion: 1, position: at(3), parameters: parametersOf(name) },
		],
		connections: {
			Start: { main: [[{ node: "Read source", type: "main", index: 0 }, { node: "Read destination", type: "main", index: 0 }]] },
			"Read source": { main: [[{ node: "Both files", type: "main", index: 0 }]] },
			"Read destination": { main: [[{ node: "Both files", type: "main", index: 1 }]] },
			"Both files": { main: [[{ node: "FlowAssert", type: "main", index: 0 }]] },
		},
	};
}

/** The run data n8n prints with --rawOutput, between its log lines: the object from a line "{" to a line "}". */
function runData(stdout) {
	const lines = stdout.split("\n");
	const start = lines.indexOf("{");
	const end = lines.indexOf("}", start);
	if (start === -1 || end === -1) throw new Error(`no run data in n8n's output: ${stdout.slice(-500)}`);
	return JSON.parse(lines.slice(start, end + 1).join("\n")).data.resultData;
}

const bytes = (b) => Buffer.from(b.data, "base64");

function compare(name, result) {
	const want = expected(name);
	const out = result.runData.FlowAssert[0].data.main;
	const [item] = out[0];
	assert.equal(item.json.exit, want.exit);
	if (want.exit === 2) {
		assert.equal(item.json.state, "refused");
		assert.equal(item.json.message, want.stderr);
		return;
	}
	assert.equal(item.json.summary, want.stdout);
	assert.equal(timeless(bytes(item.binary.report_json).toString("utf-8")), timeless(want.json));
	for (let i = 1; i < OUTPUTS.length; i++) {
		const exported = item.json.exports.find((e) => e.file === FILES[i]);
		assert.equal((out[i] ?? []).length, exported ? exported.rows : 0, OUTPUTS[i]);
	}
	if (want.exports) {
		const files = item.json.exports.map((e) => e.file).sort();
		assert.deepEqual(files, Object.keys(want.exports).sort());
		for (const f of files) assert.deepEqual(bytes(item.binary["export_" + f.replace(/\.csv$/, "").replace(/-/g, "_")]), want.exports[f], f);
	}
}

let failures = 0;
const report = { n8n: null, cases: {}, python: HAS_PYTHON };
try {
	cpSync(join(PACKAGE, "dist"), join(root, "extensions", "n8n-nodes-flowassert"), { recursive: true });
	mkdirSync(join(root, "workflows"), { recursive: true });
	for (const [i, name] of NODE_CASES.entries()) {
		cpSync(join(GOLDEN, name), join(root, "cases", name), { recursive: true });
		writeFileSync(join(root, "workflows", `${i}.json`), JSON.stringify(workflow(i, name)));
	}
	const version = n8n("--version");
	report.n8n = version.stdout.trim().split("\n").pop();
	console.log(`n8n ${report.n8n}, ${NODE_CASES.length} cases, records to resend compared with the command line: ${HAS_PYTHON ? "yes" : "no (no Python)"}`);
	const imported = n8n("import:workflow", "--separate", `--input=${join(root, "workflows")}`);
	if (imported.status !== 0) throw new Error(`import failed: ${imported.stderr}${imported.stdout}`);
	for (const [i, name] of NODE_CASES.entries()) {
		const run = n8n("execute", `--id=${workflow(i, name).id}`, "--rawOutput");
		try {
			const data = runData(run.stdout);
			if (data.error) throw new Error(`the execution failed: ${data.error.message}`);
			compare(name, data);
			report.cases[name] = "pass";
			console.log(`ok ${name}`);
		} catch (e) {
			failures++;
			report.cases[name] = String(e.message).slice(0, 2000);
			console.log(`FAIL ${name}: ${String(e.message).slice(0, 500)}\n${run.stderr.slice(-800)}`);
		}
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}
console.log(`${NODE_CASES.length - failures} of ${NODE_CASES.length} cases pass in n8n ${report.n8n}`);
if (option("--out")) writeFileSync(option("--out"), JSON.stringify(report, null, 2) + "\n");
process.exit(failures ? 1 : 0);
