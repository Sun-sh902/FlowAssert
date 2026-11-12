import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { checkCsv } from './checker';
import type { CheckCsvExport, CheckCsvInput, CheckCsvResult } from './types';

/**
 * The FlowAssert node: one check per input item, of two files (CSV or one worksheet of an .xlsx workbook) held in two
 * binary properties, with the checker of FlowAssert's command line and browser, built into this package. It makes no
 * request, reads no file and no environment variable, and needs no credential. docs/design/1.1-n8n-node.md.
 */

/** The outputs: the result, then one for each file of records to resend, each only that file's rows. */
export const OUTPUTS: { name: string; file: string | null }[] = [
	{ name: 'Result', file: null },
	{ name: 'Missing From Destination', file: 'missing-from-destination.csv' },
	{ name: 'Values Differ', file: 'values-differ.csv' },
	{ name: 'Duplicated in Destination', file: 'duplicated-in-destination.csv' },
	{ name: 'Unknown Status (Resending May Duplicate)', file: 'unknown-status-resending-may-create-duplicates.csv' },
	{ name: 'Only in Destination', file: 'only-in-destination.csv' },
	{ name: 'Only in Destination (Not Concluded)', file: 'only-in-destination-not-concluded.csv' },
];

const PREMISE = 'Your statement, which FlowAssert does not check: a wrong statement gives a wrong result.';

function side(which: 'source' | 'destination'): INodeProperties[] {
	const title = which === 'source' ? 'Source' : 'Destination';
	return [
		{
			displayName: `${title} Binary Property`,
			name: `${which}BinaryProperty`,
			type: 'string',
			default: which,
			required: true,
			description: `The binary property of the input item that holds the ${which} file`,
		},
		{
			displayName: `${title} Format`,
			name: `${which}Format`,
			type: 'options',
			options: [
				{ name: 'CSV', value: 'csv' },
				{ name: 'Excel Workbook (.xlsx)', value: 'xlsx' },
			],
			default: 'csv',
			description: `How to read the ${which} file. A workbook is read as one worksheet, its stored values, not as displayed.`,
		},
		{
			displayName: `${title} Worksheet`,
			name: `${which}Worksheet`,
			type: 'string',
			default: '',
			displayOptions: { show: { [`${which}Format`]: ['xlsx'] } },
			description: 'The worksheet to read, exactly as the workbook names it. Needed when the workbook has more than one sheet.',
		},
		{
			displayName: `${title} Encoding`,
			name: `${which}Encoding`,
			type: 'options',
			options: [
				{ name: 'UTF-8', value: 'utf-8' },
				{ name: 'UTF-16 (With a Byte Order Mark)', value: 'utf-16' },
				{ name: 'GB18030', value: 'gb18030' },
			],
			default: 'utf-8',
			displayOptions: { show: { [`${which}Format`]: ['csv'] } },
			description: `The encoding of the ${which} CSV file. FlowAssert never guesses one.`,
		},
	];
}

export const PROPERTIES: INodeProperties[] = [
	...side('source'),
	...side('destination'),
	{
		displayName: 'Source Key Column',
		name: 'sourceKey',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'external_id',
		description: 'The column of the source that identifies a record',
	},
	{
		displayName: 'Destination Key Column',
		name: 'destinationKey',
		type: 'string',
		default: '',
		placeholder: 'Same as the source',
		description: 'The column of the destination that holds the same key. Leave empty when it has the same name.',
	},
	{
		displayName: 'Fields',
		name: 'fields',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Field',
		description: 'The fields to compare, each with its rule',
		options: [
			{
				displayName: 'Field',
				name: 'field',
				values: [
					{
						displayName: 'Source Column',
						name: 'sourceColumn',
						type: 'string',
						default: '',
						description: 'The column of the source',
					},
					{
						displayName: 'Destination Column',
						name: 'destinationColumn',
						type: 'string',
						default: '',
						description: 'The column of the destination. Leave empty when it has the same name.',
					},
					{
						displayName: 'Rule',
						name: 'rule',
						type: 'options',
						options: [
							{ name: 'Case-Insensitive', value: 'casefold', description: 'The same after Unicode case folding' },
							{ name: 'Date', value: 'date', description: 'The same date, read with a format' },
							{ name: 'Digits Only', value: 'digits', description: 'The same digits 0-9, ignoring everything else' },
							{ name: 'Exact', value: 'exact', description: 'The same text, character for character' },
							{ name: 'Trim', value: 'trim', description: 'The same after removing leading and trailing whitespace' },
						],
						default: 'exact',
						description: 'How the two values are compared',
					},
					{
						displayName: 'Date Format',
						name: 'dateFormat',
						type: 'string',
						default: '',
						placeholder: '%Y-%m-%d',
						displayOptions: { show: { rule: ['date'] } },
						description: "The format of both values, in Python's strptime directives, such as %Y-%m-%d",
					},
				],
			},
		],
	},
	{
		displayName: 'Scope',
		name: 'scope',
		type: 'options',
		options: [
			{ name: 'Source Records', value: 'source', description: 'Check each source record' },
			{
				name: 'Exact',
				value: 'exact',
				description: 'Also report destination records whose key is not in the source',
			},
		],
		default: 'source',
	},
	{
		displayName: 'Premise: The Source Is the Whole Batch',
		name: 'sourceComplete',
		type: 'boolean',
		default: false,
		description: `Whether to state that the source file holds every record of the batch. ${PREMISE} Without it, the batch cannot be Verified.`,
	},
	{
		displayName: 'Premise: The Destination Covers the Whole Object',
		name: 'destinationComplete',
		type: 'boolean',
		default: false,
		description: `Whether to state that the destination file holds every record of the destination object. ${PREMISE} Without it, missing records and duplicates stay unknown.`,
	},
	{
		displayName: 'Premise: Source Total',
		name: 'sourceCount',
		type: 'string',
		default: '',
		placeholder: 'Not stated',
		description: `The source total you saw in the original system, a whole number. ${PREMISE} A different row count in the file blocks Verified.`,
	},
	{
		displayName: 'Premise: Destination Total',
		name: 'destinationCount',
		type: 'string',
		default: '',
		placeholder: 'Not stated',
		description: `The destination total you saw in the original system, a whole number. ${PREMISE} A different row count leaves missing records and duplicates unknown.`,
	},
	{
		displayName: 'Premise: The Two Files Come From Different Systems',
		name: 'allowIdenticalContent',
		type: 'boolean',
		default: false,
		description: `Whether to state that two files with identical content really come from different systems. ${PREMISE} Without it, identical files are refused.`,
	},
	{
		displayName: 'Output Records to Resend',
		name: 'exportRecords',
		type: 'boolean',
		default: true,
		description: 'Whether to output the rows that need action, each on the output of its file, as items. They are advice from the check, not a further conclusion.',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		options: [
			{
				displayName: 'Leave Values Out of the Reports',
				name: 'redactValues',
				type: 'boolean',
				default: false,
				description: 'Whether to leave keys and compared values out of the reports. Cannot be combined with Output Records to Resend.',
			},
			{
				displayName: 'Maximum Bytes',
				name: 'maxBytes',
				type: 'string',
				default: '',
				placeholder: '209715200',
				description: 'Refuse a file larger than this many bytes, or a workbook that inflates beyond it',
			},
			{
				displayName: 'Maximum Rows',
				name: 'maxRows',
				type: 'string',
				default: '',
				placeholder: '1000000',
				description: 'Refuse a file with more data rows than this',
			},
			{
				displayName: 'Report Details',
				name: 'details',
				type: 'options',
				options: [
					{ name: 'Problems', value: 'problems', description: 'A Verified record keeps only its key, row and state' },
					{ name: 'All', value: 'all', description: 'Every record in full' },
				],
				default: 'problems',
			},
		],
	},
];

interface FieldParameter {
	sourceColumn?: string;
	destinationColumn?: string;
	rule?: string;
	dateFormat?: string;
}

/** The parameters of one item, as the node reads them. */
export interface Parameters {
	sourceBinaryProperty: string;
	sourceFormat: string;
	sourceWorksheet: string;
	sourceEncoding: string;
	destinationBinaryProperty: string;
	destinationFormat: string;
	destinationWorksheet: string;
	destinationEncoding: string;
	sourceKey: string;
	destinationKey: string;
	fields: { field?: FieldParameter[] };
	scope: string;
	sourceComplete: boolean;
	destinationComplete: boolean;
	sourceCount: string;
	destinationCount: string;
	allowIdenticalContent: boolean;
	exportRecords: boolean;
	options: { redactValues?: boolean; maxBytes?: string; maxRows?: string; details?: string };
}

/** Each parameter's default: a parameter hidden by its display options (a CSV side's worksheet) is read as it. */
const DEFAULTS = PROPERTIES.map((p) => [p.name, p.default] as const);

/** The checker's input for these parameters and the two files' bytes. A refusal of the parameters is a string. */
export function checkInput(
	p: Parameters,
	source: { name: string; content: Uint8Array },
	destination: { name: string; content: Uint8Array },
): CheckCsvInput | string {
	if (p.exportRecords && p.options.redactValues) {
		return 'Output Records to Resend cannot be combined with Leave Values Out of the Reports: the exported rows hold the values';
	}
	const file = (which: 'source' | 'destination', f: { name: string; content: Uint8Array }) => {
		const format = which === 'source' ? p.sourceFormat : p.destinationFormat;
		const worksheet = which === 'source' ? p.sourceWorksheet : p.destinationWorksheet;
		const encoding = which === 'source' ? p.sourceEncoding : p.destinationEncoding;
		return format === 'xlsx'
			? { ...f, format: 'xlsx', ...(worksheet ? { worksheet } : {}) }
			: { ...f, encoding };
	};
	const key = p.sourceKey;
	const fields = (p.fields.field ?? []).map((f) => {
		const sourceColumn = f.sourceColumn ?? '';
		const rule = f.rule === 'date' ? `date:${f.dateFormat ?? ''}` : (f.rule ?? 'exact');
		return { source: sourceColumn, destination: f.destinationColumn || sourceColumn, rule };
	});
	const count = (value: string) => (value.trim() === '' ? null : value);
	const options = p.options;
	return {
		source: file('source', source),
		destination: file('destination', destination),
		config: { key: [key, p.destinationKey || key], fields, scope: p.scope },
		sourceComplete: p.sourceComplete,
		destinationComplete: p.destinationComplete,
		sourceCount: count(p.sourceCount),
		destinationCount: count(p.destinationCount),
		allowIdenticalContent: p.allowIdenticalContent,
		origin: 'n8n node',
		...(p.exportRecords ? { exports: true } : {}),
		...(options.redactValues ? { redactValues: true } : {}),
		...(options.details ? { details: options.details } : {}),
		...(options.maxBytes ? { maxBytes: options.maxBytes } : {}),
		...(options.maxRows ? { maxRows: options.maxRows } : {}),
	};
}

/** The rows of an exported file: its header, then each row, as FlowAssert writes them (RFC 4180, CR LF, a BOM). */
export function rowsOf(text: string): string[][] {
	const s = text.startsWith('﻿') ? text.slice(1) : text;
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quoted) {
			if (c !== '"') field += c;
			else if (s[i + 1] === '"') {
				field += '"';
				i++;
			} else quoted = false;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			row.push(field);
			field = '';
		} else if (c === '\r' && s[i + 1] === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i++;
		} else field += c;
	}
	return rows;
}

/** Each row of an exported file as an item: its file's columns, with their text, and nothing else. */
export function rowItems(file: CheckCsvExport, itemIndex: number): INodeExecutionData[] {
	const [header, ...rows] = rowsOf(file.text);
	return rows.map((row) => ({
		json: Object.fromEntries((header ?? []).map((name, j) => [name, row[j] ?? ''])),
		pairedItem: { item: itemIndex },
	}));
}

/** The Result item's json: the result, for branching and storage. */
export function resultJson(result: CheckCsvResult): IDataObject {
	const report = result.json === null ? null : (JSON.parse(result.json) as IDataObject);
	return {
		state: result.state,
		exit: result.exit,
		summary: result.summary,
		message: result.message,
		claim: report ? (report.claim as string | null) : null,
		counts: report ? (report.counts as IDataObject) : null,
		report,
		exports: (result.exports ?? []).map(({ file, rows, meaning, formulaFields }) => ({ file, rows, meaning, formulaFields })),
	};
}

export const binaryName = (file: string) => 'export_' + file.replace(/\.csv$/, '').replace(/-/g, '_');

export class FlowAssert implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'FlowAssert',
		name: 'flowAssert',
		icon: { light: 'file:flowassert.svg', dark: 'file:flowassert.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["sourceFormat"] + " to " + $parameter["destinationFormat"]}}',
		description:
			'Check that expected records reached a destination, from two CSV or Excel files, without calling a result Verified on too little evidence',
		defaults: { name: 'FlowAssert' },
		inputs: [NodeConnectionTypes.Main],
		outputs: OUTPUTS.map(() => NodeConnectionTypes.Main),
		outputNames: OUTPUTS.map((o) => o.name),
		usableAsTool: undefined,
		properties: PROPERTIES,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[][] = OUTPUTS.map(() => []);
		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const p = Object.fromEntries(
					DEFAULTS.map(([name, fallback]) => [name, this.getNodeParameter(name, itemIndex, fallback)]),
				) as unknown as Parameters;
				const read = async (property: string) => {
					const binary = this.helpers.assertBinaryData(itemIndex, property);
					const content = await this.helpers.getBinaryDataBuffer(itemIndex, property);
					return { name: binary.fileName ?? property, content: new Uint8Array(content) };
				};
				const input = checkInput(p, await read(p.sourceBinaryProperty), await read(p.destinationBinaryProperty));
				const result: CheckCsvResult =
					typeof input === 'string'
						? { exit: 2, state: 'refused', summary: '', message: `refused: ${input}\n`, json: null, html: null, exports: null }
						: await checkCsv(input);
				const item: INodeExecutionData = { json: resultJson(result), pairedItem: { item: itemIndex } };
				const binary: NonNullable<INodeExecutionData['binary']> = {};
				const attach = async (name: string, text: string, fileName: string, mimeType: string) => {
					binary[name] = await this.helpers.prepareBinaryData(Buffer.from(text, 'utf-8'), fileName, mimeType);
				};
				if (result.json !== null) await attach('report_json', result.json, 'flowassert-report.json', 'application/json');
				if (result.html !== null) await attach('report_html', result.html, 'flowassert-report.html', 'text/html');
				for (const file of result.exports ?? []) {
					await attach(binaryName(file.file), file.text, file.file, 'text/csv');
					const output = OUTPUTS.findIndex((o) => o.file === file.file);
					out[output].push(...rowItems(file, itemIndex));
				}
				if (Object.keys(binary).length) item.binary = binary;
				out[0].push(item);
			} catch (error) {
				if (this.continueOnFail()) {
					out[0].push({ json: { error: (error as Error).message }, pairedItem: { item: itemIndex } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex });
			}
		}
		return out;
	}
}
