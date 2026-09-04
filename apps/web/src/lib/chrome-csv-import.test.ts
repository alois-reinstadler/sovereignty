import type { VaultDocument, VaultItem } from "@svrgn/vault-core";
import { describe, expect, it } from "vitest";

import {
	applyChromeCsvImport,
	ChromeCsvImportError,
	countChromeCsvImports,
	parseCsv,
	prepareChromeCsvImport,
} from "./chrome-csv-import";

const now = "2026-09-04T12:00:00.000Z";

const item = (
	website: string,
	username: string,
	overrides: Partial<VaultItem> = {},
): VaultItem => ({
	id: `${website}-${username}`,
	title: "Existing login",
	username,
	password: "existing-secret",
	website,
	notes: "",
	favorite: false,
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const document = (items: ReadonlyArray<VaultItem> = []): VaultDocument => ({
	version: 1,
	id: "vault-test",
	items,
	createdAt: now,
	updatedAt: now,
});

describe("Chrome CSV parsing", () => {
	it("parses quoted commas, escaped quotes and multiline fields", () => {
		const rows = parseCsv(
			'name,url,username,password,note\r\n"Example, Inc.",https://example.com,ada,"s3cr3t,with,commas","First line\r\nSecond ""quoted"" line"\r\n',
		);

		expect(rows).toEqual([
			{
				line: 1,
				fields: ["name", "url", "username", "password", "note"],
			},
			{
				line: 2,
				fields: [
					"Example, Inc.",
					"https://example.com",
					"ada",
					"s3cr3t,with,commas",
					'First line\r\nSecond "quoted" line',
				],
			},
		]);
	});

	it("rejects malformed quoted fields with a useful line number", () => {
		expect(() =>
			parseCsv('url,username,password\n"https://example.com,ada,secret'),
		).toThrowError(
			expect.objectContaining({
				name: "ChromeCsvImportError",
				message: expect.stringContaining("line 2"),
			}),
		);
		expect(() => parseCsv('url,username,password\n"value"oops,a,b')).toThrow(
			"unexpected text after a closing quote",
		);
	});

	it("accepts case-insensitive required headers and optional fields", () => {
		const preview = prepareChromeCsvImport(
			"\uFEFFName,URL,UserName,PASSWORD,Notes\nExample,https://example.com,ada,secret,hello",
			[],
		);

		expect(preview.invalidRows).toEqual([]);
		expect(preview.rows).toEqual([
			expect.objectContaining({
				title: "Example",
				website: "https://example.com",
				username: "ada",
				password: "secret",
				notes: "hello",
				duplicate: false,
			}),
		]);
	});

	it("rejects files without Chrome's required columns", () => {
		expect(() =>
			prepareChromeCsvImport(
				"name,url,password\nExample,https://example.com,x",
				[],
			),
		).toThrowError(ChromeCsvImportError);
		expect(() =>
			prepareChromeCsvImport(
				"name,url,password\nExample,https://example.com,x",
				[],
			),
		).toThrow("Missing: username");
	});
});

describe("Chrome CSV preview and import", () => {
	it("reports invalid rows without exposing passwords in error records", () => {
		const preview = prepareChromeCsvImport(
			[
				"name,url,username,password,note",
				"No URL,,ada,do-not-display,",
				"Bad URL,not-a-url,ada,also-secret,",
				"No Password,https://example.com,ada,,",
				"Valid,https://valid.example,,password,",
			].join("\n"),
			[],
		);

		expect(preview.totalRows).toBe(4);
		expect(preview.rows).toHaveLength(1);
		expect(preview.invalidRows).toEqual([
			expect.objectContaining({ rowNumber: 2, reason: "URL is empty." }),
			expect.objectContaining({
				rowNumber: 3,
				reason: expect.stringContaining("valid HTTP"),
			}),
			expect.objectContaining({ rowNumber: 4, reason: "Password is empty." }),
		]);
		expect(JSON.stringify(preview.invalidRows)).not.toContain("do-not-display");
		expect(JSON.stringify(preview.invalidRows)).not.toContain("also-secret");
	});

	it("rejects URLs containing embedded credentials without previewing them", () => {
		const preview = prepareChromeCsvImport(
			"url,username,password\nhttps://alice:basic-secret@example.com,alice,vault-secret",
			[],
		);

		expect(preview.rows).toEqual([]);
		expect(preview.invalidRows).toEqual([
			expect.objectContaining({
				reason: "URL must not contain embedded credentials.",
			}),
		]);
		expect(JSON.stringify(preview.invalidRows)).not.toContain("basic-secret");
		expect(JSON.stringify(preview.invalidRows)).not.toContain("vault-secret");
	});

	it("marks duplicates against the vault and earlier file rows", () => {
		const preview = prepareChromeCsvImport(
			[
				"url,username,password",
				"https://existing.example/,ada,new-one",
				"https://new.example,bob,new-two",
				"https://new.example,bob,new-three",
			].join("\n"),
			[item("https://existing.example", "ada")],
		);

		expect(preview.duplicateCount).toBe(2);
		expect(preview.rows.map((row) => row.duplicateSource)).toEqual([
			"vault",
			undefined,
			"file",
		]);
		expect(countChromeCsvImports(preview, "skip")).toBe(1);
		expect(countChromeCsvImports(preview, "import-all")).toBe(3);
	});

	it("imports through immutable vault operations with the selected strategy", () => {
		const existing = item("https://existing.example", "ada");
		const preview = prepareChromeCsvImport(
			[
				"name,url,username,password,note",
				"Existing,https://existing.example,ada,replacement,duplicate",
				"New,https://new.example,bob,new-secret,imported note",
			].join("\n"),
			[existing],
		);

		const skipped = applyChromeCsvImport(
			document([existing]),
			preview,
			"skip",
			now,
		);
		expect(skipped.items).toHaveLength(2);
		expect(skipped.items[0]).toBe(existing);
		expect(skipped.items[1]).toEqual(
			expect.objectContaining({
				title: "New",
				username: "bob",
				password: "new-secret",
				website: "https://new.example",
				notes: "imported note",
				createdAt: now,
				updatedAt: now,
			}),
		);

		const all = applyChromeCsvImport(
			document([existing]),
			preview,
			"import-all",
			now,
		);
		expect(all.items).toHaveLength(3);
		expect(all.items[1]?.password).toBe("replacement");
		expect(all.items[2]?.password).toBe("new-secret");
	});
});
