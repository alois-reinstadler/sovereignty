import { wordlist } from "@scure/bip39/wordlists/english.js";

function secureIndex(max: number): number {
	if (!Number.isSafeInteger(max) || max <= 0 || max > 0x1_0000_0000) {
		throw new Error("Invalid random range");
	}
	const range = 0x1_0000_0000;
	const limit = range - (range % max);
	const bytes = new Uint8Array(4);
	const view = new DataView(bytes.buffer);
	while (true) {
		crypto.getRandomValues(bytes);
		const candidate = view.getUint32(0);
		if (candidate < limit) return candidate % max;
	}
}

export function generatePassphrase(words: number): string {
	if (!Number.isSafeInteger(words) || words < 6 || words > 10) {
		throw new Error("Passphrases must contain between 6 and 10 words");
	}
	return Array.from(
		{ length: words },
		() => wordlist[secureIndex(wordlist.length)],
	).join("-");
}
