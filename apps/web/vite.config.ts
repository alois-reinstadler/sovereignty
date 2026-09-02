import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		tanstackStart({
			spa: { enabled: true, prerender: { outputPath: "/index" } },
		}),
		viteReact(),
	],
});

export default config;
