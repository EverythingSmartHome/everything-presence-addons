import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		pool: "forks",
		setupFiles: ["./src/__tests__/setup.ts"],
		include: ["src/__tests__/**/*.test.ts"],
		root: ".",
	},
});
