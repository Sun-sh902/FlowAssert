/**
 * Unit tests of the FlowAssert node, on the build (npm run build first): its parameters and their defaults, the
 * checker's input it makes of them, and its seven outputs for each state, run through a fake of n8n's execute
 * context. Golden cases come from offline/golden/ and offline/golden-xlsx/; the records to resend are compared with
 * the command line's (offline/verify.py --export-dir) when Python 3.9 or later is found as FA_PYTHON or python3.
 *
 *   npm run build && npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, test } from "node:test";

const require = createRequire(import.meta.url);
const node = require("../dist/nodes/FlowAssert/FlowAssert.node.js");
const { FlowAssert, PROPERTIES, OUTPUTS, checkInput, rowsOf, binaryName } = node;
import { GOLDEN, NODE_CASES, REPO, expected, parametersOf, timeless } from "./cases.mjs";

const DEFAULTS = Object.fromEntries(PROPERTIES.map((p) => [p.name, p.default]));
const property = (name) => PROPERTIES.find((p) => p.name === name);

/** A fake of n8n's IExecuteFunctions: items with binary properties, parameters, and the helpers the node uses. */
function context(items, parameters, { continueOnFail = false } = {}) {
	return {
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in parameters ? parameters[name] : fallback),
		continueOnFail: () => continueOnFail,
		getNode: () => ({ id: "n", name: "FlowAssert", type: "n8n-nodes-flowassert.flowAssert", typeVersion: 1, position: [0, 0], parameters: {} }),
		helpers: {
			assertBinaryData: (i, name) => {
				const b = items[i].binary?.[name];
				if (!b) throw new Error(`The item has no binary property "${name}"`);
				return b;
			},
			getBinaryDataBuffer: async (i, name) => Buffer.from(items[i].binary[name].data, "base64"),
			prepareBinaryData: async (buffer, fileName, mimeType) => ({ data: buffer.toString("base64"), fileName, mimeType }),
		},
	};
}

const binary = (path, fileName) => ({ data: readFileSync(path).toString("base64"), fileName });
const bytes = (b) => Buffer.from(b.data, "base64");

async function run(folder, parameters, files = { source: "source.csv", destination: "destination.csv" }) {
	const items = [{ json: {}, binary: { source: binary(join(folder, files.source), files.source), destination: binary(join(folder, files.destination), files.destination) } }];
	return new FlowAssert().execute.call(context(items, parameters));
}

describe("the parameters", () => {
	test("every premise is unstated by default, and says it is the person's statement, not checked", () => {
		for (const name of ["sourceComplete", "destinationComplete", "allowIdenticalContent"]) assert.equal(DEFAULTS[name], false, name);
		for (const name of ["sourceCount", "destinationCount"]) assert.equal(DEFAULTS[name], "", name);
		for (const name of ["sourceComplete", "destinationComplete", "sourceCount", "destinationCount", "allowIdenticalContent"]) {
			assert.match(property(name).displayName, /^Premise: /);
			assert.match(property(name).description, /Your statement, which FlowAssert does not check: a wrong statement gives a wrong result\./);
		}
	});

	test("the other defaults are the command line's", () => {
		assert.deepEqual(
			{ s: DEFAULTS.sourceBinaryProperty, d: DEFAULTS.destinationBinaryProperty, sf: DEFAULTS.sourceFormat, df: DEFAULTS.destinationFormat, se: DEFAULTS.sourceEncoding, de: DEFAULTS.destinationEncoding, scope: DEFAULTS.scope, exports: DEFAULTS.exportRecords },
			{ s: "source", d: "destination", sf: "csv", df: "csv", se: "utf-8", de: "utf-8", scope: "source", exports: true },
		);
		const options = Object.fromEntries(property("options").options.map((o) => [o.name, o.default]));
		assert.deepEqual(options, { redactValues: false, maxBytes: "", maxRows: "", details: "problems" });
	});

	test("seven outputs: the result, then one for each file of records to resend", () => {
		const d = new FlowAssert().description;
		assert.deepEqual(d.outputNames, ["Result", "Missing From Destination", "Values Differ", "Duplicated in Destination", "Unknown Status (Resending May Duplicate)", "Only in Destination", "Only in Destination (Not Concluded)"]);
		assert.equal(d.outputs.length, 7);
		assert.deepEqual(OUTPUTS.slice(1).map((o) => o.file), ["missing-from-destination.csv", "values-differ.csv", "duplicated-in-destination.csv", "unknown-status-resending-may-create-duplicates.csv", "only-in-destination.csv", "only-in-destination-not-concluded.csv"]);
		assert.equal(d.credentials, undefined);
	});
});

describe("the checker's input", () => {
	const file = { name: "f.csv", content: new Uint8Array() };
	const base = { ...DEFAULTS, sourceKey: "id", fields: { field: [{ sourceColumn: "phone", rule: "exact" }] }, options: {} };

	test("a key and a field without a destination name use the source's; empty totals are not stated", () => {
		const input = checkInput(base, file, file);
		assert.deepEqual(input.config, { key: ["id", "id"], fields: [{ source: "phone", destination: "phone", rule: "exact" }], scope: "source" });
		assert.equal(input.sourceCount, null);
		assert.equal(input.destinationCount, null);
		assert.equal(input.origin, "n8n node");
		assert.equal(input.exports, true);
		assert.equal(input.sourceComplete, false);
		assert.equal(input.source.encoding, "utf-8");
	});

	test("a date rule takes its format; a workbook side has a worksheet and no encoding", () => {
		const input = checkInput({ ...base, destinationKey: "ID", sourceCount: "12", sourceFormat: "xlsx", sourceWorksheet: "Orders", fields: { field: [{ sourceColumn: "d", destinationColumn: "D", rule: "date", dateFormat: "%Y-%m-%d" }] } }, file, file);
		assert.deepEqual(input.config.key, ["id", "ID"]);
		assert.deepEqual(input.config.fields, [{ source: "d", destination: "D", rule: "date:%Y-%m-%d" }]);
		assert.equal(input.sourceCount, "12");
		assert.deepEqual(input.source, { name: "f.csv", content: file.content, format: "xlsx", worksheet: "Orders" });
	});

	test("a total an expression gives as a number is taken as the command line takes its text", () => {
		// Before, checkInput called trim() on it and the item failed with "value.trim is not a function".
		const input = checkInput({ ...base, sourceCount: 12, destinationCount: 0 }, file, file);
		assert.equal(input.sourceCount, "12");
		assert.equal(input.destinationCount, "0");
		assert.equal(checkInput({ ...base, sourceCount: " " }, file, file).sourceCount, null);
	});

	test("records to resend cannot be combined with values left out", () => {
		assert.equal(checkInput({ ...base, options: { redactValues: true } }, file, file), "Output Records to Resend cannot be combined with Leave Values Out of the Reports: the exported rows hold the values");
		assert.equal(checkInput({ ...base, exportRecords: false, options: { redactValues: true } }, file, file).redactValues, true);
	});
});

describe("each golden case the node can express gives the command line's result", () => {
	test("there are such cases", () => assert.ok(NODE_CASES.length >= 15, String(NODE_CASES.length)));

	for (const name of NODE_CASES) {
		test(name, async () => {
			const want = expected(name);
			const out = await run(join(GOLDEN, name), parametersOf(name));
			const [result] = out[0];
			assert.equal(result.json.exit, want.exit);
			if (want.exit === 2) {
				assert.equal(result.json.state, "refused");
				assert.equal(result.json.message, want.stderr);
				assert.equal(result.binary, undefined);
				assert.ok(out.slice(1).every((o) => o.length === 0));
				return;
			}
			assert.equal(result.json.summary, want.stdout);
			const report = bytes(result.binary.report_json).toString("utf-8");
			assert.equal(timeless(report), timeless(want.json));
			assert.deepEqual(result.json.report, JSON.parse(report));
			assert.ok(bytes(result.binary.report_html).length > 0);
			// Each export file attached, its rows on its own output, as the command line writes it.
			for (const [i, o] of OUTPUTS.entries()) {
				if (!i) continue;
				const exported = result.json.exports.find((e) => e.file === o.file);
				assert.equal(out[i].length, exported ? exported.rows : 0, o.file);
				if (!exported) continue;
				const [header, ...rows] = rowsOf(bytes(result.binary[binaryName(o.file)]).toString("utf-8"));
				assert.deepEqual(out[i].map((item) => item.json), rows.map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]]))));
				assert.ok(out[i].every((item) => item.pairedItem.item === 0));
			}
			if (want.exports) {
				const files = result.json.exports.map((e) => e.file);
				assert.deepEqual(files.slice().sort(), Object.keys(want.exports).sort());
				for (const f of files) assert.deepEqual(bytes(result.binary[binaryName(f)]), want.exports[f], f);
			}
		});
	}
});

describe("other inputs and failures", () => {
	test("a workbook source", async () => {
		const folder = join(REPO, "offline/golden-xlsx/xlsx-mismatch");
		const out = await run(folder, { sourceFormat: "xlsx", sourceKey: "external_id", fields: { field: [{ sourceColumn: "phone", rule: "exact" }, { sourceColumn: "email", destinationColumn: "hs_email", rule: "exact" }] }, sourceComplete: true, destinationComplete: true }, { source: "source.xlsx", destination: "destination.csv" });
		assert.equal(out[0][0].json.state, "Mismatch");
		assert.ok(out[0][0].json.report.inputs.source_workbook);
		assert.equal(out[1].length + out[2].length + out[3].length, 3);
	});

	test("a refusal of the parameters is a Result item, not an error", async () => {
		const folder = join(GOLDEN, "example");
		const out = await run(folder, { sourceKey: "external_id", fields: { field: [{ sourceColumn: "phone", rule: "exact" }] }, options: { redactValues: true } });
		assert.equal(out[0][0].json.state, "refused");
		assert.match(out[0][0].json.message, /^refused: Output Records to Resend cannot be combined/);
	});

	test("a missing binary property fails the item, or with Continue On Fail gives an error item", async () => {
		const items = [{ json: {}, binary: {} }];
		await assert.rejects(new FlowAssert().execute.call(context(items, { sourceKey: "k" })), /no binary property "source"/);
		const out = await new FlowAssert().execute.call(context(items, { sourceKey: "k" }, { continueOnFail: true }));
		assert.match(out[0][0].json.error, /no binary property "source"/);
	});

	test("an exported file read back gives its rows exactly", () => {
		const text = '﻿id,v\r\n"a,b","say ""hi"""\r\n"two\nlines","cr\rhere"\r\n""\r\n';
		assert.deepEqual(rowsOf(text), [["id", "v"], ["a,b", 'say "hi"'], ["two\nlines", "cr\rhere"], [""]]);
	});
});
