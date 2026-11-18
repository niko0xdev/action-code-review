import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/runtime/**/*.runtime.ts'],
		environment: 'node',
		testTimeout: 30_000,
	},
});
