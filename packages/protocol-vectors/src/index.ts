import fixtures from "../fixtures/vectors.json" with { type: "json" };

type DeepReadonly<T> = T extends object
	? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
	: T;

/** Public synthetic test data only. This module imports no runtime crypto or DOM code. */
export const protocolVectors: DeepReadonly<typeof fixtures> = fixtures;
