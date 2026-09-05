import { describe, expect, it } from "vitest";
import type { VaultItem } from "./vault";
import { visibleVaultItems } from "./vault-items";

const item = (
	id: string,
	title: string,
	favorite = false,
	username = "",
	website = "",
): VaultItem => ({
	id,
	title,
	username,
	password: "synthetic password",
	website,
	notes: "",
	favorite,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
});

describe("visible vault items", () => {
	it("filters searchable fields and sorts favourites first without mutating state", () => {
		const original = [
			item("z", "Zulu", false, "matching-user"),
			item("b", "Bravo", true, "", "https://matching.invalid"),
			item("a", "Alpha", true),
		] as const;

		expect(visibleVaultItems(original, "MATCHING").map(({ id }) => id)).toEqual(
			["b", "z"],
		);
		expect(visibleVaultItems(original, "").map(({ id }) => id)).toEqual([
			"a",
			"b",
			"z",
		]);
		expect(original.map(({ id }) => id)).toEqual(["z", "b", "a"]);
	});
});
