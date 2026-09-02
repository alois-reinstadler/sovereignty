import {
	PasswordGenerationError,
	type VaultDocument,
	type VaultItem,
	VaultItemNotFoundError,
} from "./model";

const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?";

export interface VaultItemInput {
	title: string;
	username?: string;
	password?: string;
	website?: string;
	notes?: string;
	favorite?: boolean;
}

export interface VaultItemFactoryOptions {
	id?: string;
	now?: string;
}

export interface PasswordGeneratorOptions {
	length?: number;
	lowercase?: boolean;
	uppercase?: boolean;
	numbers?: boolean;
	symbols?: boolean;
	/** A deterministic source can be supplied by tests and audited callers. */
	randomIndex?: (upperBound: number) => number;
}

export type VaultItemChanges = Partial<
	Pick<
		VaultItem,
		"favorite" | "notes" | "password" | "title" | "username" | "website"
	>
>;

const randomBytes = (length: number): Uint8Array => {
	const bytes = new Uint8Array(length);
	globalThis.crypto.getRandomValues(bytes);
	return bytes;
};

export const createId = (): string => {
	const bytes = randomBytes(16);
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0"));
	return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export const createVaultItem = (
	input: VaultItemInput,
	options: VaultItemFactoryOptions = {},
): VaultItem => {
	const timestamp = options.now ?? new Date().toISOString();
	return {
		id: options.id ?? createId(),
		title: input.title.trim(),
		username: input.username ?? "",
		password: input.password ?? "",
		website: input.website ?? "",
		notes: input.notes ?? "",
		favorite: input.favorite ?? false,
		createdAt: timestamp,
		updatedAt: timestamp,
	};
};

const withUpdatedItems = (
	document: VaultDocument,
	items: ReadonlyArray<VaultItem>,
	now: string,
): VaultDocument => ({ ...document, items, updatedAt: now });

export const addVaultItem = (
	document: VaultDocument,
	item: VaultItem,
	now = new Date().toISOString(),
): VaultDocument => withUpdatedItems(document, [...document.items, item], now);

export const updateVaultItem = (
	document: VaultDocument,
	id: string,
	changes: VaultItemChanges,
	now = new Date().toISOString(),
): VaultDocument => {
	let found = false;
	const items = document.items.map((item) => {
		if (item.id !== id) return item;
		found = true;
		return {
			...item,
			...changes,
			id: item.id,
			createdAt: item.createdAt,
			updatedAt: now,
		};
	});
	if (!found) {
		throw new VaultItemNotFoundError({
			id,
			message: `Vault item ${id} was not found`,
		});
	}
	return withUpdatedItems(document, items, now);
};

export const removeVaultItem = (
	document: VaultDocument,
	id: string,
	now = new Date().toISOString(),
): VaultDocument => {
	const items = document.items.filter((item) => item.id !== id);
	if (items.length === document.items.length) {
		throw new VaultItemNotFoundError({
			id,
			message: `Vault item ${id} was not found`,
		});
	}
	return withUpdatedItems(document, items, now);
};

export const deleteVaultItem = removeVaultItem;

export const searchVaultItems = (
	document: VaultDocument,
	query: string,
): ReadonlyArray<VaultItem> => {
	const normalized = query.trim().toLocaleLowerCase("en");
	const items = normalized
		? document.items.filter((item) =>
				[item.title, item.username, item.website, item.notes].some((value) =>
					value.toLocaleLowerCase("en").includes(normalized),
				),
			)
		: [...document.items];
	return items.sort(
		(left, right) =>
			Number(right.favorite) - Number(left.favorite) ||
			left.title.localeCompare(right.title, "en", { sensitivity: "base" }),
	);
};

const secureRandomIndex = (upperBound: number): number => {
	const range = 0x1_0000_0000;
	const limit = range - (range % upperBound);
	const view = new DataView(new ArrayBuffer(4));
	while (true) {
		globalThis.crypto.getRandomValues(new Uint8Array(view.buffer));
		const candidate = view.getUint32(0);
		if (candidate < limit) return candidate % upperBound;
	}
};

export const generatePassword = (
	options: PasswordGeneratorOptions = {},
): string => {
	const length = options.length ?? 20;
	const characterSets = [
		options.lowercase === false ? "" : LOWERCASE,
		options.uppercase === false ? "" : UPPERCASE,
		options.numbers === false ? "" : NUMBERS,
		options.symbols === false ? "" : SYMBOLS,
	].filter(Boolean);

	if (!Number.isSafeInteger(length) || length < 8 || length > 256) {
		throw new PasswordGenerationError({
			message: "Password length must be between 8 and 256",
		});
	}
	if (characterSets.length === 0) {
		throw new PasswordGenerationError({
			message: "At least one character set must be enabled",
		});
	}
	if (length < characterSets.length) {
		throw new PasswordGenerationError({
			message: "Password is too short for the enabled character sets",
		});
	}

	const randomIndex = options.randomIndex ?? secureRandomIndex;
	const pick = (characters: string): string => {
		const index = randomIndex(characters.length);
		if (
			!Number.isSafeInteger(index) ||
			index < 0 ||
			index >= characters.length
		) {
			throw new PasswordGenerationError({
				message: "The random source returned an invalid index",
			});
		}
		return characters[index] ?? "";
	};
	const allCharacters = characterSets.join("");
	const result = characterSets.map(pick);
	while (result.length < length) result.push(pick(allCharacters));
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = randomIndex(index + 1);
		if (
			!Number.isSafeInteger(swapIndex) ||
			swapIndex < 0 ||
			swapIndex > index
		) {
			throw new PasswordGenerationError({
				message: "The random source returned an invalid index",
			});
		}
		const current = result[index];
		result[index] = result[swapIndex] ?? "";
		result[swapIndex] = current ?? "";
	}
	return result.join("");
};
