import {
	addVaultItem,
	createVaultItem,
	type VaultDocument,
	type VaultItem,
} from "@svrgn/vault-core";

export const CHROME_CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CHROME_CSV_MAX_ROWS = 3_000;

export type ChromeCsvDuplicateStrategy = "skip" | "import-all";

export interface ChromeCsvLogin {
	readonly rowNumber: number;
	readonly title: string;
	readonly username: string;
	readonly password: string;
	readonly website: string;
	readonly notes: string;
	readonly duplicate: boolean;
	readonly duplicateSource?: "vault" | "file";
}

export interface InvalidChromeCsvRow {
	readonly rowNumber: number;
	readonly title: string;
	readonly website: string;
	readonly reason: string;
}

export interface ChromeCsvImportPreview {
	readonly rows: ReadonlyArray<ChromeCsvLogin>;
	readonly invalidRows: ReadonlyArray<InvalidChromeCsvRow>;
	readonly totalRows: number;
	readonly duplicateCount: number;
}

export class ChromeCsvImportError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ChromeCsvImportError";
	}
}

interface CsvRow {
	readonly line: number;
	readonly fields: ReadonlyArray<string>;
}

const isLineBreak = (character: string): boolean =>
	character === "\r" || character === "\n";

/**
 * Small RFC 4180 parser kept here so credential CSV data never enters a
 * third-party parser or telemetry surface. Quoted commas, escaped quotes and
 * embedded CR/LF line breaks are preserved.
 */
export function parseCsv(input: string): ReadonlyArray<CsvRow> {
	const source = input.startsWith("\uFEFF") ? input.slice(1) : input;
	const rows: Array<CsvRow> = [];
	let fields: Array<string> = [];
	let field = "";
	let rowLine = 1;
	let line = 1;
	let inQuotes = false;
	let afterClosingQuote = false;

	const finishField = () => {
		fields.push(field);
		field = "";
		afterClosingQuote = false;
	};
	const finishRow = () => {
		finishField();
		rows.push({ line: rowLine, fields });
		fields = [];
		rowLine = line + 1;
	};

	for (let index = 0; index < source.length; index += 1) {
		const character = source[index] ?? "";
		const next = source[index + 1];

		if (inQuotes) {
			if (character === '"') {
				if (next === '"') {
					field += '"';
					index += 1;
				} else {
					inQuotes = false;
					afterClosingQuote = true;
				}
				continue;
			}
			field += character;
			if (character === "\n" || (character === "\r" && next !== "\n")) {
				line += 1;
			}
			continue;
		}

		if (afterClosingQuote) {
			if (character === ",") {
				finishField();
				continue;
			}
			if (isLineBreak(character)) {
				if (character === "\r" && next === "\n") index += 1;
				finishRow();
				line += 1;
				continue;
			}
			throw new ChromeCsvImportError(
				`CSV syntax error on line ${line}: unexpected text after a closing quote.`,
			);
		}

		if (character === '"') {
			if (field.length > 0) {
				throw new ChromeCsvImportError(
					`CSV syntax error on line ${line}: a quote must begin the field.`,
				);
			}
			inQuotes = true;
			continue;
		}
		if (character === ",") {
			finishField();
			continue;
		}
		if (isLineBreak(character)) {
			if (character === "\r" && next === "\n") index += 1;
			finishRow();
			line += 1;
			continue;
		}
		field += character;
	}

	if (inQuotes) {
		throw new ChromeCsvImportError(
			`CSV syntax error on line ${rowLine}: the quoted field is not closed.`,
		);
	}
	if (fields.length > 0 || field.length > 0 || afterClosingQuote) finishRow();
	return rows;
}

const normalizeHeader = (header: string): string =>
	header.trim().toLocaleLowerCase("en");

const duplicateKey = (website: string, username: string): string => {
	const parsed = new URL(website);
	parsed.hash = "";
	const normalizedWebsite = parsed.href.replace(/\/$/, "");
	return `${normalizedWebsite}\u0000${username}`;
};

const validateWebsite = (website: string): string | null => {
	if (!website) return "URL is empty.";
	try {
		const parsed = new URL(website);
		if (
			(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
			!parsed.hostname
		) {
			return "URL must be a valid HTTP or HTTPS address.";
		}
		return null;
	} catch {
		return "URL must be a valid HTTP or HTTPS address.";
	}
};

const inferredTitle = (website: string): string => {
	try {
		return new URL(website).hostname.replace(/^www\./i, "") || "Imported login";
	} catch {
		return "Imported login";
	}
};

export function prepareChromeCsvImport(
	csv: string,
	existingItems: ReadonlyArray<VaultItem>,
): ChromeCsvImportPreview {
	if (new TextEncoder().encode(csv).byteLength > CHROME_CSV_MAX_BYTES) {
		throw new ChromeCsvImportError(
			"The selected CSV is larger than 5 MB. Split it into smaller files.",
		);
	}
	if (!csv.trim())
		throw new ChromeCsvImportError("The selected CSV file is empty.");
	const parsedRows = parseCsv(csv);
	const [headerRow, ...dataRows] = parsedRows;
	if (!headerRow)
		throw new ChromeCsvImportError("The CSV header row is missing.");

	const headers = headerRow.fields.map(normalizeHeader);
	const duplicateHeaders = headers.filter(
		(header, index) => header && headers.indexOf(header) !== index,
	);
	if (duplicateHeaders.length > 0) {
		throw new ChromeCsvImportError(
			`The CSV contains a duplicate “${duplicateHeaders[0]}” column.`,
		);
	}
	const indexOf = (name: string): number => headers.indexOf(name);
	const missing = ["url", "username", "password"].filter(
		(name) => indexOf(name) === -1,
	);
	if (missing.length > 0) {
		throw new ChromeCsvImportError(
			`Chrome CSV requires these columns: url, username, password. Missing: ${missing.join(", ")}.`,
		);
	}

	const nonEmptyRows = dataRows.filter((row) =>
		row.fields.some((field) => field.length > 0),
	);
	if (nonEmptyRows.length > CHROME_CSV_MAX_ROWS) {
		throw new ChromeCsvImportError(
			`The CSV contains more than ${CHROME_CSV_MAX_ROWS.toLocaleString("en")} password rows. Split it into smaller files.`,
		);
	}

	const existingKeys = new Set(
		existingItems.flatMap((item) => {
			try {
				return [duplicateKey(item.website, item.username)];
			} catch {
				return [];
			}
		}),
	);
	const fileKeys = new Set<string>();
	const rows: Array<ChromeCsvLogin> = [];
	const invalidRows: Array<InvalidChromeCsvRow> = [];
	const nameIndex = indexOf("name");
	const noteIndex = indexOf("note") === -1 ? indexOf("notes") : indexOf("note");
	const valueAt = (row: CsvRow, index: number): string =>
		index < 0 ? "" : (row.fields[index] ?? "");

	for (const row of nonEmptyRows) {
		const website = valueAt(row, indexOf("url")).trim();
		const username = valueAt(row, indexOf("username"));
		const password = valueAt(row, indexOf("password"));
		const suppliedTitle = valueAt(row, nameIndex).trim();
		const title = suppliedTitle || inferredTitle(website);
		const websiteError = validateWebsite(website);
		const columnError =
			row.fields.length > headers.length
				? `Row has ${row.fields.length} columns but the header has ${headers.length}.`
				: null;
		const reason =
			columnError ?? websiteError ?? (!password ? "Password is empty." : null);
		if (reason) {
			invalidRows.push({ rowNumber: row.line, title, website, reason });
			continue;
		}

		const key = duplicateKey(website, username);
		const duplicateSource = existingKeys.has(key)
			? "vault"
			: fileKeys.has(key)
				? "file"
				: undefined;
		rows.push({
			rowNumber: row.line,
			title,
			username,
			password,
			website,
			notes: valueAt(row, noteIndex),
			duplicate: duplicateSource !== undefined,
			duplicateSource,
		});
		fileKeys.add(key);
	}

	return {
		rows,
		invalidRows,
		totalRows: nonEmptyRows.length,
		duplicateCount: rows.filter((row) => row.duplicate).length,
	};
}

export function countChromeCsvImports(
	preview: ChromeCsvImportPreview,
	strategy: ChromeCsvDuplicateStrategy,
): number {
	return preview.rows.filter(
		(row) => strategy === "import-all" || !row.duplicate,
	).length;
}

export function applyChromeCsvImport(
	document: VaultDocument,
	preview: ChromeCsvImportPreview,
	strategy: ChromeCsvDuplicateStrategy,
	now = new Date().toISOString(),
): VaultDocument {
	return preview.rows
		.filter((row) => strategy === "import-all" || !row.duplicate)
		.reduce(
			(current, row) =>
				addVaultItem(
					current,
					createVaultItem(
						{
							title: row.title,
							username: row.username,
							password: row.password,
							website: row.website,
							notes: row.notes,
						},
						{ now },
					),
					now,
				),
			document,
		);
}
