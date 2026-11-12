/** The packaged checker's input and result (ui/src/offline/api.ts), as far as the node uses them. */
export interface CheckFile {
	name: string;
	content: Uint8Array;
	encoding?: string;
	format?: string;
	worksheet?: string;
}

export interface CheckConfig {
	key: [string, string];
	fields: { source: string; destination: string; rule: string }[];
	scope: string;
}

export interface CheckCsvInput {
	source: CheckFile;
	destination: CheckFile;
	config: CheckConfig;
	sourceComplete?: boolean;
	destinationComplete?: boolean;
	sourceCount?: string | null;
	destinationCount?: string | null;
	allowIdenticalContent?: boolean;
	origin?: string;
	exports?: boolean;
	details?: string;
	redactValues?: boolean;
	maxBytes?: string;
	maxRows?: string;
}

export interface CheckCsvExport {
	file: string;
	rows: number;
	meaning: string;
	formulaFields: number;
	text: string;
}

export interface CheckCsvResult {
	exit: 0 | 1 | 2 | 3 | 4;
	state: 'Verified' | 'Mismatch' | 'Unverified' | 'refused' | 'failed';
	summary: string;
	message: string;
	json: string | null;
	html: string | null;
	exports?: CheckCsvExport[] | null;
}
