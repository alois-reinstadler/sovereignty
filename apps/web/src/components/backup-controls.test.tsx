import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { BackupControls } from "./backup-controls";

it("requires an explicit lock before desktop dialogs can own import/export callbacks", () => {
	const html = renderToStaticMarkup(
		<BackupControls hasExistingVault requiresLock onImported={() => {}} />,
	);
	expect(html).toContain(
		"Lock the vault to import or export encrypted backups.",
	);
	expect(html).not.toContain("<button");
	expect(html).not.toContain('type="file"');
});
it("retains backup actions when a stable locked view or web client permits them", () => {
	const html = renderToStaticMarkup(
		<BackupControls hasExistingVault onImported={() => {}} />,
	);
	expect(html).toContain("Export backup");
	expect(html).toContain("Import backup");
});
