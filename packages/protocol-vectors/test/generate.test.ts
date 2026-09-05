import { writeFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { buildVectors } from "./build-vectors";

it.skipIf(process.env.SVRGN_UPDATE_PROTOCOL_VECTORS !== "1")(
	"explicitly regenerates reviewed synthetic fixtures",
	async () => {
		const vectors = await buildVectors();
		expect(vectors.fixtureVersion).toBe(1);
		await writeFile(
			new URL("../fixtures/vectors.json", import.meta.url),
			`${JSON.stringify(vectors, null, "\t")}\n`,
		);
	},
);
