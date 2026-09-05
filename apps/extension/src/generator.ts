/** 64 symbols: masking six uniformly random bits introduces no modulo bias. */
export function generatePassword(length = 24): string {
	if (!Number.isInteger(length) || length < 16 || length > 64)
		throw new Error("Choose 16–64 characters.");
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	const bytes = crypto.getRandomValues(new Uint8Array(length));
	const password = Array.from(bytes, (byte) => alphabet[byte & 63]).join("");
	bytes.fill(0);
	return password;
}
