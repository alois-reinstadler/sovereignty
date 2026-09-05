import type { VaultItem } from "./vault";

export function visibleVaultItems(
	items: readonly VaultItem[],
	search: string,
): VaultItem[] {
	const query = search.toLocaleLowerCase("en");
	return items
		.filter((item) =>
			[item.title, item.username, item.website].some((value) =>
				value.toLocaleLowerCase("en").includes(query),
			),
		)
		.sort(
			(a, b) =>
				Number(b.favorite) - Number(a.favorite) ||
				a.title.localeCompare(b.title, "en"),
		);
}
