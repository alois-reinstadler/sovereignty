import { Banner, Button, Card } from "@astryxdesign/core";
import { useRef, useState } from "react";

import {
	CHROME_CSV_MAX_BYTES,
	type ChromeCsvDuplicateStrategy,
	type ChromeCsvImportPreview,
	countChromeCsvImports,
	prepareChromeCsvImport,
} from "#/lib/chrome-csv-import";
import type { VaultItem } from "#/lib/models";

type ChromeCsvImportProps = {
	existingItems: ReadonlyArray<VaultItem>;
	isDisabled?: boolean;
	onImport: (
		preview: ChromeCsvImportPreview,
		strategy: ChromeCsvDuplicateStrategy,
	) => Promise<boolean>;
};

export function ChromeCsvImport({
	existingItems,
	isDisabled = false,
	onImport,
}: ChromeCsvImportProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<ChromeCsvImportPreview | null>(null);
	const [fileName, setFileName] = useState("");
	const [strategy, setStrategy] = useState<ChromeCsvDuplicateStrategy>("skip");
	const [isWorking, setIsWorking] = useState(false);
	const [message, setMessage] = useState<{
		type: "error" | "success";
		text: string;
	} | null>(null);

	const clearPreview = () => {
		setPreview(null);
		setFileName("");
		setStrategy("skip");
		if (inputRef.current) inputRef.current.value = "";
	};

	const selectCsv = async (file: File | undefined) => {
		if (!file) return;
		setMessage(null);
		if (file.size > CHROME_CSV_MAX_BYTES) {
			setMessage({
				type: "error",
				text: "The selected CSV is larger than 5 MB. Split it into smaller files.",
			});
			if (inputRef.current) inputRef.current.value = "";
			return;
		}

		setIsWorking(true);
		try {
			// The plaintext exists only in this local function and the in-memory preview.
			// It is never sent to an API, logged or written to browser storage.
			const csv = await file.text();
			const nextPreview = prepareChromeCsvImport(csv, existingItems);
			setPreview(nextPreview);
			setFileName(file.name);
			setStrategy("skip");
		} catch (cause) {
			clearPreview();
			setMessage({
				type: "error",
				text:
					cause instanceof Error
						? cause.message
						: "The selected Chrome CSV could not be read.",
			});
		} finally {
			setIsWorking(false);
		}
	};

	const finishImport = async () => {
		if (!preview) return;
		const importCount = countChromeCsvImports(preview, strategy);
		if (importCount === 0) return;
		setIsWorking(true);
		setMessage(null);
		try {
			const imported = await onImport(preview, strategy);
			if (!imported) {
				setMessage({
					type: "error",
					text: "The imported logins could not be saved to the encrypted vault.",
				});
				return;
			}
			clearPreview();
			setMessage({
				type: "success",
				text: `${importCount} ${importCount === 1 ? "login was" : "logins were"} imported and encrypted. Delete the plaintext CSV from your device.`,
			});
		} catch {
			setMessage({
				type: "error",
				text: "The imported logins could not be saved to the encrypted vault.",
			});
		} finally {
			setIsWorking(false);
		}
	};

	const importCount = preview ? countChromeCsvImports(preview, strategy) : 0;

	return (
		<div className="chrome-import-controls">
			<Button
				label="Import Chrome CSV"
				variant="ghost"
				size="sm"
				onClick={() => inputRef.current?.click()}
				isDisabled={isDisabled || isWorking}
				width="100%"
			/>
			<input
				ref={inputRef}
				id="chrome-password-csv"
				name="chrome-password-csv"
				type="file"
				accept=".csv,text/csv"
				className="visually-hidden-field"
				aria-label="Choose Chrome password CSV"
				onChange={(event) => void selectCsv(event.target.files?.[0])}
			/>
			{message ? (
				<Banner
					status={message.type}
					title={
						message.type === "error" ? "CSV import failed" : "CSV imported"
					}
					description={message.text}
				/>
			) : null}

			{preview ? (
				<div className="modal-backdrop" role="presentation">
					<Card
						className="csv-import-modal"
						padding={6}
						elevation="high"
						role="dialog"
						aria-modal="true"
						aria-labelledby="csv-import-title"
					>
						<div className="csv-import-heading">
							<span className="eyebrow">LOCAL MIGRATION</span>
							<h2 id="csv-import-title">Review Chrome passwords</h2>
							<p>
								{fileName} is parsed only in this browser. Passwords are hidden
								from this preview and are encrypted when you confirm the import.
							</p>
						</div>

						<dl className="csv-import-stats">
							<div>
								<dd>{preview.totalRows}</dd>
								<dt>Total rows</dt>
							</div>
							<div>
								<dd>{preview.rows.length}</dd>
								<dt>Valid</dt>
							</div>
							<div>
								<dd>{preview.duplicateCount}</dd>
								<dt>Duplicates</dt>
							</div>
							<div>
								<dd>{preview.invalidRows.length}</dd>
								<dt>Invalid</dt>
							</div>
						</dl>

						{preview.rows.length > 0 ? (
							<section className="csv-preview-section">
								<h3>Valid logins</h3>
								<div className="csv-preview-list">
									{preview.rows.slice(0, 8).map((row) => (
										<div className="csv-preview-row" key={row.rowNumber}>
											<div>
												<strong>{row.title}</strong>
												<span>
													{row.username || "No username"} · {row.website}
												</span>
											</div>
											{row.duplicate ? (
												<span className="duplicate-pill">
													Duplicate in{" "}
													{row.duplicateSource === "vault" ? "vault" : "file"}
												</span>
											) : (
												<span className="valid-pill">Ready</span>
											)}
										</div>
									))}
									{preview.rows.length > 8 ? (
										<p className="csv-more-rows">
											And {preview.rows.length - 8} more valid logins
										</p>
									) : null}
								</div>
							</section>
						) : null}

						{preview.invalidRows.length > 0 ? (
							<section className="csv-preview-section invalid">
								<h3>Rows that will not be imported</h3>
								<div className="csv-preview-list">
									{preview.invalidRows.slice(0, 5).map((row) => (
										<div className="csv-preview-row" key={row.rowNumber}>
											<div>
												<strong>
													Row {row.rowNumber}: {row.title}
												</strong>
												<span>{row.reason}</span>
											</div>
										</div>
									))}
								</div>
							</section>
						) : null}

						{preview.duplicateCount > 0 ? (
							<label className="csv-duplicate-strategy">
								<span>Duplicate handling</span>
								<select
									id="csv-duplicate-strategy"
									name="csv-duplicate-strategy"
									value={strategy}
									onChange={(event) =>
										setStrategy(
											event.target.value as ChromeCsvDuplicateStrategy,
										)
									}
								>
									<option value="skip">Skip duplicates</option>
									<option value="import-all">Import all valid rows</option>
								</select>
							</label>
						) : null}

						<Banner
							status="warning"
							title="Plaintext password file"
							description="After importing, delete the Chrome CSV and empty your device’s trash or recycle bin. Anyone who can read that file can read its passwords."
						/>

						<div className="form-actions">
							<Button
								label="Cancel"
								variant="ghost"
								onClick={clearPreview}
								isDisabled={isWorking}
							/>
							<Button
								label={`Import ${importCount} ${importCount === 1 ? "login" : "logins"}`}
								variant="primary"
								onClick={() => void finishImport()}
								isLoading={isWorking}
								isDisabled={importCount === 0}
							/>
						</div>
					</Card>
				</div>
			) : null}
		</div>
	);
}
