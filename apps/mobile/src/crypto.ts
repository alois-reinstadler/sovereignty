/** Only these native primitives are allowed across the mobile vault boundary. */
export interface NativeCrypto {
	random(length: number): Uint8Array;
	derive(
		password: Uint8Array,
		salt: Uint8Array,
		operations: number,
		memory: number,
	): Uint8Array;
	encrypt(
		message: Uint8Array,
		aad: Uint8Array,
		nonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	decrypt(
		ciphertext: Uint8Array,
		aad: Uint8Array,
		nonce: Uint8Array,
		key: Uint8Array,
	): Uint8Array;
	zero(bytes: Uint8Array): void;
	encode(bytes: Uint8Array): string;
	decode(value: string): Uint8Array;
	text(bytes: Uint8Array): string;
}

/** UTF-8 without depending on browser TextEncoder in Hermes. */
export function utf8(value: string): Uint8Array {
	const bytes: number[] = [];
	for (const character of value) {
		let code = character.codePointAt(0) ?? 0;
		if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
		if (code < 0x80) bytes.push(code);
		else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63));
		else if (code < 0x10000)
			bytes.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 63),
				0x80 | (code & 63),
			);
		else
			bytes.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 63),
				0x80 | ((code >> 6) & 63),
				0x80 | (code & 63),
			);
	}
	const result = Uint8Array.from(bytes);
	bytes.fill(0);
	return result;
}
