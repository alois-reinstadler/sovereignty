import { copyFile, mkdir } from "node:fs/promises";
import { build } from "vite";
import { verifyBuild } from "./verify-build.mjs";

await build({
	configFile: false,
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: { input: "popup.html" },
	},
});
for (const entry of ["background", "content"])
	await build({
		configFile: false,
		build: {
			outDir: "dist",
			emptyOutDir: false,
			lib: {
				entry: `src/${entry}.ts`,
				name: `Sovereignty${entry}`,
				formats: [entry === "content" ? "iife" : "es"],
				fileName: () => `${entry}.js`,
			},
		},
	});
await mkdir("dist", { recursive: true });
await copyFile("manifest.json", "dist/manifest.json");
const files = await verifyBuild("dist");
console.log(
	`Verified ${files.length} extension artifact files and permission boundary.`,
);
